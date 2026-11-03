'use strict';
(() => {
 const $=id=>document.getElementById(id), api=window.AtomApp;
 const labels={queued:'等待电脑接收',running:'正在执行',waiting_approval:'等你确认',completed:'任务完成',failed:'需要检查',cancelled:'已取消',interrupted:'任务中断'};
 const rank={waiting_approval:0,running:1,queued:2,failed:3,interrupted:3,completed:4,cancelled:5};
 const ACTIVE=new Set(['queued','running','waiting_approval']), FINISHED=new Set(['completed','failed','interrupted']);
 const defaults={version:1,sound:true};
 // Demo snapshots run through the same absorb/paint path as real ones, so every lamp state can be tried without a paired computer.
 const DEMO=[[['a','running'],['b','queued']],[['a','waiting_approval'],['b','queued']],[['a','running'],['b','queued']],[['a','completed'],['b','running']],[['a','completed'],['b','failed']]];
 const demoPrompts={a:'整理本周的会议记录',b:'给项目补一份使用说明'};
 let alive=true,serial=0,timer,tick,audio,state=null,error='',linkError='',lastGood=0,blocked=false,known=null,alerts=[],cursor='',demo=null,prefs={...defaults},prefsLoaded=false,prefError=false,saving=false;
 const pending=new Map();
 api?.deferReady();

 function request(){
  return new Promise((resolve,reject)=>{
   const id='light-'+Date.now()+'-'+(++serial),timeout=setTimeout(()=>{pending.delete(id);reject(Error('还在等系统回应；如果屏幕上有访问请求，请先选择'))},12000);
   pending.set(id,{resolve,reject,timeout});parent.postMessage({type:'atom:task-state',id},'*');
  });
 }
 function stamp(t){const v=t?.updated_at;return typeof v==='number'?(v>1e12?v:v*1000):Date.parse(v)}
 function ordered(){return(state?.tasks||[]).slice().sort((a,b)=>(rank[a.status]??6)-(rank[b.status]??6)||(stamp(b)||0)-(stamp(a)||0))}
 function current(){
  const list=ordered();
  return list.find(t=>t.id===alerts[0]?.id)||list.find(t=>t.id===cursor)||list[0];
 }
 function age(t){
  const seconds=Math.floor((Date.now()-stamp(t))/1000);
  if(!Number.isFinite(seconds))return '';
  return seconds<60?Math.max(0,seconds)+' 秒前更新':seconds<3600?Math.floor(seconds/60)+' 分钟前更新':Math.floor(seconds/3600)+' 小时前更新';
 }

 // Only a change seen between two real snapshots rings: the first snapshot never claims something just happened.
 function absorb(next){
  const tasks=next.tasks||[],seen=new Map(tasks.map(t=>[t.id,t.status]));
  if(known)for(const t of tasks){
   const before=known.get(t.id);
   if(t.status===before)continue;
   if(t.status==='waiting_approval'){alerts.push({id:t.id,status:t.status});chime('attention')}
   else if(FINISHED.has(t.status)&&ACTIVE.has(before)){alerts.push({id:t.id,status:t.status});chime(t.status==='completed'?'done':'fail')}
  }
  alerts=alerts.filter(a=>seen.get(a.id)===a.status);
  known=seen;state=next;
 }

 function chime(kind){
  if(!prefs.sound)return;
  try{
   audio=audio||new AudioContext();
   if(audio.state==='suspended')audio.resume().catch(()=>{});
   const notes={done:[1047,1319],attention:[880,880],fail:[659,523]}[kind],start=audio.currentTime+.02;
   notes.forEach((f,i)=>{
    const o=audio.createOscillator(),g=audio.createGain(),at=start+i*.18;
    o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.18,at+.02);g.gain.exponentialRampToValueAtTime(.001,at+.32);
    o.connect(g).connect(audio.destination);o.start(at);o.stop(at+.34);
   });
  }catch{}
 }

 function paint(){
  if(!alive)return;
  // The relay is often briefly rate-limited; keep showing the last good snapshot and only call the link lost after a minute.
  const staleFor=linkError?Math.floor((Date.now()-lastGood)/1000):0;
  const list=ordered(),t=current(),configured=!!state?.configured,lost=!!state?.connection_error||staleFor>60,hosts=state?.paired||[],online=hosts.filter(h=>h.online).length,alert=!!alerts.length&&t?.id===alerts[0].id;
  let lamp='offline',title,prompt='',meta='',note='';
  if(!state){title=error?'读取不到任务状态':'正在连接电脑…';prompt=error}
  else if(!configured){title='还没有连接电脑';prompt='在「我的电脑」里配对后，这里会亮起来。'}
  else if(lost){title='等连接回来';prompt='连接暂时中断，不会猜测任务是否完成。';note=linkError||state.connection_error}
  else if(!t){lamp='idle';title='没有进行中的任务';prompt=online?online+' 台电脑在线，有任务时这里会亮起来。':'电脑离线，连上后这里会显示任务。'}
  else{
   lamp=(rank[t.status]==null?'idle':t.status)+(alert?' alert':'');title=labels[t.status]||t.status;prompt=t.prompt||'电脑任务';
   const host=hosts.find(h=>h.client_id===t.computer_id)?.name;
   meta=[host,age(t),list.length>1?'第 '+(list.indexOf(t)+1)+'/'+list.length+' 个':''].filter(Boolean).join(' · ');
   note=t.status==='waiting_approval'?'请在电脑上或「我的电脑」里确认':FINISHED.has(t.status)&&t.status!=='completed'?'去电脑上查看原因':'';
  }
  if(linkError&&!lost)note='连接不稳 · 显示 '+staleFor+' 秒前的状态';
  if(demo!==null)note='演示 · 不是真实任务';
  else if(error&&state)note=error;
  else if(prefError)note='提示音设置读取失败，点「提示音」重试';
  $('lamp').className='lamp '+lamp;$('title').textContent=title;$('prompt').textContent=prompt;$('meta').textContent=meta;$('note').textContent=note;
  $('ack').hidden=!alert;$('retry').hidden=!error||demo!==null;
  $('demo').hidden=demo===null&&!(error||!configured||lost||!t);$('demo').textContent=demo===null?'看演示':'结束演示';
  $('prev').hidden=$('next').hidden=alert||!configured||lost||list.length<2;
  $('sound').textContent='提示音 '+(prefs.sound?'开':'关');$('sound').setAttribute('aria-pressed',String(prefs.sound));$('sound').disabled=saving;
 }

 function playDemo(){
  if(!alive||demo===null)return;
  if(demo===DEMO.length){demo=0;known=null;alerts=[]}
  const now=Date.now();
  absorb({configured:true,paired:[{client_id:'demo',name:'演示电脑',online:true}],tasks:DEMO[demo].map(([id,status])=>({id,status,prompt:demoPrompts[id],computer_id:'demo',updated_at:now}))});
  demo++;paint();timer=setTimeout(playDemo,4500);
 }
 function toggleDemo(){
  clearTimeout(timer);state=null;known=null;alerts=[];cursor='';linkError='';error='';
  if(demo===null){demo=0;playDemo()}else{demo=null;blocked=false;paint();refresh()}
 }

 async function refresh(){
  clearTimeout(timer);if(demo!==null)return;
  try{
   const next=await request();if(!alive||demo!==null)return;error='';
   if(next.configured&&next.connection_error&&state?.configured&&!state.connection_error)linkError=next.connection_error;
   else{if(!next.connection_error)lastGood=Date.now();linkError='';absorb(next)}
  }
  catch(e){if(!alive||demo!==null)return;error=e.message||'读取不到任务状态';blocked=/允许|权限/.test(error)}
  paint();
  if(alive&&!blocked)timer=setTimeout(refresh,linkError||error?10000:5000);
 }
 function step(delta){
  const list=ordered();if(list.length<2)return;
  cursor=list[(list.indexOf(current())+delta+list.length)%list.length].id;paint();
 }
 async function loadPrefs(){
  try{
   const saved=await api.load(defaults);if(!alive)return;
   if(!saved||saved.version!==1||typeof saved.sound!=='boolean')throw Error('invalid');
   prefs={...saved};prefsLoaded=true;prefError=false;
  }catch{if(alive)prefError=true}
  paint();
 }
 async function toggleSound(){
  if(!prefsLoaded)return loadPrefs();
  const next={...prefs,sound:!prefs.sound};saving=true;paint();
  try{await api.save(next);if(!alive)return;prefs=next;$('note').textContent=next.sound?'提示音已开启':'提示音已关闭';saving=false;paint();if(next.sound)chime('done')}
  catch{if(!alive)return;saving=false;paint();$('note').textContent='提示音设置保存失败，原设置保留'}
 }

 window.addEventListener('message',e=>{
  if(e.source!==parent||e.data?.type!=='atom:task-state-result')return;
  const p=pending.get(e.data.id);if(!p)return;
  pending.delete(e.data.id);clearTimeout(p.timeout);
  e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result||{});
 });
 $('back').onclick=()=>api?.navigation?.back();
 $('sound').onclick=toggleSound;
 $('ack').onclick=()=>{alerts.shift();cursor='';paint()};
 $('demo').onclick=toggleDemo;
 $('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);
 $('retry').onclick=()=>{blocked=false;error='';if(!prefsLoaded)loadPrefs();refresh()};
 api?.onSuspend(()=>{
  alive=false;clearTimeout(timer);clearInterval(tick);audio?.close().catch(()=>{});
  for(const p of pending.values()){clearTimeout(p.timeout);p.reject(Error('应用已退出'))}
  pending.clear();
 });
 paint();
 if(api)loadPrefs().finally(()=>{if(alive)api.ready()});
 refresh();tick=setInterval(paint,1000);
})();
