const assert=require('node:assert/strict'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{const browser=await chromium.launch({executablePath,headless:true});try{
const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.writes=[];window.offset=0;const now=Date.now;Date.now=()=>now()+offset;window.AtomApp={deferReady(){},ready(){window.ready=true},async load(defaults){if(window.readFails)throw Error('read');return window.saved||defaults},async save(value){if(window.saveFails)throw Error('save');window.saved=JSON.parse(JSON.stringify(value));window.writes.push(window.saved)},navigation:{back(){window.wentHome=true}},sensors:{subscribe(fn){window.sensor=fn;return()=>window.unsubscribed=true}},onSuspend(fn){window.suspend=fn}}});
await page.goto('file://'+path.join(__dirname,'index.html'));await page.waitForFunction(()=>window.ready);await page.addScriptTag({path:path.resolve(__dirname,'../../static/input-navigation.js')});
assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
assert.match(await page.locator('#presence').innerText(),/未连接/);
// Use the real shared input runtime: first Down focuses back, second reaches duration, then start.
await page.keyboard.press('ArrowDown');
for(let i=0;i<5 && await page.evaluate(()=>document.activeElement.id)!=='start';i++)await page.keyboard.press('ArrowDown');
assert.equal(await page.evaluate(()=>document.activeElement.id),'start');await page.keyboard.press('Space');await page.waitForFunction(()=>window.writes.length===1);
assert.equal(await page.evaluate(()=>window.saved.phase),'running');
await page.evaluate(()=>window.sensor({source:'device',available:{presence:true},presence:{present:false}}));assert.equal(await page.locator('#away').isVisible(),true);assert.equal(await page.evaluate(()=>window.saved.phase),'running');
await page.locator('#pause-away').click();await page.waitForFunction(()=>window.saved.phase==='paused');
await page.evaluate(()=>window.saveFails=true);await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('保存失败'));assert.equal(await page.evaluate(()=>window.saved.phase),'paused');assert.equal(await page.locator('#start').isDisabled(),true);
await page.evaluate(()=>window.saveFails=false);await page.locator('#retry').click();await page.waitForFunction(()=>window.saved.phase==='running');
await page.evaluate(()=>window.offset=1600000);await page.waitForFunction(()=>!document.querySelector('#finish').hidden);assert.equal(await page.evaluate(()=>window.saved.plants),0);
await page.locator('#finish').click();await page.waitForFunction(()=>window.saved.plants===1);assert.equal(await page.evaluate(()=>window.saved.phase),'idle');
await page.screenshot({path:'/tmp/atom-focus-garden.png'});
await page.locator('#back').click();assert.equal(await page.evaluate(()=>window.wentHome),true);await page.evaluate(()=>window.suspend());assert.equal(await page.evaluate(()=>window.unsubscribed),true);
await page.addInitScript(()=>{window.readFails=true});await page.reload();await page.waitForFunction(()=>window.ready);assert.equal(await page.locator('#start').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.writes),[]);
await page.evaluate(()=>window.readFails=false);await page.locator('#retry').click();await page.waitForFunction(()=>!document.querySelector('#start').disabled);assert.deepEqual(await page.evaluate(()=>window.writes),[]);assert.deepEqual(errors,[]);
console.log('PASS focus garden: real five-way start, presence does not infer focus, ACK save/retry, explicit completion, read failure protection, fullscreen and suspend');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
