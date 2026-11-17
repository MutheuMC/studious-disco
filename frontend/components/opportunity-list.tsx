'use client';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { ChevronLeft,ChevronRight,LoaderCircle,RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { Opportunity,OpportunityPage } from '../lib/types';

export function OpportunityList({tab,search,revision,renderJob}:{tab:string;search:string;revision:number;renderJob:(job:Opportunity)=>ReactNode}){
 const [page,setPage]=useState(1),[data,setData]=useState<OpportunityPage|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const list=useRef<HTMLElement>(null);
 useEffect(()=>{
  let active=true;const controller=new AbortController();setLoading(true);setError('');
  const timer=setTimeout(()=>{
   const params=new URLSearchParams({tab,search,page:String(page),pageSize:'20'});
   void api<OpportunityPage>('/opportunities?'+params,{signal:controller.signal}).then(result=>{
    if(active){setData(result);setPage(result.page);setLoading(false);}
   }).catch(reason=>{if(active){setError((reason as Error).message);setLoading(false);}});
  },search?250:0);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[tab,search,page,revision,retry]);
 function go(next:number){setPage(next);list.current?.scrollIntoView({behavior:'smooth',block:'start'});}
 const pending=loading||!!data&&data.page!==page;
 return <section className="panel opportunity-list" ref={list} aria-label="Discovered jobs" aria-busy={pending}>
  {error?<div className="opportunity-message" role="alert"><p>{error}</p><button className="btn secondary small-btn" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>Try again</button></div>
   :pending?<div className="opportunity-message" role="status"><LoaderCircle className="spin" size={20}/><p>Loading jobs…</p></div>
   :data?.items.length?<><div className="table-label"><span>ROLE & COMPANY</span><span>LOCATION</span><span>STATUS</span><span>ADDED</span></div>{data.items.map(renderJob)}</>
   :<div className="opportunity-message"><h3>{search?'No matching jobs':'No jobs in this tab yet'}</h3><p>{search?'Try another company, role, or location.':'Search for jobs or check your saved sources to find opportunities.'}</p></div>}
  {data&&!error&&<nav className="job-pagination" aria-label="Job results pages">
   <span role="status">{data.total?`${(data.page-1)*data.pageSize+1}–${Math.min(data.page*data.pageSize,data.total)} of ${data.total} jobs`:'0 jobs'}</span>
   <div><button className="btn secondary small-btn" disabled={pending||!data.hasPrevious} onClick={()=>go(data.page-1)}><ChevronLeft size={15}/>Previous</button><span>Page {data.page} of {data.totalPages}</span><button className="btn secondary small-btn" disabled={pending||!data.hasNext} onClick={()=>go(data.page+1)}>Next<ChevronRight size={15}/></button></div>
  </nav>}
 </section>;
}
