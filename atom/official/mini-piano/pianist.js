'use strict';
// Offline sampled instrument. Source recordings: Alexander Holm, CC BY 3.0.
class SampledPiano {
 constructor(scene){this.scene=scene;this.buffers=[];this.pending=null;this.decodedBytes=0;this.stolen=0;}
 async prepare(){
  if(this.buffers.length===PIANO_SAMPLES.length)return;
  if(this.pending)return this.pending;
  this.pending=(async()=>{
   const s=this.scene,Audio=window.AudioContext||window.webkitAudioContext;
   s.audio=s.audio||new Audio({latencyHint:'interactive'});await s.audio.resume();
   if(!s.active)throw Error('suspended');
   if(!this.master){this.master=s.audio.createGain();this.master.gain.value=.5;const limiter=s.audio.createDynamicsCompressor();limiter.threshold.value=-8;limiter.knee.value=8;limiter.ratio.value=8;limiter.attack.value=.003;limiter.release.value=.2;this.master.connect(limiter).connect(s.audio.destination);}
   const result=[];
   for(const [note,layer,encoded] of PIANO_SAMPLES){
    if(!s.active)throw Error('suspended');
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    const buffer=await s.audio.decodeAudioData(bytes.buffer);result.push({note,layer,buffer});
   }
   if(!s.active)throw Error('suspended');
   this.buffers=result;this.decodedBytes=result.reduce((n,x)=>n+x.buffer.length*x.buffer.numberOfChannels*4,0);
  })().finally(()=>{this.pending=null});return this.pending;
 }
 note(midi,duration=.5,velocity=.7,when=null){
  const s=this.scene;if(!s.active||!s.sound||document.hidden||!this.buffers.length)return;
  const layer=velocity<.64?5:12;
  const sample=this.buffers.filter(x=>x.layer===layer).reduce((a,b)=>Math.abs(b.note-midi)<Math.abs(a.note-midi)?b:a);
  if(s.voices.size>=48){const old=s.voices.values().next().value;try{old.stop()}catch(_){}s.voices.delete(old);this.stolen++;}
  const node=s.audio.createBufferSource(),gain=s.audio.createGain(),at=Math.max(s.audio.currentTime,when??s.audio.currentTime),rate=Math.pow(2,(midi-sample.note)/12);
  node.buffer=sample.buffer;node.playbackRate.value=rate;
  const end=Math.min(duration,sample.buffer.duration/rate-.04),level=Math.max(.01,velocity)*.72;
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+.004);gain.gain.setValueAtTime(level,at+Math.max(.005,end));gain.gain.exponentialRampToValueAtTime(.0001,at+Math.max(.01,end)+.22);
  node.connect(gain).connect(this.master);s.voices.add(node);node.onended=()=>{s.voices.delete(node);node.disconnect();gain.disconnect()};node.start(at);node.stop(at+Math.max(.01,end)+.23);
 }
 dispose(){this.buffers=[];this.decodedBytes=0;}
}
// Editorial interpretation of engraved scores, not a recorded pianist performance.
function interpretScore(song,expressive=true,hand='both'){
 const events=[],meter=song.meter,highest=new Map();
 for(const n of song.notes)highest.set(n[0],Math.max(highest.get(n[0])||0,n[1]));
 const profile={nocturne:{swell:.13,breath:.05,release:.17},clair:{swell:.18,breath:.08,release:.23},maple:{swell:.07,breath:0,release:.02},waltz:{swell:.10,breath:.025,release:.055},moonlight:{swell:.16,breath:.015,release:.045}}[song.id];
 // A continuous monotonic beat-to-time map: equal-time chords remain simultaneous.
 const step=.125,map=[0],base=60/song.bpm;
 for(let b=0;b<song.beats+8;b+=step){const phase=(b/(meter*4))%1;const section=b/song.beats;const breadth=expressive?1+profile.breath*Math.cos(phase*Math.PI*2)+(section>.95?(section-.95)*3:0):1;map.push(map[map.length-1]+step*base*breadth)}
 const time=b=>{const i=Math.floor(b/step),f=b/step-i;return map[i]+(map[i+1]-map[i])*f};
 for(const [beat,midi,beats,sourceVelocity,side] of song.notes){
  if(hand==='right'&&side!==0||hand==='left'&&side!==1)continue;
  const phase=(beat/(meter*4))%1,section=beat/song.beats;
  let velocity=sourceVelocity/127;
  if(expressive){const melody=side===0&&midi===highest.get(beat);velocity=(melody?.76:side===0?.57:.49)+profile.swell*Math.sin(phase*Math.PI)-.07*Math.cos(section*Math.PI*2);if(song.id==='maple'&&beat%meter<.05)velocity+=.05;}
  const start=time(beat),duration=Math.max(.045,time(beat+beats)-start)+(expressive?profile.release:0);
  events.push({time:start,midi,duration,velocity:Math.min(.94,Math.max(.25,velocity)),hand:side});
 }
 return {events,duration:time(song.beats)+.5};
}
