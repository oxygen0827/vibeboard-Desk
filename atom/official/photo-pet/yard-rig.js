/* Continuous two-bone limbs. A single body plate preserves identity and planted feet. */
(function(root){'use strict';
const PI=Math.PI,clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
// Shared on-screen movement curve: cubic-bezier(.77,0,.175,1).
function ease(x){x=clamp(x);let lo=0,hi=1,u=x;for(let i=0;i<12;i++){u=(lo+hi)/2;const v=3*(1-u)*(1-u)*u*.77+3*(1-u)*u*u*.175+u*u*u;if(v<x)lo=u;else hi=u}return 3*(1-u)*u*u+u*u*u}
function track(t,keys){for(let i=1;i<keys.length;i++)if(t<=keys[i][0])return mix(keys[i-1][1],keys[i][1],clamp((t-keys[i-1][0])/(keys[i][0]-keys[i-1][0])));return keys[keys.length-1][1]}
function bone(a,b,l1,l2,side=1){const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.001,n=clamp(d,.01,l1+l2-.01),u={x:dx/d,y:dy/d},along=(l1*l1-l2*l2+n*n)/(2*n),h=Math.sqrt(Math.max(0,l1*l1-along*along));return{root:a,elbow:{x:a.x+u.x*along-u.y*h*side,y:a.y+u.y*along+u.x*h*side},hand:{x:a.x+u.x*n,y:a.y+u.y*n}}}
function turn(p,a){return{x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)}}
function goal(n,t){
 if(n.id==='gardener'&&n.care===1){
  const u=n.eventTime||0,q=u%1.4/1.4;
  if(n.stage==='sow'||n.stage==='fertilize'){
   const reach=track(q,[[0,0],[.18,0],[.46,1],[.68,1],[1,0]]);
   return{hx:mix(0,11,reach),hy:mix(-26,-20,reach)-Math.sin(reach*PI)*4,otherX:10,otherY:-25,angle:0,pour:0,bend:0,prop:n.stage==='sow'?'seed':'pouch',scatter:q>.46&&q<.68};
  }
  if(n.stage==='harvest'){
   const lift=track(n.eventProgress,[[0,0],[.25,0],[.65,1],[.9,1],[1,0.8]]);
   return{hx:mix(7,3,lift),hy:mix(-18,-33,lift),otherX:10,otherY:-24,angle:0,pour:0,bend:3*(1-lift),prop:'carrot',picked:n.eventProgress>.25};
  }
  if(n.stage==='inspect')return{hx:7,hy:-27,otherX:10,otherY:-25,angle:0,pour:0,bend:0,prop:n.carrying||'can'};
  if(n.stage==='walk'&&n.carrying!=='can')return{hx:-9+Math.sin(t*6)*3,hy:-24,otherX:10,otherY:-25,angle:0,pour:0,bend:0,prop:n.carrying};
  if(n.stage==='water'){const pour=track(n.eventProgress,[[0,0],[.2,1],[.8,1],[1,0]]);return{hx:mix(10,12,pour),hy:mix(-23,-32,pour),angle:mix(-.18,.42,pour),pour,bend:0,prop:'can'}}
 }
 if(n.stage==='walk'){if(n.id==='smith')return{hx:-13+Math.sin(t*6)*3,hy:-23,angle:-.1,otherX:12,otherY:-25,impact:false};if(n.id==='gardener')return{hx:13,hy:-24,angle:-.1,pour:0};return{hx:11,hy:-29,angle:.8}}
 if(n.id==='smith'){
  if(n.stage==='heat')return{hx:8,hy:-27,angle:0,otherX:-12,otherY:-23,impact:false,prop:'tongs'};
  if(n.stage==='polish')return{hx:-1+Math.sin(t*5)*4,hy:-26,angle:0,otherX:12,otherY:-24,impact:false,prop:'file'};
  if(n.stage==='deliver'||n.stage==='rest')return{hx:-12,hy:-23,angle:0,otherX:12,otherY:-25,impact:false,prop:'hammer'};
  const period=n.phase==='working'?2:2.8,q=t%period/period;
  const lift=track(q,[[0,0],[.35,1],[.43,1],[.56,0],[.65,0],[1,0]]),hit=track(q,[[0,0],[.43,0],[.56,1],[.65,1],[.94,0],[1,0]]);
  return{hx:mix(-14,-9,lift)+21*hit,hy:mix(-22,-49,lift)-4*hit,angle:mix(-.15,-.4,lift)+1.72*hit,otherX:12,otherY:-28,impact:q>=.55&&q<.59};
 }
 if(n.id==='gardener'){
  // Water comes only from an assigned task, never from an ambient clock.
  if(n.phase!=='working'){const glance=n.stage==='inspect'?Math.sin((n.eventProgress||0)*PI):0;return{hx:10-glance,hy:-23+glance,angle:-.18,pour:0}}
  const pour=n.stage==='water'?1:0;
  return{hx:mix(10,12,pour),hy:mix(-23,-26,pour),angle:mix(-.18,.42,pour)+Math.sin(t*1.7)*.015*pour,pour};
 }
 if(n.id==='fisher'&&n.phase==='working'){
  const u=n.eventTime||0;
  const angle=n.stage==='cast'?track(u,[[0,.4],[.5,-.2],[1.4,.83]]):n.stage==='wait'?.83+Math.sin(t*1.5)*.015:n.stage==='reel'?mix(.83,.38,clamp((u-21)/5)):.4;
  return{hx:9,hy:-29+(n.stage==='reel'?Math.sin(t*6)*.6:0),angle};
 }
 const q=(t+1.1)%7.8,lift=track(q,[[0,0],[1.2,1],[2.8,0],[4.4,0],[5.6,.7],[6.9,0],[7.8,0]]);
 return{hx:mix(9,7,lift),hy:mix(-29,-34,lift),angle:mix(.83,.38,lift)+Math.sin(t*1.5)*.025};
}
const palettes={smith:{shirt:'#a95032',light:'#cc7950',skin:'#e8b07b',shade:'#a86f49',trouser:'#45453c',boot:'#705034',hand:'#5f4939'},gardener:{shirt:'#e2d6ad',light:'#f5e7c4',skin:'#e9b17c',shade:'#ac794e',trouser:'#647647',boot:'#987347',hand:'#e9b17c'},fisher:{shirt:'#3a7997',light:'#69a0af',skin:'#e7b180',shade:'#aa784f',trouser:'#385c61',boot:'#7b573b',hand:'#e7b180'}};
function create(paint){
 const bodies={},walking={},states={},parts={},buffers={};let wateringCan;
 const cv=()=>{const c=document.createElement('canvas');c.width=96;c.height=96;return c};
 function poly(c,points){c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath()}
 for(const [row,id] of ['smith','gardener','fisher'].entries()){
  const raw=cv(),rc=raw.getContext('2d');paint(rc,row,0,48,82,59);
  if(id==='gardener'){
   // Reuse the original painted watering can, excluding the hand and trouser pixels.
   const pixels=rc.getImageData(0,0,96,96),mask=new Set();let sumX=0,sumY=0;
   for(let y=52;y<77;y++)for(let x=20;x<52;x++){const i=(y*96+x)*4;if(pixels.data[i+3]>80&&pixels.data[i+1]>pixels.data[i]+8&&pixels.data[i+2]>pixels.data[i]+5){mask.add(y*96+x);sumX+=x;sumY+=y}}
   if(mask.size){const texture=cv(),tc=texture.getContext('2d'),out=tc.createImageData(96,96),expanded=new Set();for(const k of mask)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)expanded.add(k+dy*96+dx);for(const k of expanded)for(let ch=0;ch<4;ch++)out.data[k*4+ch]=pixels.data[k*4+ch];tc.putImageData(out,0,0);const right=Math.max(...Array.from(mask,k=>k%96)),tip=Array.from(mask).filter(k=>k%96>=right-1);wateringCan={texture,x:sumX/mask.size,y:sumY/mask.size,tip:{x:right-sumX/mask.size,y:tip.reduce((n,k)=>n+Math.floor(k/96),0)/tip.length-sumY/mask.size}}}
  }
  const body=cv(),c=body.getContext('2d');c.translate(48,82);c.save();
  // Preserve the approved head, clothing, apron, trousers and boots; remove old arms/props.
  c.beginPath();c.rect(-19,-66,38,27);c.moveTo(-8,-41);c.lineTo(8,-40);c.lineTo(10,-17);c.lineTo(-11,-17);c.lineTo(-8,-41);c.rect(-18,-17,37,19);c.clip();c.drawImage(raw,-48,-82);c.restore();
  if(id==='gardener'){c.fillStyle='#65764b';c.fillRect(-6,-21,7,6);c.fillStyle='#485c3d';c.fillRect(-7,-18,3,3)}
  if(id==='fisher'){
   // The reference rod crosses the vest and left trouser leg; restore those small areas.
   c.fillStyle='#a5783c';c.fillRect(-7,-31,14,9);c.fillStyle='#d3a666';c.fillRect(-6,-29,2,5);c.fillStyle='#654d31';c.fillRect(-7,-23,15,2);
   c.fillStyle='#34555b';poly(c,[[-12,-4],[-9,-3],[3,-20],[0,-21]]);c.fill();
  }
  const lower=cv(),lowerCtx=lower.getContext('2d');paint(lowerCtx,row,3,48,82,59);
  c.clearRect(-48,-17,96,31);c.save();c.beginPath();c.rect(-18,-17,37,19);c.clip();c.drawImage(lower,-48,-82);c.restore();
  const joints={smith:[{x:-10,y:-37},{x:-15,y:-28},{x:-17,y:-20}],gardener:[{x:-8,y:-37},{x:-12,y:-28},{x:-14,y:-21}],fisher:[{x:-10,y:-37},{x:-13,y:-29},{x:-6,y:-22}]}[id];
  function part(a,b,width){const length=Math.hypot(b.x-a.x,b.y-a.y),canvas=cv();canvas.width=width;canvas.height=Math.ceil(length)+2;const pc=canvas.getContext('2d');pc.imageSmoothingEnabled=false;pc.translate(width/2,1);pc.rotate(Math.PI/2-Math.atan2(b.y-a.y,b.x-a.x));pc.translate(-a.x,-a.y);pc.drawImage(raw,-48,-82);return{canvas,length}}
  parts[id]=[part(joints[0],joints[1],7),part(joints[1],joints[2],5)];
  const top=cv(),tc=top.getContext('2d');tc.drawImage(body,0,0,96,65,0,0,96,65);bodies[id]=top;
  const legs=cv(),lc=legs.getContext('2d');lc.drawImage(body,0,65,96,31,0,65,96,31);walking[id]=legs;
 }
 function pixel(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h)}
 function stroke(c,a,b,width,color){c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke()}
 function limb(c,j,p,id){
  // The cloth and skin come from the original character, attached to moving bones.
  const pieces=parts[id],nodes=[j.root,j.elbow,j.hand];
  for(let i=0;i<2;i++){const a=nodes[i],b=nodes[i+1],part=pieces[i],length=Math.hypot(b.x-a.x,b.y-a.y);stroke(c,a,b,i?3:5,i?p.skin:p.shirt);c.save();c.translate(a.x,a.y);c.rotate(Math.atan2(b.y-a.y,b.x-a.x)-PI/2);c.drawImage(part.canvas,-part.canvas.width/2,-1,part.canvas.width,length+2);c.restore()}
  pixel(c,j.hand.x-2,j.hand.y-2,4,4,p.hand);pixel(c,j.hand.x-1,j.hand.y-2,1,1,p.light);
 }
 function leg(c,hip,foot,p){const j=bone(hip,foot,10,10,-1);stroke(c,j.root,j.elbow,6,p.trouser);stroke(c,j.elbow,j.hand,5,p.trouser);pixel(c,foot.x-2,foot.y-1,6,3,p.boot);pixel(c,foot.x-2,foot.y+1,6,1,'#4e412e')}
 function hammer(c,s){c.save();c.translate(s.hx,s.hy);c.rotate(s.angle);pixel(c,-1,-13,2,18,'#513c2e');pixel(c,0,-12,1,15,'#ba8653');pixel(c,-5,-16,10,6,'#454e50');pixel(c,-4,-15,8,4,'#818f90');pixel(c,-4,-15,7,1,'#b5c2bb');c.restore()}
 function can(c,s){c.save();c.translate(s.hx,s.hy);c.rotate(s.angle);if(wateringCan){c.drawImage(wateringCan.texture,-wateringCan.x,-wateringCan.y);c.restore();return;}pixel(c,-6,-3,13,9,'#346c72');pixel(c,-5,-2,11,7,'#549b9a');pixel(c,-4,-2,3,6,'#8dc0ad');pixel(c,-5,-5,10,3,'#417e80');stroke(c,{x:-4,y:-5},{x:3,y:-7},2,'#315b62');stroke(c,{x:3,y:-7},{x:6,y:-3},2,'#315b62');stroke(c,{x:6,y:0},{x:13,y:-3},3,'#72aaa5');pixel(c,12,-5,3,4,'#aed2c1');pixel(c,-1,1,2,1,'#d0c48b');pixel(c,2,3,1,2,'#d0c48b');c.restore()}
 function pouch(c,hand,seed){pixel(c,hand.x-5,hand.y,11,10,'#725534');pixel(c,hand.x-4,hand.y+1,9,8,seed?'#d3b977':'#ae8b5b');pixel(c,hand.x-3,hand.y,7,2,'#4e422c');pixel(c,hand.x-2,hand.y+4,4,3,seed?'#edce70':'#74804c');pixel(c,hand.x-4,hand.y+2,2,5,'#ddbd82')}
 function carrot(c,hand){pixel(c,hand.x-2,hand.y+1,5,8,'#d47f3d');pixel(c,hand.x-1,hand.y+2,2,5,'#f3b666');pixel(c,hand.x-1,hand.y+8,2,3,'#c47036');pixel(c,hand.x-1,hand.y-4,2,6,'#618646');pixel(c,hand.x-4,hand.y-3,4,2,'#88a958')}
 function pose(n,t,motion){let s=states[n.id],g={bend:0,otherX:8,otherY:-29,...goal(n,t)};g.grip=n.id==='gardener'&&(!g.prop||g.prop==='can')?1:0;if(!s){s=states[n.id]={...g,last:t,travel:0,x:n.x,y:n.y}}if(motion){const dt=clamp(t-s.last,0,.1),a=1-Math.exp(-dt/.065);for(const key of ['hx','hy','angle','otherX','otherY','pour','bend','grip'])if(g[key]!==undefined)s[key]=mix(s[key]===undefined?g[key]:s[key],g[key],a);const d=Math.hypot(n.x-s.x,n.y-s.y);if(d<20)s.travel+=d;s.impact=g.impact}else s.impact=false;s.dt=motion?clamp(t-s.last,0,.1):0;s.prop=g.prop||(n.id==='smith'?'hammer':n.id==='fisher'?'rod':'can');s.scatter=motion&&g.scatter;s.picked=g.picked;s.last=t;s.x=n.x;s.y=n.y;return s}
 function draw(screen,n,t,motion){
  const s=pose(n,t,motion),p=palettes[n.id],walk=motion&&n.stage==='walk',phase=s.travel/20;
  const bodyY=walk?-Math.abs(Math.sin(phase*PI*2))*.7:(s.bend||0);
  let hand={x:s.hx,y:s.hy},other={x:s.otherX===undefined?8:s.otherX,y:s.otherY===undefined?-29:s.otherY};
  if(n.id==='gardener'){const near=turn({x:-4,y:-5},s.angle),far=turn({x:5,y:-3},s.angle);hand={x:s.hx+near.x*s.grip,y:s.hy+near.y*s.grip};other={x:mix(other.x,s.hx+far.x,s.grip),y:mix(other.y,s.hy+far.y,s.grip)}}
  if(n.id==='fisher')other={x:s.hx-4,y:s.hy+3};
  // Changing implements must not snap the wrist to a different handle offset.
  if(n.id==='gardener'){for(const [key,target] of [['frontTarget',hand],['backTarget',other]]){let previous=s[key];if(!previous)previous=s[key]={...target};const distance=Math.hypot(target.x-previous.x,target.y-previous.y),q=distance?Math.min(1,72*s.dt/distance):1;if(motion){previous.x=mix(previous.x,target.x,q);previous.y=mix(previous.y,target.y,q)}target.x=previous.x;target.y=previous.y}}
  const front=bone({x:-9,y:-37+bodyY},hand,11,12,1),back=bone({x:8,y:-36+bodyY},other,10,11,-1);
  const handle=turn({x:-4,y:-5},s.angle),canPose={hx:front.hand.x-handle.x,hy:front.hand.y-handle.y,angle:s.angle};
  // Subpixel changes below the pixel-art grid reuse one small composited character.
  // Fast swings still produce a new pose every frame; holds avoid dozens of repeated draws.
  const key=[hand.x,hand.y,other.x,other.y].map(v=>Math.round(v*2)).concat(Math.round(s.angle*40),Math.round(bodyY*2),s.prop,s.picked?1:0,walk?1:0,walk?Math.round((phase%1)*64):0).join('/');
  let buffer=buffers[n.id];if(!buffer){const canvas=cv();buffer=buffers[n.id]={canvas,ctx:canvas.getContext('2d'),key:''}}
  const tip=turn({x:0,y:-43},s.angle);
  if(buffer.key!==key){const ctx=buffer.ctx;ctx.clearRect(0,0,96,96);ctx.imageSmoothingEnabled=false;ctx.save();ctx.translate(48,82);
  limb(ctx,back,p,n.id);
  if(walk){for(let i=0;i<2;i++){const q=(phase+i*.5)%1,stance=q<.6,f=stance?q/.6:(q-.6)/.4;const foot={x:(i?3:-3)+(stance?6-12*f:-6+12*ease(f)),y:stance?-2:-2-3*Math.sin(f*PI)};leg(ctx,{x:i?5:-4,y:-20+bodyY},foot,p)}}else ctx.drawImage(walking[n.id],-48,-82);
  ctx.drawImage(bodies[n.id],-48,-82+bodyY);
  if(n.id==='smith'){
   if(s.prop==='tongs'){const h=front.hand;stroke(ctx,h,{x:h.x+14,y:h.y-2},2,'#4b5049');stroke(ctx,{x:h.x,y:h.y+2},{x:h.x+14,y:h.y},1,'#9a9d87');pixel(ctx,h.x+12,h.y-3,9,3,'#f4b86b')}
   else if(s.prop==='file'){pixel(ctx,back.hand.x-5,back.hand.y,11,3,'#8d9c98');stroke(ctx,front.hand,{x:front.hand.x+15,y:front.hand.y+3},3,'#5c6765');stroke(ctx,front.hand,{x:front.hand.x+12,y:front.hand.y+2},1,'#b7c6c1')}
   else{stroke(ctx,other,{x:23,y:-26},2,'#4b5049');stroke(ctx,{x:other.x,y:other.y+2},{x:23,y:-24},1,'#9a9d87');hammer(ctx,s)}
  }
  if(n.id==='gardener'){if(s.prop==='can')can(ctx,canPose);if(s.prop==='pouch'||s.prop==='seed')pouch(ctx,back.hand,s.prop==='seed');if(s.prop==='carrot'&&s.picked)carrot(ctx,front.hand)}
  if(n.id==='fisher'){stroke(ctx,{x:s.hx-3,y:s.hy+4},{x:s.hx+tip.x,y:s.hy+tip.y},2,'#4d3d2a');stroke(ctx,{x:s.hx,y:s.hy},{x:s.hx+tip.x,y:s.hy+tip.y},1,'#b3a06b');pixel(ctx,s.hx-2,s.hy,4,4,'#354f51');pixel(ctx,s.hx-1,s.hy+1,2,2,'#94a99a')}
  limb(ctx,front,p,n.id);ctx.restore();buffer.key=key;}
  screen.save();screen.translate(n.x,n.y);if(n.left)screen.scale(-1,1);screen.drawImage(buffer.canvas,-48,-82);screen.restore();
  const spout=turn(wateringCan?wateringCan.tip:{x:14,y:-3},s.angle);
  const direction=n.left?-1:1;
  return{tipX:n.x+direction*(s.hx+tip.x),tipY:n.y+s.hy+tip.y,spoutX:n.x+direction*(canPose.hx+spout.x),spoutY:n.y+canPose.hy+spout.y,handX:n.x+direction*front.hand.x,handY:n.y+front.hand.y,prop:s.prop,scatter:s.scatter,impact:s.impact,pour:s.pour||0,front,back};
 }
 return{draw,parkCan(c,x,y){can(c,{hx:x,hy:y,angle:0})}};
}
root.YardRig={create,bone,goal};if(typeof module!=='undefined')module.exports=root.YardRig;
})(globalThis);
