#!/usr/bin/env node
// Minimal Pi RPC peer for tests. Records its argv; FAKE_PI_MODE: ok | hang (runs until aborted).
import fs from 'node:fs';
if(process.env.FAKE_PI_ARGS)fs.writeFileSync(process.env.FAKE_PI_ARGS,JSON.stringify(process.argv.slice(2)));
const mode=process.env.FAKE_PI_MODE||'ok';let buf='';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(line.trim())handle(JSON.parse(line));}});
function handle(m){
 if(m.type==='get_state')return send({id:m.id,type:'response',command:'get_state',success:true,data:mode==='no-model'?{}:{model:{id:'fake',provider:'test'}}});
 if(m.type==='get_available_models')return send({id:m.id,type:'response',success:true,data:{models:mode==='no-model'?[]:[{id:'fake',provider:'test'}]}});
 if(m.type==='abort'){send({type:'agent_settled',aborted:true});return send({id:m.id,type:'response',command:'abort',success:true});}
 if(m.type==='prompt'){
  if(mode==='handled')return send({id:m.id,type:'response',success:true,data:{disposition:'handled'}});
  if(mode==='failure'){send({id:m.id,type:'response',success:true});send({type:'message_end',message:{role:'assistant',content:[],stopReason:'error'}});return send({type:'agent_settled',aborted:false});}
  send({id:m.id,type:'response',command:'prompt',success:true,data:{disposition:'started'}});send({type:'agent_start'});send({type:'message_start',message:{role:'assistant'}});
  send({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'读到 '}});send({type:'tool_execution_start',toolCallId:'1',toolName:'read',args:{}});
  if(mode==='hang')return;
  send({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'两份资料'}});send({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'读到 两份资料'}]}});send({type:'agent_end',messages:[]});send({type:'agent_settled',aborted:false});}
}
