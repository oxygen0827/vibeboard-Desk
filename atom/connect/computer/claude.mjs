import {EventEmitter} from 'node:events';
import fs from 'node:fs';import path from 'node:path';
export class Claude extends EventEmitter {
 constructor({loadSDK=()=>import('@anthropic-ai/claude-agent-sdk'),env=process.env}={}){super();this.loadSDK=loadSDK;this.env=env;this.pending=new Map();this.cancelled=false;}
 async open(){if(!this.env.ANTHROPIC_API_KEY)throw new Error('请配置 ANTHROPIC_API_KEY');this.sdk=await this.loadSDK();if(typeof this.sdk.query!=='function')throw new Error('Claude SDK 无效');}
 async account(){return !!this.sdk&&!!this.env.ANTHROPIC_API_KEY;}
 async start(task,project,session){
  const root=fs.realpathSync(project.path);const inside=value=>{try{let candidate=path.resolve(root,value);while((()=>{try{fs.lstatSync(candidate);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}})()){const parent=path.dirname(candidate);if(parent===candidate)return false;candidate=parent;}const resolved=fs.realpathSync(candidate);return resolved===root||resolved.startsWith(root+path.sep);}catch{return false;}};
  const safePattern=pattern=>typeof pattern==='string'&&!path.isAbsolute(pattern)&&!pattern.split(/[\\/]/).includes('..')&&!pattern.includes('\\');
  const hasUnsafeLinks=()=>{const queue=[root];let entries=0;while(queue.length){const dir=queue.pop();for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(++entries>50000)return true;if(e.isSymbolicLink())return true;if(e.isDirectory())queue.push(path.join(dir,e.name));}}return false;};
  const canUseTool=async(name,input,context={})=>{
   // No inherited allow/bypass rules: every tool runs through this hook before SDK rules.
   if(['Bash','AskUserQuestion','Task','Agent','Skill','NotebookEdit'].includes(name))return {behavior:'deny',message:'此交互工具尚未支持'};
   if(project.read_only&&!['Read','Glob','Grep'].includes(name))return {behavior:'deny',message:'此项目仅允许只读文件工具'};
   if(name==='Glob'&&(!safePattern(input.pattern)||hasUnsafeLinks()))return {behavior:'deny',message:'不允许绝对路径、目录穿越或含符号链接的 Glob 搜索'};
   if(name==='Grep'&&(hasUnsafeLinks()||(input.glob&&!safePattern(input.glob))))return {behavior:'deny',message:'不允许目录穿越或含符号链接的搜索'};
   if(input.file_path&&!inside(input.file_path))return {behavior:'deny',message:'路径不属于已授权项目'};
   if((name==='Glob'||name==='Grep')&&input.path&&!inside(input.path))return {behavior:'deny',message:'路径不属于已授权项目'};
   const id=crypto.randomUUID();return new Promise(resolve=>{const finish=decision=>{context.signal?.removeEventListener('abort',abort);this.pending.delete(id);resolve(decision==='accept'?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'用户拒绝或任务已取消'});};const abort=()=>finish('decline');this.pending.set(id,finish);context.signal?.addEventListener('abort',abort,{once:true});if(context.signal?.aborted)return abort();this.emit('approval',{request_id:id,title:'允许 Claude 使用 '+name+'？',detail:String(input.description||input.command||input.file_path||input.pattern||name).slice(0,3000),choices:['accept','decline']});});
  };
  // PreToolUse asks for all tools, preventing SDK automatic approvals bypassing callback.
  const hook=async()=>({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'ask',permissionDecisionReason:'ATOM 用户审批'}});
  this.query=this.sdk.query({prompt:task.prompt,options:{cwd:root,resume:session,env:{...this.env,CLAUDE_CODE_OAUTH_TOKEN:undefined,CLAUDE_AGENT_SDK_CLIENT_APP:'atom-connect/1.0.0'},settingSources:[],permissionMode:'default',includePartialMessages:true,canUseTool,hooks:{PreToolUse:[{hooks:[hook]}]},tools:project.read_only?['Read','Glob','Grep']:['Read','Glob','Grep','Edit','Write']}});
  void this.consume();
 }
 async consume(){let completed=false;try{for await(const m of this.query){if(m.type==='system'&&m.subtype==='init')this.emit('session',m.session_id);if(m.type==='stream_event'&&m.event?.type==='content_block_delta'&&m.event.delta?.type==='text_delta')this.emit('delta',m.event.delta.text);if(m.type==='assistant'){const text=(m.message?.content||[]).filter(v=>v.type==='text').map(v=>v.text).join('\n');if(text)this.emit('message',text);}if(m.type==='result'){if(m.result)this.emit('message',m.result);completed=true;this.emit('completed',{status:this.cancelled?'interrupted':m.subtype==='success'&&!m.is_error?'completed':'failed'});break;}}if(!completed)this.emit('disconnected',new Error('Claude 未返回协议结果'));}catch{if(this.cancelled)this.emit('completed',{status:'interrupted'});else this.emit('disconnected',new Error('Claude SDK 执行中断'));}}
 approve(id,decision){const callback=this.pending.get(id);if(!callback)throw new Error('审批已失效');callback(decision);}
 async interrupt(){this.cancelled=true;for(const finish of this.pending.values())finish('decline');await this.query?.interrupt();}
 close(){for(const finish of this.pending.values())finish('decline');this.query?.close?.();}
}
export async function diagnoseClaude(){if(!process.env.ANTHROPIC_API_KEY)return {id:'claude',name:'Claude Agent',available:false,authenticated:false,reason:'未配置 ANTHROPIC_API_KEY（仅支持官方 API key）'};try{const sdk=await import('@anthropic-ai/claude-agent-sdk');if(typeof sdk.query!=='function')throw Error();return {id:'claude',name:'Claude Agent',available:true,authenticated:true,reason:'SDK 与 API key 已配置；尚未验证模型额度'};}catch{return {id:'claude',name:'Claude Agent',available:false,authenticated:false,reason:'请安装可选依赖 @anthropic-ai/claude-agent-sdk'};}}
