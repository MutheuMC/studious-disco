import { z } from 'zod';
export const statuses=['DISCOVERED','SAVED','PREPARING','READY','APPLIED','ASSESSMENT','INTERVIEW','OFFER','REJECTED','WITHDRAWN'] as const;
export function normalizeUrl(raw:string) {
 const u=new URL(raw); if(!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('Use a public HTTP or HTTPS URL without credentials.');
 u.hash=''; for(const key of [...u.searchParams.keys()]) if(key.startsWith('utm_') || ['fbclid','gclid'].includes(key)) u.searchParams.delete(key);
 return u.toString().replace(/\/$/,'');
}
const webUrl=z.string().trim().max(2000).refine(v=>!v || (()=>{try{normalizeUrl(v);return true;}catch{return false;}})(),'Enter a valid HTTP or HTTPS link.');
const optionalDate=z.union([z.iso.datetime(),z.literal(''),z.null()]).optional();
export const applicationSchema=z.object({title:z.string().trim().min(1).max(200),company:z.string().trim().min(1).max(200),location:z.string().max(200).default(''),url:webUrl.default(''),description:z.string().max(40000).default(''),salary:z.string().max(200).default(''),status:z.enum(statuses).default('SAVED'),method:z.enum(['PORTAL','EMAIL']).default('PORTAL'),contactEmail:z.union([z.email(),z.literal('')]).default(''),deadline:optionalDate,appliedAt:optionalDate,notes:z.string().max(20000).default('')});
export const sourceSchema=z.object({name:z.string().trim().min(1).max(150),url:webUrl.refine(Boolean,'A website link is required.'),notes:z.string().max(4000).default(''),enabled:z.boolean().default(true),frequencyHours:z.number().int().min(1).max(720).default(24)});
export const profileSchema=z.object({headline:z.string().max(200),location:z.string().max(200),phone:z.string().max(80),summary:z.string().max(10000),skills:z.string().max(5000),experience:z.string().max(20000),education:z.string().max(10000),roles:z.string().max(1000),countries:z.string().max(2000),languages:z.string().max(1000),workEligibility:z.string().max(3000),remoteOnly:z.boolean()});
export function dedupeKey(company:string,title:string,location:string,url?:string|null) {
 return url ? normalizeUrl(url) : [company,title,location].map(v=>v.trim().toLowerCase().replace(/\s+/g,' ')).join('|');
}
export function classifyEmail(subject:string,snippet:string) {
 const text=subject+' '+snippet;
 if(/unfortunately|not moving forward|unsuccessful|other candidates|not selected|regret to inform/i.test(text))return 'REJECTED';
 if(/offer of employment|pleased to offer|job offer/i.test(text)) return 'OFFER';
 if(/interview|schedule a call/i.test(text))return 'INTERVIEW';
 if(/assessment|coding challenge|take.home task/i.test(text))return 'ASSESSMENT';
 return null;
}
