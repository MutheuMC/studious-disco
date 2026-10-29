'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import { Search,LoaderCircle,Check,Clock3 } from 'lucide-react';
import { api,json } from '../lib/api';
import type { Application,AutomationSettings,AutomationStatus,Doc,Task } from '../lib/types';
const when=(value:string|null)=>value?new Date(value).toLocaleString():'Not yet';
const lines=(value:string)=>value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);
export function AutomationPanel({mode,documents=[],onResults,defaultQuery=''}:{mode:'discovery'|'settings';documents?:Doc[];onResults?:(jobs:Application[])=>void;defaultQuery?:string}) {
 const [status,setStatus]=useState<AutomationStatus|null>(null),[draft,setDraft]=useState<AutomationSettings|null>(null);
 const [query,setQuery]=useState(defaultQuery),[run,setRun]=useState<Task|null>(null),[runId,setRunId]=useState<string|null>(null);
 const [starting,setStarting]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const [roleText,setRoleText]=useState(''),[domainText,setDomainText]=useState('');const initialized=useRef(false);
 const callback=useRef(onResults);callback.current=onResults;
 async function load(){const state=await api<AutomationStatus>('/automation');setStatus(state);if(!initialized.current){initialized.current=true;setDraft(state.settings);setRoleText(state.settings.allowedRoles.join('\n'));setDomainText(state.settings.allowedEmailDomains.join('\n'));}if(state.latestRun?.status==='RUNNING'){setRun(state.latestRun);setRunId(state.latestRun.id);}}
 useEffect(()=>{void load().catch(e=>setError(e.message));const timer=setInterval(()=>{void load().catch(()=>{});},15000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(!runId)return;let active=true;
  const poll=async()=>{
   try {const result=await api<Task&{applications:Application[]}>('/searches/'+runId);if(!active)return;setRun(result);callback.current?.(result.applications);if(['COMPLETE','FAILED'].includes(result.status)){setRunId(null);void load();}}
   catch(e){if(active){setError((e as Error).message);setRunId(null);}}
  };
  void poll();const timer=setInterval(()=>{void poll();},1500);return()=>{active=false;clearInterval(timer);};
 },[runId]);
 async function search(event:FormEvent){event.preventDefault();setError('');setStarting(true);try{const task=await api<Task>('/discover',{method:'POST',body:json({query})});setRun(task);setRunId(task.id);}catch(e){setError((e as Error).message);}finally{setStarting(false);}}
 async function save(event:FormEvent){event.preventDefault();if(!draft)return;setError('');setSaving(true);setSaved(false);try{const updated=await api<AutomationSettings>('/automation',{method:'PUT',body:json({...draft,allowedRoles:lines(roleText),allowedEmailDomains:lines(domainText)})});setDraft(updated);setSaved(true);await load();}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 if(!draft)return <section className="panel automation-panel">{error?<p role="alert">{error}</p>:<p>Loading automation settings…</p>}</section>;
 const searching=starting||!!runId;
 return <section className="panel automation-panel">
  <div className="section-head"><div><h2>{mode==='settings'?'Search & application automation':'Your job search, running in the background'}</h2><p>Free feeds and saved websites, guided by your reviewed profile.</p></div><Clock3 size={21}/></div>
  <div className="automation-facts"><span><strong>{draft.searchEnabled?'Automatic search on':'Automatic search paused'}</strong> · every {draft.searchIntervalHours} hours</span><span>Last search: {when(status?.settings.lastSearchAt||null)}</span><span>Next search: {draft.searchEnabled?when(status?.settings.nextSearchAt||null):'Paused'}</span><span>Last search found {status?.settings.lastSearchAdded||0} new jobs</span><span>Automatic email: {status?.settings.autoApplyEnabled?'enabled under your saved rules':'off'}</span></div>
  {!status?.workerAlive&&<p className="automation-warning">Background worker is offline or has not checked in yet. Scheduled searches and application preparation resume when it reconnects. Search now works independently.</p>}
  {status?.settings.lastSearchError&&<p className="alert error">Last search failed: {status.settings.lastSearchError}</p>}
  {status?.settings.lastSearchWarnings&&<details><summary>Some search steps need attention</summary><p className="preserve">{status.settings.lastSearchWarnings}</p></details>}
  {error&&<p className="alert error" role="alert">{error}</p>}
  {mode==='discovery'&&<form className="search-now-form" onSubmit={search}><label htmlFor="search-now-query">Search now — optional focus<input id="search-now-query" value={query} onChange={event=>setQuery(event.target.value)} maxLength={500} placeholder="Leave blank to use your CV, skills and certificates"/></label><button className="btn primary" disabled={searching}>{searching?<LoaderCircle className="spin" size={17}/>:<Search size={17}/>}Search now</button><p className="muted small">Starts immediately. Matches appear while AI assessment continues. Public feeds may be reused for up to six hours; saved websites are read again.</p></form>}
  {run&&<div className={'search-progress '+(run.status==='FAILED'?'failed':'')} role="status"><strong>{run.status==='RUNNING'?'Searching now':run.status==='COMPLETE'?'Search complete':run.status==='FAILED'?'Search failed':run.status}</strong><p>{run.progress||'Retrieving jobs…'}</p>{run.error&&<p>{run.error}</p>}{run.result&&<p>{run.result.added} new jobs · {run.result.reviewed} matches assessed</p>}</div>}
  <form onSubmit={save}>
   <div className="automation-controls"><label className="checkbox"><input type="checkbox" checked={draft.searchEnabled} onChange={event=>setDraft({...draft,searchEnabled:event.target.checked})}/>Automatic job search</label><label>Search interval<select value={draft.searchIntervalHours} onChange={event=>setDraft({...draft,searchIntervalHours:Number(event.target.value) as 6|12|24})}><option value={6}>Every 6 hours</option><option value={12}>Every 12 hours</option><option value={24}>Every 24 hours</option></select></label></div>
   {mode==='settings'&&<>
    <label className="checkbox"><input type="checkbox" checked={draft.preparePortalDrafts} onChange={event=>setDraft({...draft,preparePortalDrafts:event.target.checked})}/>Prepare CV and cover-letter drafts for strong portal matches</label>
    <hr/><h3>Automatic email applications</h3><p>Choose exact rules and approve the email text and document versions. Only eligible jobs with an explicit application address, a verified future deadline, and no unresolved requirements can be sent. Uncertain cases go to Needs review.</p>
    <label className="checkbox"><input type="checkbox" checked={draft.autoApplyEnabled} onChange={event=>setDraft({...draft,autoApplyEnabled:event.target.checked})}/>Enable automatic email sending under these rules</label>
    <div className="form-grid"><label>Minimum AI match score<input type="number" min={70} max={100} value={draft.minMatchScore} onChange={event=>setDraft({...draft,minMatchScore:Number(event.target.value)})}/></label><label>Maximum automatic sends per 24 hours<input type="number" min={1} max={20} value={draft.dailyLimit} onChange={event=>setDraft({...draft,dailyLimit:Number(event.target.value)})}/></label><label>Allowed job-title phrases — one per line<textarea value={roleText} onChange={event=>setRoleText(event.target.value)} placeholder="Registered Nurse"/></label><label>Approved recipient domains — one per line<textarea value={domainText} onChange={event=>setDomainText(event.target.value)} placeholder="employer.example"/></label></div>
    <p>Approved attachments: select versions suitable for every job covered by these rules. A CV is required.</p>
    {documents.filter(document=>['CV','COVER_LETTER','CERTIFICATE'].includes(document.kind)).map(document=><label className="checkbox" key={document.id}><input type="checkbox" checked={draft.approvedDocumentIds.includes(document.id)} onChange={event=>setDraft({...draft,approvedDocumentIds:event.target.checked?[...draft.approvedDocumentIds,document.id]:draft.approvedDocumentIds.filter(id=>id!==document.id)})}/>{document.name} · v{document.version} · {document.kind.toLowerCase().replace('_',' ')}</label>)}
    {!documents.some(document=>document.kind==='CV')&&<p className="automation-warning">Upload or create your approved CV before enabling automatic email applications.</p>}
    <label>Approved email subject<input value={draft.subjectTemplate} maxLength={300} onChange={event=>setDraft({...draft,subjectTemplate:event.target.value})}/></label>
    <label>Approved email body<textarea rows={8} value={draft.bodyTemplate} maxLength={20000} onChange={event=>setDraft({...draft,bodyTemplate:event.target.value})} placeholder="Dear hiring team, …"/></label>
    <p className="muted small">Supported placeholders: {'{{title}}, {{company}}, {{name}}, {{skills}}, {{summary}}'}. Saving with automatic sending enabled authorizes the worker to send matching applications using this text and these document versions. Pausing prevents new sends; a send already in progress may complete.</p>
   </>}
   <div className="form-footer">{saved&&<span role="status">Settings saved</span>}<button className="btn secondary" disabled={saving}>{saving?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>}Save automation settings</button></div>
  </form>
 </section>;
}
