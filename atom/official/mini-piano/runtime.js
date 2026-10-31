/* Shared ATOM lifecycle and local audio for the four GrayOS ports. */
'use strict';
class Scene {
  constructor() {
    this.canvas=document.querySelector('canvas');this.ctx=this.canvas.getContext('2d');
    this.audioRevision=0;this.active=true;this.sound=false;this.timers=new Set();this.listeners=[];this.voices=new Set();
    this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    this.listen(document,'visibilitychange',()=>{cancelAnimationFrame(this.raf);if(document.hidden){if(this.audio)this.audio.suspend();}else if(this.active){this.last=0;this.raf=requestAnimationFrame(this.tick);}});
    if(window.AtomApp)AtomApp.onSuspend(()=>this.stop());
    this.listen(window,'pagehide',()=>this.stop());
    const button=document.querySelector('[data-sound]');
    if(button)this.listen(button,'click',()=>{this.sound=!this.sound;button.textContent=this.sound?'声音 开':'声音 关';button.setAttribute('aria-pressed',String(this.sound));if(!this.sound)this.silence();});
  }
  listen(el,event,fn,options){el.addEventListener(event,fn,options);this.listeners.push(()=>el.removeEventListener(event,fn,options));}
  after(fn,ms){const id=setTimeout(()=>{this.timers.delete(id);if(this.active)fn();},ms);this.timers.add(id);return id;}
  loop(draw){this.tick=now=>{if(!this.active||document.hidden)return;const dt=this.last?Math.min(2.5,(now-this.last)/16.667):1;this.last=now;draw(dt,now);this.raf=requestAnimationFrame(this.tick);};this.raf=requestAnimationFrame(this.tick);}
  point(e){const r=this.canvas.getBoundingClientRect();return [(e.clientX-r.left)*480/r.width,(e.clientY-r.top)*360/r.height];}
  key(fn){this.listen(window,'keydown',e=>{if(e.repeat||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.key===' '||e.key==='Home')return;fn(e);});}
  async tone(f,duration=.24,volume=.4,type='triangle',when=null) {
    if(!this.active||!this.sound||document.hidden)return;
    const revision=this.audioRevision;try{const Audio=window.AudioContext||window.webkitAudioContext;this.audio=this.audio||new Audio();await this.audio.resume();if(revision!==this.audioRevision||!this.active||!this.sound||document.hidden)return;
      if(this.voices.size>=12){const first=this.voices.values().next().value;first.stop();this.voices.delete(first);}
      const o=this.audio.createOscillator(),v=this.audio.createGain(),t=Math.max(this.audio.currentTime,when??this.audio.currentTime);o.type=type;o.frequency.value=f;
      v.gain.setValueAtTime(.0001,t);v.gain.exponentialRampToValueAtTime(Math.max(.002,volume*.18),t+.008);v.gain.exponentialRampToValueAtTime(.0001,t+duration);
      o.connect(v).connect(this.audio.destination);this.voices.add(o);o.onended=()=>{this.voices.delete(o);o.disconnect();v.disconnect();};o.start(t);o.stop(t+duration+.02);
    }catch(_){this.notice('声音暂不可用，请再点一次琴键或声音按钮。');}
  }
  silence(){this.audioRevision++;for(const o of this.voices){try{o.stop();}catch(_){}}this.voices.clear();}
  stop(){if(!this.active)return;this.active=false;cancelAnimationFrame(this.raf);for(const id of this.timers)clearTimeout(id);this.timers.clear();this.silence();if(this.audio)this.audio.close();for(const off of this.listeners)off();}
  notice(text){const n=document.querySelector('#notice');if(n)n.textContent=text;}
  async restore(defaults,apply){
    if(window.AtomApp)AtomApp.deferReady();
    const read=async()=>{try{const value=window.AtomApp?await AtomApp.load(defaults):defaults;if(!this.active)return;document.querySelector('.load-error')?.remove();apply(value);if(window.AtomApp)AtomApp.ready();}
      catch(_){if(!this.active)return;let panel=document.querySelector('.load-error');if(!panel){panel=document.createElement('section');panel.className='load-error';panel.innerHTML='<h2>记录暂时读不到</h2><p>重试后再开始，保留之前的最高纪录。</p><button type="button">重试读取</button>';document.body.append(panel);panel.querySelector('button').onclick=read;}if(window.AtomApp)AtomApp.ready();}};await read();
  }
  async save(value){if(!window.AtomApp)throw Error('preview');return AtomApp.save(value);}
}
