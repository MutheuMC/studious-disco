import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const databaseDir=path.join(root,'.local','postgres');
const pg=new EmbeddedPostgres({databaseDir,user:'jobnest',password:'jobnest',port:5433,persistent:true,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1']});
try{await fs.access(path.join(databaseDir,'PG_VERSION'));}catch{await fs.mkdir(databaseDir,{recursive:true});await pg.initialise();}
await pg.start();
const client=pg.getPgClient();await client.connect();
for(const name of ['jobnest','jobnest_test']){const result=await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name]);if(!result.rowCount)await client.query("CREATE DATABASE "+name+" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'");}
await client.end();
console.log('Local PostgreSQL ready on 127.0.0.1:5433. Keep this process running.');
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await pg.stop();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
setInterval(()=>{},60000);
