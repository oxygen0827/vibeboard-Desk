'use strict';
const scene=new Scene(),g=scene.ctx,keyboard=document.querySelector('#keys'),songChoice=document.querySelector('#song');scene.sound=true;
const sound=document.querySelector('[data-sound]');sound.textContent='声音 开';sound.setAttribute('aria-pressed','true');
const names=['Do','Re','Mi','Fa','Sol','La','Si','Do','Re','Mi'],semis=[0,2,4,5,7,9,11,12,14,16],blacks=[1,3,6,8,10,13,15],keys={},bars=[],stamps={};let demo=false,index=0,gesture=null,playTimer=null,playEpoch=0,expressive=true;
const piano=new SampledPiano(scene);let manualEpoch=0;
scene.tone=(f,duration=.45,volume=.7,type=null,when=null)=>piano.note(69+12*Math.log2(f/440),duration,volume,when);
PIANO_SONGS.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;songChoice.append(o)});
function selectedSong(){return PIANO_SONGS.find(s=>s.id===songChoice.value)||PIANO_SONGS[0]}
function stopDemo(){manualEpoch++;playEpoch++;clearTimeout(playTimer);playTimer=null;demo=false;index=0;document.querySelector('#demo').textContent='播放';scene.silence();}
async function play(note,duration=.7){const epoch=manualEpoch;try{if(!piano.buffers.length)scene.notice('正在准备钢琴音源…');await piano.prepare();if(epoch!==manualEpoch||!scene.active||!scene.sound)return;await scene.audio.resume();if(epoch!==manualEpoch||!scene.active)return;scene.tone(261.625565*Math.pow(2,note/12),duration,.72);lightNote(note);scene.notice('Yamaha C5 · 按住滑奏')}catch(_){if(scene.active)scene.notice('音源加载失败，请重试')}}
function lightNote(note){const key=keys[note],stamp=(stamps[note]||0)+1;stamps[note]=stamp;if(key){key.classList.add('on');scene.after(()=>{if(stamps[note]===stamp)key.classList.remove('on')},180)}if(bars.length<50)bars.push({x:(note+39)/87*460+10,life:1,hue:200+note*8});}
function manual(note){if(demo)stopDemo();play(note);scene.notice('按住划过琴键 · 松手停止');}
function makeKey(note,left,width,black,label){const key=document.createElement('button');key.className='piano-key '+(black?'black':'white');key.dataset.note=note;key.style.left=left+'%';key.style.width=width+'%';key.setAttribute('aria-label','弹奏 '+label);key.innerHTML='<span>'+label+'</span>'+(!black?'<small>'+((semis.indexOf(note)+1)%10)+'</small>':'');keyboard.append(key);keys[note]=key;scene.listen(key,'click',e=>{if(e.detail===0)manual(note)});}
semis.forEach((s,i)=>makeKey(s,i*10,9.7,false,names[i]));blacks.forEach(s=>makeKey(s,(semis.indexOf(s-1)+1)*10-3,6,true,'♯'));
function strikeAt(x,y){const key=document.elementFromPoint(x,y)?.closest('.piano-key');const note=key&&keyboard.contains(key)?Number(key.dataset.note):null;if(note===gesture.note)return;gesture.note=note;if(note!==null)manual(note);}
function release(){manualEpoch++;if(!gesture)return;const id=gesture.id;gesture=null;if(keyboard.hasPointerCapture(id))keyboard.releasePointerCapture(id);scene.silence();Object.values(keys).forEach(k=>k.classList.remove('on'));}
scene.listen(keyboard,'pointerdown',e=>{if(e.button!==0||gesture)return;e.preventDefault();gesture={id:e.pointerId,x:e.clientX,y:e.clientY,note:null};keyboard.setPointerCapture(e.pointerId);strikeAt(e.clientX,e.clientY);});
scene.listen(keyboard,'pointermove',e=>{if(!gesture||gesture.id!==e.pointerId)return;if(e.pointerType==='mouse'&&!(e.buttons&1)){release();return;}const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y,steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/6)),x=gesture.x,y=gesture.y;for(let i=1;i<=steps;i++)strikeAt(x+dx*i/steps,y+dy*i/steps);gesture.x=e.clientX;gesture.y=e.clientY;});
for(const event of ['pointerup','pointercancel','lostpointercapture'])scene.listen(keyboard,event,e=>{if(gesture?.id===e.pointerId)release()});scene.listen(window,'blur',()=>{release();stopDemo()});scene.listen(document,'visibilitychange',()=>{if(document.hidden){release();stopDemo()}});
scene.key(e=>{if(/^[0-9]$/.test(e.key))manual(semis[e.key==='0'?9:+e.key-1]);});
scene.listen(document.querySelector('#tone'),'click',e=>{expressive=!expressive;e.target.textContent=expressive?'表情 开':'原谱';e.target.setAttribute('aria-pressed',String(expressive));if(demo)startDemo()});
scene.listen(songChoice,'change',()=>{stopDemo();scene.notice(selectedSong().composer+' · 完整钢琴谱')});
async function startDemo(){stopDemo();release();if(!scene.sound)sound.click();const epoch=playEpoch;demo=true;document.querySelector('#demo').textContent='停止';scene.notice('正在准备钢琴音源…');
 try{await piano.prepare();await scene.audio.resume();if(epoch!==playEpoch||!scene.active||!demo)return;
 const song=selectedSong(),score=interpretScore(song,expressive,document.querySelector('#hands').value),speed=Number(document.querySelector('#speed').value),start=scene.audio.currentTime+.1;let cursor=0,lastLabel=-1;
 function schedule(){if(epoch!==playEpoch||!demo||!scene.active)return;const now=scene.audio.currentTime;
 while(cursor<score.events.length&&start+score.events[cursor].time/speed<now+.2){const n=score.events[cursor++],at=start+n.time/speed;if(at<now-.1)continue;
 piano.note(n.midi,n.duration/speed,n.velocity,at);index=cursor;
 scene.after(()=>{if(epoch===playEpoch&&demo)lightNote(n.midi-60)},Math.max(0,(at-now)*1000));}
 const elapsed=Math.max(0,now-start),second=Math.floor(elapsed);if(second!==lastLabel){lastLabel=second;const fmt=x=>Math.floor(x/60)+':'+String(Math.floor(x%60)).padStart(2,'0');scene.notice(fmt(elapsed)+' / '+fmt(score.duration/speed));document.querySelector('#progress').value=Math.min(1,elapsed/(score.duration/speed));}
 if(now>=start+score.duration/speed){stopDemo();scene.notice('演奏结束 · '+song.composer);return;}playTimer=setTimeout(schedule,25);}
 schedule();}catch(_){stopDemo();scene.notice('音源暂不可用，请重试')}}
scene.listen(document.querySelector('#demo'),'click',()=>{if(demo)stopDemo();else startDemo()});
scene.listen(document.querySelector('#speed'),'change',()=>{if(demo)startDemo()});
scene.listen(document.querySelector('#hands'),'change',()=>{if(demo)startDemo()});
scene.listen(sound,'click',()=>{if(!scene.sound){manualEpoch++;release();stopDemo()}});
scene.listen(document.querySelector('[data-atom-back]'),'click',()=>{stopDemo();if(window.AtomApp?.navigation)AtomApp.navigation.back();else window.AtomApp?.home?.()});
scene.loop(dt=>{g.clearRect(0,0,480,360);if(scene.motion.matches){bars.length=0;return;}for(let i=bars.length-1;i>=0;i--){const b=bars[i];b.life-=.018*dt;if(b.life<=0){bars.splice(i,1);continue;}g.fillStyle=`hsla(${b.hue},85%,60%,${b.life*.65})`;g.fillRect(b.x-13,360-b.life*320,26,b.life*320);}});
if(window.AtomApp){AtomApp.onSuspend(()=>{manualEpoch++;gesture=null;stopDemo();piano.dispose()});AtomApp.ready()}
