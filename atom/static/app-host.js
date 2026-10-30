/* Root-owned lifecycle and one bounded storage slot per installed application. */
(function(global){'use strict';global.AtomAppHost=function(options){var active=null,timer=null,preview={};
function currentEvent(e){return active&&active.frame.isConnected&&active.frame.contentWindow===e.source;}
function state(value){if(active)options.onStatus(value,active.id);}
function end(){if(options.onEnd)options.onEnd();clearTimeout(timer);if(active&&active.frame.contentWindow)active.frame.contentWindow.postMessage({type:'atom:app-lifecycle',state:'suspend'},'*');active=null;}
function begin(frame,id,previewKey){end();active={frame:frame,id:id,previewKey:previewKey||null,ready:false,failed:false};state('loading');timer=setTimeout(function(){state('delayed');},8000);}
function receive(e){if(!currentEvent(e)||!e.data)return;var d=e.data;
if(d.type==='atom:app-ready'){if(active.ready||active.failed)return;active.ready=true;clearTimeout(timer);state('ready');return;}
if(d.type==='atom:app-error'){active.failed=true;clearTimeout(timer);state('failed');return;}
if(d.type!=='atom:storage'||typeof d.request_id!=='string'||!/^\d{1,12}$/.test(d.request_id)||['get','set'].indexOf(d.action)<0)return;
var owner=active,key='atom.app.v1.'+active.id,mode=active.previewKey?'preview':'device',result={type:'atom:storage-result',request_id:d.request_id,ok:true,data:null,mode:mode};
try{if(!/^[a-z][a-z0-9_-]{0,47}$/.test(active.id))throw Error('invalid app');if(d.action==='get'){result.data=active.previewKey?(preview[active.previewKey]===undefined?null:preview[active.previewKey]):options.read(key,null);}else{var text=JSON.stringify(d.data);if(typeof text!=='string'||text.length>65536||new TextEncoder().encode(text).length>65536)throw Error('size');var clean=JSON.parse(text);if(active.previewKey)preview[active.previewKey]=clean;else{var saved=options.write(key,clean);if(saved&&typeof saved.then==='function'){saved.then(function(ok){if(!ok)throw Error('storage');reply();}).catch(fail);return;}if(!saved)throw Error('storage');}}}
catch(err){fail(err);return;}
if(result.data&&typeof result.data.then==='function'){result.data.then(function(value){result.data=value;reply();}).catch(fail);return;}reply();
function fail(err){result.data=null;result.ok=false;result.error=d.action==='get'?'记录读取失败，请重试':err.message==='size'?'保存失败：JSON 数据不能超过 64 KiB':'保存失败：本机存储不可用或数据格式无效';reply();}
function reply(){if(active===owner&&currentEvent(e))e.source.postMessage(result,'*');}}
global.addEventListener('message',receive);return {begin:begin,end:end,current:function(){return active;},destroy:function(){end();global.removeEventListener('message',receive);}};};})(window);

/* One foreground subscription, bounded polling and no data delivery to old/preview frames. */
(function(global){'use strict';global.AtomSensorHost=function(options){
var owner=null,timer=null,epoch=0;
function empty(){return {version:1,source:'unavailable',available:{presence:false,motion:false},presence:null,motion:null,updated_at:Date.now()};}
function current(o){return o&&options.current()===o&&o.frame.isConnected;}
function reply(o,data){if(current(o))o.frame.contentWindow.postMessage({type:'atom:sensors-state',snapshot:data},'*');}
function stop(){epoch++;clearTimeout(timer);timer=null;owner=null;}
async function poll(subscription,version){
 if(subscription!==owner||version!==epoch)return;
 var o=subscription.app;if(!current(o)){stop();return;}
 if(!subscription.allowed||document.hidden)return;
 var state;try{state=await options.read();}catch(e){state=empty();}
 if(subscription!==owner||version!==epoch||!current(o))return;
 reply(o,state);timer=setTimeout(function(){poll(subscription,version);},state.available&&state.available.motion?80:500);
}
async function receive(e){
 var d=e.data,o=options.current();if(!d||d.type!=='atom:sensors'||!current(o)||o.frame.contentWindow!==e.source)return;
 if(d.action==='unsubscribe'){if(owner&&owner.app===o)stop();return;}
 if(d.action!=='subscribe'||owner&&owner.app===o)return;
 stop();var subscription={app:o,allowed:false};owner=subscription;
 if(o.previewKey||!options.declared(o.id)){reply(o,empty());stop();return;}
 var allowed=false;try{allowed=await options.authorize(o);}catch(e){}
 if(owner!==subscription)return;
 if(!current(o)){stop();return;}
 if(!allowed){reply(o,empty());stop();return;}
 subscription.allowed=true;poll(subscription,epoch);
}
function visibility(){epoch++;clearTimeout(timer);if(owner&&owner.allowed){if(document.hidden)reply(owner.app,empty());else poll(owner,epoch);}}
global.addEventListener('message',receive);document.addEventListener('visibilitychange',visibility);
return {stop:stop,destroy:function(){stop();global.removeEventListener('message',receive);document.removeEventListener('visibilitychange',visibility);}};
};})(window);
