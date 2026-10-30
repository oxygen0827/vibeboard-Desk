(function(root){'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function create(width,height){return Array.from({length:5},(_,i)=>({id:i,x:width*(.28+i*.105),y:height*(.57+(i%2)*.12),vx:(i-2)*17,vy:-i*9,r:10+i%3*2,hitAt:-10}));}
function advance(balls,dt,width,height,gravity,time,hit){
  dt=clamp(dt,0,1/30);const floor=height-26,ceil=16;
  for(const b of balls){
    if(b.held)continue;
    b.vx=clamp((b.vx+gravity.x*dt)*Math.exp(-.2*dt),-600,600);
    b.vy=clamp((b.vy+gravity.y*dt)*Math.exp(-.2*dt),-600,600);
    b.x+=b.vx*dt;b.y+=b.vy*dt;let speed=0;
    if(b.x<b.r+14||b.x>width-b.r-14){speed=Math.abs(b.vx);b.vx*=-.86;b.x=clamp(b.x,b.r+14,width-b.r-14);}
    if(b.y<ceil+b.r||b.y>floor-b.r){speed=Math.max(speed,Math.abs(b.vy));b.vy*=-.82;b.y=clamp(b.y,ceil+b.r,floor-b.r);}
    if(speed>42&&time-b.hitAt>.15){b.hitAt=time;hit(b,speed);}
  }
  for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){
    const a=balls[i],b=balls[j];if(a.held||b.held)continue;
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r;if(d>=min)continue;
    const nx=d>0?dx/d:1,ny=d>0?dy/d:0,over=(min-d)/2;
    a.x-=nx*over;a.y-=ny*over;b.x+=nx*over;b.y+=ny*over;
    const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(relative>=0)continue;
    const impulse=-relative*.9;a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;
    if(impulse>42&&time-a.hitAt>.15){a.hitAt=time;hit(a,impulse);}
  }
}
function validPattern(value){return value&&Array.isArray(value.notes)&&value.notes.length<=240&&Number.isFinite(value.duration)&&value.duration>0&&value.duration<=20&&value.notes.every(n=>n&&Number.isFinite(n.t)&&n.t>=0&&n.t<=value.duration&&Number.isInteger(n.note)&&n.note>=0&&n.note<5&&Number.isFinite(n.gain)&&n.gain>=0&&n.gain<=1)&&value.notes.every((n,i)=>i===0||n.t>=value.notes[i-1].t);}
const api={create,advance,clamp,validPattern};if(typeof module!=='undefined')module.exports=api;else root.MotionPhysics=api;
})(typeof window==='undefined'?globalThis:window);
