/* Shared novice creation flow. Host owns credentials and installation; previews get neither. */
(function(){'use strict';
const labels={life:'生活',companion:'陪伴',sound:'声音',play:'趣玩',connect:'连接'};
function node(tag,attrs={},...children){const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else n.setAttribute(k,v);}n.append(...children.filter(x=>x!==null&&x!==undefined));return n;}
const clone=v=>JSON.parse(JSON.stringify(v));
window.AtomCommunity=class {
 constructor(root,host){this.root=root;this.host=host;this.desktop=host.layout==='desktop';root.dataset.layout=this.desktop?'desktop':'device';this.owner=null;this.epoch=0;this.pending=new Map();this.ideas=new Map();this.timer=null;this.works=[];this.pageIndex=0;this.catalogKind='all';this.filter='all';this.category='';this.search='';this.active=true;this.covers=new Map();this.coverLoaders=new WeakMap();root.classList.add('community');this.onMessage=e=>{if(!this.active||this.previewFrame?.contentWindow!==e.source)return;if(e.data?.type==='atom:return-home')this.run(()=>this.back());else this.previewReply(e);};window.addEventListener('message',this.onMessage);}
 previewReply(event){
  const d=event.data||{},types=['atom:photos','atom:market','atom:connect','atom:experience','atom:task-state','atom:agent-studio','atom:mic'];
  if(!types.includes(d.type)||!['string','number'].includes(typeof d.id)||String(d.id).length>128)return;
  const response={type:d.type+'-result',id:d.id};
  if(d.action==='state'||d.type==='atom:task-state')response.result={authenticated:false,user:null,configured:false,paired:[],tasks:[],generation_enabled:false,styles:[],templates:[]};
  else Object.assign(response,{error:'这是临时体验，请安装后使用账号、AI 或设备功能。',status:403,code:'preview_only'});
  event.source.postMessage(response,'*');
 }
 button(label,fn,kind=''){return node('button',{type:'button',class:kind,text:label,onclick:()=>this.run(fn)});}
 async run(fn){if(this.busy)return;this.busy=true;this.root.setAttribute('aria-busy','true');try{await fn();}catch(e){if(this.active)this.message(e.status===401?'请先登录，再继续创作。':e.message||'暂时未完成，请重试',true);if(e.status===401)this.loginNeeded=true;}finally{this.busy=false;this.root.removeAttribute('aria-busy');}}
 message(value,bad=false){const target=this.root.querySelector('.community-status');if(target){target.textContent=value;target.classList.toggle('bad',bad);}}
 async read(route){return this.host.call(route);}
 async write(action,body){const key=action+JSON.stringify(body);let request=this.pending.get(key);if(!request){request={...body,request_id:crypto.randomUUID()};this.pending.set(key,request);}try{const result=await this.host.call('/community/'+action,request);this.pending.delete(key);return result;}catch(e){if(e.status===409||e.status===400)this.pending.delete(key);throw e;}}
 async identity(){const state=await this.host.state();const uid=state.user?.id||null;if(this.owner!==uid){this.covers.clear();this.pending.clear();this.ideas.clear();}this.owner=uid;this.account=state;return state;}
 async signedIn(){await this.identity();if(!this.owner){await this.host.login();return false;}return true;}
 releasePreview(){this.previewFrame?.contentWindow?.postMessage({type:'atom:preview-suspend'},'*');if(this.previewURL)this.host.releasePreview?.(this.previewURL);this.previewURL=null;}
 dispose(){this.releasePreview();this.coverObserver?.disconnect();this.coverObserver=null;this.previewObserver?.disconnect();this.previewObserver=null;this.active=false;this.epoch++;clearTimeout(this.timer);this.root.replaceChildren();window.removeEventListener('message',this.onMessage);}
 page(title,back,screen=''){
  this.releasePreview();
  this.coverObserver?.disconnect();this.coverObserver=null;this.previewObserver?.disconnect();this.previewObserver=null;this.root.dataset.screen=screen;
  this.previewFrame=null;this.root.classList.remove('community-full-preview');this.active=true;this.epoch++;clearTimeout(this.timer);
  this.root.dataset.view=this.tab;this.root.dataset.detail=back?'true':'false';this.host.onView?.(this.tab);
  const content=node('div',{class:'community-content','data-atom-scroll':''}),status=node('p',{class:'community-status','data-atom-scroll':'',role:'status','aria-live':'polite'});
  const rootView=!back&&['discover','mine'].includes(this.tab);
  const goBack=back||(this.desktop&&!rootView?()=>this.show('mine'):()=>this.host.home());
  const arrow=this.button('‹ '+(back?'返回':this.desktop?'我的创作':'桌面'),goBack,'community-back');arrow.setAttribute('data-atom-back','');
  if(this.desktop){
   const name=title==='发现好玩的作品'?'发现':title==='我的作品'?'我的创作':title;
   const subtitle=rootView?(this.tab==='discover'?'探索好玩的应用，试用，再做成你的版本。':'继续你的想法，体验、修改，然后分享。'):'';
   const heading=node('div',{class:'community-heading'},node('h1',{text:name}),subtitle?node('p',{class:'community-subtitle',text:subtitle}):null);
   const actions=rootView?node('div',{class:'community-toolbar'},this.button('动态',()=>this.show('activity')),this.button('新建作品',()=>this.show('new'),'primary')):null;
   this.root.replaceChildren(node('header',{},rootView?null:arrow,heading,actions),status,content);
  }else{
   const nav=back?null:node('nav',{'aria-label':'创作导航'},...Object.entries({discover:'发现',new:'创作',mine:'我的',activity:'动态'}).map(([key,label])=>{const button=this.button(label,()=>this.show(key),key===this.tab?'primary':'');if(key===this.tab)button.setAttribute('aria-current','page');return button;}));
   this.root.replaceChildren(node('header',{},arrow,node('h1',{text:title}),back?null:this.button(this.account?(this.owner?'账号':'登录'):'连接中…',()=>this.account?this.host.login():this.show(this.tab),'community-account')),...(nav?[nav]:[]),status,content);
  }
  this.root.scrollTop=0;this.back=goBack;return content;
 }
 async show(where='discover'){this.tab=where;const box=this.page('正在连接…');box.append(node('p',{role:'status',text:'正在确认账号与服务状态…'}));const epoch=this.epoch;try{await this.identity();}catch(e){if(epoch!==this.epoch)return;this.message(e.message||'连接失败，请重试',true);box.replaceChildren(this.button('重新连接',()=>this.show(where),'primary'));return;}if(epoch!==this.epoch)return;
  if(where==='discover')return this.discover();if(!this.owner){const b=this.page('开始创作');b.append(node('h2',{text:'登录后，作品跟着你走'}),node('p',{text:'同一账号可以在 Mac 和 ATOM 上继续修改。'}),this.button('登录账号',()=>this.host.login(),'primary'));return;}
  if(where==='new')return this.newForm();if(where==='activity')return this.activity();return this.mine();
 }
 cover(id){
  if(!/^[a-f0-9]{32}$/.test(id||''))return null;
  const img=node('img',{alt:'应用真实首页截图',loading:'lazy'});
  const load=()=>{
   if(!img.isConnected)return;
   if(!this.covers.has(id))this.covers.set(id,this.read('/covers/'+id).then(r=>{if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r.image||''))throw Error('封面无效');return r.image;}).catch(e=>{this.covers.delete(id);throw e;}));
   this.covers.get(id).then(src=>{if(img.isConnected)img.src=src;}).catch(()=>{if(img.isConnected)img.replaceWith(node('span',{class:'community-cover-unavailable',text:'首页截图暂未加载'}));});
  };
  // loading=lazy does not defer the authenticated request which supplies a data URL.
  if(!this.coverObserver)this.coverObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.coverObserver?.unobserve(entry.target);this.coverLoaders.get(entry.target)?.();this.coverLoaders.delete(entry.target);}},{rootMargin:'240px'});
  this.coverLoaders.set(img,load);this.coverObserver.observe(img);return img;
 }

 async discover(){this.tab='discover';const box=this.page('发现好玩的作品',null,'discover');const epoch=this.epoch;
  const search=node('input',{type:'search',placeholder:'想玩点什么？',value:this.search,'aria-label':'搜索作品'}),category=node('select',{'aria-label':'作品分类'});category.append(new Option('全部分类',''));for(const [id,label]of Object.entries(labels))category.append(new Option(label,id));category.value=this.category;
  const mode=node('select',{'aria-label':'探索方式'},new Option('最近更新','all'),new Option('大家的改造','remixes'));mode.value=this.filter;
  const form=node('form',{class:'community-search'},search,category,mode,node('button',{type:'submit',text:'查找'}));form.onsubmit=e=>{e.preventDefault();this.search=search.value;this.category=category.value;this.filter=mode.value;this.pageIndex=0;this.run(()=>this.discover());};
  const tools=node('div',{class:'community-discovery-tools'},form);
  if(this.desktop)box.before(tools);else box.append(form,node('p',{text:'先试一试，再把喜欢的作品改成自己的。',class:'community-hint'}));
  const r=await this.read('/catalog?'+new URLSearchParams({q:this.search,category:this.category}));if(epoch!==this.epoch)return;
  this.works=(r.works||[]).filter(w=>this.filter!=='remixes'||w.parent_id).sort((a,b)=>(b.updated_at||0)-(a.updated_at||0));
  // Complete resource archives remain discoverable without pretending they support the remix API.
  const published=new Set((r.works||[]).map(w=>w.id.replace(/^official-/,'')));
  const library=(r.library||[]).filter(a=>!published.has(a.id)&&!['official-companion','task-pal'].includes(a.id));
  const resources=this.desktop&&this.host.downloadSource&&this.filter!=='remixes'?library:[];
  const pages=Math.max(1,Math.ceil(this.works.length/8));this.pageIndex%=pages;const grid=node('div',{class:'community-grid'});
  const workCard=work=>{const card=this.button('',()=>this.work(work.id),'community-card');card.append(this.cover(work.cover_id)||node('span',{text:'首页截图待补充',class:'community-cover-empty'}),node('div',{},node('h2',{text:work.title}),node('p',{text:work.description||'打开体验这个作品'}),node('small',{text:(work.author?.username||work.author)+' · '+(labels[work.category]||'作品')+(work.parent_id?' · 改造作品':'')})));return card;};
  const resourceCard=app=>{const card=this.button('',()=>this.resource(app),'community-card community-resource-card');card.append(this.cover(app.cover_id)||node('span',{text:'首页截图待补充',class:'community-cover-empty'}),node('div',{},node('h2',{text:app.name}),node('p',{text:app.description||'包含完整代码与素材的应用'}),node('small',{text:'资源版 · 完整源码'})));return card;};
  if(this.desktop){
   const counts={all:this.works.length+resources.length,works:this.works.length,resources:resources.length},names={all:'全部应用',works:'公开作品',resources:'资源版'};
   const tabs=node('div',{class:'community-catalog-tabs',role:'group','aria-label':'应用范围'}),note=node('p',{class:'community-catalog-note'});
   const render=kind=>{this.catalogKind=kind;grid.replaceChildren();if(kind!=='resources')grid.append(...this.works.map(workCard));if(kind!=='works')grid.append(...resources.map(resourceCard));
    if(!grid.children.length)grid.append(node('p',{class:'community-hint',text:'没有找到应用，换个关键词或应用范围试试。'}));
    for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
    note.textContent=kind==='resources'?'保留完整源码与素材；部分应用仍需适配新版安装和改造流程。':counts[kind]+' 个应用'+(kind==='all'&&resources.length?' · 资源版可下载完整源码':'');box.scrollTop=0;
   };
   for(const [kind,name]of Object.entries(names)){const button=this.button(name+' '+counts[kind],()=>render(kind));button.dataset.kind=kind;tabs.append(button);}
   tools.append(node('div',{class:'community-catalog-summary'},tabs,note));render(this.catalogKind);
  }else{
   grid.append(...this.works.slice(this.pageIndex*8,this.pageIndex*8+8).map(workCard));
   if(!this.works.length)grid.append(node('p',{text:'没有找到作品，换个关键词试试。'}));
  }
  box.append(grid);
  if(!this.desktop&&pages>1)box.append(node('div',{class:'community-actions community-pagination'},this.button('上一页',()=>{this.pageIndex=(this.pageIndex+pages-1)%pages;return this.discover();}),node('span',{text:(this.pageIndex+1)+' / '+pages}),this.button('再看一页',()=>{this.pageIndex=(this.pageIndex+1)%pages;return this.discover();})));
  if(!this.desktop&&library.length){box.append(node('p',{class:'community-hint',text:'旧版完整资源保留在高级资源目录，需要逐项完成五向适配。'}));if(this.host.library)box.append(this.button('高级资源目录',()=>this.host.library()));}
 }
 resource(app){
  const box=this.page(app.name,()=>this.discover(),'work'),epoch=this.epoch,media=node('div',{class:'community-work-media'}),info=node('div',{class:'community-work-info'});
  const stage=node('div',{class:'community-preview-stage'});media.append(stage,node('p',{class:'community-hint',text:'可直接操作 · 临时体验，不读取个人账号；AI 与硬件功能需安装后使用。'}));
  info.append(node('p',{class:'community-meta',text:'资源版 · 完整源码'}),node('h2',{text:'关于这个应用'}),node('p',{class:'community-description',text:app.description||'完整应用代码与素材。'}),node('p',{class:'community-hint',text:'已保留完整资源包。目前还不能在这里直接安装或一键改造，需先完成新版适配；上游许可随包保留。'}),node('div',{class:'community-actions community-work-actions'},this.button('放大体验',()=>this.preview(null,()=>this.resource(app),()=>this.host.previewResource(app)),'primary'),this.button('下载完整源码 ZIP',()=>this.host.downloadSource(app))),node('p',{class:'community-hint',text:app.files+' 个文件 · '+(app.archive_bytes/1048576).toFixed(1)+' MiB'}));
  box.append(node('div',{class:'community-work-layout'},media,info));
  void this.mountPreview(()=>this.host.previewResource(app),stage,epoch);
 }

 async work(id){
  this.tab='discover';const box=this.page('正在打开作品',()=>this.discover(),'work'),epoch=this.epoch;
  const result=await this.read('/works/'+id);if(epoch!==this.epoch)return;
  const work=result.work;this.currentWork=result;this.root.querySelector('h1').textContent=work.title;
  const media=node('div',{class:'community-work-media'}),stage=this.desktop?node('div',{class:'community-preview-stage'}):null;
  if(stage)media.append(stage,node('p',{class:'community-hint',text:'可直接操作 · 临时体验，不读取个人账号；AI 与硬件功能需安装后使用。'}));
  else media.append(node('div',{class:'community-hero'},this.cover(work.cover_id)||node('p',{class:'community-hint',text:'作者尚未上传首页截图'})));
  const idx=this.works.findIndex(w=>w.id===id);
  if(this.works.length>1&&idx>=0)media.append(node('div',{class:'community-actions community-work-browse'},this.button('‹ 上一个',()=>this.work(this.works[(idx+this.works.length-1)%this.works.length].id)),node('span',{text:(idx+1)+' / '+this.works.length}),this.button('下一个 ›',()=>this.work(this.works[(idx+1)%this.works.length].id))));
  const info=node('div',{class:'community-work-info'},node('p',{class:'community-meta',text:(labels[work.category]||'作品')+' · '+(work.author?.username||work.author)}),node('h2',{text:'关于这个作品'}),node('p',{class:'community-description',text:work.description||'来体验一下，再决定如何改造。'}));
  const ref={version_id:work.latest_version_id};
  info.append(node('div',{class:'community-actions community-work-actions'},this.button(this.desktop?'放大体验':'试一试',()=>this.preview(ref,()=>this.work(id)),'primary'),this.button('安装',()=>this.install(ref,()=>this.work(id))),this.button('改成我的',async()=>{if(!await this.signedIn())return;const r=await this.write('copy',{version_id:ref.version_id,title:(work.title+' · 我的版本').slice(0,80)});await this.edit(r.draft.id);this.message('已保存私人副本，可以直接说想怎么改。');})));
  if(work.parent_id)info.append(this.button('看看原作',()=>this.work(work.parent_id)));
  if(work.contributors?.length)info.append(node('p',{class:'community-hint',text:'参与改进：'+work.contributors.join('、')}));
  info.append(node('div',{class:'community-work-footer'},node('span',{class:'community-hint',text:work.license+' · 保留源码与署名'}),this.button('更多操作',()=>this.workOptions(result),'secondary')));
  const related=node('section',{class:'community-related'},node('h3',{text:'大家的改造'}));
  for(const item of result.derivatives||[])related.append(this.button(item.title,()=>this.work(item.id),'community-list'));
  if(!result.derivatives?.length)related.append(node('p',{class:'community-hint',text:'还没有公开改造，试着做出你的版本。'}));
  box.append(node('div',{class:'community-work-layout'},media,info),related);
  if(stage)void this.mountPreview(async()=>this.host.preview((await this.bundle(ref)).bundle),stage,epoch);
 }
 workOptions(result){const box=this.page('更多操作',()=>this.work(result.work.id),'options');box.append(this.button('源码与历史版本',()=>this.sourceDetails(result),'community-list'));if(this.host.history)box.append(this.button('设备版本与恢复',()=>this.host.history(result.work.id),'community-list'));
 }
 async sourceDetails(result){const box=this.page('源码与历史版本',()=>this.work(result.work.id),'source');const select=node('select',{'aria-label':'历史版本'},...result.versions.map(v=>new Option('第 '+v.number+' 版 · '+v.changelog,v.id)));box.append(select,this.button('查看这一版',async()=>{const r=await this.read('/versions/'+select.value);this.source(r.bundle,()=>this.sourceDetails(result));}),this.button('体验这一版',()=>this.preview({version_id:select.value},()=>this.sourceDetails(result))));}
 source(bundle,back){const box=this.page('完整源码',back,'source'),files={'manifest.json':JSON.stringify(bundle.manifest,null,2),...bundle.files},select=node('select',{'aria-label':'源码文件'},...Object.keys(files).map(n=>new Option(n,n))),pre=node('pre',{'data-atom-selectable':'',text:files[select.value]});select.onchange=()=>pre.textContent=files[select.value];box.append(select,pre);}
 async bundle(ref){return this.read(ref.draft_id?'/drafts/'+ref.draft_id:'/versions/'+ref.version_id);}
 async mountPreview(bundle,stage,epoch){
  stage.replaceChildren(node('p',{class:'community-hint',text:'正在载入预览…'}));
  try{
   const url=typeof bundle==='function'?await bundle():this.host.preview?await this.host.preview(bundle):null;
   if(epoch!==this.epoch||!this.active){if(url)this.host.releasePreview?.(url);return;}
   this.previewURL=url;
   const frame=node('iframe',{title:'作品交互预览',sandbox:'allow-scripts',class:'community-preview','data-atom-back':'preview'});
   if(url)frame.src=url;else frame.srcdoc=window.AtomCommunityPreview(bundle);
   stage.replaceChildren(frame);this.previewFrame=frame;
   if(this.desktop){
    const fit=()=>{if(frame.isConnected)frame.style.transform='scale('+Math.min(1,stage.clientWidth/480)+')';};
    this.previewObserver?.disconnect();this.previewObserver=new ResizeObserver(fit);this.previewObserver.observe(stage);fit();
   }
  }catch(error){
   if(epoch!==this.epoch||!this.active)return;
   stage.replaceChildren(node('div',{class:'community-preview-error'},node('p',{text:'预览暂时没能打开，作品仍然保留。'}),node('p',{class:'community-hint',text:error.message||'请稍后重新载入。'}),this.button('重新载入预览',()=>this.mountPreview(bundle,stage,epoch))));
  }
 }
 async preview(ref,back,bundle){
  const box=this.page('试一试',back,'preview'),epoch=this.epoch,value=bundle||((await this.bundle(ref)).bundle);if(epoch!==this.epoch)return;
  const stage=node('div',{class:'community-preview-stage'});
  if(this.desktop)box.append(node('div',{class:'community-preview-view'},stage,node('p',{class:'community-hint',text:'这是作品的交互预览，体验中的数据不会写入你的设备。'})));
  else{this.root.classList.add('community-full-preview');this.root.replaceChildren(stage);}
  await this.mountPreview(value,stage,epoch);
 }
 newForm(){
  this.tab='new';const box=this.page('说出你的想法');
  const prompt=node('textarea',{maxlength:'4000',rows:'3',placeholder:'例如：一个会随天气变化的窗景。长按空格说出想法。','aria-label':'创作想法'});
  const title=node('input',{maxlength:'80',placeholder:'名字（选填，之后可以修改）','aria-label':'作品名称'});
  const form=node('form',{class:'community-create'},prompt,title,node('p',{class:'community-hint',text:'使用官方 AI 额度。作品先为你保存，分享时才会公开。'}),node('button',{type:'submit',text:'开始创作',class:'primary'}));
  form.onsubmit=e=>{e.preventDefault();this.run(async()=>{const idea=prompt.value.trim();if(!idea)throw Error('先说说你想做什么');const r=await this.write('create',{title:title.value.trim()||'我的新作品',description:idea.slice(0,500)});await this.edit(r.draft.id);await this.generate(idea);});};
  box.append(form);
 }
 async mine(){
  this.tab='mine';const box=this.page('我的作品'),epoch=this.epoch;const r=await this.read('/drafts');if(epoch!==this.epoch)return;
  if(!this.desktop)box.append(this.button('＋ 做一个新作品',()=>this.newForm(),'primary'));
  const grid=node('div',{class:'community-drafts'});
  for(const d of r.drafts||[]){
   const card=this.button('',()=>this.edit(d.id),'community-draft');
   if(this.desktop){
    const cover=this.cover(d.cover_id);const art=node('div',{class:'community-draft-art'},cover||node('span',{class:'community-draft-paper','aria-hidden':'true',text:'✎'}));
    if(!cover){card.classList.add('without-cover');art.append(node('span',{class:'community-draft-placeholder',text:'尚未添加首页截图'}));}
    card.append(art,node('div',{class:'community-draft-info'},node('span',{class:'community-draft-state',text:d.creation_pending?'等待创作':d.work_id?'已发布 · 可继续修改':'仅自己可见'}),node('h2',{text:d.title}),node('p',{text:d.description||'打开作品，继续你的想法'}),node('small',{text:d.parent_id?'基于原作改造':'原创作品'})));
   }else card.append(node('h2',{text:d.title}),node('p',{text:d.work_id?'有公开版本 · 新修改仍是私人草稿':'私人草稿 · 已同步到账号'}),node('small',{text:d.parent_id?'从喜欢的作品开始改造':'自己的原创想法'}));
   grid.append(card);
  }
  box.append(grid);
  if(!r.drafts?.length)box.append(node('div',{class:'community-empty'},node('h2',{text:'从一个小想法开始'}),node('p',{text:'说说你想做什么，或者把喜欢的作品改成自己的。'}),this.button('新建作品',()=>this.show('new'),'primary')));
 }
 async edit(id){
  this.tab='mine';const box=this.page('正在打开草稿',()=>this.mine(),'edit'),epoch=this.epoch;
  const r=await this.read('/drafts/'+id);if(epoch!==this.epoch)return;this.editing=r;this.root.querySelector('h1').textContent=r.draft.title;
  const prompt=node('textarea',{rows:'3',maxlength:'4000',placeholder:'你想怎么改？长按空格说出来。','aria-label':'修改想法'});
  prompt.value=this.ideas.get(id)||'';prompt.oninput=()=>this.ideas.set(id,prompt.value);
  const form=node('form',{class:'community-edit-form'},node('label',{class:'community-prompt-label'},'这次想改点什么？',prompt),node('button',{type:'submit',class:'primary',text:'帮我修改'}));
  form.onsubmit=e=>{e.preventDefault();this.run(()=>this.generate(prompt.value));};
  const actions=node('div',{class:'community-actions community-editor-actions'},this.button('体验作品',()=>this.preview({draft_id:id},()=>this.edit(id)),'primary'),this.button('添加到桌面',()=>this.install({draft_id:id},()=>this.edit(id))),this.button('分享作品',()=>this.publishForm()));
  const job=node('div',{class:'community-job',role:'status'}),more=this.button('更多操作',()=>this.editOptions(r),'secondary');
  if(this.desktop){
   const stage=node('div',{class:'community-preview-stage'}),preview=node('section',{class:'community-editor-preview'},node('div',{class:'community-pane-head'},node('h2',{text:'当前作品'}),node('span',{class:'community-hint',text:r.draft.creation_pending?'等待创作':'已保存到账号'})),stage,actions,node('p',{class:'community-hint',text:'预览数据临时保存，安装后在设备上使用。'}));
   const panel=node('section',{class:'community-editor-panel'},node('div',{class:'community-pane-head'},node('h2',{text:'和 AI 一起修改'})),node('p',{class:'community-hint',text:'描述想改的地方，AI 会保留作品原有内容。'}),form,job,node('div',{class:'community-editor-footer'},node('span',{class:'community-hint',text:'修改先存为私人草稿'}),more));
   box.append(node('div',{class:'community-editor-layout'},preview,panel));
   if(r.draft.creation_pending)stage.append(node('p',{class:'community-hint',text:'说说你的想法，创作完成后在这里体验。'}));
   else void this.mountPreview(r.bundle,stage,epoch);
  }else box.append(actions,form,job,more);
  if(r.draft.creation_pending){this.message('想法已保存，完成创作后就能体验和安装。');actions.querySelectorAll('button').forEach(button=>button.disabled=true);}
  const jobs=await this.host.call('/community/jobs',{});if(epoch!==this.epoch)return;
  const latest=jobs.jobs?.find(j=>j.draft_id===id);if(latest)this.jobStatus(latest,epoch);
 }
 editOptions(r){
  const id=r.draft.id,box=this.page('更多操作',()=>this.edit(id),'options');
  if(r.draft.can_suggest)box.append(this.button('把改进送给作者',()=>this.suggestForm(),'community-list'));
  box.append(this.button('撤回上次修改',async()=>{if(!confirm('撤回最后一次已保存的修改？公开版本和已安装的应用不会改变。'))return;await this.write('undo',{draft_id:id,revision:r.draft.revision});await this.edit(id);},'community-list'),this.button('高级源码',()=>this.host.advanced?this.host.advanced(id):this.source(r.bundle,()=>this.editOptions(r)),'community-list'));
 }
 async generate(prompt){if(!prompt.trim())throw Error('先说说想怎么修改');const d=this.editing.draft;const r=await this.write('generate',{draft_id:d.id,revision:d.revision,prompt:prompt.trim()});this.ideas.delete(d.id);this.jobStatus(r.job,this.epoch);}
 jobStatus(job,epoch){if(epoch!==this.epoch||!this.active)return;const target=this.root.querySelector('.community-job');if(!target)return;const busy=['queued','generating'].includes(job.status);target.replaceChildren(node('p',{text:({queued:'正在排队…',generating:'AI 正在修改，原稿已保留…',completed:'修改完成，已同步到账号。',failed:'修改未完成：'+job.error,interrupted:job.error})[job.status]||job.status}));
  this.root.querySelectorAll('form button').forEach(b=>b.disabled=busy);
  if(job.status==='completed')target.append(this.button('体验最新结果',()=>this.preview({draft_id:job.draft_id},()=>this.edit(job.draft_id))));
  if(!busy)return;clearTimeout(this.timer);this.timer=setTimeout(async()=>{try{const r=await this.host.call('/community/job',{id:job.id});if(epoch!==this.epoch)return;if(r.job.status==='completed'){await this.edit(job.draft_id);this.message('修改完成，已同步。可以体验、安装或继续修改。');}else this.jobStatus(r.job,epoch);}catch(e){if(epoch!==this.epoch)return;target.replaceChildren(node('p',{text:'读取进度失败，任务可能仍在运行。'}),this.button('重新读取',async()=>this.jobStatus((await this.host.call('/community/job',{id:job.id})).job,epoch)));}},1500);
 }
 async install(ref,back){const box=this.page('添加到桌面',back,'install'),epoch=this.epoch;const value=await this.bundle(ref),targets=await this.host.targets();if(epoch!==this.epoch)return;const select=node('select',{'aria-label':'安装到哪台设备'},...targets.map(t=>new Option(t.name+(t.online===false?' · 离线':''),t.id)));box.append(node('h2',{text:value.bundle.manifest.name}),node('p',{text:'添加后，就能从设备桌面打开。'}),value.bundle.manifest.capabilities?.length?node('p',{text:'需要访问：'+value.bundle.manifest.capabilities.map(c=>({notes:'便签',agenda:'日程','task-state':'电脑任务状态'})[c]||'未知能力（请检查源码）').join('、')}):node('p',{class:'community-hint',text:'无需访问便签、日程或电脑任务。'}),select);
  if(!targets.length){box.append(node('p',{text:'还没有可用设备。请在小电脑登录同一账号，或启动 Mac 模拟器。'}));return;}
  box.append(this.button('确认添加',async()=>{const key='install:'+select.value+JSON.stringify(ref);if(!this.pending.has(key))this.pending.set(key,crypto.randomUUID());const result=await this.host.install(ref,select.value,this.pending.get(key));this.pending.delete(key);this.message(result.status==='queued'?'已发送，等待设备安装；可以在动态中查看结果。':result.message||'已添加到桌面。');if(result.status==='queued'&&this.host.deliveries)box.replaceChildren(node('h2',{text:'正在送到你的设备'}),node('p',{text:'安装完成后会出现在桌面，离线设备会在重新联网后继续。'}),this.button('查看安装进度',()=>this.activity(),'primary'));},'primary'));
 }
 async publishForm(){const id=this.editing.draft.id;const box=this.page('分享作品',()=>this.edit(id),'publish');const title=node('input',{value:this.editing.draft.title,maxlength:'80','aria-label':'作品名称'}),desc=node('textarea',{rows:'2',maxlength:'500','aria-label':'作品简介',text:this.editing.draft.description||''}),changes=node('input',{value:'分享我的作品',maxlength:'500','aria-label':'更新说明'}),file=node('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':'上传首页截图'}),check=node('input',{type:'checkbox'}),preview=node('div',{class:'community-cover-review'});const cover=this.cover(this.editing.draft.cover_id);if(cover)preview.append(cover);else preview.append(node('p',{class:'community-hint',text:'添加一张真实首页截图，让大家看见你的作品。'}));
  file.onchange=()=>this.run(async()=>{if(!file.files[0])return;const image=await this.screenshot(file.files[0]);const r=await this.write('cover',{draft_id:id,revision:this.editing.draft.revision,image});this.editing.draft=r.draft;preview.replaceChildren(this.cover(r.draft.cover_id));this.message('截图已保存到私人草稿，请检查后再公开。');});
  const fields=node('div',{class:'community-publish-fields'},node('label',{},'名字',title),node('label',{},'一句话介绍',desc),node('label',{},'这次更新',changes));
  const media=node('div',{class:'community-publish-media'},node('h2',{text:'首页截图'}),preview,node('label',{class:'community-upload-label'},'选择首页截图',file),node('p',{class:'community-hint',text:'PNG / JPEG / WebP，最多 20 MiB。请上传实际运行画面；含照片或便签的应用请用空白或明确的演示数据。'}));
  const confirm=node('div',{class:'community-publish-confirm'},node('label',{class:'community-check'},check,node('span',{text:'我已检查截图和源码可公开，没有密钥或私人信息。同意按 '+this.editing.draft.license+' 分享，并保留原作署名。'})),this.button('确认公开发布',async()=>{if(!check.checked)throw Error('先检查并勾选公开确认');if(!this.editing.draft.cover_id)throw Error('请上传真实首页截图');const result=await this.write('publish',{draft_id:id,revision:this.editing.draft.revision,title:title.value,description:desc.value,changelog:changes.value,confirm:true});await this.work(result.work.id);this.message('第 '+result.version.number+' 版已公开，大家可以体验并改造。');},'primary'));
  box.append(node('div',{class:'community-publish-form'},node('div',{class:'community-publish-layout'},media,fields),confirm));
 }
 async screenshot(file){if(file.size>20*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择不超过 20 MiB 的 PNG、JPEG 或 WebP');const url=URL.createObjectURL(file),img=new Image();try{img.src=url;await img.decode();if(img.naturalWidth*img.naturalHeight>64000000)throw Error('图片分辨率过大');const scale=Math.min(1,1280/img.naturalWidth,960/img.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.85);}finally{URL.revokeObjectURL(url);}}
 suggestForm(){const d=this.editing.draft,box=this.page('把改进送给原作者',()=>this.edit(d.id),'suggest'),summary=node('textarea',{maxlength:'500',rows:'3',placeholder:'你改进了什么？为什么更好玩或更好用？','aria-label':'改进说明'}),check=node('input',{type:'checkbox'});box.append(summary,node('p',{text:'原作者将收到这一版源码快照，只有他可以采用。你的副本保持独立；这一步不会公开发布。'}),node('label',{class:'community-check'},check,node('span',{text:'我确认源码可以交给原作者，且没有私人信息或密钥。'})),this.button('提交改进建议',async()=>{if(!check.checked)throw Error('请先确认源码可以分享');await this.write('suggest',{draft_id:d.id,revision:d.revision,summary:summary.value,confirm:true});await this.activity();this.message('建议已送出，原作者采用后会出现在这里。');},'primary'));}
 async activity(){
  this.tab='activity';const box=this.page('作品动态'),epoch=this.epoch;
  const result=await this.host.call('/community/suggestions',{});
  if(epoch!==this.epoch)return;
  for(const suggestion of result.suggestions||[]){
   const card=this.button('',()=>this.review(suggestion.id),'community-draft');
   const status={open:'等待原作者审阅',accepted:'已采用到私人草稿，等待发布',declined:'暂不采用'}[suggestion.status];
   card.append(node('h2',{text:suggestion.title}),node('p',{text:suggestion.summary}),node('small',{text:suggestion.author+' → '+suggestion.owner+' · '+status}));
   box.append(card);
  }
  if(!result.suggestions?.length)box.append(node('p',{text:'暂时没有改进建议。先把喜欢的作品改成自己的，再把改进送给原作者。'}));
  if(!this.host.deliveries)return;
  const installs=node('div',{'aria-live':'polite'});box.append(installs);
  const refresh=async()=>{
   try{
    const deliveries=await this.host.deliveries();
    if(epoch!==this.epoch||!this.active)return;
    installs.replaceChildren(...deliveries.map(d=>node('p',{text:d.name+' · '+({queued:'等待设备安装',installed:'已安装',failed:'安装失败：'+d.error})[d.status]})));
    if(deliveries.some(d=>d.status==='queued'))this.timer=setTimeout(refresh,3000);
   }catch(e){if(epoch===this.epoch&&this.active){this.message('读取安装进度失败，原任务保留。',true);installs.replaceChildren(this.button('重新读取安装进度',refresh));}}
  };
  await refresh();
 }
 async review(id){const box=this.page('一起完善这个作品',()=>this.activity()),epoch=this.epoch;const r=await this.host.call('/community/suggestion',{id});if(epoch!==this.epoch)return;const s=r.suggestion;box.append(node('h2',{text:s.title}),node('p',{text:s.summary}),node('p',{text:s.author+' 修改了 '+r.changed_files.length+' 个文件。'}),this.button('体验改进版本',()=>this.preview(null,()=>this.review(id),r.bundle),'primary'),this.button('查看文件差异',()=>{const area=this.page('修改了什么',()=>this.review(id));for(const f of r.changed_files)area.append(node('h3',{text:f}),node('pre',{text:'之前\n'+(r.base_bundle.files[f]||'不存在')}),node('pre',{text:'之后\n'+(r.bundle.files[f]||'已删除')}));}));
  if(r.can_review&&s.status==='open')box.append(node('p',{text:'采用会创建独立的审阅草稿，保留你现有的未发布修改。检查后还需要单独发布。'}),this.button('采用到审阅草稿',async()=>{if(!confirm('确认采用到新的私人草稿？这不会立即发布或覆盖你的其他草稿。'))return;const result=await this.write('review',{id,decision:'accept',confirm:true,head_version_id:r.head_version_id});await this.edit(result.suggestion.review_draft_id);},'primary'),this.button('暂不采用',async()=>{if(!confirm('确认暂不采用这个建议？对方的副本会保留。'))return;await this.write('review',{id,decision:'decline',confirm:true});await this.activity();}));
  else if(s.review_draft_id&&r.can_review)box.append(this.button('继续审阅草稿',()=>this.edit(s.review_draft_id)));
 }
};
})();
