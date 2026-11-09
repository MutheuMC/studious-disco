import test from 'node:test';
import assert from 'node:assert/strict';
import { countriesIn,searchGeography,locationAllowed,locationPriority } from '../src/geography.js';
import { shortlist,webSearchQueries,candidateFacts,type Candidate } from '../src/discovery.js';

const profile={location:'Nairobi, Kenya',countries:'Worldwide',headline:'Nurse',summary:'Patient care',skills:'Nursing',experience:'',education:'Diploma in Nursing',roles:'Nurse',remoteOnly:false,workEligibility:'',languages:'English'};
const job=(location:string,remote:boolean|null=false):Candidate=>({source:'Fixture',remote,listing:{title:'Nurse',company:'Hospital',description:'Nursing and patient care',location,url:'https://example.com/jobs/'+encodeURIComponent(location),method:'PORTAL',contactEmail:''}});
test('worldwide includes Kenyan and East African jobs and gives them priority over foreign feeds',()=>{
 const candidates=[job('Berlin, Germany'),job('Remote: United States only',true),job('Kampala, UG'),job('Nairobi, KE'),job('Dar es Salaam, TZ')];
 const matches=shortlist(candidates,profile,{roles:['Nurse'],keywords:[]},'');
 assert.deepEqual(matches.map(value=>value.listing.location),['Nairobi, KE','Kampala, UG','Dar es Salaam, TZ','Berlin, Germany']);
 assert.equal(candidateFacts(profile).location,'Nairobi, Kenya');
 const geo=searchGeography(profile);assert.deepEqual(geo.primary,['Kenya']);assert.ok(geo.nearby.includes('Uganda'));
 assert.equal(locationPriority('Kigali, Rwanda',geo),1);
});
test('explicit countries and East Africa constrain discovery without silently widening the scope',()=>{
 const geo=searchGeography({...profile,countries:'Kenya, Uganda'});
 assert.equal(locationAllowed('Nairobi, KE',false,geo),true);
 assert.equal(locationAllowed('Kampala, Uganda',null,geo),true);
 assert.equal(locationAllowed('Berlin, Germany',false,geo),false);
 assert.equal(locationAllowed('',null,geo),false);
 assert.equal(locationAllowed('Remote: Worldwide',true,geo),true);
 assert.equal(locationAllowed('Remote: US only',true,geo),false);
 assert.ok(searchGeography({...profile,countries:'East Africa'}).allowed.includes('Tanzania'));
 assert.equal(locationAllowed('Berlin, Germany',false,searchGeography({...profile,countries:'Unrecognized location'})),false);
});
test('country codes, city-only profiles and country names normalize without substring matches',()=>{
 assert.deepEqual(countriesIn('Nairobi',true),['Kenya']);
 assert.deepEqual(countriesIn('Dar es Salaam, TZ',true),['Tanzania']);
 assert.deepEqual(countriesIn('KE'),['Kenya']);
 assert.deepEqual(countriesIn('Marketing'),[]);
 const geo=searchGeography({...profile,location:'Kampala',countries:'Worldwide'});
 assert.deepEqual(geo.primary,['Uganda']);
 assert.equal(locationAllowed('Remote: Europe only',true,geo),false);
});
test('remote-only requires positive remote evidence and still checks residence restrictions',()=>{
 const matches=shortlist([job('Nairobi, KE',null),job('Remote: US only',true),job('Remote: Worldwide',true)],{...profile,remoteOnly:true},{roles:['Nurse'],keywords:[]},'');
 assert.deepEqual(matches.map(value=>value.listing.location),['Remote: Worldwide']);
});
test('local listings survive the global top-candidate limit and web searches use CV roles and geography',()=>{
 const global=Array.from({length:30},(_,index)=>({...job('Berlin, Germany'),listing:{...job('Berlin, Germany').listing,url:'https://example.com/jobs/'+index,title:'Nurse Nursing Patient Care'}}));
 const selected=shortlist([...global,job('Nairobi, KE')],profile,{roles:['Nurse'],keywords:['Nursing']},'');
 assert.equal(selected.length,18);assert.equal(selected[0].listing.location,'Nairobi, KE');
 assert.deepEqual(webSearchQueries({roles:['Registered Nurse'],keywords:[]},searchGeography(profile)),['Registered Nurse jobs Kenya','Registered Nurse jobs East Africa','Registered Nurse jobs worldwide']);
});
