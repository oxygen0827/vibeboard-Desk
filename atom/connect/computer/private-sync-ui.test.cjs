/* Real dashboard and local HTTP boundary; upstream identity/data are isolated fixtures. */
const assert=require('node:assert/strict');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{
 const {dashboard}=await import('./main.mjs');
 let broken=true,writes=0;
 const studio={async handle(method,route){
  if(route==='/state')return {authenticated:true,user:{id:'fixture',username:'测试'},jobs:[],encryption:'on'};
  if(route==='/notes'||route==='/agenda'){
   if(method==='POST'){writes++;throw Error('must not write while locked');}
   if(broken)throw Object.assign(Error('不能解密'),{status:423,code:'decryption_failed'});
   return route==='/notes'?{notes:[{id:'n',text:'恢复的原文',revision:1}],pending:0}:{items:[{id:'a',title:'恢复的日程',kind:'todo'}],pending:0};
  }
  return {drafts:[],works:[],jobs:[]};
 }};
 const {server,origin}=await dashboard({studio,state:()=>({configured:false,paired:[],tasks:[],projects:[],agents:[]})},{port:0});
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath});const page=await browser.newPage({viewport:{width:1180,height:780}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
  await page.locator('[data-page=notes]').first().click();
  await page.getByText('暂时无法解密',{exact:true}).waitFor();
  assert(await page.locator('#note-editor textarea').isDisabled());
  await page.locator('#notes-sync').click();
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('随手记已同步',{exact:true}).count(),0);
  broken=false;await page.getByRole('button',{name:'重试读取',exact:true}).click();
  await page.getByText('恢复的原文',{exact:true}).waitFor();assert(await page.locator('#note-editor textarea').isEnabled());
  broken=true;await page.locator('[data-page=agenda]').first().click();await page.getByText('暂时无法解密',{exact:true}).waitFor();
  assert(await page.locator('#agenda-add input[name=title]').isDisabled());
  broken=false;await page.getByRole('button',{name:'重试读取',exact:true}).click();await page.getByText('恢复的日程',{exact:true}).waitFor();
  assert(await page.locator('#agenda-add input[name=title]').isEnabled());assert.equal(writes,0);assert.deepEqual(errors,[]);
  assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));
  console.log('PASS: failed decryption locks editing, offers retry, never claims sync success; retry restores notes/agenda without writes or page overflow.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
