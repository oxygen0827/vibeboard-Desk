import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {EXECUTORS,findBinary,diagnoseExecutors,createAdapter} from '../agents.mjs';import {AcpAgent} from '../acp.mjs';import {PiAgent,PI_TOOLS} from '../pi.mjs';import {Companion,BUSY} from '../companion.mjs';
const FIX=path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures'),ACP=path.join(FIX,'fake-acp.mjs'),PI=path.join(FIX,'fake-pi.mjs');
const live=new Set();test.afterEach(()=>{for(const a of live)a.close();live.clear();});
const track=a=>(live.add(a),a);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'atom-exec-test-'));
const once=(e,name)=>new Promise(r=>e.once(name,r));
const spec=id=>EXECUTORS.find(e=>e.id===id);

test('detection searches PATH, per-user install folders and explicit overrides',()=>{const home=tmp(),bin=path.join(home,'.opencode/bin');fs.mkdirSync(bin,{recursive:true});fs.copyFileSync(ACP,path.join(bin,'opencode'));fs.chmodSync(path.join(bin,'opencode'),0o755);
 assert.equal(findBinary(spec('opencode'),{env:{PATH:'/nonexistent'},home}),path.join(bin,'opencode'));
 assert.equal(findBinary(spec('kimi'),{env:{PATH:'/nonexistent'},home}),null);
 assert.equal(findBinary(spec('kimi'),{env:{ATOM_KIMI_BINARY:ACP},home}),ACP);
 assert.equal(findBinary(spec('kimi'),{env:{ATOM_KIMI_BINARY:'/missing/kimi',PATH:bin},home}),null,'a broken override is not silently replaced');});

test('diagnosis reports every executor: missing, ready, needs login',async()=>{const env={...process.env};
 const find=s=>({opencode:ACP,kimi:ACP}[s.id]||null);
 const adapter=id=>id==='kimi'?new AcpAgent({binary:ACP,id,env:{...env,FAKE_ACP_MODE:'auth'}}):createAdapter(id,{find});
 const rows=await diagnoseExecutors({find,adapter,claude:async()=>({id:'claude',name:'Claude Agent',available:false,authenticated:false,reason:'x'})});
 const by=Object.fromEntries(rows.map(r=>[r.id,r]));
 assert.deepEqual(rows.map(r=>r.id),['codex','claude','opencode','kimi','pi']);
 assert.equal(by.opencode.available&&by.opencode.authenticated,true);
 assert.equal(by.kimi.available,true);assert.equal(by.kimi.authenticated,false);assert.match(by.kimi.reason,/login/);
 assert.equal(by.pi.available,false);assert.match(by.pi.reason,/未安装/);assert.match(by.codex.reason,/未安装/);});

test('ACP: streams text, forwards a one-time approval and never offers "always"',async()=>{const d=tmp(),answer=path.join(d,'answer.json');
 const a=track(new AcpAgent({binary:ACP,id:'kimi',env:{...process.env,FAKE_ACP_MODE:'permission',FAKE_ACP_ANSWER:answer}}));await a.open(d);assert.equal(await a.account(),true);
 let text='';a.on('delta',t=>text+=t);const approval=once(a,'approval');const sid=await a.start({prompt:'go'},{path:d});assert.match(sid,/^sess-/);
 const req=await approval;assert.equal(req.title,'允许执行命令？');assert.match(req.detail,/ls -la/);
 assert.equal(a.relative(d+'/notes/a.md and '+fs.realpathSync(d)+'/b.md in '+d),'notes/a.md and b.md in .','approval text never carries the computer\'s absolute project path');
 const done=once(a,'completed'),final=once(a,'message');a.approve(req.request_id,'accept');
 assert.equal((await done).status,'completed');assert.equal(await final,'第一段·已执行');assert.equal(text,'第一段·已执行');
 assert.deepEqual(JSON.parse(fs.readFileSync(answer,'utf8')),{outcome:{outcome:'selected',optionId:'allow'}});a.close();});

test('ACP: read-only projects refuse writes and commands without asking the user',async()=>{const d=tmp(),answer=path.join(d,'answer.json');
 const a=track(new AcpAgent({binary:ACP,id:'kimi',env:{...process.env,FAKE_ACP_MODE:'permission',FAKE_ACP_ANSWER:answer}}));await a.open(d,{readOnly:true});await a.account();
 let asked=false;a.on('approval',()=>asked=true);const done=once(a,'completed'),final=once(a,'message');await a.start({prompt:'go'},{path:d});
 assert.equal((await done).status,'completed');assert.equal(await final,'第一段·被拒绝');assert.equal(asked,false);
 assert.deepEqual(JSON.parse(fs.readFileSync(answer,'utf8')),{outcome:{outcome:'selected',optionId:'reject'}});a.close();});

test('OpenCode is started with edits and shell set to ask (writable) or deny (read-only)',async()=>{for(const readOnly of [false,true]){const d=tmp(),log=path.join(d,'env.json');
 const a=new AcpAgent({binary:ACP,args:['acp'],id:'opencode',env:{...process.env,FAKE_ACP_ENV_LOG:log}});await a.open(d,{readOnly});a.close();
 const seen=JSON.parse(fs.readFileSync(log,'utf8')),perm=JSON.parse(seen.config).permission;assert.deepEqual(seen.args,['acp']);
 assert.equal(perm.edit,readOnly?'deny':'ask');assert.equal(perm.bash,readOnly?'deny':'ask');assert.equal(perm.external_directory,'deny');}});

test('Pi: read-only tools only, streams, completes, and aborts on cancel',async()=>{const d=tmp(),args=path.join(d,'args.json');
 let a=track(new PiAgent({binary:PI,env:{...process.env,FAKE_PI_ARGS:args}}));await a.open(d);
 assert.deepEqual(JSON.parse(fs.readFileSync(args,'utf8')),['--mode','rpc','--no-session','--no-extensions','--no-mcp','--no-skills','--no-prompt-templates','--tools',PI_TOOLS]);assert.equal(PI_TOOLS,'read,grep,find,ls');
 let text='';a.on('delta',t=>text+=t);let done=once(a,'completed'),final=once(a,'message');await a.start({prompt:'读资料'});
 assert.equal((await done).status,'completed');assert.equal(await final,'读到 两份资料');assert.equal(text,'读到 两份资料');a.close();
 a=track(new PiAgent({binary:PI,env:{...process.env,FAKE_PI_MODE:'hang'}}));await a.open(d);done=once(a,'completed');await a.start({prompt:'x'});await a.interrupt();
 assert.equal((await done).status,'interrupted');a.close();});

test('companion runs a detected executor end to end and fails clearly when one is missing',async()=>{const d=tmp(),project=tmp();
 const c=new Companion(d,{adapter:id=>{if(id==='opencode')return track(new AcpAgent({binary:ACP,id,env:process.env}));throw new Error('Kimi Code 未安装');},diagnoseAgents:async()=>[]});
 const p=c.addProject({path:project});
 for(const [id,agent] of [['t1','opencode'],['t2','kimi']]){c.store.data.tasks[id]={id,project_id:p.id,agent_id:agent,status:'queued'};}
 await c.execute(c.store.data.tasks.t1,{device_id:'dev',prompt:'hello'});
 for(let i=0;i<100&&!['completed','failed'].includes(c.store.data.tasks.t1.status);i++)await new Promise(r=>setTimeout(r,20));
 const events=c.store.data.outbox.filter(x=>x.task_id==='t1').map(x=>x.event);
 assert.equal(c.store.data.tasks.t1.status,'completed');assert.equal(events.at(-1).text,'第一段·完成');assert.ok(events.some(e=>e.session_id&&/^sess-/.test(e.session_id)));
 await c.execute(c.store.data.tasks.t2,{device_id:'dev',prompt:'hello'});
 assert.equal(c.store.data.tasks.t2.status,'failed');assert.equal(c.store.data.outbox.filter(x=>x.task_id==='t2').at(-1).event.text,'Kimi Code 未安装');
 c.stop();});

test('ACP rejects unsupported resume instead of silently losing context',async()=>{
 const a=track(new AcpAgent({binary:ACP}));await a.open(tmp());await a.account();
 await assert.rejects(a.start({prompt:'continue'},{path:os.tmpdir()},'old-session'),/不支持继续/);
 assert.equal(a.running,undefined);
});

test('ACP permissions are scoped to the running session and never grant persistent permission',()=>{
 const a=new AcpAgent();a.session='ours';a.running=true;a.readOnly=true;const replies=[],asked=[];
 a.send=m=>replies.push(m);a.on('approval',p=>asked.push(p));
 const options=[{kind:'allow_once',optionId:'yes'},{kind:'reject_once',optionId:'no'}];
 a.permission(1,{sessionId:'other',toolCall:{kind:'read'},options});
 a.permission(2,{sessionId:'ours',toolCall:{kind:'new-dangerous-kind'},options});
 a.permission(3,{sessionId:'ours',toolCall:{kind:'read'},options:[{kind:'allow_always',optionId:'always'}]});
 assert.deepEqual(replies.map(x=>x.result.outcome),[{outcome:'cancelled'},{outcome:'selected',optionId:'no'},{outcome:'cancelled'}]);
 assert.equal(asked.length,0);
 a.permission(4,{sessionId:'ours',toolCall:{kind:'read'},options});assert.equal(asked.length,1);
 a.approve('4','accept');assert.equal(replies.at(-1).result.outcome.optionId,'yes');
 assert.throws(()=>a.approve('4','accept'),/失效/);
});

test('ACP cancel resolves pending permissions, ignores late approvals and messages after close',async()=>{
 const a=track(new AcpAgent({binary:ACP,env:{...process.env,FAKE_ACP_MODE:'permission'}}));await a.open(tmp());await a.account();
 const approval=once(a,'approval');await a.start({prompt:'x'},{path:a.cwd});await approval;
 const done=once(a,'completed');await a.interrupt();assert.equal((await done).status,'interrupted');assert.equal(a.permissions.size,0);
 a.close();let count=0;a.on('delta',()=>count++);a.receive({method:'session/update',params:{sessionId:a.session,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'late'}}}});
 assert.equal(count,0);
});

test('closing adapters rejects pending RPCs immediately',async()=>{
 for(const a of [new AcpAgent({timeoutMs:10000}),new PiAgent({timeoutMs:10000})]){
  a.send=()=>{};const pending=a instanceof AcpAgent?a.rpc('initialize'):a.command({type:'get_state'});
  const rejected=assert.rejects(pending,/关闭/);a.close();await rejected;assert.equal(a.pending.size,0);
 }
});

test('Pi refuses an unconfigured model and never treats handled/error responses as a completed job',async()=>{
 for(const mode of ['no-model','failure','handled']){
  const a=track(new PiAgent({binary:PI,env:{...process.env,FAKE_PI_MODE:mode}}));await a.open(tmp());
  assert.equal(await a.account(),mode!=='no-model');
  if(mode==='no-model')continue;
  const done=once(a,'completed');await a.start({prompt:'x'});assert.equal((await done).status,'failed');
 }
});

test('Pi waits for settled after retries and uses the final assistant stop reason',()=>{
 const a=new PiAgent();a.running=true;const result=[];a.on('completed',x=>result.push(x.status));
 a.receive({type:'message_update',assistantMessageEvent:{type:'error'}});
 a.receive({type:'agent_end',willRetry:true});assert.deepEqual(result,[]);
 a.receive({type:'message_start',message:{role:'assistant'}});
 a.receive({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'ok'}]}});
 a.receive({type:'auto_retry_end',success:true});a.receive({type:'agent_settled',aborted:false});
 a.receive({type:'agent_settled',aborted:false});assert.deepEqual(result,['completed']);
});

test('diagnostics isolate one adapter construction failure from other executors',async()=>{
 const rows=await diagnoseExecutors({find:()=>'/test/binary',adapter:()=>{throw new Error('private provider detail');},claude:async()=>({id:'claude',available:false,authenticated:false})});
 assert.equal(rows.length,5);assert(rows.every(r=>!r.authenticated));assert(!JSON.stringify(rows).includes('private provider'));
});

test('OpenCode policy preserves model config but overrides wildcard and remembered permissions',async()=>{
 const d=tmp(),log=path.join(d,'env.json');const a=track(new AcpAgent({binary:ACP,id:'opencode',env:{...process.env,OPENCODE_CONFIG_CONTENT:JSON.stringify({model:'test/model',permission:'allow'}),FAKE_ACP_ENV_LOG:log}}));
 await a.open(d,{readOnly:true});const config=JSON.parse(JSON.parse(fs.readFileSync(log)).config);
 assert.equal(config.model,'test/model');assert.equal(config.permission['*'],'deny');assert.equal(config.permission.edit,'deny');
});

test('each new executor passes through the companion task contract, including cancellation',async()=>{
 for(const agent of ['opencode','kimi','pi']){
  const d=tmp(),pdir=tmp(),c=new Companion(d,{adapter:()=>agent==='pi'?new PiAgent({binary:PI}):new AcpAgent({binary:ACP,id:agent}),diagnoseAgents:async()=>[]});
  const p=c.addProject({path:pdir});const t={id:'t',project_id:p.id,agent_id:agent,status:'queued'};c.store.data.tasks.t=t;
  await c.execute(t,{device_id:'dev',prompt:'hello'});
  for(let i=0;i<100&&!['completed','failed'].includes(t.status);i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(t.status,'completed',agent);assert.equal(c.active,null);assert.equal(c.store.data.outbox.at(-1).event.type,'result');
  c.stop();
 }
});

test('new adapters ignore late provider updates after close and never expose raw RPC errors',async()=>{
 const a=new PiAgent();a.send=()=>{};const pending=a.command({type:'prompt'});
 const rejected=assert.rejects(pending,e=>!e.message.includes('secret'));
 a.receive({id:'atom-1',type:'response',success:false,error:'secret access token'});await rejected;
 a.running=true;a.close();let count=0;a.on('completed',()=>count++);a.receive({type:'agent_settled',aborted:false});assert.equal(count,0);
});

test('ACP: an executor that never answers fails after the idle limit, with a reason the device can show',async()=>{const d=tmp();
 const a=track(new AcpAgent({binary:ACP,id:'opencode',idleMs:300,env:{...process.env,FAKE_ACP_MODE:'silent'}}));await a.open(d);await a.account();
 const sent=[];const write=a.proc.stdin.write.bind(a.proc.stdin);a.proc.stdin.write=chunk=>{sent.push(JSON.parse(chunk));return write(chunk);};
 const done=once(a,'completed');await a.start({prompt:'x'},{path:d});const turn=await done;
 assert.equal(turn.status,'failed');assert.match(turn.reason,/没有任何响应.*模型额度、网络或服务/);
 assert.ok(sent.some(m=>m.method==='session/cancel'),'the stalled turn is cancelled on the executor too');});

test('ACP: waiting for the user\'s approval never counts as the executor being stuck',async()=>{const d=tmp();
 const a=track(new AcpAgent({binary:ACP,id:'kimi',idleMs:200,env:{...process.env,FAKE_ACP_MODE:'permission'}}));await a.open(d);await a.account();
 const approval=once(a,'approval'),done=once(a,'completed');await a.start({prompt:'go'},{path:d});const req=await approval;
 await new Promise(r=>setTimeout(r,500));a.approve(req.request_id,'accept');assert.equal((await done).status,'completed');});

test('companion shows the executor\'s own failure reason instead of a generic message',async()=>{const d=tmp(),project=tmp();
 const c=new Companion(d,{adapter:id=>track(new AcpAgent({binary:ACP,id,idleMs:200,env:{...process.env,FAKE_ACP_MODE:'silent'}})),diagnoseAgents:async()=>[]});
 const p=c.addProject({path:project});c.store.data.tasks.t={id:'t',project_id:p.id,agent_id:'opencode',status:'queued'};
 await c.execute(c.store.data.tasks.t,{device_id:'dev',prompt:'hello'});
 for(let i=0;i<100&&c.store.data.tasks.t.status!=='failed';i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(c.store.data.tasks.t.status,'failed');assert.match(c.store.data.outbox.at(-1).event.text,/没有任何响应/);c.stop();});

test('the companion runs up to three tasks at once and refuses a fourth with the stable busy text',async()=>{
 const {EventEmitter}=await import('node:events');const adapters=[];
 class Slow extends EventEmitter{async open(){}async account(){return true;}async start(){adapters.push(this);}async interrupt(){this.emit('completed',{status:'interrupted'});}approve(){}close(){}}
 const d=tmp(),pdir=tmp(),c=new Companion(d,{adapter:()=>new Slow(),diagnoseAgents:async()=>[]});
 const p=c.addProject({path:pdir});const tasks=['a','b','c','d'].map(id=>(c.store.data.tasks[id]={id,project_id:p.id,agent_id:'codex',status:'queued'}));
 for(const t of tasks)await c.execute(t,{device_id:'dev',prompt:'x'});
 assert.equal(c.running.size,3);assert.equal(tasks[3].status,'failed');assert(JSON.stringify(c.store.data.outbox).includes(BUSY));
 // Finishing or cancelling one task touches only that task.
 adapters[1].emit('message','done');adapters[1].emit('completed',{status:'completed'});
 assert.equal(tasks[1].status,'completed');assert.deepEqual([...c.running.keys()],['a','c']);
 await c.handle({id:'cmd-cancel',type:'task.cancel',task_id:'c'});
 assert.equal(tasks[2].status,'cancelled');assert.deepEqual([...c.running.keys()],['a']);assert.equal(tasks[0].status,'running');
 c.stop();
});
