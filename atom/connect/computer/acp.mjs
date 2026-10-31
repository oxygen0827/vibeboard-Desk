import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

// Agent Client Protocol (JSON-RPC 2.0, one message per line on stdio): OpenCode `opencode acp`, Kimi Code `kimi acp`.
// The client advertises no fs/terminal capabilities, answers permission requests only with one-time choices, and in
// read-only projects refuses anything that writes or runs commands before it can reach the user.
const READS=new Set(['read','search','fetch','think']);
const KIND_TITLE={edit:'允许修改文件？',delete:'允许删除文件？',move:'允许移动文件？',execute:'允许执行命令？',fetch:'允许访问网络？',read:'允许读取文件？',search:'允许搜索？'};
// OpenCode allows edits and shell by default; inline config makes them ask (writable) or refuses them (read-only).
function agentEnv(id,base,readOnly){
 if(id!=='opencode')return base;
 let config={};try{config=JSON.parse(base.OPENCODE_CONFIG_CONTENT||'{}');}catch{throw new Error('OpenCode 内联配置不是有效 JSON');}
 const act=readOnly?'deny':'ask';
 return {...base,OPENCODE_CONFIG_CONTENT:JSON.stringify({...config,permission:{'*':act,read:'ask',grep:'ask',glob:'ask',list:'ask',edit:act,bash:act,webfetch:'ask',external_directory:'deny'}})};
}
export class AcpAgent extends EventEmitter {
 constructor({binary,args=[],id='acp',spawnProcess=spawn,env=process.env,timeoutMs=30000,idleMs=180000}={}){super();Object.assign(this,{binary,args,id,spawnProcess,env,timeoutMs,idleMs});this.pending=new Map();this.next=1;this.permissions=new Map();this.buffer='';this.text='';this.closed=false;}
 async open(cwd,{readOnly=false}={}){this.cwd=cwd;this.readOnly=readOnly;try{this.realCwd=fs.realpathSync(cwd);}catch{}
  this.proc=this.spawnProcess(this.binary,this.args,{cwd,env:agentEnv(this.id,this.env,readOnly),stdio:['pipe','pipe','pipe']});
  // Never forward stderr: provider diagnostics can contain credentials or private paths.
  this.proc.stderr?.resume();
  // Split on LF only; readline would also split on U+2028/U+2029 inside JSON strings.
  this.proc.stdout.setEncoding('utf8');this.proc.stdout.on('data',chunk=>{this.buffer+=chunk;let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).trim();this.buffer=this.buffer.slice(i+1);if(line)try{this.receive(JSON.parse(line));}catch{}}});
  this.proc.on('error',()=>this.fail(new Error('执行器无法启动')));this.proc.on('exit',()=>this.fail(new Error('执行器进程已退出')));
  const r=await this.rpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'atom_connect',title:'ATOM Connect',version:'1.0.0'}});
  if(r?.protocolVersion!==1)throw new Error('执行器不支持 ACP v1');
  this.capabilities=r.agentCapabilities||{};return this;
 }
 send(value){if(!this.proc?.stdin?.writable)throw new Error('执行器连接已关闭');this.proc.stdin.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');}
 rpc(method,params={},timeout=this.timeoutMs){const id=this.next++;return new Promise((resolve,reject)=>{const timer=timeout?setTimeout(()=>{this.pending.delete(id);reject(new Error('执行器协议响应超时'));},timeout):null;this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
 fail(error){this.running=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();if(!this.closed&&!this.failed){this.failed=true;this.emit('disconnected',error);}}
 receive(m){
  if(this.closed||this.failed)return;
  this.touch();
  if(m.id!==undefined&&!m.method){const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);if(m.error){const e=new Error('执行器请求失败（'+String(m.error.code??'protocol')+'）');e.code=m.error.code;e.detail=String(m.error.message||'');p.reject(e);}else p.resolve(m.result);return;}
  if(m.method==='session/request_permission'&&m.id!==undefined)return this.permission(m.id,m.params||{});
  if(m.id!==undefined){this.send({id:m.id,error:{code:-32601,message:'ATOM Connect does not provide this capability'}});return;}
  if(this.running&&m.method==='session/update'&&m.params?.sessionId===this.session){const u=m.params.update||{};
   if(u.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text'){this.text+=u.content.text;this.emit('delta',u.content.text);}
   else if(u.sessionUpdate==='tool_call')this.emit('progress',u.kind||'tool');}
 }
 permission(wire,params){const call=params.toolCall||{},options=Array.isArray(params.options)?params.options:[];
  const pick=allow=>(options.find(o=>o.kind===(allow?'allow_once':'reject_once'))||(allow?null:options.find(o=>o.kind==='reject_always')))?.optionId;
  const answer=optionId=>this.send({id:wire,result:{outcome:optionId?{outcome:'selected',optionId}:{outcome:'cancelled'}}});
  if(!this.running||this.cancelled||params.sessionId!==this.session)return answer(null);
  if(this.readOnly&&!READS.has(call.kind))return answer(pick(false));
  if(!pick(true))return answer(null);
  const key=String(wire);this.permissions.set(key,{answer,pick});this.touch();
  const detail=this.relative([call.title,call.rawInput?.command,call.rawInput?.path||call.rawInput?.filePath].filter(Boolean).map(String).join('\n'));
  this.emit('approval',{request_id:key,title:KIND_TITLE[call.kind]||'允许执行操作？',detail:(detail||'Agent 请求执行操作').slice(0,3000),choices:['accept','decline']});
 }
 // Approval text reaches the device: show project paths relative to the project, never the computer's absolute paths.
 relative(text){let out=text;for(const root of [...new Set([this.cwd,this.realCwd].filter(Boolean))].sort((a,b)=>b.length-a.length))out=out.split(root+path.sep).join('').split(root).join('.');return out;}
 approve(id,decision){const p=this.permissions.get(id);if(!p)throw new Error('审批已失效');this.permissions.delete(id);p.answer(p.pick(decision==='accept'));this.touch();}
 // Some executors never report provider failures (e.g. exhausted balance) over ACP and leave the prompt open forever.
 // Any message from the agent restarts the clock; a pending approval waits on the user, so it pauses the clock.
 touch(){clearTimeout(this.idle);this.idle=null;if(this.running&&!this.permissions.size&&this.idleMs)this.idle=setTimeout(()=>this.stall(),this.idleMs);}
 stall(){if(!this.running||this.closed)return;this.running=false;try{this.send({method:'session/cancel',params:{sessionId:this.session}});}catch{}
  this.emit('message',this.text);this.emit('completed',{status:'failed',reason:'执行器超过 '+(this.idleMs>=60000?Math.round(this.idleMs/60000)+' 分钟':Math.round(this.idleMs/1000)+' 秒')+'没有任何响应，任务已停止。可能是模型额度、网络或服务问题，请在电脑终端直接运行该执行器检查。'});}
 // Probe readiness by opening the session the task will use; an auth error means the user must log in first.
 async account(){try{const r=await this.rpc('session/new',{cwd:this.cwd,mcpServers:[]});this.session=r.sessionId;return typeof this.session==='string';}
  catch(e){if(e.code===-32000||/auth/i.test(e.detail||''))return false;throw e;}}
 async start(task,project,session){
  if(this.closed||this.cancelled)throw new Error('任务已取消');
  if(this.running)throw new Error('会话正在执行');
  if(session&&session!==this.session&&!this.capabilities.loadSession)throw Object.assign(new Error('此执行器不支持继续旧会话，请新建任务'),{code:'resume_unsupported'});
  if(session&&session!==this.session&&this.capabilities.loadSession){await this.rpc('session/load',{sessionId:session,cwd:project.path,mcpServers:[]});this.session=session;}
  if(!this.session)this.session=(await this.rpc('session/new',{cwd:project.path,mcpServers:[]})).sessionId;
  if(this.closed||this.cancelled)throw new Error('任务已取消');
  this.text='';this.running=true;this.emit('session',this.session);this.touch();
  // A turn can run for a long time; the prompt reply carries its stop reason.
  this.rpc('session/prompt',{sessionId:this.session,prompt:[{type:'text',text:task.prompt}]},0).then(r=>{
   if(this.closed||!this.running)return;this.running=false;this.touch();
   const reason=r?.stopReason;this.emit('message',this.text);this.emit('completed',{status:this.cancelled||reason==='cancelled'?'interrupted':reason==='end_turn'?'completed':'failed'});
  },()=>{if(!this.closed&&this.running){this.running=false;this.touch();this.emit('completed',{status:this.cancelled?'interrupted':'failed'});}});
  return this.session;
 }
 async interrupt(){this.cancelled=true;for(const p of this.permissions.values())p.answer(null);this.permissions.clear();if(this.session)this.send({method:'session/cancel',params:{sessionId:this.session}});}
 close(){if(this.closed)return;this.closed=true;this.running=false;clearTimeout(this.idle);this.cancelled=true;this.fail(new Error('执行器已关闭'));for(const p of this.permissions.values()){try{p.answer(null);}catch{}}this.permissions.clear();this.proc?.kill('SIGTERM');const proc=this.proc;const timer=setTimeout(()=>{if(proc&&proc.exitCode===null)proc.kill('SIGKILL');},1500);timer.unref();}
}
