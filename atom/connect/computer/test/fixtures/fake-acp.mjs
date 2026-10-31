#!/usr/bin/env node
// Minimal ACP agent for tests. FAKE_ACP_MODE: ok | auth | permission (asks to run a command before answering) | silent (never answers a prompt).
import fs from 'node:fs';
const mode=process.env.FAKE_ACP_MODE||'ok';
if(process.env.FAKE_ACP_ENV_LOG)fs.writeFileSync(process.env.FAKE_ACP_ENV_LOG,JSON.stringify({config:process.env.OPENCODE_CONFIG_CONTENT||null,args:process.argv.slice(2)}));
let buf='',next=1000,session=null,waiting=null,cancelled=false;
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
const chunk=text=>send({method:'session/update',params:{sessionId:session,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(line.trim())handle(JSON.parse(line));}});
function handle(m){
 if(m.method==='initialize')return send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:false},authMethods:[]}});
 if(m.method==='session/new'){if(mode==='auth')return send({id:m.id,error:{code:-32000,message:'Authentication required'}});session='sess-'+m.params.cwd.length;return send({id:m.id,result:{sessionId:session}});}
 if(m.method==='session/cancel'){cancelled=true;return;}
 if(m.method==='session/prompt'&&mode==='silent')return;
 if(m.method==='session/prompt'){const promptId=m.id;chunk('第一段');
  if(mode==='permission'){const id=next++;waiting=r=>{const allowed=r.outcome?.optionId==='allow';chunk(allowed?'·已执行':'·被拒绝');send({id:promptId,result:{stopReason:cancelled?'cancelled':'end_turn'}});};
   send({id,method:'session/request_permission',params:{sessionId:session,toolCall:{toolCallId:'t1',title:'ls -la',kind:'execute',rawInput:{command:'ls -la'}},options:[{optionId:'allow',name:'Allow once',kind:'allow_once'},{optionId:'always',name:'Always',kind:'allow_always'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}});return;}
  chunk('·完成');return send({id:promptId,result:{stopReason:'end_turn'}});}
 if(m.id!==undefined&&!m.method&&waiting){const w=waiting;waiting=null;fs.writeFileSync(process.env.FAKE_ACP_ANSWER||'/dev/null',JSON.stringify(m.result));return w(m.result);}
 if(m.id!==undefined&&m.method)send({id:m.id,error:{code:-32601,message:'nope'}});
}
