'use strict';
const scene=new Scene(),g=scene.ctx;let best=0,loaded=false,saveFailed=false,S;
function reset(){S={y:180,v:0,walls:[],ticks:0,next:70,score:0,state:'ready',speed:2.4,trail:[],parts:[],overTime:0};document.querySelector('#play').textContent='开始';}
reset();document.querySelector('#play').disabled=true;
scene.restore({best:0},v=>{best=Number.isFinite(v.best)?Math.max(0,Math.floor(v.best)):0;loaded=true;document.querySelector('#play').disabled=false;});
async function saveBest(){try{const result=await scene.save({best});saveFailed=false;scene.notice(result.mode==='preview'?'预览纪录，安装后独立保存':'最高纪录已保存');}catch(_){saveFailed=true;scene.notice('纪录未保存，点右下角重试');}}
function flap(){if(!loaded)return;if(S.state==='over'){if(S.overTime<25)return;reset();}if(S.state==='ready'){S.state='play';document.querySelector('#play').textContent='跃起';}S.v=-4.6;scene.tone(880,.06,.25);}
function crash(){if(S.state!=='play')return;S.state='over';S.overTime=0;document.querySelector('#play').textContent='再来一次';for(let i=0;i<36;i++){const a=Math.random()*7,s=1+Math.random()*4;S.parts.push({x:110,y:S.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1});}scene.tone(180,.3,.4);if(S.score>best){best=S.score;saveBest();}}
scene.listen(scene.canvas,'pointerdown',e=>{e.preventDefault();flap();});scene.listen(document.querySelector('#play'),'click',flap);
scene.key(e=>{if(e.key==='Enter'||e.key==='ArrowUp'){e.preventDefault();flap();}});
scene.listen(document.querySelector('#retry-save'),'click',()=>{if(saveFailed)saveBest();});
scene.loop(dt=>{S.ticks+=dt;if(S.state==='over')S.overTime+=dt;g.fillStyle='#0a0716';g.fillRect(0,0,480,360);g.strokeStyle='#7850ff26';for(let i=0;i<12;i++){const shift=S.state==='play'?S.ticks*S.speed:0,xx=((i*48-shift)%576+576)%576-48;g.beginPath();g.moveTo(xx,63);g.lineTo(xx,302);g.stroke();}
 if(S.state==='play'){S.v+=.22*dt;S.y+=S.v*dt;S.speed=2.4+Math.min(2.2,S.score*.06);S.next-=dt;if(S.next<=0){const gap=145-Math.min(35,S.score*2);S.walls.push({x:500,cy:73+gap/2+Math.random()*(222-gap),gap,passed:false});S.next=Math.max(65,95-S.score*2);}for(const w of S.walls){w.x-=S.speed*dt;if(!w.passed&&w.x<94){w.passed=true;S.score++;scene.tone(1320,.07,.25);}if(w.x<134&&w.x>86&&(S.y<w.cy-w.gap/2+8||S.y>w.cy+w.gap/2-8))crash();}S.walls=S.walls.filter(w=>w.x>-40);if(S.y>295||S.y<70)crash();}
 for(const w of S.walls){const top=w.cy-w.gap/2,bot=w.cy+w.gap/2,gr=g.createLinearGradient(w.x-16,0,w.x+16,0);gr.addColorStop(0,'#ff3d7f');gr.addColorStop(1,'#ff9a3d');g.fillStyle=gr;g.fillRect(w.x-16,63,32,top-63);g.fillRect(w.x-16,bot,32,302-bot);g.fillStyle='#ffffffb0';g.fillRect(w.x-16,top-3,32,3);g.fillRect(w.x-16,bot,32,3);}
 if(S.state!=='over'){if(S.state==='play'){S.trail.push({x:110,y:S.y});if(S.trail.length>18)S.trail.shift();}S.trail.forEach((p,i)=>{p.x-=S.speed*dt;g.fillStyle=`hsla(${190+i*4},100%,70%,${i/18*.5})`;g.beginPath();g.arc(p.x,p.y,3+i/4,0,7);g.fill();});const light=g.createRadialGradient(110,S.y,0,110,S.y,16);light.addColorStop(0,'#fff');light.addColorStop(.4,'#5ef0ff');light.addColorStop(1,'#5ef0ff00');g.fillStyle=light;g.beginPath();g.arc(110,S.y,16,0,7);g.fill();}
 S.parts=S.parts.filter(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.08*dt;return(p.life-=.02*dt)>0;});for(const p of S.parts){g.fillStyle=`rgba(94,240,255,${p.life})`;g.fillRect(p.x,p.y,3,3);}
 document.querySelector('#score').textContent=S.score;document.querySelector('#best').textContent=best;document.querySelector('#retry-save').hidden=!saveFailed;
 const prompt=document.querySelector('#prompt');prompt.hidden=S.state==='play';prompt.querySelector('h2').textContent=S.state==='over'?'光子散射了':'穿过下一道光门';prompt.querySelector('p').textContent=S.state==='over'?'得分 '+S.score+' · 点按再来一次':'点按画面或按 Enter，让光子跃起';
});
