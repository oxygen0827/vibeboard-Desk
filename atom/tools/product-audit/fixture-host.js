window.fixture={ready:false,value:window.__initialValue||null,saves:0,returned:0,unsupported:[],calls:[]};
addEventListener('message',event=>{
 const d=event.data;if(!d||typeof d!=='object')return;
 const reply=value=>event.source.postMessage(value,'*');
 if(d.type==='atom:app-ready'){fixture.ready=true;return;}
 if(d.type==='atom:return-home'){fixture.returned++;return;}
 if(d.type==='atom:storage'){
  const failed=d.action==='get'?window.__readFail:window.__saveFail;
  if(d.action==='set'&&!failed){fixture.value=d.data;fixture.saves++;}
  reply({type:'atom:storage-result',request_id:d.request_id,ok:!failed,data:fixture.value,mode:'preview',error:'测试：保存或读取不可用'});return;
 }
 if(d.type==='atom:music-state'){reply({type:'atom:music-state-result',action:d.action,ok:!window.__readFail,data:window.__legacyValue||null});return;}
 if(d.type==='atom:input-ready'){reply({type:'atom:input-settings',motion:true});return;}
 if(d.type==='atom:sensors'){reply({type:'atom:sensors-state',snapshot:{version:1,source:'unavailable',available:{presence:false,motion:false,light:false,temperature:false},presence:null,motion:null,light:null,temperature:null}});return;}
 if(d.type==='atom:appearance-request')return;
 const types=['atom:market','atom:connect','atom:photos','atom:experience','atom:agent-studio','atom:robot','atom:mic'];
 if(types.includes(d.type)){
  fixture.calls.push({type:d.type,action:d.action});
  let result;
  if(d.action==='state'||d.action==='status')result={styles:[],templates:[],generation_enabled:false,configured:false,authenticated:false,user:null,paired:[],tasks:[],online:false,connected:false,files:[],items:[],photos:[],running:false};
  if(['list','tasks','agenda','notes','photos','feed'].includes(d.action))result={items:[],tasks:[],photos:[],notes:[],events:[],agents:[]};
  reply({type:d.type+'-result',id:d.id,request_id:d.request_id,...(result?{result}:{error:'离线审查：此操作未连接真实服务',status:503})});return;
 }
 if(typeof d.type==='string'&&d.type.startsWith('atom:'))fixture.unsupported.push(d.type);
});
