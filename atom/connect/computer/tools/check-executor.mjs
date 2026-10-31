// Explicit opt-in model call, in a disposable directory. Never prints credentials/provider errors.
// node atom/connect/computer/tools/check-executor.mjs codex|claude|opencode|kimi|pi
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdapter, executorIds } from '../agents.mjs';
const id=process.argv[2];
if(!executorIds().includes(id))throw new Error('Specify an executor: '+executorIds().join(', '));
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'atom-executor-smoke-'));
const project={path:cwd,read_only:true};let adapter,timer,output='',status='failed';
try{
 adapter=createAdapter(id);
 const done=new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(new Error('timeout')),60000);
  adapter.on('message',text=>output=text);
  adapter.on('approval',p=>adapter.approve(p.request_id,'decline'));
  adapter.on('completed',turn=>resolve(turn.status));
  adapter.on('disconnected',()=>reject(new Error('disconnected')));
 });
 // Start and completion share a deadline; attach rejection handlers before launching either.
 status=await Promise.race([done,(async()=>{
  await adapter.open(cwd,{readOnly:true});
  if(!await adapter.account())throw new Error('not configured');
  await adapter.start({prompt:'Reply with exactly ATOM_EXECUTOR_OK. Do not use any tools, read files or change files.'},project);
  return done;
 })()]);
 const ok=status==='completed'&&output.trim()==='ATOM_EXECUTOR_OK'&&fs.readdirSync(cwd).length===0;
 console.log(JSON.stringify({executor:id,ok,status,expected_reply:output.trim()==='ATOM_EXECUTOR_OK',project_unchanged:fs.readdirSync(cwd).length===0}));
 if(!ok)process.exitCode=1;
}catch{
 console.log(JSON.stringify({executor:id,ok:false,status:'unverified',reason:'Real call did not complete; check installed CLI, provider configuration and network on the computer.'}));process.exitCode=1;
}finally{clearTimeout(timer);adapter?.close();fs.rmSync(cwd,{recursive:true,force:true});}
