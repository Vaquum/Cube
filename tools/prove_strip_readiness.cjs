#!/usr/bin/env node
"use strict";
// Replay saved real strip responses locally through the page's actual matcher. No network or production writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
if(process.argv.length!==3)throw Error('Usage: node tools/prove_strip_readiness.cjs saved-grids.json');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),history=input.history,detail=input.detail;
assert.deepEqual(history.snapshot,detail.snapshot,'the grids must belong to the same publication');
const forces=['macro','positioning','news','social'],HOUR=3600000,DAY=24*HOUR,g=history.grid,d=detail.grid;
assert.equal(g.step,HOUR);assert.equal(d.step,HOUR);
const offset=(d.t0-g.t0)/HOUR;assert.ok(Number.isInteger(offset)&&offset>=0);
const forceInputs=Object.fromEntries(forces.map(force=>{
  const components=Object.entries(history.components).filter(([,c])=>c.force===force).map(([name])=>name);
  assert.ok(components.every(name=>Array.isArray(d.parts?.[name])),'component detail is required for the saved tail');
  const masks=g.next24h.map((_,i)=>{
    const k=i-offset;
    if(k<0||k>=d.next24h.length){assert.equal(g.forces[force][i],null,'finite forces outside the detailed tail require an earlier detail capture');return 0;}
    assert.equal(g.forces[force][i],d.forces[force][k]);
    return components.reduce((mask,name,j)=>mask+(d.parts[name][k]!==null?2**j:0),0);
  });return [force,{components,masks}];
}));
const held={...g,forceInputs,components:history.components},source=fs.readFileSync(path.join(__dirname,'../src/explorer.js'),'utf8'),
  atCode=source.slice(source.indexOf('  function stripAt('),source.indexOf('  // The held grid that covers a time')),
  trackCode=source.slice(source.indexOf('  const stripTrackInputs ='),source.indexOf('  // Strip measurements share')),
  context=vm.createContext({STRIP_FORCES:forces,STRIP_HOUR:HOUR,STRIP_DAY:DAY,STRIP_SUPPORT:30,stripRt:{history:held}});
assert.ok(atCode.includes('function stripAt(')&&trackCode.includes('function stripTrack('));
vm.runInContext(atCode+trackCode,context);
const at=Math.min(history.cutoff,g.t0+g.next24h.length*HOUR)-1,edge=history.cutoff,
  track=vm.runInContext(`stripTrack(${at},${edge},null)`,context),
  last=Math.min(g.next24h.length,Math.ceil((Math.min(at,edge)-DAY-g.t0)/HOUR))-1,
  oldDimensions=forces.filter(force=>{
    const now=Math.floor((at-g.t0)/HOUR);return g.forces[force][now]!==null&&g.forces[force].slice(0,last+1).filter(v=>v!==null).length>0.5*(last+1);
  }),quantile=(values,q)=>{const s=values.toSorted((a,b)=>a-b),x=(s.length-1)*q,i=Math.floor(x);return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*(x-i);};
for(const p of track.near){
  assert.ok(g.t0+p.i*HOUR+DAY<Math.min(at,edge),'all selected outcomes must have completed');
  for(const force of track.dims)assert.equal(forceInputs[force].masks[p.i],forceInputs[force].masks[Math.floor((at-g.t0)/HOUR)]);
}
const values=track.all.map(p=>p.r),ready=track.near.length>=30&&track.dims.length>0;
console.log(JSON.stringify({origin:'saved production responses replayed locally; actual page matcher',model:history.model,
  snapshot:history.snapshot,at:new Date(at).toISOString(),priceGridHours:g.next24h.length,
  previousComparedForces:oldDimensions,comparedForces:track.dims,similarMoments:track.near.length,
  requiredMoments:30,allMoments:track.all.length,conditionalAvailable:ready,baselineAvailable:track.all.length>=30,
  baselineQuantiles:Object.fromEntries([.05,.5,.95].map(q=>['p'+Math.round(q*100),quantile(values,q)])),
  selectedInputsIdentical:true,allSelectedOutcomesCompleted:true},null,2));
