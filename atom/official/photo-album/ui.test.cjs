// Component UI fixtures only. Real provider results are verified separately.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=';
const items=Array.from({length:7},(_,i)=>({id:(i+1).toString(16).padStart(32,'0'),name:'Fixture '+i,revision:1,favorite:false,generated:i===0,parent_id:i===0?'00000000000000000000000000000002':null,thumbnail:image}));
const state={user:{id:'fixture',username:'fixture'},generation_enabled:true,styles:[{id:'clay',name:'黏土世界'},{id:'film',name:'胶片时光'},{id:'pet',name:'桌面宠物形象'}],templates:[{id:'text-film',name:'胶片早餐',mode:'text',style:'film',prompt:'咖啡和面包的胶片摄影'},{id:'edit-clay',name:'黏土分身',mode:'edit',style:'clay',prompt:'保留参考照片主体，转换为黏土角色'}]};
const html=`<meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe src="/index.html" sandbox="allow-scripts"></iframe><script>
const items=${JSON.stringify(items)},state=${JSON.stringify(state)},image=${JSON.stringify(image)};window.requests=[];window.uploads=[];
addEventListener('message',e=>{const d=e.data;if(d?.type!=='atom:photos')return;requests.push(d.action);const x=d.data||{};let result;
if(d.action==='state'){if(location.search.includes('offline')||location.search.includes('signedout')){setTimeout(()=>e.source.postMessage({type:'atom:photos-result',id:d.id,error:'Fixture unavailable',status:location.search.includes('offline')?503:401},'*'),400);return}result=state;}
if(d.action==='upload'){uploads.push({name:x.name,mime:x.data_url.split(';')[0],bytes:atob(x.data_url.split(',')[1]).length});result={photo:{id:x.id}};}
if(d.action==='list'){const a=items.filter(p=>x.filter!=='favorites'||p.favorite);result={items:a.slice(x.page*x.limit,(x.page+1)*x.limit),pages:Math.ceil(a.length/x.limit),total:a.length}}
if(d.action==='get')result={photo:items.find(p=>p.id===x.id),data_url:image};
if(d.action==='update'){const p=items.find(p=>p.id===x.id);p.favorite=x.favorite;p.revision++;result={photo:p}}
if(d.action==='generate')result={job:{id:'job',status:'generating',created_at:1,prompt:x.prompt,style:x.style,source_id:x.source_id}};
if(d.action==='job'){const status=window.jobStatuses?.length?window.jobStatuses.shift():'failed';result={job:{id:'job',status,created_at:1,photo_id:status==='completed'?items[0].id:null,error:status==='failed'?'Fixture: model unavailable':''}};}
if(d.action==='jobs')result={jobs:[]};
setTimeout(()=>e.source.postMessage({type:'atom:photos-result',id:d.id,result},'*'),d.action==='get'?500:d.action==='state'?400:0)});</script>`;
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!name){res.setHeader('Content-Type','text/html');return res.end(req.url.includes('computer')?html.replace('src="/index.html"','src="/index.html?host=computer"'):html)}if(name==='input-navigation.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(__dirname,'../../static/input-navigation.js')))}if(!['index.html','app.js','style.css','icon.svg'].includes(name)){res.statusCode=404;return res.end()}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html');res.end(name==='index.html'?fs.readFileSync(path.join(__dirname,name),'utf8').replace('</head>','<script src="input-navigation.js"></script></head>'):fs.readFileSync(path.join(__dirname,name)))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath,headless:true});
 try{for(const size of [{width:480,height:360},{width:960,height:700}]){
  const p=await browser.newPage({viewport:size});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{window.structuredClone=undefined;window.AtomApp={deferReady(){},ready(){},load:async()=>({style:'clay'}),save:async()=>({mode:'device'}),navigation:{setBackHandler:f=>window.backFixture=f},home:()=>window.homeFixture=true,onSuspend:f=>window.suspendFixture=f}});
  await p.goto('http://127.0.0.1:'+server.address().port);const f=p.frameLocator('iframe');await f.locator('.account-loading').waitFor();assert.equal(await f.getByRole('button',{name:'登录账号',exact:true}).count(),0);await f.getByText('照片已同步',{exact:true}).waitFor();
  const app=p.frames()[1];await app.addScriptTag({path:path.join(__dirname,'../../static/input-navigation.js')});await app.evaluate(()=>AtomInput.setBackHandler(window.backFixture));assert.equal(await f.locator('#atom-app-back').count(),0);
  assert.equal(await f.locator('.photo').count(),size.width<600?6:7);
  await f.locator('[data-action="create"]').click();assert.deepEqual(await f.locator('.creation-presets select').evaluateAll(es=>es.map(e=>e.id)),['photo-template','photo-style']);assert.equal(await f.locator('#photo-template option[value="edit-clay"]').count(),0);await f.locator('#photo-template').selectOption('text-film');assert.equal(await f.locator('#photo-prompt').inputValue(),'咖啡和面包的胶片摄影');assert.equal(await f.locator('#photo-style').inputValue(),'film');assert.equal(await p.evaluate(()=>requests.includes('generate')),false);await f.locator('[data-action="back"]').click();await f.locator('.photo').first().waitFor();
  assert.equal(await f.locator('body').evaluate(e=>e.scrollHeight<=e.clientHeight),true);
  await app.evaluate(()=>AtomInput.focus(document.querySelector('.photo')));await p.keyboard.press('Space');await f.locator('.viewer').waitFor();assert.equal(await f.locator('#atom-app-back').count(),0);
  await f.locator('.photo-loading').waitFor(); // Preview is visible while the cloud response is deliberately delayed.
  assert.equal(await f.locator('.picture').getAttribute('src'),image);
  await f.locator('.photo-loading').waitFor({state:'detached'});
  if(size.width===480){
   await f.getByRole('button',{name:'轮播',exact:true}).click();await f.locator('.viewer.clean').waitFor();
   await p.waitForTimeout(6400);assert.equal(await f.locator('.picture').getAttribute('alt'),'Fixture 1');assert.equal(await f.locator('.viewer.clean').count(),1);
   assert.equal(await f.locator('.viewer-top').evaluate(e=>getComputedStyle(e).opacity),'0');
   assert.equal(await f.locator('.picture').evaluate(e=>getComputedStyle(e).cursor),'none');
   await p.mouse.move(230,170);await f.locator('.viewer:not(.clean)').waitFor();
   assert.notEqual(await f.locator('.picture').evaluate(e=>getComputedStyle(e).cursor),'none');
   await f.getByRole('button',{name:'暂停',exact:true}).click();
   await p.mouse.move(235,175);await p.waitForTimeout(2000);await p.mouse.move(240,180);await p.waitForTimeout(2000);
   assert.equal(await f.locator('.viewer.clean').count(),0); // Movement resets the idle deadline.
   await p.waitForTimeout(1800);assert.equal(await f.locator('.viewer.clean').count(),1);
   assert.equal(await f.locator('.picture').evaluate(e=>getComputedStyle(e).cursor),'none');

   await app.evaluate(()=>AtomInput.back());await f.locator('.photo').first().click();await f.locator('.photo-loading').waitFor({state:'detached'});
   assert.equal(await p.evaluate(()=>requests.filter(x=>x==='get').length),3); // First, next and subsequent prefetch; reopening first is cached.
  }
const left=await f.locator('#photo-prev').boundingBox(),right=await f.locator('#photo-next').boundingBox();assert(left.x<24&&right.x+right.width>size.width-24);assert(Math.abs(left.y+left.height/2-size.height/2)<2);assert(left.width>=48);
  await app.evaluate(()=>AtomInput.focus(document.querySelector('#photo-prev')));await p.keyboard.press('ArrowRight');assert.equal(await app.evaluate(()=>document.activeElement.id),'photo-next');await p.keyboard.press('Space');await f.locator('.photo-loading').waitFor({state:'detached'});await app.waitForFunction(()=>document.activeElement.id==='photo-next');await p.keyboard.press('ArrowLeft');assert.equal(await app.evaluate(()=>document.activeElement.id),'photo-prev');await p.keyboard.press('Space');await f.locator('.photo-loading').waitFor({state:'detached'});await app.waitForFunction(()=>document.activeElement.id==='photo-prev');
  await p.mouse.move(size.width/2,size.height/2);await p.mouse.wheel(0,-300);await p.waitForTimeout(120);
  assert.equal(await f.locator('.viewer.zoomed').count(),1);assert.match(await f.locator('.picture').getAttribute('style'),/scale\(1\.8/);
  const originalTransform=await f.locator('.picture').getAttribute('style');await p.mouse.down();await p.mouse.move(size.width/2+35,size.height/2+25,{steps:4});await p.mouse.up();
  assert.notEqual(await f.locator('.picture').getAttribute('style'),originalTransform);assert.equal(await f.locator('.viewer.clean').count(),0);
  const writes=await app.evaluate(async()=>{let count=0;const img=document.querySelector('.picture'),observer=new MutationObserver(rs=>count+=rs.length);observer.observe(img,{attributes:true,attributeFilter:['style']});for(let i=0;i<80;i++)img.dispatchEvent(new WheelEvent('wheel',{deltaY:-2,clientX:240,clientY:180,bubbles:true,cancelable:true}));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);observer.disconnect();return count});assert(writes<=1,'wheel burst must coalesce into one image transform');await p.waitForTimeout(240);assert.equal(await f.locator('.picture').evaluate(e=>getComputedStyle(e).willChange),'auto');assert.match(await f.locator('.picture').getAttribute('style'),/translate\(/);

  await f.getByRole('button',{name:/恢复完整照片/}).click();await f.locator('.viewer:not(.zoomed)').waitFor();assert.equal(await f.locator('.viewer.zoomed').count(),0);
  await app.evaluate(()=>AtomInput.focus(document.querySelector('[data-action="zoom-in"]')));await p.keyboard.press('Space');await f.locator('.viewer.zoomed').waitFor();assert.equal(await f.locator('.viewer.zoomed').count(),1);
  await f.locator('[data-action="view-next"]').click();await f.locator('.photo-loading').waitFor({state:'detached'});assert.equal(await f.locator('.viewer.zoomed').count(),0);await f.locator('[data-action="view-prev"]').click();await f.locator('.photo-loading').waitFor({state:'detached'});
  await f.getByRole('button',{name:'对比',exact:true}).click();await f.locator('#compare-range').fill('30');assert.match(await f.locator('.after').getAttribute('style'),/30%/);
  await f.getByRole('button',{name:'返回照片',exact:true}).click();await f.getByRole('button',{name:'改写',exact:true}).click();await app.evaluate(()=>AtomInput.back());await f.locator('.viewer').waitFor();await f.getByRole('button',{name:'改写',exact:true}).click();await f.locator('#photo-template').selectOption('edit-clay');assert.equal(await f.locator('#photo-template option[value="text-film"]').count(),0);assert.equal(await f.locator('#photo-prompt').inputValue(),'保留参考照片主体，转换为黏土角色');await f.locator('#photo-prompt').fill('新画面');assert.equal(await f.locator('body').evaluate(e=>e.scrollHeight<=e.clientHeight),true);
  await f.getByRole('button',{name:'生成新作品'}).click();await f.getByText('Fixture: model unavailable',{exact:true}).waitFor();assert.equal(await f.locator('.ring').count(),0);
  await f.getByRole('button',{name:'返回相册'}).click();await f.getByText('照片已同步',{exact:true}).waitFor();await p.evaluate(()=>window.jobStatuses=['generating','saving','completed']);
  await f.locator('[data-action="create"]').click();await f.locator('#photo-prompt').fill('测试自动打开');await f.locator('[data-action="generate"]').click();await f.locator('.ring').waitFor();
  await app.evaluate(()=>window.testRing=document.querySelector('.ring'));
  await f.getByRole('status').filter({hasText:'正在保存到相册'}).waitFor();assert.equal(await app.evaluate(()=>window.testRing===document.querySelector('.ring')),true,'polling must preserve spinner DOM');
  await f.locator('.viewer').waitFor();await f.locator('.photo-loading').waitFor({state:'detached'});assert.equal(await f.locator('[data-action="open-result"]').count(),0);
  await f.locator('[data-action="back"]').click();await f.locator('.photo').first().waitFor();
  await p.evaluate(()=>window.jobStatuses=['generating','completed']);await f.locator('[data-action="create"]').click();await f.locator('#photo-prompt').fill('测试离开生成页');await f.locator('[data-action="generate"]').click();await f.locator('.ring').waitFor();await f.locator('[data-action="back"]').click();await f.locator('.photo').first().waitFor();await p.waitForTimeout(2900);assert.equal(await f.locator('.viewer').count(),0,'completed background job must not steal navigation');
  // 变宠物 starts a reference edit with the pet style; text-only creation never offers it.
  for(let i=0;i<4&&!(await f.getByRole('button',{name:'＋ 灵感'}).isVisible());i++){await app.evaluate(()=>AtomInput.back());await p.waitForTimeout(300)}await f.getByRole('button',{name:'＋ 灵感'}).waitFor();await app.evaluate(()=>AtomInput.focus(document.querySelector('.photo')));await p.keyboard.press('Space');await f.locator('.viewer').waitFor();await f.getByRole('button',{name:'变宠物',exact:true}).click();await f.getByRole('button',{name:'生成宠物形象',exact:true}).waitFor();await f.getByText(/本次生成静态角色图/).waitFor();assert.equal(await f.locator('#photo-style').inputValue(),'pet');assert.equal(await f.locator('body').evaluate(e=>e.scrollHeight<=e.clientHeight),true);
  await app.evaluate(()=>AtomInput.back());await f.locator('.viewer').waitFor();await app.evaluate(()=>AtomInput.back());await f.getByRole('button',{name:'＋ 灵感'}).click();assert.equal(await f.locator('#photo-style option[value="pet"]').count(),0);await app.evaluate(()=>AtomInput.back());
  const frame=p.frames()[1];await frame.evaluate(()=>window.suspendFixture());assert.equal(await f.locator('#root').innerText(),'');assert.deepEqual(errors,[]);
  await p.close();
 }
 const p=await browser.newPage({viewport:{width:960,height:700}});
 // Capture the 20 s library refresh so it can be fired while the native file chooser is open.
 await p.addInitScript(()=>{const original=setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===20000)window.albumSyncFixture=fn;return original(fn,ms,...args)}});
 await p.goto('http://127.0.0.1:'+server.address().port+'/?computer');const f=p.frameLocator('iframe');await f.locator('.account-loading').waitFor();assert.equal(await f.getByRole('button',{name:'登录账号',exact:true}).count(),0);await f.getByText('照片已同步',{exact:true}).waitFor();
 // A refresh during file choice must not re-render (and so detach) the input the chooser will fill.
 await f.locator('#photo-files').evaluate(e=>e.dataset.picker='retained');const chooserEvent=p.waitForEvent('filechooser');await f.getByRole('button',{name:'导入',exact:true}).click();const chooser=await chooserEvent;
 await p.frames()[1].evaluate(()=>window.albumSyncFixture());assert.equal(await f.locator('#photo-files').getAttribute('data-picker'),'retained');await chooser.setFiles([]);
 await f.locator('#photo-files').setInputFiles({name:'Apple.HEIC',mimeType:'',buffer:Buffer.from('test HEIC selection')});
 await f.getByText('1 张照片已上传并同步',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>uploads[0].mime),'data:image/heic');
 await f.locator('#photo-files').setInputFiles({name:'large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(20*1024*1024,1)});
 await f.getByText('1 张照片已上传并同步',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>uploads[1].bytes),20*1024*1024);
 await f.locator('#photo-files').setInputFiles({name:'too-big.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(20*1024*1024+1,1)});
 await f.getByText(/超过 20 MiB/).waitFor();assert.equal(await p.evaluate(()=>uploads.length),2);
 await f.locator('#photo-files').setInputFiles({name:'unsupported.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});
 await f.getByText(/格式不支持/).waitFor();assert.equal(await p.evaluate(()=>uploads.length),2);
 await p.close();
 for(const mode of ['offline','signedout']){const q=await browser.newPage({viewport:{width:480,height:360}});await q.goto('http://127.0.0.1:'+server.address().port+'/?'+mode);const album=q.frameLocator('iframe');await album.getByText('Fixture unavailable',{exact:true}).waitFor();assert.equal(await album.getByRole('button',{name:'登录账号',exact:true}).count(),mode==='signedout'?1:0);if(mode==='offline')await album.getByRole('button',{name:'重试',exact:true}).waitFor();await q.close();}
 console.log('Photo UI passed: loading versus signed-out/network failure, mouse wake and idle cursor, slideshow, preview/cache;  fixed viewport, paging, comparison, generation failure and suspend cleanup (480×360 / 960×700).')}
 finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
