/* Real Chromium, real shared five-way runtime; only SDK transport is a fixture. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
const root=__dirname;
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(req.url.split('?')[0]);
 const file=name==='/input-navigation.js'?path.resolve(root,'../../static/input-navigation.js'):path.join(root,name==='/'?'index.html':name);
 if(!file.startsWith(root)&&name!=='/input-navigation.js'){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
async function navigate(page,id){
 // Find a path through the real runtime, then execute that path using keys only.
 await page.waitForTimeout(150); // Previous system confirmation animation may resize its control.
 if(!await page.evaluate(()=>document.activeElement.matches('button')))await page.keyboard.press('ArrowRight');
 const start=await page.evaluate(()=>document.activeElement.id||document.activeElement.dataset.scene||document.activeElement.dataset.tilt);
 const nodes=await page.locator('button:not(:disabled)').evaluateAll(bs=>bs.filter(b=>b.getBoundingClientRect().width).map(b=>({id:b.id||b.dataset.scene||b.dataset.tilt,key:b.id?'#'+b.id:b.dataset.scene?'[data-scene="'+b.dataset.scene+'"]':'[data-tilt="'+b.dataset.tilt+'"]'})));
 const byId=Object.fromEntries(nodes.map(n=>[n.id,n.key])),queue=[{at:start,path:[]}],seen=new Set([start]);let found;
 while(queue.length){const next=queue.shift();if(next.at===id){found=next.path;break;}for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']){
   await page.evaluate(selector=>AtomInput.focus(document.querySelector(selector)),byId[next.at]);await page.keyboard.press(key);
   const at=await page.evaluate(()=>document.activeElement.id||document.activeElement.dataset.scene||document.activeElement.dataset.tilt);
   if(!seen.has(at)&&byId[at]){seen.add(at);queue.push({at,path:next.path.concat(key)});}
 }}
 assert.ok(found,`five-way route ${start} → ${id}`);await page.evaluate(selector=>AtomInput.focus(document.querySelector(selector)),byId[start]);const walked=[];for(const key of found){await page.keyboard.press(key);walked.push(await page.evaluate(()=>document.activeElement.id||document.activeElement.dataset.scene||document.activeElement.dataset.tilt));}assert.equal(await page.evaluate(()=>document.activeElement.id||document.activeElement.dataset.scene||document.activeElement.dataset.tilt),id,JSON.stringify({start,id,found,walked}));await page.keyboard.press('Space');
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage({viewport:{width:480,height:360}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__saved=null;window.__acks=[];window.__frames=0;window.__draws=0;window.__fail=false;window.__unsub=0;window.__back=0;window.__audio=[];
  const fill=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(...args){window.__draws++;return fill.apply(this,args)};
  const raf=requestAnimationFrame;window.requestAnimationFrame=fn=>raf(t=>{window.__frames++;fn(t)});
  const AC=AudioContext;window.AudioContext=function(...args){const a=new AC(...args);window.__audio.push(a);return a;};
  window.AtomApp={deferReady(){},ready(){window.__ready=true},load:async()=>{if(window.__fail)throw Error('disk unavailable');return window.__saved},save:data=>new Promise(resolve=>{window.__saved=data;window.__acks.push(resolve)}),navigation:{back(){window.__back++}},onSuspend(fn){window.__suspend=fn},sensors:{subscribe(fn){window.__sensor=fn;fn({version:1,source:'unavailable',available:{presence:false,motion:false},presence:null,motion:null,updated_at:Date.now()});return()=>window.__unsub++}}};
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__ready);await page.addScriptTag({url:'/input-navigation.js'});
 assert.equal(await page.locator('#sensor').innerText(),'手动把玩 · 未连接惯性传感器');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>AtomInput.focus(document.querySelector('#back')));
 await navigate(page,'record');await navigate(page,'pluck');await page.waitForTimeout(350);await navigate(page,'right');await page.waitForTimeout(350);await navigate(page,'record');
 assert.ok(await page.locator('#save').isEnabled());await navigate(page,'save');assert.notEqual(await page.locator('#status').innerText(),'作品已保存');assert.ok(await page.locator('#save').isDisabled());
 await page.evaluate(()=>window.__acks.shift()());await page.waitForFunction(()=>document.querySelector('#status').textContent==='作品已保存');
 const composition=await page.evaluate(()=>window.__saved);assert.ok(composition.pattern.notes.length);assert.ok(Buffer.byteLength(JSON.stringify(composition))<65536);
 await navigate(page,'play');await page.waitForFunction(()=>document.querySelector('#play').classList.contains('playing'));await navigate(page,'play');
 await navigate(page,'ocean');await page.mouse.move(280,205);await page.mouse.down();await page.mouse.move(360,140,{steps:8});await page.mouse.up();
 await page.screenshot({path:'/tmp/atom-motion-music-ocean.png'});await navigate(page,'light');assert.equal(await page.locator('#chapter').innerText(),'03 / LIGHT VESSEL');await page.screenshot({path:'/tmp/atom-motion-music-light.png'});await navigate(page,'music');assert.equal(await page.locator('#chapter').innerText(),'01 / PENTATONIC');await page.screenshot({path:'/tmp/atom-motion-music-music.png'});
 await page.evaluate(()=>window.__sensor({version:1,source:'device',available:{presence:false,motion:true},motion:{roll:25,pitch:10,ax:0,ay:0,az:1,moving:true},updated_at:Date.now()}));
 await navigate(page,'sensor');assert.match(await page.locator('#sensor').innerText(),/真实倾斜/);await page.waitForTimeout(2700);assert.match(await page.locator('#sensor').innerText(),/手动把玩/);
 await navigate(page,'back');assert.equal(await page.evaluate(()=>window.__back),1);
 await page.evaluate(()=>window.__suspend());await page.waitForTimeout(200);const draws=await page.evaluate(()=>window.__draws);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__draws),draws);assert.equal(await page.evaluate(()=>window.__unsub),1);assert.ok(await page.evaluate(()=>window.__audio.every(a=>a.state==='closed')));
 assert.deepEqual(errors,[]);
 await page.reload();await page.waitForFunction(()=>window.__ready);await page.evaluate(()=>{window.__fail=true;document.querySelector('#retry').click()});await page.waitForFunction(()=>!document.querySelector('#retry').hidden);
 assert.ok(await page.locator('#record').isDisabled());assert.ok(await page.locator('#save').isDisabled());assert.match(await page.locator('#status').innerText(),/读取失败/);
 await page.evaluate(saved=>{window.__fail=false;window.__saved=saved;document.querySelector('#retry').click()},composition);await page.waitForFunction(()=>document.querySelector('#status').textContent==='已恢复上次作品');assert.ok(await page.locator('#play').isEnabled());
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(200);assert.deepEqual(errors,[]);
 console.log('PASS 480×360 five-way record/play/save, ACK boundary, 3 scenes, mouse drag, stale sensor fallback, suspend cleanup, failed-read protection/retry, reduced motion. Screenshots: /tmp/atom-motion-music-{music,ocean,light}.png');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
