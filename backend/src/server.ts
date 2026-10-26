import './config.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
const server=createApp().listen(config.port,config.host,()=>console.log('JobNest API: http://127.0.0.1:'+config.port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>void db.$disconnect().then(()=>process.exit(0))));
