import { isIP } from 'node:net';
import type { Express,Request } from 'express';
import { ipKeyGenerator,rateLimit } from 'express-rate-limit';

export function configureTrustedProxies(app:Express,value:string) {
 const proxies=value.split(',').map(part=>part.trim()).filter(Boolean);
 // Accept only explicit IPs/subnets (and Express's loopback preset), never trust all/hop counts.
 for(const proxy of proxies) {
  const [address,bits,...extra]=proxy.split('/');
  const family=isIP(address);
  if(proxy!=='loopback'&&(!family||extra.length||bits!==undefined&&(!/^\d+$/.test(bits)||Number(bits)<1||Number(bits)>(family===4?32:128)))) {
   throw new Error('TRUSTED_PROXY_ADDRESSES must contain explicit proxy IPs/CIDRs or loopback, separated by commas.');
  }
 }
 app.set('trust proxy',proxies.length?proxies:false);
}

export function clientRateKey(req:Request):string {
 // req.ip honors only Express's configured trusted proxies. Raw forwarded headers
 // (including Forwarded) never become identifiers on their own.
 for(const value of [req.ip,req.socket?.remoteAddress]) {
  if(typeof value==='string'&&isIP(value))return 'ip:'+ipKeyGenerator(value);
 }
 // Some IIS transports/disconnected sockets provide no peer IP. Share a bounded
 // bucket rather than crashing draft-8 header generation or skipping the limit.
 return 'ip:unavailable';
}
export function accountRateKey(req:Request):string {
 return req.userId?'user:'+req.userId:clientRateKey(req);
}
export function createRateLimiter(windowMs:number,limit:number,account=false,message='Too many requests. Try again later.') {
 return rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,
  keyGenerator:account?accountRateKey:clientRateKey,message:{error:message}});
}
