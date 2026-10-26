import { db } from './db.js';
export async function activity(userId:string,message:string,applicationId?:string){ return db.activity.create({data:{userId,message,applicationId}}); }
export async function notify(userId:string,title:string,body:string,dedupeKey:string,href='/') {
 return db.notification.upsert({where:{userId_dedupeKey:{userId,dedupeKey}},create:{userId,title,body,dedupeKey,href},update:{}});
}
export async function enqueue(userId:string,kind:string,payload:object,dedupeKey:string) {
 return db.task.upsert({where:{dedupeKey},create:{userId,kind,payload,dedupeKey},update:{}});
}
