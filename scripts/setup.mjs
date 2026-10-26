import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const folder of ['backend','frontend']){const target=path.join(root,folder,'.env');try{await fs.access(target);}catch{let source=await fs.readFile(path.join(root,folder,'.env.example'),'utf8');if(folder==='backend')source=source.replace('TOKEN_ENCRYPTION_KEY=','TOKEN_ENCRYPTION_KEY='+randomBytes(32).toString('hex'));await fs.writeFile(target,source,{mode:0o600});console.log('Created '+folder+'/.env');}}
const result=spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'generate'],{cwd:path.join(root,'backend'),stdio:'inherit'});process.exit(result.status||0);
