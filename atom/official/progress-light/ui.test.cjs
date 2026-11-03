const assert=require('node:assert/strict'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
const now=()=>Math.floor(Date.now()/1000),mac={client_id:'m',name:'MacBook',online:true};
const snapshot=tasks=>({configured:true,paired:[mac],tasks:tasks.map(([id,status,prompt])=>({id,status,prompt,computer_id:'m',updated_at:now()}))});
(async()=>{const browser=await chromium.launch({executablePath,headless:true});try{
const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.writes=[];window.notes=0;window.asked=0;
 // The shell answers atom:task-state; here the page is its own parent, so reply to the same window.
 addEventListener('message',e=>{if(e.data?.type!=='atom:task-state')return;window.asked++;const reply=window.denied?{error:'尚未允许读取任务摘要'}:{result:JSON.parse(JSON.stringify(window.fake))};setTimeout(()=>postMessage({type:'atom:task-state-result',id:e.data.id,...reply},'*'),10)});
 window.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={}}createOscillator(){window.notes++;return{frequency:{},connect:x=>x,start(){},stop(){}}}createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect:x=>x}}resume(){return Promise.resolve()}close(){window.audioClosed=true;return Promise.resolve()}};
 window.AtomApp={deferReady(){},ready(){window.ready=true},async load(d){if(window.readFails)throw Error('read');return window.saved||d},async save(v){if(window.saveFails)throw Error('save');window.saved=JSON.parse(JSON.stringify(v));window.writes.push(window.saved)},navigation:{back(){window.wentHome=true}},onSuspend(fn){window.suspend=fn}};
});
const feed=tasks=>page.evaluate(s=>{window.fake=s},snapshot(tasks));
const title=()=>page.locator('#title').innerText();
const waitTitle=text=>page.waitForFunction(t=>document.querySelector('#title').textContent===t,text,{timeout:9000});
await page.addInitScript(s=>{window.fake=s},snapshot([['a','completed','早就做完的任务'],['b','running','修复市场 429 提示']]));
await page.goto('file://'+path.join(__dirname,'index.html'));await page.waitForFunction(()=>window.ready);await page.addScriptTag({path:path.resolve(__dirname,'../../static/input-navigation.js')});
await waitTitle('正在执行');
assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
assert.match(await page.locator('#lamp').getAttribute('class'),/running/);assert.match(await page.locator('#meta').innerText(),/MacBook · \d+ 秒前更新 · 第 1\/2 个/);
assert.equal(await page.evaluate(()=>window.notes),0,'the first snapshot never rings, even with a finished task');
assert.equal(await page.locator('#ack').isVisible(),false);
await page.screenshot({path:path.join(process.env.TMPDIR||'/tmp','atom-progress-light-running.png')});

// running -> completed between two real reads rings once and waits for 知道了.
await feed([['a','completed','早就做完的任务'],['b','completed','修复市场 429 提示']]);await waitTitle('任务完成');
assert.equal(await page.evaluate(()=>window.notes),2);assert.match(await page.locator('#lamp').getAttribute('class'),/completed alert/);
assert.equal(await page.locator('#prompt').innerText(),'修复市场 429 提示');
await page.screenshot({path:path.join(process.env.TMPDIR||'/tmp','atom-progress-light-done.png')});
// Five-way: Down from the top reaches 知道了, center key confirms it.
for(let i=0;i<6&&await page.evaluate(()=>document.activeElement.id)!=='ack';i++)await page.keyboard.press('ArrowDown');
assert.equal(await page.evaluate(()=>document.activeElement.id),'ack');await page.keyboard.press('Space');
await page.waitForFunction(()=>document.querySelector('#ack').hidden);

// A rate-limited read in between keeps the last good state and the pending alert.
await feed([['a','completed','早就做完的任务'],['b','running','再跑一个任务']]);await waitTitle('正在执行');
await feed([['a','completed','早就做完的任务'],['b','completed','再跑一个任务']]);await waitTitle('任务完成');
await page.evaluate(()=>{window.fake={configured:true,connection_error:'请求过于频繁，请稍后重试',paired:[],tasks:[]}});
await page.waitForFunction(()=>document.querySelector('#note').textContent.includes('连接不稳'),null,{timeout:9000});
assert.equal(await title(),'任务完成');assert.equal(await page.locator('#ack').isVisible(),true);assert.equal(await page.evaluate(()=>window.notes),4);
await feed([['a','completed','早就做完的任务'],['b','completed','再跑一个任务']]);await page.waitForFunction(()=>!document.querySelector('#note').textContent.includes('连接不稳'),null,{timeout:12000});
assert.equal(await page.locator('#ack').isVisible(),true);await page.locator('#ack').click();
// A task that starts waiting for approval rings and blinks; approval elsewhere clears the alert by itself.
await feed([['a','completed','早就做完的任务'],['b','completed','修复市场 429 提示'],['c','waiting_approval','删除旧的构建产物']]);await waitTitle('等你确认');
assert.equal(await page.evaluate(()=>window.notes),6);assert.match(await page.locator('#note').innerText(),/我的电脑/);assert.equal(await page.locator('#ack').isVisible(),true);
await page.screenshot({path:path.join(process.env.TMPDIR||'/tmp','atom-progress-light-approval.png')});
await feed([['a','completed','早就做完的任务'],['b','completed','修复市场 429 提示'],['c','running','删除旧的构建产物']]);await waitTitle('正在执行');
assert.equal(await page.locator('#ack').isVisible(),false);assert.equal(await page.evaluate(()=>window.notes),6);

// Several tasks: next/prev cycle through them.
await page.locator('#next').click();assert.match(await page.locator('#meta').innerText(),/第 2\/3 个/);await page.locator('#prev').click();assert.match(await page.locator('#meta').innerText(),/第 1\/3 个/);

// Sound off is saved only after acknowledgment; a failed save keeps the previous setting.
await page.locator('#sound').click();await page.waitForFunction(()=>window.saved?.sound===false);assert.equal(await page.locator('#sound').innerText(),'提示音 关');
await page.evaluate(()=>window.saveFails=true);await page.locator('#sound').click();await page.waitForFunction(()=>document.querySelector('#note').textContent.includes('保存失败'));
assert.equal(await page.locator('#sound').innerText(),'提示音 关');await page.evaluate(()=>window.saveFails=false);
await feed([['a','completed','早就做完的任务'],['b','completed','修复市场 429 提示'],['c','failed','删除旧的构建产物']]);await waitTitle('需要检查');
assert.equal(await page.evaluate(()=>window.notes),6,'muted');assert.match(await page.locator('#lamp').getAttribute('class'),/failed alert/);

// A denied permission stops polling and offers a retry.
await page.evaluate(()=>window.denied=true);await waitTitle('需要检查');await page.waitForFunction(()=>!document.querySelector('#retry').hidden,null,{timeout:9000});
const asked=await page.evaluate(()=>window.asked);await page.waitForTimeout(4500);assert.equal(await page.evaluate(()=>window.asked),asked);
await page.evaluate(()=>window.denied=false);await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelector('#retry').hidden);

await page.locator('#back').click();assert.equal(await page.evaluate(()=>window.wentHome),true);
await page.evaluate(()=>window.suspend());assert.equal(await page.evaluate(()=>window.audioClosed),true);
const after=await page.evaluate(()=>window.asked);await page.waitForTimeout(4500);assert.equal(await page.evaluate(()=>window.asked),after);

// Unconfigured and unreadable settings: honest text, nothing written.
await page.addInitScript(()=>{window.readFails=true;window.saved=undefined;window.writes=[];window.fake={configured:false,paired:[],tasks:[]}});await page.reload();await page.waitForFunction(()=>window.ready);
await waitTitle('还没有连接电脑');assert.match(await page.locator('#note').innerText(),/读取失败/);
await page.locator('#sound').click();await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>window.writes),[]);
// Demo: labeled, plays the real transitions without reading tasks, and hands back to real reads when ended.
await page.locator('#demo').click();await waitTitle('正在执行');assert.match(await page.locator('#note').innerText(),/演示 · 不是真实任务/);assert.match(await page.locator('#meta').innerText(),/演示电脑/);
const demoAsked=await page.evaluate(()=>window.asked);await waitTitle('等你确认');assert.match(await page.locator('#lamp').getAttribute('class'),/waiting_approval alert/);
assert.equal(await page.evaluate(()=>window.asked),demoAsked,'demo never reads real tasks');
await page.screenshot({path:path.join(process.env.TMPDIR||'/tmp','atom-progress-light-demo.png')});
await page.locator('#demo').click();await waitTitle('还没有连接电脑');assert.equal(await page.locator('#demo').innerText(),'看演示');assert.ok(await page.evaluate(()=>window.asked)>demoAsked);
assert.deepEqual(errors,[]);
console.log('PASS progress light: no ring on first read, done/approval/fail transitions, five-way 知道了, approval clears itself, rate-limited reads keep state, cycling, ACK-saved mute, permission stop/retry, labeled demo, suspend releases polling and audio');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
