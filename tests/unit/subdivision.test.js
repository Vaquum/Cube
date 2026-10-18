"use strict";
// Oracle: four unit squares partition a 2×2 parent, with outer seams at
// the coarse endpoint and four separate seams at the fine endpoint.
const test=require('node:test'), assert=require('node:assert/strict');
const Flow=require('../../src/motion.js');
const cell=(t,end,p,high,css='rgb(100,100,100)')=>({t,end,p,high,css});
const parent={n:1,m:1,cells:[cell(0,2,0,2)]};
const children={n:0,m:0,cells:[cell(0,1,0,1,'rgb(200,200,200)'),cell(0,1,1,2),cell(1,2,0,1),cell(1,2,1,2)]};
function paint(plan,progress){const out=[],pen={fillStyle:'',fillRect(x,y,w,h){out.push({x,y,w,h,css:this.fillStyle});}};Flow.paintSubdivision(pen,plan,progress,v=>v*20,v=>40-v*20);return out;}
const area=rects=>rects.reduce((sum,r)=>sum+r.w*r.h,0);
test('subdivision preserves parent footprint without overlapping copies',()=>{
 const p=Flow.subdivisionPlan(parent,children,'rgb(255,255,255)',4);
 assert.equal(p.count,4);assert.deepEqual([...p.boxes],[0,1,0,1,0,1,1,2,1,2,0,1,1,2,1,2]);
 assert.equal(area(paint(p,0)),39*39);assert.equal(area(paint(p,1)),4*19*19);
 assert.ok(paint(p,0).every(r=>r.css==='rgb(100,100,100)'));assert.equal(paint(p,1)[0].css,'rgb(200,200,200)');
 for(const r of [...paint(p,0),...paint(p,.5),...paint(p,1)])assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=40&&r.y+r.h<=40);
});
test('coarsening reverses endpoints without rebuilding prepared geometry',()=>{
 const p=Flow.subdivisionPlan(children,parent,'rgb(255,255,255)'),boxes=[...p.boxes],edges=[...p.edges];
 assert.equal(area(paint(p,0)),4*19*19);assert.equal(area(paint(p,1)),39*39);
 for(let i=0;i<100;i++)paint(p,i/100);assert.deepEqual([...p.boxes],boxes);assert.deepEqual([...p.edges],edges);
});
test('empty child support fades to surface and cutoff remains exclusive',()=>{
 const p=Flow.subdivisionPlan({n:1,m:0,cells:[cell(0,.5,0,1)]},{n:0,m:0,cells:[cell(0,.5,0,1,'#c8c8c8')]},'#ffffff');
 assert.deepEqual([...p.boxes],[0,.5,0,1]);
 const sparse=Flow.subdivisionPlan(parent,{...children,cells:children.cells.slice(0,1)},'rgb(255,255,255)');
 assert.equal(paint(sparse,1).filter(r=>r.css==='rgb(255,255,255)').length,3);
});
test('large jumps and typed states use the bounded raster path',()=>{
 assert.equal(Flow.subdivisionPlan({...parent,cut:.5},{...children,cut:1},'#ffffff'),null);
 assert.equal(Flow.subdivisionPlan({n:20,m:9,cells:[cell(0,2**20,0,2**9)]},children,'#ffffff'),null);
 assert.equal(Flow.subdivisionPlan(parent,children,'#ffffff',3),null);assert.equal(Flow.subdivisionPlan(null,children,'#ffffff'),null);
 assert.equal(Flow.subdivisionPlan(parent,{...children,cells:[{...children.cells[0],outline:true}]},'#ffffff'),null);
 assert.equal(Flow.subdivisionPlan(parent,{...children,cells:[{...children.cells[0],css:null}]},'#ffffff'),null);
});
