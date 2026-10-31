/* Read-only local resources; no production account, model call or hardware claims. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,executablePath}=require('../tools/browser-test-runtime.cjs');
const ids=['water-pool','volume-flow','physics-playground','model-viewer','moon-ocean','rhythm-orbits','parametric-maker','planetarium','robo-face','music-vision','pocket-studio'];
(async()=>{
 const {ResourcePreviews}=await import('../connect/computer/resource-preview.mjs');
 const {dashboard}=await import('../connect/computer/main.mjs');
 const previews=new ResourcePreviews();const {server,origin}=await dashboard({state:()=>({})},{port:0,resourcePreviews:previews});
 const browser=await chromium.launch({headless:true,executablePath});
 try{for(const id of ids){
  const root=path.join(__dirname,id),files={};
  function read(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.name.startsWith('.')||['node_modules','__pycache__'].includes(ent.name))continue;const p=path.join(dir,ent.name);if(ent.isDirectory())read(p);else if(ent.isFile()&&!['bundle.json','manifest.json'].includes(ent.name))files[path.relative(root,p).split(path.sep).join('/')]=fs.readFileSync(p);}}
  read(root);const {url}=previews.add({manifest:JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),files});
  const p=await browser.newPage({viewport:{width:480,height:360}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{await p.goto(origin+url);await p.waitForFunction(()=>window.AtomSceneSession&&window.AtomInput);await p.waitForTimeout(1200);
   const trigger=p.locator('#scene-tools');
   if(await trigger.count()){
    await trigger.evaluate(n=>AtomInput.focus(n));await p.keyboard.press('Space');await p.locator('#scene-tools-panel').waitFor({state:'visible'});
    await p.keyboard.press('ArrowDown');assert.match(await p.locator('[data-atom-focused]').getAttribute('id'),/^scene-action-/);await p.keyboard.press('Space');
    await p.evaluate(()=>AtomInput.back());await p.locator('#scene-tools-panel').waitFor({state:'hidden'});
   }else if(id==='robo-face'){
    await p.locator('#menu').evaluate(n=>AtomInput.focus(n));await p.keyboard.press('Space');await p.locator('#panel').waitFor({state:'visible'});await p.evaluate(()=>AtomInput.back());await p.locator('#panel').waitFor({state:'hidden'});
   }else{
    const control=p.locator(id==='pocket-studio'?'#play':'#palette');
    if(await control.count()){await control.evaluate(n=>AtomInput.focus(n));await p.keyboard.press('Space');}
   }
   assert.equal(await p.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false,id+' root scrolling');
   await p.evaluate(()=>window.postMessage({type:'atom:preview-suspend'},'*'));await p.waitForFunction(()=>!AtomSceneSession.active);
   assert.deepEqual(errors,[],id+' script errors');console.log('PASS '+id+': loaded, semantic controls/back and suspend');
  }finally{await p.close();previews.release(url);}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
