"""Apply reviewed lifecycle fixes to the isolated installed-source working copy."""
from pathlib import Path
import re
W=Path('/tmp/atom-product-audit/working')
IDS=['water-pool','volume-flow','moon-ocean','planetarium','parametric-maker','physics-playground','pocket-studio','rhythm-orbits','music-vision','particle-lab','robo-face','model-viewer']
RUNTIME='''/* Explicit scene scheduling; never replaces browser globals or input ownership. */
(function(global){'use strict';
var pending=new Map(),parked=[],cleanups=[],closed=false;
function frame(callback){if(closed)return 0;if(document.hidden){if(parked.indexOf(callback)<0)parked.push(callback);return 0;}var id=requestAnimationFrame(function(t){pending.delete(id);if(!closed)callback(t);});pending.set(id,callback);return id;}
function stop(){if(closed)return;closed=true;pending.forEach(function(_,id){cancelAnimationFrame(id)});pending.clear();parked=[];cleanups.splice(0).forEach(function(fn){try{fn()}catch(_){}});document.removeEventListener('visibilitychange',visibility);}
function visibility(){if(document.hidden){pending.forEach(function(cb,id){cancelAnimationFrame(id);if(parked.indexOf(cb)<0)parked.push(cb)});pending.clear();}else{var next=parked.splice(0);next.forEach(frame);}}
function onStop(fn){if(closed)fn();else cleanups.push(fn);}
document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',stop,{once:true});if(window.AtomApp)AtomApp.onSuspend(stop);
global.AtomSceneSession=Object.freeze({frame:frame,stop:stop,onStop:onStop,get active(){return !closed;}});
})(window);
'''
Path('atom/tools/product-audit/scene-session.js').write_text(RUNTIME)
for id in IDS:
 p=W/id;(p/'scene-session.js').write_text(RUNTIME)
 f=p/'index.html';s=f.read_text();s=s.replace('<head>','<head><meta charset="utf-8"><script src="scene-session.js"></script>',1);s=s.replace('<HEAD>','<HEAD><meta charset="utf-8"><script src="scene-session.js"></script>',1)
 assert 'src="scene-session.js"' in s,id
 # Move title clear of the system-owned 48px back region, leaving the scene fullscreen.
 css='<style data-product-review>.atomtitle,.head,.top{left:56px!important;right:12px!important;max-width:calc(100% - 68px)}.atomtitle strong,.head h1,.top strong{font-size:16px!important}.atomtitle{min-height:40px}</style>'
 s=s.replace('</head>',css+'</head>');f.write_text(s)
 files={'water-pool':['main.js'],'volume-flow':['flow.js'],'moon-ocean':['index.html'],'planetarium':['index.html'],'parametric-maker':['main.js'],'physics-playground':['main.js'],'pocket-studio':['main.js'],'rhythm-orbits':['main.js'],'music-vision':['main.js'],'particle-lab':['index.html'],'robo-face':['main.js'],'model-viewer':['main.js']}[id]
 for name in files:
  f=p/name;s=f.read_text()
  if id=='water-pool':
   s=re.sub(r'  var requestAnimationFrame =.*?function\(callback\) \{ setTimeout\(callback, 0\); \};','  var scheduleFrame = AtomSceneSession.frame;',s,flags=re.S);s=s.replace('requestAnimationFrame(animate)','scheduleFrame(animate)')
  else:s=s.replace('requestAnimationFrame(', 'AtomSceneSession.frame(').replace('requestAnimationFrame (','AtomSceneSession.frame (')
  s=s.replace("window.addEventListener('pagehide',",'AtomSceneSession.onStop(')
  f.write_text(s)
# Host SDK suspend must release renderer resources as well as the owned loop.
p=W/'planetarium/main.js';s=p.read_text().replace("window.addEventListener('pagehide',function(){viz.stop();viz.getRenderer().dispose()});","AtomSceneSession.onStop(function(){viz.stop();viz.renderEnabled=false;viz.initialRenderComplete=true;controls.dispose();viz.getRenderer().dispose()});")
p.write_text(s)
p=W/'music-vision/main.js';s=p.read_text().replace('var canvas=', 'var starting=false;var canvas=',1).replace('function start(){context.resume().then(function(){playing=true;',"function start(){if(starting||!AtomSceneSession.active)return;starting=true;context.resume().then(function(){starting=false;if(!AtomSceneSession.active)return;playing=true;").replace("say('音频启动失败：'+e.message);","starting=false;say('音频启动失败：'+e.message);");p.write_text(s)
p=W/'physics-playground/main.js';s=p.read_text()+"\nAtomSceneSession.onStop(function(){M.Composite.clear(world,false);M.Engine.clear(engine);M.Events.off(engine);M.Mouse.clearSourceEvents(mouse);});\n";p.write_text(s)
p=W/'robo-face/common.js';s=p.read_text().replace('let timer;', 'let timer,introTimer;AtomSceneSession.onStop(()=>{clearTimeout(timer);clearTimeout(introTimer)});').replace("setTimeout(()=>document.body.classList.remove('intro'),5500)","introTimer=setTimeout(()=>document.body.classList.remove('intro'),5500)");p.write_text(s)
# Correct UTF-8 decoding: upstream HTML had no charset before Chinese adaptation.
p=W/'water-pool/index.html';s=p.read_text().replace('<title>WebGL Water</title>','<title>光影水池</title>');p.write_text(s)
print('Reviewed lifecycle integration:',','.join(IDS))
