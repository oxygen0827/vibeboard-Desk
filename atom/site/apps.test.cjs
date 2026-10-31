const {chromium,executablePath}=require('../tools/browser-test-runtime.cjs');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'assets/apps/catalog.json'))),bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'../official/clap-stage/bundle.json')));
const library=JSON.parse(fs.readFileSync(path.join(__dirname,'../official/library-index.json')));
for(const app of library.apps){const entry=data.apps.find(row=>row.id===app.id);assert(entry,app.id);assert.equal(entry.archive,app.archive);assert.equal(entry.sha256,app.sha256);}
const archiveFixture=Buffer.from('download transport fixture');
const works=data.apps.filter(a=>a.market_id).map(a=>({id:a.market_id,title:a.name,description:a.description,category:'play',author:'ATOM',license:'MIT',latest_version_id:'version-'+a.id}));
works.push({id:'community-test',title:'星光留言 <img src=x onerror=alert(1)>',description:'来自市场的新公开作品',author:'作者 <script>window.injected=1</script>',category:'life',license:'MIT',latest_version_id:'version-community'}, {id:'official-task-pal',title:'Retired',latest_version_id:'retired'});
(async()=>{const port=18945,origin='http://127.0.0.1:'+port,server=spawn('python3',['-c',`import sys
sys.path.insert(0, sys.argv[1])
from preview import Handler, ThreadingHTTPServer
class Fixture(Handler):
 def do_GET(self):
  if self.path.startswith('/atom/assets/library/') and self.path.endswith('.zip'):
   body=b'download transport fixture'
   self.send_response(200)
   self.send_header('Content-Type', 'application/zip')
   self.send_header('Content-Length', str(len(body)))
   self.end_headers()
   self.wfile.write(body)
  else:super().do_GET()
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), Fixture).serve_forever()
`,__dirname,String(port)],{stdio:'ignore'});let browser;const errors=[];
try{for(let i=0;i<40;i++){try{const ready=await fetch(origin+'/atom/apps/');await ready.arrayBuffer();if(ready.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
browser=await chromium.launch({headless:true,executablePath});
for(const [width,height]of [[1440,1000],[768,1024],[390,844],[320,720]]){
 const p=await browser.newPage({viewport:{width,height},acceptDownloads:true});p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(r.url().includes('/market/v1/')){assert.equal(r.method(),'GET');assert.equal(r.headers().authorization,undefined);}});
 await p.route('**/market/v1/catalog',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({works})}));
 await p.route('**/market/v1/versions/*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({bundle})}));
 await p.goto(origin+'/atom/apps/');await p.waitForFunction(()=>document.querySelector('#catalog-status').textContent.includes('已连接')).catch(async e=>{console.error({width,errors,status:await p.locator('#catalog-status').textContent()});throw e;});
 assert.equal(await p.locator('#catalog-count').textContent(),String(data.apps.length+1));assert.equal(await p.locator('.app-card').count(),12);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);
 await p.locator('[data-category=science][aria-pressed]').click();assert.equal(await p.locator('.app-card').count(),data.apps.filter(a=>a.category==='science').length);assert.equal(await p.locator('[data-category=science][aria-pressed]').getAttribute('aria-pressed'),'true');
 await p.locator('#app-source').selectOption('port');assert.equal(await p.locator('.app-card').count(),8);
 await p.locator('#app-search').fill('不存在的海豚XYZ');assert(await p.locator('#catalog-empty').isVisible());await p.locator('#reset-filters').click();
 await p.locator('[data-app=clap-stage]').click();assert.equal(await p.locator('#detail-title').textContent(),'掌心节拍');assert(await p.locator('#app-detail').evaluate(d=>d.open));assert.equal(await p.locator('#detail-close').evaluate(b=>b===document.activeElement),true);
 assert.equal(await p.locator('body').evaluate(b=>b.style.overflow),'hidden');assert(new URL(p.url()).searchParams.get('app')==='clap-stage');
 const download=await Promise.all([p.waitForEvent('download'),p.locator('#detail-download').click()]);assert.deepEqual(fs.readFileSync(await download[0].path()),archiveFixture);assert.equal(download[0].suggestedFilename(),'clap-stage.zip');assert(download[0].url().endsWith(data.apps.find(a=>a.id==='clap-stage').archive));
 await p.keyboard.press('Escape');assert(!(await p.locator('#app-detail').evaluate(d=>d.open)));assert.equal(await p.evaluate(()=>document.activeElement.dataset.app),'clap-stage');
 await p.locator('#app-search').fill('水池');await p.locator('[data-app=water-pool]').click();assert((await p.locator('#detail-install').textContent()).includes('完整代码与资源'));assert(await p.locator('#detail-download').isVisible());assert((await p.locator('#detail-source').getAttribute('href')).includes('/ports/water-pool'));
 await p.locator('.detail-visual>img').evaluate(i=>i.decode());await p.screenshot({path:path.join(os.tmpdir(),'atom-app-directory-detail-'+width+'.png')});await p.locator('#detail-close').click();
 await p.locator('#app-search').fill('星光留言');assert.equal(await p.locator('.app-card').count(),1);await p.locator('.app-card').click();assert.equal(await p.evaluate(()=>window.injected),undefined);assert.equal(await p.locator('#app-detail script').count(),0);assert((await p.locator('#detail-title').textContent()).includes('<img'));
 const sourceDownload=await Promise.all([p.waitForEvent('download'),p.locator('#detail-download').click()]);assert.deepEqual(JSON.parse(fs.readFileSync(await sourceDownload[0].path())),bundle);
 await p.locator('#detail-close').click();await p.locator('#app-search').fill('');await p.locator('#load-more').click();assert.equal(await p.locator('.app-card').count(),24);while(await p.locator('#load-more').isVisible())await p.locator('#load-more').click();assert.equal(await p.locator('.app-card').count(),data.apps.length+1);assert(await p.locator('#load-more').isHidden());
 await p.goto(origin+'/atom/apps/?category=sound&q=节拍&app=clap-stage');await p.waitForFunction(()=>document.querySelector('#app-detail').open);assert.equal(await p.locator('#detail-title').textContent(),'掌心节拍');await p.locator('#detail-close').click();assert.equal(await p.locator('#app-search').inputValue(),'节拍');assert.equal(await p.locator('[data-category=sound][aria-pressed]').getAttribute('aria-pressed'),'true');
 await p.close();
}
const failed=await browser.newPage();await failed.route('**/market/v1/catalog',r=>r.abort());await failed.goto(origin+'/atom/apps/');await failed.locator('#catalog-retry').waitFor({state:'visible'});assert.equal(await failed.locator('#catalog-count').textContent(),String(data.apps.length));assert.equal(await failed.locator('.app-card').count(),12);await failed.unroute('**/market/v1/catalog');await failed.route('**/market/v1/catalog',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({works})}));await failed.locator('#catalog-retry').click();await failed.waitForFunction(n=>document.querySelector('#catalog-count').textContent===String(n),data.apps.length+1);await failed.close();
const nojs=await browser.newPage({javaScriptEnabled:false});await nojs.goto(origin+'/atom/apps/');assert.equal(await nojs.locator('.app-card').count(),data.apps.length);await nojs.close();
for(const app of data.apps){for(const url of [app.icon,app.image].filter(Boolean)){const r=await fetch(origin+url);assert(r.ok,url);await r.arrayBuffer();}}
assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,baseApps:data.apps.length,liveMarketMerge:true,viewports:[1440,768,390,320],checks:['category and source filtering','search and empty reset','load more','detail dialog and Escape/focus return','source-package download matches bundle','complete-resource port instructions','URL deep links','untrusted metadata rendered as text','cloud failure and retry','all image and icon assets','static no-JS catalog','no horizontal overflow','read-only anonymous market requests']},null,2));
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
