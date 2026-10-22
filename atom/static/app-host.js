/* Root-owned lifecycle and one bounded storage slot per installed application. */
(function(global){'use strict';global.AtomAppHost=function(options){var active=null,timer=null,preview={};
function currentEvent(e){return active&&active.frame.isConnected&&active.frame.contentWindow===e.source;}
function state(value){if(active)options.onStatus(value,active.id);}
function end(){clearTimeout(timer);if(active&&active.frame.contentWindow)active.frame.contentWindow.postMessage({type:'atom:app-lifecycle',state:'suspend'},'*');active=null;}
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
