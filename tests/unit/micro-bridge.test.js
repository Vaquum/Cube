"use strict";
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");

test("Micro binds genuine source identities in UTC and reuses the existing slot without adding aggregate flow",()=>{
  execFileSync("python3",["-c",String.raw`
import json, os, sys, threading, time
from pathlib import Path
sys.path.insert(0,str(Path('tools').resolve()))
import micro_bridge
from micro_bridge import MicroStore, relevant_digest
from market_state_reader import MarketStateError
captured=json.loads(Path('tests/fixtures/micro/detail.json').read_text())
pins={r[0]:r[1:3] for r in captured['sources']['trades']['partitions']}
expected=captured['tradePinDigest']
assert relevant_digest(pins,captured['from'],captured['to'])==expected
prior=os.environ.get('TZ')
try:
    os.environ['TZ']='America/New_York';time.tzset()
    assert relevant_digest(pins,captured['from'],captured['to'])==expected
finally:
    if prior is None: os.environ.pop('TZ',None)
    else: os.environ['TZ']=prior
    time.tzset()
class Cube:
    def holding(self,token):
        assert token=='held-capture'
        return {'pins':pins,'state':{'data_cutoff':'2026-10-24T14:32:00Z'}}
slot=threading.Lock();calls=[]
def original(request,**kwargs):
    assert slot.locked()
    assert request['trade_pin_digest']==expected
    calls.append(request)
    return captured
micro_bridge.micro=original
store=MicroStore(Cube(),'http://127.0.0.1:9',slot)
request={'pack':'held-capture','from':captured['from'],'to':captured['to'],'step':1000,'as_of':captured['asOf']}
assert store.query(request)==captured
assert store.query(request)==captured and len(calls)==1
assert not slot.locked()
try: store.query(request|{'as_of':captured['from']})
except ValueError: rejected=True
else: rejected=False
assert rejected
`],{stdio:"pipe"});
});
