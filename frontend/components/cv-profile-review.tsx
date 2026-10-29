'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import { Check,LoaderCircle,X } from 'lucide-react';
import { api,json } from '../lib/api';
import type { Profile } from '../lib/types';

const fieldDefinitions = [
 {key:'headline',label:'Professional headline',max:200},
 {key:'location',label:'Current location',max:200},
 {key:'phone',label:'Phone number',max:80},
 {key:'summary',label:'Professional summary',max:10000},
 {key:'skills',label:'Skills',max:5000},
 {key:'experience',label:'Experience',max:20000},
 {key:'education',label:'Education & certifications',max:10000},
 {key:'languages',label:'Languages',max:1000}
] as const;
type Field = typeof fieldDefinitions[number]['key'];
type Extraction = {documentId:string;name:string;kind:'CV'|'CERTIFICATE';text:string;fields:Partial<Record<Field,string>>;warnings:string[]};

export function CVProfileReview({documentId,close,onSaved}:{documentId:string;close:()=>void;onSaved:()=>Promise<void>}) {
 const [extraction,setExtraction]=useState<Extraction|null>(null);
 const [current,setCurrent]=useState<Profile|null>(null);
 const [fields,setFields]=useState<Partial<Record<Field,string>>>({});
 const [selected,setSelected]=useState<Partial<Record<Field,boolean>>>({});
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDivElement>(null);
 const closeRef=useRef(close);closeRef.current=close;
 const savingRef=useRef(saving);savingRef.current=saving;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  dialog.current?.focus();
  const old=document.body.style.overflow;document.body.style.overflow='hidden';
  const handler=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&!savingRef.current)closeRef.current();
   if(event.key!=='Tab')return;
   const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary');
   if(!items?.length)return;
   const first=items[0],last=items[items.length-1];
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',handler);
  return()=>{document.removeEventListener('keydown',handler);document.body.style.overflow=old;previous?.focus();};
 },[]);
 useEffect(()=>{
  let active=true;
  void Promise.all([api<Extraction>('/documents/'+documentId+'/extract-profile',{method:'POST'}),api<Profile>('/profile')]).then(([result,profile])=>{
   if(!active)return;
   setExtraction(result);setCurrent(profile);
   const proposed={...result.fields};
   if(result.kind==='CERTIFICATE')for(const key of ['education','skills'] as const){
    if(proposed[key]&&profile[key]&&!profile[key].includes(proposed[key]!))proposed[key]=[profile[key],proposed[key]].join('\n');
   }
   setFields(proposed);
   // Existing facts stay selected only when the user explicitly chooses them.
   setSelected(Object.fromEntries(Object.keys(result.fields).map(key=>[key,result.kind==='CERTIFICATE'||!profile[key as Field]])));
  }).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[documentId]);
 const hasSelection=fieldDefinitions.some(({key})=>selected[key]);
 async function save(event:FormEvent) {
  event.preventDefault();setError('');const tooLong=fieldDefinitions.find(({key,max})=>selected[key]&&(fields[key]?.length||0)>max);if(tooLong){setError(tooLong.label+' exceeds '+tooLong.max+' characters. Shorten the combined text before saving.');return;}setSaving(true);
  try {
   const chosen=Object.fromEntries(fieldDefinitions.filter(({key})=>selected[key]).map(({key})=>[key,fields[key]||'']));
   await api('/profile/import-cv',{method:'POST',body:json({approved:true,documentId,fields:chosen})});
  } catch(e) {setError((e as Error).message);setSaving(false);return;}
  await onSaved();
 }
 return <div className="modal-shade"><div className="modal wide" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="cv-review-title" tabIndex={-1}>
  <div className="modal-head"><h2 id="cv-review-title">Review document information</h2><button className="icon-btn" onClick={close} disabled={saving} aria-label="Close document review"><X size={20}/></button></div>
  {loading?<p role="status"><LoaderCircle className="spin" size={18}/> Reading your document…</p>:<>
   <p>Your document is saved in Documents. Select the fields to update, check the text, then save. Existing CV profile values are unchecked by default. Certificate suggestions are added to your current qualifications and skills; review the combined text before saving.</p>
   {error&&<p className="alert error" role="alert">{error}</p>}
   {extraction&&<form onSubmit={save}>
    <p className="muted">Source: {extraction.name}</p>
    {extraction.warnings.map(warning=><p className="muted small" key={warning}>{warning}</p>)}
    <details className="cv-extracted-text"><summary>View extracted document text</summary><pre>{extraction.text}</pre></details>
    {fieldDefinitions.map(({key,label,max})=><section className="cv-import-field" key={key}>
     <label className="checkbox"><input type="checkbox" checked={!!selected[key]} disabled={saving} onChange={event=>setSelected({...selected,[key]:event.target.checked})}/>Update {label.toLowerCase()}</label>
     {current?.[key]&&<details><summary>Current {label.toLowerCase()}</summary><p className="preserve">{current[key]}</p></details>}
     <label htmlFor={'cv-field-'+key}>{label}</label>
     <textarea id={'cv-field-'+key} rows={['summary','experience','education'].includes(key)?5:2} maxLength={max} value={fields[key]||''} disabled={saving} placeholder="Not detected — enter verified information here if needed." onChange={event=>{setFields({...fields,[key]:event.target.value});setSelected({...selected,[key]:true});}}/>
    </section>)}
    <div className="form-footer"><button type="button" className="btn secondary" onClick={close} disabled={saving}>Cancel</button><button className="btn primary" disabled={!hasSelection||saving}>{saving?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}Save selected fields to profile</button></div>
   </form>}
  </>}
 </div></div>;
}
