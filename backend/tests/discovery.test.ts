import { before,beforeEach,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { config } from '../src/config.js';
import { discover,parseFreeFeed,rankJobs,planSearch,loadPublicFeed,shortlist,type Candidate } from '../src/discovery.js';
import { schedule } from '../src/worker.js';

const original={aiProvider:config.aiProvider,aiKey:config.aiKey,aiBase:config.aiBase,aiModel:config.aiModel,searchKey:config.searchKey};
const originalFetch=globalThis.fetch;
let userId='';let aiRequests:string[]=[];
const facts={headline:'',summary:'A nurse with clinical experience.',skills:'Patient care, infection prevention',experience:'Nurse at Example Hospital, 2021-2025',education:'Diploma in Nursing; Infection Prevention Certificate',roles:'',countries:'Worldwide',remoteOnly:false,workEligibility:'Eligibility needs checking',languages:'English'};
const arbeitnow={data:[{title:'Registered Nurse',company_name:'Hospital A',location:'Berlin, Germany',url:'https://www.arbeitnow.com/view/nurse',description:'<p>Patient care and infection prevention. Nursing diploma required.</p>',remote:false},{title:'Accountant',company_name:'Other',location:'Berlin',url:'https://example.com/accountant',description:'Accounting role',remote:false}]};
const remotive={jobs:[{title:'Remote Nurse Educator',company_name:'Hospital B',candidate_required_location:'United States only',url:'https://remotive.com/remote-jobs/nurse',description:'<p>Nursing diploma and patient care teaching. US work authorization required.</p>'}]};
const response=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{headers:{'Content-Type':'application/json'}});
const reader=async(url:string)=>{
 if(url.includes('arbeitnow'))return JSON.stringify(arbeitnow);
 if(url.includes('remotive'))return JSON.stringify(remotive);
 throw new Error('Fixture source unavailable');
};
before(async()=>{
 if(!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))throw new Error('Dedicated test database required.');
 await db.user.deleteMany();await db.publicFeedCache.deleteMany();
 const user=await db.user.create({data:{name:'Test Nurse',email:'nurse@test.invalid',profile:{create:facts},integration:{create:{}}}});userId=user.id;
});
beforeEach(async()=>{
 Object.assign(config,{aiProvider:'ollama',aiKey:'',aiBase:'http://127.0.0.1:11434/v1',aiModel:'test-model',searchKey:''});
 aiRequests=[];
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'http://127.0.0.1:11434/v1/chat/completions');
  const headers=options!.headers as Record<string,string>;assert.equal(headers.Authorization,undefined);
  const body=JSON.parse(String(options!.body));aiRequests.push(body.messages[1].content);
  if(body.messages[0].content.startsWith('Plan a job search'))return response({roles:['Registered Nurse','Nurse Educator'],keywords:['patient care','infection prevention','nursing diploma']});
  const input=JSON.parse(body.messages[1].content);
  return response({matches:input.jobs.map((job:any)=>({index:job.index,score:job.location.includes('United States')?40:85,reason:job.location.includes('United States')?'Matches: nursing diploma. Gaps: teaching experience unknown. Location/eligibility: US authorization not verified.':'Matches: patient care and nursing diploma. Gaps: local registration unknown. Location/eligibility: check authorization.'}))});
 };
});
after(async()=>{globalThis.fetch=originalFetch;Object.assign(config,original);await db.user.deleteMany();await db.publicFeedCache.deleteMany();await db.$disconnect();});

test('free feed adapters preserve source links, strip HTML, and reject unsafe links',()=>{
 const candidates=parseFreeFeed('Arbeitnow',arbeitnow);
 assert.equal(candidates[0].source,'Arbeitnow');assert.equal(candidates[0].remote,false);
 assert.ok(!candidates[0].listing.description.includes('<p>'));
 assert.equal(parseFreeFeed('Remotive',remotive)[0].remote,true);
 assert.equal(parseFreeFeed('Arbeitnow',{data:[{...arbeitnow.data[0],url:'javascript:alert(1)'}]}).length,0);
 assert.throws(()=>parseFreeFeed('Arbeitnow',{}),/unreadable/);
});
test('Ollama plans roles from skills, experience and certificates without a paid key or account contact details',async()=>{
 const plan=await planSearch(facts,'');assert.ok(plan.roles.includes('Registered Nurse'));
 assert.ok(aiRequests[0].includes('Infection Prevention Certificate'));
 assert.ok(aiRequests[0].includes('Nurse at Example Hospital'));
 assert.ok(!aiRequests[0].includes('nurse@test.invalid'));
});
test('discovery retrieves real source records, ranks them, preserves restrictions and deduplicates on rerun',async()=>{
 const first=await discover(userId,'',reader);assert.equal(first.added,2);assert.equal(first.reviewed,2);
 const saved=await db.application.findMany({where:{userId},orderBy:{matchScore:'desc'}});
 assert.equal(saved[0].matchScore,85);assert.equal(saved[1].matchScore,40);
 assert.equal(saved[1].discoverySource,'Remotive');assert.match(saved[1].matchReason,/US authorization not verified/);
 assert.equal(saved[1].url,remotive.jobs[0].url);
 assert.equal((await discover(userId,'',reader)).added,0);
 assert.equal(await db.application.count({where:{userId}}),2);
});
test('public feed caching avoids repeated provider calls across searches',async()=>{
 let calls=0;const read=async()=>{calls++;return JSON.stringify(remotive);};
 await loadPublicFeed('Remotive','https://cache-fixture.example/jobs',read);
 await loadPublicFeed('Remotive','https://cache-fixture.example/jobs',read);
 assert.equal(calls,1);
});
test('shortlisting excludes explicitly onsite jobs for remote-only profiles and expired jobs',()=>{
 const onsite=parseFreeFeed('Arbeitnow',arbeitnow)[0];
 const remote=parseFreeFeed('Remotive',remotive)[0];
 const expired:Candidate={...remote,listing:{...remote.listing,url:'https://example.com/expired',deadline:new Date('2020-01-01')}};
 const selected=shortlist([onsite,remote,expired],{...facts,remoteOnly:true},{roles:['nurse'],keywords:[]},'');
 assert.equal(selected.length,1);assert.equal(selected[0].source,'Remotive');
});
test('a profile with certificate facts and no preferred roles schedules interval-based discovery',async()=>{
 await db.profile.update({where:{userId},data:{...facts,headline:'',summary:'',skills:'',experience:'',education:'Nursing certificate',roles:''}});
 await schedule();await schedule();
 const tasks=await db.task.findMany({where:{userId,kind:'SEARCH'}});
 assert.equal(tasks.length,1);assert.deepEqual(tasks[0].payload,{query:'',trigger:'scheduled'});
 await db.profile.update({where:{userId},data:facts});
});
test('partial source failures are reported while available sources still contribute jobs',async()=>{
 await db.source.create({data:{userId,name:'Unavailable local board',url:'https://unavailable.example/jobs',enabled:true}});
 const result=await discover(userId,'nurse',reader);
 assert.ok(result.warnings.some(warning=>warning.includes('Unavailable local board')));
 assert.ok(result.retrieved>0);
 await db.source.deleteMany({where:{userId}});
});
test('all unavailable sources fail visibly instead of claiming a successful search',async()=>{
 await db.publicFeedCache.deleteMany();
 await assert.rejects(()=>discover(userId,'nurse',async()=>{throw new Error('Offline');}),/could not be reached/);
});
test('AI cannot add invented vacancies, invalid score ranges or duplicate assessment indexes',async()=>{
 const candidates=parseFreeFeed('Arbeitnow',arbeitnow);
 globalThis.fetch=async()=>response({matches:[{index:99,score:90,reason:'Invented job'}]});
 await assert.rejects(()=>rankJobs(facts,candidates,''),/incomplete/);
 globalThis.fetch=async()=>response({matches:[{index:0,score:999,reason:'Invalid score'}]});
 await assert.rejects(()=>rankJobs(facts,candidates,''));
});
test('without AI, free discovery remains available and never labels keyword matches as AI scores',async()=>{
 config.aiModel='';
 const result=await discover(userId,'nurse',reader);assert.equal(result.reviewed,2);
 const saved=await db.application.findMany({where:{userId}});
 assert.ok(saved.every(job=>job.matchScore===null));
 assert.ok(saved.every(job=>job.matchReason.includes('Keyword match only')));
 assert.equal(aiRequests.length,0);
});
test('an unreachable AI server degrades to explicitly labeled keyword results without losing retrieved jobs',async()=>{
 globalThis.fetch=async()=>{throw new Error('Connection refused');};
 const result=await discover(userId,'nurse',reader);
 assert.equal(result.aiAssessed,false);assert.equal(result.reviewed,2);
 assert.ok(result.warnings.some(warning=>warning.includes('AI role planning was unavailable')));
 const saved=await db.application.findMany({where:{userId}});
 assert.ok(saved.every(job=>job.matchScore===null));
 assert.ok(saved.every(job=>job.matchReason.includes('Keyword match only')));
});
