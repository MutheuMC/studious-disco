export async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const response=await fetch('/api'+path,{...init,credentials:'include',headers:{...(init.body instanceof FormData?{}:{'Content-Type':'application/json'}),...init.headers}});
 const data=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
 if(!response.ok)throw new Error(data.error||'Request failed.');return data as T;
}
export const json=(body:unknown)=>JSON.stringify(body);
