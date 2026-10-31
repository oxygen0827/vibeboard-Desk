import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Codex } from './codex.mjs';
import { Claude, diagnoseClaude } from './claude.mjs';
import { AcpAgent } from './acp.mjs';
import { PiAgent } from './pi.mjs';

// Executors the companion can drive. Detection only reports what is installed; the device lets the user choose.
// `binary` names are looked up on PATH and in the usual per-user install folders (GUI apps start with a short PATH).
export const EXECUTORS = [
 {id:'codex',name:'Codex',binary:'codex',env:'ATOM_CODEX_BINARY',dirs:['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS'],install:'请安装官方 Codex CLI 并执行 codex login'},
 {id:'claude',name:'Claude Agent',sdk:true},
 {id:'opencode',name:'OpenCode',binary:'opencode',env:'ATOM_OPENCODE_BINARY',args:['acp'],protocol:'acp',login:'opencode auth login',install:'请安装 OpenCode（opencode.ai）'},
 {id:'kimi',name:'Kimi Code',binary:'kimi',env:'ATOM_KIMI_BINARY',args:['acp'],protocol:'acp',login:'kimi login',install:'请安装 Kimi Code CLI（code.kimi.com）'},
 // Pi has no tool-approval mechanism, so ATOM only ever enables its read-only tools.
 {id:'pi',name:'Pi（只读工具）',binary:'pi',env:'ATOM_PI_BINARY',protocol:'pi',login:'pi，然后输入 /login',install:'请安装 Pi（pi.dev）'}
];
const EXTRA_DIRS=home=>['.local/bin','.opencode/bin','.kimi-code/bin','.pi/bin','.bun/bin','.npm-global/bin','.cargo/bin','.volta/bin'].map(d=>path.join(home,d)).concat(['/opt/homebrew/bin','/usr/local/bin']);
export function findBinary(spec,{env=process.env,home=os.homedir(),exists=p=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile();}catch{return false;}}}={}){
 if(spec.env&&env[spec.env])return exists(env[spec.env])?env[spec.env]:null;
 const dirs=[...String(env.PATH||'').split(path.delimiter).filter(Boolean),...EXTRA_DIRS(home),...(spec.dirs||[])];
 for(const dir of new Set(dirs)){const candidate=path.join(dir,spec.binary);if(exists(candidate))return candidate;}
 return null;
}
export function executorIds(){return EXECUTORS.map(e=>e.id);}
export function createAdapter(id,{find=findBinary}={}){const spec=EXECUTORS.find(e=>e.id===id);if(!spec)throw new Error('未知的执行器');
 if(spec.sdk)return new Claude();
 const binary=find(spec);if(!binary)throw new Error(spec.name+' 未安装');
 if(spec.protocol==='acp')return new AcpAgent({binary,args:spec.args,id:spec.id});
 if(spec.protocol==='pi')return new PiAgent({binary});
 return new Codex({binary});
}
// One status row per executor: available = installed and startable, authenticated = ready to take tasks.
export async function diagnoseExecutors({find=findBinary,adapter=createAdapter,claude=diagnoseClaude,cwd=os.tmpdir()}={}){
 return Promise.all(EXECUTORS.map(async spec=>{
  if(spec.sdk){try{return await claude();}catch{return {id:spec.id,name:spec.name,available:false,authenticated:false,reason:'无法检测 Claude，请检查官方 SDK 配置'};}}
  const row={id:spec.id,name:spec.name,available:false,authenticated:false};
  if(!find(spec))return {...row,reason:'未安装 · '+spec.install};
  let a;
  try{a=adapter(spec.id,{find});await a.open(cwd,{readOnly:true});const ok=await a.account();return {...row,available:true,authenticated:ok,reason:ok?(spec.protocol==='pi'?'模型已配置 · 只读工具；实际调用以任务结果为准':spec.protocol==='acp'?'会话已就绪 · 实际调用以任务结果为准':'已登录'):'请在电脑终端执行 '+(spec.login||spec.binary+' login')};}
  catch{return {...row,reason:'无法启动 '+spec.name+'，请在终端确认能正常运行'};}
  finally{a?.close();}
 }));
}
