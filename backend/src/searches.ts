import { randomUUID } from 'node:crypto';
import type { Task } from '@prisma/client';
import { db } from './db.js';
import { discover } from './discovery.js';
import { settingsFor } from './automation.js';
import { enqueue } from './events.js';

export type SearchExecutor=typeof discover;
export async function executeSearch(task:Task,executor:SearchExecutor=discover) {
 const payload=task.payload as {query?:string;trigger?:string};
 await settingsFor(task.userId);
 if(payload.trigger==='scheduled'&&!(await settingsFor(task.userId)).searchEnabled) {
  await db.task.update({where:{id:task.id},data:{status:'COMPLETE',progress:'Scheduled search skipped while paused.',lockedAt:null}});return;
 }
 try {
  const result=await executor(task.userId,payload.query||'',undefined,{progress:async progress=>{
   await db.task.update({where:{id:task.id},data:{progress,lockedAt:new Date()}});
  }});
  for(const id of result.applicationIds)await enqueue(task.userId,'APPLICATION',{applicationId:id},'prepare:'+task.id+':'+id);
  await db.$transaction([
   db.task.update({where:{id:task.id},data:{status:'COMPLETE',progress:'Search complete. Application preparation continues in the worker.',result,error:null,lockedAt:null}}),
   db.automationSettings.update({where:{userId:task.userId},data:{lastSearchAt:new Date(),lastSearchAdded:result.added,lastSearchError:null,lastSearchWarnings:result.warnings.join('\n')||null}})
  ]);
 }catch(error) {
  const message=(error as Error).message;
  await db.$transaction([
   db.task.update({where:{id:task.id},data:{status:'FAILED',progress:'Search failed. You can retry now.',error:message,lockedAt:null}}),
   db.automationSettings.update({where:{userId:task.userId},data:{lastSearchAt:new Date(),lastSearchError:message}})
  ]);
 }
}
export async function startSearchNow(userId:string,query:string,executor:SearchExecutor=discover) {
 const {task,created}=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const active=await tx.task.findFirst({where:{userId,kind:'SEARCH',status:'RUNNING',lockedAt:{gte:new Date(Date.now()-10*60000)}}});
  if(active)return {task:active,created:false};
  const task=await tx.task.create({data:{userId,kind:'SEARCH',payload:{query,trigger:'manual'},dedupeKey:'search-now:'+randomUUID(),status:'RUNNING',lockedAt:new Date(),attempts:1,progress:'Starting search now…'}});
  return {task,created:true};
 });
 // Work starts in the API process immediately; it does not wait for the worker's schedule.
 if(created)void executeSearch(task,executor).catch(error=>console.error('Search persistence:',(error as Error).message));
 return task;
}
