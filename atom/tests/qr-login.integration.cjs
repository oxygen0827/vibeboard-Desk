/* Real phone WebCrypto -> local relay -> device account handoff, isolated from production. */
const {spawn}=require('node:child_process'),{once}=require('node:events'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium,executablePath}=require('../tools/browser-test-runtime.cjs');
(async()=>{
 const proc=spawn(process.env.ATOM_TEST_PYTHON||'python3',[path.join(__dirname,'qr_login_fixture.py')],{stdio:['ignore','pipe','inherit']});
 let browser;
 try{
  const config=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('fixture startup timed out')),15000);proc.once('exit',()=>{clearTimeout(timer);reject(Error('fixture failed'));});proc.stdout.on('data',b=>{text+=b;const line=text.split('\n').find(s=>s.startsWith('{'));if(line){clearTimeout(timer);resolve(JSON.parse(line));}});});
  browser=await chromium.launch({headless:true,executablePath});const device=await browser.newPage({viewport:{width:480,height:360}}),phone=await browser.newPage({viewport:{width:390,height:844}});
  let errors=[];for(const p of [device,phone])p.on('pageerror',e=>errors.push(e.message));
  const post=async(action,body={})=>{const r=await fetch(config.device+'/api/market/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:config.device},body:JSON.stringify(body)});const v=await r.json();assert.equal(r.ok,true,v.error);return v;};
  await device.goto(config.device);await device.waitForSelector('[data-welcome="next"]');
  await device.getByRole('button',{name:'开始设置',exact:true}).click();await device.getByRole('button',{name:'下一步',exact:true}).click();const qrResponse=device.waitForResponse(r=>r.url().endsWith('/api/market/qr-start'));await device.getByRole('button',{name:'用手机扫码登录',exact:true}).click();await device.waitForSelector('.welcome-qr-code svg');
  const geometry=await device.locator('.welcome-card').evaluate(el=>({bottom:el.getBoundingClientRect().bottom,height:el.scrollHeight,client:el.clientHeight}));assert.ok(geometry.bottom<=360&&geometry.height<=geometry.client+1,JSON.stringify(geometry));
  // Read the generated URL from the response, never from logs or a screenshot.
  const start=await (await qrResponse).json();
  await phone.goto(start.url);
  let failOnce=true;await phone.route('**/qr-login/seal',async route=>{if(failOnce){failOnce=false;await route.abort();}else await route.continue();});
  await phone.getByLabel('用户名').fill('phone_test');await phone.getByLabel('密码').fill('disposable-test-password');await phone.getByRole('button',{name:'登录小电脑',exact:true}).click();
  await phone.getByRole('button',{name:'重试完成登录'}).waitFor();await phone.getByRole('button',{name:'重试完成登录'}).click();await phone.locator('#intro.status.ok').waitFor();
  await device.locator('.welcome-card h1').filter({hasText:/^AI$/}).waitFor();const done=await post('state');assert.equal(done.encryption,'on');assert.equal(done.user.username,'phone_test');assert.equal((await (await fetch(config.device+'/test/key-match')).json()).matches,true,'browser transferred the original account key');
  assert.equal((await post('qr-poll')).status,'expired');
  const cancel=await post('qr-start');await post('qr-cancel',{code:cancel.code});assert.equal((await post('qr-poll')).status,'expired');
  await phone.goto(config.phone+'/login#c=BAD&k=%');await phone.waitForSelector('#form[hidden]',{state:'attached'});assert.deepEqual(errors,[]);
  await device.getByRole('button',{name:'下一步',exact:true}).click();await device.getByRole('button',{name:'下一步',exact:true}).click();await device.getByRole('button',{name:'进入桌面',exact:true}).click();
  await device.locator('[data-app="settings"]').click();
  await device.route('**/api/system/time',r=>r.fulfill({json:{now:'2026-10-22T12:00:00+08:00',timezone:'Asia/Shanghai',automatic:true,synchronized:true,automatic_available:true,zones:['Asia/Shanghai','UTC']}}));
  await device.route('**/api/bluetooth',r=>r.fulfill({json:{status:{available:true,powered:true},devices:Array.from({length:12},(_,i)=>({address:'AA:BB:CC:DD:EE:'+String(i).padStart(2,'0'),name:'测试音箱 '+i,kind:'audio',paired:true,connected:i===0}))}}));
  for(const panel of ['time','bluetooth','power']){
   await device.locator('[data-settings-page="'+panel+'"]').click();await device.locator('#system-panel').waitFor();await device.waitForTimeout(150);
   const bounds=await device.locator('#system-panel').evaluate(el=>({bottom:el.getBoundingClientRect().bottom,overflow:el.scrollHeight-el.clientHeight}));assert.ok(bounds.bottom<=360&&bounds.overflow<=1,JSON.stringify({panel,...bounds}));
   await device.screenshot({path:'/private/tmp/atom-settings-'+panel+'.png'});
   await device.locator('[data-settings-page="menu"]').click();
  }
  console.log('QR integration passed: 480x360 layout, real password/key handoff, seal network failure + retry, cancellation, malformed URL.');
 }finally{if(browser)await browser.close();proc.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
