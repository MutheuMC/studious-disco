import { before,beforeEach,afterEach,after,test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { db } from '../src/db.js';
import { config } from '../src/config.js';
import { encrypt,hashToken } from '../src/security.js';
import { settingsFor,saveSettings,inspectInstructions,prepareOpportunity,automationSchema } from '../src/automation.js';
import { createApp } from '../src/app.js';
import { schedule } from '../src/worker.js';
import { startSearchNow,type SearchExecutor } from '../src/searches.js';

let userId='',jobId='',documentId='',cookie='';let sends=0;
const originalFetch=globalThis.fetch;
const original={provider:config.aiProvider,key:config.aiKey,model:config.aiModel,base:config.aiBase};
const deadline=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
const html=(extra='')=>'<article><h1>Registered Nurse</h1><p>Nursing diploma and patient care experience required. Work location: Kenya.</p><p>Deadline: '+deadline+'</p><p>Send your CV '+extra+' to recruitment@hospital.example.</p></article>';
const body={approved:true,recipient:'recruitment@hospital.example',subject:'Application',body:'My approved application',documentIds:[]};
const aiResponse=(content:unknown)=>new Response(JSON.stringify({choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)}}]}));
async function enabledSettings(limit=3){
 return db.automationSettings.update({where:{userId},data:{autoApplyEnabled:true,policyRevision:{increment:1},allowedRoles:['Nurse'],allowedEmailDomains:['hospital.example'],approvedDocumentIds:[documentId],dailyLimit:limit,bodyTemplate:'Dear hiring team, please find my CV attached for {{title}}. Regards, {{name}}',subjectTemplate:'Application for {{title}} — {{name}}'}});
}
async function waitForTask(id:string){for(let i=0;i<100;i++){const task=await db.task.findUniqueOrThrow({where:{id}});if(task.status!=='RUNNING')return task;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Task did not finish');}
before(async()=>{if(!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))throw new Error('Dedicated test database required.');});
beforeEach(async()=>{
 await db.user.deleteMany();sends=0;
 Object.assign(config,{aiProvider:'ollama',aiKey:'',aiModel:'fixture',aiBase:'http://fixture-ai.invalid/v1'});
 const user=await db.user.create({data:{name:'Test Nurse',email:'nurse@test.invalid',profile:{create:{summary:'Nurse with clinical experience',experience:'Nurse, Example Hospital',education:'Nursing diploma',skills:'Patient care',workEligibility:'Authorized to work in Kenya'}},integration:{create:{gmailTokens:encrypt(JSON.stringify({access_token:'fixture-token',expiry_date:Date.now()+3600000}))}}},include:{profile:true}});
 userId=user.id;
 const document=await db.document.create({data:{userId,name:'Approved master CV',kind:'CV',content:'Test Nurse\nNursing diploma\nPatient care'}});documentId=document.id;
 const job=await db.application.create({data:{userId,title:'Registered Nurse',company:'Example Hospital',url:'https://hospital.example/nurse',dedupeKey:'fixture-job',description:'Nursing diploma and patient care experience required.',matchScore:90,requirementsSatisfied:true,assessmentProfileUpdatedAt:user.profile!.updatedAt,deadline:new Date(deadline+'T23:59:59Z'),discoverySource:'Original hospital advert',status:'DISCOVERED'}});jobId=job.id;
 const token=randomBytes(24).toString('hex');await db.session.create({data:{userId,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+600000)}});cookie='jobnest_session='+token;
 await settingsFor(userId);
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('/messages/send')){sends++;return new Response(JSON.stringify({id:'message-'+sends,threadId:'thread-'+sends}));}
  assert.ok(String(url).includes('fixture-ai.invalid'));
  const input=JSON.parse(String(options?.body));
  if(input.messages[0].content.startsWith('Assess each supplied'))return aiResponse({matches:[{index:0,score:90,reason:'Matches: nursing diploma and patient care. Gaps: none. Eligibility: Kenya.',requirementsMet:true,gaps:[],unknowns:[]}]});
  return aiResponse('Draft based on the candidate profile. Review before use.');
 };
});
afterEach(()=>{globalThis.fetch=originalFetch;});
after(async()=>{await db.user.deleteMany();await db.$disconnect();Object.assign(config,{aiProvider:original.provider,aiKey:original.key,aiModel:original.model,aiBase:original.base});});

test('automation starts with six-hour discovery enabled and email sending disabled',async()=>{
 const settings=await settingsFor(userId);assert.equal(settings.searchEnabled,true);assert.equal(settings.searchIntervalHours,6);assert.equal(settings.autoApplyEnabled,false);
});
test('schedule respects pause, interval and concurrent scheduler deduplication',async()=>{
 await db.automationSettings.update({where:{userId},data:{searchEnabled:false}});await schedule();
 assert.equal(await db.task.count({where:{userId,kind:'SEARCH'}}),0);
 await db.automationSettings.update({where:{userId},data:{searchEnabled:true,searchIntervalHours:12,nextSearchAt:new Date()}});
 await Promise.all([schedule(),schedule()]);assert.equal(await db.task.count({where:{userId,kind:'SEARCH'}}),1);
 const settings=await settingsFor(userId);assert.ok(settings.nextSearchAt.getTime()>Date.now()+11*3600000);
});
test('Search now starts in the API without a worker, publishes progress, and leaves the recurring interval unchanged',async()=>{
 await db.automationSettings.update({where:{userId},data:{searchEnabled:false}});const before=await settingsFor(userId);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const executor:SearchExecutor=async(_user,_query,_read,hooks)=>{calls++;await hooks?.progress?.('Fixture results are ready; assessing…');await gate;return {added:1,reviewed:1,retrieved:1,roles:['Nurse'],aiAssessed:true,warnings:[],applicationIds:[]};};
 const app=createApp({searchExecutor:executor});
 const response=await request(app).post('/api/discover').set('Origin',config.frontend).set('Cookie',cookie).send({query:'nurse'});
 assert.equal(response.status,202);assert.equal(response.body.status,'RUNNING');
 assert.equal((await startSearchNow(userId,'nurse',executor)).id,response.body.id);assert.equal(calls,1);
 const progress=await request(app).get('/api/searches/'+response.body.id).set('Cookie',cookie);
 assert.equal(progress.status,200);assert.ok(progress.body.applications.some((job:any)=>job.id===jobId));
 release();assert.equal((await waitForTask(response.body.id)).status,'COMPLETE');
 const after=await settingsFor(userId);assert.equal(after.nextSearchAt.toISOString(),before.nextSearchAt.toISOString());assert.equal(after.lastSearchAdded,1);
});
test('settings require a complete opt-in policy and owner-controlled document versions',async()=>{
 const settings=await settingsFor(userId);
 await assert.rejects(()=>saveSettings(userId,automationSchema.parse({...settings,autoApplyEnabled:true})),/choose roles/);
 await assert.rejects(()=>saveSettings(userId,automationSchema.parse({...settings,subjectTemplate:'{{password}}'})),/Use only/);
 const app=createApp();assert.equal((await request(app).put('/api/automation').set('Origin',config.frontend).send(settings)).status,401);
});
test('valid opted-in settings retain exact approved rules and queue existing opportunities',async()=>{
 const settings=await settingsFor(userId);
 const saved=await saveSettings(userId,automationSchema.parse({...settings,autoApplyEnabled:true,allowedRoles:['Nurse'],allowedEmailDomains:['hospital.example'],approvedDocumentIds:[documentId],bodyTemplate:'Dear hiring team, please find my application for {{title}} attached. Regards, {{name}}'}));
 assert.equal(saved.autoApplyEnabled,true);assert.equal(saved.policyRevision,1);
 assert.deepEqual(saved.approvedDocumentIds,[documentId]);
 assert.equal(await db.task.count({where:{userId,kind:'APPLICATION'}}),1);
 const paused=await saveSettings(userId,automationSchema.parse({...saved,autoApplyEnabled:false}));assert.equal(paused.autoApplyEnabled,false);
});
test('pausing automatic search also pauses scheduled website checks',async()=>{
 await db.source.create({data:{userId,name:'Saved hospital',url:'https://hospital.example/jobs'}});
 await db.automationSettings.update({where:{userId},data:{searchEnabled:false}});await schedule();
 assert.equal(await db.task.count({where:{userId,kind:{in:['SEARCH','SOURCE']}}}),0);
});
test('instruction detection accepts explicit application email but ignores generic contact information and complex requirements',()=>{
 assert.equal(inspectInstructions(html(),'Registered Nurse').recipient,'recruitment@hospital.example');
 assert.ok(inspectInstructions(html(),'Registered Nurse').deadline);
 assert.equal(inspectInstructions('<h1>Registered Nurse</h1><footer>Contact support@hospital.example</footer>','Registered Nurse').recipient,null);
 assert.equal(inspectInstructions(html(),'Accountant').recipient,null);
 assert.match(inspectInstructions(html('and use reference number RN42'),'Registered Nurse').issue!,/additional/);
});
test('with auto sending off, email jobs become ready for manual review and no email is sent',async()=>{
 await prepareOpportunity(userId,jobId,async()=>html());const job=await db.application.findUniqueOrThrow({where:{id:jobId}});
 assert.equal(job.method,'EMAIL');assert.equal(job.automationState,'EMAIL_READY');assert.equal(sends,0);assert.equal(job.appliedAt,null);
});
test('eligible email jobs use approved template and immutable documents, then record a confirmed submission',async()=>{
 await enabledSettings();await prepareOpportunity(userId,jobId,async()=>html());
 const job=await db.application.findUniqueOrThrow({where:{id:jobId}});
 assert.equal(sends,1);assert.equal(job.sendState,'SENT');assert.equal(job.status,'APPLIED');assert.equal(job.automationState,'APPLIED');
 assert.deepEqual(job.sentDocumentIds,[documentId]);assert.match(job.sentBody!,/Registered Nurse/);assert.ok(job.autoAttemptedAt);
 await prepareOpportunity(userId,jobId,async()=>html());assert.equal(sends,1);
});
test('an unapproved recipient domain or missing attachment prevents automatic sending',async()=>{
 await enabledSettings();await prepareOpportunity(userId,jobId,async()=>html().replace('recruitment@hospital.example','jobs@other.example'));
 assert.equal(sends,0);assert.match((await db.application.findUniqueOrThrow({where:{id:jobId}})).reviewReason!,/domain/);
 await prepareOpportunity(userId,jobId,async()=>html('and cover letter'));
 assert.equal(sends,0);assert.match((await db.application.findUniqueOrThrow({where:{id:jobId}})).reviewReason!,/document/);
});
test('a high score cannot override unresolved requirements, missing deadlines or profile changes',async()=>{
 await enabledSettings();await db.application.update({where:{id:jobId},data:{requirementsSatisfied:false}});
 await prepareOpportunity(userId,jobId,async()=>html());assert.equal(sends,0);
 await db.application.update({where:{id:jobId},data:{requirementsSatisfied:true}});
 await prepareOpportunity(userId,jobId,async()=>html().replace('Deadline: '+deadline,''));assert.equal(sends,0);
 await db.profile.update({where:{userId},data:{education:'Changed qualifications'}});
 await prepareOpportunity(userId,jobId,async()=>html());assert.equal(sends,0);
});
test('automatic sending rechecks the full advert rather than trusting the initial shortlist score',async()=>{
 await enabledSettings();globalThis.fetch=async()=>aiResponse({matches:[{index:0,score:95,reason:'License requirement is unknown',requirementsMet:false,gaps:[],unknowns:['License not recorded']}]});
 await prepareOpportunity(userId,jobId,async()=>html());
 assert.equal(sends,0);assert.equal((await db.application.findUniqueOrThrow({where:{id:jobId}})).automationState,'NEEDS_REVIEW');
});
test('the daily email limit is enforced atomically across concurrent applications',async()=>{
 await enabledSettings(1);const original=await db.application.findUniqueOrThrow({where:{id:jobId}});
 const second=await db.application.create({data:{...original,id:undefined,dedupeKey:'second-job',url:'https://hospital.example/nurse2'}});
 await Promise.all([prepareOpportunity(userId,jobId,async()=>html()),prepareOpportunity(userId,second.id,async()=>html())]);
 assert.equal(sends,1);assert.equal(await db.application.count({where:{userId,autoAttemptedAt:{not:null}}}),1);
});
test('concurrent preparation of the same job cannot send twice or overwrite a confirmed submission',async()=>{
 await enabledSettings();await Promise.all([prepareOpportunity(userId,jobId,async()=>html()),prepareOpportunity(userId,jobId,async()=>html())]);
 assert.equal(sends,1);const job=await db.application.findUniqueOrThrow({where:{id:jobId}});
 assert.equal(job.sendState,'SENT');assert.equal(job.automationState,'APPLIED');
});
test('pausing rules during preparation prevents the send claim',async()=>{
 await enabledSettings();let reads=0;
 await prepareOpportunity(userId,jobId,async()=>{if(++reads===2)await db.automationSettings.update({where:{userId},data:{autoApplyEnabled:false,policyRevision:{increment:1}}});return html();});
 assert.equal(sends,0);assert.match((await db.application.findUniqueOrThrow({where:{id:jobId}})).reviewReason!,/rules changed/);
});
test('an uncertain Gmail result is retained and never automatically retried',async()=>{
 await enabledSettings();const fetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{if(String(url).includes('/messages/send')){sends++;throw new Error('Connection dropped');}return fetch(url,options);};
 await prepareOpportunity(userId,jobId,async()=>html());assert.equal(sends,1);
 assert.equal((await db.application.findUniqueOrThrow({where:{id:jobId}})).sendState,'UNKNOWN');
 await prepareOpportunity(userId,jobId,async()=>html());assert.equal(sends,1);
});
test('portal jobs get reviewable documents and a handoff while submission stays unconfirmed',async()=>{
 await prepareOpportunity(userId,jobId,async()=>'<article><h1>Registered Nurse</h1><p>Complete the application on our careers portal.</p></article>');
 const job=await db.application.findUniqueOrThrow({where:{id:jobId}});
 assert.equal(job.automationState,'PORTAL_READY');assert.equal(job.appliedAt,null);assert.equal(job.status,'DISCOVERED');assert.equal(sends,0);
 assert.equal(await db.document.count({where:{userId,applicationId:jobId}}),2);
 await prepareOpportunity(userId,jobId,async()=>'<article><h1>Registered Nurse</h1><p>Complete the application on our careers portal.</p></article>');
 assert.equal(await db.document.count({where:{userId,applicationId:jobId}}),2);
});
