"use strict";
// Pixel oracle: old calibrated volume survives a held destination calibration.
const {test,expect}=require('./fixtures.js'),S=require('./rows-support.js');
const {popoverAction}=require('./scale-helpers.js');
async function pixels(page,fraction=1){return page.locator('#ol-canvas').evaluate((canvas,fraction)=>{
 const [x,y,w,h]=canvas.dataset.layout.split(',').map(Number),d=devicePixelRatio;
 const a=canvas.getContext('2d').getImageData(Math.ceil(x*d),Math.ceil(y*d),Math.floor(w*d*fraction),Math.floor(h*d)).data;
 let blue=0,opaque=0,hash=2166136261;
 for(let i=0;i<a.length;i+=4){if(a[i+2]>a[i]+8)blue++;if(a[i+3]===255)opaque++;for(let k=0;k<3;k++)hash=Math.imul(hash^a[i+k],16777619);}
 return {blue,opaque,count:a.length/4,hash:hash>>>0};
},fraction);}
async function open(page,fakeFor,probe,hash='#w=24h&vis=2'){
 await page.addInitScript(()=>{let api;Object.defineProperty(window,'explorerEncoding',{get:()=>api,set:value=>{
  api={...value,util:{...value.util,windowLevel:spec=>window.__subdivisionGrid||value.util.windowLevel(spec)},lifecycle:{...value.lifecycle,coherent:(...args)=>window.__holdSubdivisionCalibration?{ok:false,reason:'pending'}:value.lifecycle.coherent(...args)},
   scale:{...value.scale,fitValue(...args){if(window.__watchPreviewFits)window.__previewFits++;return value.scale.fitValue(...args);},fitRank(...args){if(window.__watchPreviewFits)window.__previewFits++;return value.scale.fitRank(...args);}},
   readout:{...value.readout,cellsFrame(...args){const frame=value.readout.cellsFrame(...args),spec=args[0];
    if(window.__previewSamples&&spec.mode==='volume'&&spec.basis==='intensity'&&spec.cutMs===undefined)return {...frame,encode(z,out){
     frame.encode(z,out);const {n,m}=spec.level,ts=2**n,left=window.__previewLeft;
     if(z.c*ts<left&&(z.c+1)*ts>left)window.__previewSamples.push({n,m,c:z.c,r:z.r,v:z.v,value:out.value});return out;
    }};
    return window.__replaceSubdivisionMapping?{...frame,mappingId:frame.mappingId+':next'}:frame;}}};
 }});});
 const fake=await fakeFor('standard');await page.goto(fake.url+'/'+hash);await S.atRest(page,fake,probe);
 await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive())).toBe(false);
 return fake;
}
test('uncached resolution retains colour and rests while calibration waits',async({page,fakeFor,probe})=>{
 await open(page,fakeFor,probe);const before=await pixels(page);expect(before.blue).toBeGreaterThan(1000);
 await page.evaluate(()=>{window.__holdSubdivisionCalibration=true;});
 await page.locator('#ol-canvas').focus();await page.keyboard.press(']');
 await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision','waiting');
 for(let i=0;i<8;i++){const now=await pixels(page);expect(now.blue).toBeGreaterThan(before.blue*.9);expect(now.opaque).toBe(now.count);await page.waitForTimeout(30);}
 await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive()),{timeout:2500}).toBe(false);
 await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision','waiting');
 // A real data arrival calls update/scaleArm. This test-only coherence hold
 // releases through an unchanged-grid native update, without polling in motion.
 await page.evaluate(()=>{window.__holdSubdivisionCalibration=false;document.querySelector('#ol-poc').click();});
 await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
 await expect(page.locator('#ol-legend')).toHaveAttribute('data-state','ready');expect((await pixels(page)).blue).toBeGreaterThan(1000);
});
test('native time selection and rapid reversal settle to the same volume field',async({page,fakeFor,probe})=>{
 await open(page,fakeFor,probe);const before=await pixels(page);
 await page.locator('#ol-window').click();await page.locator('[data-window="4h"]').click();
 await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision',/waiting|dividing|joining|blending/);
 expect((await pixels(page)).blue).toBeGreaterThan(100);
 await page.locator('#ol-window').click();await page.locator('[data-window="24h"]').click();
 await expect(page.locator('#ol-window-text')).toHaveText('24h');
 await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
 await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive())).toBe(false);
 await expect.poll(async()=>(await pixels(page)).hash).toBe(before.hash);
});
test('newly revealed history stays coloured through a held wider-window tile and calibration',async({page,fakeFor,probe})=>{
 const fake=await open(page,fakeFor,probe), before=await pixels(page);
 const gate=fake.on({route:'/cube/tile'}).gate();
 const choose=async key=>{await page.locator('#ol-window').click();await page.locator(`[data-window="${key}"]`).click();};
 try {
  await page.evaluate(()=>{window.__subdivisionGrid={n:10,m:2};window.__holdSubdivisionCalibration=true;});
  await choose('180d');await gate.arrived();
  await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive()),{timeout:2500}).toBe(false);
  await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision','waiting');
  // The outgoing day occupies <1% of this view, at the right edge. Whole-plot
  // counts miss the regression: require colour in the newly exposed history.
  const historical=await pixels(page,.75);
  expect(historical.blue).toBeGreaterThan(1000);expect(historical.opaque).toBe(historical.count);
  gate.open();await fake.idle();
  await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive()),{timeout:2500}).toBe(false);
  expect((await pixels(page,.75)).blue).toBeGreaterThan(1000);
  await page.evaluate(()=>{window.__holdSubdivisionCalibration=false;document.querySelector('#ol-poc').click();});
  await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
  expect((await pixels(page,.75)).blue).toBeGreaterThan(1000);
  await page.evaluate(()=>{window.__subdivisionGrid=null;});
  await choose('24h');await S.atRest(page,fake,probe);
  await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive())).toBe(false);
  // Restore the test's POC toggle before comparing the native settled field.
  await page.locator('#ol-poc').evaluate(node=>node.click());await S.atRest(page,fake,probe);
  await expect.poll(async()=>(await pixels(page)).hash).toBe(before.hash);
 } finally {gate.open();await page.evaluate(()=>{window.__holdSubdivisionCalibration=false;});}
});
test('a calibration arriving mid-camera keeps colour beyond the presented viewport',async({page,fakeFor,probe})=>{
 await page.addInitScript(()=>{let api;Object.defineProperty(window,'explorerMotion',{get:()=>api,set:motion=>{
  api={...motion,spring(owner,name,options){
   const camera=name==='cells-camera',detail=name==='cells';
   return motion.spring(owner,name,camera||detail?{...options,
    canComplete:()=>camera?window.__cameraProgress==null:!window.__holdDetail,
    write(value){options.write(camera&&window.__cameraProgress!=null?{progress:window.__cameraProgress}:detail&&window.__holdDetail?{progress:0}:value);}
   }:options);
  }};
 }});});
 const fake=await open(page,fakeFor,probe),gate=fake.on({route:'/cube/tile'}).gate();
 try {
  await page.evaluate(()=>{window.__subdivisionGrid={n:10,m:2};window.__holdSubdivisionCalibration=true;window.__cameraProgress=.35;window.__holdDetail=true;});
  await page.locator('#ol-window').click();await page.locator('[data-window="180d"]').click();await gate.arrived();
  await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision','waiting');
  await page.evaluate(()=>{window.__holdSubdivisionCalibration=false;});gate.open();
  await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision',/dividing|joining|blending/);
  // The final detail is still at alpha zero. Advance only the camera to expose
  // the history outside the viewport captured when calibration landed.
  await page.evaluate(()=>{window.__cameraProgress=1;});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect((await pixels(page,.15)).blue).toBeGreaterThan(1000);
  // A subsequent mapping handoff must keep that full coverage too.
  await page.evaluate(()=>{window.__cameraProgress=.8;window.__replaceSubdivisionMapping=true;document.querySelector('#ol-poc').click();});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{window.__cameraProgress=1;});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect((await pixels(page,.15)).blue).toBeGreaterThan(1000);
 } finally {gate.open();await page.evaluate(()=>{window.__cameraProgress=null;window.__holdDetail=false;window.__holdSubdivisionCalibration=false;});}
});
test('wider-window preview honours a held comparison mapping without fitting',async({page,fakeFor,probe,surface})=>{
 // Keep the calibration context stable while the scale dialog changes layout.
 const fake=await open(page,fakeFor,probe,'#w=24h&vis=2&r=7,0');
 await popoverAction(page,surface,'cells','Comparison lock');await S.atRest(page,fake,probe);
 expect((await surface.chip('cells')).data.policy).toBe('comparison');
 const held=(await surface.chip('cells')).data.mappingId, gate=fake.on({route:'/cube/tile'}).gate();
 expect(held).not.toBe('');
 try {
  await page.evaluate(()=>{window.__subdivisionGrid={n:10,m:2};window.__holdSubdivisionCalibration=true;window.__previewFits=0;window.__watchPreviewFits=true;});
  await page.locator('#ol-window').click();await page.locator('[data-window="180d"]').click();await gate.arrived();
  await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive()),{timeout:2500}).toBe(false);
  expect((await pixels(page,.75)).blue).toBeGreaterThan(1000);
  expect(await page.evaluate(()=>window.__previewFits)).toBe(0);
  expect((await surface.chip('cells')).data.mappingId).toBe(held);
 } finally {gate.open();await page.evaluate(()=>{window.__watchPreviewFits=false;window.__holdSubdivisionCalibration=false;});}
});
test('Intensity preview crops pixels without inflating a boundary cell rate',async({page,fakeFor,probe})=>{
 const fake=await open(page,fakeFor,probe);
 await page.locator('#ol-mode').click();await page.locator('#ol-mode-menu [data-mode-step="basis"]').click();
 await page.getByRole('menuitemradio',{name:/^Intensity/}).click();await page.keyboard.press('Escape');await S.atRest(page,fake,probe);
 const gate=fake.on({route:'/cube/tile'}).gate();
 try {
  await page.evaluate(()=>{
   window.__holdSubdivisionCalibration=true;window.__subdivisionGrid={n:10,m:2};window.__previewSamples=[];
   window.__previewLeft=(Date.parse('2026-09-24T12:02:00Z')/1000-1609459200)/56.25-180*1536;
  });
  await page.locator('#ol-window').click();await page.locator('[data-window="180d"]').click();await gate.arrived();
  const samples=await page.evaluate(()=>window.__previewSamples);expect(samples.length).toBeGreaterThan(0);
  for(const s of samples){
   const ts=2**s.n,ps=2**s.m,source=fake.cube.read(s.n,s.m,s.c*ts,(s.c+1)*ts,s.r*ps,(s.r+1)*ps).cells;
   expect(source.vol.length).toBe(1);expect(s.v).toBeCloseTo(source.vol[0],7);
   // Independent units: USDT / (minutes × number of 125-USDT price bands).
   expect(s.value).toBeCloseTo(source.vol[0]/(56.25*ts/60*ps),9);
  }
 } finally {gate.open();await page.evaluate(()=>{window.__holdSubdivisionCalibration=false;window.__previewSamples=null;});}
});
test('multiple inputs before the first paint retain the last coloured field',async({page,fakeFor,probe})=>{
 await open(page,fakeFor,probe);const before=await pixels(page);
 await page.evaluate(()=>{
  window.__holdSubdivisionCalibration=true;
  document.querySelector('#ol-tplus').click();document.querySelector('#ol-tplus').click();
 });
 await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision','waiting');
 expect((await pixels(page)).blue).toBeGreaterThan(before.blue*.9);
 await page.evaluate(()=>{window.__holdSubdivisionCalibration=false;document.querySelector('#ol-poc').click();});
 await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
});
test('reduced motion, direct navigation and mode changes release presentation',async({page,fakeFor,probe})=>{
 await open(page,fakeFor,probe);await page.locator('#ol-canvas').focus();await page.keyboard.press(']');
 await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision',/.+/);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.keyboard.press('[');await page.keyboard.press('Shift+ArrowLeft');
 await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
 await page.keyboard.press(']');await page.keyboard.press('k');await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
});
test('a new calibration keeps the camera at its presented position',async({page,fakeFor,probe})=>{
 await page.addInitScript(()=>{let api;Object.defineProperty(window,'explorerMotion',{get:()=>api,set:motion=>{
  api={...motion,spring(owner,name,options){return motion.spring(owner,name,name==='cells-camera'?{...options,
   canComplete:()=>!window.__holdSubdivisionCamera,write(value){options.write(window.__holdSubdivisionCamera?{progress:.5}:value);}}:options);}};
 }});});
 await open(page,fakeFor,probe);
 // Observe the real descending plot scale through D3, without a production hook.
 await page.evaluate(()=>{
  const linear=d3.scaleLinear;window.__holdSubdivisionCamera=true;
  d3.scaleLinear=()=>{const scale=linear(),range=scale.range,domain=scale.domain;let plot=false;
   scale.range=function(values){if(!arguments.length)return range();const result=range(values);plot=values[1]===12&&values[0]>12;if(plot)window.__subdivisionPriceCamera=domain();return result;};
   scale.domain=function(values){if(!arguments.length)return domain();const result=domain(values);if(plot)window.__subdivisionPriceCamera=domain();return result;};return scale;};
 });
 await page.locator('#ol-window').click();await page.locator('[data-window="4h"]').click();
 await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision',/dividing|joining|blending/);
 const before=await page.evaluate(()=>window.__subdivisionPriceCamera);
 expect(before).toHaveLength(2);
 await page.evaluate(()=>{window.__replaceSubdivisionMapping=true;document.querySelector('#ol-poc').click();});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 expect(await page.evaluate(()=>window.__subdivisionPriceCamera)).toEqual(before);
 await page.evaluate(()=>{window.__holdSubdivisionCamera=false;});
 await expect(page.locator('#ol-canvas')).not.toHaveAttribute('data-subdivision',/.+/);
});

test('an unchanged status grid leaves the active coloured source untouched',async({page,fakeFor,probe})=>{
 await page.addInitScript(()=>{let api;Object.defineProperty(window,'explorerMotion',{get:()=>api,set:motion=>{
  api={...motion,spring(owner,name,options){return motion.spring(owner,name,name==='cells-camera'?{...options,
   canComplete:()=>!window.__holdSubdivisionCamera,write(value){options.write(window.__holdSubdivisionCamera?{progress:.5}:value);}}:options);}};
 }});});
 const fake=await open(page,fakeFor,probe);
 const choose=async key=>{await page.locator('#ol-window').click();await page.locator(`[data-window="${key}"]`).click();};
 await page.evaluate(()=>{window.__subdivisionGrid={n:10,m:1};});
 await choose('45d');await S.atRest(page,fake,probe);
 await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive())).toBe(false);
 await page.evaluate(()=>{window.__subdivisionGrid=null;});
 await choose('24h');await S.atRest(page,fake,probe);
 await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive())).toBe(false);
 const gate=fake.on({route:'/cube/query'}).gate();
 try {
  await page.evaluate(()=>{window.__subdivisionGrid={n:10,m:2};window.__holdSubdivisionCamera=true;window.__holdSubdivisionCalibration=true;});
  await choose('45d');await gate.arrived();
  await expect(page.locator('#ol-canvas')).toHaveAttribute('data-subdivision','waiting');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{
   const draw=CanvasRenderingContext2D.prototype.drawImage;window.__statusSourceCopies=0;
   CanvasRenderingContext2D.prototype.drawImage=function(...args){
    if(args.length===5&&args[1]===0&&args[2]===0&&!this.canvas.id&&!args[0]?.id&&this.canvas.width>100&&this.canvas.height>100)window.__statusSourceCopies++;
    return draw.apply(this,args);
   };
  });
  gate.open();await expect(page.locator('#ol-loading')).toBeHidden();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.locator('#ol-n').textContent()).toBe('n 10');
  expect(await page.locator('#ol-m').textContent()).toBe('m 2');
  expect(await page.evaluate(()=>window.__statusSourceCopies)).toBe(0);
  expect((await pixels(page)).blue).toBeGreaterThan(100);
 } finally {
  gate.open();
  await page.evaluate(()=>{window.__holdSubdivisionCamera=false;window.__holdSubdivisionCalibration=false;document.querySelector('#ol-poc').click();});
 }
});
