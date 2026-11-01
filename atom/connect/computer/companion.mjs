import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Store,relayURL } from './store.mjs';
import { EXECUTORS, executorIds, createAdapter, diagnoseExecutors } from './agents.mjs';
import { appPrompt, parseArtifact } from './artifact.mjs';
import { Studio } from './studio.mjs';
import * as e2e from './e2e.mjs';
// One executor process per task; three covers one task per office staff member.
const MAX_PARALLEL=3;
// Older companions send this text when busy; the device office requeues on it, so keep the wording stable.
export const BUSY='电脑正在执行另一个任务，请稍后重试';
const UNREADABLE='任务内容无法解密：配对密钥不一致，请解除配对后重新配对。';
export class Companion {
 constructor(dir,{adapter=(id)=>createAdapter(id),diagnoseAgents=diagnoseExecutors,pollMs=1500,studioAdapter}={}){this.store=new Store(dir);this.adapter=adapter;this.studioAdapter=studioAdapter;this.pollMs=pollMs;this.running=new Map();this.stopped=false;this.diagnoseAgents=diagnoseAgents;this.agents=EXECUTORS.map(({id,name})=>({id,name,available:false,authenticated:false,reason:'尚未检测'}));this.error='';this.generation=0;this.ticking=false;this.configuring=false;this.pairings={};
 this.studio=new Studio(this);this.ensureKey();for(const t of Object.values(this.store.data.tasks))if(!['completed','failed','cancelled','interrupted'].includes(t.status))this.store.event(t,'status',{status:'interrupted',text:'电脑连接程序已重启；任务未自动重跑，请新建任务。'});
 }
 ensureKey(){const d=this.store.data;if(d.config&&!d.e2e){d.e2e={private:e2e.newPrivateKey(),peers:{}};this.store.save();}}
 publicKey(){this.ensureKey();return this.store.data.e2e?e2e.publicKey(this.store.data.e2e.private):undefined;}
 // Encryption state per paired device: publish this computer's key once, pin the device key on first sight.
 async syncKeys(){const d=this.store.data,mine=this.publicKey(),next={};if(!mine){this.pairings={};return;}
  for(const p of this.relayState?.paired||[]){if(!p.own_key){await this.request('/v1/pair/keys',{client_id:p.client_id,public_key:mine});p.own_key=mine;}
   const pinned=d.e2e.peers[p.client_id];
   if(p.own_key!==mine)next[p.client_id]={state:'mismatch'};
   else if(!p.public_key)next[p.client_id]={state:'off'};
   else if(pinned&&pinned!==p.public_key)next[p.client_id]={state:'changed'};
   else{if(!pinned){d.e2e.peers[p.client_id]=p.public_key;this.store.save();}next[p.client_id]={state:'on',key:e2e.pairKey(d.e2e.private,p.public_key,p.client_id,d.config.client_id),code:e2e.safetyCode(p.public_key,mine)};}}
  this.pairings=next;}
 forgetPeer(id){delete this.pairings[id];if(this.store.data.e2e?.peers[id]){delete this.store.data.e2e.peers[id];this.store.save();}}
 async request(route,body){const c=this.store.data.config;if(!c)throw new Error('请先配置服务器');const response=await fetch(c.relay_url+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000),redirect:'error'});if(!response.ok){const e=new Error('服务器请求失败（'+response.status+'）');e.status=response.status;throw e;}return response.json();}
 async configure(input){if(this.active||this.studio?.active)throw new Error('请等待当前任务结束后再切换服务器');const url=relayURL(input.relay_url);const name=String(input.name||os.hostname()).trim().slice(0,80);if(!name)throw new Error('请输入电脑名称');const old=this.store.data.config;if(old?.relay_url===url){old.name=name;this.store.save();return;}
 if(this.ticking||this.configuring)throw new Error('连接正在同步，请稍后再试');if(old&&this.store.data.outbox.length)throw new Error('还有待同步任务，请先恢复旧服务器连接');this.configuring=true;try{const r=await fetch(url+'/v1/clients/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'computer',name}),redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('注册失败（'+r.status+'）');const c=await r.json();if(typeof c.client_id!=='string'||typeof c.token!=='string')throw new Error('服务器响应无效');if(old){this.store.data.tasks={};this.store.data.commands=[];this.store.data.sessions={};this.store.data.outbox=[];}this.generation++;this.relayState=null;this.store.data.config={relay_url:url,name,client_id:c.client_id,token:c.token};this.store.data.e2e={private:e2e.newPrivateKey(),peers:{}};this.pairings={};this.store.save();}finally{this.configuring=false;}}
 addProject(input){const target=fs.realpathSync(String(input.path||''));if(!path.isAbsolute(target)||!fs.statSync(target).isDirectory())throw new Error('请选择有效的绝对目录');const existing=this.store.data.projects.find(p=>p.path===target);if(existing)return existing;const p={id:crypto.randomUUID(),name:String(input.name||path.basename(target)).slice(0,80),path:target,read_only:input.read_only!==false};this.store.data.projects.push(p);this.store.save();return p;}
 removeProject(id){if([...this.running.values()].some(a=>a.project_id===id))throw new Error('项目仍有任务运行');this.store.data.projects=this.store.data.projects.filter(p=>p.id!==id);this.store.save();}
 async diagnose(){this.agents=await this.diagnoseAgents();return this.agents;}
 state(){const c=this.store.data.config;return {configured:!!c,relay_url:c?.relay_url||'',name:c?.name||'',client_id:c?.client_id||'',projects:this.store.data.projects,agents:this.agents,connection_error:this.error,paired:(this.relayState?.paired||[]).map(({public_key,own_key,...p})=>({...p,e2e:this.pairings[p.client_id]?.state||'off',safety_code:this.pairings[p.client_id]?.code})),tasks:Object.values(this.store.data.tasks).map(({id,status,project_id,agent_id,session_id,kind,device_id,created_at,title})=>({id,status,project_id,agent_id,session_id,kind,device_id,created_at,title}))};}
 async flush(){// Event transport must never prevent command polling (especially approval/cancel).
 let sent=0;while(this.store.data.outbox.length&&sent++<80){const next=this.store.data.outbox[0];let wire=next.event;const owner=this.store.data.tasks[next.task_id];if(owner?.e2e){const pair=this.pairings[owner.device_id];if(pair?.state!=='on')break;wire=this.sealEvent(next.task_id,next.event,pair.key);}try{await this.request('/v1/tasks/'+encodeURIComponent(next.task_id)+'/events',wire);this.store.data.outbox.shift();this.store.save();}catch(e){if(e.status>=400&&e.status<500&&![408,429].includes(e.status)){this.store.data.outbox.shift();this.store.data.delivery_errors=(this.store.data.delivery_errors||[]).concat({task_id:next.task_id,status:e.status,event_id:next.event.event_id}).slice(-100);this.store.save();continue;}break;}}}
 sealEvent(taskId,event,key){const {text,artifact,approval,...out}=event;
  if(text!==undefined)out.enc_text=e2e.seal(key,String(text),'text|'+taskId+'|'+event.event_id);
  if(artifact)out.enc_artifact=e2e.sealJSON(key,artifact,'artifact|'+taskId);
  if(approval){const {title,detail,...a}=approval;out.approval={...a,enc_title:e2e.seal(key,String(title||''),'approval|'+taskId+'|'+a.request_id+'|title'),enc_detail:e2e.seal(key,String(detail||''),'approval|'+taskId+'|'+a.request_id+'|detail')};}
  return out;}
 emit(task,type,value){this.store.event(task,type,value);}
 async handle(command){const data=this.store.data;if(data.commands.includes(command.id))return;const id=command.task_id;
 if(command.type==='task.start'){
  const incoming=command.payload?.task||command.payload; if(!incoming||incoming.id!==id)throw new Error('任务格式无效');
  let refused='';if(incoming.e2e&&!data.tasks[id]){const pair=this.pairings[incoming.device_id],seen=(data.seen_requests||=[]),mark=incoming.device_id+'|'+incoming.request_id;if(pair?.state!=='on')refused=UNREADABLE;else if(seen.includes(mark))refused='重复的任务请求已被拒绝。';else{try{incoming.prompt=e2e.open(pair.key,incoming.enc_prompt,'prompt|'+incoming.request_id);seen.push(mark);if(seen.length>5000)data.seen_requests=seen.slice(-5000);}catch{refused=UNREADABLE;}}}
  if(!data.tasks[id]){const t={id,project_id:incoming.project_id,agent_id:incoming.agent_id,kind:incoming.kind==='app'?'app':'task',status:'queued',session_id:incoming.session_id,device_id:incoming.device_id,created_at:Date.now(),title:String(incoming.prompt||'').trim().split('\n')[0].slice(0,120),e2e:!!incoming.e2e};data.tasks[id]=t;data.commands.push(command.id);this.store.save();if(refused){this.emit(t,'error',{status:'failed',text:refused});return;}
   // Persist claim before any child process starts: redelivery can never launch twice.
   void this.execute(t,incoming).catch(()=>{if(!['failed','cancelled','interrupted','completed'].includes(t.status))this.emit(t,'error',{status:'failed',text:'电脑执行失败，请检查 Agent 配置。'});});return;}
 }else if(command.type==='task.cancel'){const active=this.running.get(id);if(active){active.cancelled=true;setTimeout(()=>{if(this.running.get(id)===active){active.finish('cancelled','任务已停止');}},5000).unref();void active.adapter.interrupt().catch(()=>{});}}
 else if(command.type==='approval.response'){const active=this.running.get(id);if(active){const p=command.payload;if(active.approvals[0]?.request_id===String(p.request_id)){active.adapter.approve(String(p.request_id),p.decision);active.approvals.shift();if(active.approvals.length)this.emit(data.tasks[id],'approval',{status:'waiting_approval',approval:active.approvals[0]});else this.emit(data.tasks[id],'status',{status:'running',text:'已提交审批决定'});}}}
 data.commands.push(command.id);if(data.commands.length>10000)data.commands=data.commands.slice(-10000);this.store.save();}
 async execute(t,incoming){const project=this.store.data.projects.find(p=>p.id===t.project_id);const full=this.running.size>=MAX_PARALLEL||!!this.studio?.active;if(!project||!executorIds().includes(t.agent_id)||full){this.emit(t,'error',{status:'failed',text:!project?'项目授权已移除':full?BUSY:'此 Agent 尚未配置'});return;}
 let session;
 if(incoming.session_id){const owned=this.store.data.sessions[incoming.session_id];if(!owned||owned.project_id!==project.id||owned.device_id!==incoming.device_id||owned.agent_id!==t.agent_id){this.emit(t,'error',{status:'failed',text:'会话不属于此设备和项目'});return;}session=incoming.session_id;}
 let a;try{a=this.adapter(t.agent_id);}catch(e){this.emit(t,'error',{status:'failed',text:String(e.message||'此执行器不可用').slice(0,200)});return;}const active={id:t.id,project_id:project.id,adapter:a,cancelled:false,approvals:[]};this.running.set(t.id,active);let final='',completed=false,delta='',timer;const generation=this.generation;
 const live=()=>!completed&&this.running.get(t.id)===active&&generation===this.generation;
 const flushDelta=()=>{clearTimeout(timer);timer=null;if(delta&&live()){this.emit(t,'delta',{text:delta});delta='';}};
 active.finish=(status,text,artifact)=>{if(!live())return;flushDelta();completed=true;clearTimeout(timer);this.emit(t,status==='completed'?'result':status==='cancelled'?'status':'error',{status,text,session_id:t.session_id,...(artifact?{artifact}:{})});this.running.delete(t.id);a.close();};
 a.on('delta',text=>{if(!live())return;delta+=String(text);if(delta.length>=12000)flushDelta();else if(!timer)timer=setTimeout(flushDelta,200);});
 a.on('message',text=>{if(live())final=String(text);});
 a.on('session',session_id=>{if(!live()||active.cancelled)return;t.session_id=session_id;this.store.data.sessions[session_id]={project_id:project.id,device_id:incoming.device_id,agent_id:t.agent_id};this.emit(t,'status',{status:'running',session_id,text:'Agent 已连接'});});
 a.on('approval',approval=>{if(!live()||active.cancelled)return;active.approvals.push(approval);if(active.approvals.length===1)this.emit(t,'approval',{status:'waiting_approval',approval});});
 a.on('completed',turn=>{if(!live())return;const status=active.cancelled?'cancelled':turn?.status==='completed'?'completed':turn?.status==='interrupted'?'cancelled':'failed';if(status==='completed'&&t.kind==='app'){try{const artifact=parseArtifact(final);active.finish('completed','应用已生成，可以预览并安装。',artifact);}catch{active.finish('failed','生成结果不是有效的 ATOM 应用包，请修改需求后重试。');}}else active.finish(status,status==='completed'?final.slice(0,16000):status==='cancelled'?'任务已取消':String(turn?.reason||'Agent 执行失败，请在电脑端检查状态').slice(0,400));});
 a.on('disconnected',()=>{if(live())active.finish(active.cancelled?'cancelled':'interrupted','Agent 连接中断；未自动重新执行');});
 try{await a.open(project.path,{readOnly:project.read_only});if(!live()||active.cancelled){if(live())active.finish('cancelled','任务已取消');else a.close();return;}const authenticated=await a.account();if(!live()||active.cancelled){if(live())active.finish('cancelled','任务已取消');else a.close();return;}if(!authenticated)throw new Error('authentication');this.emit(t,'status',{status:'running',text:'正在启动电脑 Agent'});await a.start(t.kind==='app'?{...incoming,prompt:appPrompt(incoming.prompt)}:incoming,project,session);if(!live())a.close();}catch(e){if(live())active.finish(active.cancelled?'cancelled':'failed',e.code==='resume_unsupported'?'此执行器不支持继续旧会话，请新建任务':'无法启动任务，请在电脑端检查 Agent 登录及项目权限');else a.close();}
 }

 async tick(){if(!this.store.data.config||this.configuring||this.ticking)return;this.ticking=true;try{await this.request('/v1/computer/state',{projects:this.store.data.projects.map(({id,name})=>({id,name})),agents:this.agents,activity:this.studio.activitySummary()});this.relayState=await this.request('/v1/state');await this.syncKeys();const r=await this.request('/v1/computer/commands');for(const command of r.commands||[]){try{await this.handle(command);}catch{this.store.data.commands.push(command.id);this.store.save();}await this.request('/v1/computer/commands/ack',{command_id:command.id});}await this.flush();}finally{this.ticking=false;}}

 async run(){this.studio.start();await this.diagnose();while(!this.stopped){try{await this.tick();this.error='';}catch{this.error='服务器暂时无法连接，正在自动重试';}await new Promise(r=>setTimeout(r,this.pollMs));}}
 stop(){this.stopped=true;this.studio?.stop();for(const a of this.running.values())a.adapter.close();}
 // Compatibility for callers that only ask "is any task running" (studio, tests).
 get active(){return this.running.size?this.running.values().next().value:null;}
}
