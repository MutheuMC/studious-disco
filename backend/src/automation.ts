import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { Application,AutomationSettings,Profile,User } from '@prisma/client';
import { db } from './db.js';
import { aiAvailable,generateDocument } from './ai.js';
import { readPublicPage,parseListings } from './sources.js';
import { enqueue,notify } from './events.js';
import { rankJobs } from './discovery.js';
import { sendApplication,submissionSchema } from './submission.js';

export const automationSchema=z.object({
 searchEnabled:z.boolean(),searchIntervalHours:z.union([z.literal(6),z.literal(12),z.literal(24)]),
 autoApplyEnabled:z.boolean(),minMatchScore:z.number().int().min(70).max(100),dailyLimit:z.number().int().min(1).max(20),
 allowedRoles:z.array(z.string().trim().min(2).max(100)).max(20),
 allowedEmailDomains:z.array(z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,'Enter an exact email domain, such as example.com.')).max(30),
 approvedDocumentIds:z.array(z.string()).max(5),subjectTemplate:z.string().min(1).max(300).refine(s=>!/[\r\n]/.test(s)),bodyTemplate:z.string().max(20000),preparePortalDrafts:z.boolean()
});
const placeholders=new Set(['title','company','name','skills','summary']);
export const containsMissingFacts=(value:string)=>/\[(?:please|insert|your|missing|todo|add|provide)|\b(?:TODO|TBD)\b|<\s*(?:your|insert)/i.test(value);
export async function settingsFor(userId:string) {return db.automationSettings.upsert({where:{userId},create:{userId},update:{}});}
export function validateTemplate(value:string) {
 const tokens=[...value.matchAll(/{{\s*(.*?)\s*}}/g)].map(match=>match[1]);
 if(tokens.some(token=>!placeholders.has(token))||containsMissingFacts(value))throw Object.assign(new Error('Use only {{title}}, {{company}}, {{name}}, {{skills}} or {{summary}}, and remove missing-fact placeholders.'),{status:400});
 const remainder=value.replace(/{{\s*(?:title|company|name|skills|summary)\s*}}/g,'');
 if(/[{}]/.test(remainder))throw Object.assign(new Error('The email template contains an invalid placeholder.'),{status:400});
}
export async function saveSettings(userId:string,input:z.infer<typeof automationSchema>) {
 validateTemplate(input.subjectTemplate);validateTemplate(input.bodyTemplate);
 if(input.autoApplyEnabled) {
  if(!input.allowedRoles.length||!input.allowedEmailDomains.length||input.bodyTemplate.trim().length<20)throw Object.assign(new Error('To enable automatic email applications, choose roles, allowed recipient domains, documents and a complete approved email template.'),{status:400});
  const documents=await db.document.findMany({where:{userId,id:{in:input.approvedDocumentIds}}});
  if(documents.length!==new Set(input.approvedDocumentIds).size||!documents.some(document=>document.kind==='CV')||documents.some(document=>!['CV','COVER_LETTER','CERTIFICATE'].includes(document.kind)||containsMissingFacts(document.content)))throw Object.assign(new Error('Choose your approved CV version and any completed cover letter or certificates. Drafts with missing facts cannot be sent automatically.'),{status:400});
  const integration=await db.integration.findUnique({where:{userId}});if(!integration?.gmailTokens||!aiAvailable())throw Object.assign(new Error('Connect Gmail and your AI server before enabling automatic applications.'),{status:400});
 }
 const settings=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const previous=await tx.automationSettings.findUnique({where:{userId}});
  return tx.automationSettings.upsert({where:{userId},create:{userId,...input,policyRevision:1},update:{...input,policyRevision:{increment:1},...(input.searchEnabled&&(!previous?.searchEnabled||previous.searchIntervalHours!==input.searchIntervalHours)?{nextSearchAt:new Date()}: {})}});
 });
 if(settings.autoApplyEnabled) {
  const jobs=await db.application.findMany({where:{userId,status:{in:['DISCOVERED','SAVED','PREPARING','READY']},sendState:'IDLE'},orderBy:{matchScore:'desc'},take:12});
  for(const job of jobs)await enqueue(userId,'APPLICATION',{applicationId:job.id},'rules:'+settings.updatedAt.toISOString()+':'+job.id);
 }
 return settings;
}

export type Instructions={recipient:string|null;evidence:string;requiredKinds:string[];issue:string|null;text?:string;deadline?:Date};
export function inspectInstructions(html:string,title:string):Instructions {
 const $=cheerio.load(html);$('script,style,nav,footer,header').remove();
 $('br').replaceWith(' ');$('p,div,h1,h2,h3,li,section,article').append(' ');
 const text=$.text().replace(/\s+/g,' ').trim();
 const normalized=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const empty=(issue:string):Instructions=>({recipient:null,evidence:'',requiredKinds:[],issue});
 if(!normalized(text).includes(normalized(title)))return empty('The original page does not clearly identify this job.');
 if(parseListings(html,'https://example.invalid/job').length>1)return empty('This is a multi-job page. Open the individual advert before applying.');
 const emails=[...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)];
 const matches=emails.map(match=>{
  const start=Math.max(0,match.index!-230);const evidence=text.slice(start,match.index!+match[0].length+180);
  const before=text.slice(start,match.index!);
  const explicit=/\b(?:apply|applications?|send|submit|email)\b/i.test(before)&&/\b(?:CV|resum[eé]|application|cover\s*letter)\b/i.test(before);
  return {email:match[0].toLowerCase().replace(/[.,;]+$/,''),evidence,explicit};
 }).filter(match=>match.explicit);
 const recipients=[...new Set(matches.map(match=>match.email))];
 if(recipients.length!==1)return empty(recipients.length?'Multiple application addresses require your review.':'No explicit email application instructions found; use the portal link.');
 const evidence=matches.find(match=>match.email===recipients[0])!.evidence;
 const complex=/\b(?:single|combined|one)\s+(?:PDF|file|document)|subject\s*(?:line|must|should|:)|reference\s*(?:number|code|:)|application\s+form|questionnaire|transcript|portfolio|salary\s+(?:expectation|history)/i.test(evidence);
 const requiredKinds=['CV',...(/cover\s*letter|motivation\s*letter/i.test(evidence)?['COVER_LETTER']:[]),...(/(?:attach|send|submit|copies).{0,90}certificat/i.test(evidence)?['CERTIFICATE']:[])];
 const postings=parseListings(html,'https://example.invalid/job');
 const postedDeadline=postings.find(posting=>normalized(posting.title)===normalized(title))?.deadline;
 const dateLabel=text.match(/(?:deadline|closing date|apply by)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
 const deadline=postedDeadline||(dateLabel?new Date(dateLabel+'T23:59:59Z'):undefined);
 return {recipient:recipients[0],evidence,requiredKinds,text,deadline,issue:complex?'The advert includes additional application instructions that need review.':null};
}
export function renderTemplate(template:string,job:Application,user:User,profile:Profile) {
 const values={title:job.title,company:job.company,name:user.name,skills:profile.skills,summary:profile.summary};
 return template.replace(/{{\s*(title|company|name|skills|summary)\s*}}/g,(_match,key:keyof typeof values)=>values[key]);
}
export function automaticBlock(job:Application,settings:AutomationSettings,profile:Profile,instructions:Instructions) {
 if(!settings.autoApplyEnabled)return 'Automatic email applications are off. Review and send when ready.';
 if(job.sendState!=='IDLE')return 'A previous send is recorded or needs checking in Gmail.';
 if(!['DISCOVERED','SAVED','PREPARING','READY'].includes(job.status))return 'This application is no longer eligible for automatic sending.';
 if(instructions.issue)return instructions.issue;
 if(!instructions.recipient)return 'No explicit application email address was verified.';
 if(!settings.allowedEmailDomains.includes(instructions.recipient.split('@')[1]))return 'The recipient domain is outside your approved rules.';
 const words=(value:string)=>' '+value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ';
 if(!settings.allowedRoles.some(role=>words(job.title).includes(words(role))))return 'The job title is outside your approved roles.';
 if(job.matchScore===null||job.matchScore<settings.minMatchScore)return 'The AI match score is below your selected threshold.';
 if(!job.requirementsSatisfied)return 'Requirements or eligibility still have gaps or unknowns.';
 if(job.assessmentProfileUpdatedAt?.getTime()!==profile.updatedAt.getTime())return 'Your profile changed after this assessment. Search again to reassess the match.';
 if(!profile.workEligibility.trim())return 'Work eligibility must be recorded in your profile.';
 if(!instructions.deadline||instructions.deadline.getTime()<=Date.now())return 'A future application deadline must be verified before automatic sending.';
 return null;
}

export async function prepareOpportunity(userId:string,id:string,read=readPublicPage) {
 let job=await db.application.findFirstOrThrow({where:{id,userId}});
 if(job.sendState!=='IDLE'||!['DISCOVERED','SAVED','PREPARING','READY'].includes(job.status))return;
 const settings=await settingsFor(userId);const user=await db.user.findUniqueOrThrow({where:{id:userId},include:{profile:true}});
 const review=async(reason:string)=>db.application.updateMany({where:{id,userId,sendState:{in:['IDLE','UNKNOWN']}},data:{automationState:'NEEDS_REVIEW',reviewReason:reason}});
 if(!job.url){await review('Add the original advert URL so application instructions can be checked.');return;}
 let instructions:Instructions;
 try {instructions=inspectInstructions(await read(job.url),job.title);}
 catch {await review('The original advert could not be reached. Check it before applying.');return;}
 if(instructions.recipient) {
  job=await db.application.update({where:{id},data:{method:'EMAIL',contactEmail:instructions.recipient,applicationInstructions:instructions.evidence,instructionsVerifiedAt:new Date(),automationState:'EMAIL_READY',reviewReason:null}});
  if(!user.profile){await review('Complete your profile before applying.');return;}
  const blocked=automaticBlock(job,settings,user.profile,instructions);
  if(blocked){if(!settings.autoApplyEnabled&&!instructions.issue)await db.application.update({where:{id},data:{automationState:'EMAIL_READY',reviewReason:blocked}});else await review(blocked);return;}
  if(!instructions.text||instructions.text.length>12000){await review('The full advert is too long for automatic verification. Review its requirements manually.');return;}
  try {
   const [assessment]=await rankJobs(user.profile,[{source:job.discoverySource||'Original advert',remote:null,listing:{title:job.title,company:job.company,location:job.location,url:job.url!,description:instructions.text,method:'EMAIL',contactEmail:instructions.recipient}}],'',12000);
   job=await db.application.update({where:{id},data:{matchScore:assessment.score,matchReason:assessment.reason,requirementsSatisfied:assessment.requirementsMet===true&&assessment.gaps?.length===0&&assessment.unknowns?.length===0,assessmentProfileUpdatedAt:user.profile.updatedAt,deadline:instructions.deadline}});
   const finalBlock=automaticBlock(job,settings,user.profile,instructions);if(finalBlock){await review(finalBlock);return;}
  }catch {await review('AI could not verify the full advert. Automatic sending was skipped.');return;}
  const documents=await db.document.findMany({where:{userId,id:{in:settings.approvedDocumentIds}}});
  if(documents.length!==new Set(settings.approvedDocumentIds).size||instructions.requiredKinds.some(kind=>!documents.some(document=>document.kind===kind))||documents.some(document=>containsMissingFacts(document.content))){await review('An approved required document is missing or contains incomplete facts.');return;}
  const input=submissionSchema.parse({approved:true,recipient:instructions.recipient,subject:renderTemplate(settings.subjectTemplate,job,user,user.profile),body:renderTemplate(settings.bodyTemplate,job,user,user.profile),documentIds:settings.approvedDocumentIds});
  if(containsMissingFacts(input.body)||containsMissingFacts(input.subject)){await review('The email contains missing-fact placeholders.');return;}
  // The advert is read again immediately before claiming a real send.
  const rechecked=inspectInstructions(await read(job.url!),job.title);
  if(rechecked.recipient!==instructions.recipient||rechecked.evidence!==instructions.evidence||rechecked.text!==instructions.text||rechecked.deadline?.getTime()!==instructions.deadline?.getTime()||rechecked.issue){await review('Application instructions changed. Review the latest advert.');return;}
  try {await sendApplication(userId,id,input,settings.policyRevision);}
  catch(error){await review((error as Error).message);}
 } else {
  if(instructions.issue&&!instructions.issue.startsWith('No explicit')){await review(instructions.issue);return;}
  await db.application.update({where:{id},data:{method:'PORTAL',automationState:'PORTAL_READY',reviewReason:'Complete the application on the original website, then mark it applied.'}});
  if(settings.preparePortalDrafts&&aiAvailable()&&job.matchScore!==null&&job.matchScore>=settings.minMatchScore&&!job.portalPreparedAt) {
   try {for(const kind of ['CV','COVER_LETTER'])if(!await db.document.findFirst({where:{userId,applicationId:id,kind}}))await generateDocument(userId,id,kind);
   await db.application.update({where:{id},data:{portalPreparedAt:new Date()}});}
   catch {await review('This portal needs your action. AI documents could not be prepared; retry preparation or use your existing CV.');}
  }
  await notify(userId,'Portal application ready',job.title+' at '+job.company+' needs your action. Review any prepared documents and complete the original portal.','portal-ready:'+id,'/?view=opportunities');
 }
}
