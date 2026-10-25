#!/usr/bin/env node
// --serve opens no browser. The user-authorized side panel can visit this page.
import { serveStudy } from './benchmark/continuations-page.mjs';
if(process.argv[2]!=='--serve' || !process.argv[3]) throw Error('Usage: node tools/diagnose_continuations.mjs --serve <commit> [port]');
const server=await serveStudy(process.argv[3],Number(process.argv[4]??8793));
process.stdout.write(JSON.stringify({url:server.url,identity:server.identity,htmlSha256:server.htmlSha256})+'\n');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit();});
