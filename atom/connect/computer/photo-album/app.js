/* One photo experience on the computer and ATOM. Tokens stay in the host. */
(()=>{'use strict';
const root=document.getElementById('root'),pc=new URLSearchParams(location.search).get('host')==='computer';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const active=s=>['queued','generating','saving'].includes(s);
const labels={queued:'等待开始',generating:'正在生成',saving:'正在保存到相册',completed:'已保存到相册',failed:'生成失败',interrupted:'生成已中断'};
let alive=true,seq=0,pending=new Map(),user=null,config=null,screen='library',filter='all',page=0,listing={items:[],pages:0,total:0},
    selected=null,reference=null,before=null,job=null,jobs=[],busy=false,loading=false,message='',error='',readFailed=false,
    prefs={style:'clay'},prompt='',style='clay',slideshow=false,clean=false,hideTimer=null,slideTimer=null,pollTimer=null,syncTimer=null,
    generationRequest=null,creatingSignature='',deleteConfirm=false,voice='',viewEpoch=0,accountEpoch=0;
const limit=()=>innerWidth<=600?6:12;
function rpc(action,data={}){if(!alive)return Promise.reject(Error('相册已关闭'));return new Promise((resolve,reject)=>{
 const id='photo-'+(++seq),t=setTimeout(()=>{pending.delete(id);reject(Error('连接超时，请刷新查看结果；生成任务不会自动重发'))},action==='download'?300000:60000);
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
function heading(title,subtitle,actions){return '<header><div class="heading"><h1>'+title+'</h1><p>'+esc(subtitle)+'</p></div><div class="actions">'+actions+'</div></header>'}
function empty(title,text,actions=''){return '<div class="empty"><img src="icon.svg" alt=""><h2>'+title+'</h2><p>'+text+'</p>'+actions+'</div>'}
function render(){if(!alive)return;
 if(screen==='view'||screen==='compare'){renderViewer();return}
 let html='';
 if(screen==='create'){
  html=heading('灵感暗房',reference?'给这张照片一个新模样':'把想象留成一张照片',button('library','取消','quiet'))+
   '<div class="studio"><div class="reference">'+(reference?'<img src="'+esc(reference.data_url)+'" alt="参考照片"><span class="reference-label">参考照片</span>':empty('从想象开始','描述一个画面<br>挑选你喜欢的风格'))+'</div><div class="create-form">'+
   '<div class="style-grid">'+(config&&config.styles||[]).map(s=>button('style:'+s.id,esc(s.name),'style-choice'+(style===s.id?' selected':''))).join('')+'</div>'+
   '<textarea id="photo-prompt" aria-label="画面描述" maxlength="1500" placeholder="'+(reference?'比如：把背景变成雨后的京都小巷':'比如：一座漂浮在云海里的小房子')+'">'+esc(prompt)+'</textarea>'+
   '<p class="privacy">'+(reference?'点击生成时，参考照片与描述会发送至火山方舟。':'描述会发送至火山方舟。')+'结果作为新照片保存。</p>'+button('generate',busy?'正在提交…':'生成新作品','primary',busy||!config||!config.generation_enabled)+'</div></div>'+
   (!config||!config.generation_enabled?'<p class="privacy">当前账号未启用生图服务，照片同步仍可使用。</p>':'')+feedback();
 }else if(screen==='job'){
  const running=job&&active(job.status);
  html=heading('正在创作',job?new Date(job.created_at*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'',button('library','返回相册','quiet'))+
   '<div class="empty"><div class="job-art">'+(running?'<div class="ring"></div>':'<img src="icon.svg" alt="">')+'</div><h2>'+esc(job?labels[job.status]||job.status:'正在读取任务')+'</h2>'+
   '<p>'+esc(job&&job.error||(running?'可以返回相册或退出应用，任务会继续执行。':'原照片一直保留。'))+'</p>'+
   (job&&job.status==='completed'?button('open-result','查看作品','primary'):job&&!running?button('retry-create','重新创作','primary'):'')+'</div>'+feedback();
 }else if(screen==='jobs'){
  html=heading('创作记录','最近 12 次生成',button('library','完成','quiet'))+'<div class="job-list">'+jobs.map(j=>'<div class="job-row"><div><strong>'+esc(j.prompt||'照片风格改写')+'</strong><p>'+esc(labels[j.status]||j.status)+(j.error?' · '+esc(j.error):'')+'</p></div>'+button('job:'+j.id,j.status==='completed'?'查看':'详情','quiet')+'</div>').join('')+'</div>'+(!jobs.length?empty('还没有创作','从一句话或一张照片开始'): '')+feedback();
 }else{
  html=heading('相册',user?user.username+' · '+listing.total+' 张照片':'和 ATOM 分享你的生活',button('jobs','创作','quiet',!user)+(pc?button('import','导入','quiet',busy||!user):'')+button('create','＋ 灵感','primary',!user))+
   (readFailed?'<div class="notice">偏好读取失败，未覆盖原记录。'+button('retry-read','重试')+'</div>':'')+
   (!user?empty('把生活带到桌边','在电脑和 ATOM 登录同一个应用市场账号，<br>照片就能出现在这里。',button('login','登录账号','primary')+button('refresh','重试','quiet')):
    '<div class="tabs">'+[['all','全部'],['favorites','收藏'],['generated','AI 作品']].map(([v,t])=>button('filter:'+v,t,filter===v?'on':'')).join('')+'</div>'+
    (listing.items.length?'<div class="grid">'+listing.items.map(p=>'<button class="photo" data-action="photo:'+p.id+'" aria-label="'+esc(p.name)+'"><img src="'+p.thumbnail+'" alt="'+esc(p.name)+'">'+(p.generated?'<span class="ai">AI</span>':'')+(p.favorite?'<span class="heart">♥</span>':'')+'</button>').join('')+'</div>':empty(loading?'正在同步照片…':'留一张值得回看的照片',filter==='all'?(pc?'导入照片到私有云端相册，<br>或把想象生成一幅作品。':'在电脑端相册导入照片，<br>也可以在这里创作新作品。'):'这里还没有照片'))+
    '<div class="pager"><span>'+esc(loading?'正在同步…':listing.pages?'第 '+(page+1)+' / '+listing.pages+' 页':'私有云端相册')+'</span><div class="actions">'+button('previous','‹','quiet',page===0)+button('next','›','quiet',page+1>=listing.pages)+button('refresh','同步','quiet',loading)+'</div></div>')+feedback()+
   (pc?'<input class="visually-hidden" type="file" id="photo-files" accept="image/jpeg,image/png,image/webp" multiple>':'');
 }
 root.innerHTML='<section class="album">'+html+'</section>';
 if(window.AtomApp&&!render.ready){AtomApp.ready();render.ready=true}
}
function renderViewer(){if(!selected){screen='library';render();return}
 const compare=screen==='compare'&&before;
 root.innerHTML='<section class="viewer '+(clean?'clean ':'')+(compare?'compare':'')+'">'+
  (compare?'<img src="'+esc(before.data_url)+'" alt="原照片"><img class="after" src="'+esc(selected.data_url)+'" alt="AI 版本"><div class="labels"><span>原照片</span><span>新版本</span></div><input type="range" id="compare-range" min="0" max="100" value="50" aria-label="对比原图与生成版本">':'<img class="picture" src="'+esc(selected.data_url)+'" alt="'+esc(selected.photo.name)+'">')+
  '<div class="top">'+button(compare?'end-compare':'library','‹ 相册')+'<span class="caption">'+esc(selected.photo.name)+'</span>'+button('favorite',selected.photo.favorite?'♥':'♡','',busy)+'</div>'+
  '<div class="bottom">'+(compare?button('end-compare','结束对比'):button('view-prev','‹')+button('slideshow',slideshow?'暂停':'轮播')+button('edit-photo','改写')+(selected.photo.parent_id?button('compare','对比'):'')+(pc?button('download','原图'):'')+button('delete','删除')+button('view-next','›'))+'</div>'+
  (error?'<div class="view-error">'+esc(error)+'<br>'+button('dismiss-error','知道了')+'</div>':'')+
  (deleteConfirm?'<div class="confirm"><div><h2>删除这张照片？</h2><p>会从电脑与 ATOM 的同步相册中删除。关联的其他版本会保留。</p><div class="actions">'+button('cancel-delete','取消')+button('confirm-delete','删除','danger',busy)+'</div></div></div>':'')+'</section>';
}
async function refresh(){if(loading||!alive)return;loading=true;error='';render();
 try{const s=await rpc('state');if(!alive)return;if(user&&user.id!==s.user.id){listing={items:[],pages:0,total:0};selected=reference=null;accountEpoch++}user=s.user;config=s;
  const result=await rpc('list',{page,filter,limit:limit()});if(!alive)return;
  if(page&&page>=result.pages){page=Math.max(0,result.pages-1);listing=await rpc('list',{page,filter,limit:limit()})}else listing=result;
  message='照片已同步';
 }catch(e){error=e.message;if(e.status===401||e.status===403){user=null;listing={items:[],pages:0,total:0};selected=reference=null;accountEpoch++}}
 finally{loading=false;render()}
}
async function openPhoto(id){const epoch=++viewEpoch;error='';message='正在打开照片…';render();const r=await rpc('get',{id});if(!alive||epoch!==viewEpoch)return;selected=r;screen='view';clean=false;deleteConfirm=false;error='';render();autoHide()}
function autoHide(){clearTimeout(hideTimer);if(screen==='view')hideTimer=setTimeout(()=>{if(alive&&screen==='view'&&!deleteConfirm&&!error){clean=true;root.querySelector('.viewer')?.classList.add('clean')}},3500)}
function stopSlide(){slideshow=false;clearTimeout(slideTimer);slideTimer=null}
async function movePhoto(delta){let i=listing.items.findIndex(p=>p.id===selected?.photo.id);i+=delta;
 if(i<0||i>=listing.items.length){page=(page+(delta>0?1:-1)+Math.max(1,listing.pages))%Math.max(1,listing.pages);listing=await rpc('list',{page,filter,limit:limit()});i=delta>0?0:listing.items.length-1}
 if(listing.items[i])await openPhoto(listing.items[i].id);
}
function scheduleSlide(){clearTimeout(slideTimer);if(!slideshow)return;slideTimer=setTimeout(async()=>{if(!alive||!slideshow)return;try{await movePhoto(1)}catch(e){stopSlide();error=e.message;render()}if(slideshow)scheduleSlide()},6000)}
async function watchJob(id){clearTimeout(pollTimer);const epoch=accountEpoch;try{const r=await rpc('job',{id});if(!alive||epoch!==accountEpoch)return;job=r.job;if(screen==='job')render();if(active(job.status))pollTimer=setTimeout(()=>watchJob(id),2500)}catch(e){if(alive){error=e.message;render()}}}
async function loadJobs(){jobs=(await rpc('jobs')).jobs;screen='jobs';render()}
async function savePreference(){if(!window.AtomApp||readFailed)return;try{await AtomApp.save({style})}catch(e){message='风格偏好未保存，下次可重新选择'}}
async function generate(){if(busy)return;const signature=JSON.stringify([prompt,style,reference?.photo.id||null]);if(signature!==creatingSignature){generationRequest=null;creatingSignature=signature}generationRequest=generationRequest||uid();busy=true;error='';render();
 try{const r=await rpc('generate',{request_id:generationRequest,prompt,style,source_id:reference?.photo.id||null});job=r.job;screen='job';await savePreference();watchJob(job.id)}catch(e){error=e.message}finally{busy=false;render()}
}
async function upload(files){if(busy)return;busy=true;error='';let count=0;
 try{for(const f of files){if(!['image/jpeg','image/png','image/webp'].includes(f.type))throw Error('请导入 JPEG、PNG 或 WebP 照片');if(f.size>4*1024*1024)throw Error(f.name+' 超过 4 MiB，请先导出较小版本');message='正在上传 '+(count+1)+' / '+files.length;render();
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('无法读取照片'));r.readAsDataURL(f)});
  await rpc('upload',{id:uid(),name:f.name.slice(0,100),data_url:data});count++;
 }page=0;await refresh();message=count+' 张照片已上传并同步';
 }catch(e){error=(count?count+' 张已上传；':'')+e.message}finally{busy=false;render()}
}
async function perform(action){error='';
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
 if(action==='view-prev'||action==='view-next'){await movePhoto(action==='view-prev'?-1:1);return}
 if(action==='favorite'){const r=await rpc('update',{id:selected.photo.id,revision:selected.photo.revision,favorite:!selected.photo.favorite});selected.photo=r.photo}
 if(action==='slideshow'){if(slideshow)stopSlide();else{slideshow=true;scheduleSlide()}autoHide()}
 if(action==='compare'){stopSlide();before=await rpc('get',{id:selected.photo.parent_id});screen='compare';clean=false;clearTimeout(hideTimer)}
 if(action==='end-compare'){screen='view';before=null;autoHide()}
 if(action==='download'){const r=await rpc('original',{id:selected.photo.id});await rpc('download',{name:r.photo.name,mime:r.photo.mime,data_url:r.data_url});return}
 if(action==='delete'){stopSlide();clean=false;deleteConfirm=true;clearTimeout(hideTimer)}
 if(action==='cancel-delete'){deleteConfirm=false;autoHide()}
 if(action==='confirm-delete'){await rpc('delete',{id:selected.photo.id,revision:selected.photo.revision,confirm:true});selected=null;deleteConfirm=false;screen='library';await refresh();return}
 if(action==='dismiss-error'){error='';autoHide()}
 render();
}
root.addEventListener('click',async e=>{const target=e.target.closest('[data-action]');if(target){if(busy)return;try{await perform(target.dataset.action)}catch(err){error=err.message;render()}}else if(screen==='view'){clean=!clean;root.querySelector('.viewer')?.classList.toggle('clean',clean);if(!clean)autoHide()}});
root.addEventListener('input',e=>{if(e.target.id==='photo-prompt'){prompt=e.target.value;generationRequest=null}if(e.target.id==='compare-range'){root.querySelector('.after').style.clipPath='inset(0 0 0 '+e.target.value+'%)'}});
root.addEventListener('change',e=>{if(e.target.id==='photo-files'&&e.target.files.length)upload(Array.from(e.target.files))});
let pointer=null;root.addEventListener('pointerdown',e=>{if(screen==='view'&&!e.target.closest('button'))pointer={x:e.clientX,y:e.clientY}});
root.addEventListener('pointerup',e=>{if(!pointer)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer=null;if(Math.abs(dx)>65&&Math.abs(dy)<50)movePhoto(dx<0?1:-1).catch(err=>{error=err.message;render()})});
window.addEventListener('keydown',e=>{if(screen==='view'&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();movePhoto(e.key==='ArrowLeft'?-1:1).catch(err=>{error=err.message;render()})}});
function stop(){alive=false;viewEpoch++;stopSlide();clearTimeout(pollTimer);clearTimeout(hideTimer);clearInterval(syncTimer);for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('相册已关闭'))}pending.clear();root.replaceChildren()}
window.addEventListener('pagehide',stop);
async function init(){if(window.AtomApp){try{prefs=await AtomApp.load({style:'clay'});if(!prefs||typeof prefs.style!=='string')throw Error('偏好无效');style=prefs.style;readFailed=false}catch(e){readFailed=true}}
 render();await refresh();if(config&&!config.styles.some(s=>s.id===style))style='clay';
}
if(window.AtomApp){AtomApp.deferReady();AtomApp.onSuspend(stop)}init();syncTimer=setInterval(()=>{if(alive&&user&&screen==='library'&&!busy)refresh()},20000);
})();
