import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { db } from './db.js';
import { withLocationPriority } from './geography.js';

export const opportunityQuery=z.object({
 tab:z.enum(['NEW','EMAIL','PORTAL','REVIEW','APPLIED']).default('NEW'),
 search:z.string().trim().max(500).default(''),
 page:z.coerce.number().int().min(1).max(1000000).default(1),
 pageSize:z.coerce.number().int().min(1).max(100).default(20)
});
export async function listOpportunities(userId:string,input:z.infer<typeof opportunityQuery>){
 const filters:Record<typeof input.tab,Prisma.ApplicationWhereInput>={
  NEW:{status:'DISCOVERED'},
  EMAIL:{method:'EMAIL',sendState:'IDLE',status:{notIn:['APPLIED','REJECTED','WITHDRAWN']}},
  PORTAL:{method:'PORTAL',sendState:'IDLE',status:{notIn:['APPLIED','REJECTED','WITHDRAWN']}},
  REVIEW:{OR:[{automationState:'NEEDS_REVIEW'},{sendState:{in:['UNKNOWN','SENDING']}}]},
  APPLIED:{OR:[{sendState:'SENT'},{appliedAt:{not:null}}]}
 };
 const where:Prisma.ApplicationWhereInput={userId,AND:[filters[input.tab],...(input.search?[{OR:['title','company','location'].map(field=>({[field]:{contains:input.search,mode:'insensitive'}}))}]:[])]};
 const [candidates,profile]=await Promise.all([
  // Geography uses shared country/city rules. Sort lightweight metadata globally
  // before selecting a page, so local jobs do not disappear behind page boundaries.
  db.application.findMany({where,select:{id:true,location:true,matchScore:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}]}),
  db.profile.findUniqueOrThrow({where:{userId}})
 ]);
 // Use the original added date: editing or reassessing a job must not make it new.
 const ordered=withLocationPriority(candidates,profile).sort((a,b)=>a.locationPriority-b.locationPriority||b.createdAt.getTime()-a.createdAt.getTime()||(b.matchScore??-1)-(a.matchScore??-1));
 const total=ordered.length,totalPages=Math.max(1,Math.ceil(total/input.pageSize)),page=Math.min(input.page,totalPages);
 const selected=ordered.slice((page-1)*input.pageSize,page*input.pageSize);
 const jobs=await db.application.findMany({where:{userId,id:{in:selected.map(job=>job.id)}},select:{id:true,title:true,company:true,location:true,matchScore:true,discoverySource:true,status:true,createdAt:true}});
 const byId=new Map(jobs.map(job=>[job.id,job]));
 const items=selected.flatMap(job=>{const row=byId.get(job.id);return row?[{...row,locationPriority:job.locationPriority}]:[];});
 return {items,total,page,pageSize:input.pageSize,totalPages,hasPrevious:page>1,hasNext:page<totalPages};
}
