/* Settings pages for power, date & time and Bluetooth. Each page paints into its own panel. */
(function(){'use strict';
var time=null,bt=null,busy=false,error='',message='',confirming='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function request(path,data){return fetch(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json().then(function(v){if(!r.ok)throw Error(v.error||'操作未完成');return v;});});}
function paint(){var el=document.getElementById('system-panel');if(el)el.innerHTML=body(el.dataset.page);}
function notice(){return (error?'<p class="update-error" role="alert">'+esc(error)+'</p>':'')+(message?'<p class="update-ok">'+esc(message)+'</p>':'');}
function run(promise,done){busy=true;error='';message='';paint();return promise.then(function(v){if(done)done(v);}).catch(function(e){error=e.message;}).then(function(){busy=false;paint();});}
function load(page){error='';message='';if(page==='time')run(request('/api/system/time'),function(v){time=v;});if(page==='bluetooth')run(request('/api/bluetooth'),function(v){bt=v;});}
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
  if(page==='bluetooth'){if(!bt)return (error?'':'<p class="subtitle">正在读取蓝牙…</p>')+notice()+(error?'<button data-sys="retry">重试</button>':'');
    if(!bt.status.available)return '<p class="subtitle">没有找到蓝牙硬件</p>'+notice();
    var icons={audio:'音箱/耳机',keyboard:'键盘',mouse:'鼠标',gamepad:'手柄',phone:'手机',computer:'电脑',other:'设备'};
    return '<div class="row"><h2>蓝牙</h2><button data-sys="bt-power"'+d+'>'+(bt.status.powered?'已打开 · 点击关闭':'已关闭 · 点击打开')+'</button></div>'+
      (bt.status.powered?'<button data-sys="bt-scan"'+d+'>'+(busy?'正在查找…':'查找附近设备')+'</button><div class="list-scroll maintenance-list">'+(bt.devices.length?bt.devices.map(function(x){return '<div class="maintenance-backup"><strong>'+esc(x.name)+' <small>'+esc(icons[x.kind]||'设备')+(x.connected?' · 已连接':x.paired?' · 已配对':'')+'</small></strong><div>'+(x.connected?'<button data-sys="bt-disconnect" data-address="'+esc(x.address)+'"'+d+'>断开</button>':'<button data-sys="bt-connect" data-address="'+esc(x.address)+'"'+d+'>连接</button>')+(x.paired?'<button data-sys="bt-forget" data-address="'+esc(x.address)+'"'+d+'>忘记</button>':'')+'</div></div>';}).join(''):'<p class="subtitle">让设备进入配对模式，再点「查找附近设备」</p>')+'</div>':'')+notice();}
  return '';}
document.addEventListener('click',function(e){var b=e.target.closest('[data-sys]');if(!b||busy)return;var a=b.dataset.sys,address=b.dataset.address;
  if(a==='reboot'||a==='poweroff'){confirming=a;error='';paint();return;}
  if(a==='cancel'){confirming='';paint();return;}
  if(a==='retry'){var p=document.getElementById('system-panel');if(p)load(p.dataset.page);return;}
  if(a==='reboot-confirm'||a==='poweroff-confirm'){var action=a.split('-')[0];run(request('/api/system/power',{action:action,confirm:true}),function(){message=action==='reboot'?'正在重启…':'正在关机…';});return;}
  if(a==='ntp'&&time){run(request('/api/system/automatic-time',{enabled:!time.automatic}),function(v){time=v;message='已更新';});return;}
  if(a==='bt-power'&&bt){run(request('/api/bluetooth/power',{on:!bt.status.powered}),function(v){bt=v;});return;}
  if(a==='bt-scan'){run(request('/api/bluetooth/scan',{}),function(v){bt=v;});return;}
  if(a==='bt-connect'||a==='bt-disconnect'||a==='bt-forget'){if(a==='bt-forget'&&!confirm('忘记这个蓝牙设备？以后需要重新配对。'))return;run(request('/api/bluetooth/'+a.slice(3),{address:address}),function(v){bt=v;message=a==='bt-connect'?'已连接':a==='bt-forget'?'已移除':'已断开';});}});
document.addEventListener('change',function(e){if(e.target.id!=='sys-zone'||busy)return;run(request('/api/system/timezone',{zone:e.target.value}),function(v){time=v;message='时区已更新';});});
window.AtomSystemSettings={html:function(page){confirming='';error='';message='';setTimeout(function(){load(page);},0);return '<div id="system-panel" class="system-panel" data-page="'+page+'">'+body(page)+'</div>';}};
})();
