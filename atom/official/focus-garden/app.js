'use strict';
(() => {
 const $=id=>document.getElementById(id), api=window.AtomApp;
 const defaults={version:1,minutes:25,remaining:1500000,deadline:0,phase:'idle',plants:0};
 let state={...defaults},alive=true,loaded=false,busy=false,saveFailed=false,failedAction=null,timer,unsubscribe,present=null;
 api?.deferReady();
 function remaining(){return state.phase==='running'?Math.max(0,state.deadline-Date.now()):state.remaining}
 function elapsed(){return state.phase==='running'&&remaining()===0}
 function paint(){
  if(!alive)return;
  const seconds=Math.ceil(remaining()/1000),done=elapsed();
  $('time').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  $('phase').textContent=done?'时间到了，确认这次的小小完成':state.phase==='running'?'慢慢来，一次只做一件事':state.phase==='paused'?'休息一下，再继续':'给一件小事，留一点时间';
  $('growth').textContent=state.plants+' 株成长';
  $('start').textContent=state.phase==='running'?'暂停':state.phase==='paused'?'继续专注':'开始专注';
  $('start').hidden=done;$('finish').hidden=!done;$('reset').hidden=state.phase==='idle';
  for(const id of ['start','finish','reset','duration'])$(id).disabled=!loaded||busy||saveFailed;
  $('duration').disabled=!loaded||busy||saveFailed||state.phase!=='idle';
  $('duration').value=String(state.minutes);
  $('away').hidden=present!==false||state.phase!=='running'||done;
  $('pause-away').disabled=busy||saveFailed;
  $('retry').hidden=loaded&&!saveFailed;
 }
 function drawGarden(){
  const count=Math.min(state.plants,18),paths=[];
  for(let i=0;i<count;i++){
   const x=23+i*25,y=100+(i%3)*5,h=23+(i*13)%26;
   paths.push(`<g transform="translate(${x} ${y})" stroke="#617f62" stroke-width="2.5" fill="none"><path d="M0 0V-${h}"/><path d="M0 -${h/2}Q-15 -${h} -12 -${h+5}Q0 -${h+6} 0 -${h/2}" fill="#8ba584"/><path d="M0 -${h*.7}Q13 -${h+12} 15 -${h+5}Q14 -${h-2} 0 -${h*.7}" fill="#b2bd89"/></g>`);
  }
  $('plants').innerHTML=paths.join('');
 }
 async function change(make,message){
  if(!loaded||busy||!alive)return;
  busy=true;saveFailed=false;paint();
  const next=make({...state});
  try{await api.save(next);if(!alive)return;state=next;failedAction=null;$('status').textContent=message;drawGarden()}
  catch(e){if(!alive)return;saveFailed=true;failedAction=()=>change(make,message);$('status').textContent='保存失败，原记录保留，请重试';}
  finally{busy=false;paint()}
 }
 function pause(){return change(s=>({...s,phase:'paused',remaining:remaining(),deadline:0}),'已暂停并保存')}
 $('start').onclick=()=>state.phase==='running'?pause():change(s=>({...s,phase:'running',deadline:Date.now()+s.remaining}),'已保存 · 离开应用后计时继续，到时需确认');
 $('pause-away').onclick=pause;
 $('finish').onclick=()=>{if(!elapsed())return;change(s=>({...s,phase:'idle',remaining:s.minutes*60000,deadline:0,plants:s.plants+1}),'已种下一株植物 · 成长已保存')};
 $('reset').onclick=()=>change(s=>({...s,phase:'idle',remaining:s.minutes*60000,deadline:0}),'本次已结束，没有增加成长');
 $('duration').onchange=e=>{const minutes=Number(e.target.value);change(s=>({...s,minutes,remaining:minutes*60000}),'时长已保存')};
 $('back').onclick=()=>api?.navigation?.back();
 $('retry').onclick=()=>loaded&&failedAction?failedAction():load();
 async function load(){
  if(busy||!alive)return;busy=true;paint();
  try{
   if(!api)throw Error('SDK missing');
   const saved=await api.load(defaults);
   if(!alive)return;
   if(!saved||saved.version!==1||![5,25,45].includes(saved.minutes)||!['idle','running','paused'].includes(saved.phase)||!Number.isFinite(saved.remaining)||saved.remaining<0||saved.remaining>2700000||!Number.isFinite(saved.deadline)||saved.deadline<0||!Number.isSafeInteger(saved.plants)||saved.plants<0)throw Error('Invalid state');
   state={...saved};loaded=true;saveFailed=false;$('status').textContent='成长只在计时结束并由你确认后记录';drawGarden();
  }catch(e){loaded=false;$('status').textContent='花园读取失败，重试前不会覆盖记录'}
  finally{busy=false;paint();if(alive)api?.ready()}
 }
 if(api?.sensors?.subscribe)unsubscribe=api.sensors.subscribe(sample=>{
  if(!alive)return;
  const has=sample.source==='device'&&sample.available?.presence&&typeof sample.presence?.present==='boolean';
  present=has?sample.presence.present:null;
  $('presence').textContent=has?'存在感知已连接 · 不用于判断专注程度':'传感器未连接 · 可手动计时';paint();
 });
 timer=setInterval(paint,500);load();
 api?.onSuspend(()=>{alive=false;clearInterval(timer);unsubscribe?.()});
})();
