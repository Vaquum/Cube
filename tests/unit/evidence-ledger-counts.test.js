"use strict";
// Compare the actual private cooperative pass with the pre-edit independent
// filters, including all first-failure and per-horizon partitions at the cap.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const H=require('../../src/evidence.js'),source=fs.readFileSync(require.resolve('../../src/explorer.js'),'utf8');
const definition=source.match(/  async function prepareLedgerCounts\([^]*?\n  \}/)[0],scope={window:{explorerEvidence:H}};
vm.runInNewContext(definition+'\nthis.counts=prepareLedgerCounts;',scope);
function study(length){
  const ledger=Array.from({length},(_,i)=>({reason:i%11<H.REASONS.length?H.REASONS[i%11]:null,state:i%11<H.REASONS.length?null:[0,1,2],matched:i%3===0,
    outcomes:Object.fromEntries(Array.from({length:8},(_,h)=>[h+1,{reason:(i+h)%7===0?'Missing horizon coverage':(i+h)%13===0?'Unfinished horizon':null}]))}));
  const cases=Array.from({length:9},(_,h)=>ledger.filter(r=>r.state&&!r.outcomes[h]?.reason)),matched=cases.map(rows=>rows.filter(r=>r.matched));
  return {ledger,cases,matched};
}
function reference(e,h){
  const firstFailures=Object.fromEntries(H.REASONS.map(reason=>[reason,e.ledger.filter(r=>r.reason===reason).length])),eligible=e.ledger.filter(r=>r.state),matching=eligible.filter(r=>r.matched);
  return {starts:e.ledger.length,firstFailures,stateEligible:eligible.length,matching:matching.length,nonmatching:eligible.length-matching.length,matchingCompleted:e.matched[h].length,baselineCompleted:e.cases[h].length,
    missingHorizon:eligible.filter(r=>r.outcomes[h]?.reason==='Missing horizon coverage').length,unfinished:eligible.filter(r=>r.outcomes[h]?.reason==='Unfinished horizon').length};
}
test('all eight cap-sized ledger count partitions match the original filters',async()=>{
  const e=study(100000);
  for(let h=1;h<=8;h++)assert.deepEqual(JSON.parse(JSON.stringify(await scope.counts(e,h,async stage=>{assert.equal(stage,'ledger-counts');return true;}))),reference(e,h));
});
test('empty and mixed ledger preparation never mutates the study',async()=>{
  for(const length of [0,1,511,512,513]){const e=study(length),before=JSON.stringify(e);assert.deepEqual(JSON.parse(JSON.stringify(await scope.counts(e,4,async()=>true))),reference(e,4));assert.equal(JSON.stringify(e),before);}
});
test('obsolete ledger preparation stops at its next bounded checkpoint',async()=>{
  let reads=0,checks=0;const row={state:null,reason:null},ledger=new Proxy({length:100000},{get:(target,key)=>key==='length'?target.length:(reads++,row)});
  const result=await scope.counts({ledger,cases:Array.from({length:9},()=>[]),matched:Array.from({length:9},()=>[])},1,async()=>++checks<3);
  assert.equal(result,null);assert.equal(checks,3);assert.equal(reads,1024);
});
