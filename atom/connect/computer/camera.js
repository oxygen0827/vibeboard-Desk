/* Camera stays in the trusted computer host, never in an application iframe. */
(()=>{'use strict';
 let cancel=null;
 window.atomCancelCamera=()=>cancel?.();
 window.atomCapturePhoto=()=>new Promise((resolve,reject)=>{
  if(cancel)return reject(Error('拍照窗口已经打开'));
  if(!navigator.mediaDevices?.getUserMedia)return reject(Error('此环境不支持摄像头，请导入照片'));
  const dialog=document.createElement('dialog');dialog.className='camera-dialog';
  dialog.innerHTML='<h2>拍一张照片</h2><p>取景仅在本机显示。选择“保存到相册”后才会上传到私有相册。</p><video autoplay muted playsinline></video><img hidden alt="待保存的照片"><p role="status">正在等待摄像头权限…</p><div><button data-camera="cancel">取消</button><button data-camera="retake" hidden>重拍</button><button data-camera="shoot" disabled>拍照</button><button data-camera="use" hidden>保存到相册</button></div>';
  const video=dialog.querySelector('video'),still=dialog.querySelector('img'),status=dialog.querySelector('[role=status]');
  const shoot=dialog.querySelector('[data-camera=shoot]'),retake=dialog.querySelector('[data-camera=retake]'),use=dialog.querySelector('[data-camera=use]');
  let stream=null,done=false,photo=null;
  const stop=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null};
  const finish=(value,error)=>{if(done)return;done=true;stop();cancel=null;dialog.close();dialog.remove();error?reject(error):resolve(value)};
  cancel=()=>finish(null);
  async function start(){
   photo=null;still.hidden=true;still.removeAttribute('src');video.hidden=false;shoot.hidden=false;shoot.disabled=true;retake.hidden=use.hidden=true;
   status.textContent='正在等待摄像头权限…';
   try{const opened=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:960}},audio:false});
    if(done){opened.getTracks().forEach(t=>t.stop());return}stream=opened;video.srcObject=opened;await video.play();
    if(done)return;shoot.disabled=false;status.textContent='调整取景后点击拍照。';
   }catch{if(!done){stop();status.textContent='无法打开摄像头。请检查系统权限、相机连接，或取消后导入照片。';retake.hidden=false}}
  }
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null)});
  dialog.addEventListener('click',e=>{const action=e.target.closest('[data-camera]')?.dataset.camera;
   if(action==='cancel')finish(null);
   if(action==='retake'){stop();void start()}
   if(action==='shoot'){
    if(!video.videoWidth||!video.videoHeight){status.textContent='摄像头还未准备好，请稍后拍照。';return}
    const canvas=document.createElement('canvas'),scale=Math.min(1,1280/video.videoWidth,1280/video.videoHeight);
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);photo=canvas.toDataURL('image/jpeg',.9);stop();
    still.src=photo;still.hidden=false;video.hidden=true;shoot.hidden=true;retake.hidden=use.hidden=false;status.textContent='确认照片后保存，或重新拍摄。';
   }
   if(action==='use'&&photo)finish({data_url:photo,name:'拍照 '+new Date().toLocaleString('zh-CN')+'.jpg'});
  });
  document.body.append(dialog);dialog.showModal();void start();
 });
 window.addEventListener('pagehide',()=>window.atomCancelCamera());
})();
