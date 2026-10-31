/* A black, full-screen companion scene. UI focus remains owned by AtomInput. */
(function () {
  'use strict';
  const ROWS = {idle:0, runRight:1, runLeft:2, waving:3, jumping:4, failed:5, waiting:6, running:7, review:8};
  const W = 480, H = 360, PET_W = 216, PET_H = 234, FLOOR = 294;

  window.createPetScene = function (canvas, hitTarget) {
    const g = canvas.getContext('2d');
    let sprite = null, metadata = null, state = 'idle', stateKey = '', preview = false;
    let enabled = true, visible = true, stopped = false, timer = 0, lastTime = 0;
    let elapsed = 0, reactionUntil = 0, x = 240, heldX = null, frameKey = '';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => enabled && !reduced.matches;

    function rounded(x, y, w, h, r, fill, stroke) {
      g.beginPath();
      g.moveTo(x+r, y); g.arcTo(x+w, y, x+w, y+h, r);
      g.arcTo(x+w, y+h, x, y+h, r); g.arcTo(x, y+h, x, y, r);
      g.arcTo(x, y, x+w, y, r); g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
    }

    function star(cx, cy, size, color) {
      g.fillStyle = color; g.beginPath();
      for (let i=0; i<8; i++) {
        const angle = i*Math.PI/4, radius = i%2 ? size*.25 : size;
        const px = cx+Math.cos(angle)*radius, py = cy+Math.sin(angle)*radius;
        if (i) g.lineTo(px,py); else g.moveTo(px,py);
      }
      g.closePath(); g.fill();
    }

    function thought(cx, kind, tick) {
      const bx = Math.min(408,cx+83), by = 102;
      rounded(bx-24,by-18,48,34,12,'#11171b',kind==='failed'?'#ba7a75':'#697982');
      g.fillStyle='#697982';g.beginPath();g.arc(bx-21,by+23,3,0,Math.PI*2);g.fill();
      if (kind==='failed') {
        g.fillStyle='#e6aaa0';g.fillRect(bx-2,by-9,4,12);g.fillRect(bx-2,by+7,4,4);
      } else {
        for (let i=0;i<3;i++) {g.fillStyle=tick%6===i?'#efd29d':'#a29a87';g.beginPath();g.arc(bx-10+i*10,by,2.5,0,Math.PI*2);g.fill();}
      }
    }

    function pose() {
      if (preview) return {action:state, x:240};
      if (elapsed < reactionUntil) return {action:'jumping',x};
      if (state !== 'idle') {
        return {action:state==='waving'&&elapsed>3600?'idle':state,x:240};
      }
      // Local idle behaviour is only companionship; it never claims a task is running.
      if (!motion()) return {action:'idle',x:240};
      if (document.activeElement===hitTarget) {
        if (heldX===null) heldX=x;
        return {action:'idle',x:heldX};
      }
      heldX=null;
      const t=elapsed%46000;
      if(t<7000) return {action:'idle',x:240};
      if(t<11000) return {action:'runRight',x:240+(t-7000)/4000*86};
      if(t<18000) return {action:'idle',x:326};
      if(t<24000) return {action:'runLeft',x:326-(t-18000)/6000*172};
      if(t<31000) return {action:'idle',x:154};
      if(t<35000) return {action:'runRight',x:154+(t-31000)/4000*86};
      if(t<37000) return {action:'waving',x:240};
      return {action:'idle',x:240};
    }

    function paint(force) {
      const p=pose(), row=ROWS[p.action], tick=Math.floor(elapsed/120);
      x=p.x;
      const frame=sprite&&motion()?tick%metadata.frames[row]:0;
      const key=[p.action,frame,Math.round(x),state,preview,motion()].join(':');
      if(!force&&key===frameKey) return p;
      frameKey=key;
      g.fillStyle='#000';g.fillRect(0,0,W,H);
      if(sprite) {
        g.imageSmoothingEnabled=false;
        g.drawImage(sprite,frame*metadata.width,row*metadata.height,metadata.width,metadata.height,
          Math.round(x-PET_W/2),FLOOR-PET_H,PET_W,PET_H);
        if(p.action==='waiting'||p.action==='failed') thought(x,p.action,tick);
        if(p.action==='waving') {
          const pulse=motion()?Math.sin(elapsed/220)*1.5:0;
          star(x-91,129,7+pulse,'#e6c68b');star(x+94,173,5-pulse*.5,'#a5d2bd');
        }
      }
      hitTarget.style.transform='translate('+Math.round(x-PET_W/2)+'px,'+(FLOOR-PET_H)+'px)';
      canvas.dataset.action=p.action;
      canvas.dataset.state=state;
      canvas.dataset.petX=String(Math.round(x));
      return p;
    }

    function tick() {
      timer=0;
      if(stopped||!visible||document.hidden) return;
      const now=performance.now();
      if(lastTime&&motion()) elapsed+=Math.min(200,now-lastTime);
      lastTime=now;
      const p=paint(false);
      if(motion()) timer=setTimeout(tick,/^run(Left|Right)$/.test(p.action)?33:120);
    }
    function resume() {
      clearTimeout(timer);timer=0;lastTime=0;frameKey='';
      if(stopped||!visible||document.hidden) return;
      paint(true);tick();
    }
    function onVisibility(){resume()}
    document.addEventListener('visibilitychange',onVisibility);
    if(reduced.addEventListener) reduced.addEventListener('change',resume); else reduced.addListener(resume);
    hitTarget.addEventListener('focus',resume);
    hitTarget.addEventListener('blur',resume);
    paint(true);
    return {
      setImage(image,pet){sprite=image;metadata=pet;resume()},
      setState(action,key,isPreview){
        if(!(action in ROWS)) action='idle';
        if(state===action&&stateKey===key&&preview===isPreview) return;
        state=action;stateKey=key;preview=isPreview;elapsed=0;reactionUntil=0;heldX=null;resume();
      },
      react(){if(stopped||!visible||!motion())return;reactionUntil=elapsed+960;frameKey='';paint(true);if(!timer&&motion())tick()},
      setMotion(value){enabled=value!==false;resume()},
      setVisible(value){visible=value;resume()},
      stop(){stopped=true;clearTimeout(timer);timer=0;sprite=null;document.removeEventListener('visibilitychange',onVisibility);
        if(reduced.removeEventListener)reduced.removeEventListener('change',resume);else reduced.removeListener(resume);
        hitTarget.removeEventListener('focus',resume);hitTarget.removeEventListener('blur',resume)}
    };
  };
})();
