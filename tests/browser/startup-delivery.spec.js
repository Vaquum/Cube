"use strict";
// Oracle: production HTTP delivery, independently gated archives, and the
// existing exact synthetic cube for requested view reads. No latency timeout
// stands in for readiness: controls and calibrated chart must work while held.
const {test,expect}=require("./fixtures.js");
const {spawn}=require("node:child_process"), path=require("node:path");
const fs=require("node:fs"),os=require("node:os");

async function delivery(fake,hold,deploy=false) {
  let deployRoot,deployPage;
  if(deploy) {
    deployRoot=fs.mkdtempSync(path.join(os.tmpdir(),"cube-deployment-"));deployPage=path.join(deployRoot,"index.html");
    fs.writeFileSync(deployPage,fs.readFileSync(path.join(fake.pageRoot,"index.html"),"utf8").replace("<script>","<script>/* next deployment */\n"));
    fs.cpSync(path.join(fake.pageRoot,"vendor"),path.join(deployRoot,"vendor"),{recursive:true});
  }
  const child=spawn("python3",["tests/support/startup-delivery.py"],{cwd:path.resolve(__dirname,"../.."),stdio:["pipe","pipe","pipe"]});
  let errors="";child.stderr.on("data",chunk=>errors+=chunk);
  child.stdin.end(JSON.stringify({page:path.join(fake.pageRoot,"index.html"),pack:fake.currentPack(),upstream:fake.url,hold,deployPage})+"\n");
  if(deployRoot)child.once("exit",()=>fs.rmSync(deployRoot,{recursive:true,force:true}));
  const url=await new Promise((resolve,reject)=>{
    let data="";child.stdout.on("data",chunk=>{data+=chunk;if(data.includes("\n"))resolve(JSON.parse(data.split("\n")[0]).url);});
    child.once("error",reject);child.once("exit",code=>reject(Error(`delivery server exited ${code}: ${errors}`)));
  });
  return {url,close:()=>child.kill()};
}

for(const mode of ["volume","path"]) test(`the first ${mode} chart and window controls work before any archive arrives`,async({page,fakeFor,probe},testInfo)=>{
  const fake=await fakeFor("standard",{next:300}),server=await delivery(fake,true);
  try {
    await page.goto(server.url+"/#w=24h&vis=2&mode="+mode);
    await expect(page.locator("#ol-canvas")).toHaveCSS("opacity","1");
    await expect(page.locator("#ol-legend")).toHaveAttribute("data-state","ready");
    await expect(page.locator("#ol-window")).toBeEnabled();
    expect(await page.evaluate(()=>Boolean(window.cubeAgent))).toBe(false);
    await page.locator("#ol-window").click();
    await page.locator('#ol-window-menu [data-window="7d"]').click();
    await expect(page.locator("#ol-window-text")).toHaveText("7d");
    await expect(page.locator("#ol-canvas")).toHaveCSS("opacity","1");
    await page.screenshot({path:testInfo.outputPath("usable-before-archives.png")});
    await page.request.get(server.url+"/test/release");
    await page.waitForFunction(()=>Boolean(window.cubeAgent));
    await probe.waitForReady();
    await expect(page.locator("#ol-loading")).toBeHidden();
    await expect(page.locator("#ol-window-text")).toHaveText("7d");
    const counts=await page.evaluate(()=>({blocks:Object.keys(JSON.parse(document.getElementById("origo-lens-data").textContent).blocks)}));
    expect(counts.blocks.sort()).toEqual(["overview","recent","reference"]);
  } finally { await page.request.get(server.url+"/test/release").catch(()=>{});server.close(); }
});

test("credential-bearing page URLs still load all deferred archives",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("mini",{next:300}),server=await delivery(fake,false);
  try {
    const url=new URL(server.url);url.username="fixture";url.password="local";url.hash="w=24h&vis=2";
    await page.goto(url.href);await page.waitForFunction(()=>Boolean(window.cubeAgent));await probe.waitForReady();
    await expect(page.locator("#ol-loading")).toBeHidden();
    const ids=await page.evaluate(async()=>(await window.cubeAgent.export()).snapshot.sources.map(source=>source.id));
    expect(ids).toEqual(expect.arrayContaining(["overview","recent","reference"]));
  } finally {server.close();}
});

test("a deployment between HTML and script download preserves the original application",async({page,fakeFor})=>{
  const fake=await fakeFor("mini",{next:300}),server=await delivery(fake,false,true);
  let announce,release,oldScript;
  const arrived=new Promise(resolve=>announce=resolve),held=new Promise(resolve=>release=resolve);
  await page.route("**/assets/*.js",async route=>{oldScript=new URL(route.request().url()).pathname;announce();await held;await route.continue();});
  try {
    const navigation=page.goto(server.url+"/#w=24h&vis=2");await arrived;
    await page.request.get(server.url+"/test/deploy");release();await navigation;
    await page.waitForFunction(()=>Boolean(window.cubeAgent));
    await expect(page.locator("#ol-canvas")).toHaveCSS("opacity","1");
    await expect(page.locator("#ol-loading")).toBeHidden();
    expect(await page.locator("script[defer][src]").getAttribute("src")).toBe(oldScript);
    const replacement=await (await page.request.get(server.url+"/")).text();
    expect(replacement.match(/<script defer src="([^"]+)"/)[1]).not.toBe(oldScript);
  } finally {release();server.close();}
});

test("reload reuses the same application asset and preserves the requested view",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("mini",{next:300}),server=await delivery(fake,false);
  try {
    const responses=[];page.on("response",response=>{if(/\/assets\/.*\.js$/.test(response.url()))responses.push(response);});
    await page.goto(server.url+"/#w=30d&vis=2");
    await probe.waitForReady();await page.waitForFunction(()=>Boolean(window.cubeAgent));
    const asset=await page.locator("script[defer][src]").getAttribute("src");
    expect(responses.length).toBe(1);
    expect((await responses[0].allHeaders())["cache-control"]).toContain("private, max-age=31536000, immutable");
    await page.reload();await probe.waitForReady();await page.waitForFunction(()=>Boolean(window.cubeAgent));
    expect(await page.locator("script[defer][src]").getAttribute("src")).toBe(asset);
    await expect(page.locator("#ol-window-text")).toHaveText("30d");
    expect(await page.evaluate(()=>performance.getEntriesByType("resource").find(entry=>entry.name.endsWith(".js")&&entry.name.includes("/assets/"))?.transferSize)).toBe(0);
  } finally {server.close();}
});

test("a late archive cannot overwrite a newer complete pack",async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor("standard",{next:300}),server=await delivery(fake,true);
  allowConsole(/Failed to load resource.*409/);
  try {
    await page.goto(server.url+"/#w=24h&vis=2");
    await expect(page.locator("#ol-canvas")).toHaveCSS("opacity","1");
    await expect(page.locator("#ol-legend")).toHaveAttribute("data-state","ready");
    fake.advance({minutes:60});
    const newer=fake.currentPack();
    fake.on({route:"/cube/query",times:1}).fail({status:409,body:{error:"cube_changed"}});
    await page.locator("#ol-canvas").focus();await page.keyboard.press("7");
    const through=new Date(newer.cutoff).toISOString().replace("T"," ").replace(".000Z"," UTC");
    await expect(page.locator("#ol-data-through")).toHaveText("Data through "+through);
    await page.request.get(server.url+"/test/release");
    await page.waitForFunction(()=>Boolean(window.cubeAgent));await probe.waitForReady();
    const snapshot=await page.evaluate(async()=>{const packet=await window.cubeAgent.export();return {token:packet.snapshot.token,sources:packet.snapshot.sources.map(source=>({id:source.id,b1:source.b1}))};});
    expect(snapshot.token).toBe(newer.state_token);
    for(const id of ["overview","recent","reference"])
      expect(snapshot.sources.find(source=>source.id===id)?.b1,id).toBe(newer.blocks[id].b1);
    await expect(page.locator("#ol-loading")).toBeHidden();
  } finally {await page.request.get(server.url+"/test/release").catch(()=>{});server.close();}
});
