import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { pdfBuffer } from './documents.js';
import { gmailRequest } from './integrations.js';

export const submissionSchema=z.object({approved:z.literal(true),recipient:z.email(),subject:z.string().min(1).max(300).refine(s=>!/[\r\n]/.test(s)),body:z.string().min(1).max(30000),documentIds:z.array(z.string()).max(5)});
export type Submission=z.infer<typeof submissionSchema>;
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const base64=(buffer:Buffer)=>buffer.toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';

export async function sendApplication(userId:string,id:string,input:Submission,policyVersion?:number) {
 const job=await db.application.findFirstOrThrow({where:{id,userId}});
 if(job.method!=='EMAIL')throw fail('This job uses an application portal.');
 const documents=await db.document.findMany({where:{id:{in:input.documentIds},userId}});
 if(documents.length!==new Set(input.documentIds).size)throw fail('An attachment is unavailable.');
 const boundary='jobnest_'+randomBytes(16).toString('hex');
 let mime='To: '+input.recipient+'\r\nSubject: =?UTF-8?B?'+Buffer.from(input.subject).toString('base64')+'?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="'+boundary+'"\r\n\r\n--'+boundary+'\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+base64(Buffer.from(input.body))+'\r\n';
 for(const document of documents) {
  const buffer=document.storageKey?await readFile(path.join(config.storage,document.storageKey)):await pdfBuffer(document.content);
  const filename=(document.originalName||document.name+'.pdf').replace(/[^a-zA-Z0-9._-]/g,'_');
  mime+='--'+boundary+'\r\nContent-Type: '+(document.storageKey?document.mimeType:'application/pdf')+'\r\nContent-Disposition: attachment; filename="'+filename+'"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+base64(buffer)+'\r\n';
 }
 mime+='--'+boundary+'--';if(Buffer.byteLength(mime)>20*1024*1024)throw fail('Attachments are too large. Use a combined size under 14 MB.');
 const integration=await db.integration.findUnique({where:{userId}});if(!integration?.gmailTokens)throw fail('Connect Gmail first.');
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  if(policyVersion!==undefined) {
   const settings=await tx.automationSettings.findUniqueOrThrow({where:{userId}});
   if(!settings.autoApplyEnabled||settings.policyRevision!==policyVersion)throw fail('Automatic application rules changed. Prepare this application again.',409);
   const currentJob=await tx.application.findFirstOrThrow({where:{id,userId}});
   const currentProfile=await tx.profile.findUniqueOrThrow({where:{userId}});
   if(currentJob.assessmentProfileUpdatedAt?.getTime()!==currentProfile.updatedAt.getTime()||!currentJob.requirementsSatisfied)throw fail('The profile or assessment changed. Prepare this application again.',409);
   const attempts=await tx.application.count({where:{userId,autoAttemptedAt:{gte:new Date(Date.now()-86400000)}}});
   if(attempts>=settings.dailyLimit)throw fail('Automatic email limit reached for the last 24 hours.',409);
  }
  if(await tx.document.count({where:{userId,id:{in:input.documentIds}}})!==new Set(input.documentIds).size)throw fail('An attachment is unavailable.');
  const claimed=await tx.application.updateMany({where:{id,userId,sendState:'IDLE',status:{notIn:['APPLIED','REJECTED','WITHDRAWN','OFFER','INTERVIEW','ASSESSMENT']}},data:{sendState:'SENDING',sentRecipient:input.recipient,sentSubject:input.subject,sentBody:input.body,sentDocumentIds:input.documentIds,...(policyVersion!==undefined?{autoAttemptedAt:new Date()}: {})}});
  if(!claimed.count)throw fail('This application was already sent or needs its previous send result checked.',409);
 });
 let sent:any;
 try {sent=await gmailRequest(userId,'messages/send',{method:'POST',body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')})});}
 catch(error) {
  await db.application.update({where:{id},data:{sendState:'UNKNOWN',automationState:'NEEDS_REVIEW',reviewReason:'Sending could not be confirmed. Check Gmail Sent; automatic retries are blocked.'}});
  throw fail('Sending could not be confirmed. Check Gmail Sent before taking further action. '+(error as Error).message,502);
 }
 // If persistence fails after Gmail accepts the message, SENDING still blocks any resend.
 await db.$transaction([
  db.application.update({where:{id},data:{sendState:'SENT',status:'APPLIED',automationState:'APPLIED',reviewReason:null,appliedAt:new Date(),gmailMessageId:sent.threadId}}),
  db.activity.create({data:{userId,applicationId:id,message:(policyVersion!==undefined?'Automatically emailed application to ':'Application emailed to ')+input.recipient}})
 ]);
 return {ok:true};
}
