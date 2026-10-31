const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{
 const server=http.createServer((req,res)=>{let name=req.url==='/'?'index.html':req.url.slice(1);if(!/^[a-z.-]+$/.test(name)){res.statusCode=404;return res.end()}
  try{let source=fs.readFileSync(path.join(__dirname,name));if(name==='index.html')source=source.toString().replace('</head>','<script src="/input-runtime.js"></script></head>');res.end(source)}catch{if(name==='input-runtime.js')res.end(fs.readFileSync(path.join(__dirname,'../../static/input-navigation.js')));else{res.statusCode=404;res.end()}}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.fixture={saves:0,value:null};window.AtomApp={deferReady(){},ready(){},load:async()=>{const d=YardDomain.create({catalog:YardCatalog});let s=d.load();for(const id of ['smith','gardener','fisher'])s=d.act(s,'assign',id,Date.now()).state;fixture.value=s;return s},save:async value=>{fixture.saves++;fixture.value=value;return{mode:'device'}},navigation:{setBackHandler:f=>window.back=f},home(){window.wentHome=true},onSuspend:f=>window.suspend=f}});
  await page.clock.install({time:new Date('2026-10-31T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-31T00:00:01Z'));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#npc-gardener:not([disabled])').waitFor();
  await page.clock.runFor(15000);
  const before=await page.locator('#scene').getAttribute('data-gardener-x');
  // A working resident must remain clickable above disabled crop hit areas.
  await page.locator('#npc-gardener').click();await page.clock.runFor(1000);const frozen=await page.locator('#scene').getAttribute('data-gardener-x');assert.equal(frozen,before);
  const progress=await page.locator('#job-progress').textContent();await page.clock.runFor(11000);assert.equal(await page.locator('#scene').getAttribute('data-gardener-x'),frozen);assert.notEqual(await page.locator('#job-progress').textContent(),progress);
  await page.screenshot({path:'/tmp/yard-architecture-job.png'});
  await page.evaluate(()=>back());await page.clock.runFor(34);const resumed=Number(await page.locator('#scene').getAttribute('data-gardener-x'));assert(Math.abs(resumed-Number(frozen))<5,'Closing a modal teleported gardener');
  await page.clock.runFor(5000);assert(Number(await page.locator('#scene').getAttribute('data-gardener-x'))>Number(frozen));
  // Hiding stops frames; wall-clock jobs still finish and require an explicit claim.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
  const frame=await page.locator('#scene').getAttribute('data-frame');await page.clock.runFor(100000);assert.equal(await page.locator('#scene').getAttribute('data-frame'),frame);assert.equal(await page.evaluate(()=>fixture.saves),0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))});await page.clock.runFor(100);assert.equal(await page.locator('#scene').getAttribute('data-ready-products'),'smith,gardener,fisher');
  // System motion changes take effect immediately even when the scheduler was throttled.
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'atom:input-settings',motion:false}})));await page.clock.runFor(300);assert.equal(await page.locator('#scene').getAttribute('data-environment'),'still');
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'atom:input-settings',motion:true}})));await page.clock.runFor(40);assert.equal(await page.locator('#scene').getAttribute('data-environment'),'flowing');
  await page.clock.runFor(1000);await page.screenshot({path:'/tmp/yard-architecture-home.png'});
  await page.evaluate(()=>suspend());const stopped=await page.locator('#scene').getAttribute('data-frame');await page.clock.runFor(5000);assert.equal(await page.locator('#scene').getAttribute('data-frame'),stopped);assert.deepEqual(errors,[]);
  console.log('PASS: working resident input over plots, live progress with frozen modal scene, gradual resume, hidden frame release, offline completion without claims, immediate motion settings and suspend');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
