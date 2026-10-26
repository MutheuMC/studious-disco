'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Globe2, Leaf, LoaderCircle, Sparkles } from 'lucide-react';
import { api, json } from '../lib/api';
import type { User } from '../lib/types';

type AuthMode = 'login' | 'signup';
type Props = { registered: boolean; googleEnabled: boolean; initialError: string; brand: ReactNode; onAuthenticated: (user: User) => void };
function GoogleMark() {
 return <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.87 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.75 23.75 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
}
export function AuthScreen({ registered, googleEnabled, initialError, brand, onAuthenticated }: Props) {
 const [mode, setMode] = useState<AuthMode>(() => {
  const requested = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('authMode') : null;
  return requested === 'login' || requested === 'signup' ? requested : registered ? 'login' : 'signup';
 });
 const [error, setError] = useState(initialError);
 const [pending, setPending] = useState(false);
 const signingUp = mode === 'signup';
 function changeMode(next: AuthMode) { setMode(next); setError(''); window.history.replaceState(null, '', '/?authMode=' + next); }
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); setPending(true); setError('');
  const form = new FormData(event.currentTarget);
  try {
   const user = await api<User>('/auth/' + (signingUp ? 'register' : 'login'), { method: 'POST', body: json({ name: form.get('name'), email: form.get('email'), password: form.get('password') }) });
   window.history.replaceState(null, '', '/'); onAuthenticated(user);
  } catch (failure) { setError((failure as Error).message); } finally { setPending(false); }
 }
 const googleLabel = signingUp ? 'Sign up with Google' : 'Sign in with Google';
 return <main className="auth-page">
  <section className="auth-story">{brand}<div className="auth-copy"><span className="eyebrow light"><span/>YOUR PERSONAL CAREER COMPANION</span><h1>A little more clarity.<br/>A lot more possibility.</h1><p>Keep every opportunity, application, and next step in one thoughtful space.</p><div className="auth-benefits"><div><CheckCircle2/>A clear picture of your job search</div><div><Globe2/>Your favorite job sites, remembered</div><div><Sparkles/>An assistant that knows your story</div></div></div><div className="auth-bottom"><span>Built for your next chapter.</span><span>✦</span></div><div className="auth-orbit one"/><div className="auth-orbit two"/></section>
  <section className="auth-form-wrap"><div className="auth-form">
   <div className="auth-mode-switch" role="group" aria-label="Account access"><button type="button" aria-pressed={!signingUp} className={!signingUp?'selected':''} onClick={()=>changeMode('login')}>Sign in</button><button type="button" aria-pressed={signingUp} className={signingUp?'selected':''} onClick={()=>changeMode('signup')}>Create account</button></div>
   <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span><h2>{signingUp?'Make room for what’s next.':'Welcome back.'}</h2><p>{signingUp?'Create your private JobNest account with Google or email.':'Sign in to your personal job search workspace.'}</p>
   {error&&<div className="alert error" role="alert"><AlertCircle size={18}/>{error}</div>}
   {googleEnabled?<a className="btn google full" href={'/api/google/start?mode='+mode}><GoogleMark/>{googleLabel}</a>:<><button className="btn google full" type="button" disabled aria-describedby="google-setup-note"><GoogleMark/>{googleLabel}</button><p id="google-setup-note" className="google-setup-note">Google access is available after the workspace owner connects Google.</p></>}
   <p className="google-permissions-note">Google {signingUp?'sign-up':'sign-in'} uses your name and email. You can connect Gmail later.</p>
   <div className="divider">or {signingUp?'create an account':'sign in'} with email</div>
   {registered&&signingUp&&<p className="personal-owner-note">This personal workspace already has an owner. Use your existing account to sign in.</p>}
   <form onSubmit={submit}>{signingUp&&<label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} placeholder="How should we call you?"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@gmail.com"/></label><label>Password<input key={mode} name="password" type="password" autoComplete={signingUp?'new-password':'current-password'} required minLength={signingUp?12:1} maxLength={128} placeholder={signingUp?'At least 12 characters':'Enter your password'}/></label><button className="btn primary full" disabled={pending}>{pending?<LoaderCircle size={18} className="spin"/>:signingUp?'Create my account':'Sign in with email'}<ArrowRight size={17}/></button></form>
   <p className="auth-switch-note">{signingUp?'Already have an account?':'First time here?'} <button type="button" className="text-btn" onClick={()=>changeMode(signingUp?'login':'signup')}>{signingUp?'Sign in':'Create your account'}</button></p>
   <p className="auth-foot"><Leaf size={15}/>A private workspace, just for you.</p>
  </div></section>
 </main>;
}
