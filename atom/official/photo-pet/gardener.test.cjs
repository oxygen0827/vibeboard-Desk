const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Y,Life,layout,installRenderer}=require('./test-support.cjs');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
const Rig=require('./yard-rig.js');
for(const complete of [false,true]){
 const state=Y.load();if(complete)state.jobs.gardener={started:1,until:2};
 for(let t=0;t<600;t+=.1){const n=Life.npc(Y.residents[1],state,10000,t,false,true);assert.notEqual(n.stage,'water');assert.notEqual(n.stage,'tend-flowers');assert.equal(Rig.goal(n,t).pour,0,'Idle and unclaimed jobs must never pour water')}
}
const start=100000,base=Y.load();base.plots=[null,{watered:0},{watered:start-5000},{watered:start-35000}];
const order=Y.act(base,'assign','gardener',start).state,saved=JSON.stringify(order);
assert.deepEqual(order.plots,base.plots,'Assignment must preserve existing crops, not instantly water everything');
assert.equal(Y.crop(order,0,start+11000),null);assert.equal(Y.phase(Y.crop(order,0,start+12500),start+12500),'dry');
assert.equal(Y.phase(Y.crop(order,0,start+16000),start+16000),'growing');assert.equal(Y.crop(order,1,start+16000).watered,0);
assert.equal(Y.crop(order,2,start+95000).watered,base.plots[2].watered,'Do not reset already growing crops');
assert.equal(Y.crop(order,3,start+95000).watered,base.plots[3].watered,'Do not reset ripe crops');
for(let i=0;i<4;i++){const event=Y.CARE.beds[i],at=start+event.fertilized*1000;assert(!Y.crop(order,i,at-1)?.fertilized);assert.equal(Y.crop(order,i,at).fertilized,true);assert.equal(Y.phase(Y.crop(order,i,start+event.harvestStart*1000),start+event.harvestStart*1000),'ready','Never harvest immature crops')}
let previous;for(let ms=0;ms<Y.CARE.duration;ms+=1000/30){const n=Life.npc(Y.residents[1],order,start+ms,ms/1000,false,true);if(previous)assert(Math.hypot(n.x-previous.x,n.y-previous.y)<1.5,'Gardener teleported');previous=n;for(let i=0;i<4;i++)assert.deepEqual(Y.crop(Y.load(JSON.parse(saved)),i,start+ms),Y.crop(order,i,start+ms))}
for(const ms of [0,12000,46000,70000,95000]){const n=Life.npc(Y.residents[1],order,start+ms,ms/1000,false,false);assert.equal(n.x,layout.residents.gardener.x);assert.equal(n.y,layout.residents.gardener.y)}
assert.equal(JSON.stringify(order),saved);assert.equal(Life.npc(Y.residents[1],order,start+34000,34,false,true).stage,'inspect','Water only when needed');
assert.equal(Y.act(order,'claim','gardener',start+95000).state,order);
const claimed=Y.act(order,'claim','gardener',start+96000).state;assert.equal(claimed.food,12);assert.deepEqual(claimed.plots,[null,null,null,null]);assert.equal(Y.act(claimed,'claim','gardener',start+96001).state,claimed);
for(const seconds of [30,60]){const legacy=Y.load();legacy.jobs.gardener={started:start,until:start+seconds*1000};legacy.plots=Array.from({length:4},()=>({watered:start}));const restored=Y.load(legacy);assert.equal(restored.jobs.gardener.until,start+seconds*1000);assert.equal(Y.act(restored,'claim','gardener',start+seconds*1000).state.food,8)}
assert.throws(()=>Y.load({...order,jobs:{...order.jobs,gardener:{started:1,until:2,care:2}}}));

(async()=>{const browser=await chromium.launch({executablePath,headless:true});try{
 const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<body style="margin:0"><canvas id="scene" width="480" height="360"></canvas></body>');
 await installRenderer(page);
 const result=await page.evaluate(async()=>{
  const canvas=document.getElementById('scene'),ctx=canvas.getContext('2d'),state=Yard.act(Yard.load(),'assign','gardener',100000).state;let now=100000,attachment;
  Date.now=()=>now;const create=YardRig.create;YardRig.create=paint=>{const rig=create(paint);return{...rig,draw(c,n,t,m){const a=rig.draw(c,n,t,m);if(n.id==='gardener')attachment=a;return a}}};
  const renderer=createTestRenderer(canvas);await renderer.ready;const keeper={x:190,y:202,walk:false,distance:0},pet={x:150,y:218,walk:false,distance:0};
  const saved=JSON.stringify(state),feet=new Map(),props={},shots={};let previous,maxWrist=0,footStable=true,bonesStable=true;
  for(let frame=0;frame<96*30;frame++){
   const t=frame/30;now=100000+t*1000;const residents=renderer.render(state,keeper,pet,t,true,null),n=residents[1],a=attachment;
   for(const [limb,l1,l2] of [[a.front,11,12],[a.back,10,11]])if(Math.abs(Math.hypot(limb.root.x-limb.elbow.x,limb.root.y-limb.elbow.y)-l1)>.001||Math.abs(Math.hypot(limb.hand.x-limb.elbow.x,limb.hand.y-limb.elbow.y)-l2)>.001)bonesStable=false;
   if(previous)maxWrist=Math.max(maxWrist,Math.hypot(a.front.hand.x-previous.x,a.front.hand.y-previous.y));previous={...a.front.hand};
   if(['sow','water','fertilize','inspect','harvest'].includes(n.stage)){
    const key=n.x+'/'+n.y,pixels=ctx.getImageData(n.x-9,n.y-5,18,8).data;if(!feet.has(key))feet.set(key,pixels.slice());else if(pixels.some((v,i)=>v!==feet.get(key)[i]))footStable=false;
    props[n.stage]=a.prop;
   }
   if([12,15,46,48,70,95].includes(t))shots[t]=canvas.toDataURL();
  }
  window.gardenerFixture={canvas,renderer,state,keeper,pet,at(t){now=100000+t*1000;renderer.render(state,keeper,pet,t,true,null)}};
  return{maxWrist,footStable,bonesStable,props,stateUnchanged:JSON.stringify(state)===saved,shots};
 });
 assert(result.stateUnchanged);assert(result.footStable,'Gardener feet changed during standing work');assert(result.bonesStable);assert(result.maxWrist<3.5,'Gardener wrist jumps: '+result.maxWrist);assert.equal(result.props.water,'can');assert.equal(result.props.fertilize,'pouch');assert.equal(result.props.sow,'seed');assert.equal(result.props.harvest,'carrot');assert.deepEqual(errors,[]);
 const dir='/tmp/yard-gardener';fs.mkdirSync(dir,{recursive:true});for(const [t,data] of Object.entries(result.shots))fs.writeFileSync(path.join(dir,t+'.png'),Buffer.from(data.split(',')[1],'base64'));
 if(process.argv.includes('--preview')){const dir='/tmp/yard-gardener-frames';fs.mkdirSync(dir,{recursive:true});let frame=0;for(const [start,end] of [[11,17],[44,48],[69,71]])for(let t=start;t<end;t+=1/12){await page.evaluate(t=>gardenerFixture.at(t),t);await page.screenshot({path:path.join(dir,String(frame++).padStart(3,'0')+'.png')})}}
 delete result.shots;console.log('PASS: crop-aware care, sequential watering, fertilizer bonus, no premature harvest, reload/offline and legacy jobs, no duplicate rewards; continuous attached tools and planted feet:',JSON.stringify(result));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
