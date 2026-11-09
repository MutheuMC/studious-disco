import test from 'node:test';
import assert from 'node:assert/strict';
import { boardSearchUrls,extractJobLinks,parseListings,readJobSource } from '../src/sources.js';

const posting=(url:string)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:'Registered Nurse',url,description:'<p>Diploma in Nursing and patient care.</p>',hiringOrganization:{name:'Example Hospital'},jobLocation:{address:{addressLocality:'Nairobi',addressCountry:{'@type':'Country',name:'KE'}}},validThrough:'2099-12-31'})+'</script>';
test('Kenyan homepages expose job links that are followed to complete structured job records',async()=>{
 for(const [root,path] of [['https://jobwebkenya.com/','jobs'],['https://www.myjobmag.co.ke/','job']]){
  const calls:string[]=[];
  const read=async(url:string)=>{calls.push(url);return url.includes('/'+path+'/nurse')?posting('/'+path+'/nurse'):'<h2><a href="/'+path+'/nurse">Registered Nurse</a></h2><a href="/'+path+'/nurse?utm_source=home">Details</a>';};
  const result=await readJobSource(root,['Registered Nurse'],read);
  assert.equal(result.listings.length,1);assert.equal(result.listings[0].company,'Example Hospital');assert.equal(result.listings[0].location,'Nairobi, KE');assert.equal(result.listings[0].description,'Diploma in Nursing and patient care.');
  assert.ok(calls.some(url=>url.endsWith('/'+path+'/nurse')));assert.ok(calls[0].includes(root.includes('myjobmag')?'q=Registered+Nurse':'s=Registered+Nurse'));
 }
});
test('crawling follows one pagination link, deduplicates jobs, and ignores external and unsafe links',async()=>{
 const calls:string[]=[];
 const read=async(url:string)=>{calls.push(url);if(url.includes('/jobs/'))return posting(new URL(url).pathname);if(url.includes('page=2'))return '<a href="/jobs/two">Nurse</a>';return '<a href="/jobs/one">Nurse</a><a rel="next" href="?page=2">Next page »</a><a href="https://evil.example/jobs/other">Nurse</a><a href="http://127.0.0.1/jobs/internal">Internal</a>';};
 const result=await readJobSource('https://board.example/',[],read);
 assert.equal(result.listings.length,2);assert.ok(calls.every(url=>new URL(url).origin==='https://board.example'));assert.ok(calls.includes('https://board.example/?page=2'));
 assert.deepEqual(extractJobLinks('<a href="javascript:alert(1)">Job</a><a href="/jobs/a">Nurse</a><a href="/jobs/a#apply">Details</a>','https://board.example/'),['https://board.example/jobs/a']);
});
test('a source check has a fixed detail request budget and empty extraction is visible',async()=>{
 let details=0;
 const result=await readJobSource('https://board.example/',[],async url=>{if(url.includes('/jobs/')){details++;return '<p>No job data</p>';}return Array.from({length:100},(_,i)=>'<a href="/jobs/'+i+'">Nurse</a>').join('');});
 assert.equal(details,16);assert.equal(result.linksFound,100);assert.equal(result.listings.length,0);assert.ok(result.warnings.some(warning=>warning.includes('not proof that no jobs exist')));
});
test('RSS jobs are enriched by detail pages and generic saved sites are not sent invented search parameters',async()=>{
 const result=await readJobSource('https://board.example/feed',[],async url=>url.endsWith('/feed')?'<rss><channel><item><title>Nurse</title><link>https://board.example/jobs/nurse</link><description>Summary</description></item></channel></rss>':posting('/jobs/nurse'));
 assert.equal(result.listings[0].company,'Example Hospital');assert.equal(result.listings[0].location,'Nairobi, KE');
 assert.deepEqual(boardSearchUrls('https://employer.example/careers',['Nurse']),['https://employer.example/careers']);
});
test('remote JobPosting retains applicant-country restrictions rather than implying worldwide eligibility',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:'Remote Nurse',jobLocationType:'TELECOMMUTE',applicantLocationRequirements:[{'@type':'Country',name:'United States'}]})+'</script>';
 assert.equal(parseListings(html,'https://board.example/job/nurse')[0].location,'Remote: United States');
});
