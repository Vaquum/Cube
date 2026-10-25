"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../src/explorer.js'),'utf8');
const definition=name=>source.match(new RegExp('  function '+name+'\\([^]*?\\n  \\}'))[0];
function owner(mode=null){const map=new Map(),scope={histories:map,historyKey:(n,m)=>n+','+m,CUT:64,CANON:60,activeAnalysis:mode?{mode}:null};vm.runInNewContext(definition('historyBoundary')+'\n'+definition('heldHistory')+'\nthis.read=heldHistory;',scope);return {map,read:scope.read};}
test('live histories still require completed support and explicit canonical freshness',()=>{
  const x=owner();for(const held of [{b1:64},{b1:63,canonicalThrough:60},{b1:64,canonicalThrough:59}]){x.map.set('4,0',held);assert.equal(x.read(4,0),null);}
  const current={b1:64,canonicalThrough:60,sourcePack:'actual'};x.map.set('4,0',current);assert.equal(x.read(4,0),current);
});
test('captured histories retain frozen legacy inputs and provenance without manufacturing freshness',()=>{
  const x=owner('captured');assert.equal(x.read(4,0),null);
  for(const held of [{b0:0,b1:64,sourcePack:'captured-old'},{b0:0,b1:48,canonicalThrough:32,sourcePack:'captured-short'}]){const before=JSON.stringify(held);x.map.set('4,0',held);assert.equal(x.read(4,0),held);assert.equal(JSON.stringify(held),before);}
});
