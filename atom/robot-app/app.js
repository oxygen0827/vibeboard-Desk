/* ATOM robot companion: original procedural eyes + voice conversation through the device's reviewed robot bridge. */
(function(){'use strict';
const $=id=>document.getElementById(id),canvas=$('face'),g=canvas.getContext('2d'),W=480,H=360;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const runtime=window.AtomApp||{deferReady(){},ready(){},load:async d=>d,save:async()=>({mode:'preview'}),onSuspend(){}};
runtime.deferReady();

// ---------------------------------------------------------------- bridge
const waiting=new Map();let serial=0,alive=true;
function call(action,data){return new Promise((resolve,reject)=>{if(!alive)return reject(Error('应用已退出'));const id='robot-'+(++serial),timer=setTimeout(()=>{waiting.delete(id);reject(Error('连接超时'));},15000);waiting.set(id,{resolve,reject,timer});parent.postMessage({type:'atom:robot',id,action,data:data||{}},'*');});}
addEventListener('message',e=>{if(e.source!==parent||!alive)return;const m=e.data||{};
  if(m.type==='atom:robot-result'){const p=waiting.get(m.id);if(!p)return;waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result||{});}
  if(m.type==='atom:robot-voice')onVoice(m);});

// ---------------------------------------------------------------- expressions
// Each expression is a target for the springs: eye size, roundness, lids (top tilt for brows, bottom arch for smiles), colour.
const PALETTE={calm:'#4fd6ff',happy:'#5cf2c2',sad:'#7f9cff',angry:'#ff6a5c',surprised:'#7fe3ff',shy:'#ff8fc4',love:'#ff6fa8',thinking:'#b59bff',confused:'#ffd36b',sleepy:'#3a8fb5',listening:'#5ce1ff'};
const EXPR={
  calm:{w:84,h:104,r:30,top:0,tilt:0,bottom:0,arch:0},
  happy:{w:92,h:96,r:34,top:0,tilt:0,bottom:.46,arch:1},
  sad:{w:80,h:92,r:28,top:.28,tilt:.55,bottom:0,arch:0,gy:12},
  angry:{w:86,h:94,r:22,top:.3,tilt:-.7,bottom:.08,arch:0},
  surprised:{w:98,h:124,r:46,top:0,tilt:0,bottom:0,arch:0},
  shy:{w:74,h:84,r:30,top:.12,tilt:0,bottom:.3,arch:1,gx:-26,gy:16},
  love:{w:96,h:96,r:30,top:0,tilt:0,bottom:0,arch:0},
  thinking:{w:80,h:96,r:28,top:.18,tilt:-.15,bottom:0,arch:0,gx:34,gy:-26},
  confused:{w:84,h:104,r:30,top:.1,tilt:-.3,bottom:0,arch:0,asym:1},
  sleepy:{w:88,h:100,r:30,top:.58,tilt:.1,bottom:.06,arch:0,gy:10},
  listening:{w:90,h:112,r:34,top:0,tilt:0,bottom:0,arch:0},
  asleep:{w:90,h:100,r:30,top:1,tilt:0,bottom:0,arch:0,gy:14}};
const KEYS=['w','h','r','top','tilt','bottom','arch','gx','gy','asym'];

function spring(v){return {v,t:v,s:0};}
const eyes=[0,1].map(()=>Object.fromEntries(KEYS.map(k=>[k,spring(EXPR.calm[k]||0)])));
const look={x:spring(0),y:spring(0)},bob=spring(0),pulse=spring(0),blink=spring(0);
let colour=PALETTE.calm,targetColour=colour,expression='calm';
function setExpression(name){if(!EXPR[name])name='calm';expression=name;const e=EXPR[name];
  eyes.forEach((eye,i)=>KEYS.forEach(k=>{let v=e[k]||0;if(name==='confused'&&k==='h')v=i?e.h*1.12:e.h*.7;if(name==='confused'&&k==='top')v=i?0:.32;eye[k].t=v;}));
  targetColour=PALETTE[name]||PALETTE.calm;}
// Semi-implicit Euler in 1/240 s sub-steps stays stable even for the stiff blink spring at 30 fps.
function step(s,dt,k=140,damp=.82){const c=2*Math.sqrt(k)*damp,n=Math.max(1,Math.ceil(dt*240)),h=dt/n;for(let i=0;i<n;i++){s.s+=(k*(s.t-s.v)-c*s.s)*h;s.v+=s.s*h;}if(!isFinite(s.v)){s.v=s.t;s.s=0;}}
function mix(a,b,t){const p=x=>[1,3,5].map(i=>parseInt(x.slice(i,i+2),16)),A=p(a),B=p(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('');}

// ---------------------------------------------------------------- drawing
function roundRect(x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function heart(cx,cy,s){g.beginPath();g.moveTo(cx,cy+s*.42);g.bezierCurveTo(cx-s*.95,cy-s*.15,cx-s*.55,cy-s*.85,cx,cy-s*.38);g.bezierCurveTo(cx+s*.55,cy-s*.85,cx+s*.95,cy-s*.15,cx,cy+s*.42);g.closePath();}
function drawEye(eye,cx,cy,side,scale){
  const w=eye.w.v*scale,h=Math.max(2,eye.h.v*scale),x=cx-w/2,y=cy-h/2;
  const lid=Math.max(0,Math.min(1,eye.top.v+blink.v)),tilt=eye.tilt.v*side,bottom=Math.max(0,Math.min(1-lid,eye.bottom.v)),lidOn=lid>.01||Math.abs(tilt)>.01,bottomOn=bottom>.01;
  g.save();
  // Clip to the open part of the eye: a tilted upper lid and a straight or smiling lower lid.
  g.beginPath();const pad=40,tl=lidOn?y+h*Math.max(0,lid-tilt*.5):y-pad,tr=lidOn?y+h*Math.max(0,lid+tilt*.5):y-pad;
  g.moveTo(x-pad,tl);g.lineTo(x+w+pad,tr);
  for(let i=0;i<=16;i++){const t=i/16,px=x+w+pad-(w+2*pad)*t,u=(px-cx)/(w/2),arch=Math.max(0,1-u*u);g.lineTo(px,bottomOn?y+h-bottom*h-eye.arch.v*bottom*h*.55*arch:y+h+pad);}
  g.closePath();g.clip();
  g.shadowColor=colour;g.shadowBlur=reduced?8:22;g.fillStyle=colour;
  if(expression==='love'){heart(cx,cy+4,Math.min(w,h)*1.05);}else roundRect(x,y,w,h,eye.r.v*scale);
  g.fill();
  // A soft highlight keeps the eyes alive.
  g.shadowBlur=0;g.globalAlpha=.22;g.fillStyle='#ffffff';roundRect(x+w*.18,y+h*.14,w*.22,h*.18,6);g.fill();g.globalAlpha=1;
  g.restore();
  if(lid>=.97){g.strokeStyle=colour;g.lineWidth=5;g.lineCap='round';g.shadowColor=colour;g.shadowBlur=10;g.beginPath();g.moveTo(x+6,cy+h*.18);g.quadraticCurveTo(cx,cy+h*.18+10,x+w-6,cy+h*.18);g.stroke();g.shadowBlur=0;}
}
let mic=0,speakLevel=0,zzz=[],dots=0,now=0;
function render(dt){
  g.fillStyle='#05070b';g.fillRect(0,0,W,H);
  const breathe=reduced?0:Math.sin(now/1300)*2.2,speak=speakLevel*(reduced?.3:1);
  const scale=1+pulse.v+speak*.08,cy=158+bob.v+breathe-speak*6;
  for(const [i,side] of [[0,-1],[1,1]]){const eye=eyes[i],gx=look.x.v+eye.gx.v,gy=look.y.v+eye.gy.v;drawEye(eye,240+side*76+gx,cy+gy,side,scale);}
  if(expression==='shy'){g.fillStyle='rgba(255,120,170,.35)';for(const s of [-1,1]){g.beginPath();g.ellipse(240+s*92+look.x.v-20,cy+58,24,9,0,0,Math.PI*2);g.fill();}}
  if(expression==='thinking'||state==='thinking'||state==='transcribing'){dots+=dt;for(let i=0;i<3;i++){const a=.35+.65*Math.max(0,Math.sin(dots*5-i*.9));g.globalAlpha=a;g.fillStyle=colour;g.beginPath();g.arc(338+i*16,72-i*8,4+i,0,Math.PI*2);g.fill();}g.globalAlpha=1;}
  if(state==='listening'){g.strokeStyle=colour;g.lineCap='round';g.lineWidth=5;for(let i=0;i<7;i++){const k=Math.abs(i-3),a=(mic*(1-k*.18)+.06)*44*(.75+.25*Math.sin(now/90+i));g.globalAlpha=.55+.45*mic;g.beginPath();g.moveTo(240+(i-3)*18,272-a/2);g.lineTo(240+(i-3)*18,272+a/2);g.stroke();}g.globalAlpha=1;}
  if(state==='asleep'&&!reduced){if(Math.random()<dt*.7)zzz.push({x:300,y:110,t:0});zzz=zzz.filter(z=>(z.t+=dt)<3);g.fillStyle=colour;for(const z of zzz){g.globalAlpha=Math.max(0,1-z.t/3);g.font=(14+z.t*8)+'px sans-serif';g.fillText('Z',z.x+z.t*22,z.y-z.t*26);}g.globalAlpha=1;}
}

// ---------------------------------------------------------------- life: blinks, glances, sleep
let state='idle',lastActive=performance.now(),nextBlink=0,nextGlance=0,keyLook=0,speechTimer=0;
function wake(){lastActive=performance.now();if(state==='asleep'){state='idle';setExpression('surprised');setTimeout(()=>{if(state==='idle')setExpression('calm');},700);hint();}}
function life(t){
  if(t>nextBlink&&!['asleep'].includes(state)){blink.t=1;setTimeout(()=>{blink.t=0;},reduced?60:110);nextBlink=t+2200+Math.random()*4200;if(Math.random()<.18)setTimeout(()=>{blink.t=1;setTimeout(()=>{blink.t=0;},100);},260);}
  if(t>nextGlance&&t>keyLook&&['idle','speaking'].includes(state)&&!reduced){const r=state==='speaking'?10:26;look.x.t=(Math.random()*2-1)*r;look.y.t=(Math.random()*2-1)*r*.5;nextGlance=t+1400+Math.random()*2600;}
  if(state==='idle'&&t-lastActive>90000){state='asleep';setExpression('asleep');look.x.t=0;look.y.t=0;hint();}
}

// ---------------------------------------------------------------- frame loop (30 fps keeps the RK3566 cool)
let raf=0,last=0;
function frame(t){if(!alive)return;raf=requestAnimationFrame(frame);if(document.hidden||t-last<(state==='asleep'?100:32))return;const dt=Math.min(.05,(t-last)/1000||.033);last=t;now=t;
  life(t);
  for(const eye of eyes)for(const k of KEYS)step(eye[k],dt);
  step(look.x,dt,90);step(look.y,dt,90);step(blink,dt,900,.9);step(pulse,dt,120,.6);step(bob,dt,160,.5);
  if(state==='listening'){pulse.t=mic*.12;}else pulse.t=0;
  speakLevel+=((state==='speaking'?level():0)-speakLevel)*Math.min(1,dt*18);
  if(colour!==targetColour)colour=mix(colour,targetColour,Math.min(1,dt*6));
  render(dt);}

// ---------------------------------------------------------------- text overlays
const subtitle=$('subtitle'),heard=$('heard');
function say(text,error){subtitle.textContent=text||'';subtitle.classList.toggle('on',!!text);subtitle.classList.toggle('error',!!error);hint();}
// One quiet line, only when nothing else is on screen.
function hint(){const el=$('hint'),show=['idle','asleep','error'].includes(state)&&!subtitle.textContent;el.textContent='长按空格开始聊天';el.classList.toggle('off',!show);}

// ---------------------------------------------------------------- conversation
let data={settings:{name:'小原',style:'lively',voice:'tongtong',note:''},history:[]},job=null,poll=0,levelInfo={level:0,ahead:[],at:0};
function level(){const since=(performance.now()-levelInfo.at)/50|0,v=since<=0?levelInfo.level:levelInfo.ahead[since-1];return v===undefined?levelInfo.level*.6:v;}
function setState(next){state=next;hint();if(next==='listening'){setExpression('listening');look.x.t=0;look.y.t=0;}else if(next==='thinking'||next==='transcribing')setExpression('thinking');else if(next==='idle')setExpression('calm');}
function onVoice(m){wake();
  if(m.state==='starting'||m.state==='recording'){if(job)stopTalking();if(state!=='listening'){setState('listening');say('');heard.hidden=true;}}
  else if(m.state==='level')mic=mic*.4+m.level*.6;
  else if(m.state==='transcribing'){mic=0;setState('transcribing');}
  else if(m.state==='done'){mic=0;const text=(m.text||'').trim();if(text)ask(text);else{setState('idle');setExpression('confused');say('没听清，再说一次吧');}}
  else if(m.state==='error'){mic=0;setState('error');setExpression('sad');say(m.error||'录音失败了',true);}}
async function ask(text){wake();heard.textContent='你：'+text;heard.hidden=false;say('');setState('thinking');
  try{const s=data.settings,r=await call('chat',{text,history:data.history.slice(-16),name:s.name,style:s.style,voice:s.voice,note:s.note});job={id:r.job_id,text};pollJob(job);}
  catch(e){setState('error');setExpression('sad');say(e.message,true);}}
async function pollJob(current){clearTimeout(poll);if(job!==current||!alive)return;let r;
  try{r=await call('status',{job_id:current.id});}catch(e){if(job===current)poll=setTimeout(()=>pollJob(current),400);return;}
  if(job!==current)return;
  if(r.phase==='speaking'||r.phase==='thinking'){if(r.phase==='speaking'&&state!=='speaking')setState('speaking');
    if(r.phase==='speaking'){levelInfo={level:r.level||0,ahead:r.ahead||[],at:performance.now()};if(r.emotion&&r.emotion!==expression&&EXPR[r.emotion])setExpression(r.emotion);if(r.subtitle)say(r.subtitle);if(r.level>.55&&!reduced)bob.s-=40*r.level;}
    poll=setTimeout(()=>pollJob(current),110);return;}
  job=null;
  if(r.phase==='done'){const reply=r.reply||'';remember(current.text,reply);lastActive=performance.now();
    if(!r.speech){if(EXPR[r.emotion])setExpression(r.emotion);say(reply+(r.error?'（'+r.error+'）':''));}
    state='idle';hint();speakLevel=0;
    setTimeout(()=>{if(state==='idle'&&!job){setExpression('calm');say('');heard.hidden=true;}},r.speech?5000:Math.min(12000,3000+reply.length*150));}
  else if(r.phase==='error'){setState('error');setExpression('sad');say(r.error||'出了点问题',true);}
  else setState('idle');}
function stopTalking(){job=null;clearTimeout(poll);call('stop').catch(()=>{});speakLevel=0;}
async function remember(user,reply){if(!reply)return;data.history.push({role:'user',content:user.slice(0,500)},{role:'assistant',content:reply.slice(0,600)});data.history=data.history.slice(-16);
  try{await runtime.save(data);}catch{} $('memory').textContent=memoryText();}
function memoryText(){return data.history.length?'记得最近 '+data.history.length/2+' 轮对话':'还没有对话记忆';}

// ---------------------------------------------------------------- typing and settings
const typing=$('typing'),input=$('message'),settings=$('settings');
function openTyping(){wake();if(job)stopTalking();typing.hidden=false;input.value='';input.focus();}
typing.onsubmit=e=>{e.preventDefault();const text=input.value.trim();typing.hidden=true;if(text)ask(text);};
function openSettings(){wake();const s=data.settings;$('name').value=s.name;$('style').value=s.style;$('voice').value=s.voice;$('note').value=s.note||'';$('memory').textContent=memoryText();settings.hidden=false;$('name').focus();}
function closeSettings(){settings.hidden=true;canvas.focus?.();}
$('close-settings').onclick=closeSettings;
$('save-settings').onclick=async()=>{const name=$('name').value.trim()||'小原';data.settings={name:name.slice(0,12),style:$('style').value,voice:$('voice').value,note:$('note').value.trim().slice(0,200)};
  try{await runtime.save(data);closeSettings();setExpression('happy');say('好的，我记住了！');setTimeout(()=>{if(state==='idle'){setExpression('calm');say('');}},2200);}catch{say('设置没能保存，请再试一次',true);}};
$('forget').onclick=async()=>{if(!confirm('清空 '+data.settings.name+' 记得的对话吗？'))return;data.history=[];try{await runtime.save(data);}catch{}$('memory').textContent=memoryText();};
addEventListener('keydown',e=>{
  if(!settings.hidden){if(e.key==='Escape'){e.preventDefault();closeSettings();}return;}
  if(!typing.hidden){if(e.key==='Escape'){e.preventDefault();typing.hidden=true;}return;}
  wake();
  if(e.key==='Enter'){e.preventDefault();openTyping();}
  else if(e.key==='Tab'){e.preventDefault();openSettings();}
  else if(e.key==='Escape'&&job){stopTalking();setState('idle');say('');}
  else if(e.key.startsWith('Arrow')&&!e.repeat){const d={ArrowLeft:[-46,0],ArrowRight:[46,0],ArrowUp:[0,-34],ArrowDown:[0,30]}[e.key];look.x.t=d[0];look.y.t=d[1];keyLook=performance.now()+1600;}});
addEventListener('pointerdown',wake);

// ---------------------------------------------------------------- lifecycle
runtime.onSuspend(()=>{if(!alive)return;alive=false;cancelAnimationFrame(raf);clearTimeout(poll);if(job)parent.postMessage({type:'atom:robot',id:'suspend',action:'stop',data:{}},'*');for(const p of waiting.values()){clearTimeout(p.timer);p.reject(Error('应用已退出'));}waiting.clear();});
(async()=>{try{const saved=await runtime.load(data);if(saved&&typeof saved==='object'){data={settings:{...data.settings,...(saved.settings||{})},history:Array.isArray(saved.history)?saved.history.slice(-16):[]};}}catch{}
  setState('idle');setExpression('happy');
  setTimeout(()=>{if(state==='idle'&&!location.hash.startsWith('#preview='))setExpression('calm');},2500);
  // Design preview only: #preview=<expression>[,<state>] freezes one look for screenshots.
  const preview=/^#preview=(\w+)(?:,(\w+))?/.exec(location.hash);if(preview){nextBlink=Infinity;lastActive=Infinity;setTimeout(()=>{if(preview[2])state=preview[2];setExpression(preview[1]);say(preview[1]);if(state==='listening')mic=.7;},50);}
  raf=requestAnimationFrame(frame);runtime.ready();})();
})();
