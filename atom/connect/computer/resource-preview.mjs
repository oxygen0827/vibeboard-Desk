import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {previewHTML} from './preview.mjs';

const MAX_ARCHIVE=64*1024*1024,MAX_MEMORY=192*1024*1024,TTL=10*60*1000;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const mime=name=>({'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.wasm':'application/wasm','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.mp4':'video/mp4','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.txt':'text/plain'}[path.extname(name).toLowerCase()]||'application/octet-stream');
const validPath=name=>typeof name==='string'&&name.length<512&&!/[\\\x00-\x1f:#?]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
export async function unpackArchive(bytes){
 const bundled=fileURLToPath(new URL('../runtime/python/bin/python3',import.meta.url));
 const python=fs.existsSync(bundled)?bundled:process.env.ATOM_TEST_PYTHON||'python3';
 return new Promise((resolve,reject)=>{
  const child=execFile(python,['-I','-B',fileURLToPath(new URL('./preview-archive.py',import.meta.url))],{timeout:30000,maxBuffer:140*1024*1024},(err,stdout)=>{
   if(err)return reject(error('资源包暂时无法打开，请重新下载预览。'));
   try{const value=JSON.parse(stdout);value.files=Object.fromEntries(Object.entries(value.files).map(([name,data])=>[name,Buffer.from(data,'base64')]));resolve(value);}catch{reject(error('资源包格式无效。'));}
  });child.stdin.on('error',()=>{});child.stdin.end(bytes);
 });
}
export class ResourcePreviews{
 constructor({transport=fetch,unpack=unpackArchive,clock=Date.now}={}){this.transport=transport;this.unpack=unpack;this.clock=clock;this.items=new Map();this.pending=new Map();}
 prune(){for(const [id,item]of this.items)if(this.clock()-item.used>TTL)this.items.delete(id);}
 add(bundle){
  this.prune();const files=new Map(),manifest=bundle.manifest||{};let size=0;
  for(const [name,value]of Object.entries(bundle.files||{})){
   if(!validPath(name)||!(typeof value==='string'||Buffer.isBuffer(value)))throw error('预览资源路径无效。');
   const data=Buffer.isBuffer(value)?value:Buffer.from(value);size+=data.length;files.set(name,data);
  }
  if(!files.has('index.html')||size>96*1024*1024)throw error('预览资源缺少入口或超过大小限制。');
  while(this.items.size&&(this.items.size>=4||size+[...this.items.values()].reduce((n,v)=>n+v.size,0)>MAX_MEMORY))this.items.delete(this.items.keys().next().value);
  const id=crypto.randomUUID();this.items.set(id,{manifest,files,size,used:this.clock()});return {url:'/api/studio/interactive/'+id+'/index.html'};
 }
 release(url){const match=/^\/api\/studio\/interactive\/([a-f0-9-]+)\/index\.html$/.exec(String(url));if(match)this.items.delete(match[1]);}
 async library(studio,id){
  if(typeof id!=='string'||! /^[a-z][a-z0-9_-]{0,47}$/.test(id))throw error('请选择有效的应用。');
  const base=studio.url(),key=base+'|'+id;
  if(!this.pending.has(key)&&this.pending.size>=4)throw error('还有预览资源正在准备，请稍后重试。',429);
  if(!this.pending.has(key))this.pending.set(key,this.download(studio,id,base).finally(()=>this.pending.delete(key)));
  const bundle=await this.pending.get(key);if(studio.url()!==base)throw error('服务器已切换，请重新打开应用。',409);
  return this.add(bundle);
 }
 async download(studio,id,base){
  const catalog=await studio.handle('GET','/catalog?');
  const app=(catalog.library||[]).find(a=>a.id===id);
  if(!app||!/^\/atom\/assets\/library\/[a-z][a-z0-9_-]{0,47}-[a-f0-9]{16}\.zip$/.test(app.archive||'')||! /^[a-f0-9]{64}$/.test(app.sha256||''))throw error('应用资源不在当前市场目录中。',404);
  const url=new URL(app.archive,base);
  if(url.protocol!=='https:'||url.origin!==new URL(base).origin)throw error('应用资源地址无效。');
  if(!Number.isSafeInteger(app.archive_bytes)||app.archive_bytes<=0||app.archive_bytes>MAX_ARCHIVE)throw error('应用资源包超过预览限制。');
  // Source archives are public. Never send account tokens, cookies or local paths.
  const response=await this.transport(url,{redirect:'error',signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw error('资源下载失败，请稍后重试。',502);
  const chunks=[];let total=0;
  for await(const chunk of response.body){total+=chunk.length;if(total>app.archive_bytes||total>MAX_ARCHIVE)throw error('资源包大小与目录不一致。');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  if(total!==app.archive_bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==app.sha256)throw error('资源校验失败，请刷新市场后重试。');
  const bundle=await this.unpack(bytes);if(bundle.manifest.id!==id)throw error('资源包与应用不匹配。');return bundle;
 }
 serve(req,res,url,origin){
  const match=/^\/api\/studio\/interactive\/([a-f0-9-]+)\/(.+)$/.exec(url.pathname);if(!match)return false;
  this.prune();const item=this.items.get(match[1]);let name;try{name=decodeURIComponent(match[2]);}catch{}
  const sendError=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(text);return true;};
  if(req.method!=='GET')return sendError(405,'Read-only preview');
  if(!item)return sendError(404,'Preview expired');
  if(!validPath(name))return sendError(404,'File not found');
  const file=item.files.get(name);if(!file)return sendError(404,'File not found');item.used=this.clock();
  const scope=origin+'/api/studio/interactive/'+match[1]+'/';
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cross-Origin-Resource-Policy','cross-origin');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()');
  res.setHeader('Content-Security-Policy',`sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: ${scope}; style-src 'unsafe-inline' ${scope}; img-src data: blob: ${scope}; font-src data: ${scope}; media-src data: blob: ${scope}; connect-src ${scope}; frame-src ${scope} blob:; worker-src blob: ${scope}; form-action 'none'; base-uri 'none'; object-src 'none'`);
  const type=mime(name);res.writeHead(200,{'Content-Type':type});
  if(type.startsWith('text/html')){
   const input=JSON.parse(fs.readFileSync(new URL('./community-input.json',import.meta.url),'utf8'));
   const html=previewHTML({manifest:item.manifest,files:{'index.html':file.toString('utf8')}});
   res.end(html.replace(/<head\b[^>]*>/i,m=>m+'<style>#atom-app-back.atom-back-fallback[data-atom-generated]{display:none!important}</style><script>'+input.replace(/<\/script/gi,'<\\/script')+'</script>'));
  }else res.end(file);
  return true;
 }
}
