import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

const app=createApp();
after(async()=>{await db.$disconnect();});
test('account deletion requires authentication, confirmation, and matching email, then removes records and sessions',async()=>{
 if(!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))throw new Error('Dedicated test database required.');
 await db.user.deleteMany();
 const anonymous=await request(app).delete('/api/me').set('Origin',config.frontend).send({confirmation:'DELETE',email:'owner@example.com'});
 assert.equal(anonymous.status,401);
 const registration=await request(app).post('/api/auth/register').set('Origin',config.frontend).send({name:'Test Owner',email:'owner@example.com',password:'long-test-password'});
 assert.equal(registration.status,201);
 const cookie=String(registration.headers['set-cookie'][0]).split(';')[0];
 const id=registration.body.id;
 await db.document.create({data:{userId:id,name:'Private CV',content:'Private data'}});
 for(const body of [{email:'owner@example.com'},{confirmation:'DELETE',email:'wrong@example.com'}]){
  const response=await request(app).delete('/api/me').set('Origin',config.frontend).set('Cookie',cookie).send(body);
  assert.equal(response.status,400);
  assert.equal(await db.user.count(),1);
 }
 const deleted=await request(app).delete('/api/me').set('Origin',config.frontend).set('Cookie',cookie).send({confirmation:'DELETE',email:'owner@example.com'});
 assert.equal(deleted.status,200);
 for(const count of [await db.user.count(),await db.session.count(),await db.profile.count(),await db.integration.count(),await db.document.count()])assert.equal(count,0);
 assert.equal((await request(app).get('/api/me').set('Cookie',cookie)).status,401);
 assert.equal((await request(app).get('/api/auth/config')).body.registered,false);
});
