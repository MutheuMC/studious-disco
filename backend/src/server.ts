import './config.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
const app=createApp();
const listening=()=>console.log(typeof config.port==='number'?'JobNest API: http://'+config.host+':'+config.port:'JobNest API: listening through IIS');
const server=typeof config.port==='number'?app.listen(config.port,config.host,listening):app.listen(config.port,listening);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>void db.$disconnect().then(()=>process.exit(0))));
