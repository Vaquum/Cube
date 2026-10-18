"use strict";
// Pixel oracle: old calibrated volume survives a held destination calibration.
const {test,expect}=require('./fixtures.js'),S=require('./rows-support.js');
async function pixels(page){return page.locator('#ol-canvas').evaluate(canvas=>{
 const [x,y,w,h]=canvas.dataset.layout.split(',').map(Number),d=devicePixelRatio;
 const a=canvas.getContext('2d').getImageData(Math.ceil(x*d),Math.ceil(y*d),Math.floor(w*d),Math.floor(h*d)).data;
 let blue=0,opaque=0,hash=2166136261;
 for(let i=0;i<a.length;i+=4){if(a[i+2]>a[i]+8)blue++;if(a[i+3]===255)opaque++;for(let k=0;k<3;k++)hash=Math.imul(hash^a[i+k],16777619);}
 return {blue,opaque,count:a.length/4,hash:hash>>>0};
});}
async function open(page,fakeFor,probe){
 await page.addInitScript(()=>{let api;Object.defineProperty(window,'explorerEncoding',{get:()=>api,set:value=>{
  api={...value,lifecycle:{...value.lifecycle,coherent:(...args)=>window.__holdSubdivisionCalibration?{ok:false,reason:'pending'}:value.lifecycle.coherent(...args)},
   readout:{...value.readout,cellsFrame(...args){const frame=value.readout.cellsFrame(...args);return window.__replaceSubdivisionMapping?{...frame,mappingId:frame.mappingId+':next'}:frame;}}};
 }});});
 const fake=await fakeFor('standard');await page.goto(fake.url+'/#w=24h&vis=2');await S.atRest(page,fake,probe);
 await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive())).toBe(false);
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
