/* Account-authenticated album bridge. Source previews cannot call it. */
(()=>{
 const frame=document.getElementById('photo-album-frame');let scope=0;
 const routes={state:()=>'/photos/state',list:d=>'/photos?'+new URLSearchParams({page:d.page||0,filter:d.filter||'all',limit:d.limit||12}),
  get:d=>'/photos/'+valid(d.id),original:d=>'/photos/'+valid(d.id)+'/original',upload:()=>'/photos',
  update:d=>'/photos/'+valid(d.id)+'/update',delete:d=>'/photos/'+valid(d.id)+'/delete',generate:()=>'/photos/generate',
  jobs:()=>'/photos/jobs',job:d=>'/photos/jobs/'+valid(d.id)};
 const writes=['upload','update','delete','generate'];
 function valid(id){if(typeof id!=='string'||! /^[a-f0-9]{32}$/.test(id))throw Error('照片标识无效');return id}
 window.addEventListener('atom:page',e=>{scope++;window.atomCancelCamera?.();if(e.detail==='photos'){frame.src='/photo-album/index.html?host=computer'}else if(frame.hasAttribute('src')){frame.contentWindow?.postMessage({type:'atom:photos-suspend'},'*');frame.removeAttribute('src')}});
 window.addEventListener('message',async e=>{
  const d=e.data;if(currentPage!=='photos'||e.source!==frame.contentWindow||!d||d.type!=='atom:photos'||typeof d.id!=='string'||d.id.length>128)return;
  const epoch=scope,body=d.data&&typeof d.data==='object'?d.data:{};let result;
  try{
   if(d.action==='login'){window.atomAlbumLogin?.();result={ok:true}}
   else if(d.action==='camera'){result=await window.atomCapturePhoto()}
   else if(d.action==='download'){
    if(typeof body.data_url!=='string'||body.data_url.length>28*1024*1024||!/^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/.test(body.data_url))throw Error('下载内容无效');
    const mime=body.data_url.slice(5,body.data_url.indexOf(';')),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[mime];body.name=String(body.name||'photo').replace(/[\\/]/g,'_').replace(/\.[^.]+$/,'')+'.'+ext;
    if(window.webkit?.messageHandlers?.savePhoto){result=await new Promise((resolve,reject)=>{const id='export-'+crypto.randomUUID(),receive=e=>{if(e.detail.id!==id)return;window.removeEventListener('atom:photo-export',receive);clearTimeout(timer);e.detail.ok?resolve({ok:true}):reject(Error(e.detail.error||'导出未完成'))},timer=setTimeout(()=>{window.removeEventListener('atom:photo-export',receive);reject(Error('导出未完成'))},300000);window.addEventListener('atom:photo-export',receive);window.webkit.messageHandlers.savePhoto.postMessage({id,name:String(body.name||'photo'),data_url:body.data_url})})}
    else{const raw=atob(body.data_url.split(',')[1]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
     a.href=url;a.download=String(body.name||'photo').replace(/[\\/]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);result={ok:true};}
   }else{if(!routes[d.action])throw Error('相册操作不支持');result=await api('studio'+routes[d.action](body),writes.includes(d.action)?body:undefined)}
   if(scope===epoch&&currentPage==='photos')e.source.postMessage({type:'atom:photos-result',id:d.id,result},'*');
  }catch(err){if(scope===epoch&&currentPage==='photos')e.source.postMessage({type:'atom:photos-result',id:d.id,error:err.message,status:err.status||0},'*')}
 });
})();
