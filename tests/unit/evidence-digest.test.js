"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const E=require('../support/enc'),H=require('../../src/evidence.js');
const expected=bytes=>crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
test('cooperative SHA preserves every padding/chunk boundary and byte view',async()=>{
  for(const n of [0,1,54,55,56,57,63,64,65,119,120,127,128,65535,65536,65537,1048576]){
    const backing=Uint8Array.from({length:n+8},(_,i)=>(i*37+19)%256),bytes=backing.subarray(4,n+4);
    const got=await E.hash.sha256Async(bytes,async()=>true);
    assert.equal(E.hash.hex(got),expected(bytes),'length '+n);
    assert.equal(E.hash.hex(E.hash.sha256(bytes)),expected(bytes));
  }
  assert.equal(E.hash.hex(await E.hash.sha256Async([97,98,99],async()=>true)),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('cooperative SHA cancellation never returns a partial digest, including empty input',async()=>{
  assert.equal(await E.hash.sha256Async(new Uint8Array(),async()=>false),null);
  let calls=0;assert.equal(await E.hash.sha256Async(new Uint8Array(1048576),async()=>++calls<2),null);assert.equal(calls,2);
  await assert.rejects(E.hash.sha256Async('abc',async()=>true),{name:'TypeError'});
  await assert.rejects(E.hash.sha256Async(new Uint8Array()),{name:'TypeError'});
});
const compare=(x,y)=>(String(x[0])<String(y[0])?-1:String(x[0])>String(y[0])?1:0)||x[1]-y[1];
const tuple=(i)=>[['recent','reference','history','recorded-seasonal','seasonal-history'][i%5],i%769,i/7,i%3?0:-0,i%17?198+i%5:null,i%11?'covered':'missing',i*16,'complete'];
for(const n of [0,1,255,256,257,2049,10000,200000])test('request digest preserves complete JSON/UTF-8 bytes across tuple chunks: '+n,async()=>{
  const tuples=Array.from({length:n},(_,i)=>tuple(n-i)),original=JSON.stringify(tuples),packKey=['π','BTC/USDT','雪🙂','\ud800'],revision={label:'\n"\\',value:null};
  const text=JSON.stringify([packKey,revision,tuples.slice().sort(compare)]),want=crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(await H.sourceDigest({packKey,revision,tuples},E.hash),want);
  assert.equal(await H.sourceDigest({packKey,revision,tuples},E.hash,{digestBytes:async bytes=>new Uint8Array(await crypto.webcrypto.subtle.digest('SHA-256',bytes))}),want);
  assert.equal(JSON.stringify(tuples),original,'caller-owned tuple order remains unchanged');
});
test('native digest rejection falls back without changing bytes or requiring a secure context',async()=>{
  const args={packKey:['fallback'],revision:null,tuples:[tuple(3),tuple(1)]},text=JSON.stringify([args.packKey,args.revision,args.tuples.slice().sort(compare)]),phases=[];
  const got=await H.sourceDigest(args,E.hash,{digestBytes:async()=>{throw Error('native unavailable');},phase:name=>{phases.push([name,'start']);return outcome=>phases.push([name,outcome??'completed']);}});
  assert.equal(got,crypto.createHash('sha256').update(text).digest('hex'));
  assert.ok(phases.some(x=>x[0]==='digest.native-sha256'&&x[1]==='failed'));
  assert.ok(phases.some(x=>x[0]==='digest.cooperative-sha256'&&x[1]==='completed'));
});
test('a cancelled request cannot publish a late native digest',async()=>{
  let cancelled=false,release,entered;const ready=new Promise(resolve=>entered=resolve);
  const promise=H.sourceDigest({packKey:['late'],revision:null,tuples:[tuple(1)]},E.hash,{cancelled:()=>cancelled,digestBytes:()=>{entered();return new Promise(resolve=>release=resolve);}});
  await ready;cancelled=true;release(new Uint8Array(32).fill(9));assert.equal(await promise,null);
});
