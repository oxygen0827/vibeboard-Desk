/* Deterministic story timelines: props and poses share the same local clock. */
(function(root){'use strict';
const labels={dog:'抛个球',cat:'逗逗猫',rabbit:'喂萝卜',lion:'打招呼',tiger:'玩落叶',bear:'抱玩偶'};
const duration={dog:6.5,cat:7.4,rabbit:8.9,lion:5,tiger:5.5,bear:5};
function story(pet,t){const s={mode:'idle',time:t,extraX:0,prop:null,text:pet.name+'在看着你',done:t>=duration[pet.id]};
 if(pet.id==='dog'){
  if(t<.7){s.prop={type:'ball',x:162+26*(t/.7),y:131-24*Math.sin(t/.7*Math.PI)};s.text='金豆盯住了小球'}
  else if(t<4.7){s.mode='walk';s.time=t-.7;s.prop=t<2.45?{type:'ball',x:188,y:131}:{type:'ball',held:true};s.text=t<2.45?'金豆跑去捡球':'叼回来啦'}
  else{const u=Math.min(1,(t-4.7)/.5);s.mode='wag';s.time=t-4.7;s.prop={type:'ball',x:121+41*u,y:86+45*u-8*Math.sin(u*Math.PI)};s.text='再抛一次？'}
 }else if(pet.id==='cat'){
  if(t<1){s.text='奶橘盯住了逗猫棒'}else if(t<4){s.mode='pounce';s.time=t-1;s.text=t<2.2?'扑到了吗？':'尾巴也跟着兴奋起来'}else{s.mode='stretch';s.time=t-4;s.text='玩累了，伸个懒腰'}
  s.prop={type:'teaser',x:185+Math.round(Math.sin(t*4)*6),y:116+Math.round(Math.sin(t*3)*4)};
 }else if(pet.id==='rabbit'){
  if(t<.5){s.prop={type:'carrot',x:138,y:131};s.text='糯米发现了胡萝卜'}
  else if(t<3.2){s.mode='hop';s.time=t-.5;const u=s.time/ .9,j=Math.min(2,Math.floor(u)),local=u-j;s.extraX=j*6+6*Math.max(0,Math.min(1,(local-.16/.9)/(.52/.9)));s.prop={type:'carrot',x:138,y:131};s.text='蹦、蹦、蹦'}
  else if(t>=6.2){s.mode='hop';s.time=t-6.2;const u=s.time/.9,j=Math.min(2,Math.floor(u)),local=u-j;s.extraX=18-(j*6+6*Math.max(0,Math.min(1,(local-.16/.9)/(.52/.9))));s.text='吃饱了，蹦回你身边'}
  else{s.extraX=18;s.mode='nibble';s.time=t-3.2;s.prop={type:'carrot',held:true,bites:Math.min(3,Math.floor((t-3.2)*1.2))};s.text='咔嚓，慢慢吃'}
 }else if(pet.id==='lion'){
  if(t<2){s.mode='roar';s.time=t;s.text='团团：看我的小狮吼！'}else{s.mode='shy';s.time=t-2;s.text='其实有一点点害羞'}
 }else if(pet.id==='tiger'){
  s.prop={type:'leaf',x:190+Math.round(Math.min(t,3)*6),y:130+Math.round(Math.sin(t*3)*7)};
  if(t>=.8&&t<3.8){s.mode='pounce';s.time=t-.8;s.text='虎宝伏低，准备出发'}else if(t>=3.8){s.mode='hello';s.time=t-3.8;s.text='差一点点，再来！'}else s.text='一片叶子飘过来了';
 }else if(pet.id==='bear'){
  s.mode=t<1.2?'wave':'hug';s.time=t<1.2?t:t-1.2;s.text=t<1.2?'可可向你挥挥爪':'抱紧自己的小玩偶';
 }
 return s;
}
function sequence(index,pet){return [{mode:'idle',duration:5},{mode:'walk',duration:4},{mode:'idle',duration:4},{mode:'story',duration:duration[pet.id]},{mode:'idle',duration:5},{mode:'sleep',duration:7},{mode:'idle',duration:3}][index%7]}
const api={labels,duration,story,sequence};if(typeof module!=='undefined')module.exports=api;else root.PetStories=api;
})(globalThis);
