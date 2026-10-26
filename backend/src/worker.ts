import './config.js';
import { db } from './db.js';
import { enqueue,notify } from './events.js';
import { checkSource,saveListing } from './sources.js';
import { syncGmail,pollTelegram,deliverNotifications } from './integrations.js';
import { config } from './config.js';
export async function discover(userId:string,query:string){
 if(!config.searchKey)throw new Error('Set BRAVE_SEARCH_API_KEY to enable broad web discovery. Saved sources work without it.');
 const response=await fetch('https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent(query+' jobs hiring')+'&count=15',{headers:{'X-Subscription-Token':config.searchKey,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Search provider failed ('+response.status+').');const data=await response.json() as any;let added=0;
 for(const item of data.web?.results||[]){if(await saveListing(userId,{title:String(item.title).slice(0,200),company:'Employer not verified',location:'',url:item.url,description:item.description||'',method:'PORTAL',contactEmail:''}))added++;}
 await notify(userId,'Search complete',added+' new search results to review. Verify employer and requirements on the original listing.','search:'+Date.now(),'/?view=opportunities');return {added};
}
export async function schedule(){
 const sources=await db.source.findMany({where:{enabled:true,nextCheckAt:{lte:new Date()}}});
 for(const s of sources){await enqueue(s.userId,'SOURCE',{sourceId:s.id},'source:'+s.id+':'+s.nextCheckAt.toISOString());await db.source.update({where:{id:s.id},data:{nextCheckAt:new Date(Date.now()+s.frequencyHours*3600000)}});}
 if(config.searchKey){const profiles=await db.profile.findMany({where:{roles:{not:''}}});for(const p of profiles){const query=[p.roles,p.remoteOnly?'remote':'',p.countries].filter(Boolean).join(' ');await enqueue(p.userId,'SEARCH',{query},'daily-search:'+p.userId+':'+new Date().toISOString().slice(0,10));}}
 const integrations=await db.integration.findMany({where:{gmailTokens:{not:null}}});
 for(const i of integrations)await enqueue(i.userId,'GMAIL',{},'gmail:'+i.userId+':'+Math.floor(Date.now()/900000));
 const deadlines=await db.application.findMany({where:{deadline:{gte:new Date(),lte:new Date(Date.now()+2*86400000)},status:{in:['SAVED','PREPARING','READY']}}});
 for(const j of deadlines)await notify(j.userId,'Application deadline approaching',j.title+' at '+j.company+' is due '+j.deadline!.toLocaleDateString('en-GB',{timeZone:'UTC'}), 'deadline:'+j.id+':'+j.deadline!.toISOString(),'/?view=applications');
 await db.session.deleteMany({where:{expiresAt:{lt:new Date()}}});
}
export async function runNextTask(){
 // Reclaim abandoned leases; side effects use deduplication keys.
 await db.task.updateMany({where:{status:'RUNNING',lockedAt:{lt:new Date(Date.now()-10*60000)}},data:{status:'PENDING',lockedAt:null}});
 const task=await db.$transaction(async tx=>{const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Task" WHERE status = 'PENDING' AND "availableAt" <= NOW() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;if(!rows[0])return null;return tx.task.update({where:{id:rows[0].id},data:{status:'RUNNING',lockedAt:new Date(),attempts:{increment:1}}});});
 if(!task)return false;
 try{const payload=task.payload as any;if(task.kind==='SOURCE')await checkSource(task.userId,payload.sourceId);else if(task.kind==='GMAIL')await syncGmail(task.userId);else if(task.kind==='SEARCH')await discover(task.userId,payload.query);else throw new Error('Unknown task type.');
 await db.task.update({where:{id:task.id},data:{status:'COMPLETE',error:null,lockedAt:null}});
 }catch(error){await db.task.update({where:{id:task.id},data:{status:task.attempts>=3?'FAILED':'PENDING',lockedAt:null,error:(error as Error).message,availableAt:new Date(Date.now()+task.attempts*60000)}});}
 return true;
}
let stopped=false;
export async function startWorker(){
 console.log('JobNest worker started.');while(!stopped){try{await schedule();await pollTelegram();await deliverNotifications();while(await runNextTask()){} }catch(error){console.error('Worker:',(error as Error).message);}await new Promise(resolve=>setTimeout(resolve,15000));}
 await db.$disconnect();
}
if(process.argv[1]?.replace(/\\/g,'/').match(/worker\.(ts|js)$/)){process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});void startWorker();}
