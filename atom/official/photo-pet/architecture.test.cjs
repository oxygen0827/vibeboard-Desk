const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Y,Life,catalog,layout}=require('./test-support.cjs');
const modules={
 'yard-catalog.js':'YardCatalog','yard-layout.js':'YardLayout','yard-ports.js':'YardPorts',
 'yard.js':'YardDomain','yard-life.js':'YardLife','yard-session.js':'YardSession',
 'yard-scene.js':'YardScene','yard-controller.js':'YardController',
 'yard-view.js':'YardView','yard-platform.js':'YardPlatform','yard-renderer.js':'YardRenderer',
 'yard-rig.js':'YardRig','yard-environment.js':'YardEnvironment','renderer.js':'PixelPetRenderer','pets.js':'PixelPets'
};
const core=['yard-catalog.js','yard-layout.js','yard-ports.js','yard.js','yard-life.js','yard-session.js','yard-scene.js','yard-controller.js'];
for(const [file,own] of Object.entries(modules)){
 const source=fs.readFileSync(path.join(__dirname,file),'utf8');
 const references=source.match(/\b(?:Yard[A-Z]\w*|PixelPets|PixelPetRenderer)\b/g)||[];
 assert(references.every(name=>name===own),file+' acquired a concrete peer instead of an injected dependency');
 if(core.includes(file)){
  assert(!/\b(?:document|window|AtomApp|Date|performance|requestAnimationFrame|setTimeout|setInterval|fetch|localStorage)\b/.test(source),file+' must stay independent of browser, time and I/O');
  const context=vm.createContext({module:{exports:{}}});
  for(const key of ['document','window','AtomApp','Date','performance','setTimeout','fetch'])Object.defineProperty(context,key,{get(){throw Error(file+' touched '+key)}});
  vm.runInContext(source,context,{filename:file});assert(context.module.exports);
 }
}
// The raster adapter accepts frames; it cannot recompute gameplay or read a second clock.
const raster=fs.readFileSync(path.join(__dirname,'yard-renderer.js'),'utf8');
assert(!/Date\.now|\.jobs\b|\.crop\(|\.jobPhase\(/.test(raster));
assert(fs.readFileSync(path.join(__dirname,'app.js'),'utf8').split('\n').length<45,'Composition root grew application logic');
const index=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const scripts=[...index.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(scripts).size,scripts.length);
assert(!scripts.includes('interactions.js'),'Retired UI must not reenter the runtime');
if(process.argv.includes('--bundle')){
 const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'bundle.json'),'utf8'));
 const expected=['index.html','style.css','icon.svg',...scripts];assert.deepEqual(Object.keys(bundle.files).sort(),expected.sort());
 for(const name of expected)assert.equal(bundle.files[name],fs.readFileSync(path.join(__dirname,name),'utf8'),name+' bundle is stale');
 console.log('PASS: complete and current offline bundle, '+expected.length+' resources');
}
console.log('PASS: architecture boundaries, injected dependencies, pure core, renderer isolation, single composition root');

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
(async()=>{
 const create=require('./yard-session.js').create;let saves=0,write,readFail=true,time=100000;
 const repository={load:async()=>{if(readFail)throw Error('unreadable');return{pet:'rabbit'}},save:state=>{saves++;write=deferred();return write.promise}};
 const session=create({domain:Y,repository,clock:{wall:()=>time}});
 assert.equal((await session.load()).code,'readFailed');assert.equal((await session.dispatch('plot',0)).status,'unavailable');assert.equal(saves,0);
 readFail=false;await session.load();assert.equal(session.snapshot().state.pet,'rabbit');assert(Object.isFrozen(session.snapshot().state.plots));
 const before=session.snapshot().state,pending=session.dispatch('plot',0);
 assert.equal(session.snapshot().state,before);assert.equal(session.snapshot().busy,true);
 assert.equal((await session.dispatch('plot',1)).status,'busy');assert.equal(saves,1);
 write.reject(Error('disk full'));assert.equal((await pending).code,'saveFailed');assert.equal(session.snapshot().state,before);
 const success=session.dispatch('plot',0);write.resolve({mode:'device'});const result=await success;
 assert.equal(result.status,'committed');assert.deepEqual(result.events,[{kind:'plant',index:0}]);assert.equal(session.snapshot().state.plots[0].watered,0);
 const watering=session.dispatch('plot',0);write.resolve({mode:'device'});await watering;time+=31000;
 const harvest=session.dispatch('plot',0);assert.equal((await session.dispatch('plot',0)).status,'busy');write.resolve({mode:'device'});await harvest;assert.equal(session.snapshot().state.food,2);
 let notifications=0;session.subscribe(()=>notifications++);const late=session.dispatch('feed');session.dispose();const count=notifications;write.resolve({mode:'device'});assert.equal((await late).status,'disposed');assert.equal(notifications,count);
 console.log('PASS: read protection, acknowledged writes, serialized commands, rollback, no duplicate harvest, suspend during save');
 const scene=require('./yard-scene.js').create({domain:Y,life:Life,layout});let state=Y.load(),mono=0;
 const tick=(delta,extra={})=>{mono+=delta;return scene.tick({state,wallTime:100000+mono,monotonic:mono,motion:true,paused:false,ready:true,busy:false,...extra})};
 scene.touch(0);tick(0);scene.request('plot',3);tick(100);scene.request('plot',0);
 const commands=[];for(let i=0;i<200;i++)commands.push(...tick(1000/30).commands);
 assert.deepEqual(commands,[{kind:'plot',index:0}]);
 scene.request('plot',2);tick(100);scene.cancelRoute();for(let i=0;i<200;i++)assert.equal(tick(1000/30).commands.length,0);
 let frame=tick(180000);assert.equal(frame.autonomous,true);scene.touch(mono);frame=tick(10);assert.equal(frame.autonomous,false);
 state=Y.act(state,'assign','gardener',100000+mono).state;
 for(let i=0;i<450;i++)frame=tick(1000/30);
 const position={x:frame.residents[1].x,y:frame.residents[1].y};
 frame=tick(60000,{paused:true});assert.equal(frame.residents[1].x,position.x);assert.equal(frame.residents[1].y,position.y);
 frame=tick(1000/30);assert(Math.hypot(frame.residents[1].x-position.x,frame.residents[1].y-position.y)<=2.401,'Resume must not teleport a resident');
 const immutable=JSON.stringify(state);for(let i=0;i<660;i++)frame=tick(1000/30);assert.equal(JSON.stringify(state),immutable);assert.equal(frame.jobs[1].canClaim,true);
 for(const id of ['smith','gardener','fisher']){state=Y.load();state=Y.act(state,'assign',id,1000).state;const f=scene.tick({state,wallTime:12000,monotonic:mono+100,motion:false,paused:false,ready:true,busy:false});const n=f.residents.find(n=>n.id===id);assert.equal(n.x,layout.residents[id].x);assert.equal(n.y,layout.residents[id].y)}
 console.log('PASS: typed route commands, retarget cancellation, input priority, paused scene / live job clock, gradual resume, reduced motion, no scene writes');
})().catch(e=>{console.error(e);process.exitCode=1});
