"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const H=require('../../src/evidence.js'),E=require('../support/enc'),fixture=require('../support/evidence-study'),golden=require('../fixtures/evidence-study.json');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const compact=fields=>Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,Array.isArray(value) ? value.map(x=>({count:x.count,root:x.root})) : Object.fromEntries(['count','root'].filter(k=>k in value).map(k=>[k,value[k]]))]));
test('fixed pre-optimization inputs cannot drift with a candidate',()=>{
  assert.equal(digest(fs.readFileSync(require.resolve('../support/evidence-study.js'))),golden.fixtureSha256);
});
for(const expected of golden.cases) test('whole deterministic evidence characterization: '+expected.name,async()=>{
  const args=fixture.input(E,expected.name),result=await H.compute(args);
  assert.equal(args.provenance.sourceDigest,expected.inputDigest);
  assert.deepEqual(fixture.population(result),expected.population);
  const fingerprint=await fixture.fingerprint(result,digest);
  assert.deepEqual(compact(fingerprint.fields),expected.fields);
  assert.equal(fingerprint.root,expected.root);
});
test('bounded fingerprint includes nested records, every horizon and publication fields',async()=>{
  const sample={ledger:Array.from({length:300},(_,i)=>({i,knownThrough:i+1,seasonal:{matches:[{reason:'outside-support'}]}})),cases:Array.from({length:9},(_,h)=>[{h,delta:h}]),matched:Array.from({length:9},()=>[]),uncertainty:{seed:17,key:['method'],intervals:{up:[1,2]}}};
  const before=await fixture.fingerprint(sample,digest);
  sample.ledger[299].seasonal.matches[0].reason='missing';
  const ledger=await fixture.fingerprint(sample,digest);assert.notEqual(ledger.fields.ledger.root,before.fields.ledger.root);
  sample.cases[8][0].delta=99;
  const horizon=await fixture.fingerprint(sample,digest);assert.notEqual(horizon.fields.cases[8].root,ledger.fields.cases[8].root);
  sample.uncertainty.seed=18;
  const publication=await fixture.fingerprint(sample,digest);assert.notEqual(publication.fields.uncertainty.root,horizon.fields.uncertainty.root);
  assert.equal(before.fields.ledger.chunks.length,3);
});
