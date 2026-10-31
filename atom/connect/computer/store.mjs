import fs from 'node:fs';
import path from 'node:path';
export function writePrivate(file,value){
 const content=JSON.stringify(value,null,2); // Fail serialization before creating files.
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);
  fs.writeFileSync(fd,content);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  fs.renameSync(tmp,file);
  // Rename is atomic, but its directory entry also needs to survive a power loss.
  if(process.platform!=='win32'){
   const parent=fs.openSync(dir,'r');
   try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  }
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  fs.rmSync(tmp,{force:true});
 }
}
export class Store {
 constructor(dir){this.file=path.join(dir,'state.json');try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.data={projects:[],tasks:{},outbox:[],commands:[],sessions:{}};this.save();}}
 save(){writePrivate(this.file,this.data);}
 event(task,type,body){const event={event_id:crypto.randomUUID(),type,...body};this.data.outbox.push({task_id:task.id,event});if(body.status)task.status=body.status;this.save();return event;}
}
export function relayURL(input){const raw=String(input).trim(),u=new URL(raw);if(u.username||u.password||u.search||u.hash||raw.includes('?')||raw.includes('#')||/\/\.{1,2}(\/|$)/.test(raw)||/%2f|%5c|\\/i.test(u.pathname)||!/^(\/[A-Za-z0-9._~-]+)*\/?$/.test(u.pathname))throw new Error('请输入服务器地址，可带路径前缀，不含凭据或参数');if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('服务器必须使用 HTTPS');return u.origin+u.pathname.replace(/\/+$/,'');}
