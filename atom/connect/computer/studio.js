/* ATOM Studio local workbench: market, creations, synced notes and agenda. Untrusted source is text-only or sandboxed. */
(()=>{
const el=id=>document.getElementById(id),call=(route,body)=>api('studio'+route,body),dialog=el('studio-dialog');
let account=null,editing=null,file='index.html',buffer=null,job=null,poll=null,notes=[],selectedNote=null,agenda=[],organizePoll=null,drafts=null;
const categories={life:'日常生活',companion:'陪伴',sound:'声音',play:'互动玩具',connect:'连接'};
const timestamp=value=>typeof value==='number'?(value<100000000000?value*1000:value):Date.parse(value)||0;
const authorOf=work=>work.author?.username||work.author?.name||String(work.author||'作者');

function error(e){note(e.message||String(e),true);}
function button(label,fn,cls='btn'){return h('button',{type:'button',class:cls,text:label,onclick:async e=>{const b=e.currentTarget;b.disabled=true;try{await fn();}catch(err){error(err);}finally{b.disabled=false;}}});}
function text(tag,value,cls){return h(tag,{class:cls,text:value});}
function clearDialog(title){el('dialog-title').textContent=title;el('dialog-content').replaceChildren();if(!dialog.open)dialog.showModal();return el('dialog-content');}
el('dialog-close').onclick=()=>dialog.close();

// Account
async function studioState(){const s=await call('/state');account=s.user;window.studioJobs=s.jobs||[];
  el('account-avatar').replaceChildren(account?account.username.slice(0,1).toUpperCase():icon('user'));el('account-avatar').classList.toggle('on',!!account);
  el('account-name').textContent=account?account.username:'未登录';
  el('account-detail').textContent=!account?'登录市场账号以同步':s.pending_notes?s.pending_notes+' 条便签待同步':'市场账号 · 已同步';
  window.renderActivity?.();return s;}
async function needAccount(){await studioState();if(!account){accountDialog();return false;}return true;}
function accountDialog(){const box=clearDialog(account?'市场账号':'登录市场账号');
  if(account){box.append(h('div',{class:'row'},h('span',{class:'avatar on',text:account.username.slice(0,1).toUpperCase()}),h('div',{class:'row-main'},h('strong',{text:account.username}),h('small',{text:'草稿、随手记和今日属于此账号'}))),text('p','退出后，离线未同步的内容仍保存在这台电脑，不会被删除。','muted'),h('div',{class:'button-row'},button('退出登录',async()=>{await call('/logout',{});account=null;editing=null;dialog.close();await studioState();note('已退出市场账号');})));return;}
  let mode='login';
  const seg=h('div',{class:'segmented'},...[['login','登录'],['register','创建账号']].map(([v,l])=>h('button',{type:'button',class:v===mode?'on':'',text:l,onclick:e=>{mode=v;seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===e.currentTarget));password.autocomplete=v==='login'?'current-password':'new-password';submit.textContent=v==='login'?'登录':'创建并登录';}})));
  const user=h('input',{placeholder:'用户名',name:'username',autocomplete:'username',required:true});
  const password=h('input',{type:'password',name:'password',placeholder:'密码（至少 12 位）',autocomplete:'current-password',required:true,minlength:'12'});
  const submit=h('button',{class:'btn primary',text:'登录'});
  const status=text('p','市场账号与 Codex 等模型账号相互独立；密码不会发送给 AI。','muted');
  const form=h('form',{},seg,h('label',{},'用户名',user),h('label',{},'密码',password),submit,status);
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await call('/'+mode,{username:user.value,password:password.value});password.value='';dialog.close();await studioState();note('市场账号已连接');window.dispatchEvent(new CustomEvent('atom:page',{detail:currentPage}));}catch(err){status.textContent=err.message;status.className='';}finally{submit.disabled=false;}};
  box.append(form);user.focus();}
el('studio-account').onclick=async()=>{try{await studioState();accountDialog();}catch(e){error(e);}};

// Source viewer shared by market and dialogs
function showBundle(box,bundle){const values={'manifest.json':JSON.stringify(bundle.manifest,null,2),...bundle.files},pre=h('pre'),list=h('div',{class:'source-list'});
  for(const [name,content]of Object.entries(values)){const b=h('button',{type:'button',text:name,onclick:()=>{pre.textContent=content;list.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));}});list.append(b);}
  pre.textContent=values['manifest.json'];list.firstChild?.classList.add('selected');box.append(h('div',{class:'source-view'},list,pre));}

// Market
function workCard(work,onclick){return h('button',{type:'button',class:'work',onclick},h('span',{class:'work-icon cat-'+(work.category||'life'),text:(work.title||'?').slice(0,1)}),h('strong',{},work.title,work.official?pill('官方','info plain'):null),h('p',{text:work.description||'暂无介绍'}),h('small',{text:authorOf(work)+' · '+(categories[work.category]||work.category||'')}));}
async function catalog(){const box=el('market-catalog');box.replaceChildren(text('p','正在打开市场…','muted'));
  try{studioState().catch(()=>{});const form=el('market-search'),q=new URLSearchParams({q:form.elements.q.value,category:form.elements.category.value}),r=await call('/catalog?'+q);
    box.replaceChildren(...r.works.map(w=>workCard(w,()=>workDetail(w.id).catch(error))));
    if(!r.works.length)box.append(h('div',{class:'card'},emptyState('没有匹配的作品','换个关键词或分类试试')));}
  catch(e){box.replaceChildren(h('div',{class:'card'},emptyState('无法打开市场',e.message)));}}
el('market-search').onsubmit=e=>{e.preventDefault();catalog();};
let searchTimer=null;el('market-search').elements.q.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(catalog,300);};
el('market-chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;el('market-search').elements.category.value=b.dataset.category;el('market-chips').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));catalog();};
async function workDetail(workId){const result=await call('/works/'+encodeURIComponent(workId)),work=result.work,box=clearDialog(work.title);
  const meta=h('dl',{class:'meta'},h('dt',{text:'作者'}),h('dd',{text:authorOf(work)}),h('dt',{text:'分类'}),h('dd',{text:categories[work.category]||work.category}),h('dt',{text:'许可'}),h('dd',{text:work.license}),h('dt',{text:'作品 ID'}),h('dd',{text:work.id}));
  if(work.parent_id)meta.append(h('dt',{text:'派生自'}),h('dd',{},h('button',{type:'button',class:'link',text:work.parent_id+' / 版本 '+work.parent_version_id,onclick:()=>workDetail(work.parent_id).catch(error)})));
  const select=h('select',{'aria-label':'版本'},...(result.versions||[]).map(v=>new Option('版本 '+v.number+' · '+(v.changelog||'首次发布'),v.id)));
  const source=h('div');
  async function loadSource(){source.replaceChildren(text('p','正在读取完整源码…','muted'));const r=await call('/versions/'+encodeURIComponent(select.value));source.replaceChildren(text('p',Object.keys(r.bundle.files).length+' 个文件 · SHA-256 '+(r.version.sha256||r.version.source_sha256||'见服务器记录'),'muted lineage'));showBundle(source,r.bundle);}
  select.onchange=()=>loadSource().catch(error);
  const fork=button('基于此版本创作',async()=>{if(!await needAccount())return;const r=await call('/forks',{version_id:select.value,title:work.title+' · 我的版本'});dialog.close();showPage('creations');await openEditor(r.draft.id);},'btn primary');
  box.append(text('p',work.description||''),meta,h('div',{class:'button-row'},select,fork),source);
  if(result.derivatives?.length){box.append(text('h3','由此衍生'),h('div',{class:'button-row'},...result.derivatives.map(d=>button(d.title,()=>workDetail(d.id)))));}
  if(select.value)await loadSource();}

// Creations
async function loadCreations(){if(!await needAccount()){el('creations-list').replaceChildren(h('div',{class:'card'},emptyState('需要登录市场账号','登录后可以查看和编辑你的草稿')));return;}
  el('studio-editor').hidden=true;el('creations-home').hidden=false;el('creations-list').replaceChildren(text('p','正在读取草稿…','muted'));
  const r=await call('/drafts');drafts=r.drafts;
  el('creations-list').replaceChildren(...r.drafts.map(d=>{const card=workCard({...d,description:(d.parent_id?'派生作品':'原创')+' · '+d.license+' · 修订 '+d.revision,author:account?.username},()=>openEditor(d.id));card.classList.add('draft');return card;}));
  if(!r.drafts.length)el('creations-list').append(h('div',{class:'card'},emptyState('还没有草稿','在「发现」里打开一个作品，点「基于此版本创作」获得完整源码'),h('div',{class:'form-actions'},h('button',{class:'btn primary',text:'去发现',dataset:{page:'market'}}))));}
el('creations-refresh').onclick=()=>loadCreations().catch(error);
const dirtyState=()=>el('editor-dirty').dataset.state;
function setDirty(state){const map={saved:['已同步','ok'],local:['本机有修改','warn'],unsaved:['尚未保存','bad']},[label,tone]=map[state];el('editor-dirty').textContent=label;el('editor-dirty').className='pill '+tone;el('editor-dirty').dataset.state=state;}
function collect(){if(!editing)return;if(file==='manifest.json')buffer.manifest=JSON.parse(el('editor-source').value);else buffer.files[file]=el('editor-source').value;}
function chooseFile(name){collect();file=name;el('editor-source').value=name==='manifest.json'?JSON.stringify(buffer.manifest,null,2):buffer.files[name];document.querySelectorAll('#editor-files button').forEach(b=>b.classList.toggle('selected',b.dataset.file===name));}
function drawEditor(){el('editor-title').textContent=editing.draft.title;setDirty(editing.dirty?'local':'saved');
  el('editor-files').replaceChildren(...['manifest.json',...Object.keys(buffer.files)].map(name=>{const b=h('button',{type:'button',text:name,class:name===file?'selected':'',onclick:()=>{try{chooseFile(name);}catch(e){error(e);}}});b.dataset.file=name;return b;}));
  el('editor-source').value=file==='manifest.json'?JSON.stringify(buffer.manifest,null,2):buffer.files[file]||'';
  el('editor-snapshots').replaceChildren(...[...editing.snapshots||[]].reverse().map(s=>new Option(s.label+' · '+new Date(s.created_at).toLocaleString(),s.id)));
  if(!el('editor-snapshots').options.length)el('editor-snapshots').append(new Option('还没有快照',''));
  const d=editing.draft;el('editor-lineage').textContent='许可 '+d.license+(d.parent_id?' · 上游 '+d.parent_id+' / '+d.parent_version_id:' · 原创')+(editing.source_path?' · 本机源码 '+editing.source_path:'');}
async function openEditor(draftId){try{await call('/drafts/'+encodeURIComponent(draftId));editing=await call('/workspaces/'+encodeURIComponent(draftId));buffer=JSON.parse(JSON.stringify(editing.bundle));file='index.html';
  el('creations-home').hidden=true;el('studio-editor').hidden=false;drawEditor();refreshPreview();el('ai-state').replaceChildren();
  const state=await studioState(),previous=state.jobs.filter(j=>j.draft_id===draftId).slice(-1)[0];if(previous)await watchJob(previous.id);}catch(e){error(e);}}
function refreshPreview(){if(editing)el('editor-preview').src='/api/studio/previews/'+encodeURIComponent(editing.draft.id)+'?v='+Date.now();}
async function saveLocal(){collect();const value=await call('/workspaces/'+editing.draft.id+'/save',{bundle:buffer});editing=value;buffer=JSON.parse(JSON.stringify(value.bundle));drawEditor();refreshPreview();return value;}
el('editor-source').oninput=()=>setDirty('unsaved');
el('editor-source').onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const t=e.target,s=t.selectionStart;t.setRangeText('  ',s,t.selectionEnd,'end');setDirty('unsaved');}if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();saveLocal().then(()=>note('已保存到本机')).catch(error);}};
el('editor-back').onclick=async()=>{if(dirtyState()==='unsaved'&&!confirm('源码尚未保存，离开前要放弃这些编辑吗？'))return;await loadCreations().catch(error);};
el('editor-save').onclick=()=>saveLocal().then(()=>note('完整源码已保存到本机')).catch(error);
el('editor-sync').onclick=async()=>{try{await saveLocal();await call('/drafts/'+editing.draft.id+'/save',{revision:editing.draft.revision});editing=await call('/workspaces/'+editing.draft.id);drawEditor();note('草稿已同步到市场账号');}catch(e){if(e.status===409)conflictDialog();else error(e);}};
function conflictDialog(){const box=clearDialog('草稿已有新版本');
  box.append(text('p','服务器上的草稿已更新。本机完整修改与快照已保留，没有覆盖服务器。'),text('p','可以先查看最新版本，再决定如何处理。','muted'),
    h('div',{class:'button-row'},
      button('查看服务器源码',async()=>{const r=await call('/workspaces/'+editing.draft.id+'/server');showBundle(clearDialog('服务器版本 · 修订 '+r.draft.revision),r.bundle);}),
      button('采用服务器版本',async()=>{if(!confirm('采用服务器版本？本机修改会先保存为完整快照。'))return;editing=await call('/workspaces/'+editing.draft.id+'/resolve',{decision:'server'});buffer=JSON.parse(JSON.stringify(editing.bundle));dialog.close();drawEditor();refreshPreview();}),
      button('用本机内容更新服务器',async()=>{if(!confirm('确定用当前本机完整源码更新服务器版本？请先检查差异。'))return;editing=await call('/workspaces/'+editing.draft.id+'/resolve',{decision:'local',confirm:true});dialog.close();drawEditor();note('已按你的选择同步本机内容');}),
      button('稍后处理',()=>dialog.close(),'btn ghost')));}
el('editor-preview-refresh').onclick=()=>saveLocal().catch(error);
el('editor-open-preview').onclick=async()=>{try{await saveLocal();const box=clearDialog('应用预览 · 480 × 360');box.append(h('iframe',{class:'modal-preview',sandbox:'allow-scripts',title:'完整应用预览',src:'/api/studio/previews/'+editing.draft.id+'?v='+Date.now()}),text('p','网络与设备能力已禁用；预览中的保存只是暂存。','muted'));}catch(e){error(e);}};
el('editor-delete-file').onclick=()=>{try{collect();if(['manifest.json','index.html','icon.svg'].includes(file))throw Error('应用入口、图标与清单必须保留');if(!confirm('删除文件 '+file+'？保存时会保留前一版快照。'))return;delete buffer.files[file];file='index.html';drawEditor();setDirty('unsaved');}catch(e){error(e);}};
el('editor-add-file').onclick=()=>{const name=prompt('文件名，例如 assets/tool.js');if(!name)return;try{collect();if(!/^[A-Za-z0-9_.\/-]+$/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..')||name==='manifest.json')throw Error('请输入安全的相对文件名');if(Object.hasOwn(buffer.files,name))throw Error('文件已存在');buffer.files[name]='';file=name;drawEditor();setDirty('unsaved');}catch(e){error(e);}};
el('editor-snapshot').onclick=async()=>{try{await saveLocal();await call('/workspaces/'+editing.draft.id+'/snapshot',{label:'手动快照'});editing=await call('/workspaces/'+editing.draft.id);drawEditor();note('已创建完整源码快照');}catch(e){error(e);}};
el('editor-restore').onclick=async()=>{if(!el('editor-snapshots').value)return note('还没有可恢复的快照',true);if(!confirm('恢复所选快照？当前源码会先保存为另一个快照，服务器内容不会直接改变。'))return;try{editing=await call('/workspaces/'+editing.draft.id+'/restore',{snapshot_id:el('editor-snapshots').value});buffer=JSON.parse(JSON.stringify(editing.bundle));drawEditor();refreshPreview();note('已恢复到本机，请检查后同步');}catch(e){error(e);}};
el('editor-diff').onclick=async()=>{try{const snapshotId=el('editor-snapshots').value;if(!snapshotId)throw Error('还没有可比较的快照');await saveLocal();const r=await call('/workspaces/'+editing.draft.id+'/diff?snapshot_id='+encodeURIComponent(snapshotId)),box=clearDialog('与快照的差异');
  if(!r.files.length)box.append(text('p','与所选快照没有差异。'));
  for(const change of r.files)box.append(text('h3',change.name+' · '+change.kind),h('div',{class:'source-diff'},text('pre','之前\n'+(change.before??'文件不存在')),text('pre','现在\n'+(change.after??'文件已删除'))));}catch(e){error(e);}};
el('editor-publish').onclick=async()=>{try{await saveLocal();const box=clearDialog('发布到应用市场');
  const changes=h('textarea',{placeholder:'这次修改了什么？',rows:'3'}),checkbox=h('input',{type:'checkbox'});
  box.append(text('p','发布会公开全部源码与安装资源。上游作者、版本和许可证会保留；发布后的版本不可修改。'),h('dl',{class:'meta'},h('dt',{text:'作品'}),h('dd',{text:editing.draft.title}),h('dt',{text:'许可'}),h('dd',{text:editing.draft.license})),h('label',{},'更新说明',changes),h('label',{class:'check'},checkbox,h('span',{text:'我已检查全部源码，没有账号密钥或私人信息，并同意按上述许可证公开发布。'})),
    h('div',{class:'form-actions'},button('确认发布',async()=>{if(!checkbox.checked)throw Error('请先确认源码可以公开');await call('/drafts/'+editing.draft.id+'/save',{revision:editing.draft.revision});editing=await call('/workspaces/'+editing.draft.id);const r=await call('/drafts/'+editing.draft.id+'/publish',{revision:editing.draft.revision,changelog:changes.value,confirm:true});dialog.close();drawEditor();note('已发布版本 '+r.version.number+'，完整源码已公开');},'btn primary')));}catch(e){error(e);}};

// AI modification
el('ai-modify').onclick=async()=>{try{if(!el('ai-change').value.trim())throw Error('先描述你想怎么修改');await saveLocal();const r=await call('/ai-modify',{draft_id:editing.draft.id,prompt:el('ai-change').value});await watchJob(r.job.id);}catch(e){error(e);}};
el('ai-change').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)el('ai-modify').click();};
async function watchJob(jobId){if(poll)clearTimeout(poll);const r=await call('/ai-jobs/'+jobId);job=r.job;const area=el('ai-state');
  const labels={queued:'等待启动',running:'Codex 正在改造完整应用…',saving:'正在校验并同步完整源码…',waiting_approval:'等待你确认操作',completed:'修改已完成，完整源码已同步',failed:'修改失败：',cancelled:'修改已取消',interrupted:'修改中断：',conflict:'结果已保留：'};
  area.replaceChildren(pill(statuses[job.status]||job.status,statusTone[job.status]||''),text('span',(labels[job.status]||'')+(job.error||'')));
  const busy=ACTIVE.includes(job.status);el('ai-cancel').hidden=!['queued','running','waiting_approval'].includes(job.status);el('ai-modify').disabled=busy;el('editor-source').readOnly=busy;
  for(const id of ['editor-add-file','editor-delete-file','editor-save','editor-sync','editor-restore','editor-publish'])el(id).disabled=busy;
  if(job.approval)area.append(button('允许',()=>call('/ai-jobs/'+job.id+'/approve',{request_id:job.approval.request_id,decision:'accept'}),'btn primary small'),button('拒绝',()=>call('/ai-jobs/'+job.id+'/approve',{request_id:job.approval.request_id,decision:'decline'}),'btn small'));
  if(['conflict','failed','interrupted'].includes(job.status)&&job.artifact)area.append(button('查看保留的源码',()=>showBundle(clearDialog('AI 保留产物'),job.artifact),'btn small'),button('应用到当前草稿',async()=>{if(!confirm('将保留的 AI 产物应用到当前草稿？现有内容会先保存快照。'))return;await call('/ai-jobs/'+job.id+'/apply',{});await openEditor(job.draft_id);},'btn small'));
  if(job.status==='completed'&&editing?.draft.id===job.draft_id){editing=await call('/workspaces/'+job.draft_id);buffer=JSON.parse(JSON.stringify(editing.bundle));drawEditor();refreshPreview();}
  if(busy)poll=setTimeout(()=>watchJob(jobId).catch(error),1000);}
el('ai-cancel').onclick=async()=>{try{await call('/ai-jobs/'+job.id+'/cancel',{});note('正在停止 AI 修改');}catch(e){error(e);}};

// Notes
function noteFlag(n){return n.conflict?['同步冲突','flag bad']:n.pending?['待同步','flag']:n.deleted?['已删除','']:[ago(n.updated_at),''];}
function setNote(n){selectedNote=n;const form=el('note-editor');form.elements.id.value=n?.id||'';form.elements.text.value=n?.text||'';form.elements.pinned.checked=!!n?.pinned;
  el('note-delete').textContent=n?.deleted?'恢复':'删除';el('note-delete').hidden=!n;
  el('note-status').textContent=n?(n.deleted?'已删除，可以恢复':n.pending?'已保存在本机，等待同步':'已同步'):'新便签';
  document.querySelectorAll('.note-item').forEach(b=>b.classList.toggle('selected',b.dataset.id===n?.id));
  const box=el('note-conflict');box.replaceChildren();box.className='';
  if(n?.conflict){box.className='conflict';box.append(text('p','另一台设备也修改了这条便签，两份内容都已保留。'),text('pre','服务器版本：'+(n.conflict.current?.text||'见服务器')),
    button('使用服务器版本',async()=>{await call('/notes/resolve',{id:n.id,decision:'server'});await loadNotes();setNote(null);},'btn small'),
    button('本机内容另存为新便签',async()=>{await call('/notes/resolve',{id:n.id,decision:'copy'});await call('/notes/sync',{});await loadNotes();setNote(null);},'btn small'));}}
function drawNotes(){const q=el('notes-filter').value.trim().toLowerCase(),list=notes.filter(n=>!q||n.text.toLowerCase().includes(q)).sort((a,b)=>Number(a.deleted)-Number(b.deleted)||Number(b.pinned)-Number(a.pinned)||timestamp(b.updated_at)-timestamp(a.updated_at));
  el('notes-list').replaceChildren(...list.map(n=>{const [flag,cls]=noteFlag(n);const b=h('button',{type:'button',class:'note-item'+(n.deleted?' deleted':'')+(selectedNote?.id===n.id?' selected':''),onclick:()=>setNote(n)},h('p',{text:n.text}),h('small',{},n.pinned?icon('pin'):null,h('span',{class:cls,text:flag})));b.dataset.id=n.id;return b;}));
  if(!list.length)el('notes-list').append(emptyState(q?'没有匹配的便签':'还没有便签',q?'':'在右侧写下第一条想法'));
  el('nav-notes').textContent=notes.filter(n=>!n.deleted).length||'';}
async function loadNotes(){if(!await needAccount())return;const r=await call('/notes');notes=r.notes||[];drawNotes();
  if(selectedNote){const updated=notes.find(n=>n.id===selectedNote.id);setNote(updated||null);}else setNote(null);
  el('notes-sub').textContent=r.offline?'当前离线，修改先保存在这台电脑':r.pending?r.pending+' 条等待同步':'与 ATOM 同步 · 共 '+notes.filter(n=>!n.deleted).length+' 条';
  updateSyncTile();}
el('notes-filter').oninput=drawNotes;
el('note-editor').onsubmit=async e=>{e.preventDefault();try{const form=e.target,r=await call('/notes',{id:form.elements.id.value||undefined,revision:selectedNote?.revision,text:form.elements.text.value,pinned:form.elements.pinned.checked,deleted:selectedNote?.deleted||false});selectedNote=r.note;await loadNotes();note(r.note.pending?'已保存在本机，联网后同步':'便签已同步');}catch(err){error(err);}};
el('note-editor').elements.text.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();el('note-editor').requestSubmit();}};
el('note-new').onclick=()=>{if(currentPage!=='notes')showPage('notes');setNote(null);el('note-editor').elements.text.focus();};
el('note-delete').onclick=async()=>{if(!selectedNote)return;try{await call('/notes',{...selectedNote,deleted:!selectedNote.deleted});await loadNotes();}catch(e){error(e);}};
el('notes-sync').onclick=()=>loadNotes().then(()=>note('随手记已同步')).catch(error);

// Agenda
function agendaRow(a){const r=h('div',{class:'agenda-row'+(a.done?' done':'')+(a.deleted?' deleted':'')});
  r.append(a.kind==='todo'&&!a.deleted&&!a.conflict?h('button',{type:'button',class:'tick'+(a.done?' on':''),'aria-label':a.done?'标记为未完成':'标记为完成',onclick:async()=>{try{await call('/agenda',{...a,done:!a.done});await loadAgenda();}catch(e){error(e);}}},a.done?icon('check'):''):h('span',{class:'when'},icon(a.kind==='todo'?'tasks':'today')));
  r.append(h('div',{class:'row-main'},h('strong',{text:a.title}),h('small',{text:[a.kind==='todo'?'待办':'日程',a.starts_at?new Date(a.starts_at).toLocaleString([], {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'',a.pending?'待同步':'',a.deleted?'已删除':''].filter(Boolean).join(' · ')})));
  if(a.conflict)r.append(pill('同步冲突','warn'),button('保留服务器',async()=>{await call('/agenda/resolve',{id:a.id,decision:'server'});await loadAgenda();},'btn small'),button('另存副本',async()=>{await call('/agenda/resolve',{id:a.id,decision:'copy'});await loadAgenda();},'btn small'));
  else r.append(h('div',{class:'row-actions'},button(a.deleted?'恢复':'删除',async()=>{await call('/agenda',{...a,deleted:!a.deleted});await loadAgenda();},'btn ghost small')));
  return r;}
async function loadAgenda(){if(!await needAccount())return;const r=await call('/agenda');agenda=r.items||[];
  const live=agenda.filter(a=>!a.deleted),byTime=(a,b)=>(a.starts_at||'z').localeCompare(b.starts_at||'z');
  const groups=[['待办',live.filter(a=>a.kind==='todo'&&!a.done)],['日程',live.filter(a=>a.kind==='event'&&!a.done).sort(byTime)],['已完成',live.filter(a=>a.done)],['已删除',agenda.filter(a=>a.deleted)]];
  el('agenda-list').replaceChildren(...groups.filter(([,items])=>items.length).map(([title,items])=>h('div',{class:'agenda-group'},h('h2',{text:title+' · '+items.length}),h('div',{class:'card list'},...items.sort((a,b)=>title==='日程'?0:byTime(a,b)).map(agendaRow)))));
  if(!agenda.length)el('agenda-list').append(h('div',{class:'card agenda-group'},emptyState('今天还没有安排','在上面添加一件要做的事，它会同步到 ATOM 的「今日」')));
  const open=live.filter(a=>a.kind==='todo'&&!a.done).length;el('nav-agenda').textContent=open||'';
  el('agenda-sub').textContent=r.offline?'当前离线，修改先保存在这台电脑':open+' 项待办未完成 · 与 ATOM 同步';updateSyncTile();}
el('agenda-kind').onclick=e=>{const b=e.target.closest('button');if(!b)return;el('agenda-add').elements.kind.value=b.dataset.kind;el('agenda-kind').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));el('agenda-add').elements.title.placeholder=b.dataset.kind==='todo'?'添加一件要做的事':'添加一个日程';};
el('agenda-add').onsubmit=async e=>{e.preventDefault();try{const values=Object.fromEntries(new FormData(e.target));await call('/agenda',{...values,starts_at:values.starts_at?new Date(values.starts_at).toISOString():''});e.target.elements.title.value='';e.target.elements.starts_at.value='';await loadAgenda();}catch(err){error(err);}};
el('agenda-sync').onclick=()=>loadAgenda().then(()=>note('今日已同步')).catch(error);

// Overview tiles for synced apps and market
function updateSyncTile(){if(!account){el('tile-sync').textContent='未登录';el('tile-sync-sub').textContent='登录市场账号后同步随手记和今日';return;}
  const n=notes.filter(x=>!x.deleted).length,open=agenda.filter(a=>!a.deleted&&a.kind==='todo'&&!a.done).length,pending=notes.filter(x=>x.pending).length+agenda.filter(x=>x.pending).length;
  el('tile-sync').textContent=n+' 条随手记 · '+open+' 项待办';el('tile-sync-sub').textContent=pending?pending+' 项等待同步':'与 ATOM 保持同步';}
async function overview(){const s=await studioState();
  el('tile-market').textContent=account?account.username:'未登录';
  if(!account){el('tile-market-sub').textContent='登录后可以派生作品并发布';updateSyncTile();return;}
  const [n,a,d]=await Promise.allSettled([call('/notes'),call('/agenda'),call('/drafts')]);
  if(n.status==='fulfilled'){notes=n.value.notes||[];el('nav-notes').textContent=notes.filter(x=>!x.deleted).length||'';}
  if(a.status==='fulfilled'){agenda=a.value.items||[];el('nav-agenda').textContent=agenda.filter(x=>!x.deleted&&x.kind==='todo'&&!x.done).length||'';}
  if(d.status==='fulfilled')drafts=d.value.drafts;
  updateSyncTile();
  const running=(s.jobs||[]).filter(j=>ACTIVE.includes(j.status)).length;
  el('tile-market-sub').textContent=(drafts?drafts.length+' 个草稿':'草稿暂不可用')+(running?' · '+running+' 个 AI 任务进行中':'');}

// AI note organisation
function noteSelection(latest){if(organizePoll)clearTimeout(organizePoll);const box=clearDialog('AI 整理便签');
  box.append(text('p','选择要整理的便签。AI 只给出摘要和候选待办 / 日程，不会修改原便签，也不会自动创建事项。','muted'));
  const choices=[],list=h('div',{class:'organize-selection'});
  for(const n of notes.filter(n=>!n.deleted)){const check=h('input',{type:'checkbox',value:n.id});choices.push(check);list.append(h('label',{class:'check'},check,h('span',{text:n.text.slice(0,140)})));}
  if(!choices.length){box.append(emptyState('还没有可整理的便签','先记录一些内容'));return;}
  box.append(list,h('div',{class:'form-actions'},latest?button('查看上次结果',()=>showOrganization(latest.id),'btn ghost'):null,h('span',{class:'spacer'}),button('全选',()=>choices.forEach(c=>c.checked=true),'btn ghost'),button('开始整理',async()=>{const selected=choices.filter(c=>c.checked).map(c=>c.value);if(!selected.length||selected.length>24)throw Error('请选择 1–24 条便签');const r=await call('/notes/organize',{note_ids:selected});await showOrganization(r.job.id);},'btn primary')));}
async function showOrganization(jobId){if(organizePoll)clearTimeout(organizePoll);const r=await call('/notes/organize/'+jobId),j=r.job,box=clearDialog('AI 整理便签');
  if(['queued','running'].includes(j.status)){box.append(h('div',{class:'row'},pill(statuses[j.status],'info'),text('span',j.status==='queued'?'准备启动本机 Codex…':'正在分析所选便签…')),text('p','原便签保持不变。可以关闭这个窗口，任务会继续在电脑上执行。','muted'),h('div',{class:'button-row'},button('停止整理',async()=>{await call('/notes/organize/'+j.id+'/cancel',{});await showOrganization(j.id);})));
    organizePoll=setTimeout(()=>{if(dialog.open&&el('dialog-title').textContent==='AI 整理便签')showOrganization(j.id).catch(error);},1000);return;}
  if(j.status!=='completed'){box.append(text('p','整理未完成：'+(j.error||statuses[j.status]||j.status)),h('div',{class:'button-row'},button('重新选择便签',()=>noteSelection(),'btn primary')));return;}
  box.append(text('h3','摘要'),text('p',j.result.summary));
  const checks={todos:[],events:[]};
  for(const kind of ['todos','events']){box.append(text('h3',kind==='todos'?'建议待办':'建议日程'));if(!j.result[kind].length)box.append(text('p','没有此类建议。','muted'));
    j.result[kind].forEach((candidate,index)=>{const applied=!!j.applied?.[kind+':'+index],check=h('input',{type:'checkbox',value:String(index),disabled:applied});checks[kind].push(check);box.append(h('label',{class:'check'},check,h('span',{text:candidate.title+(kind==='events'?' · '+(candidate.starts_at?new Date(candidate.starts_at).toLocaleString():'时间待定'):'')+(applied?' · 已加入':'')})));});}
  const confirmed=h('input',{type:'checkbox'});
  box.append(h('label',{class:'check'},confirmed,h('span',{text:'我确认把选中的建议加入「今日」；原便签保持不变。'})),h('div',{class:'form-actions'},button('整理其他便签',()=>noteSelection(),'btn ghost'),button('加入选中事项',async()=>{if(!confirmed.checked)throw Error('请先确认要加入选中事项');const selected=kind=>checks[kind].filter(c=>c.checked).map(c=>Number(c.value));const result=await call('/notes/organize/'+j.id+'/apply',{confirm:true,todo_indices:selected('todos'),event_indices:selected('events')});note(result.pending?'已保存到本机今日，等待联网同步':'已加入今日');await showOrganization(j.id);},'btn primary')));}
el('notes-organize').onclick=async()=>{try{if(!await needAccount())return;await loadNotes();const s=await studioState(),latest=s.jobs.filter(j=>j.kind==='notes-organize').slice(-1)[0];if(latest&&ACTIVE.includes(latest.status))await showOrganization(latest.id);else noteSelection(latest);}catch(e){error(e);}};

window.addEventListener('atom:page',e=>{if(e.detail!=='creations'&&poll){clearTimeout(poll);poll=null;}
  const tasks={overview,market:catalog,creations:()=>editing&&!el('studio-editor').hidden?Promise.resolve():loadCreations(),notes:loadNotes,agenda:loadAgenda};
  if(tasks[e.detail])tasks[e.detail]().catch(error);});
overview().catch(()=>{});
})();
