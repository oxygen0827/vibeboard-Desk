const assert=require('node:assert/strict'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{const browser=await chromium.launch({executablePath,headless:true});try{
 const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.AtomApp={deferReady(){},ready(){window.ready=true},async load(v){return v},async save(){},onSuspend(f){window.suspend=f},home(){window.wentHome=true},navigation:{setBackHandler(fn){window.backHandler=fn},back(){window.AtomInput.back()}},sensors:{subscribe(fn){window.sensor=fn;return()=>window.unsubscribed=true}}};window.postMessage=m=>queueMicrotask(()=>dispatchEvent(new MessageEvent('message',{source:window,data:{id:m.id,result:{configured:false,paired:[],tasks:[]}}})));});
 await page.goto('file://'+path.join(__dirname,'index.html'));await page.waitForFunction(()=>window.ready);await page.addScriptTag({path:path.resolve(__dirname,'../../static/input-navigation.js')});await page.evaluate(()=>AtomInput.setBackHandler(window.backHandler));
 assert.match(await page.locator('#sensor-status').innerText(),/未连接/);assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.id),'presence-demo');await page.keyboard.press('Space');assert.match(await page.locator('#sensor-status').innerText(),/手动演示/);assert.match(await page.locator('#mood').innerText(),/安静/);
 await page.evaluate(()=>window.sensor({source:'unavailable',available:{presence:false,motion:false},presence:null,motion:null}));assert.match(await page.locator('#sensor-status').innerText(),/手动演示/);
 await page.evaluate(()=>window.sensor({source:'device',available:{presence:true,motion:true},presence:{present:true},motion:{roll:20,moving:true}}));assert.match(await page.locator('#mood').innerText(),/灯亮/);assert.match(await page.locator('#sensor-status').innerText(),/实时/);
 await page.evaluate(()=>window.sensor({source:'unavailable',available:{presence:false,motion:false},presence:null,motion:null}));assert.match(await page.locator('#sensor-status').innerText(),/未连接/);
 await page.screenshot({path:'/tmp/atom-agent-living-room.png'});
 await page.locator('#view').click();assert.equal(await page.locator('#panel').isVisible(),true);await page.locator('#back').click();assert.equal(await page.locator('#living').isVisible(),true);await page.locator('#back').click();assert.equal(await page.evaluate(()=>window.wentHome),true);
 await page.locator('#view').click();await page.evaluate(()=>{window.wentHome=false;AtomInput.back()});assert.equal(await page.locator('#living').isVisible(),true);await page.evaluate(()=>AtomInput.back());assert.equal(await page.evaluate(()=>window.wentHome),true);
 await page.evaluate(()=>window.suspend());assert.equal(await page.evaluate(()=>window.unsubscribed),true);assert.deepEqual(errors,[]);
 console.log('PASS living room: explicit manual fallback, presence and tilt samples, real five-way interaction, integrated nested back, fullscreen and sensor cleanup');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
