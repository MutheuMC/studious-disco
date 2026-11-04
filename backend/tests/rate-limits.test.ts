import test from 'node:test';
import assert from 'node:assert/strict';
import express,{type Request} from 'express';
import request from 'supertest';
import { accountRateKey,clientRateKey,configureTrustedProxies,createRateLimiter } from '../src/rate-limits.js';

test('missing peer IPs with IIS headers return usable draft-8 headers and still enforce a limit',async()=>{
 const app=express();
 app.use((req,_res,next)=>{
  Object.defineProperty(req,'ip',{value:undefined});
  // Model an IIS transport with no TCP peer address.
  Object.defineProperty(req.socket,'remoteAddress',{value:undefined,configurable:true});next();
 });
 app.use(createRateLimiter(60000,2));app.get('/',(_req,res)=>res.json({ok:true}));
 const call=()=>request(app).get('/').set('X-Forwarded-For','203.0.113.10').set('Forwarded','for=203.0.113.10;proto=https');
 const first=await call();assert.equal(first.status,200);assert.ok(first.headers.ratelimit);assert.ok(first.headers['ratelimit-policy']);
 assert.equal((await call()).status,200);const blocked=await call();assert.equal(blocked.status,429);assert.ok(blocked.headers['retry-after']);
});
test('authenticated extraction keys use the verified account even when the socket IP is missing',async()=>{
 const app=express();app.use((req,_res,next)=>{Object.defineProperty(req,'ip',{value:undefined});req.userId=req.path==='/'?'owner':'other-owner';next();});
 app.use(createRateLimiter(60000,1,true));app.get('/{*path}',(_req,res)=>res.json({ok:true}));
 assert.equal((await request(app).get('/').set('Forwarded','for=1.2.3.4')).status,200);
 assert.equal((await request(app).get('/').set('Forwarded','for=8.8.8.8')).status,429);
 assert.equal((await request(app).get('/other')).status,200);
});
test('untrusted forwarded headers cannot rotate client rate-limit identities',async()=>{
 const app=express();configureTrustedProxies(app,'');app.use(createRateLimiter(60000,1));app.get('/',(req,res)=>res.json({key:clientRateKey(req)}));
 assert.equal((await request(app).get('/').set('X-Forwarded-For','1.2.3.4')).status,200);
 assert.equal((await request(app).get('/').set('X-Forwarded-For','8.8.8.8').set('Forwarded','for=9.9.9.9')).status,429);
});
test('explicitly trusted proxies resolve X-Forwarded-For but ignore spoofed entries before the nearest untrusted hop',async()=>{
 const app=express();configureTrustedProxies(app,'loopback');app.get('/',(req,res)=>res.json({key:clientRateKey(req)}));
 const response=await request(app).get('/').set('X-Forwarded-For','1.2.3.4, 203.0.113.8');
 assert.equal(response.body.key,'ip:203.0.113.8');
});
test('IPv6 peers share a subnet bucket; missing or invalid peers share a safe fallback',()=>{
 const req=(ip:unknown,peer?:string)=>({ip,socket:{remoteAddress:peer}} as Request);
 assert.equal(clientRateKey(req('2001:db8:abcd:1200::1')),clientRateKey(req('2001:db8:abcd:1200::2')));
 assert.equal(clientRateKey(req(undefined)),'ip:unavailable');
 assert.equal(clientRateKey(req('garbage','127.0.0.1')),'ip:127.0.0.1');
 assert.equal(accountRateKey({...req(undefined),userId:'verified-owner'} as Request),'user:verified-owner');
});
test('proxy configuration rejects blanket trust, hop counts and catch-all subnets',()=>{
 for(const value of ['true','1','0.0.0.0/0','::/0','10.0.0.1/99','loopback/8'])assert.throws(()=>configureTrustedProxies(express(),value),/TRUSTED_PROXY_ADDRESSES/);
 assert.doesNotThrow(()=>configureTrustedProxies(express(),'127.0.0.1,::1,10.20.30.40/32'));
});
