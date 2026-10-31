/* Explicit scene scheduling; never replaces browser globals or input ownership. */
(function(global){'use strict';
var pending=new Map(),parked=[],cleanups=[],closed=false;
function frame(callback){if(closed)return 0;if(document.hidden){if(parked.indexOf(callback)<0)parked.push(callback);return 0;}var id=requestAnimationFrame(function(t){pending.delete(id);if(!closed)callback(t);});pending.set(id,callback);return id;}
function stop(){if(closed)return;closed=true;pending.forEach(function(_,id){cancelAnimationFrame(id)});pending.clear();parked=[];cleanups.splice(0).forEach(function(fn){try{fn()}catch(_){}});document.removeEventListener('visibilitychange',visibility);}
function visibility(){if(document.hidden){pending.forEach(function(cb,id){cancelAnimationFrame(id);if(parked.indexOf(cb)<0)parked.push(cb)});pending.clear();}else{var next=parked.splice(0);next.forEach(frame);}}
function onStop(fn){if(closed)fn();else cleanups.push(fn);}
document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',stop,{once:true});if(window.AtomApp)AtomApp.onSuspend(stop);
global.AtomSceneSession=Object.freeze({frame:frame,stop:stop,onStop:onStop,get active(){return !closed;}});
})(window);
