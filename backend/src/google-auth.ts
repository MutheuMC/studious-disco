import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { CodeChallengeMethod, type OAuth2Client, type TokenPayload } from 'google-auth-library';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { googleClient } from './integrations.js';
import { cookieOptions, createSession } from './auth.js';
import { decrypt, encrypt, hashToken } from './security.js';

export type GoogleClientFactory = () => OAuth2Client;
type AuthMode = 'login' | 'signup' | 'gmail';
class GoogleAuthError extends Error {}
const fail = (message: string): never => { throw new GoogleAuthError(message); };
const oauthContext = z.object({
 state: z.string().min(32), nonce: z.string().min(32),
 mode: z.enum(['login', 'signup', 'gmail']), userId: z.string().optional(),
 codeVerifier: z.string().min(43), expires: z.number().finite()
});
const gmailScopes = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
export const googleAuthAvailable = () => Boolean(config.googleId && config.googleSecret && /^[a-f0-9]{64}$/i.test(config.encryptionKey));

async function googleAccount(payload: TokenPayload, mode: 'login' | 'signup') {
 const email = payload.email!.toLowerCase();
 if (config.ownerEmail && email !== config.ownerEmail) fail('This workspace is reserved for its owner. Choose the owner’s Google account.');
 // Google subject IDs remain stable even when an account’s email changes.
 const linked = await db.user.findUnique({ where: { googleId: payload.sub } });
 if (linked) return linked;
 const sameEmail = await db.user.findUnique({ where: { email } });
 if (sameEmail) {
  if (sameEmail.googleId) fail('This email is linked to a different Google identity. Use the Google account already connected to JobNest.');
  // Google is authoritative for Gmail and verified Workspace addresses.
  if (!email.endsWith('@gmail.com') && !payload.hd) fail('Sign in with your password. Automatic Google linking is supported for Gmail and verified Google Workspace addresses.');
  return db.user.update({ where: { id: sameEmail.id }, data: { googleId: payload.sub } });
 }
 if (await db.user.findFirst()) fail('This personal workspace already has an owner. Sign in with the owner’s account.');
 if (mode === 'login') fail('No JobNest account exists yet. Choose Sign up with Google to create your personal account.');
 try {
  return await db.user.create({ data: { email, name: payload.name?.trim() || email.split('@')[0], googleId: payload.sub, profile: { create: {} }, integration: { create: {} } } });
 } catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail('This workspace already has an owner. Please sign in.');
  throw error;
 }
}

export function createGoogleAuthRouter(clientFactory: GoogleClientFactory = googleClient) {
 const router = Router();
 router.get('/start', async (req, res) => {
  const mode: AuthMode = req.query.mode === 'gmail' ? 'gmail' : req.query.mode === 'signup' ? 'signup' : 'login';
  const returnMode = mode === 'signup' ? 'signup' : 'login';
  if (!googleAuthAvailable()) {
   res.redirect(config.frontend + (mode === 'gmail' ? '/?view=settings' : '/?authMode=' + returnMode) + '&authError=' + encodeURIComponent('Google sign-in is not configured yet. The workspace owner needs to connect Google first.'));
   return;
  }
  let userId: string | undefined;
  if (mode === 'gmail') {
   const token = req.cookies.jobnest_session;
   const session = token ? await db.session.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
   if (!session || session.expiresAt < new Date()) { res.redirect(config.frontend + '/?authMode=login&authError=' + encodeURIComponent('Please sign in before connecting Gmail.')); return; }
   userId = session.userId;
  }
  const state = randomBytes(24).toString('hex');
  const nonce = randomBytes(24).toString('hex');
  const client = clientFactory();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const context = { state, nonce, mode, userId, codeVerifier, expires: Date.now() + 600000 };
  res.cookie('jobnest_oauth', encrypt(JSON.stringify(context)), { ...cookieOptions, maxAge: 600000 });
  const url = new URL(client.generateAuthUrl({
   access_type: mode === 'gmail' ? 'offline' : 'online',
   prompt: mode === 'gmail' ? 'consent' : 'select_account', state,
   code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
   scope: ['openid', 'email', 'profile', ...(mode === 'gmail' ? gmailScopes : [])]
  }));
  url.searchParams.set('nonce', nonce);
  res.redirect(url.toString());
 });
 router.get('/callback', async (req, res) => {
  let mode: AuthMode = 'login';
  try {
   const saved = req.cookies.jobnest_oauth;
   res.clearCookie('jobnest_oauth', cookieOptions);
   if (!saved) fail('Google sign-in expired. Please try again.');
   const ctx = oauthContext.parse(JSON.parse(decrypt(saved)));
   mode = ctx.mode;
   if (ctx.expires < Date.now() || ctx.state !== req.query.state) fail('Google sign-in could not be verified. Please try again.');
   if (req.query.error) fail(req.query.error === 'access_denied' ? 'Google sign-in was cancelled. You can try again.' : 'Google could not authorize this request. Please try again.');
   if (typeof req.query.code !== 'string') fail('Google did not return an authorization code. Please try again.');
   const client = clientFactory();
   const { tokens } = await client.getToken({ code: req.query.code as string, codeVerifier: ctx.codeVerifier });
   if (!tokens.id_token) fail('Google did not return a verified identity. Please try again.');
   const identity = await client.verifyIdToken({ idToken: tokens.id_token!, audience: config.googleId });
   const payload = identity.getPayload();
   if (!payload?.email || !payload.email_verified || !payload.sub) fail('Choose a Google account with a verified email address.');
   if (payload!.nonce !== ctx.nonce) fail('Google sign-in could not be verified. Please try again.');
   const email = payload!.email!.toLowerCase();
   if (mode === 'gmail') {
    const token = req.cookies.jobnest_session;
    const session = token ? await db.session.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
    if (!session || session.userId !== ctx.userId || session.expiresAt < new Date()) fail('Please sign in again before connecting Gmail.');
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (user.email !== email || user.googleId && user.googleId !== payload!.sub) fail('Connect the Gmail account used for this JobNest account.');
    const granted = new Set(tokens.scope?.split(' ') || []);
    if (gmailScopes.some(scope => !granted.has(scope))) fail('Both Gmail reading and sending permissions are required. Reconnect Gmail and select both permissions.');
    const integration = await db.integration.findUniqueOrThrow({ where: { userId: user.id } });
    const previous = integration.gmailTokens ? JSON.parse(decrypt(integration.gmailTokens)) : {};
    const credentials = { ...previous, ...tokens, refresh_token: tokens.refresh_token || previous.refresh_token };
    if (!credentials.refresh_token) fail('Google did not grant offline Gmail access. Please reconnect Gmail.');
    await db.integration.update({ where: { userId: user.id }, data: { gmailTokens: encrypt(JSON.stringify(credentials)), gmailEmail: email } });
    res.redirect(config.frontend + '/?view=settings&connected=gmail');
    return;
   }
   const user = await googleAccount(payload!, mode);
   await createSession(res, user.id);
   res.redirect(config.frontend);
  } catch (error) {
   const message = error instanceof GoogleAuthError ? error.message : 'Google sign-in could not be completed. Please try again.';
   res.redirect(config.frontend + (mode === 'gmail' ? '/?view=settings' : '/?authMode=' + (mode === 'signup' ? 'signup' : 'login')) + '&authError=' + encodeURIComponent(message));
  }
 });
 return router;
}
