/* Settings pages for power, date & time and Bluetooth. Each page paints into its own panel. */
(function(){'use strict';
var time=null,bt=null,busy=false,error='',message='',confirming='',pageEpoch=0;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function request(path,data){return window.AtomRequest(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function paint(){var el=document.getElementById('system-panel');if(el)el.innerHTML=body(el.dataset.page);}
function notice(){return (error?'<p class="update-error" role="alert">'+esc(error)+'</p>':'')+(message?'<p class="update-ok">'+esc(message)+'</p>':'');}
function run(promise,done){var epoch=pageEpoch;busy=true;error='';message='';paint();return promise.then(function(v){if(epoch===pageEpoch&&done)done(v);}).catch(function(e){if(epoch===pageEpoch)error=e.message;}).then(function(){if(epoch===pageEpoch){busy=false;paint();}});}
function load(page){error='';message='';if(page==='time')run(request('/api/system/time'),function(v){time=v;});if(page==='bluetooth')run(request('/api/bluetooth'),function(v){bt=v;});}
// The pairing page owns its request. Navigation revokes it, including a late start response.
var selected=null,pair=null,pairId='',pairEpoch=0,pairTimer=0,pairPolling=false,pairBusy=false,pairError='',pairInput='';
function pairingActive(){var el=document.getElementById('system-panel');return el&&el.dataset.page==='bluetooth';}
function pairCall(action,data,keepalive){var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},8000);return fetch('/api/bluetooth/pair-'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:!!keepalive,signal:controller.signal}).then(function(r){return r.json().then(function(v){if(!r.ok)throw Error(v.error||'配对没有完成');return v.pairing;});}).finally(function(){clearTimeout(timeout);});}
function disposePair(){var id=pairId;pairEpoch++;clearTimeout(pairTimer);pairId='';selected=null;pair=null;pairBusy=false;pairError='';pairInput='';if(id)pairCall('cancel',{id:id},true).catch(function(){});}
function paintPair(){var input=document.getElementById('bt-pair-input'),focused=input&&document.activeElement===input,start=input&&input.selectionStart,end=input&&input.selectionEnd;if(input)pairInput=input.value;paint();var hadInput=!!input;input=document.getElementById('bt-pair-input');if(input&&!hadInput)input.focus();if(input&&focused){input.focus();try{input.setSelectionRange(start,end);}catch(e){}}}
function newPairId(){return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function(x){return x.toString(16).padStart(2,'0');}).join('');}
function takePair(value){var before=pair&&pair.challenge&&pair.challenge.id,after=value.challenge&&value.challenge.id;if(before!==after)pairInput='';pair=value;}
function schedulePair(epoch){clearTimeout(pairTimer);if(pairId&&pair&&['connected','cancelled','expired','failed'].indexOf(pair.state)<0)pairTimer=setTimeout(function(){pollPair(epoch);},900);}
async function pollPair(epoch){if(epoch!==pairEpoch||!pairId||!pairingActive())return;if(pairPolling){schedulePair(epoch);return;}pairPolling=true;try{var value=await pairCall('status',{id:pairId});if(epoch!==pairEpoch)return;var changed=JSON.stringify(value)!==JSON.stringify(pair)||pairError;takePair(value);pairError='';if(changed)paintPair();}catch(e){if(epoch===pairEpoch){pairError='连接暂时中断，正在重试；离开页面会取消配对。';paintPair();}}finally{pairPolling=false;if(epoch===pairEpoch)schedulePair(epoch);}}
async function startPair(){if(!selected||pairBusy)return;var old=pairId,epoch=++pairEpoch;clearTimeout(pairTimer);pairId=newPairId();var id=pairId;pair={state:'starting',name:selected.name,address:selected.address,challenge:null};pairBusy=true;pairError='';pairInput='';paintPair();try{if(old)await pairCall('cancel',{id:old});var value=await pairCall('start',{id:id,address:selected.address,confirm:true});if(epoch!==pairEpoch||!pairingActive()){pairCall('cancel',{id:id},true).catch(function(){});return;}takePair(value);}catch(e){if(epoch===pairEpoch){pair.state='failed';pair.error=e.message;}}finally{if(epoch===pairEpoch){pairBusy=false;paintPair();schedulePair(epoch);}}}
async function answerPair(value){if(!pair||!pair.challenge||pairBusy)return;var epoch=pairEpoch;pairBusy=true;pairError='';paintPair();try{var result=await pairCall('respond',{id:pairId,challenge:pair.challenge.id,value:value});if(epoch===pairEpoch)takePair(result);}catch(e){if(epoch===pairEpoch)pairError=e.message;}finally{if(epoch===pairEpoch){pairBusy=false;paintPair();schedulePair(epoch);}}}
function pairingHtml(){var target=pair||selected,c=pair&&pair.challenge,disabled=pairBusy?' disabled':'',title='连接这台设备？',content='<p>请核对名称和地址。继续后会尝试配对并连接这台外设。</p>',buttons='<button data-sys="bt-pair-back">返回</button><button class="primary" data-sys="bt-pair-start">确认连接</button>';
if(pair){title=pair.state==='connecting'?'正在连接':pair.state==='starting'?'准备配对':'正在配对';content='<p>请让外设保持开启，并按它的提示操作。</p>';buttons='<button data-sys="bt-pair-back">取消配对</button>';
 if(c){
  if(c.kind==='pin'||c.kind==='passkey'){title=c.kind==='pin'?'输入外设的 PIN 码':'输入外设显示的数字';content='<p>'+(c.kind==='pin'?'查看外设屏幕或说明书中的 PIN 码。':'请输入外设显示的 1–6 位数字配对码。')+'</p><form id="bt-pair-form"><input id="bt-pair-input" aria-label="蓝牙配对码" autocomplete="off" spellcheck="false" maxlength="'+(c.kind==='pin'?16:6)+'" inputmode="'+(c.kind==='pin'?'text':'numeric')+'" value="'+esc(pairInput)+'"'+disabled+'></form>';buttons+='<button class="primary" data-sys="bt-pair-submit"'+disabled+'>提交</button>';}
  else if(c.kind==='confirm'){title='两边的数字一致吗？';content='<div class="bt-pair-code">'+esc(c.code)+'</div><p>请同时查看外设。只有两边完全一致，才允许配对。</p>';buttons='<button data-sys="bt-pair-reject"'+disabled+'>不一致</button><button class="primary" data-sys="bt-pair-accept"'+disabled+'>一致，配对</button>';}
  else if(c.kind==='display-pin'||c.kind==='display-passkey'){title='在外设上输入这组数字';content='<div class="bt-pair-code">'+esc(c.code)+'</div><p>请在蓝牙键盘上输入，然后按回车。</p>'+(c.kind==='display-passkey'?'<p class="subtitle">已输入 '+Math.min(6,c.entered||0)+' / 6 位</p>':'');}
  else if(c.kind==='authorize'||c.kind==='service'){title=c.kind==='service'?'允许设备使用蓝牙服务？':'允许这台设备配对？';content='<p>确认这是你刚才选择的外设，再允许继续。</p>';buttons='<button data-sys="bt-pair-reject"'+disabled+'>拒绝</button><button class="primary" data-sys="bt-pair-accept"'+disabled+'>允许</button>';}
 }
 if(pair.state==='connected'){title='已连接';content='<p>设备已配对并连接。下次开启时可自动重新连接。</p>';buttons='<button class="primary" data-sys="bt-pair-back">完成</button>';}
 if(['failed','expired','cancelled'].indexOf(pair.state)>=0){title=pair.state==='expired'?'配对已超时':pair.state==='cancelled'?'已取消配对':'连接未完成';content='<p role="alert">'+esc(pair.error||'可以让外设重新进入配对模式后再试。')+'</p>';buttons='<button data-sys="bt-pair-back">返回列表</button><button class="primary" data-sys="bt-pair-start"'+disabled+'>重试</button>';}
}
return '<section class="bt-pair-card"><div class="bt-pair-target"><strong>'+esc(target.name||target.address)+'</strong><small>'+esc(target.address)+'</small></div><h2>'+title+'</h2><div class="bt-pair-content">'+content+(pairError?'<p class="bt-pair-error" role="alert">'+esc(pairError)+'</p>':'')+'</div><div class="maintenance-actions">'+buttons+'</div></section>';
}
new MutationObserver(function(){if((pairId||selected)&&!pairingActive())disposePair();}).observe(document.getElementById('main')||document.body,{childList:true,subtree:true});
addEventListener('pagehide',disposePair);
document.addEventListener('input',function(e){if(e.target.id==='bt-pair-input')pairInput=e.target.value;});
document.addEventListener('submit',function(e){if(e.target.id==='bt-pair-form'){e.preventDefault();answerPair(pairInput);}});
function body(page){var d=busy?' disabled':'';
  if(page==='power'){
    if(confirming)return '<div class="maintenance-copy"><h2>'+(confirming==='reboot'?'重启这台设备？':'关闭这台设备？')+'</h2><p>'+(confirming==='reboot'?'重启完成后回到桌面。正在进行的任务会中断。':'关机后需要按设备上的电源键或重新通电才能开机，远程无法唤醒。')+'</p><div class="maintenance-actions"><button data-sys="cancel">取消</button><button class="danger" data-sys="'+confirming+'-confirm"'+d+'>'+(confirming==='reboot'?'重启':'关机')+'</button></div></div>'+notice();
    return '<div class="settings-menu"><button data-sys="reboot"'+d+'>重启 <span>重新启动系统，正在进行的任务会中断</span></button><button data-sys="poweroff"'+d+'>关机 <span>需要在设备上手动开机</span></button></div>'+notice();}
  if(page==='time'){if(!time)return (error?'':'<p class="subtitle">正在读取时间…</p>')+notice()+(error?'<button data-sys="retry">重试</button>':'');
    var now=new Date(time.now);
    return '<div class="row"><h2>现在</h2><span>'+esc(now.toLocaleString('zh-CN',{hour12:false,timeZone:time.timezone||undefined}))+'</span></div>'+
      '<div class="row"><h2>时区</h2><select id="sys-zone" aria-label="时区"'+d+'>'+time.zones.map(function(z){return '<option value="'+esc(z)+'"'+(z===time.timezone?' selected':'')+'>'+esc(z)+'</option>';}).join('')+'</select></div>'+
      '<div class="row"><h2>自动校时</h2><button data-sys="ntp"'+d+(time.automatic_available?'':' disabled')+'>'+(time.automatic?'已开启 · 点击关闭':'已关闭 · 点击开启')+'</button></div>'+
      (time.automatic_available?(time.automatic?'<p class="subtitle">'+(time.synchronized?'已和网络时间同步':'正在和网络时间同步')+'</p>':''):'<p class="subtitle">这台设备没有安装自动校时服务</p>')+notice();}
  if(page==='bluetooth'){if(selected||pair)return pairingHtml();if(!bt)return (error?'':'<p class="subtitle">正在读取蓝牙…</p>')+notice()+(error?'<button data-sys="retry">重试</button>':'');
    if(!bt.status.available)return '<p class="subtitle">没有找到蓝牙硬件</p>'+notice();
    var icons={audio:'音箱/耳机',keyboard:'键盘',mouse:'鼠标',gamepad:'手柄',phone:'手机',computer:'电脑',other:'设备'};
    return '<div class="row"><h2>蓝牙</h2><button data-sys="bt-power"'+d+'>'+(bt.status.powered?'已打开 · 点击关闭':'已关闭 · 点击打开')+'</button></div>'+
      (bt.status.powered?'<button data-sys="bt-scan"'+d+'>'+(busy?'正在查找…':'查找附近设备')+'</button><div class="list-scroll maintenance-list">'+(bt.devices.length?bt.devices.map(function(x){return '<div class="maintenance-backup"><strong>'+esc(x.name)+' <small>'+esc(icons[x.kind]||'设备')+(x.connected?' · 已连接':x.paired?' · 已配对':'')+'</small></strong><div>'+(x.connected?'<button data-sys="bt-disconnect" data-address="'+esc(x.address)+'"'+d+'>断开</button>':'<button data-sys="bt-connect" data-address="'+esc(x.address)+'"'+d+'>连接</button>')+(x.paired?'<button data-sys="bt-forget" data-address="'+esc(x.address)+'"'+d+'>忘记</button>':'')+'</div></div>';}).join(''):'<p class="subtitle">让设备进入配对模式，再点「查找附近设备」</p>')+'</div>':'')+notice();}
  return '';}
document.addEventListener('click',function(e){var b=e.target.closest('[data-sys]');if(!b)return;var a=b.dataset.sys,address=b.dataset.address;
  if(a==='bt-pair-back'){disposePair();load('bluetooth');paint();return;}
  if(a==='bt-pair-start'){startPair();return;}
  if(a==='bt-pair-submit'){answerPair(pairInput);return;}
  if(a==='bt-pair-accept'||a==='bt-pair-reject'){answerPair(a==='bt-pair-accept');return;}
  if(busy)return;
  if(a==='bt-connect'){selected=bt&&bt.devices.find(function(x){return x.address===address;});pair=null;pairError='';paint();return;}
  if(a==='reboot'||a==='poweroff'){confirming=a;error='';paint();return;}
  if(a==='cancel'){confirming='';paint();return;}
  if(a==='retry'){var p=document.getElementById('system-panel');if(p)load(p.dataset.page);return;}
  if(a==='reboot-confirm'||a==='poweroff-confirm'){var action=a.split('-')[0];run(request('/api/system/power',{action:action,confirm:true}),function(){message=action==='reboot'?'正在重启…':'正在关机…';});return;}
  if(a==='ntp'&&time){run(request('/api/system/automatic-time',{enabled:!time.automatic}),function(v){time=v;message='已更新';});return;}
  if(a==='bt-power'&&bt){run(request('/api/bluetooth/power',{on:!bt.status.powered}),function(v){bt=v;});return;}
  if(a==='bt-scan'){run(request('/api/bluetooth/scan',{}),function(v){bt=v;});return;}
  if(a==='bt-disconnect'||a==='bt-forget'){if(a==='bt-forget'&&!confirm('忘记这个蓝牙设备？以后需要重新配对。'))return;run(request('/api/bluetooth/'+a.slice(3),{address:address}),function(v){bt=v;message=a==='bt-forget'?'已移除':'已断开';});}});
document.addEventListener('change',function(e){if(e.target.id!=='sys-zone'||busy)return;run(request('/api/system/timezone',{zone:e.target.value}),function(v){time=v;message='时区已更新';});});
window.AtomSystemSettings={html:function(page){var active=document.getElementById('system-panel');if(active&&active.dataset.page===page)return '<div id="system-panel" class="system-panel" data-page="'+page+'">'+body(page)+'</div>';var epoch=++pageEpoch;busy=false;if(page!=='bluetooth')disposePair();confirming='';error='';message='';setTimeout(function(){var el=document.getElementById('system-panel');if(epoch===pageEpoch&&el&&el.dataset.page===page)load(page);},0);return '<div id="system-panel" class="system-panel" data-page="'+page+'">'+body(page)+'</div>';}};
})();
