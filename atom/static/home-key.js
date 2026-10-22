/* Legacy Home compatibility. AtomInput owns Space when the five-way runtime is present. */
(function(){'use strict';var held=false,long=false,timer=null;
function editing(e){var t=e.target;return t.isContentEditable||t.tagName==='TEXTAREA'||(t.tagName==='INPUT'&&!/^(range|button|checkbox|radio|file|color|image|reset|submit|hidden)$/.test(t.type));}
function emit(type){if(window.parent!==window)parent.postMessage({type:type},'*');else window.dispatchEvent(new CustomEvent(type));}
function clear(){clearTimeout(timer);timer=null;held=false;long=false;}
document.addEventListener('keydown',function(e){if(e.key==='Escape'||(e.key==='Home'&&!editing(e))){e.preventDefault();emit('atom:return-home');return;}if(window.AtomInput||e.code!=='Space'||editing(e)||e.isComposing)return;e.preventDefault();e.stopImmediatePropagation();if(held||e.repeat)return;held=true;long=false;timer=setTimeout(function(){long=true;emit('atom:voice-wake');},650);},true);
document.addEventListener('keyup',function(e){if(window.AtomInput||e.code!=='Space')return;if(!held){emit('atom:voice-release');return;}e.preventDefault();e.stopImmediatePropagation();var short=!long;clear();if(short)emit('atom:return-home');else emit('atom:voice-release');},true);
window.addEventListener('blur',clear);document.addEventListener('visibilitychange',function(){if(document.hidden)clear();});
})();
