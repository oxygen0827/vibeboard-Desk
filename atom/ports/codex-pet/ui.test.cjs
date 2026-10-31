/* Actual opaque iframe and shared ATOM runtime; API fixtures are explicit demo data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
const root=path.resolve(__dirname,'../..'),bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'bundle.json')));
(async()=>{const browser=await chromium.launch({headless:true,executablePath});try{
 const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];let desktop=[],connect=[],writes=0,failSave=false,failRead=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(window!==parent)return;localStorage.setItem('atom.welcome.v1','true');localStorage.setItem('atom.experienceAnimations','false')});
 await page.route('**/*',async route=>{const u=new URL(route.request().url()),p=u.pathname;
  if(p.startsWith('/api/')){let result={};if(p==='/api/apps')result={apps:[{...bundle.manifest,installation_id:'pet-test',icon_svg:bundle.files['icon.svg'],entry:'/user-apps/codex-pet/index.html'}]};
   if(p==='/api/themes')result={themes:[],active:null};if(p==='/api/health')result={version:'pet-test'};
   if(p==='/api/device-data/status'){if(failRead)return route.fulfill({status:503,json:{error:'fixture read failure'}});result={size:0,backups:[],pending:null}}
   if(p==='/api/device-data/capture'){writes++;if(failSave)return route.fulfill({status:503,json:{error:'fixture persistence failure'}})}
   if(p==='/api/connect/state')result={configured:true,paired:[{client_id:'demo-pc',name:'演示电脑',online:true}],tasks:connect};
   if(p==='/api/codex-pet/state')result={tasks:desktop,error:''};
   return route.fulfill({json:result});
  }
  if(p.startsWith('/user-apps/codex-pet/')){const name=p.split('/').pop();let body=bundle.files[name];if(body===undefined)return route.fulfill({status:404,body:''});if(name==='index.html'){body=body.replace('<head>','<head><script src="/input-navigation.js"></script><script src="/app-runtime.js"></script>');body=body.replace('</head>','<style>'+fs.readFileSync(path.join(root,'static/theme-controls.css'),'utf8')+'</style></head>');body=body.replace('</body>','<script src="/home-key.js"></script></body>')}
   return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body});}
  const file=path.join(root,'static',p==='/'?'index.html':p);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
 });
 await page.goto('http://127.0.0.1:19988/');await page.locator('[data-app="codex-pet"]').first().click();
 await page.frameLocator('iframe').locator('#pet').waitFor();let frame=page.frames().find(f=>f.url().includes('/user-apps/codex-pet/'));await frame.locator('#scene-status').filter({hasText:'本地陪伴'}).waitFor();await frame.waitForFunction(()=>document.querySelector('#sprite').getContext('2d').getImageData(0,0,192,208).data.some(x=>x));
 assert.equal(await frame.evaluate(()=>document.documentElement.scrollHeight),360);assert.equal(await frame.evaluate(()=>document.body.scrollWidth),480);
 const out=path.join(root,'artifacts/codex-pet');fs.mkdirSync(out,{recursive:true});await page.locator('#return-toast').waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'home.png')});
 // Navigate to settings using the actual directional runtime and center confirmation.
 await frame.evaluate(()=>AtomInput.focus(document.querySelector('#pet')));await page.keyboard.press('ArrowRight');assert.equal(await frame.evaluate(()=>document.activeElement.id),'settings');
 await frame.evaluate(()=>AtomInput.focus(document.querySelector('#settings')));await page.keyboard.press('Space');assert.equal(await frame.locator('#preferences').isVisible(),true);
 await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Space');await page.waitForTimeout(300);assert.equal(await frame.locator('#pet-select').inputValue(),bundle.files['pets.js'].includes('boxcat')?'boxcat':'boba');
 await frame.locator('#action-select').selectOption('waiting');await frame.locator('#done').click();assert.equal(await frame.locator('#animation-note').innerText(),'动作预览 · 非任务状态');
 await frame.locator('#settings').click();await frame.locator('#action-select').selectOption('auto');await frame.locator('#atom-app-back').click();assert.equal(await frame.locator('#preferences').isVisible(),false);
 const now=Date.now()/1000;desktop=[{id:'demo-desktop',source:'desktop',status:'needs_input',project:'演示项目 · 测试数据',updated_at:now}];await frame.locator('#settings').click();await frame.locator('#tab-tasks').click();await frame.locator('#refresh').click();await page.locator('#cap-allow').click();await frame.locator('#status').filter({hasText:'等待电脑审批'}).waitFor();assert.equal(await frame.locator('#task').isDisabled(),true);assert((await frame.locator('#feedback').innerText()).includes('电脑端确认'));
 desktop[0].updated_at=now-200;await frame.locator('#refresh').click();await frame.locator('#status').filter({hasText:'上次状态 · 等待电脑审批'}).waitFor();
 desktop=[];connect=[{id:'demo-task',computer_id:'demo-pc',status:'running',prompt:'演示项目 · 测试数据',updated_at:now}];await frame.locator('#refresh').click();await frame.locator('#status').filter({hasText:'正在工作'}).waitFor();assert.equal(await frame.locator('#task').isDisabled(),false);
 failSave=true;await frame.locator('#tab-companion').click();await frame.locator('#source-select').selectOption('desktop');await frame.waitForFunction(()=>document.querySelector('#save-feedback').textContent==='偏好尚未保存，请重试');failSave=false;await frame.locator('#save-retry').click();await frame.waitForFunction(()=>document.querySelector('#save-feedback').textContent==='');
 // Save acknowledgment and preference recovery use the actual host runtime.
 await frame.locator('#done').click();await frame.locator('#atom-app-back').click();assert.equal(await page.locator('body').getAttribute('data-view'),'home');assert(await page.locator('[data-app="codex-pet"]').count());await page.screenshot({path:path.join(out,'desktop.png')});
 await page.locator('[data-app="codex-pet"]').first().click();await page.frameLocator('iframe').locator('#settings').waitFor();frame=page.frames().find(f=>f.url().includes('/user-apps/codex-pet/'));await frame.locator('#settings').click();assert.equal(await frame.locator('#source-select').inputValue(),'desktop');assert(writes>0);
 await frame.evaluate(()=>dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'atom:app-lifecycle',state:'suspend'}})));const before=await frame.evaluate(()=>document.querySelector('#sprite').toDataURL());await page.waitForTimeout(350);assert.equal(await frame.evaluate(()=>document.querySelector('#sprite').toDataURL()),before);
 // A new shell with failed initial persistence read must not save defaults.
 await page.keyboard.press('Home');failRead=true;const writesBefore=writes;await page.reload();await page.locator('[data-app="codex-pet"]').first().click();await page.frameLocator('iframe').locator('#settings').waitFor();frame=page.frames().find(f=>f.url().includes('/user-apps/codex-pet/'));await frame.waitForFunction(()=>document.querySelector('#feedback').textContent==='重试前不会覆盖已有偏好');assert.equal(writes,writesBefore);failRead=false;await frame.locator('#retry').click();await frame.locator('#scene-status').filter({hasText:'本地陪伴'}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: offline sprites, opaque bridge, five-way settings, preview labeling, real-state mapping, stale Hooks, save failure/retry, reload preferences, Home and suspend');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
