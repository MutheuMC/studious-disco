import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as load } from 'dotenv';
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
load({path:path.join(backendRoot,'.env'),quiet:true});
const rawPort = process.env.PORT?.trim();
const port = rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort || 4000;
export const normalizeOrigin = (value:string) => new URL(value).origin;
export const config = {
 host:process.env.HOST || '127.0.0.1',port, production:process.env.NODE_ENV === 'production',
 frontend:normalizeOrigin(process.env.FRONTEND_URL || 'http://127.0.0.1:3000'),
 ownerEmail:process.env.OWNER_EMAIL?.trim().toLowerCase(), storage:path.join(backendRoot,'storage'),
 encryptionKey:process.env.TOKEN_ENCRYPTION_KEY || '',
 googleId:process.env.GOOGLE_CLIENT_ID || '', googleSecret:process.env.GOOGLE_CLIENT_SECRET || '',
 googleRedirect:process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:3000/api/google/callback',
 telegramToken:process.env.TELEGRAM_BOT_TOKEN || '', telegramUsername:process.env.TELEGRAM_BOT_USERNAME || '',
 aiKey:process.env.AI_API_KEY || '', aiBase:process.env.AI_BASE_URL || 'https://api.openai.com/v1', aiModel:process.env.AI_MODEL || '',
 searchKey:process.env.BRAVE_SEARCH_API_KEY || ''
};
