/* Integration checks against the actual device shell and its opaque iframe SDK. */
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'atom-gray-ports-')),origin='http://127.0.0.1:18949';
const ids=['photon-chip','photon-runner','finger-fireworks','mini-piano'];
const script=`import sys,json\nfrom pathlib import Path\nfrom http.server import ThreadingHTTPServer\nsys.path.insert(0,sys.argv[1])\nimport server\nr=Path(sys.argv[2]).resolve();apps=r/'apps'\nfor a in ${JSON.stringify(ids)}: server.install_app(apps,json.loads((Path(sys.argv[1])/'official'/a/'bundle.json').read_text()))\nclass Quiet(server.Handler):
 def log_message(self,*args): pass
h=ThreadingHTTPServer(('127.0.0.1',18949),Quiet);h.apps_root=apps;h.settings_path=r/'state'/'settings.json';h.serve_forever()`;
(async()=>{const proc=spawn('python3',['-u','-c',script,root,dir],{stdio:['ignore','ignore','inherit']});let browser;const errors=[];
try{
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
 const p=await browser.newPage({viewport:{width:480,height:360}});p.on('pageerror',e=>errors.push(e.message));
 async function open(id){await p.goto(origin);await p.locator('.app-tile').first().waitFor();for(let i=0;i<8&&!(await p.locator('[data-app="'+id+'"]').count());i++){await p.mouse.wheel(0,220);await p.waitForTimeout(550);}await p.locator('[data-app="'+id+'"]').evaluate(b=>b.click());await p.waitForFunction(()=>document.querySelector('#launch-screen')?.hidden);return p.frames().find(f=>f.url().includes('/user-apps/'+id+'/'));}
 for(const id of ids){
  const f=await open(id);assert(f,id);assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth),480);assert.equal(await f.evaluate(()=>document.documentElement.scrollHeight),360);
  assert.equal(await f.evaluate(()=>window.origin),'null');assert.equal(await f.evaluate(()=>AtomApp.version),1);
  if(id==='photon-chip'){await f.locator('#auto').click();await f.locator('canvas').click({position:{x:35,y:190}});await f.waitForFunction(()=>Number(document.querySelector('#count').textContent)>0);}
  if(id==='photon-runner'){
   await f.locator('#play').click();await f.waitForFunction(()=>S.state==='play');
   // Put an obstacle at the crossing boundary, then trigger a real collision and SDK save.
   await f.evaluate(()=>{S.walls=[{x:95,cy:180,gap:145,passed:false}];S.y=180;S.v=0});await f.waitForFunction(()=>S.score===1);
   await f.evaluate(()=>{S.y=300});await f.waitForFunction(()=>document.querySelector('#notice').textContent==='最高纪录已保存');
   await p.keyboard.press('Space');await p.locator('.app-tile').first().waitFor();
   const reopened=await open(id);await reopened.waitForFunction(()=>document.querySelector('#best').textContent==='1');
  }
  if(id==='finger-fireworks'){await f.locator('#words').click();await f.locator('input').fill('你好 ATOM');await f.locator('#send-words').click();assert(await f.locator('.sheet').isHidden());await f.locator('#finale').click();}
  if(id==='mini-piano'){
   assert.notEqual(await f.locator('.white').first().evaluate(e=>getComputedStyle(e).backgroundImage),await f.locator('.black').first().evaluate(e=>getComputedStyle(e).backgroundImage));
   await f.locator('.white').first().dispatchEvent('pointerdown');await f.waitForFunction(()=>scene.audio&&scene.audio.state==='running');
   await f.locator('#demo').click();await f.waitForFunction(()=>demo===true);await f.locator('#demo').click();await f.waitForFunction(()=>demo===false);
  }
  await p.waitForTimeout(3000);await p.screenshot({path:path.join(dir,id+'.png')});
  await p.keyboard.press('Space');await p.locator('.app-tile').first().waitFor();
 }
 await p.evaluate(async()=>{await fetch('/api/themes/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'system-dark'})})});
 for(const id of ids){const f=await open(id);if(id==='finger-fireworks')await f.locator('#finale').click();if(id==='mini-piano')await f.locator('#demo').click();await p.waitForTimeout(3000);assert.equal(await f.locator('.scene-head').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(29, 32, 38)');await p.screenshot({path:path.join(dir,id+'-dark.png')});}
 // A failed storage read must not start play or overwrite old records. Retry restores it.
 await p.addInitScript(()=>{window.rejectRead=true;const original=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='atom.app.v1.photon-runner'&&window.rejectRead)throw Error('read unavailable');return original.call(this,key)};});
 const broken=await open('photon-runner');await broken.locator('.load-error').waitFor();assert(await broken.locator('#play').isDisabled());await p.evaluate(()=>window.rejectRead=false);await broken.locator('.load-error button').click();await broken.waitForFunction(()=>loaded===true);assert.equal(await broken.evaluate(()=>best),1);
 // Also exercise suspend directly while the frame still exists (host normally removes it).
 const piano=await open('mini-piano');await piano.locator('#demo').click();await piano.waitForFunction(()=>scene.audio&&scene.audio.state==='running');
 await p.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'atom:app-lifecycle',state:'suspend'},'*'));
 await piano.waitForFunction(()=>scene.active===false&&scene.audio.state==='closed');assert.equal(await piano.evaluate(()=>scene.voices.size),0);
 await p.emulateMedia({reducedMotion:'reduce'});const fire=await open('finger-fireworks');assert.equal(await fire.locator('#auto').getAttribute('aria-pressed'),'false');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,captures:dir,checks:['480×360 opaque iframe','no page overflow','light and dark themes','photon routing','runner actual SDK persistence and read-failure retry','firework text and volley','piano key distinction and local audio','Space return','suspend releases audio','reduced-motion auto off']},null,2));
}finally{await browser?.close();proc.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
