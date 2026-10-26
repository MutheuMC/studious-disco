import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db.js';
import { decrypt, encrypt, hashToken } from '../src/security.js';

const original = { googleId: config.googleId, googleSecret: config.googleSecret, encryptionKey: config.encryptionKey, ownerEmail: config.ownerEmail };
let payload: Record<string, unknown>;
let tokenCalls = 0;
let tokenFailure = false;
let grantedScope = '';
const client = {
 generateCodeVerifierAsync: async () => ({ codeVerifier: 'v'.repeat(64), codeChallenge: 'challenge' }),
 generateAuthUrl: (options: Parameters<OAuth2Client['generateAuthUrl']>[0]) => new OAuth2Client(config.googleId, config.googleSecret, config.googleRedirect).generateAuthUrl(options),
 getToken: async (options: { code: string; codeVerifier: string }) => {
  tokenCalls++; assert.equal(options.codeVerifier, 'v'.repeat(64));
  if (tokenFailure) throw new Error('SECRET-PROVIDER-DETAIL');
  return { tokens: { id_token: 'test-id-token', access_token: 'test-access-token', refresh_token: 'test-refresh-token', scope: grantedScope } };
 },
 verifyIdToken: async (options: { audience: string }) => { assert.equal(options.audience, config.googleId); return { getPayload: () => payload }; }
};
const app = createApp({ googleClient: () => client as unknown as OAuth2Client });
before(async () => { if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Google auth tests require a dedicated test database.'); });
beforeEach(async () => {
 await db.user.deleteMany(); tokenCalls = 0; tokenFailure = false;
 Object.assign(config, { googleId: 'test-google-client', googleSecret: 'test-google-secret', encryptionKey: 'a'.repeat(64), ownerEmail: undefined });
 payload = { sub: 'google-owner-subject', email: 'owner@gmail.com', email_verified: true, name: 'Google Owner' };
 grantedScope = 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
});
after(async () => { Object.assign(config, original); await db.user.deleteMany(); await db.$disconnect(); });
async function begin(mode = 'signup', sessionCookie?: string) {
 const req = request(app).get('/api/google/start?mode=' + mode);
 if (sessionCookie) req.set('Cookie', sessionCookie);
 const response = await req; assert.equal(response.status, 302);
 const cookie = String(response.headers['set-cookie'][0]).split(';')[0];
 const context = JSON.parse(decrypt(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))));
 payload.nonce = context.nonce;
 return { response, cookie, context, sessionCookie };
}
function callback(flow: Awaited<ReturnType<typeof begin>>, query: Record<string, string> = {}) {
 return request(app).get('/api/google/callback').query({ state: flow.context.state, code: 'test-code', ...query }).set('Cookie', [flow.cookie, ...(flow.sessionCookie ? [flow.sessionCookie] : [])]);
}
function callbackError(response: { headers: Record<string, string> }) { return new URL(response.headers.location).searchParams.get('authError') || ''; }
async function account(email = 'owner@gmail.com', googleId?: string) {
 return db.user.create({ data: { name: 'Existing Owner', email, googleId, passwordHash: 'existing-password-hash', profile: { create: {} }, integration: { create: {} } } });
}
async function session(userId: string) {
 const token = randomBytes(32).toString('hex');
 await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000) } });
 return 'jobnest_session=' + token;
}

test('Google sign-up uses identity scopes, PKCE, state and nonce without Gmail permission', async () => {
 const flow = await begin(); const url = new URL(flow.response.headers.location);
 assert.equal(url.origin, 'https://accounts.google.com');
 assert.deepEqual(url.searchParams.get('scope')?.split(' '), ['openid', 'email', 'profile']);
 assert.equal(url.searchParams.get('access_type'), 'online');
 assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
 assert.equal(url.searchParams.get('state'), flow.context.state);
 assert.equal(url.searchParams.get('nonce'), flow.context.nonce);
 assert.ok(String(flow.response.headers['set-cookie']).includes('HttpOnly'));
});
test('Google signup creates the owner, profile and integration and signs in without a password', async () => {
 const result = await callback(await begin()); assert.equal(result.headers.location, config.frontend);
 const user = await db.user.findUniqueOrThrow({ where: { googleId: 'google-owner-subject' }, include: { profile: true, integration: true } });
 assert.equal(user.passwordHash, null); assert.equal(user.email, 'owner@gmail.com'); assert.ok(user.profile); assert.ok(user.integration); assert.equal(user.integration.gmailTokens, null);
 const cookie = result.headers['set-cookie'].find((c: string) => c.startsWith('jobnest_session='))!.split(';')[0];
 const me = await request(app).get('/api/me').set('Cookie', cookie); assert.equal(me.status, 200); assert.equal(me.body.id, user.id);
});
test('Google login signs in the existing identity without duplicating accounts', async () => {
 const owner = await account('owner@gmail.com', 'google-owner-subject');
 const result = await callback(await begin('login')); assert.equal(result.headers.location, config.frontend);
 assert.equal(await db.user.count(), 1); assert.equal((await db.session.findFirstOrThrow()).userId, owner.id);
});
test('Google login does not silently create an account', async () => {
 const result = await callback(await begin('login')); assert.match(callbackError(result), /Sign up with Google/); assert.equal(await db.user.count(), 0); assert.equal(await db.session.count(), 0);
});
test('Google signup with the existing account signs in without duplicating the owner', async () => {
 await account('owner@gmail.com', 'google-owner-subject'); const result = await callback(await begin()); assert.equal(result.headers.location, config.frontend); assert.equal(await db.user.count(), 1);
});
test('verified Gmail identity links to the existing email account and retains its records', async () => {
 const owner = await account(); const result = await callback(await begin('login')); assert.equal(result.headers.location, config.frontend);
 const linked = await db.user.findUniqueOrThrow({ where: { id: owner.id } }); assert.equal(linked.googleId, 'google-owner-subject'); assert.equal(linked.passwordHash, 'existing-password-hash'); assert.equal(await db.user.count(), 1);
});
test('Google subject identity is retained if its email changes', async () => {
 const owner = await account('previous@gmail.com', 'google-owner-subject'); const result = await callback(await begin('login')); assert.equal(result.headers.location, config.frontend); assert.equal((await db.session.findFirstOrThrow()).userId, owner.id); assert.equal(await db.user.count(), 1);
});
test('a different Google subject cannot take over an already linked email', async () => {
 await account('owner@gmail.com', 'another-google-subject'); const result = await callback(await begin('login')); assert.match(callbackError(result), /different Google identity/); assert.equal(await db.session.count(), 0);
});
test('a second Google account cannot claim this personal workspace', async () => {
 await account('existing@gmail.com', 'existing-subject'); const result = await callback(await begin()); assert.match(callbackError(result), /already has an owner/); assert.equal(await db.user.count(), 1); assert.equal(await db.session.count(), 0);
});
test('configured owner email is enforced for Google signup', async () => {
 config.ownerEmail = 'reserved@gmail.com'; const result = await callback(await begin()); assert.match(callbackError(result), /reserved for its owner/); assert.equal(await db.user.count(), 0);
});
test('unverified Google email cannot create an account', async () => {
 const flow = await begin(); payload.email_verified = false; const result = await callback(flow); assert.match(callbackError(result), /verified email/); assert.equal(await db.user.count(), 0);
});
test('Google cannot automatically link a non-authoritative third-party email', async () => {
 await account('owner@example.org'); const flow = await begin('login'); payload.email = 'owner@example.org'; const result = await callback(flow); assert.match(callbackError(result), /Sign in with your password/); assert.equal(await db.session.count(), 0);
});
test('invalid OAuth state is rejected before token exchange', async () => {
 const flow = await begin(); const result = await callback(flow, { state: 'wrong-state' }); assert.match(callbackError(result), /could not be verified/); assert.equal(tokenCalls, 0); assert.equal(await db.session.count(), 0);
});
test('expired OAuth context is rejected before token exchange', async () => {
 const flow = await begin(); flow.context.expires = Date.now() - 1000; flow.cookie = 'jobnest_oauth=' + encrypt(JSON.stringify(flow.context)); const result = await callback(flow); assert.match(callbackError(result), /could not be verified/); assert.equal(tokenCalls, 0);
});
test('invalid nonce prevents Google account creation', async () => {
 const flow = await begin(); payload.nonce = 'different-nonce'; const result = await callback(flow); assert.match(callbackError(result), /could not be verified/); assert.equal(await db.user.count(), 0);
});
test('cancelled Google signup returns a useful error to the signup screen', async () => {
 const flow = await begin(); const result = await callback(flow, { error: 'access_denied' }); assert.match(callbackError(result), /cancelled/); assert.equal(new URL(result.headers.location).searchParams.get('authMode'), 'signup'); assert.equal(tokenCalls, 0);
});
test('provider failures do not expose private error details', async () => {
 const flow = await begin(); tokenFailure = true; const result = await callback(flow); assert.match(callbackError(result), /could not be completed/); assert.ok(!result.headers.location.includes('SECRET-PROVIDER-DETAIL'));
});
test('Google is shown as unavailable when credentials or the encryption key are missing', async () => {
 config.googleSecret = ''; assert.equal((await request(app).get('/api/auth/config')).body.googleEnabled, false);
 config.googleSecret = 'test-secret'; config.encryptionKey = ''; assert.equal((await request(app).get('/api/auth/config')).body.googleEnabled, false);
 const result = await request(app).get('/api/google/start?mode=signup'); assert.match(callbackError(result), /not configured/);
});
test('Gmail connection still requires a signed-in owner', async () => {
 const result = await request(app).get('/api/google/start?mode=gmail'); assert.match(callbackError(result), /Please sign in/);
});
test('Gmail authorization uses separate offline permissions and stores encrypted credentials', async () => {
 const owner = await account(); const flow = await begin('gmail', await session(owner.id)); const url = new URL(flow.response.headers.location); assert.equal(url.searchParams.get('access_type'), 'offline'); assert.ok(url.searchParams.get('scope')?.includes('gmail.readonly'));
 const result = await callback(flow); assert.ok(result.headers.location.includes('connected=gmail'));
 const integration = await db.integration.findUniqueOrThrow({ where: { userId: owner.id } }); assert.ok(integration.gmailTokens); assert.ok(!integration.gmailTokens.includes('test-refresh-token')); assert.equal(JSON.parse(decrypt(integration.gmailTokens)).refresh_token, 'test-refresh-token');
});
test('partially granted Gmail permission does not connect the mailbox', async () => {
 const owner = await account(); const flow = await begin('gmail', await session(owner.id)); grantedScope = 'openid email profile https://www.googleapis.com/auth/gmail.readonly'; const result = await callback(flow); assert.match(callbackError(result), /Both Gmail/); assert.equal((await db.integration.findUniqueOrThrow({ where: { userId: owner.id } })).gmailTokens, null);
});

test('a different Google identity cannot connect Gmail for a linked owner', async () => {
 const owner = await account('owner@gmail.com', 'previous-google-subject'); const flow = await begin('gmail', await session(owner.id)); const result = await callback(flow); assert.match(callbackError(result), /Gmail account used/); assert.equal(new URL(result.headers.location).searchParams.get('view'), 'settings'); assert.equal((await db.integration.findUniqueOrThrow({ where: { userId: owner.id } })).gmailTokens, null);
});
