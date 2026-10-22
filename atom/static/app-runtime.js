/* ATOM app contract v1. Works in an opaque sandbox; no direct device APIs. */
(function(){'use strict';if(window.AtomApp)return;
var deferred=false,ready=false,pending={},serial=0,suspend=[],suspended=false,readFailed=false;
function emit(type,data){if(parent!==window)parent.postMessage(Object.assign({type:type},data||{}),'*');}
function markReady(){if(ready)return;ready=true;emit('atom:app-ready');}
function storage(action,value){return new Promise(function(resolve,reject){var id=String(++serial),timer=setTimeout(function(){delete pending[id];reject(Error('设备保存接口暂不可用'));},4000);pending[id]={resolve:resolve,reject:reject,timer:timer};try{emit('atom:storage',{request_id:id,action:action,data:value});}catch(e){clearTimeout(timer);delete pending[id];reject(e);}});}
function notifySuspend(){if(suspended)return;suspended=true;suspend.forEach(function(fn){try{fn();}catch(err){}});window.dispatchEvent(new CustomEvent('atom:suspend'));}
window.AtomApp=Object.freeze({version:1,navigation:Object.freeze({setBackHandler:function(fn){if(window.AtomInput)AtomInput.setBackHandler(fn);else window.addEventListener('load',function(){if(window.AtomInput)AtomInput.setBackHandler(fn);});},back:function(){if(window.AtomInput)AtomInput.back();else emit('atom:return-home');}}),deferReady:function(){deferred=true;},ready:markReady,load:function(fallback){return storage('get').then(function(r){readFailed=false;return r.data===null?fallback:r.data;},function(e){readFailed=true;throw e;});},save:function(value){if(readFailed)return Promise.reject(Error('请先重试读取，避免覆盖已有记录'));return storage('set',value).then(function(r){return {mode:r.mode};});},onSuspend:function(fn){if(typeof fn==='function')suspend.push(fn);},home:function(){emit('atom:return-home');}});
window.addEventListener('message',function(e){if(e.source!==parent||!e.data)return;var d=e.data;if(d.type==='atom:storage-result'){var p=pending[d.request_id];if(!p)return;clearTimeout(p.timer);delete pending[d.request_id];if(d.ok)p.resolve(d);else p.reject(Error(d.error||'保存失败'));}else if(d.type==='atom:app-lifecycle'&&d.state==='suspend'){notifySuspend();}});
window.addEventListener('load',function(){requestAnimationFrame(function(){requestAnimationFrame(function(){if(!deferred)markReady();});});});
window.addEventListener('error',function(e){if(e.message)emit('atom:app-error');else if(e.target&&/SCRIPT|LINK/.test(e.target.tagName))emit('atom:app-error');},true);
window.addEventListener('unhandledrejection',function(){emit('atom:app-error');});
window.addEventListener('pagehide',function(){notifySuspend();Object.keys(pending).forEach(function(id){clearTimeout(pending[id].timer);delete pending[id];});});
})();
