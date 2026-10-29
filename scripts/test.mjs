import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const databaseUrl=process.env.TEST_DATABASE_URL||'postgresql://jobnest:jobnest@127.0.0.1:5433/jobnest_test?schema=public';
if(!new URL(databaseUrl).pathname.endsWith('_test'))throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database.');
const env={...process.env,DATABASE_URL:databaseUrl,OWNER_EMAIL:'',TOKEN_ENCRYPTION_KEY:'a'.repeat(64),AI_API_KEY:'',AI_MODEL:'',AI_PROVIDER:'compatible',BRAVE_SEARCH_API_KEY:'',TELEGRAM_BOT_TOKEN:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''};
const cwd=path.join(root,'backend');
for(const args of [[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy'],['--import','tsx','--test','--test-concurrency=1',...readdirSync(path.join(cwd,'tests')).filter(n=>n.endsWith('.test.ts')).map(n=>'tests/'+n)]]){
 const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
