/* ATOM app contract v1. Works in an opaque sandbox; no direct device APIs. */
(function(){'use strict';if(window.AtomApp)return;
var deferred=false,ready=false,pending={},serial=0,suspend=[],suspended=false,readFailed=false;
function emit(type,data){if(parent!==window)parent.postMessage(Object.assign({type:type},data||{}),'*');}
function markReady(){if(ready)return;ready=true;emit('atom:app-ready');}
function storage(action,value){return new Promise(function(resolve,reject){var id=String(++serial),timer=setTimeout(function(){delete pending[id];reject(Error('设备保存接口暂不可用'));},4000);pending[id]={resolve:resolve,reject:reject,timer:timer};try{emit('atom:storage',{request_id:id,action:action,data:value});}catch(e){clearTimeout(timer);delete pending[id];reject(e);}});}
function notifySuspend(){if(suspended)return;suspended=true;stopSensors();suspend.forEach(function(fn){try{fn();}catch(err){}});window.dispatchEvent(new CustomEvent('atom:suspend'));}

var sensorListeners=[],sensorTimer=null;
function unavailableSensors(){return {version:1,source:'unavailable',available:{presence:false,motion:false},presence:null,motion:null,updated_at:Date.now()};}
function sendSensors(value){sensorListeners.slice().forEach(function(fn){try{fn(value);}catch(e){}});}
function stopSensors(){clearTimeout(sensorTimer);sensorTimer=null;if(sensorListeners.length)emit('atom:sensors',{action:'unsubscribe'});sensorListeners=[];}
function sensorWatchdog(){clearTimeout(sensorTimer);sensorTimer=setTimeout(function(){if(!suspended&&sensorListeners.length)sendSensors(unavailableSensors());},3000);}
var sensors=Object.freeze({subscribe:function(fn){if(typeof fn!=='function')throw Error('传感器订阅需要回调');if(suspended)return function(){};if(sensorListeners.length>=16)throw Error('传感器订阅过多');sensorListeners.push(fn);try{fn(unavailableSensors());}catch(e){}if(sensorListeners.length===1){emit('atom:sensors',{action:'subscribe'});sensorWatchdog();}var done=false;return function(){if(done)return;done=true;var i=sensorListeners.indexOf(fn);if(i>=0)sensorListeners.splice(i,1);if(!sensorListeners.length){clearTimeout(sensorTimer);emit('atom:sensors',{action:'unsubscribe'});}};}});
window.addEventListener('message',function(e){if(e.source!==parent||suspended||!sensorListeners.length)return;var d=e.data,v=d&&d.snapshot;if(!d||d.type!=='atom:sensors-state'||!v||v.version!==1||!v.available||['device','unavailable'].indexOf(v.source)<0)return;sendSensors(v);sensorWatchdog();});

window.AtomApp=Object.freeze({version:1,sensors:sensors,navigation:Object.freeze({setBackHandler:function(fn){if(window.AtomInput)AtomInput.setBackHandler(fn);else window.addEventListener('load',function(){if(window.AtomInput)AtomInput.setBackHandler(fn);});},back:function(){if(window.AtomInput)AtomInput.back();else emit('atom:return-home');}}),deferReady:function(){deferred=true;},ready:markReady,load:function(fallback){return storage('get').then(function(r){readFailed=false;return r.data===null?fallback:r.data;},function(e){readFailed=true;throw e;});},save:function(value){if(readFailed)return Promise.reject(Error('请先重试读取，避免覆盖已有记录'));return storage('set',value).then(function(r){return {mode:r.mode};});},onSuspend:function(fn){if(typeof fn==='function')suspend.push(fn);},home:function(){emit('atom:return-home');}});
window.addEventListener('message',function(e){if(e.source!==parent||!e.data)return;var d=e.data;if(d.type==='atom:storage-result'){var p=pending[d.request_id];if(!p)return;clearTimeout(p.timer);delete pending[d.request_id];if(d.ok)p.resolve(d);else p.reject(Error(d.error||'保存失败'));}else if(d.type==='atom:app-lifecycle'&&d.state==='suspend'){notifySuspend();}});
window.addEventListener('load',function(){requestAnimationFrame(function(){requestAnimationFrame(function(){if(!deferred)markReady();});});});
window.addEventListener('error',function(e){if(e.message)emit('atom:app-error');else if(e.target&&/SCRIPT|LINK/.test(e.target.tagName))emit('atom:app-error');},true);
window.addEventListener('unhandledrejection',function(){emit('atom:app-error');});
window.addEventListener('pagehide',function(){notifySuspend();Object.keys(pending).forEach(function(id){clearTimeout(pending[id].timer);delete pending[id];});});
})();
