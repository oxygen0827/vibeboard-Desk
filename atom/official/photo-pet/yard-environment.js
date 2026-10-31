/* Offline scenery motion; no game state or independent timers. */
(function(root){'use strict';
function create(image){
 const base=document.createElement('canvas');base.width=480;base.height=360;
 const b=base.getContext('2d');b.imageSmoothingEnabled=false;b.drawImage(image,0,0,480,360);
 // Refraction stays clear of the pier, bank, lilies and reeds.
 const water=new Path2D();water.moveTo(407,180);water.lineTo(433,162);water.lineTo(479,158);water.lineTo(479,229);water.lineTo(449,224);water.lineTo(427,215);water.lineTo(411,205);water.closePath();
 function pixel(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h)}
 function ripple(c,x,y,t){const q=(t%3)/3;c.globalAlpha=(1-q)*.65;c.strokeStyle='#d2e9d5';c.lineWidth=1;c.beginPath();c.ellipse(x,y,3+q*14,1+q*4,0,0,Math.PI*2);c.stroke();c.globalAlpha=1}
 function branch(c,x,y,phase,t){
  const bend=Math.sin(t*1.45+phase)*2.2+Math.sin(t*.67+phase)*.8;
  c.strokeStyle='#647b37';c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x+3+bend,y-8,x+bend*2,y-18);c.stroke();
  for(let i=0;i<3;i++){const yy=y-5-i*5,xx=x+bend*(i+1)/2;pixel(c,xx-5,yy,5,2,'#8caa46');pixel(c,xx+1,yy-2,5,2,'#bcc967');pixel(c,xx-2,yy-3,3,2,'#a2b854')}
 }
 function render(c,t,motion){
  c.drawImage(base,0,0);if(!motion)return;
  c.save();c.clip(water);
  // Small bands refract at most two pixels; the shoreline never moves.
  for(let y=157;y<234;y+=5){const dx=Math.round(Math.sin(t*2.1+y*.16)*1.5);c.drawImage(base,396,y,84,5,396+dx,y,84,5)}
  for(let i=0;i<10;i++){const q=(t*.18+i*.137)%1,x=405+q*70,y=168+(i*17)%58;c.globalAlpha=.18+.25*Math.sin(q*Math.PI);pixel(c,x,y,7+i%3*3,1,'#d0ecdc');pixel(c,x+4,y+2,4,1,'#80d3d1')}
  c.globalAlpha=1;ripple(c,432,189,t);ripple(c,458,214,t+1.3);c.restore();
  // Flames are confined to the forge mouth rather than flashing the cottage.
  for(let i=0;i<7;i++){const h=3+Math.round((Math.sin(t*7+i*1.7)+1)*2.5);pixel(c,57+i*2,109-h,2,h,'#f69332');pixel(c,58+i*2,111-Math.round(h*.65),1,Math.round(h*.65),'#ffe18a')}
  for(let i=0;i<3;i++){const q=(t*.65+i/3)%1;c.globalAlpha=(1-q)*.8;pixel(c,60+i*4+Math.sin(q*4+i)*2,106-q*11,1,2,'#ffe6a4')}
  c.globalAlpha=1;
  // Pixel smoke leaves the existing chimney and drifts into the sky.
  for(let i=0;i<3;i++){const q=(t*.16+i/3)%1,x=207+q*11+Math.sin(q*5+i)*2,y=41-q*28,w=5+Math.round(q*7);c.globalAlpha=(1-q)*.48;pixel(c,x-w/2,y,w,4,'#f1e8d4');pixel(c,x-w/2+2,y-3,w-3,3,'#f1e8d4')}
  c.globalAlpha=1;
  branch(c,18,220,.2,t);branch(c,446,238,2,t);branch(c,328,287,3.4,t);
  for(let i=0;i<2;i++){const q=(t/(8+i*2)+i*.48)%1,x=20+i*280+q*39+Math.sin(q*6+i)*7,y=58+i*92+q*77;pixel(c,x,y,Math.cos(q*12)>0?4:2,2,i?'#d1b15c':'#9bb64b')}
  for(let i=0;i<2;i++){const x=313-i*282+Math.sin(t*.75+i*2)*13,y=190+i*25+Math.sin(t*1.15+i)*6,open=Math.sin(t*13+i)>0;pixel(c,x,y,1,3,'#78543d');pixel(c,x-(open?3:1),y-1,open?3:1,2,i?'#f8d67f':'#f4c1b5');pixel(c,x+1,y-2,open?3:1,2,i?'#fff0b2':'#ffe1d3')}
 }
 return{render};
}
root.YardEnvironment={create};
})(globalThis);
