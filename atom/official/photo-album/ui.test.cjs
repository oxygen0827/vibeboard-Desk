// Component UI fixtures only. Real provider results are verified separately.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=';
const items=Array.from({length:7},(_,i)=>({id:(i+1).toString(16).padStart(32,'0'),name:'Fixture '+i,revision:1,favorite:false,generated:i===0,parent_id:i===0?'00000000000000000000000000000002':null,thumbnail:image}));
const state={user:{id:'fixture',username:'fixture'},generation_enabled:true,styles:[{id:'clay',name:'黏土世界'},{id:'film',name:'胶片时光'}]};
const html=`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe src="/index.html" sandbox="allow-scripts"></iframe><script>
const items=${JSON.stringify(items)},state=${JSON.stringify(state)},image=${JSON.stringify(image)};window.requests=[];
addEventListener('message',e=>{const d=e.data;if(d?.type!=='atom:photos')return;requests.push(d.action);const x=d.data||{};let result;
if(d.action==='state')result=state;
if(d.action==='list'){const a=items.filter(p=>x.filter!=='favorites'||p.favorite);result={items:a.slice(x.page*x.limit,(x.page+1)*x.limit),pages:Math.ceil(a.length/x.limit),total:a.length}}
if(d.action==='get')result={photo:items.find(p=>p.id===x.id),data_url:image};
if(d.action==='update'){const p=items.find(p=>p.id===x.id);p.favorite=x.favorite;p.revision++;result={photo:p}}
if(d.action==='generate')result={job:{id:'job',status:'generating',created_at:1,prompt:x.prompt,style:x.style,source_id:x.source_id}};
if(d.action==='job')result={job:{id:'job',status:'failed',created_at:1,error:'Fixture: model unavailable'}};
if(d.action==='jobs')result={jobs:[]};
e.source.postMessage({type:'atom:photos-result',id:d.id,result},'*')});</script>`;
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!name){res.setHeader('Content-Type','text/html');return res.end(html)}if(!['index.html','app.js','style.css','icon.svg'].includes(name)){res.statusCode=404;return res.end()}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(path.join(__dirname,name)))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath,headless:true});
 try{for(const size of [{width:480,height:360},{width:960,height:700}]){
  const p=await browser.newPage({viewport:size});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{window.structuredClone=undefined;window.AtomApp={deferReady(){},ready(){},load:async()=>({style:'clay'}),save:async()=>({mode:'device'}),onSuspend:f=>window.suspendFixture=f}});
  await p.goto('http://127.0.0.1:'+server.address().port);const f=p.frameLocator('iframe');await f.getByText('照片已同步',{exact:true}).waitFor();
  assert.equal(await f.locator('.photo').count(),size.width<600?6:7);
  assert.equal(await f.locator('body').evaluate(e=>e.scrollHeight<=e.clientHeight),true);
  await f.locator('.photo').first().click();await f.getByRole('button',{name:'对比',exact:true}).click();await f.locator('#compare-range').fill('30');assert.match(await f.locator('.after').getAttribute('style'),/30%/);
  await f.getByRole('button',{name:'结束对比'}).click();await f.getByRole('button',{name:'改写',exact:true}).click();await f.locator('#photo-prompt').fill('新画面');assert.equal(await f.locator('body').evaluate(e=>e.scrollHeight<=e.clientHeight),true);
  await f.getByRole('button',{name:'生成新作品'}).click();await f.getByText('Fixture: model unavailable',{exact:true}).waitFor();assert.equal(await f.locator('.ring').count(),0);
  await f.getByRole('button',{name:'返回相册'}).click();await f.getByText('照片已同步',{exact:true}).waitFor();const frame=p.frames()[1];await frame.evaluate(()=>window.suspendFixture());assert.equal(await f.locator('#root').innerText(),'');assert.deepEqual(errors,[]);
  await p.close();
 }console.log('Photo UI passed: fixed viewport, paging, comparison, generation failure and suspend cleanup (480×360 / 960×700).')}
 finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
