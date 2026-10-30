const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){const listeners={},events=[],timers=new Map();let seq=0;
 const parent={postMessage:m=>events.push(m)},ctx={Promise,Error,Object,Date,Math,CustomEvent:function(t){this.type=t},parent,requestAnimationFrame:fn=>fn(),setTimeout(fn){timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id),addEventListener(t,fn){(listeners[t]??=[]).push(fn)},dispatchEvent(){}};ctx.window=ctx;
 const send=(data,source=parent)=>(listeners.message||[]).forEach(fn=>fn({source,data}));
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/app-runtime.js'),'utf8'),ctx);
 return {ctx,events,timers,send,listeners};}
const sample={version:1,source:'device',available:{motion:true,presence:true},presence:{present:true},motion:{roll:10,pitch:0},updated_at:Date.now()};
{
 const f=fixture(),a=[],b=[];const stop=f.ctx.AtomApp.sensors.subscribe(s=>a.push(s)),stopB=f.ctx.AtomApp.sensors.subscribe(s=>b.push(s));
 assert.equal(f.events.filter(e=>e.action==='subscribe').length,1);assert.equal(a[0].source,'unavailable');
 f.send({type:'atom:sensors-state',snapshot:sample},{});assert.equal(a.length,1);
 f.send({type:'atom:sensors-state',snapshot:sample});assert.equal(a.at(-1).motion.roll,10);assert.equal(b.at(-1).presence.present,true);
 stop();stop();assert.equal(f.events.filter(e=>e.action==='unsubscribe').length,0);
 stopB();assert.equal(f.events.at(-1).action,'unsubscribe');assert.equal(f.timers.size,0);
}
{
 const f=fixture(),values=[];f.ctx.AtomApp.sensors.subscribe(s=>values.push(s));f.send({type:'atom:sensors-state',snapshot:sample});
 [...f.timers.values()].forEach(fn=>fn());assert.equal(values.at(-1).source,'unavailable');assert.equal(values.at(-1).presence,null);
 f.send({type:'atom:app-lifecycle',state:'suspend'});const before=values.length;f.send({type:'atom:sensors-state',snapshot:sample});assert.equal(values.length,before);assert.equal(f.timers.size,0);
}
async function hosts(){const listeners={},docs={},sent=[],timers=new Map();let seq=0,reads=0,authorize=0,active;
 const frame={isConnected:true,contentWindow:{postMessage:m=>sent.push(m)}};
 const ctx={Date,Promise,setTimeout(fn){timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id),addEventListener(t,fn){(listeners[t]??=[]).push(fn)},removeEventListener(){},document:{hidden:false,addEventListener(t,fn){docs[t]=fn},removeEventListener(){}}};ctx.window=ctx;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/app-host.js'),'utf8'),ctx);
 active={frame,id:'test',previewKey:'preview'};
 const host=ctx.AtomSensorHost({current:()=>active,declared:()=>true,authorize:async()=>{authorize++;return true},read:async()=>{reads++;return sample}});
 const send=async action=>{for(const fn of listeners.message)await fn({source:frame.contentWindow,data:{type:'atom:sensors',action}})};
 await send('subscribe');assert.equal(authorize,0);assert.equal(reads,0);assert.equal(sent.at(-1).snapshot.source,'unavailable');
 active={frame,id:'test',previewKey:null};await send('subscribe');await Promise.resolve();assert.equal(authorize,1);assert.equal(reads,1);
 const before=sent.length;active={frame:{isConnected:true,contentWindow:{}},id:'other'};for(const fn of [...timers.values()])await fn();assert.equal(sent.length,before);
 // Hiding and restoring while a permission prompt is pending cannot grant access.
 host.stop();active={frame,id:'test'};let resolvePermission;
 const gating=ctx.AtomSensorHost({current:()=>active,declared:()=>true,authorize:()=>new Promise(r=>resolvePermission=r),read:async()=>{reads++;return sample}});
 const handler=listeners.message.at(-1),pendingDeny=handler({source:frame.contentWindow,data:{type:'atom:sensors',action:'subscribe'}});
 ctx.document.hidden=true;docs.visibilitychange();ctx.document.hidden=false;docs.visibilitychange();
 const readCount=reads;assert.equal(reads,1);resolvePermission(false);await pendingDeny;await Promise.resolve();assert.equal(reads,readCount);
 const pendingGrant=handler({source:frame.contentWindow,data:{type:'atom:sensors',action:'subscribe'}});
 ctx.document.hidden=true;docs.visibilitychange();resolvePermission(true);await pendingGrant;assert.equal(reads,readCount);
 ctx.document.hidden=false;docs.visibilitychange();await Promise.resolve();assert.equal(reads,readCount+1);gating.destroy();
 host.destroy();
 // Pending permission cannot grant a different application's subscription.
 active={frame,id:'test'};let allow;const stale=ctx.AtomSensorHost({current:()=>active,declared:()=>true,authorize:()=>new Promise(r=>allow=r),read:async()=>{reads++;return sample}});
 const pending=listeners.message.at(-1)({source:frame.contentWindow,data:{type:'atom:sensors',action:'subscribe'}});active=null;allow(true);await pending;assert.equal(reads,2);stale.destroy();
}
hosts().then(()=>console.log('Sensors runtime: shared subscription, origin, preview denial, stale frame/authorization, disconnect and suspend passed')).catch(e=>{console.error(e);process.exitCode=1});
