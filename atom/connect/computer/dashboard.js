// Resolve before the first render; persistence belongs to this computer, not an app iframe.
const appearanceKey='atom.connect.appearance.v1';
let appearanceMode='light',appearanceStored=false,appearanceSaving=false;
try{const saved=['light','dark'].includes(window.atomNativeAppearance)?window.atomNativeAppearance:localStorage.getItem(appearanceKey);appearanceStored=['light','dark'].includes(saved);appearanceMode=appearanceStored?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{appearanceMode=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
document.documentElement.dataset.appearance=appearanceMode;
function sendFrameAppearance(frame){try{frame.contentWindow?.postMessage({type:'atom:appearance',mode:appearanceMode},'*');}catch{}}
function refreshAppearance(){document.documentElement.dataset.appearance=appearanceMode;document.querySelectorAll('[data-appearance-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.appearanceChoice===appearanceMode)));document.querySelectorAll('iframe').forEach(sendFrameAppearance);}
function persistAppearance(mode){if(window.webkit?.messageHandlers?.appearance)return new Promise((resolve,reject)=>{const done=e=>{if(e.detail?.mode!==mode)return;clearTimeout(timer);window.removeEventListener('atom:appearance-saved',done);e.detail.ok?resolve():reject(Error(e.detail.error||'无法保存外观'));},timer=setTimeout(()=>{window.removeEventListener('atom:appearance-saved',done);reject(Error('外观保存未完成，请重试'));},4000);window.addEventListener('atom:appearance-saved',done);window.webkit.messageHandlers.appearance.postMessage({mode});});localStorage.setItem(appearanceKey,mode);return Promise.resolve();}
async function chooseAppearance(mode){if(!['light','dark'].includes(mode)||appearanceSaving)return;appearanceSaving=true;document.querySelectorAll('[data-appearance-choice]').forEach(button=>button.disabled=true);const feedback=document.getElementById('appearance-feedback');feedback.textContent='正在保存外观…';try{await persistAppearance(mode);appearanceStored=true;appearanceMode=mode;refreshAppearance();feedback.textContent='已设为'+(mode==='dark'?'暗黑':'白天')+'，下次打开仍会保留。';}catch(e){feedback.textContent=e.message||'无法保存外观，请重试。';}finally{appearanceSaving=false;document.querySelectorAll('[data-appearance-choice]').forEach(button=>button.disabled=false);}}
document.addEventListener('click',e=>{const button=e.target.closest('[data-appearance-choice]');if(button)chooseAppearance(button.dataset.appearanceChoice);});
const appearanceMedia=matchMedia('(prefers-color-scheme: dark)');appearanceMedia.addEventListener?.('change',e=>{if(!appearanceStored){appearanceMode=e.matches?'dark':'light';refreshAppearance();}});
document.addEventListener('load',e=>{if(e.target.tagName==='IFRAME')sendFrameAppearance(e.target);},true);
window.addEventListener('message',e=>{if(e.data?.type!=='atom:appearance-request')return;const frame=Array.from(document.querySelectorAll('iframe')).find(f=>f.contentWindow===e.source);if(frame)sendFrameAppearance(frame);});
refreshAppearance();

/* ATOM Connect local console: connection, computer agent and shell. Studio pages live in studio.js. */
let csrf='',currentPage='overview',lastState=null,refreshing=false,taskFilter='all';
const $=id=>document.getElementById(id);
const pages=['overview','simulator','devices','tasks','agents','projects','notes','agenda','photos','market','creations','settings'];
const statuses={queued:'等待执行',running:'正在执行',waiting_approval:'等待审批',saving:'正在保存',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',conflict:'有冲突'};
const statusTone={queued:'info',running:'info',waiting_approval:'warn',saving:'info',completed:'ok',failed:'bad',cancelled:'',interrupted:'bad',conflict:'warn'};
const ACTIVE=['queued','running','waiting_approval','saving'];
window.studioJobs=[];

function h(tag,props={},...children){const n=document.createElement(tag);for(const [k,v]of Object.entries(props)){if(v==null||v===false)continue;if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k.startsWith('on'))n[k]=v;else if(k==='dataset')Object.assign(n.dataset,v);else n.setAttribute(k,v===true?'':v);}for(const c of children.flat())if(c!=null&&c!==false)n.append(c);return n;}
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg'),u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#i-'+name);s.append(u);return s;}
function pill(text,tone=''){return h('span',{class:'pill '+tone,text});}
function row({icon:name,tone='',title,sub,mono=false,meta,end=[],onclick}){return h('div',{class:'row'+(onclick?' clickable':''),onclick},h('span',{class:'row-icon '+tone},icon(name)),h('div',{class:'row-main'},h('strong',{text:title}),sub?h('small',{class:mono?'mono':'',text:sub}):null),meta?h('span',{class:'row-meta',text:meta}):null,...end);}
function emptyState(title,detail){return h('div',{class:'empty'},h('strong',{text:title}),detail||'');}
function ago(value){if(!value)return'';const t=typeof value==='number'?(value<1e11?value*1000:value):Date.parse(value);if(!t)return'';const s=(Date.now()-t)/1000;if(s<60)return'刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';if(s<86400*7)return Math.floor(s/86400)+' 天前';return new Date(t).toLocaleDateString();}

function showPage(page){if(!pages.includes(page))return;currentPage=page;document.querySelectorAll('[data-panel]').forEach(e=>e.hidden=e.dataset.panel!==page);document.querySelectorAll('aside [data-page]').forEach(e=>{const on=e.dataset.page===page;e.classList.toggle('selected',on);e.setAttribute('aria-current',on?'page':'false');});document.querySelector('main').scrollTop=0;window.dispatchEvent(new CustomEvent('atom:page',{detail:page}));}
window.atomConnectPage=showPage;
document.addEventListener('click',e=>{const target=e.target.closest('[data-page]');if(target)showPage(target.dataset.page);});

let toastTimer=null;
function note(text,error=false){const t=$('toast');clearTimeout(toastTimer);t.textContent=text;t.hidden=!text;t.classList.toggle('error',error);if(text)toastTimer=setTimeout(()=>t.hidden=true,error?7000:3200);}
async function api(route,body){const r=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Atom-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok){const e=Error(v.error||'请求失败');e.status=r.status;e.details=v;throw e;}return v;}

function relayTone(s){return !s.configured?'':s.connection_error?'bad':'ok';}
function hostOf(url){try{const u=new URL(url);return u.host+u.pathname.replace(/\/$/,'');}catch{return url||'';}}
function setNode(id,tone,sub,badge){const n=$(id);n.className='node '+tone;n.querySelector('small').textContent=sub;n.querySelector('.badge').replaceChildren(badge?pill(badge,tone):'');}

function health(s,ctx){const {online,paired,ready,projects}=ctx;
  if(!s.configured)return['warn','还没有连接 ATOM 服务','去设置','devices'];
  if(s.connection_error)return['bad','无法连接 ATOM 服务：'+s.connection_error,'查看连接','devices'];
  if(!paired.length)return['warn','还没有配对 ATOM 设备','配对设备','devices'];
  if(!online.length)return['warn','ATOM 设备当前离线，联网后会自动重连',null,null];
  if(!ready.length)return['warn','没有可用的 Agent，ATOM 发来的任务暂时无法执行','检查 Agent','agents'];
  if(!projects.length)return['warn','还没有授权项目，ATOM 暂时不能发起电脑任务','添加项目','projects'];
  return['ok','一切就绪：ATOM 可以向这台电脑发起任务',null,null];}

function render(s){lastState=s;
  // The simulator pairs like any device; keep it out of the real-device lane.
  const simId=simState?.device?.client_id;
  const paired=(s.paired||[]).filter(p=>!simId||p.client_id!==simId),agents=s.agents||[],projects=s.projects||[],tasks=s.tasks||[];
  const online=paired.filter(p=>p.online),ready=agents.filter(a=>a.available&&a.authenticated),active=tasks.filter(t=>ACTIVE.includes(t.status));
  const tone=relayTone(s),host=hostOf(s.relay_url);
  // Sidebar
  $('brand-host').textContent=s.name||'个人电脑伴侣';
  $('nav-devices').className='nav-dot '+(!s.configured||s.connection_error?'bad':online.length?'ok':paired.length?'warn':'');
  $('nav-agents').className='nav-dot '+(ready.length?'ok':'warn');
  $('nav-tasks').textContent=active.length?String(active.length):'';
  $('link-state').replaceChildren(h('i',{class:'dot '+(tone||'')}),h('span',{text:!s.configured?'未连接服务器':s.connection_error?'连接异常':'已连接 '+host}));
  // Overview topology
  $('overview-sub').textContent=(s.name||'这台电脑')+' 与 ATOM 的连接情况';
  setNode('node-mac','ok',s.name||'这台电脑','运行中');
  setNode('node-relay',tone,s.configured?host:'未配置',!s.configured?'未配置':s.connection_error?'连接异常':'已连接');
  setNode('node-device',online.length?'ok':paired.length?'warn':'',paired.length?paired.map(p=>p.name).join('、'):'尚未配对',online.length?online.length+' 台在线':paired.length?'离线':'未配对');
  $('wire-relay').className='wire '+tone;
  $('wire-device').className='wire '+(tone==='ok'&&online.length?'ok':tone==='bad'?'bad':'');
  const [hTone,hText,hAction,hPage]=health(s,{online,paired,ready,projects});
  $('health').className='health '+hTone;
  $('health').replaceChildren(h('span',{text:hText}),hAction?h('button',{class:'btn small',text:hAction,dataset:{page:hPage}}):'');
  $('tile-agent').textContent=ready.length?ready.map(a=>a.name).join(' · ')+' 就绪':'没有可用 Agent';
  $('tile-agent-sub').textContent=projects.length+' 个授权项目'+(active.length?' · '+active.length+' 个任务进行中':'');
  renderActivity();
  renderLinks();
  // Devices
  $('server-url').textContent=s.configured?s.relay_url:'还没有连接 ATOM 服务';
  $('server-detail').textContent=s.connection_error||(s.configured?'电脑名称：'+(s.name||'')+' · 客户端 '+(s.client_id||'').slice(0,8):'填写服务器地址后开始连接');
  $('server-pill').className='pill '+tone;$('server-pill').textContent=!s.configured?'未配置':s.connection_error?'连接异常':'已连接';
  if(!s.configured)$('config').hidden=false;
  const config=$('config');if(!config.dataset.hydrated){config.elements.relay_url.value=s.relay_url||'https://ldcx.tech/atom';config.elements.name.value=s.name||'我的 Mac';config.dataset.hydrated='true';}
  $('paired-count').textContent=paired.length?online.length+' / '+paired.length+' 在线':'';
  $('paired').replaceChildren(...paired.map(p=>row({icon:'device',tone:p.online?'ok':'',title:p.name,sub:(p.online?'在线':'离线')+' · '+({on:'端到端加密 · 安全码 '+p.safety_code,changed:'设备密钥发生变化，已停止接收任务，请解除配对后重新配对',mismatch:'本机密钥与服务器记录不一致，请解除配对后重新配对'}[p.e2e]||'未加密（对方客户端版本较旧）'),mono:false,end:[p.e2e==='on'?pill('已加密','info plain'):p.e2e==='off'?null:pill('需要重新配对','bad'),pill(p.online?'在线':'离线',p.online?'ok':''),h('button',{class:'btn ghost small',text:'解除配对',onclick:async e=>{if(!confirm('解除与「'+p.name+'」的配对？这台设备将不能再向电脑发任务，进行中的任务会被取消。需要时可以重新配对。'))return;e.target.disabled=true;try{await api('unpair',{client_id:p.client_id});note('已解除与 '+p.name+' 的配对');await refresh();}catch(err){note(err.message,true);e.target.disabled=false;}}})]})));
  if(!paired.length)$('paired').append(emptyState('还没有配对的设备','按下方步骤连接你的第一台 ATOM'));
  // Agents
  $('agents').replaceChildren(...agents.map(a=>{const ok=a.available&&a.authenticated;return h('div',{class:'card agent'},h('span',{class:'row-icon '+(ok?'ok':'')},icon('agent')),h('div',{class:'row-main'},h('strong',{text:a.name}),h('small',{text:a.reason||'尚未检测'})),pill(ok?'就绪':'待配置',ok?'ok':'warn'));}));
  if(!agents.length)$('agents').append(h('div',{class:'card'},emptyState('正在检测本机 Agent…')));
  // Projects
  $('projects').replaceChildren(...projects.map(p=>row({icon:'folder',title:p.name,sub:p.path,mono:true,end:[pill(p.read_only?'只读':'可修改',p.read_only?'plain':'warn plain'),h('button',{class:'btn ghost small',text:'移除','aria-label':'移除项目 '+p.name,onclick:async e=>{if(!confirm('移除项目「'+p.name+'」的授权？ATOM 将不能再在这个文件夹发起任务。'))return;e.target.disabled=true;try{await api('projects/remove',{id:p.id});note('已移除项目授权');await refresh();}catch(err){note(err.message,true);}finally{e.target.disabled=false;}}})]})));
  if(!projects.length)$('projects').append(emptyState('还没有授权项目','添加一个文件夹，ATOM 才能在这台电脑上发起任务'));
  renderTasks();
}

function taskLabel(t){return t.title||(t.kind==='app'?'生成应用':'电脑任务');}
function taskSub(t){const s=lastState||{},project=(s.projects||[]).find(p=>p.id===t.project_id),agent=(s.agents||[]).find(a=>a.id===t.agent_id),device=(s.paired||[]).find(p=>p.client_id===t.device_id);return [project?.name||'已移除的项目',agent?.name||t.agent_id,device?.name].filter(Boolean).join(' · ');}
function taskRow(t){const tone=statusTone[t.status]||'';return row({icon:t.kind==='app'?'pencil':'tasks',tone:tone==='ok'?'ok':tone==='bad'?'bad':tone==='info'?'info':tone==='warn'?'warn':'',title:taskLabel(t),sub:taskSub(t),meta:ago(t.created_at),end:[pill(statuses[t.status]||t.status,tone)]});}
function renderTasks(){const all=(lastState?.tasks||[]).slice().reverse(),f={all:()=>true,active:t=>ACTIVE.includes(t.status),done:t=>t.status==='completed',problem:t=>['failed','cancelled','interrupted'].includes(t.status)}[taskFilter],list=all.filter(f);
  $('task-list').replaceChildren(...list.map(taskRow));
  if(!list.length)$('task-list').append(all.length?emptyState('没有符合条件的任务'):emptyState('还没有任务','在 ATOM 的「我的电脑」中选择项目和 Agent，发起第一个任务'));}
function renderActivity(){const studioKinds={'app-modify':'AI 改造应用','notes-organize':'AI 整理便签'};
  const items=[...(lastState?.tasks||[]).map(t=>({at:t.created_at||0,el:()=>taskRow(t)})),...window.studioJobs.map(j=>({at:Date.parse(j.created_at)||0,el:()=>row({icon:'spark',tone:statusTone[j.status]==='ok'?'ok':statusTone[j.status]==='bad'?'bad':'info',title:studioKinds[j.kind]||'Studio 任务',sub:j.error||'在这台电脑上用 Codex 完成',meta:ago(j.created_at),end:[pill(statuses[j.status]||j.status,statusTone[j.status]||'')],onclick:()=>showPage(j.kind==='notes-organize'?'notes':'creations')})}))];
  items.sort((a,b)=>b.at-a.at);
  $('activity').replaceChildren(...items.slice(0,6).map(i=>i.el()));
  if(!items.length)$('activity').append(emptyState('还没有活动','ATOM 发来的任务和 AI 改造会显示在这里'));}
window.renderActivity=renderActivity;

async function refresh(){if(refreshing)return;refreshing=true;try{const s=await api('state');csrf=s.csrf;render(s);}catch(e){$('link-state').replaceChildren(h('i',{class:'dot bad'}),h('span',{text:'本机服务未连接'}));if(!lastState)note(e.message,true);}finally{refreshing=false;}}

function bindForm(id,route,convert,done){$(id).onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button:not([type=button])');b.disabled=true;try{await api(route,convert(Object.fromEntries(new FormData(e.target)),e.target));await done(e.target);await refresh();}catch(err){note(err.message,true);}finally{b.disabled=false;}};}
bindForm('config','configure',v=>v,()=>{note('连接设置已保存');$('config').hidden=true;});
bindForm('project','projects',(v,f)=>({path:v.path,name:v.name,read_only:!f.elements.write.checked}),f=>{note('项目已添加，可以在 ATOM 上选择它');f.reset();});
bindForm('pair','pair',v=>({code:v.code.trim()}),f=>{note('配对请求已发送，请在 ATOM 上确认');f.reset();});
$('server-edit').onclick=()=>{$('config').hidden=!$('config').hidden;};
$('server-cancel').onclick=()=>{$('config').hidden=true;};
$('task-filter').onclick=e=>{const b=e.target.closest('button');if(!b)return;taskFilter=b.dataset.filter;$('task-filter').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderTasks();};
$('diagnostics').onclick=async()=>{const b=$('diagnostics');b.disabled=true;try{await api('diagnostics',{});note('检测完成');await refresh();}catch(e){note(e.message,true);}finally{b.disabled=false;}};
if(window.webkit?.messageHandlers?.chooseFolder){$('choose-folder').hidden=false;$('choose-folder').onclick=()=>window.webkit.messageHandlers.chooseFolder.postMessage({});}

showPage('overview');
refresh();setInterval(refresh,3000);

/* Simulator: the Mac app runs the real device backend on 127.0.0.1:8790; this page shows its screen
   and the overview shows both test links (direct, and through the relay) next to the real device. */
const SIM_ORIGIN='http://127.0.0.1:8790',native=window.webkit?.messageHandlers?.simulator;
let devtools=false;try{devtools=localStorage.getItem('atom.connect.devtools')==='1';}catch{}
function applyDevtools(){document.documentElement.toggleAttribute('data-devtools',devtools);$('devtools').checked=devtools;
  $('steps-title').textContent=devtools?'上线步骤':'开始使用';$('steps-sub').textContent=devtools?'先在模拟设备上跑通，再换真机':'按顺序完成，ATOM 就能和这台电脑一起工作';
  $('real-lane-title').textContent=devtools?'正式 · 真机':'ATOM 小电脑';$('real-lane-sub').textContent=devtools?'测试通过后走这条链路':'这台电脑经服务器连接你的 ATOM';
  document.querySelectorAll('#node-relay strong,#node-simr-relay strong').forEach(n=>n.textContent=devtools?'中继服务器':'ATOM 服务');
  if(!devtools&&currentPage==='simulator')showPage('overview');}
$('devtools').onchange=e=>{devtools=e.target.checked;try{localStorage.setItem('atom.connect.devtools',devtools?'1':'0');}catch{}applyDevtools();refreshSimulator();renderLinks();};
window.addEventListener('atom:account',()=>renderLinks());
let accountPeers=[],peersLoading=false;
let simState=null,simNative=native?'stopped':'external',simMessage='',simPairing=false,simLoading=false;
function simAsk(action){if(native)native.postMessage({action});}
window.addEventListener('atom:simulator',e=>{simNative=e.detail?.state||'stopped';simMessage=e.detail?.message||'';refreshSimulator();});
async function refreshSimulator(){if(!devtools){simState=null;renderLinks();return;}if(simLoading)return;simLoading=true;try{simState=await api('simulator');}catch{simState={running:false};}finally{simLoading=false;}renderSimulator();renderLinks();}
function setWire(id,tone,label){const w=$(id);w.className='wire '+(tone||'');const l=$(id+'-label');if(l)l.textContent=label||'';}
function renderSimulator(){
  renderMirror();
  const running=!!simState?.running,starting=simNative==='starting'&&!running;
  $('nav-simulator').className='nav-dot '+(running?'ok':simNative==='error'?'bad':'');
  $('sim-pill').replaceChildren(pill(running?'运行中':starting?'正在启动':simNative==='error'?'已停止':'未启动',running?'ok':starting?'info':simNative==='error'?'bad':''));
  $('sim-toggle').textContent=running?'停止':'启动';$('sim-toggle').disabled=starting||(!native&&!running);
  $('sim-toggle').title=native?'':'请在 ATOM Connect App 中启动，或在终端运行 python3 atom/tools/simulator.py';
  const p=simState?.pairing||{},paired=p.mac_sees_device&&p.device_sees_mac;
  $('sim-pair').hidden=!running||!simState?.device?.configured||paired;$('sim-pair').disabled=simPairing;
  $('sim-sub').textContent=running?(simState.apps||0)+' 个应用 · 本机直连 '+simState.direct_ms+' ms'+(paired?' · 已经中继与这台 Mac 配对':''):'在这台 Mac 上运行 ATOM 小电脑和全部应用';
  const frame=$('sim-frame');
  if(running){if(!frame.src)frame.src=SIM_ORIGIN+'/simulator';frame.hidden=false;$('sim-empty').hidden=true;}
  else{if(frame.src)frame.removeAttribute('src');frame.hidden=true;$('sim-empty').hidden=false;
    $('sim-empty-detail').textContent=starting?'正在启动，第一次需要几秒钟安装应用。':simMessage||(native?'点「启动」后，屏幕会显示在这里。':'请在 ATOM Connect App 中打开，或在终端运行 python3 atom/tools/simulator.py。');}
}
function renderLinks(){
  const s=lastState;if(!s)return;
  const sim=simState||{},d=sim.device||{},p=sim.pairing||{},running=!!sim.running,relayOk=s.configured&&!s.connection_error;
  const sameRelay=d.relay_url&&s.relay_url&&d.relay_url.replace(/\/$/,'')===s.relay_url.replace(/\/$/,'');
  const simRelay=running&&d.configured&&!d.error&&sameRelay,paired=p.mac_sees_device&&p.device_sees_mac,bothOnline=paired&&p.device_online_for_mac&&p.mac_online_for_device;
  // Lane 1: direct
  setNode('node-sim-mac','ok',s.name||'这台电脑','运行中');
  setNode('node-sim',running?'ok':simNative==='error'?'bad':'',running?(sim.apps||0)+' 个应用':'未启动',running?'在线':simNative==='starting'?'启动中':'离线');
  setWire('wire-sim-direct',running?'ok':simNative==='error'?'bad':'',running?sim.direct_ms+' ms · 127.0.0.1':'');
  // Lane 2: through the relay
  setNode('node-simr-mac',relayOk?'ok':'warn',s.name||'这台电脑',relayOk?'已连接':'未连接');
  setNode('node-simr-relay',relayOk?'ok':s.configured?'bad':'',hostOf(s.relay_url)||'未配置',relayOk?'可用':s.configured?'连接异常':'未配置');
  setNode('node-simr',bothOnline?'ok':simRelay?'warn':running&&d.error?'bad':'',d.name||'模拟设备',!running?'未启动':!d.configured?'未注册':d.error?'连接异常':!s.relay_url?'等 Mac 连上中继':!sameRelay?'服务器不同':!paired?'未配对':bothOnline?'已配对 · 在线':'已配对 · 离线');
  setWire('wire-simr-relay',relayOk?'ok':s.configured?'bad':'');
  setWire('wire-simr-device',bothOnline?'ok':running&&d.error?'bad':'');
  // Steps: developers rehearse on the simulator first; everyone else gets a plain setup checklist.
  const real=(s.paired||[]).filter(x=>x.client_id!==d.client_id),realOnline=real.filter(x=>x.online);
  const tasks=s.tasks||[],simTask=tasks.find(t=>d.client_id&&t.device_id===d.client_id),realTask=tasks.find(t=>t.device_id&&real.some(r=>r.client_id===t.device_id));
  const ready=(s.agents||[]).filter(a=>a.available&&a.authenticated),projects=s.projects||[],user=window.atomAccount;
  const invitable=accountPeers.filter(x=>!x.paired&&!x.pending),waiting=accountPeers.filter(x=>x.pending);
  const realStep=[realOnline.length>0,devtools?'真机配对并在线':'连接你的 ATOM 小电脑',realOnline.length?realOnline.map(x=>x.name).join('、')+' 在线':real.length?real.map(x=>x.name).join('、')+' 离线，开机联网后会自动连上':(waiting.length?'已向 '+waiting.map(x=>x.name).join('、')+' 发出请求，请在小电脑上点「允许连接」':invitable.length?'账号下发现 '+invitable.map(x=>x.name).join('、')+'，点「连接」，再到小电脑上允许':'在小电脑上登录同一个账号，它会出现在这里；也可以用配对码'),invitable.length?'连接 '+invitable[0].name:'去配对',invitable.length?()=>invitePeer(invitable[0]):()=>showPage('devices')];
  const taskStep=[!!realTask,devtools?'从真机发起一次电脑任务':'从小电脑发起第一个任务',realTask?'已收到：'+(realTask.title||'任务')+' · '+(statuses[realTask.status]||realTask.status):'在小电脑「我的电脑」里选这台电脑、项目和 Agent，说出需求'];
  const steps=devtools?[
    [running,'启动模拟设备',running?(sim.apps||0)+' 个应用已安装':'在 ATOM Connect 中启动','启动',()=>{showPage('simulator');simAsk('start');}],
    [running&&sim.direct_ms!=null,'本机直连',running?'Mac ⇄ 模拟设备 '+sim.direct_ms+' ms，不经过服务器':'模拟设备启动后自动检测'],
    [relayOk,'这台 Mac 连上中继服务器',relayOk?hostOf(s.relay_url):s.connection_error||'在「设备与连接」里填写服务器','去设置',()=>showPage('devices')],
    [simRelay,'模拟设备连上同一个中继',!running?'等模拟设备启动':!d.configured?'模拟设备尚未注册':d.error?d.error:!sameRelay?'模拟设备连的是 '+hostOf(d.relay_url):hostOf(d.relay_url)],
    [bothOnline,'模拟设备与这台 Mac 经中继配对',bothOnline?'双方都能看到对方在线'+(p.e2e==='on'?' · 端到端加密':''):paired?'已配对，等待双方上线':'自动完成配对码、认领和设备确认','一键配对',simRelay&&!paired?pairSim:null],
    [!!simTask,'从模拟设备发起一次电脑任务',simTask?'已收到：'+(simTask.title||'任务')+' · '+(statuses[simTask.status]||simTask.status):'在模拟设备打开「我的电脑」，选这台 Mac 发一个任务'],
    realStep,taskStep
  ]:[
    [relayOk,'连接 ATOM 服务',relayOk?'已连接 '+hostOf(s.relay_url):s.connection_error?'连接异常：'+s.connection_error:'服务器地址已经填好，确认电脑名称后保存','去连接',()=>showPage('devices')],
    [!!user,'登录 ATOM 账号',user?'已登录 '+user.username+' · 随手记、今日、相册与小电脑同步':'和小电脑用同一个账号，内容会自动同步','登录',()=>$('studio-account')?.click()],
    realStep,
    [ready.length>0,'准备电脑 Agent',ready.length?ready.map(a=>a.name).join('、')+' 可用':'安装并登录 Codex，ATOM 才能让这台电脑干活','检查',()=>showPage('agents')],
    [projects.length>0,'授权一个项目文件夹',projects.length?projects.length+' 个文件夹已授权':'选一个允许 Agent 工作的文件夹，不要授权整个磁盘','添加',()=>showPage('projects')],
    taskStep
  ];
  const first=steps.findIndex(x=>!x[0]);
  // The checklist already says what is missing; the banner only adds noise until setup is done.
  if(!devtools&&first>=0)$('health').hidden=true;else $('health').hidden=false;
  $('launch-steps').replaceChildren(...steps.map(([done,title,detail,action,run],i)=>h('li',{class:done?'ok':i===first?'now':''},
    h('span',{class:'step-mark',text:done?'✓':String(i+1)}),h('div',{class:'step-main'},h('strong',{text:title}),h('small',{text:detail||''})),
    !done&&action&&run&&(i===first||(devtools&&i===4))?h('button',{class:'btn small'+(i===first?' primary':''),text:action,onclick:run}):null)));
}
async function pairSim(){if(simPairing)return;simPairing=true;renderSimulator();note('正在经中继配对模拟设备…');
  try{simState=await api('simulator/pair',{});note('模拟设备已与这台 Mac 配对');await refresh();}catch(e){note(e.message,true);}finally{simPairing=false;refreshSimulator();}}
$('sim-pair').onclick=pairSim;
$('sim-toggle').onclick=()=>{if(simState?.running){simAsk('stop');simNative='stopped';}else{simAsk('start');simNative='starting';}renderSimulator();setTimeout(refreshSimulator,600);};
applyDevtools();refreshSimulator();setInterval(refreshSimulator,2000);

/* Same-account discovery: devices signed in to this account, connectable without a code. */
async function refreshPeers(){if(peersLoading)return;peersLoading=true;try{const r=await api('account/peers');accountPeers=r.peers||[];renderPeers(r);}catch{accountPeers=[];}finally{peersLoading=false;}renderLinks();}
function renderPeers(r){const list=$('account-peers');
  $('account-peers-note').textContent=!window.atomAccount?'登录账号后显示':r.linked?'同账号设备不用配对码':'';
  if(!window.atomAccount){list.replaceChildren(emptyState('登录 ATOM 账号后显示','小电脑也登录同一个账号，就会出现在这里'));return;}
  if(!accountPeers.length){list.replaceChildren(emptyState('账号下还没有其他 ATOM','在小电脑上登录这个账号，几秒后会出现在这里'));return;}
  list.replaceChildren(...accountPeers.map(p=>row({icon:'device',tone:p.paired?'ok':p.online?'':'',title:p.name,sub:p.paired?'已连接':p.pending?'等待小电脑上点「允许连接」':p.online?'在线 · 可以连接':'离线 · 开机联网后可以连接',
    end:p.paired||p.pending?[]:[h('button',{class:'btn small primary',text:'连接',onclick:()=>invitePeer(p)})]})));}
async function invitePeer(p){try{await api('account/invite',{device_id:p.client_id});note('已向 '+p.name+' 发出连接请求，请在小电脑上点「允许连接」');}catch(e){note(e.message,true);}refreshPeers();}
window.addEventListener('atom:account',refreshPeers);refreshPeers();setInterval(refreshPeers,5000);

var mirrorVersion='',mirrorBusy=false,mirrorAuthorized=false;
function renderMirror(){const select=$('mirror-device');if(!select)return;const id=select.value,peers=(lastState?.paired||[]).filter(p=>p.client_id!==simState?.device?.client_id&&p.e2e==='on');const options=peers.map(p=>p.client_id+'|'+p.name).join();if(select.dataset.options!==options){select.replaceChildren(new Option('选择已配对的真机',''),...peers.map(p=>new Option(p.name,p.client_id)));select.dataset.options=options;select.value=id;}
$('mirror-start').disabled=mirrorBusy||!simState?.running||!select.value;
const peer=peers.find(p=>p.client_id===select.value);if($('mirror-auto').checked&&mirrorAuthorized&&peer?.snapshot?.version&&peer.snapshot.version!==mirrorVersion&&!mirrorBusy&&simState?.running)void syncMirror(false);}
async function syncMirror(ask=true){const id=$('mirror-device').value;if(!id||mirrorBusy)return;if(ask&&!confirm('用这台真机的桌面布局与应用记录覆盖模拟设备？真机不会被修改。'))return;mirrorAuthorized=true;mirrorBusy=true;renderMirror();$('mirror-note').textContent='正在同步…';try{const r=await api('simulator/mirror',{device_id:id,confirm:true});mirrorVersion=r.version;$('mirror-note').textContent='已送达模拟设备 · 打开画面后载入 · '+new Date(r.updated*1000).toLocaleTimeString();}catch(e){$('mirror-note').textContent=e.message;$('mirror-auto').checked=false;}finally{mirrorBusy=false;renderMirror();}}
$('mirror-start').onclick=()=>syncMirror(true);
$('mirror-device').onchange=()=>{mirrorVersion='';mirrorAuthorized=false;$('mirror-auto').checked=false;renderMirror();};
$('mirror-auto').onchange=()=>{if($('mirror-auto').checked)void syncMirror(true);};
