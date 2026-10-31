/* Semantic scene actions; shared ATOM runtime owns all five-way focus and key handling. */
(function(global){'use strict';
function attach(actions,label){
 var trigger=document.createElement('button');trigger.id='scene-tools';trigger.textContent=label||'场景操作';trigger.setAttribute('aria-label',label||'场景操作');
 var panel=document.createElement('section');panel.id='scene-tools-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',label||'场景操作');
 var close=document.createElement('button');close.id='scene-tools-close';close.textContent='‹ 返回场景';panel.appendChild(close);
 var grid=document.createElement('div');grid.className='scene-actions';panel.appendChild(grid);
 actions.forEach(function(a,i){var b=document.createElement('button');b.id='scene-action-'+i;b.textContent=a[0];b.onclick=a[1];grid.appendChild(b)});
 function hide(){panel.hidden=true;if(global.AtomInput)AtomInput.focus(trigger);}
 trigger.onclick=function(){panel.hidden=false;if(global.AtomInput)AtomInput.focus(close)};close.onclick=hide;
 document.body.appendChild(trigger);document.body.appendChild(panel);
 if(global.AtomApp)AtomApp.navigation.setBackHandler(function(){if(!panel.hidden)hide();else AtomApp.home()});
 return {close:hide,panel:panel};
}
function orbit(camera,controls){function turn(y,p,z){var v=camera.position.clone().sub(controls.target),r=v.length(),theta=Math.atan2(v.x,v.z)+y,phi=Math.max(.15,Math.min(Math.PI-.15,Math.acos(v.y/r)+p));r=Math.max(controls.minDistance||.1,Math.min(controls.maxDistance||1e6,r*z));camera.position.set(r*Math.sin(phi)*Math.sin(theta),r*Math.cos(phi),r*Math.sin(phi)*Math.cos(theta)).add(controls.target);controls.update();}
 return [['向左环绕',function(){turn(-.22,0,1)}],['向右环绕',function(){turn(.22,0,1)}],['俯视一点',function(){turn(0,-.16,1)}],['仰视一点',function(){turn(0,.16,1)}],['拉近',function(){turn(0,0,.8)}],['拉远',function(){turn(0,0,1.25)}]];
}
var style=document.createElement('style');style.textContent='#scene-tools{position:fixed;right:10px;top:52px;z-index:30;min-height:40px;padding:6px 10px;font-size:12px}#scene-tools-panel{position:fixed;inset:auto 8px 8px;max-height:calc(100% - 64px);z-index:1000;background:var(--atom-paper,#18232c);color:var(--atom-ink,#eee);padding:8px;border:1px solid var(--atom-line,#62717c);border-radius:12px;overflow:auto}#scene-tools-panel[hidden]{display:none}#scene-tools-close{display:block;min-height:44px;margin-bottom:6px}.scene-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.scene-actions button{min-height:44px;font-size:13px;padding:5px}';document.head.appendChild(style);
 global.AtomSceneControls=Object.freeze({attach:attach,orbit:orbit});
})(window);
