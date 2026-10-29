import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import * as cheerio from 'cheerio';
import { db } from './db.js';
import { normalizeUrl, dedupeKey } from './validation.js';
import { activity,notify } from './events.js';
export function isPublicAddress(ip:string):boolean {
 if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||a===198);}
 // Only global-unicast IPv6. Excludes mapped IPv4, loopback, private, link-local and multicast.
 return isIP(ip)===6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:(db8|0):/i.test(ip);
}
export async function readPublicPage(raw:string,redirects=0,maxBytes=2*1024*1024):Promise<string>{
 const url=new URL(normalizeUrl(raw)); if(url.port && !['80','443'].includes(url.port))throw new Error('Only standard HTTP/HTTPS ports are supported.');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=await lookup(host,{all:true}); if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('This address is not a public website.');
 const address=addresses[0];
 return new Promise((resolve,reject)=>{
  const send=url.protocol==='https:'?httpsRequest:httpRequest;
  const req=send(url,{headers:{'User-Agent':'JobNest/1.0 (personal job tracker)','Accept':'text/html,application/xml,application/rss+xml,application/json'},lookup:((_hostname:unknown,options:any,cb:any)=>options.all?cb(null,[address]):cb(null,address.address,address.family)) as any},res=>{
   if(res.statusCode && res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();if(redirects>=4){reject(new Error('Too many redirects.'));return;}resolve(readPublicPage(new URL(res.headers.location,url).href,redirects+1,maxBytes));return;}
   if(res.statusCode!==200){res.resume();reject(new Error('Website returned HTTP '+res.statusCode+'. You can paste a job description instead.'));return;}
   let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(new Error('Website response is too large.'));}else chunks.push(chunk);});
   res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',reject);
  });req.setTimeout(15000,()=>req.destroy(new Error('Website timed out.')));req.on('error',reject);req.end();
 });
}
export type Listing={title:string;company:string;location:string;url:string;description:string;deadline?:Date;method:'EMAIL'|'PORTAL';contactEmail:string};
const plain=(value:unknown)=>cheerio.load(String(value||'')).text().replace(/\s+/g,' ').trim();
export function parseListings(html:string,sourceUrl:string):Listing[]{
 const $=cheerio.load(html); const results:Listing[]=[];
 const visit=(obj:any)=>{
  if(!obj||typeof obj!=='object')return; if(Array.isArray(obj)){obj.forEach(visit);return;}
  const types=Array.isArray(obj['@type'])?obj['@type']:[obj['@type']];
  if(types.includes('JobPosting')&&obj.title){
   const locs=Array.isArray(obj.jobLocation)?obj.jobLocation:[obj.jobLocation];
   const location=locs.map((l:any)=>[l?.address?.addressLocality,l?.address?.addressCountry].filter(Boolean).join(', ')).filter(Boolean).join(' / ') || (obj.jobLocationType==='TELECOMMUTE'?'Remote':'');
   let url=sourceUrl;try{url=normalizeUrl(new URL(obj.url||sourceUrl,sourceUrl).href);}catch{}
   const deadline=obj.validThrough?new Date(obj.validThrough):undefined;
   const contact=typeof obj.applicationContact?.email==='string'?obj.applicationContact.email:'';
   results.push({title:plain(obj.title).slice(0,200),company:plain(obj.hiringOrganization?.name||'Employer not listed').slice(0,200),location,url,description:plain(obj.description).slice(0,40000),deadline:deadline&&!isNaN(deadline.getTime())?deadline:undefined,method:contact?'EMAIL':'PORTAL',contactEmail:contact});
  }
  for(const [key,value] of Object.entries(obj))if(key!=='description' && value && typeof value==='object')visit(value);
 };
 $('script[type="application/ld+json"]').each((_i,el)=>{try{visit(JSON.parse($(el).text()));}catch{}});
 if(!results.length){const xml=cheerio.load(html,{xmlMode:true});xml('item, entry').each((_i,el)=>{
   const title=xml(el).find('title').first().text();const link=xml(el).find('link').first();const raw=link.attr('href')||link.text(); if(!title||!raw)return;
   try{results.push({title:plain(title).slice(0,200),company:'Employer not listed',location:'',url:normalizeUrl(new URL(raw,sourceUrl).href),description:plain(xml(el).find('description, summary, content').first().text()).slice(0,40000),method:'PORTAL',contactEmail:''});}catch{}
 });}
 return [...new Map(results.map(v=>[v.url,v])).values()].slice(0,100);
}
export async function saveListing(userId:string,listing:Listing){
 const key=dedupeKey(listing.company,listing.title,listing.location,listing.url);
 const existing=await db.application.findUnique({where:{userId_dedupeKey:{userId,dedupeKey:key}}});if(existing)return false;
 await db.application.create({data:{userId,...listing,dedupeKey:key,status:'DISCOVERED'}});return true;
}
export async function checkSource(userId:string,sourceId:string){
 const source=await db.source.findFirstOrThrow({where:{id:sourceId,userId}});
 try{
  const html=await readPublicPage(source.url);const listings=parseListings(html,source.url);let added=0;
  for(const listing of listings)if(!listing.deadline||listing.deadline>new Date())if(await saveListing(userId,listing))added++;
  const error=listings.length?null:'No readable job listings found. This source may need a login or a custom reader. Paste individual job descriptions to continue.';
  await db.source.update({where:{id:source.id},data:{lastCheckedAt:new Date(),nextCheckAt:new Date(Date.now()+source.frequencyHours*3600000),lastError:error,jobsFound:{increment:added}}});
  await activity(userId,'Checked '+source.name+': '+added+' new opportunities.');
  if(added)await notify(userId,'New opportunities found',source.name+' has '+added+' new job listings.','source:'+source.id+':'+Date.now(),'/?view=opportunities');
  return {added,found:listings.length,message:error};
 }catch(error){await db.source.update({where:{id:sourceId},data:{lastCheckedAt:new Date(),lastError:(error as Error).message}});throw error;}
}
