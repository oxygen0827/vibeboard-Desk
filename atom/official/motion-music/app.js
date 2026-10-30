(()=>{'use strict';
const $=id=>document.getElementById(id),sdk=window.AtomApp,P=window.MotionPhysics,canvas=$('scene'),ctx=canvas.getContext('2d');
const palettes={music:['#061d29','#123d43','#a4efc5','#e8c57a'],ocean:['#071e3b','#0d4f69','#67cfde','#e2deb0'],light:['#120c30','#302251','#c4a7ff','#f7a899']};
const copy={music:['01 / PENTATONIC','让碰撞，成为旋律。','拖动小球，松手听见回响'],ocean:['02 / TIDAL STUDY','把一片海，放在手心。','拨动漂浮物，让海面轻轻呼吸'],light:['03 / LIGHT VESSEL','每一束光，都有回声。','拖曳星点，留下短暂的光迹']};
let width=480,height=216,balls=[],scene='music',alive=true,loaded=false,saving=false,raf=0,last=0,time=0,paintAt=0,drag=null;
let gx=0,gy=150,target={x:0,y:150},ripples=[],pattern={duration:0,notes:[]},recording=false,recordAt=0,playing=false,playAt=0,playIndex=0;
let audio=null,sound=false,voices=new Set(),unsub=null,sensorState=null,useDevice=false;
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');let systemMotion=true,reduced=motionPreference.matches;
const notes=[261.63,293.66,329.63,392,440],colors=['#eacb87','#98e0d5','#dcb4dc','#a1c4f2','#d5df9e'];
sdk?.deferReady();
function status(text){$('status').textContent=text;}
function controls(){
  $('record').disabled=!loaded||saving;
  document.querySelectorAll('[data-scene]').forEach(b=>b.disabled=saving);
  $('record').textContent=recording?'■ 完成':'● 录一段';$('record').classList.toggle('recording',recording);
  $('play').disabled=!pattern.notes.length||recording;$('play').textContent=playing?'■ 停止':'▶ 回放';$('play').classList.toggle('playing',playing);
  $('save').disabled=!loaded||saving||recording||!pattern.notes.length;
}
function resize(){const box=$('stage').getBoundingClientRect(),oldW=width,oldH=height;width=box.width;height=box.height;const ratio=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);if(!balls.length)balls=P.create(width,height);else for(const b of balls){b.x*=width/oldW;b.y*=height/oldH;}}
function silence(){for(const voice of voices){try{voice.osc.stop()}catch{}voice.osc.disconnect();voice.gain.disconnect();}voices.clear();}
async function enableSound(){
  if(!alive)return false;
  try{if(!audio)audio=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});await audio.resume();if(!alive)return false;sound=true;$('sound').textContent='声音已开';$('sound').setAttribute('aria-pressed','true');return true;}
  catch{status('声音不可用，可继续把玩');return false;}
}
function tone(note,level){
  if(!sound||!audio||audio.state!=='running'||voices.size>=8)return;
  const osc=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime,voice={osc,gain};voices.add(voice);
  osc.type='sine';osc.frequency.value=notes[note];gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.08*level,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+.85);
  osc.connect(gain);gain.connect(audio.destination);osc.onended=()=>{voices.delete(voice);osc.disconnect();gain.disconnect()};osc.start(now);osc.stop(now+.9);
}
function emit(note,level,x,y,capture=true){
  tone(note,level);ripples.push({x,y,at:time,note});if(ripples.length>20)ripples.shift();
  if(recording&&capture&&pattern.notes.length<240){pattern.notes.push({t:Math.round((time-recordAt)*1000)/1000,note,gain:Math.round(level*100)/100});}
}
function collision(b,speed){if(!playing)emit(b.id,P.clamp(speed/350,.15,1),b.x,b.y);}
function finishRecording(){if(!recording)return;recording=false;pattern.duration=Math.max(.1,Math.min(20,time-recordAt));status(pattern.notes.length?`${pattern.notes.length} 个音符 · 可回放或保存`:'没有音符，试试拨动小球');controls();}
function stopPlayback(){playing=false;silence();controls();}
function frame(now){
  if(!alive||document.hidden)return;
  const dt=last?Math.min((now-last)/1000,1/30):0;last=now;time+=dt;
  if(useDevice&&(!sensorState?.motion||Date.now()-sensorState.updated_at>2500)){useDevice=false;target={x:0,y:150};sensorLabel();}
  gx+=(target.x-gx)*Math.min(1,dt*5);gy+=(target.y-gy)*Math.min(1,dt*5);
  P.advance(balls,dt,width,height,{x:gx,y:gy},time,collision);
  if(recording&&time-recordAt>=20)finishRecording();
  if(playing){
    while(playIndex<pattern.notes.length&&pattern.notes[playIndex].t<=time-playAt){const n=pattern.notes[playIndex++],b=balls[n.note];emit(n.note,n.gain,b.x,b.y,false);b.vy-=35;}
    if(time-playAt>pattern.duration+.9){playing=false;controls();status('回放完成');}
  }
  if(now-paintAt>=(reduced?100:32)){draw();paintAt=now;}
  if(recording)$('meter').textContent=`录音 ${Math.floor(time-recordAt)} / 20 秒`;else if(playing)$('meter').textContent='正在回放';else $('meter').textContent=scene==='ocean'?'潮汐 / 五声音阶':scene==='light'?'光迹 / 五声音阶':'五声音阶';
  raf=requestAnimationFrame(frame);
}
function background(){
  const p=palettes[scene],g=ctx.createLinearGradient(0,0,width,height);g.addColorStop(0,p[0]);g.addColorStop(1,p[1]);ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
  ctx.strokeStyle='rgba(202,235,229,.055)';ctx.lineWidth=1;
  for(let x=14;x<width;x+=24){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
  for(let y=16;y<height;y+=24){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
  ctx.strokeStyle='rgba(202,235,229,.24)';ctx.beginPath();ctx.moveTo(14,110);ctx.lineTo(14,height-26);ctx.lineTo(width-14,height-26);ctx.lineTo(width-14,16);ctx.stroke();
  const glow=ctx.createRadialGradient(width*.75,height*.5,0,width*.75,height*.5,width*.55);glow.addColorStop(0,scene==='light'?'rgba(166,96,235,.2)':'rgba(77,201,184,.12)');glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
}
function ocean(){
  for(let layer=2;layer>=0;layer--){ctx.beginPath();ctx.moveTo(0,height);for(let x=0;x<=width;x+=6){const wave=reduced?0:Math.sin(x*.019+time*.8+layer)*4+Math.sin(x*.038-time*.6)*2;const y=height*.65+layer*12+(x-width/2)*P.clamp(-gx/1100,-.15,.15)+wave;ctx.lineTo(x,y);}ctx.lineTo(width,height);ctx.fillStyle=['rgba(61,175,194,.18)','rgba(44,129,164,.19)','rgba(76,169,184,.16)'][layer];ctx.fill();ctx.strokeStyle='rgba(145,232,238,.18)';ctx.stroke();}
  for(let i=0;i<3;i++){const t=reduced?0:time,x=width*(.55+i*.13)+Math.sin(t*.4+i)*12,y=height*.78+Math.cos(t*.8+i)*5;ctx.fillStyle='rgba(182,231,225,.5)';ctx.beginPath();ctx.ellipse(x,y,9,3,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(x+8,y);ctx.lineTo(x+13,y-4);ctx.lineTo(x+13,y+4);ctx.fill();}
}
function draw(){
  background();if(scene==='ocean')ocean();
  if(scene==='music'){ctx.font='9px sans-serif';ctx.textAlign='center';for(let i=0;i<5;i++){const x=width*(.2+i*.15);ctx.fillStyle=colors[i];ctx.globalAlpha=.45;ctx.fillText(['C','D','E','G','A'][i],x,height-34);ctx.fillRect(x-11,height-27,22,2);}ctx.globalAlpha=1;}
  ripples=ripples.filter(r=>time-r.at<1.1);
  for(const r of ripples){const age=time-r.at;ctx.globalAlpha=(1-age/1.1)*.4;ctx.strokeStyle=colors[r.note];ctx.lineWidth=1;ctx.beginPath();ctx.arc(r.x,r.y,14+(reduced?0:age*35),0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;
  for(const b of balls){
    const radius=scene==='light'?b.r*.7:b.r,g=ctx.createRadialGradient(b.x-3,b.y-4,1,b.x,b.y,radius);g.addColorStop(0,'#fff8df');g.addColorStop(.25,colors[b.id]);g.addColorStop(1,scene==='light'?'rgba(159,113,222,.3)':'#548e97');
    if(scene==='light'){const halo=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,40);halo.addColorStop(0,colors[b.id]+'55');halo.addColorStop(1,'transparent');ctx.fillStyle=halo;ctx.fillRect(b.x-40,b.y-40,80,80);}
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(240,255,247,.5)';ctx.stroke();
    if(b.held){ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(b.x,b.y,radius+5,0,Math.PI*2);ctx.stroke();}
  }
}
function selectScene(next){scene=next;const c=copy[next];$('chapter').textContent=c[0];$('scene-title').textContent=c[1];$('hint').textContent=c[2];document.querySelectorAll('[data-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scene===scene)));draw();}
function sensorLabel(){$('sensor').textContent=useDevice?'真实倾斜 · 点此改为手动':sensorState?.available?.motion?'手动把玩 · 点此启用真实倾斜':'手动把玩 · 未连接惯性传感器';}
function sensorUpdate(next){sensorState=next;if(useDevice&&next.available?.motion&&next.motion&&Number.isFinite(next.motion.roll)&&Number.isFinite(next.motion.pitch)){target={x:P.clamp(next.motion.roll,-45,45)*9,y:150+P.clamp(next.motion.pitch,-45,45)*9};}sensorLabel();}
function tilt(direction){useDevice=false;target=({left:{x:-300,y:100},right:{x:300,y:100},up:{x:0,y:-300},down:{x:0,y:350},center:{x:0,y:150}})[direction];document.querySelectorAll('[data-tilt]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tilt===direction)));sensorLabel();}
function pluck(){balls.forEach((b,i)=>{b.vy=-140-i*15;b.vx=(i-2)*45;});const b=balls[Math.floor(time*3)%5];emit(b.id,.7,b.x,b.y);status('让小球继续演奏');}
function point(e){const r=canvas.getBoundingClientRect();return{x:P.clamp(e.clientX-r.left,26,width-26),y:P.clamp(e.clientY-r.top,30,height-40)};}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;const p=point(e);const b=balls.reduce((a,b)=>Math.hypot(b.x-p.x,b.y-p.y)<Math.hypot(a.x-p.x,a.y-p.y)?b:a);drag={ball:b,p,at:performance.now(),vx:0,vy:0};b.held=true;b.x=p.x;b.y=p.y;canvas.setPointerCapture(e.pointerId);emit(b.id,.45,b.x,b.y);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e),now=performance.now(),dt=Math.max(.016,(now-drag.at)/1000);drag.vx=P.clamp((p.x-drag.p.x)/dt,-550,550);drag.vy=P.clamp((p.y-drag.p.y)/dt,-550,550);drag.ball.x=p.x;drag.ball.y=p.y;drag.p=p;drag.at=now;});
function release(){if(!drag)return;drag.ball.held=false;drag.ball.vx=drag.vx;drag.ball.vy=drag.vy;drag=null;}
canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=()=>selectScene(b.dataset.scene));document.querySelectorAll('[data-tilt]').forEach(b=>b.onclick=()=>tilt(b.dataset.tilt));
$('sound').onclick=()=>{if(sound){sound=false;silence();$('sound').textContent='开启声音';$('sound').setAttribute('aria-pressed','false');}else enableSound();};
$('back').onclick=()=>sdk?.navigation?.back();$('pluck').onclick=pluck;
$('reset').onclick=()=>{release();balls=P.create(width,height);ripples=[];tilt('center');status('场景已重置，作品仍保留');};
$('record').onclick=()=>{if(recording){finishRecording();return;}stopPlayback();pattern={duration:0,notes:[]};recording=true;recordAt=time;status('最长 20 秒 · 拨动或拖动小球');controls();};
$('play').onclick=async()=>{if(playing){stopPlayback();status('回放已停止');return;}if(!sound&&!await enableSound())return;if(!alive||recording||!pattern.notes.length)return;playing=true;playAt=time;playIndex=0;controls();};
$('save').onclick=async()=>{if(!loaded||saving||recording||!P.validPattern(pattern))return;saving=true;controls();const snapshot=JSON.parse(JSON.stringify({version:1,scene,pattern}));try{if(!sdk?.save)throw Error('preview');const result=await sdk.save(snapshot);if(alive)status(result?.mode==='preview'?'已临时保存，预览结束后清除':'作品已保存');}catch{if(alive)status('保存失败，作品仍在，可重试');}finally{saving=false;if(alive)controls();}};
async function load(){
  $('retry').hidden=true;status('正在读取作品…');
  try{const saved=sdk?.load?await sdk.load(null):null;if(!alive)return;if(saved){if(saved.version!==1||!P.validPattern(saved.pattern)||!copy[saved.scene])throw Error('invalid saved composition');pattern=saved.pattern;selectScene(saved.scene);}loaded=true;status(saved?'已恢复上次作品':'先拨动小球，再开启声音');}
  catch{if(!alive)return;loaded=false;$('retry').hidden=false;status('读取失败，暂停保存以保护作品');}
  controls();sdk?.ready();
}
$('retry').onclick=load;
function visibility(){if(document.hidden){cancelAnimationFrame(raf);last=0;release();finishRecording();stopPlayback();audio?.suspend();}else if(alive){if(sound){sound=false;$('sound').textContent='开启声音';$('sound').setAttribute('aria-pressed','false');}last=0;raf=requestAnimationFrame(frame);}}
document.addEventListener('visibilitychange',visibility);
function stop(){if(!alive)return;alive=false;cancelAnimationFrame(raf);release();silence();audio?.close();audio=null;if(typeof unsub==='function')unsub();observer.disconnect();window.removeEventListener('resize',resize);window.removeEventListener('message',inputSettings);document.removeEventListener('visibilitychange',visibility);motionPreference.removeEventListener?.('change',motionChange);}
function motionChange(){reduced=motionPreference.matches||!systemMotion;}
function inputSettings(e){if(e.source!==parent||e.data?.type!=='atom:input-settings')return;systemMotion=e.data.motion!==false;motionChange();}
addEventListener('message',inputSettings);
motionPreference.addEventListener?.('change',motionChange);sdk?.onSuspend(stop);addEventListener('pagehide',stop,{once:true});
const observer=new ResizeObserver(resize);observer.observe($('stage'));addEventListener('resize',resize);
const old=$('sensor'),sensor=document.createElement('button');sensor.id='sensor';sensor.className='sensor-button';old.replaceWith(sensor);sensor.onclick=()=>{useDevice=!useDevice&&!!sensorState?.available?.motion;if(useDevice)sensorUpdate(sensorState);else target={x:0,y:150};sensorLabel();};sensorLabel();
if(sdk?.sensors?.subscribe)unsub=sdk.sensors.subscribe(sensorUpdate);
resize();draw();controls();raf=requestAnimationFrame(frame);load();
})();
