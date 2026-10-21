'use strict';
const scene=new Scene(),c=scene.canvas,g=scene.ctx,N=6,X0=43,X1=411,Y0=88,DY=39;
const ys=Array.from({length:N},(_,i)=>Y0+i*DY),xs=Array.from({length:8},(_,k)=>X0+40+k*41),mzis=[],photons=[],det=Array(6).fill(0);
xs.forEach((cx,k)=>{for(let a=k%2;a+1<N;a+=2)mzis.push({cx,a,phase:Math.random()*Math.PI,speed:.3+Math.random()*.7,flash:0});});
let interactions=0,automatic=!scene.motion.matches,elapsed=0,idle=0;
const auto=document.querySelector('#auto');auto.setAttribute('aria-pressed',String(automatic));auto.textContent=automatic?'自动流动':'开启流动';
function inject(lane){if(photons.length<80)photons.push({x:X0-12,y:ys[lane],target:ys[lane],lane,hue:180+lane*25,last:-1});}
function send(lane){idle=0;for(let j=0;j<5;j++)scene.after(()=>inject(lane),j*70);scene.tone(660+lane*110,.08,.25);}
scene.listen(c,'pointerdown',e=>{e.preventDefault();const y=scene.point(e)[1];send(ys.reduce((best,v,i)=>Math.abs(v-y)<Math.abs(ys[best]-y)?i:best,0));});
scene.key(e=>{if(/^[1-6]$/.test(e.key))send(+e.key-1);else if(e.key==='Enter')send(Math.floor(Math.random()*6));});
scene.listen(auto,'click',()=>{automatic=!automatic;auto.setAttribute('aria-pressed',String(automatic));auto.textContent=automatic?'自动流动':'开启流动';});
scene.listen(document.querySelector('#clear'),'click',()=>{photons.length=0;det.fill(0);interactions=0;});
scene.loop(dt=>{elapsed+=dt;idle+=dt;if(automatic&&idle>80&&elapsed>20){inject(Math.floor(Math.random()*6));elapsed=0;}
 g.fillStyle='rgba(5,9,20,.36)';g.fillRect(0,0,480,360);g.strokeStyle='#7892ff2e';g.lineWidth=1;g.strokeRect(20,70,440,225);
 for(const y of ys){g.strokeStyle='#5a78dc66';g.lineWidth=2;g.beginPath();g.moveTo(28,y);g.lineTo(X1+8,y);g.stroke();}
 for(const m of mzis){if(automatic||photons.length)m.phase+=.004*m.speed*dt;m.flash*=Math.pow(.92,dt);const y1=ys[m.a],y2=ys[m.a+1];g.strokeStyle=`rgba(${120+m.flash*135|0},${160+m.flash*95|0},255,${.45+m.flash*.5})`;g.beginPath();g.moveTo(m.cx-16,y1);g.bezierCurveTo(m.cx-6,y1,m.cx-6,y2,m.cx+4,y2);g.moveTo(m.cx-16,y2);g.bezierCurveTo(m.cx-6,y2,m.cx-6,y1,m.cx+4,y1);g.stroke();const phase=(Math.sin(m.phase)+1)/2;g.fillStyle=`hsl(${20+phase*40},100%,${40+phase*25}%)`;g.fillRect(m.cx+6,y1-3,10,4);}
 for(let i=photons.length-1;i>=0;i--){const p=photons[i];p.x+=2.6*dt;for(let k=0;k<xs.length;k++){if(p.last<k&&p.x>=xs[k]-16){p.last=k;const m=mzis.find(m=>m.cx===xs[k]&&(m.a===p.lane||m.a+1===p.lane));if(m){if(Math.random()<Math.sin(m.phase)**2)p.lane=p.lane===m.a?m.a+1:m.a;m.flash=1;interactions++;}p.target=ys[p.lane];}}p.y+=(p.target-p.y)*(1-Math.pow(.75,dt));const light=g.createRadialGradient(p.x,p.y,0,p.x,p.y,9);light.addColorStop(0,`hsla(${p.hue},100%,88%,1)`);light.addColorStop(1,`hsla(${p.hue},100%,60%,0)`);g.fillStyle=light;g.beginPath();g.arc(p.x,p.y,9,0,7);g.fill();if(p.x>X1+8){det[p.lane]=Math.min(1,det[p.lane]+.18);photons.splice(i,1);}}
 ys.forEach((y,i)=>{det[i]*=Math.pow(.985,dt);g.fillStyle='#26325b';g.fillRect(428,y-6,23,12);g.fillStyle=`hsl(${180+i*25},100%,70%)`;g.fillRect(428,y-6,23*det[i],12);g.beginPath();g.arc(28,y,4,0,7);g.fill();});document.querySelector('#count').textContent=interactions.toLocaleString('zh-CN');
});
