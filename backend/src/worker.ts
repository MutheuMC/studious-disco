import './config.js';
import { db } from './db.js';
import { enqueue,notify } from './events.js';
import { checkSource } from './sources.js';
import { syncGmail,pollTelegram,deliverNotifications } from './integrations.js';
export { discover } from './discovery.js';
import { executeSearch } from './searches.js';
import { settingsFor,prepareOpportunity } from './automation.js';
export async function schedule(){
 const sources=await db.source.findMany({where:{enabled:true,nextCheckAt:{lte:new Date()}}});
 for(const s of sources){if(!(await settingsFor(s.userId)).searchEnabled)continue;await enqueue(s.userId,'SOURCE',{sourceId:s.id,trigger:'scheduled'},'source:'+s.id+':'+s.nextCheckAt.toISOString());await db.source.update({where:{id:s.id},data:{nextCheckAt:new Date(Date.now()+s.frequencyHours*3600000)}});}
 const profiles=await db.profile.findMany({where:{OR:['roles','headline','skills','summary','experience','education'].map(field=>({[field]:{not:''}}))}});
 for(const profile of profiles){
  await settingsFor(profile.userId);
  await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${profile.userId}))`;
   const settings=await tx.automationSettings.findUniqueOrThrow({where:{userId:profile.userId}});
   if(!settings.searchEnabled||settings.nextSearchAt>new Date())return;
   const active=await tx.task.findFirst({where:{userId:profile.userId,kind:'SEARCH',status:{in:['PENDING','RUNNING']}}});
   if(active)return;
   await tx.task.create({data:{userId:profile.userId,kind:'SEARCH',payload:{query:'',trigger:'scheduled'},dedupeKey:'scheduled-search:'+profile.userId+':'+settings.nextSearchAt.toISOString()}});
   await tx.automationSettings.update({where:{userId:profile.userId},data:{nextSearchAt:new Date(Date.now()+settings.searchIntervalHours*3600000)}});
  });
 }
 const integrations=await db.integration.findMany({where:{gmailTokens:{not:null}}});
 for(const i of integrations)await enqueue(i.userId,'GMAIL',{},'gmail:'+i.userId+':'+Math.floor(Date.now()/900000));
 const deadlines=await db.application.findMany({where:{deadline:{gte:new Date(),lte:new Date(Date.now()+2*86400000)},status:{in:['SAVED','PREPARING','READY']}}});
 for(const j of deadlines)await notify(j.userId,'Application deadline approaching',j.title+' at '+j.company+' is due '+j.deadline!.toLocaleDateString('en-GB',{timeZone:'UTC'}), 'deadline:'+j.id+':'+j.deadline!.toISOString(),'/?view=applications');
 await db.session.deleteMany({where:{expiresAt:{lt:new Date()}}});
}
export async function runNextTask(){
 // Reclaim abandoned leases; side effects use deduplication keys.
 await db.task.updateMany({where:{status:'RUNNING',lockedAt:{lt:new Date(Date.now()-10*60000)}},data:{status:'PENDING',lockedAt:null}});
 const task=await db.$transaction(async tx=>{const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Task" WHERE status = 'PENDING' AND "availableAt" <= NOW() AND NOT (kind = 'SEARCH' AND EXISTS (SELECT 1 FROM "Task" AS running WHERE running."userId" = "Task"."userId" AND running.kind = 'SEARCH' AND running.status = 'RUNNING')) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;if(!rows[0])return null;const selected=await tx.task.findUniqueOrThrow({where:{id:rows[0].id}});if(selected.kind==='SEARCH'){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${selected.userId}))`;if(await tx.task.findFirst({where:{userId:selected.userId,kind:'SEARCH',status:'RUNNING'}}))return null;}return tx.task.update({where:{id:rows[0].id},data:{status:'RUNNING',lockedAt:new Date(),attempts:{increment:1}}});});
 if(!task)return false;
 try{const payload=task.payload as any;if(task.kind==='SOURCE'){if(payload.trigger!=='scheduled'||(await settingsFor(task.userId)).searchEnabled)await checkSource(task.userId,payload.sourceId);}else if(task.kind==='GMAIL')await syncGmail(task.userId);else if(task.kind==='SEARCH'){await executeSearch(task);return true;}else if(task.kind==='APPLICATION')await prepareOpportunity(task.userId,payload.applicationId);else throw new Error('Unknown task type.');
 await db.task.update({where:{id:task.id},data:{status:'COMPLETE',error:null,lockedAt:null}});
 }catch(error){await db.task.update({where:{id:task.id},data:{status:task.attempts>=3?'FAILED':'PENDING',lockedAt:null,error:(error as Error).message,availableAt:new Date(Date.now()+task.attempts*60000)}});}
 return true;
}
let stopped=false;
export async function startWorker(){
 const heartbeat=()=>db.automationSettings.updateMany({data:{workerLastSeenAt:new Date()}}).catch(error=>console.error('Heartbeat:',(error as Error).message));
 await heartbeat();const timer=setInterval(()=>{void heartbeat();},30000);
 console.log('JobNest worker started.');while(!stopped){try{await schedule();for(const work of [pollTelegram,deliverNotifications]){try{await work();}catch(error){console.error('Telegram:',(error as Error).message);}}while(!stopped&&await runNextTask()){} }catch(error){console.error('Worker:',(error as Error).message);}await new Promise(resolve=>setTimeout(resolve,15000));}
 clearInterval(timer);await db.$disconnect();
}
if(process.argv[1]?.replace(/\\/g,'/').match(/worker\.(ts|js)$/)){process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});void startWorker();}
