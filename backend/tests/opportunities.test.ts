import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db.js';
import { hashToken } from '../src/security.js';

const app=createApp();let userId='',otherId='';
const cookie='jobnest_session=pagination-test-session';
const get=(path:string)=>request(app).get('/api'+path).set('Cookie',cookie);
before(async()=>{
 if(!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))throw new Error('Tests require a dedicated *_test database.');
 await db.user.deleteMany();
 const user=await db.user.create({data:{name:'Pagination',email:'pagination@example.com',profile:{create:{location:'Nairobi, Kenya',countries:'Worldwide'}}}});userId=user.id;
 const other=await db.user.create({data:{ownerKey:'other',name:'Other',email:'other@example.com',profile:{create:{}}}});otherId=other.id;
 await db.session.create({data:{userId,tokenHash:hashToken('pagination-test-session'),expiresAt:new Date(Date.now()+3600000)}});
 await db.application.createMany({data:Array.from({length:45},(_,index)=>({id:'pagination-'+String(index).padStart(2,'0'),userId,dedupeKey:'job-'+index,title:'Engineer '+index,company:'Example',status:'DISCOVERED',location:index===44?'Nairobi, Kenya':'Berlin, Germany',matchScore:index===44?40:90,description:'Large job description',updatedAt:new Date('2026-01-01')}))});
 await db.application.create({data:{userId:otherId,dedupeKey:'other',title:'Hidden',company:'Private',status:'DISCOVERED'}});
});
after(async()=>{await db.user.deleteMany();await db.$disconnect();});

test('opportunities require authentication',async()=>{
 assert.equal((await request(app).get('/api/opportunities')).status,401);
});
test('pages have stable ordering, global location priority, totals, and no duplicate jobs',async()=>{
 const first=await get('/opportunities');assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.items.length,20);assert.equal(first.body.total,45);assert.equal(first.body.totalPages,3);
 assert.equal(first.body.items[0].id,'pagination-44');assert.equal(first.body.items[0].locationPriority,0);
 assert.equal(first.body.hasPrevious,false);assert.equal(first.body.hasNext,true);
 assert.equal(first.body.items[0].description,undefined);
 assert.deepEqual((await get('/opportunities')).body.items,first.body.items);
 const second=(await get('/opportunities?page=2')).body,third=(await get('/opportunities?page=3')).body;
 assert.equal(second.items.length,20);assert.equal(third.items.length,5);assert.equal(third.hasNext,false);assert.equal(third.hasPrevious,true);
 assert.equal(new Set([...first.body.items,...second.items,...third.items].map(row=>row.id)).size,45);
 const beyond=(await get('/opportunities?page=99')).body;assert.equal(beyond.page,3);assert.deepEqual(beyond.items,third.items);
});
test('search is case insensitive and filters before paging; empty results are valid',async()=>{
 const result=await get('/opportunities?search=ENGINEER%204&pageSize=3');
 assert.equal(result.status,200);assert.equal(result.body.total,6);assert.equal(result.body.items.length,3);assert.equal(result.body.items[0].id,'pagination-44');
 assert.equal((await get('/opportunities?search=nairobi')).body.total,1);
 const empty=(await get('/opportunities?search=missing&page=5')).body;
 assert.equal(empty.total,0);assert.equal(empty.page,1);assert.equal(empty.totalPages,1);assert.deepEqual(empty.items,[]);assert.equal(empty.hasNext,false);
});
test('invalid pagination parameters are rejected',async()=>{
 for(const query of ['page=0','page=-1','page=1.5','page=bad','pageSize=0','pageSize=101','tab=INVALID','page=1&page=2'])assert.equal((await get('/opportunities?'+query)).status,400,query);
});
test('jobs sort by location, original added date, then score across page boundaries',async()=>{
 const rows=[
  {id:'date-order-old',location:'Nairobi, Kenya',createdAt:new Date('2026-01-01'),matchScore:100},
  {id:'date-order-low',location:'Nairobi, Kenya',createdAt:new Date('2026-02-01'),matchScore:40},
  {id:'date-order-high-a',location:'Nairobi, Kenya',createdAt:new Date('2026-02-01'),matchScore:90},
  {id:'date-order-high-b',location:'Nairobi, Kenya',createdAt:new Date('2026-02-01'),matchScore:90},
  {id:'date-order-unscored',location:'Nairobi, Kenya',createdAt:new Date('2026-02-01'),matchScore:null},
  {id:'date-order-foreign',location:'Berlin, Germany',createdAt:new Date('2026-03-01'),matchScore:100}
 ];
 await db.application.createMany({data:rows.map(row=>({...row,userId,dedupeKey:row.id,title:'Date ordering fixture',company:'Example',status:'DISCOVERED'}))});
 try{
  const expected=['date-order-high-a','date-order-high-b','date-order-low','date-order-unscored','date-order-old','date-order-foreign'];
  const readPages=async()=>{
   const ids:string[]=[];
   for(let page=1;page<=3;page++){
    const response=await get('/opportunities?search=Date%20ordering%20fixture&pageSize=2&page='+page);
    assert.equal(response.status,200);assert.equal(response.body.total,6);
    ids.push(...response.body.items.map((row:{id:string})=>row.id));
   }
   return ids;
  };
  assert.deepEqual(await readPages(),expected);
  await db.application.update({where:{id:'date-order-old'},data:{notes:'Edited after newer jobs were added',matchReason:'Reassessed today'}});
  assert.deepEqual(await readPages(),expected);
 }finally{await db.application.deleteMany({where:{userId,id:{in:rows.map(row=>row.id)}}});}
});
test('all action tabs retain their filters and personal workspace loads omit discovered jobs',async()=>{
 await db.application.createMany({data:[
  {userId,dedupeKey:'email',title:'Email job',company:'Example',method:'EMAIL',status:'READY'},
  {userId,dedupeKey:'portal',title:'Portal job',company:'Example',method:'PORTAL',status:'SAVED'},
  {userId,dedupeKey:'review',title:'Review job',company:'Example',method:'EMAIL',status:'READY',sendState:'UNKNOWN'},
  {userId,dedupeKey:'sent',title:'Sent job',company:'Example',method:'EMAIL',status:'APPLIED',sendState:'SENT',appliedAt:new Date()}
 ]});
 assert.deepEqual((await get('/opportunities?tab=EMAIL')).body.items.map(row=>row.title),['Email job']);
 assert.equal((await get('/opportunities?tab=PORTAL')).body.total,46);
 assert.deepEqual((await get('/opportunities?tab=REVIEW')).body.items.map(row=>row.title),['Review job']);
 assert.deepEqual((await get('/opportunities?tab=APPLIED')).body.items.map(row=>row.title),['Sent job']);
 const personal=await get('/applications?scope=personal');assert.equal(personal.body.length,4);
 assert.ok(personal.body.every(row=>row.status!=='DISCOVERED'));
 assert.equal((await get('/dashboard?scope=personal')).body.applications.length,4);
 const options=(await get('/applications?scope=options')).body;assert.equal(options.length,49);assert.deepEqual(Object.keys(options[0]).sort(),['company','id','title']);
});
test('search progress can be fetched without loading job results',async()=>{
 const task=await db.task.create({data:{userId,kind:'SEARCH',status:'COMPLETE',payload:{},dedupeKey:'pagination-search'}});
 const response=await get('/searches/'+task.id+'?includeApplications=false');
 assert.equal(response.status,200);assert.equal(response.body.id,task.id);assert.equal(response.body.applications,undefined);
});
