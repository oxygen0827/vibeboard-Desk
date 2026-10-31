import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Companion} from '../companion.mjs';
import {Studio} from '../studio.mjs';
import * as e2e from '../e2e.mjs';
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atom-private-sync-'));
 const companion=new Companion(dir),studio=companion.studio;
 companion.store.data.config={relay_url:'http://127.0.0.1:19441',token:'fixture-computer',client_id:'c'};
 const key=crypto.randomBytes(32);
 studio.data.account={relay_url:studio.url(),token:'fixture-a',user:{id:'alice'},data_key:e2e.b64(key),key_id:'a'};
 studio.profile();studio.save();
 return {studio,companion,key,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const specs=[{route:'/notes',pending:'pending',items:'notes',list:'notes',field:'note',sync:'syncNotes',load:'notes',save:'saveNote',content:{text:'private note'}},
 {route:'/agenda',pending:'agenda_pending',items:'agenda',list:'items',field:'item',sync:'syncAgenda',load:'agenda',save:'saveAgenda',content:{title:'private agenda',kind:'todo',starts_at:''}}];
for(const spec of specs){
 for(const change of ['account','server','logout'])test(`${spec.route}: ${change} during sync preserves old queue and sends nothing more`,async()=>{
  const f=fixture(),s=f.studio;try{
   const profile=s.profile();profile[spec.pending]=[1,2].map(n=>({[spec.field]:{id:'n'+n,...spec.content}}));
   let release;const requests=[];
   s.transport=async(url,options)=>{requests.push({url,options});const body=JSON.parse(options.body);return new Promise(r=>release=()=>r(Response.json({[spec.field]:{...body,revision:1}})));};
   const syncing=s[spec.sync]();await new Promise(r=>setImmediate(r));
   if(change==='account')s.data.account={...s.data.account,token:'fixture-b',user:{id:'bob'}};
   if(change==='server')f.companion.store.data.config.relay_url='https://other.example';
   if(change==='logout')s.data.account=null;
   release();await assert.rejects(syncing,e=>e.code==='account_changed');
   assert.equal(requests.length,1);assert.equal(profile[spec.pending].length,2);
   assert(profile[spec.pending].every(edit=>!edit.conflict));
  }finally{f.close();}
 });
 test(`${spec.route}: decryption failure preserves ciphertext/cache and blocks writes across restart until valid retry`,async()=>{
  const f=fixture(),s=f.studio;try{
   const uid='alice',prefix=spec.route==='/notes'?'note':'agenda',good={id:'n',revision:4,key_id:'a',enc:e2e.sealJSON(f.key,spec.content,`${prefix}|${uid}|n`)};
   const bad={...good,enc:{...good.enc,ct:'invalid'}},original=structuredClone(bad);
   assert.throws(()=>s.revealPrivate(spec.route,bad,f.key,uid),e=>e.code==='decryption_failed');
   assert.deepEqual(bad,original);
   s.profile()[spec.items]=[{id:'n',revision:3,...spec.content}];s.save();
   let corrupt=true,posts=0;
   const transport=async(url,options)=>{
    if(options.method==='POST'){posts++;const body=JSON.parse(options.body);return Response.json({[spec.field]:{...body,revision:5}});}
    return Response.json({[spec.list]:[corrupt?bad:good]});
   };
   s.transport=transport;
   await assert.rejects(s[spec.load](),e=>e.code==='decryption_failed');
   assert.deepEqual(s.profile()[spec.items],[{id:'n',revision:3,...spec.content}]);
   await assert.rejects(s[spec.save]({id:'n',...spec.content}),e=>e.code==='decryption_failed');
   const restarted=new Studio(f.companion,{transport});
   await assert.rejects(restarted[spec.save]({id:'n',...spec.content}),e=>e.code==='decryption_failed');
   assert.equal(posts,0);
   corrupt=false;await restarted[spec.load]();
   await restarted[spec.save]({id:'n',...spec.content});assert.equal(posts,1);
  }finally{f.close();}
 });
 test(`${spec.route}: delayed list cannot overwrite old account cache after switch`,async()=>{
  const f=fixture(),s=f.studio;try{
   const old=s.profile();old[spec.items]=[{id:'old',...spec.content}];let release;
   s.transport=async()=>new Promise(r=>release=()=>r(Response.json({[spec.list]:[]})));
   const loading=s[spec.load]();await new Promise(r=>setImmediate(r));
   s.data.account={...s.data.account,token:'fixture-b',user:{id:'bob'}};
   release();await assert.rejects(loading,e=>e.code==='account_changed');assert.equal(old[spec.items].length,1);
  }finally{f.close();}
 });
}

test('legacy encryption migration stops at account change without sending remaining records',async()=>{
 const f=fixture(),s=f.studio;try{
  let release,posts=0;
  s.transport=async(url,options)=>{
   if(options.method==='GET')return Response.json({notes:[{id:'n1',text:'old one'},{id:'n2',text:'old two'}]});
   posts++;return new Promise(r=>release=()=>r(Response.json({ok:true})));
  };
  const migration=s.migrate(f.key,'a');await new Promise(r=>setImmediate(r));
  s.data.account={...s.data.account,token:'fixture-b',user:{id:'bob'}};
  release();await assert.rejects(migration,e=>e.code==='account_changed');assert.equal(posts,1);
 }finally{f.close();}
});

test('unreadable encrypted conflict never replaces pending text with a placeholder',async()=>{
 const f=fixture(),s=f.studio;try{
  const profile=s.profile();profile.pending=[{note:{id:'n',text:'local original',revision:1}}];
  s.transport=async()=>Response.json({error:'conflict',current:{id:'n',revision:2,enc:{v:1,iv:'invalid',ct:'invalid'}}},{status:409});
  await assert.rejects(s.syncNotes(),e=>e.code==='decryption_failed');
  assert.equal(profile.pending[0].note.text,'local original');assert.equal(profile.pending[0].conflict,undefined);
  assert.equal(profile.private_errors['/notes'],true);
 }finally{f.close();}
});
