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
async function studioState(){const s=await call('/state');if(account?.id!==s.user?.id)coverCache.clear();account=s.user;window.studioJobs=s.jobs||[];window.atomAccount=account||null;window.dispatchEvent(new CustomEvent('atom:account'));
  el('account-avatar').replaceChildren(account?account.username.slice(0,1).toUpperCase():icon('user'));el('account-avatar').classList.toggle('on',!!account);
  el('account-name').textContent=account?account.username:'未登录';
  el('account-detail').textContent=!account?'登录市场账号以同步':s.encryption==='locked'||s.encryption==='recovery'?'随手记已锁定，点此解锁':s.pending_notes?s.pending_notes+' 条便签待同步':'随手记与今日已加密';
  encryption=s.encryption;window.renderActivity?.();if(s.recovery_code&&!dialog.open)showRecovery(s.recovery_code);return s;}
let encryption='none';
function showRecovery(code){const box=clearDialog('请保存恢复密钥'),ok=h('input',{type:'checkbox'});
  box.append(text('p','随手记和今日已开启端到端加密，服务器只保存密文。忘记密码并通过邮件重置后，需要这串恢复密钥才能解开原来的内容。它只显示这一次，请抄写或存进密码管理器。'),
    h('pre',{class:'recovery',text:code}),h('label',{class:'check'},ok,h('span',{text:'我已经把恢复密钥保存在安全的地方'})),
    h('div',{class:'form-actions'},button('完成',async()=>{if(!ok.checked)throw Error('请先确认已保存恢复密钥');await call('/recovery-ack',{});dialog.close();},'btn primary')));}
function lockedState(target){target.replaceChildren(h('div',{class:'card'},emptyState('随手记和今日已加密','在账号里输入一次密码即可解锁，内容只在你的设备上解密'),h('div',{class:'form-actions'},button('输入密码解锁',()=>accountDialog(),'btn primary'))));}
async function needAccount(){await studioState();if(!account){accountDialog();return false;}return true;}
function field(label,attrs){const input=h('input',attrs);return [h('label',{},label,input),input];}
function accountDialog(){const box=clearDialog(account?'市场账号':'登录市场账号');
  if(account){const status=text('p','正在读取邮箱状态…','muted'),panel=h('div'),
      head=h('div',{class:'row'},h('span',{class:'avatar on',text:account.username.slice(0,1).toUpperCase()}),h('div',{class:'row-main'},h('strong',{text:account.username}),status));
    let me=null;
    const actions=()=>h('div',{class:'button-row'},button(me?.email_verified?'更换邮箱':'绑定邮箱',()=>emailForm()),button('修改密码',()=>passwordForm()),button('退出登录',async()=>{await call('/logout',{});account=null;editing=null;dialog.close();await studioState();note('已退出市场账号');},'btn ghost'));
    const show=()=>{status.textContent=me?.email?me.email+(me.email_verified?' · 已验证，可用于找回密码':' · 未验证'):'还没有绑定邮箱，绑定后忘记密码可以用邮件找回';panel.replaceChildren(actions());};
    function emailForm(){const [emailLabel,email]=field('邮箱',{type:'email',maxlength:'254',value:me?.email||'',required:true}),[codeLabel,code]=field('邮件里的 6 位验证码',{inputmode:'numeric',maxlength:'6'});codeLabel.hidden=true;
      const send=h('button',{type:'submit',class:'btn primary',text:'发送验证码'}),form=h('form',{},emailLabel,codeLabel,h('div',{class:'form-actions'},button('取消',show,'btn ghost'),send));
      form.onsubmit=async e=>{e.preventDefault();send.disabled=true;try{if(codeLabel.hidden){await call('/email/start',{email:email.value.trim()});codeLabel.hidden=false;email.readOnly=true;send.textContent='验证';code.focus();note('验证码已发送到 '+email.value.trim());}else{await call('/email/verify',{code:code.value.trim()});me=(await call('/me')).user;show();note('邮箱已验证');}}catch(err){error(err);}finally{send.disabled=false;}};
      panel.replaceChildren(form);email.focus();}
    function passwordForm(){const [oldLabel,old]=field('当前密码',{type:'password',autocomplete:'current-password',required:true}),[newLabel,fresh]=field('新密码（至少 8 位）',{type:'password',autocomplete:'new-password',minlength:'8',required:true});
      const save=h('button',{type:'submit',class:'btn primary',text:'保存新密码'}),form=h('form',{},oldLabel,newLabel,text('p','修改后，其他设备上的登录会失效，需要重新登录。','muted'),h('div',{class:'form-actions'},button('取消',show,'btn ghost'),save));
      form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await call('/password/change',{old_password:old.value,new_password:fresh.value});old.value=fresh.value='';show();note('密码已修改');}catch(err){error(err);}finally{save.disabled=false;}};
      panel.replaceChildren(form);old.focus();}
    const lock=h('div');
    if(encryption==='locked'){const [label,pw]=field('输入密码解锁随手记和今日',{type:'password',autocomplete:'current-password',required:true}),go=h('button',{class:'btn primary',text:'解锁'}),f=h('form',{},label,h('div',{class:'form-actions'},go));
      f.onsubmit=async e=>{e.preventDefault();go.disabled=true;try{await call('/unlock',{password:pw.value});pw.value='';await studioState();dialog.close();note('已解锁');window.dispatchEvent(new CustomEvent('atom:page',{detail:currentPage}));}catch(err){error(err);}finally{go.disabled=false;}};lock.append(f);}
    else if(encryption==='recovery'){const [label,code]=field('恢复密钥',{placeholder:'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',autocomplete:'off',spellcheck:'false'}),go=h('button',{class:'btn primary',text:'用恢复密钥解锁'}),f=h('form',{},text('p','密码已经改过，原来的加密内容需要恢复密钥才能解开。','muted'),label,h('div',{class:'form-actions'},button('没有恢复密钥，放弃旧内容',async()=>{if(!confirm('放弃后，服务器上无法解密的旧随手记和今日会被删除，无法找回。确定吗？'))return;if(!confirm('再确认一次：旧内容将永久丢失。'))return;await call('/reset-keys',{confirm:true});await studioState();},'btn ghost'),go));
      f.onsubmit=async e=>{e.preventDefault();go.disabled=true;try{await call('/recover',{code:code.value});await studioState();dialog.close();note('已用恢复密钥解锁');}catch(err){error(err);}finally{go.disabled=false;}};lock.append(f);}
    else if(encryption==='on')lock.append(text('p','随手记和今日：端到端加密已开启','muted'));
    box.append(head,lock,panel);show();call('/me').then(r=>{me=r.user;show();}).catch(()=>{status.textContent='暂时无法读取邮箱状态';});return;}
  let mode='login';
  const [userLabel,user]=field('用户名',{name:'username',autocomplete:'username',required:true});
  const [passLabel,password]=field('密码',{type:'password',name:'password',placeholder:'至少 8 位',autocomplete:'current-password',minlength:'8'});
  const [codeLabel,code]=field('邮件里的 6 位验证码',{inputmode:'numeric',maxlength:'6'});
  const submit=h('button',{class:'btn primary',text:'登录'}),status=text('p','','muted');
  let codeSent=false;
  const labels={login:['登录','市场账号与 Codex 等模型账号相互独立；密码不会发送给 AI。'],register:['创建并登录','用户名 3–32 位字母、数字、下划线或连字符；密码至少 8 位。'],forgot:['发送验证码','验证码会发到这个账号已验证的邮箱。没有绑定邮箱的账号请联系管理员。']};
  function sync(){const [action,hint]=labels[mode];submit.textContent=mode==='forgot'&&codeSent?'重置密码并登录':action;status.textContent=hint;status.className='muted';
    passLabel.hidden=mode==='forgot'&&!codeSent;codeLabel.hidden=!(mode==='forgot'&&codeSent);user.readOnly=mode==='forgot'&&codeSent;
    passLabel.firstChild.textContent=mode==='forgot'?'新密码':'密码';password.autocomplete=mode==='login'?'current-password':'new-password';password.required=!passLabel.hidden;}
  const seg=h('div',{class:'segmented'},...[['login','登录'],['register','创建账号'],['forgot','忘记密码']].map(([v,l])=>h('button',{type:'button',class:v===mode?'on':'',text:l,onclick:e=>{mode=v;codeSent=false;seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===e.currentTarget));sync();}})));
  const form=h('form',{},seg,userLabel,codeLabel,passLabel,submit,status);
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;
    try{if(mode==='forgot'&&!codeSent){await call('/password/forgot',{username:user.value.trim()});codeSent=true;sync();status.textContent='如果这个账号绑定了已验证的邮箱，验证码已经发出。';code.focus();return;}
      if(mode==='forgot')await call('/password/reset',{username:user.value.trim(),code:code.value.trim(),new_password:password.value});
      else await call('/'+mode,{username:user.value,password:password.value});
      password.value='';dialog.close();await studioState();note(mode==='forgot'?'密码已重置并登录':'市场账号已连接');window.dispatchEvent(new CustomEvent('atom:page',{detail:currentPage}));}
    catch(err){status.textContent=err.message;status.className='';}finally{submit.disabled=false;}};
  box.append(form);sync();user.focus();}
window.atomAlbumLogin=()=>accountDialog();
el('studio-account').onclick=async()=>{try{await studioState();accountDialog();}catch(e){error(e);}};

// Source viewer shared by market and dialogs
function showBundle(box,bundle){const values={'manifest.json':JSON.stringify(bundle.manifest,null,2),...bundle.files},pre=h('pre'),list=h('div',{class:'source-list'});
  for(const [name,content]of Object.entries(values)){const b=h('button',{type:'button',text:name,onclick:()=>{pre.textContent=content;list.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));}});list.append(b);}
  pre.textContent=values['manifest.json'];list.firstChild?.classList.add('selected');box.append(h('div',{class:'source-view'},list,pre));}

// Market
const coverCache=new Map();
function coverImage(ident,cls='work-cover'){
  if(!/^[a-f0-9]{32}$/.test(ident||''))return null;
  const img=h('img',{class:cls,alt:'应用首页截图',loading:'lazy'});
  const load=()=>{if(!coverCache.has(ident))coverCache.set(ident,call('/covers/'+ident).then(r=>{if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r.image||''))throw Error('封面无效');return r.image;}).catch(e=>{coverCache.delete(ident);throw e;}));coverCache.get(ident).then(src=>{img.src=src;img.onload=()=>img.parentElement?.classList.add('has-cover');}).catch(()=>{img.remove();});};
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}},{rootMargin:'160px'});observer.observe(img);
  return img;
}
async function screenshotData(file){
  if(!file||file.size>20*1024*1024)throw Error('首页截图最大支持 20 MiB');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 PNG、JPEG 或 WebP 截图');
  const url=URL.createObjectURL(file),img=new Image();
  try{img.src=url;await img.decode();if(img.naturalWidth*img.naturalHeight>64000000)throw Error('截图分辨率过大');const scale=Math.min(1,1280/img.naturalWidth,960/img.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#f2f2f7';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);const result=canvas.toDataURL('image/jpeg',.85);if(result.length>1200000)throw Error('截图内容过大，请降低分辨率');return result;}finally{URL.revokeObjectURL(url);}
}
function coverUploader(draftId){
  const area=h('section',{class:'cover-uploader'}),preview=h('div',{class:'cover-upload-preview'}),feedback=h('p',{class:'muted',role:'status'});
  const input=h('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':'上传应用首页截图'});
  function show(){preview.replaceChildren(editing?.draft.cover_id?coverImage(editing.draft.cover_id,'cover-upload-image'):text('span','上传后，市场卡片会展示你的应用首页'));}
  show();
  input.onchange=async()=>{const selected=input.files?.[0];if(!selected)return;input.disabled=true;feedback.textContent='正在优化并上传截图…';try{const image=await screenshotData(selected);if(editing?.draft.id!==draftId)throw Error('草稿已切换，请重新上传');const result=await call('/drafts/'+draftId+'/cover',{image,revision:editing.draft.revision});if(editing?.draft.id!==draftId)return;editing.draft=result.draft;show();feedback.textContent='封面已保存到私有草稿，发布后会公开展示。';}catch(e){feedback.textContent=e.message;error(e);}finally{input.disabled=false;input.value='';}};
  area.append(text('h3','上传首页截图'),preview,h('label',{},'选择或更换封面',input),text('p','推荐 4:3 横图。PNG / JPEG / WebP，20 MiB 以内，自动优化。请确认画面没有账号、密钥或私人内容。','muted'),feedback);
  return area;
}
function workCard(work,onclick){return h('button',{type:'button',class:'work',onclick},coverImage(work.cover_id),h('span',{class:'work-icon cat-'+(work.category||'life'),text:(work.title||'?').slice(0,1)}),h('strong',{},work.title,work.official?pill('官方','info plain'):null),h('p',{text:work.description||'暂无介绍'}),h('small',{text:authorOf(work)+' · '+(categories[work.category]||work.category||'')}),!work.cover_id?text('span','首页截图待上传','cover-missing'):null);}
async function catalog(){const box=el('market-catalog');box.replaceChildren(text('p','正在打开市场…','muted'));
  try{studioState().catch(()=>{});const form=el('market-search'),q=new URLSearchParams({q:form.elements.q.value,category:form.elements.category.value}),r=await call('/catalog?'+q);
    const published=new Set(r.works.map(w=>w.id.replace(/^official-/,''))),library=(r.library||[]).filter(a=>!published.has(a.id)&&!['official-companion','task-pal'].includes(a.id));
    const sourceCard=a=>h('button',{type:'button',class:'work',onclick:()=>libraryDetail(a)},a.cover_id?coverImage(a.cover_id):null,h('span',{class:'work-icon cat-life',text:a.name.slice(0,1)}),h('strong',{text:a.name}),h('p',{text:a.description||'完整应用源码与资源'}),h('small',{text:'完整源码 · '+a.files+' 个文件 · '+(a.archive_bytes/1048576).toFixed(1)+' MiB'}));
    box.replaceChildren(...r.works.map(w=>workCard(w,()=>workDetail(w.id).catch(error))),...library.map(sourceCard));
    if(!r.works.length&&!library.length)box.append(h('div',{class:'card'},emptyState('没有匹配的作品','换个关键词或分类试试')));}
  catch(e){box.replaceChildren(h('div',{class:'card'},emptyState('无法打开市场',e.message)));}}
function libraryDetail(a){const box=clearDialog(a.name),valid=/^\/atom\/assets\/library\/[a-z][a-z0-9_-]{0,47}-[a-f0-9]{16}\.zip$/.test(a.archive||'');
  if(a.cover_id)box.append(coverImage(a.cover_id,'cover-upload-image'));
  box.append(text('p',a.description||'完整源码资源包'),text('p',a.input_status==='legacy'?'既有应用兼容源码，尚未逐项完成五向适配。下载包含完整代码和资源，不代表新版本兼容认证。':'完整源码与资源包；上游许可随包保留。','muted'),text('p',a.files+' 个文件 · '+(a.archive_bytes/1048576).toFixed(1)+' MiB','muted'),h('pre',{class:'code',text:'SHA-256: '+a.sha256}),h('div',{class:'form-actions'},button('下载完整源码 ZIP',async()=>{if(!valid)throw Error('源码包地址无效');const state=await api('state'),base=state.relay_url||'https://ldcx.tech/atom',u=new URL(a.archive,base);if(u.protocol!=='https:')throw Error('源码下载需要 HTTPS');window.open(u.href,'_blank','noopener');},'btn primary'),button('在本机模拟器查看',()=>{dialog.close();showPage('simulator');simAsk('start');})));
}
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
  const hero=coverImage(work.cover_id,'work-detail-cover');if(hero)box.append(hero);
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
  if(!el('editor-cover')){const coverButton=button('首页截图',async()=>{await saveLocal();clearDialog('应用市场封面').append(coverUploader(editing.draft.id));},'btn');coverButton.id='editor-cover';el('editor-publish').before(coverButton);}
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
  box.append(coverUploader(editing.draft.id),text('p','发布会公开首页截图、全部源码与安装资源。上游作者、版本和许可证会保留；发布后的版本不可修改。'),h('dl',{class:'meta'},h('dt',{text:'作品'}),h('dd',{text:editing.draft.title}),h('dt',{text:'许可'}),h('dd',{text:editing.draft.license})),h('label',{},'更新说明',changes),h('label',{class:'check'},checkbox,h('span',{text:'我已检查源码和截图，没有账号密钥或私人信息，并同意按上述许可证公开发布。'})),
    h('div',{class:'form-actions'},button('确认发布',async()=>{if(!checkbox.checked)throw Error('请先确认源码和截图可以公开');if(!editing.draft.cover_id)throw Error('请先上传首页截图，让大家看见你的应用');await call('/drafts/'+editing.draft.id+'/save',{revision:editing.draft.revision});editing=await call('/workspaces/'+editing.draft.id);const r=await call('/drafts/'+editing.draft.id+'/publish',{revision:editing.draft.revision,changelog:changes.value,confirm:true,require_cover:true});dialog.close();drawEditor();note('已发布版本 '+r.version.number+'，完整源码已公开');},'btn primary')));}catch(e){error(e);}};

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
  if(job.status==='completed'&&editing?.draft.id===job.draft_id){note('应用已更新；发布前可在「首页截图」上传或更换封面。');editing=await call('/workspaces/'+job.draft_id);buffer=JSON.parse(JSON.stringify(editing.bundle));drawEditor();refreshPreview();}
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
async function loadNotes(){if(!await needAccount())return;let r;try{r=await call('/notes');}catch(e){if(e.details?.code==='notes_locked'||e.status===423){lockedState(el('notes-list'));return;}throw e;}notes=r.notes||[];drawNotes();
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
async function loadAgenda(){if(!await needAccount())return;let r;try{r=await call('/agenda');}catch(e){if(e.details?.code==='notes_locked'||e.status===423){lockedState(el('agenda-list'));return;}throw e;}agenda=r.items||[];
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
