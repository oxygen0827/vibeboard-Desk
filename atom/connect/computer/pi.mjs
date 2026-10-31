import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Pi RPC mode (JSONL on stdio). Pi has no tool-approval step, so ATOM starts it with read-only tools only and
// without extensions/MCP or a stored session. This limits built-in tools, not OS filesystem read access.
export const PI_TOOLS='read,grep,find,ls';
export class PiAgent extends EventEmitter {
 constructor({binary='pi',spawnProcess=spawn,env=process.env,timeoutMs=30000}={}){super();Object.assign(this,{binary,spawnProcess,env,timeoutMs});this.pending=new Map();this.next=1;this.buffer='';this.closed=false;}
 async open(cwd){
  this.proc=this.spawnProcess(this.binary,['--mode','rpc','--no-session','--no-extensions','--no-mcp','--no-skills','--no-prompt-templates','--tools',PI_TOOLS],{cwd,env:this.env,stdio:['pipe','pipe','pipe']});
  // Never forward stderr: provider diagnostics can contain credentials or private paths.
  this.proc.stderr?.resume();
  // Pi requires LF-only framing (readline also splits on U+2028/U+2029).
  this.proc.stdout.setEncoding('utf8');this.proc.stdout.on('data',chunk=>{this.buffer+=chunk;let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).trim();this.buffer=this.buffer.slice(i+1);if(line)try{this.receive(JSON.parse(line));}catch{}}});
  this.proc.on('error',()=>this.fail(new Error('Pi 无法启动')));this.proc.on('exit',()=>this.fail(new Error('Pi 进程已退出')));
  this.state=await this.command({type:'get_state'});return this;
 }
 send(value){if(!this.proc?.stdin?.writable)throw new Error('Pi 连接已关闭');this.proc.stdin.write(JSON.stringify(value)+'\n');}
 command(value,timeout=this.timeoutMs){const id='atom-'+(this.next++);return new Promise((resolve,reject)=>{const timer=timeout?setTimeout(()=>{this.pending.delete(id);reject(new Error('Pi 协议响应超时'));},timeout):null;this.pending.set(id,{resolve,reject,timer});try{this.send({id,...value});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
 fail(error){this.running=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();if(!this.closed&&!this.disconnected){this.disconnected=true;this.emit('disconnected',error);}}
 receive(m){
  if(this.closed||this.disconnected)return;
  if(m.type==='response'){const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.success?p.resolve(m.data):p.reject(new Error('Pi 命令失败，请在电脑端检查模型配置'));return;}
  if(!this.running)return;
  if(m.type==='message_start'&&m.message?.role==='assistant'){this.current='';this.failed=false;}
  else if(m.type==='message_update'){const e=m.assistantMessageEvent||{};if(e.type==='text_delta'){this.current=(this.current||'')+e.delta;this.emit('delta',e.delta);}else if(e.type==='error')this.failed=true;}
  else if(m.type==='message_end'&&m.message?.role==='assistant'){this.failed=['error','aborted'].includes(m.message.stopReason);this.finalReason=m.message.stopReason;const text=(m.message.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');if(text)this.final=text;else if(this.current)this.final=this.current;}
  else if(m.type==='tool_execution_start')this.emit('progress',String(m.toolName||'tool'));
  else if(m.type==='auto_retry_end')this.failed=m.success!==true;
  else if(m.type==='agent_settled')this.finish(m.aborted||this.cancelled?'interrupted':!this.failed&&this.finalReason==='stop'?'completed':'failed');
 }
 finish(status){if(!this.running)return;this.running=false;this.emit('message',this.final||this.current||'');this.emit('completed',{status:this.cancelled?'interrupted':status});}
 // The RPC exposes available models, not credentials; readiness is not a billing/network check.
 async account(){const {models=[]}=await this.command({type:'get_available_models'});const m=this.state?.model;return !!m&&models.some(x=>x.id===m.id&&x.provider===m.provider);}
 async start(task,project,session){
  if(session)throw Object.assign(new Error('Pi 只支持新任务，不能继续旧会话'),{code:'resume_unsupported'});
  if(this.closed||this.cancelled)throw new Error('任务已取消');
  if(this.running)throw new Error('Pi 正在执行任务');
  this.running=true;this.final='';this.current='';this.finalReason=null;this.failed=false;
  try{const r=await this.command({type:'prompt',message:task.prompt});
   if(r?.disposition&&r.disposition!=='started')this.finish('failed');
  }catch(e){this.running=false;throw e;}
 }
 async interrupt(){this.cancelled=true;if(this.running)await this.command({type:'abort'}).catch(()=>{});}
 close(){if(this.closed)return;this.closed=true;this.running=false;this.cancelled=true;this.fail(new Error('Pi 已关闭'));try{this.proc?.stdin?.end();}catch{}this.proc?.kill('SIGTERM');const proc=this.proc;const timer=setTimeout(()=>{if(proc&&proc.exitCode===null)proc.kill('SIGKILL');},1500);timer.unref();}
}
