// Observe rendered pixels, including the previously frozen ready-job state.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Y,Life,layout,installRenderer}=require('./test-support.cjs');
const {chromium,executablePath}=require('../../tools/browser-test-runtime.cjs');
for(const complete of [false,true]){
 const state=Y.load();if(complete)for(const n of Y.residents)state.jobs[n.id]={started:1,until:2};
 const saved=JSON.stringify(state);
 for(const n of Y.residents){const frames=new Set();for(let t=0;t<40;t+=.1){const pose=Life.npc(n,state,10000,t,false,true);frames.add(pose.frame);assert.equal(pose.phase,complete?'ready':'idle');assert.equal(pose.x,layout.residents[n.id].x);assert.equal(pose.y,layout.residents[n.id].y)}assert(frames.size>=(n.id==='gardener'?2:3),n.id+' must retain occasional idle movement');assert.deepEqual(Life.npc(n,state,10000,0,true,false),Life.npc(n,state,10000,9,true,false))}
 assert.equal(JSON.stringify(state),saved);
}
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:480,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<body style="margin:0"><canvas id="scene" width="480" height="360"></canvas></body>');
  await installRenderer(page);
  const result=await page.evaluate(async()=>{
   const canvas=document.getElementById('scene'),ctx=canvas.getContext('2d'),renderer=createTestRenderer(canvas);await renderer.ready;
   const state=Yard.load();for(const n of Yard.residents)state.jobs[n.id]={started:1,until:2};const saved=JSON.stringify(state);
   const keeper={x:190,y:202,walk:false,distance:0},pet={x:150,y:218,walk:false,distance:0};
   const regions={smith:[90,85,70,75],gardener:[240,100,70,72],fisher:[342,100,70,75],keeper:[176,150,29,54],water:[420,180,56,32],fire:[56,98,20,15],smoke:[198,8,25,35],leaves:[8,197,20,27]};
   const samples=Object.fromEntries(Object.keys(regions).map(k=>[k,[]]));
   for(const t of [0,1.1,2.8,5.6,7,28]){renderer.render(state,keeper,pet,t,true,null,{ambient:false});for(const [key,box] of Object.entries(regions))samples[key].push(ctx.getImageData(...box).data.slice())}
   const changed={};for(const [key,frames] of Object.entries(samples)){const a=frames[0];let total=0;for(let i=0;i<a.length;i+=4)if(frames.some(b=>Math.abs(b[i]-a[i])+Math.abs(b[i+1]-a[i+1])+Math.abs(b[i+2]-a[i+2])>25))total++;changed[key]=total}
   const still=[];for(const t of [0,7]){renderer.render(state,keeper,pet,t,false,null,{ambient:true});still.push(canvas.toDataURL())}
   window.motionFixture={renderer,state,keeper,pet,canvas};return{changed,stateUnchanged:JSON.stringify(state)===saved,reducedIsStill:still[0]===still[1],ready:canvas.dataset.readyProducts};
  });
  for(const [region,pixels] of Object.entries(result.changed))assert(pixels>20,region+' must visibly change: '+pixels);
  assert(result.stateUnchanged);assert(result.reducedIsStill);assert.equal(result.ready,'smith,gardener,fisher');assert.deepEqual(errors,[]);
  const continuity=await page.evaluate(async()=>{
   const environmentCreate=YardEnvironment.create,rigCreate=YardRig.create;let joints={};
   YardEnvironment.create=image=>{const e=environmentCreate(image);return{render(c){e.render(c,0,false)}}};
   YardRig.create=paint=>{const r=rigCreate(paint);return{draw(c,n,t,m){const p=r.draw(c,n,t,m);joints[n.id]=p;return p}}};
   const canvas=document.createElement('canvas');canvas.width=480;canvas.height=360;const ctx=canvas.getContext('2d'),r=createTestRenderer(canvas);await r.ready;
   const f=motionFixture,footRegions={smith:[104,151,36,9],gardener:[252,161,38,9],fisher:[353,164,37,9]},feet={},before={},maxStep={smith:0,gardener:0,fisher:0};let footStable=true,bonesStable=true;
   for(let frame=0;frame<300;frame++){
    r.render(f.state,f.keeper,f.pet,frame/30,true,null,{ambient:true});
    for(const id of Object.keys(footRegions)){
     const pixels=ctx.getImageData(...footRegions[id]).data;if(!feet[id])feet[id]=pixels.slice();else if(pixels.some((v,i)=>v!==feet[id][i]))footStable=false;
     const p=joints[id];for(const [limb,upper,lower] of [[p.front,11,12],[p.back,10,11]])if(Math.abs(Math.hypot(limb.root.x-limb.elbow.x,limb.root.y-limb.elbow.y)-upper)>.001||Math.abs(Math.hypot(limb.hand.x-limb.elbow.x,limb.hand.y-limb.elbow.y)-lower)>.001)bonesStable=false;
     if(before[id])maxStep[id]=Math.max(maxStep[id],Math.hypot(p.front.hand.x-before[id].x,p.front.hand.y-before[id].y));before[id]={...p.front.hand};
    }
   }
   YardEnvironment.create=environmentCreate;YardRig.create=rigCreate;return{footStable,bonesStable,maxStep};
  });
  assert(continuity.footStable,'Standing feet must not change while arms work');assert(continuity.bonesStable,'Arm bones must keep their length');for(const [id,step] of Object.entries(continuity.maxStep))assert(step<3.5,id+' wrist jumped '+step+' pixels in one frame');console.log('Continuous limbs:',JSON.stringify(continuity));
  if(process.argv.includes('--preview')){
   const dir='/tmp/yard-ambient-frames';fs.mkdirSync(dir,{recursive:true});
   for(let i=0;i<96;i++){await page.evaluate(t=>{const f=motionFixture;f.renderer.render(f.state,f.keeper,f.pet,t,true,null,{ambient:true})},i/12);await page.screenshot({path:path.join(dir,String(i).padStart(3,'0')+'.png')})}
  }
  console.log('PASS: continuous idle/ready resident motion; rendered regional changes '+JSON.stringify(result.changed)+'; no state mutations; reduced motion freezes scenery and residents.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
