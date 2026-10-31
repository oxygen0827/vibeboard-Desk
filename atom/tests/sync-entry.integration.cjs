const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium,executablePath}=require('../tools/browser-test-runtime.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath});try{
for(const app of ['notes-app','market-app','official/today'])for(const mode of ['signedin','signedout','offline']){
 const page=await browser.newPage({viewport:{width:480,height:360}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{let resolve,reject;window.statePromise=new Promise((a,b)=>{resolve=a;reject=b});window.finishState=(mode)=>mode==='offline'?reject(Object.assign(Error('网络不可用'),{status:503})):resolve({configured:true,authenticated:mode==='signedin',user:mode==='signedin'?{id:'test',username:'test'}:null});
 const call=async action=>{if(action==='state')return statePromise;if(action==='notes')return {notes:[]};if(action==='agenda')return {items:[]};if(action==='catalog')return {works:[]};return {}};
 window.AtomBridge={call,live:()=>true};window.AtomApp={deferReady(){},ready(){},navigation:{setBackHandler(){}},onSuspend(){},load:async d=>d,save:async()=>({mode:'device'})};addEventListener('message',async e=>{if(e.data?.type!=='atom:market')return;try{const result=await call(e.data.action);postMessage({type:'atom:market-result',id:e.data.id,result},'*')}catch(x){postMessage({type:'atom:market-result',id:e.data.id,error:x.message,status:x.status},'*')}});
 });
 await page.route('http://atom.test/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1)||'index.html';if(name==='bridge.js')return route.fulfill({contentType:'text/javascript',body:''});const file=path.join(__dirname,'..',app,name);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''})});
 await page.goto('http://atom.test/');await page.getByRole('status').filter({hasText:/正在/}).first().waitFor();assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.getByRole('button',{name:/^(登录|去登录|注册)$/}).count(),0);
 await page.evaluate(mode=>finishState(mode),mode);await page.waitForTimeout(150);
 if(mode==='offline'){assert.match(await page.locator('body').innerText(),/无法连接|网络不可用/);assert.equal(await page.locator('input[type=password]').count(),0)}
 if(mode==='signedin')assert.equal(await page.getByRole('button',{name:/^(登录|去登录|注册)$/}).count(),0);
 if(mode==='signedout')assert.match(await page.locator('body').innerText(),/登录/);
 assert.deepEqual(errors,[]);await page.close();
}console.log('PASS: notes, market and today defer login until auth settles; network failure does not become logout');}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
