import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ResourcePreviews,unpackArchive} from '../resource-preview.mjs';
import {dashboard} from '../main.mjs';
const manifest={id:'scene',name:'Scene',entry:'index.html',description:'A preview',icon:'icon.svg'};
const files={'index.html':'<html><head></head><body><script src="assets/app.js"></script></body></html>','assets/app.js':'window.loaded=true','assets/picture.png':Buffer.from([137,80,78,71])};
function archive(extra={}){return execFileSync(process.env.ATOM_TEST_PYTHON||'python3',['-c',`import io,json,zipfile,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for k,v in json.loads(sys.argv[1]).items():z.writestr(k,v)
sys.stdout.buffer.write(b.getvalue())`,JSON.stringify({'scene/manifest.json':JSON.stringify(manifest),'scene/index.html':'<html>Preview</html>','scene/assets/data.json':'{"value":7}',...extra})]);}
test('archives retain full resources and reject traversal and multiple roots',async()=>{
 const bundle=await unpackArchive(archive());assert.equal(bundle.manifest.id,'scene');assert.equal(bundle.files['assets/data.json'].toString(),'{"value":7}');
 for(const name of ['scene/../escape','other/payload','scene/a/../../b','scene/x\\y'])await assert.rejects(unpackArchive(archive({[name]:'bad'})));
});
test('archive downloads use authoritative metadata, validate digest, never forward credentials',async()=>{
 const bytes=archive(),app={id:'scene',archive:'/atom/assets/library/scene-aaaaaaaaaaaaaaaa.zip',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),archive_bytes:bytes.length};
 let request;const store=new ResourcePreviews({transport:async(url,options)=>{request={url:String(url),options};return new Response(bytes);}}),studio={url:()=> 'https://example.com/atom',handle:async()=>({library:[app]})};
 const result=await store.library(studio,'scene');assert(result.url.endsWith('/index.html'));assert.equal(request.options.headers,undefined);assert.equal(request.options.redirect,'error');assert.equal(request.url,'https://example.com'+app.archive);
 await assert.rejects(store.library(studio,'../../state'));
 app.sha256='0'.repeat(64);await assert.rejects(store.library(studio,'scene'),/校验/);
 app.archive='https://attacker.invalid/archive.zip';await assert.rejects(store.library(studio,'scene'),/市场目录/);
});
test('preview files are capability scoped, binary intact, cannot read host API, expire and release',async()=>{
 let clock=0;const previews=new ResourcePreviews({clock:()=>clock});
 const {server,origin}=await dashboard({state:()=>({})},{port:0,resourcePreviews:previews});
 try{
  const {url}=previews.add({manifest,files}),base=url.replace('index.html','');
  const page=await fetch(origin+url),csp=page.headers.get('content-security-policy');assert.equal(page.status,200);assert(csp.includes('sandbox allow-scripts'));assert(!csp.includes('allow-same-origin'));assert(csp.includes('connect-src '+origin+base));assert(!csp.includes("connect-src 'self'"));assert((await page.text()).includes('assets/app.js'));
  const asset=await fetch(origin+base+'assets/picture.png');assert.equal(asset.headers.get('content-type'),'image/png');assert.equal(asset.headers.get('access-control-allow-origin'),'*');assert.deepEqual(Buffer.from(await asset.arrayBuffer()),files['assets/picture.png']);
  assert.equal((await fetch(origin+'/api/state')).status,401);
  assert.equal((await fetch(origin+base+'%2e%2e%2fstate.json')).status,404);
  previews.release(url);assert.equal((await fetch(origin+url)).status,404);
  const next=previews.add({manifest,files});clock=11*60*1000;assert.equal((await fetch(origin+next.url)).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
