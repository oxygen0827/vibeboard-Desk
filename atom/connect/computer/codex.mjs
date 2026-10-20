import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class Codex extends EventEmitter {
  constructor({binary=process.env.ATOM_CODEX_BINARY||'codex',spawnProcess=spawn,extraArgs=[],env}={}) { super(); this.binary=binary; this.spawnProcess=spawnProcess;this.extraArgs=extraArgs;this.env=env; this.pending=new Map(); this.next=1; this.approvals=new Map(); }
  async open(cwd) {
    this.proc=this.spawnProcess(this.binary,['app-server','--stdio',...this.extraArgs],{cwd,env:this.env,stdio:['pipe','pipe','pipe']});
    // Never forward stderr: provider diagnostics can contain credentials or private paths.
    this.proc.stderr?.resume();
    createInterface({input:this.proc.stdout}).on('line',line=>{try { this.receive(JSON.parse(line)); } catch {}});
    this.proc.on('error',()=>this.fail(new Error('Codex 无法启动，请检查安装路径')));
    this.proc.on('exit',()=>this.fail(new Error('Codex 进程已退出')));
    await this.rpc('initialize',{clientInfo:{name:'atom_connect',title:'ATOM Connect',version:'1.0.0'}});
    this.send({method:'initialized'});
    return this;
  }
  send(value) { if (!this.proc?.stdin?.writable) throw new Error('Codex 连接已关闭'); this.proc.stdin.write(JSON.stringify(value)+'\n'); }
  rpc(method,params={}) { const id=this.next++; return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex 协议响应超时'));},30000);this.pending.set(id,{resolve,reject,timeout});try {this.send({id,method,params});}catch(e){clearTimeout(timeout);this.pending.delete(id);reject(e);}}); }
  fail(error) {for(const p of this.pending.values()){clearTimeout(p.timeout);p.reject(error);}this.pending.clear();this.emit('disconnected',error);}
  receive(m) {
    if (m.id!==undefined && !m.method) {const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timeout);this.pending.delete(m.id);m.error?p.reject(new Error('Codex 请求失败（'+String(m.error.code||'protocol')+'）')):p.resolve(m.result);return;}
    if(m.method && m.id!==undefined){
      if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(m.method)){
        const key=String(m.id);this.approvals.set(key,m.id);this.emit('approval',{request_id:key,title:m.method.includes('commandExecution')?'允许执行命令？':'允许修改文件？',detail:String(m.params?.reason||m.params?.command||'Agent 请求执行操作').slice(0,3000),choices:['accept','decline']});
      } else this.send({id:m.id,error:{code:-32601,message:'ATOM Connect does not support this interactive request'}});
      return;
    }
    const p=m.params||{};
    if(m.method==='item/agentMessage/delta')this.emit('delta',String(p.delta||''));
    if(m.method==='item/completed' && p.item?.type==='agentMessage')this.emit('message',p.item.text||'');
    if(m.method==='turn/completed')this.emit('completed',p.turn);
    if(m.method==='turn/started')this.turn=p.turn?.id;
    if(m.method==='item/started')this.emit('progress',p.item?.type||'working');
  }
  async account(){const r=await this.rpc('account/read',{refreshToken:false});return !!r.account;}
  async start(task,project,session) {
    const params={cwd:project.path,approvalPolicy:'untrusted',sandbox:project.read_only?'read-only':'workspace-write'};
    const r=await this.rpc(session?'thread/resume':'thread/start',session?{...params,threadId:session}:params);
    if(this.cancelled)throw new Error('任务已取消');this.thread=r.thread.id;this.emit('session',this.thread);
    const t=await this.rpc('turn/start',{threadId:this.thread,cwd:project.path,approvalPolicy:'untrusted',sandboxPolicy:project.read_only?{type:'readOnly'}:{type:'workspaceWrite',writableRoots:[project.path],networkAccess:false},input:[{type:'text',text:task.prompt}]});
    this.turn=t.turn.id;return this.thread;
  }
  async interrupt(){this.cancelled=true;if(this.thread&&this.turn)await this.rpc('turn/interrupt',{threadId:this.thread,turnId:this.turn});}
  approve(id,decision){const wire=this.approvals.get(id);if(wire===undefined)throw new Error('审批已失效');this.send({id:wire,result:{decision:decision==='accept'?'accept':'decline'}});this.approvals.delete(id);}
  close(){this.cancelled=true;this.proc?.kill('SIGTERM');const proc=this.proc;const timer=setTimeout(()=>{if(proc&&proc.exitCode===null)proc.kill('SIGKILL');},1500);timer.unref();}
}
