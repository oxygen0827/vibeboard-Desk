/* Isolated PM review: actual installed scripts/SDK in opaque iframes, fixture data only. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,executablePath}=require('../browser-test-runtime.cjs');
const root='/tmp/atom-product-audit',work=path.join(root,'working'),out=path.resolve('atom/artifacts/product-audit-2026-10-31');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'device-source/file-catalog.json')));
const allowed=new Set(catalog.map(a=>a.id));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.html':'text/html','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav','.ogg':'audio/ogg'};
const theme=fs.readFileSync(path.resolve('atom/official/photo-pet/test-fixtures/device-dark-theme.css'),'utf8');
const fixture=fs.readFileSync(path.join(__dirname,'fixture-host.js'),'utf8');
const cache=new Map();
async function resource(name){
 if(cache.has(name))return cache.get(name);
 const promise=fetch('http://127.0.0.1:18770'+name).then(async r=>({status:r.status,body:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')}));
 cache.set(name,promise);return promise;
}
function makeServer(){return http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://audit'),parts=u.pathname.split('/');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
  if(parts[1]==='review'&&allowed.has(parts[2])){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:480px;height:360px;overflow:hidden}iframe{width:480px;height:360px;border:0;display:block}</style></head><body><script>'+fixture+'</script><iframe id="app" sandbox="allow-scripts allow-forms allow-downloads" src="/user-apps/'+parts[2]+'/index.html"></iframe></body></html>')}
  if(['/app-runtime.js','/input-navigation.js','/home-key.js'].includes(u.pathname)){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,path.basename(u.pathname))))}
  if(parts[1]==='user-apps'&&allowed.has(parts[2])&&!u.pathname.includes('..')){
   const relative=parts.slice(3).join('/')||'index.html',local=path.join(work,parts[2],relative);let data,type=mime[path.extname(relative)]||'application/octet-stream';
   if(fs.existsSync(local)&&fs.statSync(local).isFile())data=fs.readFileSync(local);
   else{const remote=await resource(u.pathname);if(remote.status!==200){res.statusCode=remote.status;return res.end()}data=remote.body;type=remote.type||type;}
   if(relative.endsWith('.html')){
    let html=data.toString();const runtime='<script src="/input-navigation.js"></script><script src="/app-runtime.js"></script>';if(!html.includes('src="/app-runtime.js"'))html=/<head\b/i.test(html)?html.replace(/<head\b[^>]*>/i,m=>m+runtime):runtime+html;
    if(!html.includes('data-atom-theme')){const style='<style data-atom-theme>'+theme+'</style>';html=/<\/head>/i.test(html)?html.replace(/<\/head>/i,style+'</head>'):style+html;}
    data=Buffer.from(html);
   }
   res.setHeader('Content-Type',type);return res.end(data);
  }
  // No real account, model, hardware or file API is reachable through this server.
  res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'审查使用离线测试数据',files:[],items:[],tasks:[]}));
 }catch(e){res.statusCode=500;res.end('Review resource unavailable')}
})}
async function instrument(page){
 await page.addInitScript(()=>{
  const metrics=window.__audit={raf:new Set(),timeouts:new Set(),intervals:new Set(),frames:0,contexts:[]};
  const raf=requestAnimationFrame,caf=cancelAnimationFrame,st=setTimeout,ct=clearTimeout,si=setInterval,ci=clearInterval;
  window.requestAnimationFrame=fn=>{let id=raf(t=>{metrics.raf.delete(id);metrics.frames++;fn(t)});metrics.raf.add(id);return id};
  window.cancelAnimationFrame=id=>{metrics.raf.delete(id);caf(id)};
  window.setTimeout=(fn,delay,...args)=>{let id=st(()=>{metrics.timeouts.delete(id);if(typeof fn==='function')fn(...args);else (0,eval)(fn)},delay);metrics.timeouts.add(id);return id};
  window.clearTimeout=id=>{metrics.timeouts.delete(id);ct(id)};
  window.setInterval=(...args)=>{let id=si(...args);metrics.intervals.add(id);return id};window.clearInterval=id=>{metrics.intervals.delete(id);ci(id)};
  const Audio=window.AudioContext;if(Audio)window.AudioContext=class extends Audio{constructor(...args){super(...args);metrics.contexts.push(this)}};
 });
}
async function openApp(browser,base,id,options={}){
 const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[],requests=[];
 await instrument(page);if(options.reducedMotion)await page.emulateMedia({reducedMotion:'reduce'});
 if(options.state)await page.addInitScript(value=>window.__initialValue=value,options.state);
 if(options.legacy)await page.addInitScript(value=>window.__legacyValue=value,options.legacy);
 if(options.readFail)await page.addInitScript(()=>window.__readFail=true);
 if(options.saveFail)await page.addInitScript(()=>window.__saveFail=true);
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||['data:','blob:'].includes(url.protocol))return route.continue();requests.push(url.origin+url.pathname);return route.abort()});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)requests.push(r.status()+' '+new URL(r.url()).pathname)});
 await page.goto(base+'/review/'+id,{waitUntil:'load',timeout:120000});
 const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForLoadState('domcontentloaded');
 await page.waitForTimeout(options.wait||2300);
 return{page,frame,errors,requests};
}
async function inspect(frame){return frame.evaluate(()=>{
 const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[hidden]')};
 const controls=Array.from(document.querySelectorAll('button,input,select,textarea,[role=button],[tabindex]')).filter(visible).map(e=>{const r=e.getBoundingClientRect();return{tag:e.tagName,id:e.id,label:(e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder')||'').trim().slice(0,90),disabled:!!e.disabled,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),font:getComputedStyle(e).fontSize}});
 return{title:document.title,text:document.body.innerText.slice(0,1800),size:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},controls,canvases:document.querySelectorAll('canvas').length,frames:window.__audit.frames,media:window.__audit.contexts.map(c=>c.state)};
})}
async function baseline(browser,base,id,round){
 const item={id,round};let instance;
 try{
  instance=await openApp(browser,base,id);const{page,frame,errors,requests}=instance;
  item.home=await inspect(frame);item.fixture=await page.evaluate(()=>({ready:fixture.ready,saves:fixture.saves,unsupported:fixture.unsupported}));
  const dir=path.join(out,'round-'+round);fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,id+'.png'),timeout:15000});
  item.navigation=await frame.evaluate(()=>{const els=Array.from(document.querySelectorAll('button,input,select,textarea,[role=button]')).filter(e=>{const r=e.getBoundingClientRect();return !e.disabled&&r.width&&r.height&&r.y>=0&&r.y<360&&!e.closest('[hidden]')});if(els.length&&window.AtomInput){AtomInput.focus(els[0]);return{start:els[0].id||els[0].textContent.trim().slice(0,30),count:els.length}}return{count:0}});
  const visited=[];for(const key of ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp']){await page.keyboard.press(key);visited.push(await frame.evaluate(()=>document.activeElement?.id||document.activeElement?.textContent?.trim().slice(0,30)))}item.navigation.visited=visited;
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'atom:app-lifecycle',state:'suspend'},'*'));await page.waitForTimeout(450);
  item.afterSuspend=await frame.evaluate(()=>({frames:__audit.frames,raf:__audit.raf.size,intervals:__audit.intervals.size,timeouts:__audit.timeouts.size,audio:__audit.contexts.map(c=>c.state)}));
  await page.waitForTimeout(250);item.afterSuspend.frameGrowth=await frame.evaluate(n=>__audit.frames-n,item.afterSuspend.frames);
  item.errors=[...new Set(errors)];item.requests=[...new Set(requests)];item.status='reviewed';
 }catch(e){item.status='failed';item.error=e.message.slice(0,500);}
 finally{await instance?.page.close().catch(()=>{})}
 return item;
}
async function run(){
 const round=Number(process.argv.find(a=>a.startsWith('--round='))?.split('=')[1]||1),filter=process.argv.find(a=>a.startsWith('--ids='))?.split('=')[1]?.split(',');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath,headless:true,args:['--mute-audio','--enable-webgl','--enable-unsafe-swiftshader']});
 const ids=catalog.map(a=>a.id).filter(id=>id!=='photo-pet'&&(!filter||filter.includes(id))),results=[];
 try{for(let i=0;i<ids.length;i+=2){const batch=await Promise.all(ids.slice(i,i+2).map(id=>baseline(browser,base,id,round)));for(const r of batch){results.push(r);console.log(r.id,r.status,'errors='+(r.errors?.length||0),'liveFrames='+(r.afterSuspend?.frameGrowth||0));}fs.writeFileSync(path.join(out,(process.argv.find(a=>a.startsWith('--report='))?.slice(9)||'round-'+round+'-baseline')+'.json'),JSON.stringify(results,null,2));}}
 finally{await browser.close();await new Promise(r=>server.close(r));}
}
module.exports={makeServer,openApp,inspect,instrument,catalog,out,work};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
