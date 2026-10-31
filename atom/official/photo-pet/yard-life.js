/* Visual schedules only: no inventory, jobs or persistent state are mutated here. */
(function(root){'use strict';
function create({domain,layout}){
const clamp=v=>Math.max(0,Math.min(1,v));
function between(a,b,t){const q=clamp(t);return{x:a.x+(b.x-a.x)*q,y:a.y+(b.y-a.y)*q,left:b.x<a.x}}
const beds=layout.beds,home=layout.residents.gardener;
function legacyGardener(t){
 const move=(from,to,start,end)=>({...between(from,to,(t-start)/(end-start)),frame:1+Math.floor(t*5)%2,stage:'walk'});
 if(t<2)return move(home,{x:270,y:212},0,2);
 if(t<6)return move({x:270,y:212},{x:beds[0],y:228},2,6);
 for(let i=0;i<4;i++){const start=6+i*5;if(t<start+3)return{x:beds[i],y:228,frame:t-start<.5?3:4,stage:'water',plot:i};if(i<3&&t<start+5)return move({x:beds[i],y:228},{x:beds[i+1],y:228},start+3,start+5)}
 if(t<32)return{x:beds[3],y:228,frame:0,stage:'inspect'};
 for(let i=0;i<4;i++){const start=32+i*5,index=3-i;if(t<start+3)return{x:beds[index],y:228,frame:5,stage:'harvest',plot:index};if(i<3&&t<start+5)return move({x:beds[index],y:228},{x:beds[index-1],y:228},start+3,start+5)}
 if(t<54)return move({x:beds[0],y:228},{x:270,y:212},50,54);
 if(t<58)return move({x:270,y:212},home,54,58);
 return{...home,frame:5,stage:'deliver'};
}
function gardener(s,t){
 const at=i=>({x:beds[i],y:layout.workY}),gate=layout.gate,corner=layout.corner;
 const move=(a,b,start,end)=>({...between(a,b,(t-start)/(end-start)),frame:1+Math.floor(t*5)%2,stage:'walk',carrying:t>=44&&t<69?'pouch':t>=69&&t<86?'none':'can'});
 const work=(i,stage,start,end)=>({...at(i),frame:stage==='water'?4:5,stage,plot:i,eventProgress:clamp((t-start)/(end-start)),eventTime:Math.max(0,t-start)});
 if(t<2)return move(home,gate,0,2);
 if(t<4)return move(gate,corner,2,4);
 if(t<11)return move(corner,at(0),4,11);
 for(let i=0;i<4;i++){
  const b=domain.CARE.beds[i];
  if(t<b.waterStart)return work(i,s.plots[i]?'inspect':'sow',b.arrive,b.waterStart);
  if(t<b.waterEnd)return work(i,s.plots[i]?.watered?'inspect':'water',b.waterStart,b.waterEnd);
  if(i<3&&t<domain.CARE.beds[i+1].arrive)return move(at(i),at(i+1),b.waterEnd,domain.CARE.beds[i+1].arrive);
 }
 for(let i=3;i>=0;i--){const b=domain.CARE.beds[i];
  if(t<b.fertilized)return work(i,'fertilize',b.fertilizeStart,b.fertilized);
  if(t<b.fertilizeEnd)return{...work(i,'inspect',b.fertilized,b.fertilizeEnd),carrying:'pouch'};
  if(i>0&&t<domain.CARE.beds[i-1].fertilizeStart)return move(at(i),at(i-1),b.fertilizeEnd,domain.CARE.beds[i-1].fertilizeStart);
 }
 for(let i=0;i<4;i++){const b=domain.CARE.beds[i];
  if(t<b.harvested)return work(i,'harvest',b.harvestStart,b.harvested);
  if(i<3&&t<domain.CARE.beds[i+1].harvestStart)return move(at(i),at(i+1),b.harvested,domain.CARE.beds[i+1].harvestStart);
 }
 if(t<88)return move(at(3),corner,86,88);
 if(t<91)return move(corner,gate,88,91);
 if(t<94)return move(gate,home,91,94);
 return{...home,frame:5,stage:'deliver'};
}
// Daily activity has no effect on rewards. Unclaimed jobs must not freeze residents.
function daily(r,clock){
 if(r.id==='smith'&&r.phase==='ready')return{frame:Math.floor(clock)%3===0?0:Math.floor(clock)%3===1?3:5,stage:'polish'};
 if(r.id==='smith'){const t=clock%7.2,beat=t%2.4;if(t>5.9)return{frame:0,stage:'rest'};return{frame:beat<.5?5:beat<1.05?3:beat<1.25?4:5,stage:beat>=1.05&&beat<1.25?'daily-strike':'maintain'}}
 if(r.id==='gardener'){const t=clock%32;return{frame:t<24?0:5,stage:t<24?'rest':'inspect',eventProgress:clamp((t-24)/8)}}
 const t=(clock+1.1)%7.8;return{frame:t<.8?3:t<1.6?4:t<4.5?5:t<5.3?3:5,stage:t<1.6?'check-line':t<4.5?'daily-fish':t<5.3?'check-line':'daily-fish'};
}
function plannedNpc(r,s,now,clock,ambient,motion){r={...r,...layout.residents[r.id]};const j=s.jobs[r.id],phase=domain.jobPhase(s,r.id,now),base={...r,frame:0,left:false,stage:'idle',phase};
 if(phase==='working'){
  const seconds=clamp((now-j.started)/(j.until-j.started));
  // A stable representative pose when animation is disabled, while real task timers continue.
  const p=seconds;
  if(r.id==='gardener'){
   const work=j.care===1?gardener(s,seconds*96):legacyGardener(p*60);
   // Task state still advances with wall time; reduced motion never animates a route.
   if(j.care===1&&!motion)Object.assign(work,{x:r.x,y:r.y,left:false,eventTime:0,eventProgress:.5});
   return{...base,...work,progress:seconds,care:j.care};
  }
  if(r.id==='smith'){
   const t=p*35;if(t<3)return{...base,...between(r,{x:85,y:146},t/3),frame:1+Math.floor(clock*5)%2,stage:'walk'};
   if(t<6)return{...base,x:85,y:146,frame:5,stage:'heat'};
   if(t<9)return{...base,...between({x:85,y:146},r,(t-6)/3),frame:1+Math.floor(clock*5)%2,stage:'walk'};
   if(t<28){const beat=(t-9)%1.5;return{...base,frame:beat<.65?3:beat<.82?4:5,stage:beat>=.65&&beat<.82?'strike':'forge'}}
   return{...base,frame:t<32?5:0,stage:t<32?'polish':'deliver'};
  }
  const t=p*30;return{...base,frame:t<.6?3:t<1.4?4:t<21?5:t<26?3:0,stage:t<1.4?'cast':t<21?'wait':t<26?'reel':t<29?'catch':'deliver',eventTime:t,catchProgress:clamp((t-26)/3)};
 }
 return motion?{...base,...daily({...r,phase},clock)}:{...base,stage:phase==='ready'?'ready':'idle'};
}
function petPlan(elapsed,id){const cycle=Math.floor(elapsed/16),t=elapsed%16,points=[72,302,174,340];const trick={dog:'wag',cat:'stretch',rabbit:'hop',lion:'shy',tiger:'pounce',bear:'wave'}[id];return{x:points[cycle%points.length],mode:t<7?'walk':t<10?'nibble':t<13?trick:'idle',time:t<10?t-7:t-10}}
function npc(r,s,now,clock,ambient,motion){
 const n=plannedNpc(r,s,now,clock,ambient,motion);
 if(!motion&&n.phase==='working')return{...n,...layout.residents[r.id],left:false,eventTime:0,eventProgress:.5};
 return n;
}
return{npc,petPlan};
}
root.YardLife={create};if(typeof module!=='undefined')module.exports=root.YardLife;
})(globalThis);
