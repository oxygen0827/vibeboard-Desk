/* Shared character identity and bounded pose geometry; no runtime dependencies. */
(function(root){'use strict';
const pets=[
 {id:'dog',name:'金豆',kind:'小狗',ear:'drop',tail:'fluffy',o:'#684b32',f:'#d9a34f',l:'#f1c979',h:'#ffe3a0',s:'#b87a39',accent:'#697f72'},
 {id:'cat',name:'奶橘',kind:'小猫',ear:'point',tail:'curl',o:'#665042',f:'#db996b',l:'#f3c99a',h:'#fff0d8',s:'#b4714b',accent:'#769ca6'},
 {id:'rabbit',name:'糯米',kind:'小兔',ear:'long',tail:'pom',o:'#85756d',f:'#d9cdc2',l:'#f5ece3',h:'#fff8ef',s:'#b7a69c',accent:'#b68899'},
 {id:'lion',name:'团团',kind:'小狮子',ear:'round',tail:'tuft',o:'#624537',f:'#ce8b41',l:'#efbf69',h:'#ffe4a4',s:'#a36434',accent:'#8c9b70'},
 {id:'tiger',name:'虎宝',kind:'小老虎',ear:'round',tail:'stripe',o:'#594335',f:'#df953c',l:'#ffc46c',h:'#fff0cc',s:'#a96b35',accent:'#71928d'},
 {id:'bear',name:'可可',kind:'小熊',ear:'round',tail:'pom',o:'#59443c',f:'#997058',l:'#c69b7c',h:'#e5c6a0',s:'#785440',accent:'#8e9dac'}
];
const tricks={dog:{mode:'wag',label:'摇尾巴'},cat:{mode:'stretch',label:'伸懒腰'},rabbit:{mode:'hop',label:'蹦蹦跳'},lion:{mode:'roar',label:'张嘴小吼'},tiger:{mode:'pounce',label:'扑一扑'},bear:{mode:'wave',label:'招招手'}};
for(const p of pets)p.trick=tricks[p.id];
const durations={hello:2.4,walk:4,jump:1.2,wag:2.4,stretch:3,hop:2.7,roar:2,wave:2.4,pounce:3,nibble:3,shy:3,hug:4};
function pose(mode,time,moving=true){const t=moving?Math.max(0,time):0,p={mode,t,lift:0,crouch:0,tuck:0,x:0,side:false,flip:false,bob:0,feet:[]};
 if(mode==='jump'&&moving){if(t<.2)p.crouch=Math.round(3*Math.sin(t/.2*Math.PI/2));else if(t<.85){const a=(t-.2)/.65;p.lift=14*4*a*(1-a);p.tuck=Math.round(5*Math.sin(a*Math.PI))}else if(t<1.2){const a=(t-.85)/.35;p.crouch=Math.round(3*Math.sin(a*Math.PI)*(1-a))}}
 if(mode==='walk'){
  p.side=!moving||(t>=.25&&t<1.75)||(t>=2.25&&t<3.75);p.flip=t>=2;
  const segment=t<2?Math.max(0,Math.min(1.5,t-.25)):Math.max(0,Math.min(1.5,t-2.25));
  p.x=moving?(t<2?segment*15:(1.5-segment)*15):0;
  const phase=moving?segment/1.2:0;
  p.bob=moving?Math.round(.5-.5*Math.cos(phase*Math.PI*4)):0;
  p.feet=[{root:23,phase:.5,far:true},{root:45,phase:.75,far:true},{root:24,phase:0,far:false},{root:46,phase:.25,far:false}].map(v=>{
   const cycle=(phase+v.phase)%1,stance=cycle<.625,a=stance?cycle/.625:(cycle-.625)/.375;
   const dx=moving?Math.round(stance?4.5-9*a:-4.5+9*a):0,up=moving&&!stance?Math.round(3*Math.sin(a*Math.PI)):0;
   const sole=(v.far?66:68)-up;
   return {...v,x:v.root+dx,sole,kneeX:v.root+Math.round(dx/3),kneeY:Math.min(58,sole-9),contact:up===0};
  });
 }
 if(mode==='hop'&&moving){const local=t% .9;if(t<2.7){if(local<.16)p.crouch=Math.round(3*Math.sin(local/.16*Math.PI/2));else if(local<.68){const a=(local-.16)/.52;p.lift=12*4*a*(1-a);p.tuck=Math.round(4*Math.sin(a*Math.PI))}else p.crouch=Math.round(2*Math.sin((local-.68)/.22*Math.PI))}}
 if(mode==='shy')p.crouch=moving?Math.min(2,Math.round(t*4)):2;
 if(mode==='stretch')p.stretch=moving?Math.max(0,Math.min(1,t/.6,(3-t)/.6)):1;
 if(mode==='wave')p.wave=moving?Math.max(0,Math.min(1,t/.4,(2.4-t)/.4)):1;
 if(mode==='roar')p.roar=moving?Math.max(0,Math.min(1,t/.35,(2-t)/.4)):1;
 if(mode==='pounce'){
  p.side=true;const a=Math.max(0,Math.min(1,(t-.5)/.7));
  if(moving){p.crouch=t<.5?Math.round(3*t/.5):t<1.2?0:Math.round(2*Math.max(0,1-(t-1.2)/.35));p.lift=t>=.5&&t<1.2?10*4*a*(1-a):0;p.x=t<.5?0:t<1.2?22*a:22*Math.max(0,1-(t-1.2)/1.2)}
  if(moving&&t>=1.2){const back=pose('walk',.25+Math.max(0,t-1.45),true);p.side=t>=1.45&&t<2.75;p.flip=true;p.x=t<1.45?22:Math.max(0,22*(1-(t-1.45)/1.3));p.bob=back.bob;p.feet=back.feet;return p}
  p.bob=p.crouch;p.feet=[{root:23,far:true},{root:45,far:true},{root:24,far:false},{root:46,far:false}].map(v=>{const reach=moving&&p.lift>1?Math.round(5*Math.sin(a*Math.PI))*(v.root>30?1:-1):0,sole=(v.far?66:68)-(p.lift>1?3:0);return {...v,x:v.root+reach,sole,kneeX:v.root,kneeY:Math.min(58,sole-9),contact:p.lift===0}});
 }
 return p;
}
const api={pets,pose,durations,tricks};if(typeof module!=='undefined')module.exports=api;else root.PixelPets=api;
})(globalThis);
