// Search geography is based on reviewed profile facts, never inferred citizenship.
export type GeographyProfile={location?:string;countries:string};
export const eastAfrica=['Kenya','Uganda','Tanzania','Rwanda','Burundi','South Sudan','Somalia','Ethiopia','Djibouti','Eritrea','Democratic Republic of the Congo'];
const aliases:Record<string,string[]>={
 Kenya:['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Kiambu','Thika'],
 Uganda:['Kampala','Entebbe','Jinja','Mbale'],Tanzania:['Dar es Salaam','Dodoma','Arusha','Zanzibar'],
 Rwanda:['Kigali'],Burundi:['Bujumbura','Gitega'],'South Sudan':['Juba'],Somalia:['Mogadishu'],Ethiopia:['Addis Ababa'],
 'United States':['USA','U.S.','US only','United States of America'], 'United Kingdom':['UK','U.K.','Britain'],
 'Democratic Republic of the Congo':['DR Congo','DRC']
};
const names=new Intl.DisplayNames(['en'],{type:'region'});
const countries:Map<string,string>=new Map();
for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
 const code=String.fromCharCode(a,b);const name=names.of(code);
 if(name&&name!==code)countries.set(code,name);
}
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const contains=(text:string,value:string)=>new RegExp('(?:^|[^a-z])'+escape(value)+'(?:$|[^a-z])','i').test(text);
export function countriesIn(text:string,includeCities=false):string[]{
 const found=new Set<string>();
 for(const [code,name] of countries)if(contains(text,name)||new RegExp('(?:^|[,;/:(]\\s*)'+code+'(?:\\s*(?:$|[,;/:)]))','i').test(text))found.add(name);
 for(const [name,values] of Object.entries(aliases))if(values.some(value=>(includeCities||!eastAfrica.includes(name))&&contains(text,value)))found.add(name);
 return [...found];
}
export function searchGeography(profile:GeographyProfile){
 const preferred=countriesIn(profile.countries,true);
 const regional=/\beast(?:ern)? africa\b/i.test(profile.countries);
 if(regional)for(const country of eastAfrica)if(!preferred.includes(country))preferred.push(country);
 const worldwide=!profile.countries.trim()||/\b(worldwide|anywhere|global|all countries)\b/i.test(profile.countries);
 const home=countriesIn(profile.location||'',true);
 const primary=preferred.length?preferred:home;
 const nearby=primary.some(country=>eastAfrica.includes(country))?eastAfrica.filter(country=>!primary.includes(country)):[];
 return {worldwide,home,primary,nearby,allowed:worldwide?[]:preferred,
  summary:primary.length?primary.join(', ')+(worldwide?(nearby.length?' → East Africa → international':' → international'):' only'):'Worldwide; add your current country for local priority'};
}
export type Geography=ReturnType<typeof searchGeography>;
export function locationPriority(location:string,geo:Geography){
 const found=countriesIn(location,true);
 if(found.some(country=>geo.primary.includes(country)))return 0;
 if(found.some(country=>geo.nearby.includes(country)))return 1;
 if(/\b(worldwide|anywhere|global|africa)\b/i.test(location))return 2;
 return found.length?3:4;
}
export function locationAllowed(location:string,remote:boolean|null,geo:Geography){
 const found=countriesIn(location,true);
 const global=/\b(worldwide|anywhere|global)\b/i.test(location);
 const african=/\bafrica\b/i.test(location)&&!/south africa/i.test(location);
 // Residence restrictions apply even when a candidate wants international jobs.
 if(remote&&geo.home.length&&found.length&&!found.some(country=>geo.home.includes(country))&&!global)return false;
 if(remote&&geo.home.length&&/\b(europe|european union|eu only|north america)\b/i.test(location)&&geo.home.every(country=>eastAfrica.includes(country))&&!global)return false;
 if(geo.worldwide)return true;
 if(!geo.allowed.length)return false; // Unrecognized preferences must not silently become worldwide.
 return found.some(country=>geo.allowed.includes(country))||Boolean(remote&&(global||african&&geo.allowed.some(country=>eastAfrica.includes(country))));
}
export function withLocationPriority<T extends {location:string}>(jobs:T[],profile:GeographyProfile){
 const geo=searchGeography(profile);
 return jobs.map(job=>({...job,locationPriority:locationPriority(job.location,geo)}));
}
