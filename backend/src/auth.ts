import { randomBytes } from 'node:crypto';
import type { Request,Response,NextFunction } from 'express';
import { db } from './db.js';
import { config } from './config.js';
import { hashToken } from './security.js';
declare global { namespace Express { interface Request { userId:string; } } }
export const cookieOptions={httpOnly:true,secure:config.production,sameSite:'lax' as const,path:'/'};
export async function createSession(res:Response,userId:string) {
 const token=randomBytes(32).toString('base64url'); const expiresAt=new Date(Date.now()+7*86400000);
 await db.session.create({data:{userId,tokenHash:hashToken(token),expiresAt}});
 res.cookie('jobnest_session',token,{...cookieOptions,expires:expiresAt});
}
export async function requireAuth(req:Request,res:Response,next:NextFunction) {
 const token=req.cookies.jobnest_session; if(!token){res.status(401).json({error:'Please sign in.'});return;}
 const session=await db.session.findUnique({where:{tokenHash:hashToken(token)}});
 if(!session || session.expiresAt.getTime()<Date.now()){res.clearCookie('jobnest_session',cookieOptions);res.status(401).json({error:'Your session has expired. Please sign in.'});return;}
 req.userId=session.userId; next();
}
