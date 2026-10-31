(function(root){'use strict';
function create(canvas,{assets,createPetRenderer,petCatalog,createEnvironment,createRig,layout}){const c=canvas.getContext('2d'),off=document.createElement('canvas');off.width=240;off.height=180;const pets=createPetRenderer(off),images={},frames={},spriteCache={};let environment,rig;c.imageSmoothingEnabled=false;
const ready=Promise.all(Object.entries(assets).map(async([key,src])=>{const img=new Image();img.src=src;await img.decode();images[key]=img})).then(()=>{frames.npcs=slice(images.npcs,[0,315/887,598/887,1]);frames.keeper=slice(images.keeper,[0,1]);environment=createEnvironment(images.scene);rig=createRig((ctx,row,frame,x,y,height)=>sprite(ctx,'npcs',row,frame,x,y,height))});
function slice(img,rows){
 const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const ctx=cv.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,cv.width,cv.height).data,result=[];
 const opaque=(x,y)=>data[(y*cv.width+x)*4+3]>64;
 for(let row=0;row<rows.length-1;row++){const list=[];
  for(let col=0;col<6;col++){
   const x=Math.round(col*img.width/6),end=Math.round((col+1)*img.width/6),y=Math.round(rows[row]*img.height),bottom=Math.round(rows[row+1]*img.height);let top=bottom,foot=y;
   for(let yy=y;yy<bottom;yy++)for(let xx=x;xx<end;xx++)if(opaque(xx,yy)){top=Math.min(top,yy);foot=Math.max(foot,yy)}
   let heel=end,toe=x,tipX=x,spoutX=x,spoutY=top;
   // Isolated atlas specks are not feet: require a real vertical run in the contact band.
   for(let xx=x;xx<end;xx++){let count=0;for(let yy=Math.round(foot-(foot-top)*.09);yy<=foot;yy++)if(opaque(xx,yy))count++;if(count>=3){heel=Math.min(heel,xx);toe=Math.max(toe,xx)}}
   for(let yy=top;yy<top+5;yy++)for(let xx=x;xx<end;xx++)if(opaque(xx,yy))tipX=Math.max(tipX,xx);
   for(let yy=Math.round(top+(foot-top)*.35);yy<top+(foot-top)*.8;yy++)for(let xx=x;xx<end;xx++)if(opaque(xx,yy)&&xx>spoutX){spoutX=xx;spoutY=yy}
   list.push({x,y,w:end-x,h:bottom-y,top,foot,footX:(heel+toe)/2,tipX,spoutX,spoutY});
  }result.push(list);
 }return result;
}
function r(x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h)}
function sprite(ctx,key,row,frame,x,y,height,left=false,breath=0){
 if(!frames[key])return{};const f=frames[key][row][frame],base=frames[key][row][0],scale=height/(base.foot-base.top+1),id=[key,row,frame,height].join('/');
 let tile=spriteCache[id];if(!tile){const cv=document.createElement('canvas'),h=(f.foot-f.top+1)*scale;cv.width=Math.ceil(f.w*scale);cv.height=Math.ceil(h);const cc=cv.getContext('2d');cc.imageSmoothingEnabled=false;cc.drawImage(images[key],f.x,f.top,f.w,f.foot-f.top+1,0,0,f.w*scale,h);tile=spriteCache[id]={cv,x:Math.round((f.footX-f.x)*scale),y:Math.round((f.foot-f.top)*scale)}}
 ctx.save();ctx.translate(Math.round(x),Math.round(y));if(left)ctx.scale(-1,1);ctx.imageSmoothingEnabled=false;
 // A one-pixel upper-body breath leaves both feet and the lower legs planted.
 if(breath){const cut=Math.floor(tile.cv.height*.62);ctx.drawImage(tile.cv,0,0,tile.cv.width,cut,-tile.x,-tile.y-1,tile.cv.width,cut);ctx.drawImage(tile.cv,0,cut-1,tile.cv.width,tile.cv.height-cut+1,-tile.x,-tile.y+cut-1,tile.cv.width,tile.cv.height-cut+1)}else ctx.drawImage(tile.cv,-tile.x,-tile.y);
 ctx.restore();return{tipX:x+(f.tipX-f.footX)*scale,tipY:y+(f.top-f.foot)*scale,spoutX:x+(f.spoutX-f.footX)*scale,spoutY:y+(f.spoutY-f.foot)*scale};
}
function carrot(x,y){r(x-3,y-8,6,6,'#e6a057');r(x-2,y-2,4,3,'#d47f3d');r(x-1,y-12,2,5,'#688f49');r(x+1,y-11,3,2,'#8dab58')}
function fish(x,y){r(x-5,y-2,8,4,'#9dc4c2');r(x-6,y-1,2,2,'#689698');r(x+3,y-3,3,6,'#6c9eaa');r(x-4,y-1,1,1,'#3b5960')}
function bucket(x,y,full){r(x-7,y-6,14,9,'#6c8075');r(x-6,y-8,12,3,'#b8c3a3');r(x-4,y-5,8,7,'#9aab91');r(x-7,y,14,1,'#4e6c63');if(full){fish(x-1,y-7);fish(x+1,y-11)}}
function basket(x,y,full){r(x-12,y-7,24,12,'#8b633e');r(x-10,y-5,20,8,'#c79b62');for(let k=0;k<4;k++)r(x-9+k*5,y-5,1,8,'#9b7349');r(x-12,y-8,24,2,'#e2ba7e');if(full){carrot(x-6,y-7);carrot(x+1,y-9);carrot(x+7,y-6)}}
function tool(x,y){r(x-1,y-9,2,15,'#bc8c57');r(x-6,y-11,12,3,'#b7c6c1');r(x-6,y-8,2,3,'#718e87');r(x+4,y-8,2,3,'#718e87')}
function ripple(x,y,t){const phase=t%3;c.strokeStyle='#c4dfd1';c.lineWidth=1;c.globalAlpha=(1-phase/3)*.65;c.beginPath();c.ellipse(x,y,3+phase*5,1+phase*2,0,0,Math.PI*2);c.stroke();c.globalAlpha=1}
function render(frame){
 const {actor:a,pet:p,time:t,motion,effect,residents}=frame;
 if(!environment)return [];
 environment.render(c,t,motion);
 // Harvested crops are in the visible basket while waiting for the user's claim.
 for(const plot of frame.plots){
  const {x,stage:phase,age}=plot;
  if(phase==='empty'||plot.harvested)continue;
  if(plot.watered){for(let k=0;k<5;k++)r(x-24+k*10,268+(k%2)*2,8,2,'#59492f')}
  if(plot.fertilized){for(let k=0;k<9;k++)r(x-23+(k*19)%47,253+(k*7)%17,2,1,k%2?'#ac8e57':'#bbaa6b')}
  for(const dx of [-14,11]){const y=263;r(x+dx,y-5-age*3,2,9+age*3,'#426f3f');r(x+dx-5,y-8-age*3,6,3,'#7aa44d');r(x+dx+2,y-10-age*3,7,3,'#93b45c');r(x+dx-3,y-4-age*3,4,2,'#527b40');if(age===3){r(x+dx-3,y-2,8,8,'#d67c3b');r(x+dx-1,y-1,3,4,'#f3b666')}}
 }
 if(frame.parkedCan)rig.parkCan(c,292,279);

 if(frame.flowers)for(let x=24;x<350;x+=22){r(x,288,1,5,'#719448');r(x-2,286,5,3,'#f9dba5');r(x,287,1,1,'#cf8563')}
 const pet=petCatalog.find(v=>v.id===frame.petId),eat=effect?.kind==='feed'&&t-effect.at<2.5;
 const ambientMode=p.ambientMode&&p.ambientMode!=='walk'?p.ambientMode:null,mode=eat?'nibble':p.walk?'walk':ambientMode||'idle';
 const pose=pets.render(pet,mode,p.walk?.5+(p.distance%24)/24:ambientMode?p.ambientTime:t,motion,t,{spriteOnly:true});
 const actors=residents.map(n=>({y:n.y,draw(){
  const attachment=rig.draw(c,n,t,motion);
  if(['water','tend-flowers'].includes(n.stage)&&motion&&attachment.pour>.55){const x=n.stage==='water'?56+n.plot*76:306,y=n.stage==='water'?258:151;for(let i=0;i<6;i++){const q=(t*1.7+i/6)%1;r(attachment.spoutX+(x-attachment.spoutX)*q,attachment.spoutY+(y-attachment.spoutY)*q*q,1,2,'#c9ece0')}}
  if(['sow','fertilize'].includes(n.stage)&&motion){
   for(let i=0;i<5;i++){const age=(n.eventTime%1.4)-.64-i*.035;if(age<0||age>.55)continue;const q=age/.55,x=56+n.plot*76-9+i*4,y=260+i%3*3;
    r(attachment.handX+(x-attachment.handX)*q,attachment.handY+(y-attachment.handY)*q*q-3*Math.sin(q*Math.PI),2,1,n.stage==='sow'?'#ead594':'#b9aa6a')}
  }
  if(n.stage==='harvest'){if(n.care===1)basket(n.x+25,n.y-1,n.eventProgress>.6);else{carrot(n.x+21,n.y-17);basket(n.x+23,n.y-8,false)}}
  if(attachment.impact&&motion){r(139,132,3,2,'#ffd782');r(143,128,2,2,'#ffb45e')}
  if(n.id==='fisher'&&['cast','wait','reel','check-line','daily-fish'].includes(n.stage)){c.strokeStyle='#e4e0c3';c.lineWidth=1;c.beginPath();c.moveTo(attachment.tipX,attachment.tipY);c.quadraticCurveTo(426,145,426,178);c.stroke();r(425,178+(motion?Math.round(Math.sin(t*2)):0),3,3,'#cb7358')}
  if(n.stage==='catch'){const q=n.catchProgress;fish(426+(397-426)*q,178-30*Math.sin(q*Math.PI));if(motion)ripple(426,181,t)}
 }}));
 actors.push({y:a.y,draw(){r(a.x-8,a.y-1,16,3,'#9f916b');sprite(c,'keeper',0,a.walk&&motion?2+Math.floor(a.distance/7)%4:0,a.x,a.y,47,a.left,!a.walk&&motion&&Math.sin(t*1.8)>.25?1:0)}});
 actors.push({y:p.y,draw(){r(p.x-10,p.y,20,2,'#9f916b');c.save();c.translate(Math.round(p.x),Math.round(p.y-(pose.lift||0)*.48));if(p.left)c.scale(-1,1);c.drawImage(pets.portrait(),0,0,96,96,-23,-42,46,46);c.restore();if(eat){carrot(p.x+9,p.y-11);r(p.x-2,p.y-46,3,3,'#d98687');r(p.x+2,p.y-46,3,3,'#d98687');r(p.x,p.y-43,3,3,'#d98687')}}});
 actors.sort((a,b)=>a.y-b.y).forEach(v=>v.draw());
 const gardener=residents.find(n=>n.id==='gardener'),fisher=residents.find(n=>n.id==='fisher');
 if(frame.readyProducts.includes('smith'))tool(161,146);
 basket(298,180,frame.readyProducts.includes('gardener')||gardener.stage==='deliver');
 bucket(397,181,frame.readyProducts.includes('fisher')||fisher.stage==='deliver');
 if(effect&&motion){const age=t-effect.at;if(effect.kind==='water'&&age<1){const x=56+effect.index*76;for(let i=0;i<6;i++)r(x-15+i*6,245+(age*15+i*3)%20,1,3,'#b9e3de')}if(effect.kind==='harvest'&&age<1.2){const q=age/1.2,x=56+effect.index*76;carrot(x+(a.x-x)*q,258+(a.y-22-258)*q-18*Math.sin(q*Math.PI))}}

 return residents;
}
return{ready,render,portrait(p){pets.render(p,'idle',0,false,0,{spriteOnly:true});return pets.portrait()},residentPortrait(target,id){const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);const row=layout.residents[id].row;sprite(ctx,'npcs',row,0,target.width/2,target.height-4,118)}};
}root.YardRenderer={create};})(globalThis);
