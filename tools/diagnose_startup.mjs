#!/usr/bin/env node
// Replays an actual bridge page against two published builds. The pack stays a
// local input; requests go through an optional read-only bridge tunnel.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
const require=createRequire(import.meta.url);
const {materialise}=require('../tests/support/builds.js');
const input=process.argv[2], baseline=process.argv[3]||'f860aeb';
if(!input) throw Error('Usage: node tools/diagnose_startup.mjs BRIDGE_PAGE [BASELINE]');
const pack=fs.readFileSync(input,'utf8').match(/<script type="application\/json" id="origo-lens-data">([\s\S]*?)<\/script>/)[1];
const out=path.resolve('reports/startup');fs.mkdirSync(out,{recursive:true});
const bridge=process.env.CUBE_DIAGNOSTIC_BRIDGE;
const browser=await chromium.launch();
const report=[];
try {
 for(const ref of [baseline,'HEAD']) {
  const build=materialise(ref,`startup-${ref}`);
  const html=fs.readFileSync(path.join(build.dir,'index.html'),'utf8').replace(/(<script type="application\/json" id="origo-lens-data">)[\s\S]*?(<\/script>)/,`$1${pack}$2`);
  const server=http.createServer((req,res)=>{
   if(req.url.startsWith('/cube/')&&bridge) {
    const remote=http.get(bridge+req.url,r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});remote.on('error',()=>{res.writeHead(502);res.end('{}');});return;
   }
   if(req.url.startsWith('/cube/')) {res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"diagnostic bridge unavailable"}');return;}
   if(req.url.startsWith('/vendor/')) {res.writeHead(200,{'Content-Type':'application/javascript'});res.end(fs.readFileSync(path.join(build.dir,'vendor',path.basename(req.url))));return;}
   res.writeHead(200,{'Content-Type':'text/html'});res.end(html);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const context=await browser.newContext({viewport:{width:1500,height:950},reducedMotion:'no-preference'});
  await context.addInitScript(()=>{
   const native=requestAnimationFrame;window.__startup={frames:[],tasks:[],firstCanvas:null,firstVisible:null,events:[]};
   const long=new PerformanceObserver(list=>{for(const e of list.getEntries())__startup.tasks.push({at:e.startTime,ms:e.duration});});long.observe({type:'longtask',buffered:true});
   const width=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width');let drawn=false;
   Object.defineProperty(HTMLCanvasElement.prototype,'width',{...width,set(value){if(this.id==='ol-canvas')drawn=true;width.set.call(this,value);}});
   window.requestAnimationFrame=cb=>native(t=>{const at=performance.now();drawn=false;try{return cb(t);}finally{__startup.frames.push({at,ms:performance.now()-at,drawn});if(drawn&&__startup.firstCanvas===null)__startup.firstCanvas=performance.now();}});
   const visible=()=>{const main=document.querySelector('#ol-main');if(__startup.firstCanvas!==null&&main&&Number(getComputedStyle(main).opacity)>.9&&__startup.firstVisible===null)__startup.firstVisible=performance.now();native(visible);};native(visible);
   for(const type of ['keydown','click'])addEventListener(type,e=>{__startup.events.push({at:performance.now(),type,key:e.key});},{capture:true});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  await page.goto(`http://127.0.0.1:${server.address().port}/#w=7d&pane=volume`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.cubeAgent),{},{timeout:60000});
  await page.waitForTimeout(1000);
  const startup=await page.evaluate(()=>({...__startup,loading:document.querySelector('#ol-loading').textContent}));
  await page.locator('#ol-canvas').focus();await page.keyboard.press('Shift+ArrowLeft');await page.waitForTimeout(3000);
  const navigation=await page.evaluate(()=>({...__startup,loading:document.querySelector('#ol-loading').textContent,hash:location.hash}));
  const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(out,`cpu-${ref}.json`),JSON.stringify(profile));
  await page.screenshot({path:path.join(out,`${ref}.png`)});
  report.push({ref,sha:build.sha,errors,startup,navigation});console.log(JSON.stringify({ref,firstCanvas:startup.firstCanvas,firstVisible:startup.firstVisible,longTasks:startup.tasks,slowDraws:startup.frames.filter(x=>x.drawn&&x.ms>20),errors}));
  await context.close();await new Promise(r=>server.close(r));
 }
}finally{await browser.close();}
fs.writeFileSync(path.join(out,'diagnostic.json'),JSON.stringify(report,null,2));
