/* Desktop layout regression: real dashboard CSS/routes, isolated demo catalog, Chromium and WebKit. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{
 const {dashboard}=await import('./main.mjs');
 const {ResourcePreviews}=await import('./resource-preview.mjs');
 const root=path.resolve(__dirname,'../..'),bundle=JSON.parse(fs.readFileSync(path.join(root,'official/clap-stage/bundle.json')));
 const fixtures=[['clap-stage','掌心节拍','把节奏握在手心。'],['weather-window','天气之窗','看见此刻的天气。'],['mini-piano','迷你钢琴','让一段旋律，点亮今天。'],['photon-chip','光子芯片','探索光与电路的世界。']];
 const pictures=fixtures.map(([file])=>'data:image/jpeg;base64,'+fs.readFileSync(path.join(root,'official/covers',file+'.jpg')).toString('base64'));
 const covers=new Map(pictures.map((image,i)=>[(i+1).toString().repeat(32),image]));
 const works=Array.from({length:12},(_,i)=>({id:'work-'+i,title:fixtures[i%4][1]+(i>=4?' · 灵感 '+(i+1):''),description:fixtures[i%4][2],cover_id:(i%4+1).toString().repeat(32),author:'ATOM 演示',latest_version_id:'version-'+i,license:'MIT',category:i%2?'play':'sound'}));
 const drafts=works.map((w,i)=>({...w,id:(i+10).toString(16).repeat(32),cover_id:i%3?w.cover_id:null,revision:1,title:i===0?'我的天气窗':w.title,work_id:i%3===1?w.id:null}));
 const library=['work-0','water-pool','moon-ocean','task-pal'].map((id,i)=>({id,name:'资源演示 '+i,description:'完整的场景源码与素材',cover_id:'1'.repeat(32),files:4,archive_bytes:1048576,archive:'/atom/assets/library/'+id+'-'+'a'.repeat(16)+'.zip'}));
 let delayState=false,releaseState;const calls=[];
 const studio={workspaceView:()=>({draft:drafts[0],bundle}),async handle(method,route){calls.push(route);
  if(route==='/state'){if(delayState)await new Promise(resolve=>releaseState=resolve);return {authenticated:true,user:{id:'demo',username:'演示账号'},jobs:[],encryption:'on'};}
  if(route.startsWith('/catalog?')){const q=new URL(route,'http://fixture').searchParams.get('q')||'';return {works:works.filter(w=>w.title.includes(q)),library:library.filter(a=>a.name.includes(q))};}
  if(route==='/drafts')return {drafts};
  if(route.startsWith('/works/'))return {work:works.find(w=>w.id===route.split('/')[2]),versions:[{id:'version-0',number:1,changelog:'初次发布'}],derivatives:[]};
  if(route.startsWith('/versions/'))return {bundle};
  if(route==='/community/targets')return {targets:[{id:'fixture-device',name:'演示 ATOM',online:true}]};
  if(route==='/community/jobs')return {jobs:drafts.map(d=>({draft_id:d.id,status:'completed',id:'job-'+d.id}))};
  if(route.startsWith('/covers/'))return {image:covers.get(route.split('/').pop())};
  if(route.startsWith('/drafts/'))return {draft:drafts.find(d=>d.id===route.split('/')[2]),bundle};
  if(route.startsWith('/workspaces/'))return {draft:drafts.find(d=>d.id===route.split('/')[2]),bundle,snapshots:[],dirty:false};
  return {works:[],jobs:[],drafts:[],notes:[],items:[],suggestions:[]};
 }};
 const previews=new ResourcePreviews();previews.library=async()=>previews.add(bundle);
 const {server,origin}=await dashboard({studio,state:()=>({configured:false,paired:[],tasks:[],projects:[],agents:[]})},{port:0,resourcePreviews:previews});
 try{for(const [engine,launcher]of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch({headless:true,...(engine==='chromium'?{executablePath}:{})});
  try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const size of [{width:1200,height:778},{width:820,height:532}])for(const color of ['light','dark']){
    await page.setViewportSize(size);await page.emulateMedia({colorScheme:color});await page.goto(origin);
    const ui=page.locator('#community-studio');
    const checkTask=async(name,action)=>{
     if(action)await ui.getByRole('button',{name:action,exact:true}).waitFor();
     await page.waitForTimeout(220);
     const geometry=await ui.evaluate(el=>{const c=el.querySelector('.community-content'),r=el.getBoundingClientRect();return {bodyOverflow:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth,horizontal:c.scrollWidth>c.clientWidth+1,top:r.top,bottom:r.bottom,height:innerHeight};});
     assert(!geometry.bodyOverflow&&!geometry.horizontal&&geometry.top>=0&&geometry.bottom<=geometry.height+1,name+JSON.stringify(geometry));
     if(action)assert(await ui.getByRole('button',{name:action,exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&!!hit&&n.contains(hit)}),name+' action is clipped or covered');
     await page.screenshot({path:`/tmp/atom-task-${engine}-${name}-${size.width}-${color}.png`});
    };
    for(const [tab,title,selector]of [['market','发现','.community-card'],['creations','我的创作','.community-drafts>.community-draft']]){
     await page.locator(`[data-page=${tab}]`).first().click();await ui.getByRole('heading',{name:title,exact:true}).waitFor();await ui.locator(selector).first().waitFor();
     await page.waitForFunction(()=>[...document.querySelectorAll('#community-studio img')].filter(img=>{const r=img.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).every(img=>img.complete&&img.naturalWidth>0));
     await page.waitForTimeout(200);
     const geometry=await ui.evaluate((el,selector)=>{const card=[...el.querySelectorAll(selector)].map(n=>n.getBoundingClientRect());const content=el.querySelector('.community-content');const r=el.getBoundingClientRect();return {outerOverflow:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth,innerOverflow:content.scrollWidth>content.clientWidth+1,top:r.top,bottom:r.bottom,height:innerHeight,columns:card.filter(c=>Math.abs(c.top-card[0].top)<2).length,background:getComputedStyle(el).backgroundColor,panels:[...document.querySelectorAll('main>section:not([hidden])')].length,nav:el.querySelectorAll('nav').length,cardWidth:card[0].width};},selector);
     assert.equal(geometry.outerOverflow,false,engine+' '+JSON.stringify(geometry));assert.equal(geometry.innerOverflow,false);assert(geometry.top>=0&&geometry.bottom<=size.height+1);assert(geometry.columns>=2);assert.equal(geometry.panels,1);assert.equal(geometry.nav,0);assert(geometry.cardWidth<500);assert.equal(await page.locator('.sidebar [aria-current=page]').getAttribute('data-page'),tab);
     await page.screenshot({path:`/tmp/atom-layout-${engine}-${tab}-${size.width}-${color}.png`});
     if(tab==='market'){
      assert.equal(await ui.locator('.community-card').count(),14,'all public works and unique resource apps must be discoverable');
      assert.equal(await ui.locator('.community-pagination').count(),0,'Mac must not hide apps behind the device eight-item pages');
      await ui.getByRole('button',{name:'公开作品 12',exact:true}).click();assert.equal(await ui.locator('.community-card').count(),12);
      await ui.getByRole('button',{name:'资源版 2',exact:true}).click();assert.equal(await ui.locator('.community-resource-card').count(),2);
      await ui.locator('.community-resource-card').first().click();await checkTask('resource','下载完整源码 ZIP');await ui.locator('iframe').waitFor();assert.equal(await ui.frameLocator('iframe').locator('body').evaluate(()=>innerWidth),480);await ui.frameLocator('iframe').getByRole('button',{name:'切换节拍音色',exact:true}).click();
      assert.equal(await ui.getByRole('button',{name:'安装',exact:true}).count(),0,'resource archives must not pretend to support version delivery');
      await ui.getByRole('button',{name:'‹ 返回',exact:true}).click();await ui.getByRole('button',{name:'全部应用 14',exact:true}).click();
      const content=ui.locator('.community-content');await content.evaluate(n=>n.scrollTop=n.scrollHeight);
      assert(await ui.getByRole('button',{name:'资源版 2',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight}),'catalog scope must remain visible while browsing');
      await content.evaluate(n=>n.scrollTop=0);
      await ui.getByLabel('搜索作品').fill('资源演示 2');await ui.getByRole('button',{name:'查找',exact:true}).click();
      await ui.getByRole('button',{name:'全部应用 1',exact:true}).waitFor();assert.equal(await ui.locator('.community-resource-card').count(),1,'search must include archive-only apps');
      await ui.getByLabel('搜索作品').fill('');await ui.getByRole('button',{name:'查找',exact:true}).click();await ui.getByRole('button',{name:'全部应用 14',exact:true}).waitFor();
      await ui.getByLabel('探索方式').selectOption('remixes');await ui.getByRole('button',{name:'查找',exact:true}).click();await ui.getByRole('button',{name:'全部应用 0',exact:true}).waitFor();assert.equal(await ui.locator('.community-resource-card').count(),0);
      await ui.getByLabel('探索方式').selectOption('all');await ui.getByRole('button',{name:'查找',exact:true}).click();await ui.getByRole('button',{name:'全部应用 14',exact:true}).waitFor();
      await ui.locator('.community-card').first().click();await checkTask('work','放大体验');await ui.locator('iframe').waitFor();
      await ui.getByRole('button',{name:'放大体验',exact:true}).click();await ui.locator('iframe').waitFor();
      assert.equal(await ui.frameLocator('iframe').locator('body').evaluate(()=>innerWidth),480,'preview must keep device viewport');
      await checkTask('preview','‹ 返回');await ui.getByRole('button',{name:'‹ 返回',exact:true}).click();
      await ui.locator('iframe').waitFor();assert.equal(await ui.locator('iframe').count(),1,'returning to details mounts a fresh inline preview');
      await ui.getByRole('button',{name:'安装',exact:true}).click();await checkTask('install','确认添加');await ui.getByRole('button',{name:'‹ 返回',exact:true}).click();
      await ui.getByRole('button',{name:'更多操作',exact:true}).click();await checkTask('work-options','源码与历史版本');await ui.getByRole('button',{name:'源码与历史版本',exact:true}).click();await checkTask('history','查看这一版');await ui.getByRole('button',{name:'查看这一版',exact:true}).click();await checkTask('source','‹ 返回');
     }
    }
    await ui.getByRole('button',{name:'新建作品',exact:true}).click();await ui.getByRole('heading',{name:'说出你的想法'}).waitFor();assert.equal(await page.locator('.sidebar [aria-current=page]').getAttribute('data-page'),'creations');
    assert(await ui.getByRole('button',{name:'开始创作',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return r.bottom<=innerHeight&&r.left>=0}),'creation action clipped');
    await ui.getByRole('button',{name:'‹ 我的创作',exact:true}).click();await ui.getByRole('heading',{name:'我的创作',exact:true}).waitFor();
    await ui.getByRole('button',{name:/我的天气窗/}).click();await ui.locator('.community-preview').waitFor();await checkTask('edit','帮我修改');
    await ui.getByLabel('修改想法').fill('这个想法在返回后要保留');
    await ui.getByRole('button',{name:'分享作品',exact:true}).click();await checkTask('publish','确认公开发布');await ui.getByRole('button',{name:'‹ 返回',exact:true}).click();
    assert.equal(await ui.getByLabel('修改想法').inputValue(),'这个想法在返回后要保留');
    await ui.getByRole('button',{name:'体验作品',exact:true}).click();await checkTask('draft-preview','‹ 返回');await ui.getByRole('button',{name:'‹ 返回',exact:true}).click();
    assert.equal(await ui.getByLabel('修改想法').inputValue(),'这个想法在返回后要保留');
    await ui.getByRole('button',{name:'更多操作',exact:true}).click();await checkTask('edit-options','高级源码');await ui.getByRole('button',{name:'高级源码',exact:true}).click();await page.locator('#editor-back').click();await ui.getByRole('heading',{name:'我的创作',exact:true}).waitFor();assert.equal(await page.locator('#community-studio').count(),1);
   }
   // Preview failures must leave the editor usable; failed embeds cannot strand navigation.
   await page.route('**/api/studio/preview',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试预览暂时不可用'})}));
   await page.locator('#community-studio').getByRole('button',{name:/我的天气窗/}).click();
   await page.getByRole('button',{name:'重新载入预览',exact:true}).waitFor();
   assert(await page.getByLabel('修改想法').isEditable());
   await page.locator('[data-page=overview]').first().click();
   assert.equal(await page.locator('#community-studio iframe').count(),0);
   await page.unroute('**/api/studio/preview');
   // Delayed account lookup cannot flash login or resurrect a page after navigation away.
   delayState=true;await page.locator('[data-page=market]').first().click();await page.getByText('正在确认账号与服务状态…',{exact:true}).waitFor();assert.equal(await page.locator('#community-studio').getByRole('button',{name:'登录账号'}).count(),0);
   await page.locator('[data-page=overview]').first().click();delayState=false;releaseState();await page.waitForTimeout(200);assert.equal(await page.locator('.sidebar [aria-current=page]').getAttribute('data-page'),'overview');
   assert.deepEqual(errors,[]);console.log('PASS '+engine+': desktop roots and work/edit/preview/install/publish/source/options, visible actions, 480×360 preview, failure recovery, light/dark, minimum viewport, preserved input and delayed identity.');
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
