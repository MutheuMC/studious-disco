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
   const country=(value:any)=>typeof value==='string'?value:value?.name||value?.['@id']||'';
   const places=locs.map((l:any)=>[l?.address?.addressLocality,country(l?.address?.addressCountry)].filter(Boolean).join(', ')).filter(Boolean).join(' / ');
   const restrictions=(Array.isArray(obj.applicantLocationRequirements)?obj.applicantLocationRequirements:[obj.applicantLocationRequirements]).map((place:any)=>country(place)).filter(Boolean).join(' / ');
   const location=(obj.jobLocationType==='TELECOMMUTE'?'Remote: '+(restrictions||places||'Eligibility not specified'):places).slice(0,200);
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
export const regionalBoards=[
 {name:'JobWeb Kenya',url:'https://jobwebkenya.com/',country:'Kenya'},
 {name:'MyJobMag Kenya',url:'https://www.myjobmag.co.ke/',country:'Kenya'},
 {name:'JobWeb Uganda',url:'https://jobwebuganda.com/',country:'Uganda'},
 {name:'JobWeb Tanzania',url:'https://jobwebtanzania.com/',country:'Tanzania'}
];
export function boardSearchUrls(raw:string,roles:string[]):string[]{
 const url=new URL(raw);const host=url.hostname.replace(/^www\./,'');
 // Only query endpoints that these boards actually expose. Generic sites are read as supplied.
 if(url.pathname!=='/')return [url.href];
 const focus=[...new Set(roles.map(role=>role.trim()).filter(Boolean))].slice(0,2);
 if(!focus.length)return [url.href];
 if(['jobwebkenya.com','jobwebuganda.com','jobwebtanzania.com'].includes(host))return focus.map(role=>{const search=new URL(url);search.searchParams.set('s',role);search.searchParams.set('ptype','job_listing');return search.href;});
 if(host==='myjobmag.co.ke')return focus.map(role=>{const search=new URL('/search/jobs',url);search.searchParams.set('q',role);return search.href;});
 return [url.href];
}
export function extractJobLinks(html:string,sourceUrl:string,roles:string[]=[]){
 const $=cheerio.load(html);const origin=new URL(sourceUrl).origin;const links=new Map<string,string>();
 $('a[href]').each((_i,element)=>{
  try{
   const url=new URL($(element).attr('href')!,sourceUrl);
   if(url.origin!==origin||!/\/(?:jobs?|vacanc(?:y|ies))\/[^/]+/.test(url.pathname)||/\/(?:page|category|tag)\//.test(url.pathname))return;
   const normalized=normalizeUrl(url.href);const title=plain($(element).text());
   if(!links.has(normalized)||title.length>(links.get(normalized)?.length||0))links.set(normalized,title);
  }catch{/* Ignore malformed and external navigation links. */}
 });
 const terms=roles.join(' ').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
 const relevance=(title:string)=>terms.reduce((sum,term)=>sum+(title.toLowerCase().includes(term)?1:0),0);
 return [...links].sort((a,b)=>relevance(b[1])-relevance(a[1])).map(([url])=>url);
}
export async function readJobSource(sourceUrl:string,roles:string[]=[],read:(url:string)=>Promise<string>=(url)=>readPublicPage(url)){
 const warnings:string[]=[];const listings=new Map<string,Listing>();const links=new Set<string>();const visited=new Set<string>();
 let pagesRead=0;
 const collect=async(url:string)=>{
  const html=await read(url);pagesRead++;visited.add(normalizeUrl(url));
  for(const listing of parseListings(html,url)){listings.set(listing.url,listing);if(listing.company==='Employer not listed'&&new URL(listing.url).origin===new URL(sourceUrl).origin)links.add(listing.url);}
  for(const link of extractJobLinks(html,url,roles))links.add(link);
  return html;
 };
 const seeds=boardSearchUrls(sourceUrl,roles);
 let readable=false;
 for(const url of seeds){try{const html=await collect(url);readable=true;
   // Follow one same-site pagination link, preserving the board's query.
   const $=cheerio.load(html);const next=$('a[href]').toArray().find(el=>$(el).attr('rel')==='next'||/^(?:next(?: page)?\s*[»›>]?|[»›>])$/i.test($(el).text().trim()));
   if(next){const nextUrl=new URL($(next).attr('href')||'',url);if(nextUrl.origin===new URL(sourceUrl).origin&&!visited.has(normalizeUrl(nextUrl.href)))try{await collect(nextUrl.href);}catch(error){warnings.push('Next page: '+(error as Error).message);}}
  }catch(error){warnings.push((error as Error).message);}}
 if(!links.size&&!listings.size&&!seeds.includes(new URL(sourceUrl).href))try{await collect(sourceUrl);readable=true;}catch(error){warnings.push((error as Error).message);}
 if(!readable)throw new Error(warnings.join('; ')||'Website could not be read.');
 const details=[...links].filter(url=>!visited.has(url)&&(!listings.has(url)||listings.get(url)!.company==='Employer not listed')).slice(0,16);
 let cursor=0,failed=0,unreadable=0;
 // Bound both network concurrency and the number of detail pages per source.
 await Promise.all(Array.from({length:Math.min(3,details.length)},async()=>{
  while(cursor<details.length){const url=details[cursor++];try{
   const jobs=parseListings(await read(url),url);pagesRead++;
   if(!jobs.length)unreadable++;
   for(const job of jobs)listings.set(job.url,job);
  }catch{failed++;}}
 }));
 if(failed)warnings.push(failed+' job detail pages could not be reached.');
 if(unreadable)warnings.push(unreadable+' job detail pages did not expose readable job data.');
 if(!listings.size)warnings.push('No readable job listings found; this is a source extraction or coverage issue, not proof that no jobs exist.');
 return {listings:[...listings.values()],warnings,pagesRead,linksFound:links.size};
}
export async function saveListing(userId:string,listing:Listing,sourceName?:string){
 const key=dedupeKey(listing.company,listing.title,listing.location,listing.url);
 const existing=await db.application.findUnique({where:{userId_dedupeKey:{userId,dedupeKey:key}}});if(existing)return false;
 await db.application.create({data:{userId,...listing,dedupeKey:key,status:'DISCOVERED',discoverySource:sourceName}});return true;
}
export async function checkSource(userId:string,sourceId:string,read?:(url:string)=>Promise<string>){
 const source=await db.source.findFirstOrThrow({where:{id:sourceId,userId}});
 try{
  const profile=await db.profile.findUniqueOrThrow({where:{userId}});
  const {listings,warnings}=await readJobSource(source.url,profile.roles.split(/[,;\n]/).filter(Boolean),read);
  // Share matching and geographic policy with discovery, including scheduled checks.
  const {shortlist}=await import('./discovery.js');
  const matching=shortlist(listings.map(listing=>({listing,source:source.name,remote:/\bremote\b/i.test(listing.location)?true:null})),profile,{roles:[profile.roles||profile.headline],keywords:[profile.skills,profile.education]},'');let added=0;
  for(const {listing} of matching)if(await saveListing(userId,listing,source.name))added++;
  const error=warnings.join('; ')||null;
  await db.source.update({where:{id:source.id},data:{lastCheckedAt:new Date(),nextCheckAt:new Date(Date.now()+source.frequencyHours*3600000),lastError:error,jobsFound:{increment:added}}});
  await activity(userId,'Checked '+source.name+': '+added+' new opportunities.');
  if(added)await notify(userId,'New opportunities found',source.name+' has '+added+' new job listings.','source:'+source.id+':'+Date.now(),'/?view=opportunities');
  return {added,found:listings.length,message:error};
 }catch(error){await db.source.update({where:{id:sourceId},data:{lastCheckedAt:new Date(),lastError:(error as Error).message}});throw error;}
}
