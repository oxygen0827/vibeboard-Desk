/* Browser camera fixture; never opens the user's physical camera. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 try{
  const page=await browser.newPage();
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><button id="open">拍照</button>'}));
  await page.goto('http://127.0.0.1:18991/');
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'camera.js'),'utf8')});
  await page.evaluate(()=>{document.querySelector('#open').onclick=()=>{window.result='pending';window.atomCapturePhoto().then(r=>window.result=r)}});
  await page.locator('#open').click();await page.waitForFunction(()=>!document.querySelector('[data-camera=shoot]').disabled);
  await page.waitForFunction(()=>document.querySelector('video').videoWidth>0);
  await page.evaluate(()=>window.captureTracks=document.querySelector('video').srcObject.getTracks());
  await page.locator('[data-camera=shoot]').click();assert.equal(await page.evaluate(()=>window.result),'pending');
  assert.equal(await page.evaluate(()=>captureTracks.every(t=>t.readyState==='ended')),true);
  await page.locator('[data-camera=use]').click();assert.match(await page.evaluate(()=>result.data_url),/^data:image\/jpeg;base64,/);
  assert.equal(await page.locator('dialog').count(),0);
  // A permission response arriving after cancel must immediately release tracks.
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.grant=r)});
  await page.locator('#open').click();await page.locator('[data-camera=cancel]').click();
  assert.equal(await page.evaluate(()=>result),null);
  await page.evaluate(()=>{window.released=0;grant({getTracks:()=>[{stop:()=>released++}]})});
  await page.waitForFunction(()=>released===1);
  // Navigation away releases the camera and never saves a photo.
  await page.locator('#open').click();await page.evaluate(()=>atomCancelCamera());assert.equal(await page.evaluate(()=>result),null);
  console.log('Camera: explicit save, track cleanup, late permission cancellation and navigation cleanup passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
