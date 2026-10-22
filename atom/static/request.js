/* System HTTP boundary: bounded waits, truthful failures, no automatic write retries. */
(function(){'use strict';
window.AtomRequest=function(url,options){
  var opts=Object.assign({},options||{}),external=opts.signal,controller=new AbortController();
  // Wi-Fi includes reconnecting the previous network; do not cut off that recovery.
  var budget=/\/wifi\/connect$/.test(url)?300000:/\/system\/update\/download$/.test(url)?90000:/\/voice\/transcribe$/.test(url)?75000:45000;
  var timeout=opts.timeoutMs||budget,expired=false,timer;
  delete opts.timeoutMs;opts.signal=controller.signal;
  function cancel(){controller.abort();}
  if(external){if(external.aborted)cancel();else external.addEventListener('abort',cancel,{once:true});}
  timer=setTimeout(function(){expired=true;controller.abort();},timeout);
  return Promise.resolve().then(function(){return fetch(url,opts);}).then(async function(response){
    var data;
    try{data=await response.json();}catch(e){if(controller.signal.aborted)throw e;var invalid=Error('服务返回了无效响应，请检查连接后重新读取状态');invalid.status=response.status;invalid.code='invalid_response';throw invalid;}
    if(!data||typeof data!=='object'||Array.isArray(data)){var bad=Error('服务返回了无效响应，请重新读取状态');bad.code='invalid_response';throw bad;}
    if(!response.ok){var error=Error(data.error||'请求失败 ('+response.status+')');error.status=response.status;error.code=data.code||'';error.current=data.current;throw error;}
    return data;
  }).catch(function(error){
    if(expired){var timed=Error('等待超时，请检查连接。操作可能仍在处理中，请先刷新状态再重试');timed.code='request_timeout';throw timed;}
    if(error.name==='AbortError')throw error;
    if(error instanceof TypeError){var offline=Error('连接暂时中断，请检查网络后重试');offline.code='network_error';throw offline;}
    throw error;
  }).finally(function(){clearTimeout(timer);if(external)external.removeEventListener('abort',cancel);});
};
})();
