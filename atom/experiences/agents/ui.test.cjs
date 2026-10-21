const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
 const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  delete CanvasRenderingContext2D.prototype.roundRect;delete window.structuredClone;
  window.fixture={configured:true,paired:[{client_id:'one',name:'笔记本',online:true},{client_id:'two',name:'工作站',online:true}],tasks:[{id:'done',computer_id:'one',status:'completed',prompt:'昨天的任务',updated_at:Date.now()/1000-120},{id:'run',computer_id:'two',status:'running',prompt:'正在构建',updated_at:Date.now()/1000-10},{id:'approval',computer_id:'one',status:'waiting_approval',prompt:'等待确认',updated_at:Date.now()/1000-20}]};
  window.writes=[];window.AtomApp={deferReady(){},ready(){window.ready=true},async load(d){if(window.readFails)throw Error('read failed');return window.preference||d},async save(d){if(window.saveFails)throw Error('save failed');window.writes.push(JSON.parse(JSON.stringify(d)));window.preference=d;return {mode:'device'}},onSuspend(f){window.suspend=f}};
  window.postMessage=m=>{window.sent=m;const result=m.type==='atom:task-state'?window.fixture:{};queueMicrotask(()=>dispatchEvent(new MessageEvent('message',{source:window,data:{id:m.id,result}})))};
 });
 const open=async()=>{await page.goto('file://'+path.resolve(__dirname,'index.html'));await page.waitForFunction(()=>window.ready);await page.waitForFunction(()=>document.querySelector('#task').textContent==='需要你确认')};
 await open();assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
 assert.match(await page.locator('#updated').innerText(),/秒前回传/);
 await page.locator('#follow').click();await page.waitForFunction(()=>window.writes.length===1);assert.deepEqual(await page.evaluate(()=>window.writes[0]),{computer:'',task:'approval'});
 await page.evaluate(()=>window.fixture.tasks.reverse());await page.locator('#refresh').click();assert.equal(await page.locator('#task').innerText(),'需要你确认');
 await page.locator('#computer').selectOption('two');await page.waitForFunction(()=>window.writes.length===2);assert.equal(await page.locator('#task').innerText(),'正在工作');
 await page.locator('#follow').click();await page.waitForFunction(()=>window.writes.length===3);assert.equal(await page.evaluate(()=>window.preference.task),'run');
 await page.evaluate(()=>{window.fixture.paired[1].online=false});await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#task').textContent.startsWith('上次状态'));assert.match(await page.locator('#feedback').innerText(),/离线/);assert(await page.evaluate(()=>stale()));
 await page.evaluate(()=>{window.fixture.paired[1].online=true;window.fixture.connection_error='network offline'});await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#connection').textContent.startsWith('连接中断'));
 await page.evaluate(()=>{window.fixture.connection_error='';window.fixture.tasks=[{id:'studio-test',computer_id:'two',status:'running',prompt:'整理便签'}]});await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#open').disabled);assert.equal(await page.locator('#open').innerText(),'请在电脑端查看');
 await page.locator('#new').click();assert.deepEqual(await page.evaluate(()=>window.sent.data),{});
 await page.evaluate(()=>{window.fixture.tasks=[{id:'real-task',computer_id:'two',status:'completed',prompt:'完整结果'}]});await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#open').disabled);await page.locator('#open').click();assert.equal(await page.evaluate(()=>window.sent.data.task_id),'real-task');
 await page.screenshot({path:'/tmp/atom-agent-studio-merged.png'});
 await page.evaluate(()=>{window.saveFails=true});await page.locator('#follow').click();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('未保存'));const count=await page.evaluate(()=>window.writes.length);await page.evaluate(()=>{window.saveFails=false});await page.locator('#retry-save').click();await page.waitForFunction(n=>window.writes.length>n,count);assert.equal(await page.locator('#retry-save').isVisible(),false);
 await page.evaluate(()=>window.suspend());
 await page.addInitScript(()=>{window.readFails=true});await page.goto('file://'+path.resolve(__dirname,'index.html'));await page.waitForFunction(()=>window.ready);assert.equal(await page.locator('#computer').isDisabled(),true);assert.equal(await page.locator('#follow').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.writes),[]);
 await page.evaluate(()=>{window.readFails=false;window.preference={computer:'two',task:'run'}});await page.locator('#retry-save').click();await page.waitForFunction(()=>!document.querySelector('#computer').disabled);assert.equal(await page.locator('#computer').inputValue(),'two');assert.equal(await page.locator('#task').innerText(),'正在工作');assert.deepEqual(await page.evaluate(()=>window.writes),[]);
 await page.evaluate(()=>window.suspend());assert.deepEqual(errors,[]);
 // Verify one-time legacy read fallback, precedence, and corruption protection in the real shell source.
 const shell=fs.readFileSync(path.resolve(__dirname,'../../static/app.js'),'utf8');const fn=shell.slice(shell.indexOf('function readAppState('),shell.indexOf('function writeAppState('));const store=new Map();const context={localStorage:{getItem:k=>store.has(k)?store.get(k):null}};vm.createContext(context);vm.runInContext(fn,context);
 store.set('atom.app.v1.task-pal',JSON.stringify({computer:'old-computer',task:'old-task'}));assert.equal(context.readAppState('atom.app.v1.agent-studio',null).task,'old-task');assert.equal(context.readAppState('atom.app.v1.other',null),null);
 store.set('atom.app.v1.agent-studio',JSON.stringify({computer:'new',task:'new-task'}));assert.equal(context.readAppState('atom.app.v1.agent-studio',null).task,'new-task');store.delete('atom.app.v1.agent-studio');store.set('atom.app.v1.task-pal','broken');assert.throws(()=>context.readAppState('atom.app.v1.agent-studio',null));
 console.log('PASS merged Agent 小屋: priority, computer filter, durable selection, stale/offline state, source-aware task jump, storage failure/retry, legacy migration, fullscreen, suspend');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
