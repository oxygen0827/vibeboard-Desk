import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Companion} from './companion.mjs';
import {previewHTML,previewCSP} from './preview.mjs';
export function dashboard(companion,{port=8788}={}){
 const session=crypto.randomUUID(),csrf=crypto.randomUUID();let origin;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  if(req.headers.host!==new URL(origin).host)return send(403,{error:'本地地址无效'});
  const url=new URL(req.url,origin);
  if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Set-Cookie','atom_connect='+session+'; HttpOnly; SameSite=Strict; Path=/');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(new URL('./dashboard.html',import.meta.url),'utf8'));}
  if(req.method==='GET'&&url.pathname==='/studio.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(new URL('./studio.js',import.meta.url)));}
  if(req.method==='GET'&&url.pathname==='/dashboard.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(new URL('./dashboard.js',import.meta.url)));}
  if(req.method==='GET'&&url.pathname==='/dashboard.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(fs.readFileSync(new URL('./dashboard.css',import.meta.url)));}
  if(!(req.headers.cookie||'').split(';').some(c=>c.trim()==='atom_connect='+session))return send(401,{error:'请从本地控制台首页打开'});
  if(req.method==='GET'&&/^\/api\/studio\/previews\/[A-Za-z0-9_-]+$/.test(url.pathname)){try{const draftId=url.pathname.split('/').pop();const value=companion.studio.workspaceView(draftId);res.setHeader('Content-Security-Policy',previewCSP);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(previewHTML(value.bundle));}catch(e){return send(e.status||400,{error:e.message});}}
  if(req.method==='GET'&&url.pathname.startsWith('/api/studio/')){try{return send(200,await companion.studio.handle('GET',url.pathname.slice('/api/studio'.length)+url.search));}catch(e){return send(e.status||400,{error:e.message,code:e.code,...(e.status===409?{conflict:e.details}: {})});}}
  if(req.method==='GET'&&url.pathname==='/api/state')return send(200,{...companion.state(),csrf});
  if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-atom-csrf']!==csrf||!String(req.headers['content-type']).startsWith('application/json'))return send(403,{error:'请求来源无效'});
  let text='';try{for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>(url.pathname.startsWith('/api/studio/')?2*1024*1024:32768))return send(413,{error:'请求过大'});}const body=JSON.parse(text||'{}');let result={ok:true};
   if(url.pathname.startsWith('/api/studio/'))result=await companion.studio.handle('POST',url.pathname.slice('/api/studio'.length),body);
   else if(url.pathname==='/api/configure')await companion.configure(body);
   else if(url.pathname==='/api/projects')result=companion.addProject(body);
   else if(url.pathname==='/api/projects/remove')companion.removeProject(body.id);
   else if(url.pathname==='/api/pair')result=await companion.request('/v1/pair/claim',{code:String(body.code||'').trim()});
   else if(url.pathname==='/api/unpair'){result=await companion.request('/v1/pair/remove',{client_id:String(body.client_id||'')});companion.relayState=await companion.request('/v1/state');}
   else if(url.pathname==='/api/diagnostics')result={agents:await companion.diagnose()};
   else return send(404,{error:'接口不存在'});
   send(200,result);
  }catch(e){send(e.status||400,{code:e.code,...(e.status===409?{conflict:e.details}:{}),error:['ENOENT','EACCES'].includes(e.code)?'无法访问所选目录':e.message||'操作失败'});}
 });
 return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;resolve({server,origin});}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const value=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
 const c=new Companion(value('--state-dir',path.join(os.homedir(),'.atom-connect')));const {server,origin}=await dashboard(c,{port:Number(value('--port','8788'))});console.log('ATOM Connect 本地控制台：'+origin);void c.run();for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{c.stop();server.close();setTimeout(()=>process.exit(0),1000).unref();});
}
