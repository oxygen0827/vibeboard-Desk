import fs from 'node:fs';
import path from 'node:path';
export function writePrivate(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,file);}
export class Store {
 constructor(dir){this.file=path.join(dir,'state.json');try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.data={projects:[],tasks:{},outbox:[],commands:[],sessions:{}};this.save();}}
 save(){writePrivate(this.file,this.data);}
 event(task,type,body){const event={event_id:crypto.randomUUID(),type,...body};this.data.outbox.push({task_id:task.id,event});if(body.status)task.status=body.status;this.save();return event;}
}
export function relayURL(input){const u=new URL(input);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('请输入服务器根地址');if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('服务器必须使用 HTTPS');return u.origin;}
