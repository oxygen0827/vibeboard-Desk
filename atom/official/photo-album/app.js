/* One photo experience on the computer and ATOM. Tokens stay in the host. */
(()=>{'use strict';
const root=document.getElementById('root'),pc=new URLSearchParams(location.search).get('host')==='computer';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const active=s=>['queued','generating','saving'].includes(s);
// The computer host owns the appearance; no user data travels in this message.
if(pc&&parent!==window){
 window.addEventListener('message',e=>{
  if(e.source!==parent||e.data?.type!=='atom:appearance'||!['light','dark'].includes(e.data.mode))return;
  document.documentElement.dataset.appearance=e.data.mode;
  document.documentElement.style.colorScheme=e.data.mode;
 });
 parent.postMessage({type:'atom:appearance-request'},'*');
}
const labels={queued:'等待开始',generating:'正在生成',saving:'正在保存到相册',completed:'已保存到相册',failed:'生成失败',interrupted:'生成已中断'};
let alive=true,seq=0,pending=new Map(),user=null,accountChecked=false,config=null,screen='library',filter='all',page=0,listing={items:[],pages:0,total:0},
    selected=null,reference=null,before=null,job=null,jobs=[],busy=false,loading=false,message='',error='',readFailed=false,
    prefs={style:'clay',frameSensing:false},frameSensing=false,frameSaving=false,frameReturn='library',prompt='',style='clay',slideshow=false,clean=false,hideTimer=null,slideTimer=null,pollTimer=null,syncTimer=null,
    zoom=1,panX=0,panY=0,zoomPhoto=null,suppressClick=false,photoLoading=false,photoCache=new Map(),photoRequests=new Map(),generationRequest=null,creatingSignature='',deleteConfirm=false,voice='',viewEpoch=0,accountEpoch=0;
const limit=()=>innerWidth<=600?6:12;
function rpc(action,data={}){if(!alive)return Promise.reject(Error('相册已关闭'));return new Promise((resolve,reject)=>{
 const id='photo-'+(++seq),t=setTimeout(()=>{pending.delete(id);reject(Error('连接超时，请刷新查看结果；生成任务不会自动重发'))},action==='download'?300000:action==='upload'?180000:60000);
 pending.set(id,{resolve,reject,t});parent.postMessage({type:'atom:photos',id,action,data:{...data,...(user&&action!=='state'?{expected_user_id:user.id}:{})}},'*');
});}
window.addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data||{};
 if(d.type==='atom:photos-result'){const p=pending.get(d.id);if(!p)return;pending.delete(d.id);clearTimeout(p.t);if(d.error){const err=Error(d.error);err.status=d.status;p.reject(err)}else p.resolve(d.result)}
 if(d.type==='atom:photos-suspend')stop();
 if(d.type==='atom:photo-voice'){
  if(screen!=='create'&&d.state==='starting'){reference=(screen==='view'||screen==='compare')?selected:null;screen='create';stopSlide()}
  voice=d.state==='recording'?'正在聆听，松开空格结束':d.state==='transcribing'?'正在转写…':d.error||'';
  if(d.state==='done'&&d.text){prompt=(prompt+' '+d.text).trim().slice(0,1500);voice='';generationRequest=null}render();
 }
});
function button(action,text,cls='',disabled=false){return '<button type="button" data-action="'+action+'" class="'+cls+'" '+(disabled?'disabled':'')+'>'+text+'</button>'}
function feedback(){return '<div class="feedback '+(error?'error':'')+'" role="status">'+esc(error||voice||message)+'</div>'}
function backLabel(){if(screen==='frame')return frameReturn==='view'?'照片':'相册';return screen==='library'?'桌面':screen==='compare'||screen==='create'&&reference?'照片':'相册'}
function backControl(){return '<button type="button" data-atom-back data-action="back" class="album-back" aria-label="返回'+backLabel()+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg><span>'+backLabel()+'</span></button>'}
function goBack(){if(screen==='frame'){screen=frameReturn;render();if(screen==='view')showDetails();return}if(deleteConfirm){deleteConfirm=false;render();return}if(screen==='compare'){perform('end-compare');return}if(screen==='create'&&reference){screen='view';clean=false;render();return}if(screen!=='library'){perform('library').catch(e=>{error=e.message;render()});return}if(window.AtomApp)AtomApp.home()}
function heading(title,subtitle,actions){return '<header>'+(pc&&screen==='library'?'':backControl())+'<div class="heading"><h1>'+title+'</h1><p>'+esc(subtitle)+'</p></div><div class="actions">'+actions+'</div></header>'}
function empty(title,text,actions=''){return '<div class="empty"><img src="icon.svg" alt=""><h2>'+title+'</h2><p>'+text+'</p>'+actions+'</div>'}
function render(){if(!alive)return;
 if(screen==='view'||screen==='compare'){renderViewer();return}
 // Polling updates text in place: replacing the spinner restarts its animation.
 if(screen==='job'&&job&&active(job.status)&&root.querySelector('[data-running-job]')?.dataset.runningJob===job.id){
  root.querySelector('[data-job-status]').textContent=labels[job.status]||job.status;
  root.querySelector('[data-job-detail]').textContent=job.error||'可以返回相册或退出应用，任务会继续执行。';
  const f=root.querySelector('.feedback');f.textContent=error||voice||message;f.classList.toggle('error',!!error);return;
 }
 cancelAnimationFrame(zoomFrame);zoomFrame=0;zoomView=null;
 let html='';
 if(screen==='frame'){
  html=heading('感知相框','拿起看细节，放下留住风景','')+
   '<div class="frame-settings"><div class="frame-card"><div><h2>感知陪伴</h2><p>开启后，无人时照片柔和变暗。回来或操作时恢复。</p></div><button type="button" role="switch" aria-checked="'+frameSensing+'" data-action="frame-toggle" '+(readFailed||frameSaving?'disabled':'')+'>'+ (frameSaving?'保存中…':frameSensing?'已开启':'已关闭')+'</button></div>'+
   '<div class="frame-status" role="status"></div><p class="frame-note">只影响全屏照片，不改变屏幕亮度。感知未连接时，仍可手动浏览与轮播。</p>'+
   (readFailed?'<p>偏好读取失败，未覆盖原记录。</p>'+button('retry-read','重试读取'):'')+'</div>'+feedback();
 }else if(screen==='create'){
  html=heading('灵感暗房',reference?'给这张照片一个新模样':'把想象留成一张照片','')+
   '<div class="studio"><div class="reference">'+(reference?'<img src="'+esc(reference.data_url)+'" alt="参考照片"><span class="reference-label">参考照片</span>':empty('从想象开始','描述一个画面<br>挑选你喜欢的风格'))+'</div><div class="create-form">'+
   '<div class="creation-presets"><label>创作模板<select id="photo-template" aria-label="创作模板，替换当前描述"><option value="">选择模板 · 可修改</option>'+((config&&config.templates)||[]).filter(t=>t.mode===(reference?'edit':'text')).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label><label>画面风格<select id="photo-style" aria-label="画面风格">'+(config&&config.styles||[]).map(s=>'<option value="'+esc(s.id)+'" '+(style===s.id?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label></div>'+
   '<textarea id="photo-prompt" aria-label="画面描述" maxlength="1500" placeholder="'+(reference?'比如：把背景变成雨后的京都小巷':'比如：一座漂浮在云海里的小房子')+'">'+esc(prompt)+'</textarea>'+
   '<p class="privacy">'+(reference?'点击生成时，参考照片与描述会发送至火山方舟。':'描述会发送至火山方舟。')+'结果作为新照片保存。</p>'+button('generate',busy?'正在提交…':'生成新作品','primary',busy||!config||!config.generation_enabled)+'</div></div>'+
   (!config||!config.generation_enabled?'<p class="privacy">当前账号未启用生图服务，照片同步仍可使用。</p>':'')+feedback();
 }else if(screen==='job'){
  const running=job&&active(job.status);
  html=heading('正在创作',job?new Date(job.created_at*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'','')+
   '<div class="empty" '+(running?'data-running-job="'+esc(job.id)+'"':'')+'><div class="job-art">'+(running?'<div class="ring"></div>':'<img src="icon.svg" alt="">')+'</div><h2 data-job-status role="status">'+esc(job?labels[job.status]||job.status:'正在读取任务')+'</h2>'+
   '<p data-job-detail>'+esc(job&&job.error||(running?'可以返回相册或退出应用，任务会继续执行。':'原照片一直保留。'))+'</p>'+
   (job&&job.status==='completed'?button('open-result','查看作品','primary'):job&&!running?button('retry-create','重新创作','primary'):'')+'</div>'+feedback();
 }else if(screen==='jobs'){
  html=heading('创作记录','最近 12 次生成','')+'<div class="job-list">'+jobs.map(j=>'<div class="job-row"><div><strong>'+esc(j.prompt||'照片风格改写')+'</strong><p>'+esc(labels[j.status]||j.status)+(j.error?' · '+esc(j.error):'')+'</p></div>'+button('job:'+j.id,j.status==='completed'?'查看':'详情','quiet')+'</div>').join('')+'</div>'+(!jobs.length?empty('还没有创作','从一句话或一张照片开始'): '')+feedback();
 }else{
  html=heading('相册',user?user.username+' · '+listing.total+' 张照片':accountChecked?'和 ATOM 分享你的生活':'正在连接你的相册',button('jobs','创作','quiet',!user)+(pc?button('import','导入','quiet',busy||!user):'')+button('create','＋ 灵感','primary',!user))+
   (readFailed?'<div class="notice">偏好读取失败，未覆盖原记录。'+button('retry-read','重试')+'</div>':'')+
   (!accountChecked?'<div class="empty account-loading" role="status">'+(error?'<h2>暂时无法连接相册</h2><p>请检查网络后重试。</p>'+button('refresh','重试','primary'):'<span class="album-spinner" aria-hidden="true"></span><h2>正在加载相册</h2><p>正在确认账号并同步照片…</p>')+'</div>':!user?empty('把生活带到桌边','在电脑和 ATOM 登录同一个应用市场账号，<br>照片就能出现在这里。',button('login','登录账号','primary')+button('refresh','重试','quiet')):
    '<div class="tabs">'+[['all','全部'],['favorites','收藏'],['generated','AI 作品']].map(([v,t])=>button('filter:'+v,t,filter===v?'on':'')).join('')+button('frame-settings','相框','frame-settings-link')+'</div>'+
    (listing.items.length?'<div class="grid">'+listing.items.map(p=>'<button class="photo" data-action="photo:'+p.id+'" aria-label="'+esc(p.name)+'"><img src="'+p.thumbnail+'" alt="'+esc(p.name)+'">'+(p.generated?'<span class="ai">AI</span>':'')+(p.favorite?'<span class="heart">♥</span>':'')+'</button>').join('')+'</div>':empty(loading?'正在同步照片…':'留一张值得回看的照片',filter==='all'?(pc?'支持苹果 HEIC / HEIF、JPEG、PNG、WebP<br>每张最多 20 MiB，原文件完整保留。':'在电脑端相册导入照片，<br>也可以在这里创作新作品。'):'这里还没有照片'))+
    '<div class="pager"><span>'+esc(loading?'正在同步…':listing.pages?'第 '+(page+1)+' / '+listing.pages+' 页':'私有云端相册')+'</span><div class="actions">'+button('previous','‹','quiet',page===0)+button('next','›','quiet',page+1>=listing.pages)+button('refresh','同步','quiet',loading)+'</div></div>')+feedback()+
   (pc?'<input class="visually-hidden" type="file" id="photo-files" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple>':'');
 }
 root.innerHTML='<section class="album">'+html+'</section>';paintFrame();
 if(window.AtomApp&&!render.ready){AtomApp.ready();render.ready=true}
}
function photoStep(direction,label){return '<button type="button" id="photo-'+direction+'" class="viewer-step step-'+direction+'" data-action="view-'+direction+'" aria-label="'+label+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(direction==='prev'?'m15 5-7 7 7 7':'m9 5 7 7-7 7')+'"/></svg></button>'}
function renderViewer(){if(!selected){screen='library';render();return}
 clearTimeout(rasterTimer);rasterTimer=null;const compare=screen==='compare'&&before;if(zoomPhoto!==selected.photo.id){zoomPhoto=selected.photo.id;zoom=1;panX=panY=0}
 root.innerHTML='<section class="viewer '+(clean?'clean ':'')+(compare?'compare':'')+'">'+
  (compare?'<img src="'+esc(before.data_url)+'" alt="原照片"><img class="after" src="'+esc(selected.data_url)+'" alt="AI 版本"><div class="labels"><span>原照片</span><span>新版本</span></div><input type="range" id="compare-range" min="0" max="100" value="50" aria-label="对比原图与生成版本">':'<img class="picture" src="'+esc(selected.data_url)+'" alt="'+esc(selected.photo.name)+'">')+
  '<div class="viewer-top">'+backControl()+'<span class="caption">'+esc(selected.photo.name)+'</span><div class="zoom-tools">'+button('zoom-out','−')+button('zoom-reset','100%')+button('zoom-in','＋')+'</div>'+button('favorite',selected.photo.favorite?'♥':'♡','',busy||photoLoading)+'</div>'+
  (compare?'':photoStep('prev','上一张照片')+photoStep('next','下一张照片'))+
  '<div class="bottom">'+(compare?button('end-compare','结束对比'):button('slideshow',slideshow?'暂停':'轮播','',photoLoading)+button('edit-photo','改写','',photoLoading)+button('frame-settings','感知')+(selected.photo.parent_id?button('compare','对比','',photoLoading):'')+(pc?button('download','原图'):'')+button('delete','删除','',photoLoading))+'</div>'+
  '<div class="pan-tools" aria-label="移动放大的照片" hidden>'+button('pan-left','←')+button('pan-up','↑')+button('pan-down','↓')+button('pan-right','→')+'</div>'+
  (photoLoading?'<span class="photo-loading" role="status">正在加载清晰照片…</span>':'')+
  (error?'<div class="view-error">'+esc(error)+'<br>'+button('retry-photo','重新加载')+button('dismiss-error','知道了')+'</div>':'')+
  (deleteConfirm?'<div class="confirm" role="dialog" aria-modal="true" aria-label="删除照片"><div><h2>删除这张照片？</h2><p>会从电脑与 ATOM 的同步相册中删除。关联的其他版本会保留。</p><div class="actions">'+button('cancel-delete','取消')+button('confirm-delete','删除','danger',busy)+'</div></div></div>':'')+'</section>';
 paintZoom();paintFrame();
}
async function refresh(){if(loading||!alive)return;loading=true;error='';render();
 try{const s=await rpc('state');if(!alive)return;if(user&&user.id!==s.user?.id){listing={items:[],pages:0,total:0};selected=reference=null;accountEpoch++;clearPhotos()}user=s.user;config=s;accountChecked=true;
  const result=await rpc('list',{page,filter,limit:limit()});if(!alive)return;
  if(page&&page>=result.pages){page=Math.max(0,result.pages-1);listing=await rpc('list',{page,filter,limit:limit()})}else listing=result;
  message='照片已同步';
 }catch(e){error=e.message;if(e.status===401||e.status===403){accountChecked=true;user=null;listing={items:[],pages:0,total:0};selected=reference=null;accountEpoch++;clearPhotos()}}
 finally{loading=false;render()}
}
// Small, account-scoped memory cache: never persist private image bytes in browser storage.
function clearPhotos(){photoCache.clear();photoRequests.clear()}
function photoKey(id){return (user?.id||'')+':'+id}
function fetchPhoto(id){const key=photoKey(id),cached=photoCache.get(key),meta=listing.items.find(p=>p.id===id);if(cached&&(!meta||cached.photo.revision===meta.revision))return Promise.resolve(cached);
 if(photoRequests.has(key))return photoRequests.get(key);const account=accountEpoch;
 const request=rpc('get',{id}).then(async r=>{const image=new Image();image.src=r.data_url;try{if(image.decode)await image.decode()}catch(_){}if(alive&&account===accountEpoch){photoCache.delete(key);photoCache.set(key,r);let bytes=Array.from(photoCache.values()).reduce((n,x)=>n+x.data_url.length*2,0);while(photoCache.size>3||bytes>12*1024*1024){const first=photoCache.keys().next().value;bytes-=photoCache.get(first).data_url.length*2;photoCache.delete(first)}}return r}).finally(()=>{if(photoRequests.get(key)===request)photoRequests.delete(key)});photoRequests.set(key,request);return request;
}
function prefetchNext(){const i=listing.items.findIndex(p=>p.id===selected?.photo.id),next=listing.items[i+1]||(listing.pages===1?listing.items[0]:null);if(next&&next.id!==selected?.photo.id)fetchPhoto(next.id).catch(()=>{})}
async function openPhoto(id,{automatic=false}={}){const epoch=++viewEpoch,meta=listing.items.find(p=>p.id===id);error='';message='';deleteConfirm=false;if(!automatic)clearTimeout(hideTimer);
 // Tapping opens the existing thumbnail immediately. Automatic playback holds the previous frame until ready.
 if(!automatic){clean=false;photoLoading=true;if(meta){selected={photo:meta,data_url:meta.thumbnail};screen='view';render()} }
 try{const r=await fetchPhoto(id);if(!alive||epoch!==viewEpoch)return;selected=r;screen='view';photoLoading=false;render();if(!automatic)autoHide();prefetchNext()}
 catch(e){if(!alive||epoch!==viewEpoch)return;photoLoading=false;error='清晰照片加载失败：'+e.message;clean=false;render();throw e}
}

function autoHide(){clearTimeout(hideTimer);if(screen==='view')hideTimer=setTimeout(()=>{if(alive&&screen==='view'&&!deleteConfirm&&!error&&!pointer&&document.documentElement.dataset.atomInput!=='joystick'){clean=true;root.querySelector('.viewer')?.classList.add('clean')}},3500)}
function stopSlide(){slideshow=false;clearTimeout(slideTimer);slideTimer=null;const b=root.querySelector('[data-action="slideshow"]');if(b)b.textContent='轮播'}
// Cache geometry and controls once per view; pointer events only update the transform once per frame.
let zoomView=null,zoomFrame=0,rasterTimer=null;
function boostZoom(){const v=root.querySelector('.viewer');if(!v)return;if(!v.classList.contains('zoom-moving'))v.classList.add('zoom-moving');clearTimeout(rasterTimer);rasterTimer=setTimeout(()=>{rasterTimer=null;if(v.isConnected){v.classList.remove('zoom-moving');queueZoom()}},180)}
function queueZoom(){if(!zoomFrame)zoomFrame=requestAnimationFrame(()=>{zoomFrame=0;paintZoom()})}
function measureZoom(){if(zoomView){const r=zoomView.v.getBoundingClientRect();zoomView.w=r.width;zoomView.h=r.height;zoomView.left=r.left;zoomView.top=r.top}queueZoom()}
function paintZoom(){const v=root.querySelector('.viewer');if(!v)return;
 if(!zoomView||zoomView.v!==v){const imgs=Array.from(v.querySelectorAll(':scope > img')),r=v.getBoundingClientRect();zoomView={v,imgs,w:r.width,h:r.height,left:r.left,top:r.top,reset:v.querySelector('[data-action="zoom-reset"]'),pan:v.querySelector('.pan-tools'),range:v.querySelector('#compare-range'),after:v.querySelector('.after'),percent:null,expanded:null};imgs.forEach(el=>{el.draggable=false;el.onload=measureZoom});v.querySelector('[data-action="zoom-out"]').setAttribute('aria-label','缩小照片');v.querySelector('[data-action="zoom-in"]').setAttribute('aria-label','放大照片');for(const [dir,label] of [['left','向左'],['right','向右'],['up','向上'],['down','向下']])v.querySelector('[data-action="pan-'+dir+'"]').setAttribute('aria-label',label+'移动照片');}
 const z=zoomView,img=z.imgs[0];if(!img)return;const w=z.w,h=z.h,fit=Math.min(w/(img.naturalWidth||w),h/(img.naturalHeight||h)),mx=Math.max(0,((img.naturalWidth||w)*fit*zoom-w)/2),my=Math.max(0,((img.naturalHeight||h)*fit*zoom-h)/2);panX=Math.max(-mx,Math.min(mx,panX));panY=Math.max(-my,Math.min(my,panY));const expanded=zoom>1;
 if(z.expanded!==expanded){z.expanded=expanded;v.classList.toggle('zoomed',expanded);z.pan.hidden=!expanded}
 const transform=(v.classList.contains('zoom-moving')?'translate3d('+panX+'px,'+panY+'px,0)':'translate('+panX+'px,'+panY+'px)')+' scale('+zoom+')';z.imgs.forEach(el=>{if(el.style.transform!==transform)el.style.transform=transform});
 const percent=Math.round(zoom*100);if(z.percent!==percent){z.percent=percent;z.reset.textContent=percent+'%';z.reset.setAttribute('aria-label','恢复完整照片，当前 '+percent+'%')}
 if(z.range){const cut=((w*Number(z.range.value)/100-panX-w/2)/zoom+w/2)/w*100;z.after.style.clipPath='inset(0 0 0 '+Math.max(0,Math.min(100,cut))+'%)'}
}

function setZoom(next,x,y){const v=root.querySelector('.viewer');if(!v||deleteConfirm)return;next=Math.max(1,Math.min(8,next));if(!zoomView||zoomView.v!==v)paintZoom();const r={left:zoomView.left,top:zoomView.top,width:zoomView.w,height:zoomView.h},px=(x??r.left+r.width/2)-r.left-r.width/2,py=(y??r.top+r.height/2)-r.top-r.height/2;panX=px-(px-panX)*next/zoom;panY=py-(py-panY)*next/zoom;zoom=next;boostZoom();if(slideshow)stopSlide();showDetails();queueZoom()}

async function movePhoto(delta,automatic=false){const epoch=viewEpoch;let i=listing.items.findIndex(p=>p.id===selected?.photo.id);i+=delta;
 if(i<0||i>=listing.items.length){const nextPage=(page+(delta>0?1:-1)+Math.max(1,listing.pages))%Math.max(1,listing.pages),nextList=await rpc('list',{page:nextPage,filter,limit:limit()});if(!alive||epoch!==viewEpoch||automatic&&!slideshow)return;page=nextPage;listing=nextList;i=delta>0?0:listing.items.length-1}
 if(listing.items[i])await openPhoto(listing.items[i].id,{automatic});
}
function scheduleSlide(){clearTimeout(slideTimer);if(!slideshow)return;slideTimer=setTimeout(async()=>{if(!alive||!slideshow)return;try{await movePhoto(1,true)}catch(e){stopSlide();error=e.message;render()}if(slideshow)scheduleSlide()},6000)}
async function watchJob(id){clearTimeout(pollTimer);const epoch=accountEpoch;
 try{const r=await rpc('job',{id});if(!alive||epoch!==accountEpoch||job?.id!==id)return;job=r.job;
  if(screen==='job'){
   if(job.status==='completed'&&job.photo_id){render();await openPhoto(job.photo_id);return}
   render();
  }
  if(active(job.status))pollTimer=setTimeout(()=>watchJob(id),2500);
 }catch(e){if(alive&&epoch===accountEpoch&&job?.id===id&&screen==='job'){error=e.message;render()}}
}
async function loadJobs(){jobs=(await rpc('jobs')).jobs;screen='jobs';render()}
async function savePreference(){if(!window.AtomApp||readFailed)return;try{await AtomApp.save({...prefs,style,frameSensing})}catch(e){message='风格偏好未保存，下次可重新选择'}}
async function generate(){if(busy)return;const signature=JSON.stringify([prompt,style,reference?.photo.id||null]);if(signature!==creatingSignature){generationRequest=null;creatingSignature=signature}generationRequest=generationRequest||uid();busy=true;error='';render();
 try{const r=await rpc('generate',{request_id:generationRequest,prompt,style,source_id:reference?.photo.id||null});job=r.job;screen='job';await savePreference();watchJob(job.id)}catch(e){error=e.message}finally{busy=false;render()}
}
async function upload(files){if(busy)return;busy=true;error='';let count=0;
 try{for(const f of files){
  const extension=f.name.split('.').pop().toLowerCase(),aliases={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif'};
  const declared=(f.type||'').toLowerCase(),supported=['image/jpeg','image/png','image/webp','image/heic','image/heif'];
  const mime=supported.includes(declared)?declared:(!declared||declared==='application/octet-stream'||/^image\/hei[cf]-sequence$/.test(declared))?aliases[extension]:null;
  if(!mime)throw Error(f.name+'：格式不支持，请选择 HEIC、HEIF、JPEG、PNG 或 WebP');
  const maximum=config?.max_original_bytes||20*1024*1024;
  if(f.size>maximum)throw Error(f.name+'：超过 '+Math.round(maximum/1024/1024)+' MiB，请导出较小版本');
  message='正在上传 '+(count+1)+' / '+files.length+' · '+f.name;render();
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('无法读取照片'));r.readAsDataURL(f)});
  await rpc('upload',{id:uid(),name:f.name.slice(0,100),data_url:'data:'+mime+';base64,'+String(data).split(',')[1]});count++;
 }page=0;await refresh();message=count+' 张照片已上传并同步';
 }catch(e){error=(count?count+' 张已上传；':'')+e.message}finally{busy=false;render()}
}
async function perform(action){error='';
 if(action.startsWith('zoom-')){setZoom(action==='zoom-reset'?1:zoom*(action==='zoom-in'?1.25:.8));return}
 if(action.startsWith('pan-')){stopSlide();panX+=action==='pan-left'?60:action==='pan-right'?-60:0;panY+=action==='pan-up'?60:action==='pan-down'?-60:0;showDetails();paintZoom();return}
 if(action==='back'){goBack();return}
 if(action==='frame-settings'){frameReturn=screen==='view'?'view':'library';stopSlide();screen='frame';render();return}
 if(action==='frame-toggle'){await toggleFrame();return}
 if(action==='retry-photo'){await openPhoto(selected.photo.id);return}
 if(action==='library'){viewEpoch++;screen='library';stopSlide();deleteConfirm=false;await refresh();return}
 if(action==='refresh'){await refresh();return}
 if(action==='login'){await rpc('login');return}
 if(action==='retry-read'){await init();return}
 if(action==='import'){root.querySelector('#photo-files').click();return}
 if(action==='create'||action==='edit-photo'){reference=action==='edit-photo'?selected:null;prompt='';screen='create';generationRequest=null;stopSlide()}
 if(action==='generate'){await generate();return}
 if(action==='jobs'){await loadJobs();return}
 if(action==='previous'||action==='next'){page+=action==='previous'?-1:1;await refresh();return}
 if(action.startsWith('filter:')){filter=action.slice(7);page=0;await refresh();return}
 if(action.startsWith('style:')){style=action.slice(6);generationRequest=null}
 if(action.startsWith('photo:')){await openPhoto(action.slice(6));return}
 if(action.startsWith('job:')){screen='job';job=jobs.find(j=>j.id===action.slice(4));render();await watchJob(action.slice(4));return}
 if(action==='open-result'){if(job?.photo_id)await openPhoto(job.photo_id);return}
 if(action==='retry-create'){prompt=job.prompt;style=job.style;reference=job.source_id?await rpc('get',{id:job.source_id}):null;generationRequest=null;screen='create'}
 if(action==='view-prev'||action==='view-next'){stopSlide();await movePhoto(action==='view-prev'?-1:1);if(screen==='view'&&!deleteConfirm&&document.documentElement.dataset.atomInput==='joystick'&&window.AtomInput){const control=root.querySelector('#photo-'+(action==='view-prev'?'prev':'next'));if(control)AtomInput.focus(control)}return}
 if(action==='favorite'){photoCache.delete(photoKey(selected.photo.id));const r=await rpc('update',{id:selected.photo.id,revision:selected.photo.revision,favorite:!selected.photo.favorite});selected.photo=r.photo}
 if(action==='slideshow'){if(slideshow)stopSlide();else{slideshow=true;clean=true;clearTimeout(hideTimer);document.activeElement?.blur();prefetchNext();scheduleSlide()}}
 if(action==='compare'){stopSlide();before=await rpc('get',{id:selected.photo.parent_id});screen='compare';clean=false;clearTimeout(hideTimer)}
 if(action==='end-compare'){screen='view';before=null;autoHide()}
 if(action==='download'){const r=await rpc('original',{id:selected.photo.id});await rpc('download',{name:r.photo.name,mime:r.photo.mime,data_url:r.data_url});return}
 if(action==='delete'){stopSlide();clean=false;deleteConfirm=true;clearTimeout(hideTimer)}
 if(action==='cancel-delete'){deleteConfirm=false;autoHide()}
 if(action==='confirm-delete'){photoCache.delete(photoKey(selected.photo.id));await rpc('delete',{id:selected.photo.id,revision:selected.photo.revision,confirm:true});selected=null;deleteConfirm=false;screen='library';await refresh();return}
 if(action==='dismiss-error'){error='';autoHide()}
 render();
}
root.addEventListener('click',async e=>{const target=e.target.closest('[data-action]');if(suppressClick){suppressClick=false;if(!target)return}if(target){if(busy)return;try{await perform(target.dataset.action)}catch(err){error=err.message;render()}}else if(screen==='view'){clean=!clean;root.querySelector('.viewer')?.classList.toggle('clean',clean);if(!clean)autoHide()}});
root.addEventListener('input',e=>{if(e.target.id==='photo-prompt'){prompt=e.target.value;generationRequest=null}if(e.target.id==='compare-range')paintZoom()});
root.addEventListener('change',e=>{if(e.target.id==='photo-style'){style=e.target.value;generationRequest=null}if(e.target.id==='photo-template'){const t=(config?.templates||[]).find(t=>t.id===e.target.value&&t.mode===(reference?'edit':'text'));if(t){prompt=t.prompt;style=t.style;generationRequest=null;message='已套用模板，可修改描述后再生成。';render()}return}if(e.target.id==='photo-files'&&e.target.files.length)upload(Array.from(e.target.files))});
let pointer=null;
root.addEventListener('wheel',e=>{if(!['view','compare'].includes(screen)||deleteConfirm||e.target.closest('button,input,.confirm,.view-error'))return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);setZoom(zoom*Math.exp(-Math.max(-300,Math.min(300,delta))*.002),e.clientX,e.clientY)},{passive:false});
root.addEventListener('pointerdown',e=>{if(screen==='view'){frameWakeUntil=Date.now()+10000;paintFrame()}if(!['view','compare'].includes(screen)||deleteConfirm||e.button!==0||e.target.closest('button,input,.confirm,.view-error'))return;suppressClick=false;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,panX,panY,moved:false};if(zoom>1){root.setPointerCapture(e.pointerId);stopSlide();showDetails()}});
root.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||zoom<=1)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(dx,dy)>4)pointer.moved=true;panX=pointer.panX+dx;panY=pointer.panY+dy;boostZoom();queueZoom()});
root.addEventListener('pointerup',e=>{if(!pointer||pointer.id!==e.pointerId)return;const old=pointer,dx=e.clientX-old.x,dy=e.clientY-old.y;pointer=null;if(root.hasPointerCapture(e.pointerId))root.releasePointerCapture(e.pointerId);if(zoom>1){suppressClick=old.moved;autoHide();return}if(screen==='view'&&Math.abs(dx)>65&&Math.abs(dy)<50){suppressClick=true;movePhoto(dx<0?1:-1).catch(err=>{error=err.message;render()})}});
root.addEventListener('pointercancel',()=>{pointer=null;suppressClick=false;autoHide()});
window.addEventListener('resize',measureZoom);
// Direction keys belong to the shared five-way runtime. Pointer swipes still change photos.
function showDetails(){if(screen!=='view')return;frameWakeUntil=Date.now()+10000;paintFrame();if(clean){clean=false;root.querySelector('.viewer')?.classList.remove('clean')}autoHide()}
// Only actual mouse movement wakes the chrome; DOM replacement during playback must not.
let lastMouse=null;
root.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;const moved=!lastMouse||lastMouse.x!==e.clientX||lastMouse.y!==e.clientY;lastMouse={x:e.clientX,y:e.clientY};if(moved)showDetails()});
root.addEventListener('focusin',()=>{if(screen==='view'){showDetails();if(document.documentElement.dataset.atomInput==='joystick')clearTimeout(hideTimer)}});

// Optional hardware events are local to the frame. Missing/stale samples never imply absence.
let frameSample=null,frameAbsentAt=0,frameWakeUntil=0,frameMotion=null,frameLastWake=0,frameTimer=null,unsubscribeFrame=null;
function frameAvailable(kind){return frameSample?.source==='device'&&frameSample.available?.[kind]===true&&Number.isFinite(frameSample.updated_at)&&Date.now()-frameSample.updated_at>=-2000&&Date.now()-frameSample.updated_at<10000}
function paintFrame(){
 const presence=frameAvailable('presence'),motion=frameAvailable('motion');
 const dim=screen==='view'&&frameSensing&&presence&&frameSample.presence?.present===false&&frameAbsentAt>0&&Date.now()-frameAbsentAt>=8000&&Date.now()>frameWakeUntil&&!deleteConfirm&&!error;
 root.querySelector('.viewer')?.classList.toggle('frame-dimmed',dim);
 const status=root.querySelector('.frame-status');if(status){const text=!frameSensing?'感知未启用 · 开启后连接':(presence?'存在感知已连接':'存在感知未连接')+' · '+(motion?'动作感知已连接':'动作感知未连接');if(status.textContent!==text)status.textContent=text}
}
function receiveFrame(sample){
 if(!alive)return;
 frameSample=sample;
 if(frameAvailable('presence')&&typeof sample.presence?.present==='boolean'){
  if(sample.presence.present)frameAbsentAt=0;else if(!frameAbsentAt)frameAbsentAt=Date.now();
 }else frameAbsentAt=0;
 const motion=frameAvailable('motion')?sample.motion:null;
 if(motion&&Number.isFinite(motion.roll)&&Number.isFinite(motion.pitch)){
  const changed=frameMotion&&((motion.moving===true&&frameMotion.moving!==true)||Math.abs(motion.roll-frameMotion.roll)>12||Math.abs(motion.pitch-frameMotion.pitch)>12);
  if(changed&&frameSensing&&screen==='view'&&Date.now()-frameLastWake>8000){frameLastWake=Date.now();showDetails()}
  // Retain a quiet orientation baseline; a sustained moving=true must not keep waking controls.
  if(!frameMotion||changed||motion.moving!==frameMotion.moving)frameMotion={roll:motion.roll,pitch:motion.pitch,moving:motion.moving};
 }else frameMotion=null;
 paintFrame();
}
function stopFrame(){
 clearInterval(frameTimer);frameTimer=null;unsubscribeFrame?.();unsubscribeFrame=null;
 frameSample=null;frameAbsentAt=0;frameMotion=null;paintFrame();
}
function startFrame(){
 if(!frameSensing||readFailed){stopFrame();return}
 if(unsubscribeFrame||frameTimer)return;
 if(window.AtomApp?.sensors?.subscribe){try{unsubscribeFrame=AtomApp.sensors.subscribe(receiveFrame)}catch(_){frameSample=null}}
 frameTimer=setInterval(()=>{if(!frameAvailable('presence'))frameAbsentAt=0;paintFrame()},1000);
}
async function toggleFrame(){
 if(readFailed||frameSaving)return;
 const next=!frameSensing;frameSaving=true;message='';render();
 try{
  const updated={...prefs,style,frameSensing:next};
  const saved=window.AtomApp?.save?await AtomApp.save(updated):{mode:'preview'};
  if(!alive)return;prefs=updated;frameSensing=next;frameWakeUntil=Date.now()+10000;startFrame();
  message=saved?.mode==='device'?'相框偏好已保存':'仅在本次预览生效';
 }catch(e){error='相框设置未保存，请重试';}
 finally{frameSaving=false;render()}
}

function stop(){alive=false;stopFrame();viewEpoch++;clearTimeout(rasterTimer);rasterTimer=null;pointer=null;window.removeEventListener('resize',measureZoom);cancelAnimationFrame(zoomFrame);zoomFrame=0;zoomView=null;clearPhotos();stopSlide();clearTimeout(pollTimer);clearTimeout(hideTimer);clearInterval(syncTimer);for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('相册已关闭'))}pending.clear();root.replaceChildren()}
window.addEventListener('pagehide',stop);
async function init(){if(window.AtomApp){try{prefs=await AtomApp.load({style:'clay',frameSensing:false});if(!prefs||typeof prefs.style!=='string')throw Error('偏好无效');style=prefs.style;frameSensing=prefs.frameSensing===true;readFailed=false}catch(e){readFailed=true}}
 startFrame();render();await refresh();if(config&&!config.styles.some(s=>s.id===style))style='clay';
}
if(window.AtomApp){AtomApp.deferReady();AtomApp.navigation.setBackHandler(goBack);AtomApp.onSuspend(stop)}init();syncTimer=setInterval(()=>{if(alive&&user&&screen==='library'&&!busy)refresh()},20000);
})();
