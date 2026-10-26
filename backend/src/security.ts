import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
const scrypt = promisify(scryptCallback);
export const hashToken = (value:string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password:string) {
 const salt=randomBytes(16).toString('hex'); const key=await scrypt(password,salt,64) as Buffer;
 return salt+':'+key.toString('hex');
}
export async function checkPassword(password:string, stored:string) {
 const [salt,hash]=stored.split(':'); if (!salt || !hash) return false;
 const actual=await scrypt(password,salt,64) as Buffer; const expected=Buffer.from(hash,'hex');
 return actual.length===expected.length && timingSafeEqual(actual,expected);
}
function encryptionKey() {
 if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey)) throw new Error('Set TOKEN_ENCRYPTION_KEY to 64 hexadecimal characters before connecting Gmail.');
 return Buffer.from(config.encryptionKey,'hex');
}
export function encrypt(value:string) {
 const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.');
}
export function decrypt(value:string) {
 const [iv,tag,body]=value.split('.').map(v=>Buffer.from(v,'base64url'));
 const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv); cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(body),cipher.final()]).toString('utf8');
}
