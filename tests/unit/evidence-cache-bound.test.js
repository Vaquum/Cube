"use strict";
// Execute the actual private policy/decoder in isolation, with hand-sized
// populations. No large allocations, browser or duplicated implementation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../src/explorer.js'),'utf8');
const definition=name=>{const found=source.match(new RegExp('  (?:async )?function '+name+'\\([^]*?\\n  \\}'));assert.ok(found,name);return found[0];};
function policy(){
  const cache=new Map(),scope={evidenceCache:cache};
  const bound=source.match(/  const EVIDENCE_CACHE_BYTES = [^;]+;/)[0];
  vm.runInNewContext(bound+'\n'+definition('evidenceBytes')+'\n'+definition('retainEvidence')+'\nthis.policy={put:retainEvidence,bytes:evidenceBytes,limit:EVIDENCE_CACHE_BYTES};',scope);
  return {cache,...scope.policy};
}
const study=(rows,cases=0,matches=0)=>({ledger:{length:rows},cases:Array.from({length:9},(_,h)=>({length:h?cases:0})),matched:Array.from({length:9},(_,h)=>({length:h?matches:0})),provenance:{sourceDigest:'fixed'},uncertainty:{seed:17}});
test('local evidence retention keeps six small studies but never exceeds its estimated byte budget',()=>{
  const p=policy();assert.equal(p.limit,512*1024*1024);
  for(let i=0;i<8;i++)p.put(String(i),study(40,30,10));assert.deepEqual([...p.cache.keys()],['2','3','4','5','6','7']);
  assert.ok([...p.cache.values()].reduce((n,x)=>n+p.bytes(x),0)<=p.limit);
});
test('two cap-sized complete studies evict the older one without changing either result',()=>{
  const p=policy(),a=study(100000,97311,4890),b=study(100000,97311,4890),before=JSON.stringify(a);
  assert.ok(p.bytes(a)>p.limit/2&&p.bytes(a)<=p.limit);
  p.put('a',a);p.put('b',b);assert.deepEqual([...p.cache.keys()],['b']);assert.equal(p.cache.get('b'),b);assert.equal(JSON.stringify(a),before);
});
test('loading or oversized results cannot displace completed bounded entries',()=>{
  const p=policy();for(let i=0;i<6;i++)p.put(String(i),study(10));
  p.put('pending',{loading:true});p.put('oversized',study(200000,199000,199000));
  assert.deepEqual([...p.cache.keys()],['0','1','2','3','4','5']);
});
test('history decoding refuses an oversized or malformed retained population before allocation',async()=>{
  const scope={inflate:async block=>block.buffer};vm.runInNewContext(definition('unpackHistory')+'\nthis.decode=unpackHistory;',scope);
  function block(count,bytes=32){const buffer=new ArrayBuffer(bytes),v=new DataView(buffer);new Uint8Array(buffer).set([77,83,67,67]);v.setUint32(16,count,true);return {buffer,b0:0,b1:16};}
  await assert.rejects(scope.decode(block(100001)),/Invalid bounded column history/);
  await assert.rejects(scope.decode(block(1)),/Invalid bounded column history/);
  const empty=await scope.decode(block(0));assert.equal(empty.cols.length,0);
});
