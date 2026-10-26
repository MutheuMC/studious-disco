import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { db } from './db.js';
import { encrypt,decrypt } from './security.js';
import { classifyEmail } from './validation.js';
import { notify } from './events.js';
export function googleClient(){return new OAuth2Client(config.googleId,config.googleSecret,config.googleRedirect);}
export async function gmailRequest(userId:string,path:string,options:RequestInit={}){
 const integration=await db.integration.findUnique({where:{userId}});if(!integration?.gmailTokens)throw Object.assign(new Error('Connect Gmail first.'),{status:400});
 const client=googleClient();client.setCredentials(JSON.parse(decrypt(integration.gmailTokens)));
 const token=await client.getAccessToken();if(!token.token)throw new Error('Gmail authorization expired. Reconnect your account.');
 await db.integration.update({where:{userId},data:{gmailTokens:encrypt(JSON.stringify(client.credentials))}});
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{...options,headers:{Authorization:'Bearer '+token.token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Gmail request failed ('+response.status+'). Reconnect Gmail if permission was revoked.');return response.json() as Promise<any>;
}
export async function syncGmail(userId:string){
 const integration=await db.integration.findUniqueOrThrow({where:{userId}});
 const after=integration.gmailLastSync?Math.floor((integration.gmailLastSync.getTime()-86400000)/1000):Math.floor((Date.now()-90*86400000)/1000);
 const query=(integration.gmailLastSync?'after:'+after:'newer_than:90d')+' -in:sent -in:trash {application interview assessment recruitment recruiter opportunity offer shortlisted unsuccessful}';
 const jobs=await db.application.findMany({where:{userId,status:{not:'DISCOVERED'}}});let imported=0;let pageToken=integration.gmailPageToken||'';const started=integration.gmailSyncStartedAt||new Date();
 // Bound each sync to 500 messages. Overlap and a unique provider ID make repeated syncs safe.
 for(let page=0;page<5;page++){
  const list=await gmailRequest(userId,'messages?maxResults=100&q='+encodeURIComponent(query)+(pageToken?'&pageToken='+pageToken:''));
  for(const message of list.messages||[]){
   if(await db.email.findUnique({where:{userId_providerId:{userId,providerId:message.id}}}))continue;
   const m=await gmailRequest(userId,'messages/'+message.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From');
   const header=(name:string)=>m.payload?.headers?.find((h:any)=>h.name.toLowerCase()===name.toLowerCase())?.value||'';
   const sender=header('From');const subject=header('Subject');const text=(subject+' '+(m.snippet||'')).toLowerCase();
   const candidates=jobs.filter(j=>j.gmailMessageId && m.threadId===j.gmailMessageId || j.contactEmail && sender.toLowerCase().includes(j.contactEmail.toLowerCase()) || j.company.length>3&&text.includes(j.company.toLowerCase())&&text.includes(j.title.toLowerCase()));
   const applicationId=candidates.length===1?candidates[0].id:undefined;
   await db.email.create({data:{userId,applicationId,providerId:m.id,threadId:m.threadId,sender,subject,snippet:m.snippet||'',suggestedStatus:classifyEmail(subject,m.snippet||''),receivedAt:new Date(Number(m.internalDate))}});imported++;
   if(applicationId)await notify(userId,'Employer response',subject,'email:'+m.id,'/?view=inbox');
  }
  pageToken=list.nextPageToken||'';if(!pageToken)break;
 }
 // If the cap is reached, keep the previous watermark so a later sync can finish safely.
 await db.integration.update({where:{userId},data:{gmailPageToken:pageToken||null,gmailSyncStartedAt:pageToken?started:null,...(!pageToken?{gmailLastSync:started}:{})}});
 return {imported,moreAvailable:!!pageToken};
}
export async function telegramCall(method:string,body:object){
 if(!config.telegramToken)throw Object.assign(new Error('Set TELEGRAM_BOT_TOKEN in backend/.env first.'),{status:503});
 const response=await fetch('https://api.telegram.org/bot'+config.telegramToken+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await response.json() as any;if(!response.ok||!data.ok)throw new Error('Telegram request failed. Check your bot configuration.');return data.result;
}
export async function pollTelegram(){
 if(!config.telegramToken)return;
 const integration=await db.integration.findFirst();if(!integration)return;
 const updates=await telegramCall('getUpdates',{offset:integration.telegramOffset,timeout:0,allowed_updates:['message']});
 for(const update of updates){const msg=update.message;const code=msg?.text?.match(/^\/start(?:@\w+)?\s+([a-f0-9]+)$/)?.[1];
  if(msg?.chat?.type==='private'&&code){const match=await db.integration.findFirst({where:{telegramPairCode:code,telegramPairExpires:{gt:new Date()}}});if(match){await db.integration.update({where:{id:match.id},data:{telegramChatId:String(msg.chat.id),telegramPairCode:null,telegramPairExpires:null}});await telegramCall('sendMessage',{chat_id:msg.chat.id,text:'Your JobNest account is connected. Application updates will arrive here.'});}}
  await db.integration.update({where:{id:integration.id},data:{telegramOffset:update.update_id+1}});
 }
}
export async function deliverNotifications(){
 const integration=await db.integration.findFirst({where:{telegramChatId:{not:null},telegramEnabled:true}});if(!integration)return;
 const notes=await db.notification.findMany({where:{userId:integration.userId,telegramSentAt:null},orderBy:{createdAt:'asc'},take:10});
 for(const n of notes){await telegramCall('sendMessage',{chat_id:integration.telegramChatId,text:n.title+'\n\n'+n.body+'\n\n'+config.frontend+n.href,link_preview_options:{is_disabled:true}});await db.notification.update({where:{id:n.id},data:{telegramSentAt:new Date()}});}
}
