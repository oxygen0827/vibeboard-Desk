/* Real canvas animation, no task fixtures or system keyboard interception. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath});try{
 const page=await browser.newPage({viewport:{width:480,height:360}});
 await page.setContent('<canvas width="480" height="360" id="canvas"></canvas><div id="target" tabindex="0"></div>');
 for(const file of ['pets.js','scene.js'])await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,file),'utf8')});
 await page.evaluate(async()=>{window.scene=createPetScene(document.querySelector('canvas'),document.querySelector('#target'));const image=new Image();image.src=ATOMPets[0].image;await image.decode();scene.setImage(image,ATOMPets[0]);scene.setState('idle','local',false)});
 const data=()=>page.evaluate(()=>document.querySelector('canvas').toDataURL());
 const x=()=>page.locator('canvas').getAttribute('data-pet-x');
 await page.waitForTimeout(7600);assert.equal(await page.locator('canvas').getAttribute('data-action'),'runRight');const start=Number(await x());await page.waitForTimeout(300);assert(Number(await x())>start);
 await page.locator('#target').focus();const held=await x();await page.waitForTimeout(250);assert.equal(await x(),held);
 await page.evaluate(()=>scene.react());assert.equal(await page.locator('canvas').getAttribute('data-action'),'jumping');await page.waitForTimeout(1200);assert.equal(await page.locator('canvas').getAttribute('data-action'),'idle');
 for(const state of ['idle','runRight','runLeft','waving','jumping','failed','waiting','running','review']){await page.evaluate(state=>scene.setState(state,state,true),state);assert.equal(await page.locator('canvas').getAttribute('data-action'),state);assert.equal(await page.evaluate(()=>Array.from(document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data).join(',')),'0,0,0,255')}
 await page.evaluate(()=>scene.setVisible(false));let before=await data();await page.waitForTimeout(300);assert.equal(await data(),before);
 await page.evaluate(()=>{scene.setVisible(true);scene.setMotion(false)});before=await data();await page.waitForTimeout(300);assert.equal(await data(),before);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>scene.setMotion(true));before=await data();await page.waitForTimeout(300);assert.equal(await data(),before);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>scene.stop());before=await data();await page.waitForTimeout(300);assert.equal(await data(),before);
 console.log('PASS: autonomous walking, focused target stability, tap reaction, nine states, black background, panel pause, system/reduced motion, suspension');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
