/* All views share paws, palette, ears, facial markings and accessories. */
(function(root){'use strict';
function create(canvas,{pose:petPose}){const screen=canvas.getContext('2d'),sprite=document.createElement('canvas');sprite.width=96;sprite.height=96;let c=screen,pal;screen.imageSmoothingEnabled=false;
function r(x,y,w,h,col){c.fillStyle=pal[col]||col;c.fillRect(Math.round(x),Math.round(y),w,h)}
function poly(points,col){const min=Math.floor(Math.min(...points.map(p=>p[1]))),max=Math.ceil(Math.max(...points.map(p=>p[1])));for(let y=min;y<max;y++){const hits=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a[1]>y+.5)!==(b[1]>y+.5))hits.push(a[0]+(y+.5-a[1])*(b[0]-a[0])/(b[1]-a[1]))}hits.sort((a,b)=>a-b);for(let i=0;i<hits.length;i+=2)r(Math.ceil(hits[i]),y,Math.ceil(hits[i+1])-Math.ceil(hits[i]),1,col)}}
function box(x,y,w,h,col){r(x,y,w,h,'o');r(x+1,y+1,w-2,h-2,col)}
function paw(x,sole,far=false){const top=sole-6;poly([[x-4,top],[x+3,top],[x+5,top+2],[x+5,sole],[x-5,sole],[x-5,top+2]],'o');r(x-3,top+1,6,1,far?'f':'h');r(x-4,top+2,8,3,far?'s':'l');r(x-1,sole-2,1,1,'s');r(x+2,sole-2,1,1,'s')}
function ear(x,y,type){c.save();c.translate(x,y);
 if(type==='drop'){poly([[0,0],[-4,4],[-6,13],[-5,23],[-2,28],[4,29],[8,24],[10,12],[8,4]],'o');poly([[1,2],[-2,5],[-4,13],[-3,22],[0,26],[4,27],[6,23],[8,12],[6,5]],'s');r(-1,8,2,13,'f');r(2,6,2,7,'l')}
 else if(type==='point'){poly([[-5,11],[-4,-6],[0,-10],[12,5],[11,15]],'o');poly([[-3,9],[-2,-5],[0,-7],[9,5],[8,11]],'f');poly([[0,6],[0,-2],[6,6]],'p')}
 else if(type==='long'){poly([[-3,12],[-4,-11],[-2,-18],[3,-20],[7,-16],[9,12]],'o');poly([[-1,11],[-2,-10],[0,-16],[3,-18],[5,-14],[7,11]],'l');poly([[1,8],[0,-10],[2,-14],[4,-10],[5,8]],'p')}
 else{poly([[-5,9],[-6,0],[-2,-5],[5,-5],[10,0],[10,9]],'o');poly([[-3,8],[-4,1],[-1,-3],[4,-3],[8,1],[8,8]],'f');box(-1,0,6,6,'s')}
 c.restore()}
function mane(side){poly(side?[[22,10],[27,3],[39,0],[52,2],[61,10],[65,20],[63,33],[57,45],[44,49],[29,46],[19,38],[16,24]]:[[-2,10],[5,3],[16,0],[29,-1],[43,2],[53,9],[59,22],[57,35],[49,45],[33,49],[16,47],[3,41],[-5,28]],'o');poly(side?[[24,11],[29,5],[40,2],[51,4],[59,11],[63,21],[61,33],[55,43],[44,47],[30,44],[21,37],[18,24]]:[[0,11],[7,5],[17,2],[29,1],[42,4],[51,11],[57,23],[55,34],[47,43],[33,47],[17,45],[5,39],[-3,28]],'s');for(const [x,y] of (side?[[22,20],[26,35],[56,36]]:[[0,21],[6,36],[49,36]]))r(x,y,3,5,'f')}
function face(pet,side,closed,happy,sleeping=false,expression=0){
 if(pet.id==='lion')mane(side);
 if(side){
  if(pet.ear!=='drop')ear(48,12,pet.ear);
  poly([[27,11],[32,6],[39,4],[42,2],[45,4],[51,5],[57,9],[60,15],[60,25],[67,27],[70,31],[68,36],[61,38],[56,42],[46,44],[36,41],[29,35],[25,24]],'o');
  poly([[29,12],[33,8],[40,6],[43,4],[45,6],[50,7],[55,11],[58,16],[58,27],[65,29],[68,31],[66,34],[60,36],[55,40],[46,42],[37,39],[31,34],[27,24]],'l');
  poly([[34,10],[40,7],[45,9],[50,8],[55,13],[49,12],[45,15],[40,12],[33,15]],'h');
  ear(27,13,pet.ear);r(46,19,7,1,'s');
  if(closed||happy)r(47,24,6,1,'n');else{box(47,21,6,7,'n');r(48,22,2,2,'#fff7dd')}
  poly([[55,28],[62,27],[67,29],[68,33],[64,36],[57,37],[53,34]],'h');box(64,28,6,4,pet.id==='rabbit'?'p':'n');r(65,32,1,3,'o');r(58,35,7,1,'o');
  if(pet.id==='rabbit'){r(61,36,3,3,'#fff');r(62,36,1,3,'s')}
  if(pet.id==='cat'||pet.id==='tiger'){r(53,31,4,1,'s');r(53,34,3,1,'s')}
  if(pet.id==='tiger'){poly([[34,8],[38,7],[39,16],[36,14]],'o');poly([[45,7],[49,9],[47,16]],'o');poly([[36,29],[42,31],[36,33]],'o')}
  if(pet.id==='cat'){r(39,9,2,6,'f');r(43,10,2,5,'f')}
  if(!sleeping){r(36,42,22,3,'accent');box(52,44,6,6,'h');r(54,46,2,2,'s')}
 }else{
  if(pet.ear!=='drop'){ear(9,12,pet.ear);ear(40,12,pet.ear)}
  poly([[11,10],[17,5],[23,4],[26,2],[29,4],[36,4],[43,8],[48,15],[48,31],[43,39],[34,43],[23,43],[13,39],[8,30],[7,19]],'o');
  poly([[12,12],[18,7],[24,6],[27,4],[29,6],[35,6],[41,10],[46,16],[46,30],[41,37],[34,41],[24,41],[15,37],[10,29],[9,20]],'l');
  poly([[18,9],[23,7],[30,8],[35,7],[40,12],[34,11],[30,14],[26,11],[19,13]],'h');
  if(pet.ear==='drop'){ear(6,13,'drop');ear(47,13,'drop')}
  for(const x of [18,33]){r(x,19,6,1,'s');if(closed||happy){r(x,24,6,1,'n');if(happy)r(x+1,23,4,1,'n')}else{box(x,21,6,7,'n');r(x+1,22,2,2,'#fff7dd')}}
  poly([[22,28],[27,26],[31,26],[36,29],[39,33],[37,37],[32,39],[25,39],[19,36],[19,32]],'h');
  poly([[25,28],[32,28],[33,30],[30,33],[27,33],[24,30]],pet.id==='rabbit'?'p':'n');r(28,33,1,3,'o');r(24,36,4,1,'o');r(29,36,5,1,'o');
  if(expression>.25){box(24,34,11,9,'n');r(26,35,7,2,'h');r(27,40,5,2,'p')}
  if(happy&&pet.id!=='rabbit'){r(27,36,5,5,'p');r(28,41,3,1,'p')}
  if(pet.id==='rabbit'){box(26,36,6,5,'#fff');r(29,37,1,3,'s')}
  if(pet.id==='cat'||pet.id==='tiger'){for(const x of [13,39]){r(x,30,5,1,'s');r(x,33,4,1,'s')}}
  if(pet.id==='tiger'){poly([[24,6],[28,5],[28,15],[25,13]],'o');poly([[33,6],[36,7],[34,15]],'o');poly([[12,28],[18,30],[13,32]],'o');poly([[44,28],[38,30],[43,32]],'o')}
  if(pet.id==='cat'){r(24,8,2,6,'f');r(29,7,2,7,'f');r(34,9,2,5,'f')}
  if(!sleeping){r(16,42,26,3,'accent');box(27,44,6,6,'h');r(29,46,2,2,'s')}
 }
}
function tail(pet,side,phase){c.save();if(side){c.translate(65,0);c.scale(-1,1)}
 const w=Math.round(Math.sin(phase)*2);
 if(pet.tail==='pom'){box(48,48,11,10,'h');r(50,47,6,1,'o')}
 else{poly([[46,51],[54,47],[59,40+w],[60,32+w],[64,28+w],[67,30+w],[66,42+w],[61,50],[53,55],[46,55]],'o');poly([[48,51],[54,49],[61,40+w],[62,33+w],[64,31+w],[64,41+w],[59,48],[53,53],[48,53]],'f');r(62,33+w,2,6,'l');if(pet.tail==='tuft')box(60,29+w,8,8,'s');if(pet.tail==='stripe'){r(60,39+w,5,2,'o');r(56,46,5,2,'o')}if(pet.tail==='curl'){box(60,28+w,7,6,'l')}}
 c.restore()}
function body(pet,side,base,weight){c.save();c.translate(0,weight);
 if(side){poly([[17,39],[24,35],[38,35],[47,37],[53,43],[54,52],[50,59],[20,59],[14,54],[12,46]],'o');poly([[19,40],[25,37],[37,37],[46,39],[51,44],[52,51],[48,57],[21,57],[16,53],[14,46]],'f');poly([[39,44],[50,43],[51,49],[48,49],[49,53],[45,52],[43,57],[40,54],[36,55],[38,49]],'h')}
 else{poly([[15,33],[39,33],[46,40],[50,base-8],[47,base],[12,base],[9,base-8],[10,43]],'o');poly([[16,35],[38,35],[44,41],[47,base-8],[44,base-2],[14,base-2],[12,base-8],[13,44]],'f');poly([[20,38],[35,38],[38,46],[34,48],[35,52],[31,51],[28,56],[24,53],[21,54],[22,48],[18,45]],'h')}
 if(pet.id==='tiger'){for(const x of (side?[20,28,35]:[13,40]))poly([[x,43],[x+4,42],[x+2,50],[x,49]],'o')}
 if(pet.id==='cat'){r(side?20:13,46,3,4,'s');r(side?28:42,49,3,3,'s')}
 c.restore()}
function leg(f){const width=3,top=f.sole-6;poly([[f.root-width,51],[f.root+width,51],[f.kneeX+width,f.kneeY],[f.x+width,top+1],[f.x-width,top+1],[f.kneeX-width,f.kneeY]],'o');poly([[f.root-2,52],[f.root+2,52],[f.kneeX+2,f.kneeY],[f.x+2,top+1],[f.x-2,top+1],[f.kneeX-2,f.kneeY]],f.far?'s':'l');paw(f.x,f.sole,f.far)}
function garden(clock,moving){
 r(0,0,240,180,'#e8edda');r(0,48,240,56,'#d6e3bf');
 // Layered canopy, distant fence and a warm little house.
 poly([[0,47],[16,39],[38,42],[56,34],[77,43],[94,38],[116,46],[143,36],[166,42],[190,34],[217,40],[240,32],[240,105],[0,105]],'#b9cda2');
 r(0,103,240,77,'#c7d7aa');r(0,143,240,37,'#b3c78f');
 for(let x=5;x<240;x+=15){r(x,91,4,22,'#e8dfbb');r(x+1,89,2,2,'#e8dfbb');r(x,108,4,2,'#c8bc94')}r(0,98,240,3,'#eee5c7');
 // Home at left: roof, doorway and doorstep, all on the pixel grid.
 r(12,89,43,39,'#ac7955');r(15,91,37,34,'#dfb57b');poly([[8,91],[31,70],[59,91]],'#715749');poly([[13,89],[31,74],[54,89]],'#bf805d');
 r(25,102,16,23,'#705543');r(28,99,10,3,'#705543');r(23,124,20,4,'#b98a5e');r(17,94,7,2,'#f0cca0');r(45,103,4,9,'#b98a5e');
 // Tree and shaded ground at right, away from the actor's movement lane.
 r(213,56,8,68,'#997950');r(215,66,3,55,'#b39160');poly([[219,84],[228,75],[229,80],[220,91]],'#997950');
 poly([[187,41],[193,30],[211,25],[231,30],[240,42],[240,68],[227,78],[204,76],[188,65]],'#79996f');
 poly([[187,42],[198,30],[213,29],[227,32],[236,43],[231,56],[212,63],[195,59]],'#9ab786');
 r(202,34,9,3,'#bdd19b');r(190,45,7,3,'#bdd19b');r(222,47,5,3,'#aec792');
 poly([[0,164],[45,151],[74,154],[100,168],[133,180],[0,180]],'#d9cfaa');r(10,168,15,2,'#c4b992');r(59,159,9,2,'#c4b992');
 for(const [x,y] of [[11,139],[42,151],[205,140],[230,158],[62,132],[177,159]]){r(x,y,1,4,'#789260');r(x-2,y-1,2,1,'#789260');r(x+1,y-2,2,1,'#789260')}
 for(const [x,y] of [[58,113],[19,150],[224,131],[188,164]]){r(x,y,1,5,'#81996e');r(x-2,y-2,5,3,'#fff0c5');r(x,y-1,1,1,'#dcaa58')}
 r(181,147,18,3,'#9baf7c');box(183,143,14,4,'#e4d5b0');r(185,144,10,1,'#92b4af');
 const drift=moving?Math.floor(clock/5)%8:0;r(65+drift,27,24,2,'#f9f8e9');r(70+drift,24,12,3,'#f9f8e9');
}
function object(prop,x,y,pose){if(!prop)return;let px=prop.x,py=prop.y;
 if(prop.held){const side=pose.side;px=x+(side?(pose.flip?12:96):46);py=y+(prop.type==='carrot'?75:side?60:63)}
 if(prop.type==='ball'){poly([[px-3,py-6],[px+3,py-6],[px+5,py-3],[px+4,py],[px-4,py],[px-5,py-3]],'#98634e');r(px-3,py-5,6,4,'#dc9a6c');r(px-1,py-5,2,5,'#f5d69c')}
 if(prop.type==='teaser'){r(221,92,2,22,'#8c6c52');r(px,113,Math.max(1,222-px),1,'#8c6c52');r(px,113,1,Math.max(1,py-113),'#8c6c52');poly([[px,py],[px-4,py+3],[px,py+9],[px+3,py+3]],'#aa7d91');r(px,py+2,1,5,'#e2bac5')}
 if(prop.type==='carrot'){const bite=prop.bites||0;if(bite>=3){r(px+1,py,1,1,'#d78744');return}poly([[px-3,py-9],[px+4,py-8],[px+2,py-3-bite],[px,py-bite*2]],'#d78744');r(px-1,py-8,2,3,'#efaf62');r(px-1,py-12,2,4,'#6e8c59');r(px+2,py-11,3,1,'#6e8c59')}
 if(prop.type==='leaf'){poly([[px-4,py],[px-1,py-5],[px+5,py-7],[px+4,py-1],[px,py+2]],'#c89955');r(px,py-3,1,4,'#916d45')}
}
function render(pet,mode,time,moving,clock=time,scene={}){pal={...pet,n:'#342d2a',p:'#df9290'};const p=petPose(mode,time,moving);c=screen;if(!scene.spriteOnly){c.clearRect(0,0,240,180);garden(clock,moving);}
 const x=75+Math.round(p.x+(scene.extraX||0)),y=23,lift=pet.id==='rabbit'?p.lift*.7:p.lift;
 if(!scene.spriteOnly)r(x+22+lift*.25,131,48-Math.round(lift*.5),3,'#93ad79');
 c=sprite.getContext('2d');c.clearRect(0,0,96,96);c.save();c.translate(8,18);
 const blink=moving&&clock%4.8>4.62,happy=mode==='hello'||mode==='wag';
 if(mode==='stretch'){
 const bend=Math.round((p.stretch||0)*12);tail(pet,true,0);
 leg({root:22,x:20,sole:68,kneeX:21,kneeY:58,far:false});
 // Both forepaws remain planted; shoulders and head lower between them.
 for(const fx of [54,65]){poly([[44,46+bend/2],[49,47+bend/2],[fx+2,62],[fx+2,65],[fx-2,65],[43,52+bend/2]],'o');poly([[45,48+bend/2],[48,49+bend/2],[fx,63],[fx-1,63]],'l');paw(fx,68,fx===54)}
 poly([[17,38],[25,36],[36,40],[49,44+bend],[49,53+bend/2],[24,57],[14,50]],'o');
 poly([[18,40],[25,38],[35,42],[47,45+bend],[47,51+bend/2],[24,55],[16,49]],'f');r(21,43,3,5,'s');
 c.save();c.translate(4,bend);face(pet,true,true,false);c.restore();
 }else if(p.side){c.save();if(p.flip){c.translate(72,0);c.scale(-1,1)}tail(pet,true,moving?clock*6:0);p.feet.forEach(leg);body(pet,true,68,p.bob);c.save();c.translate(0,p.bob);face(pet,true,blink,false);c.restore();c.restore()}
 else if(mode==='sleep'){tail(pet,false,0);poly([[24,45],[52,44],[64,49],[68,58],[65,65],[26,65],[20,56]],'o');poly([[26,47],[51,46],[62,51],[66,58],[63,63],[28,63],[22,56]],'f');r(53,49,6,2,'l');paw(45,68);paw(57,68);c.save();c.translate(0,pet.id==='lion'?18:22);face(pet,false,true,false,true);c.restore()}
 else{tail(pet,false,moving?clock*(happy?11:4):0);const base=68-p.tuck;
 // Feet use the same unscaled shape in every state; only position changes.
 paw(19-Math.round(p.tuck/3),base);paw(40+Math.round(p.tuck/3),base);
 body(pet,false,base-6-p.crouch,p.crouch);c.save();c.translate(0,p.crouch+(moving?Math.round(Math.sin(clock*2)*.5):0));face(pet,false,blink||mode==='roar'||mode==='shy'||mode==='nibble',happy,false,p.roar||0);c.restore();
 if(mode==='hug'){
 // Toy sits in front of the chest; connected arms wrap around it.
 box(22,49,16,13,'s');box(21,47,5,5,'l');box(34,47,5,5,'l');box(24,48,12,10,'l');r(27,51,1,2,'n');r(32,51,1,2,'n');r(29,54,2,1,'n');
 poly([[13,49],[17,48],[25,55],[24,59],[18,57]],'o');poly([[15,50],[17,50],[23,55],[22,57],[18,55]],'l');
 poly([[43,49],[39,48],[32,55],[33,59],[39,57]],'o');poly([[41,50],[39,50],[34,55],[35,57],[39,55]],'l');
 }
 if(mode==='wave'){
 const amount=p.wave||0,py=Math.round(60-22*amount+(moving?Math.sin(clock*9)*amount:0));
 // A connected forearm outside the face silhouette, ending in the shared paw.
 poly([[43,47],[47,46],[55,py+2],[59,py+2],[58,py+8],[49,54],[44,53]],'o');
 poly([[45,48],[47,48],[55,py+4],[56,py+5],[48,52],[45,51]],'l');paw(56,py+5);r(54,py+1,4,2,'s');
 }
 if(happy){poly([[60,7],[63,7],[65,9],[67,7],[70,7],[71,11],[65,17],[59,11]],'p')}}
 c.restore();if(scene.spriteOnly)return p;c=screen;screen.imageSmoothingEnabled=false;c.drawImage(sprite,0,0,96,96,x,Math.round(y-lift),120,120);
 object(scene.prop||(pet.id==='dog'?{type:'ball',x:162,y:131}:null),x,Math.round(y-lift),p);canvas.dataset.pet=pet.id;canvas.dataset.mode=mode;canvas.dataset.pose=p.side?'side':'front';return p;
}
return {render,portrait:()=>sprite};}
root.PixelPetRenderer={create};
})(globalThis);
