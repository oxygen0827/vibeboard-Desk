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
const pages=['overview','devices','tasks','agents','projects','notes','agenda','photos','market','creations','settings'];
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
  if(!s.configured)return['warn','还没有连接中继服务器','去设置','devices'];
  if(s.connection_error)return['bad','无法连接中继服务器：'+s.connection_error,'查看连接','devices'];
  if(!paired.length)return['warn','还没有配对 ATOM 设备','配对设备','devices'];
  if(!online.length)return['warn','ATOM 设备当前离线，联网后会自动重连',null,null];
  if(!ready.length)return['warn','没有可用的 Agent，ATOM 发来的任务暂时无法执行','检查 Agent','agents'];
  if(!projects.length)return['warn','还没有授权项目，ATOM 暂时不能发起电脑任务','添加项目','projects'];
  return['ok','一切就绪：ATOM 可以向这台电脑发起任务',null,null];}

function render(s){lastState=s;
  const paired=s.paired||[],agents=s.agents||[],projects=s.projects||[],tasks=s.tasks||[];
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
  // Devices
  $('server-url').textContent=s.configured?s.relay_url:'未配置中继服务器';
  $('server-detail').textContent=s.connection_error||(s.configured?'电脑名称：'+(s.name||'')+' · 客户端 '+(s.client_id||'').slice(0,8):'填写服务器地址后开始连接');
  $('server-pill').className='pill '+tone;$('server-pill').textContent=!s.configured?'未配置':s.connection_error?'连接异常':'已连接';
  if(!s.configured)$('config').hidden=false;
  const config=$('config');if(!config.dataset.hydrated){config.elements.relay_url.value=s.relay_url||'';config.elements.name.value=s.name||'我的 Mac';config.dataset.hydrated='true';}
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
if(window.webkit?.messageHandlers?.openSimulator){$('open-simulator').hidden=false;$('open-simulator').onclick=()=>window.webkit.messageHandlers.openSimulator.postMessage({});}
if(window.webkit?.messageHandlers?.chooseFolder){$('choose-folder').hidden=false;$('choose-folder').onclick=()=>window.webkit.messageHandlers.chooseFolder.postMessage({});}

showPage('overview');
refresh();setInterval(refresh,3000);
