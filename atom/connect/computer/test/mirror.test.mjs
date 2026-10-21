import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as e2e from '../e2e.mjs';

test('mirror decrypts only a confirmed paired snapshot, then sends it only to the local simulator',async()=>{
 const seen=[];const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;seen.push({path:req.url,origin:req.headers.origin,body:JSON.parse(body)});res.end('{"pending":"test"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 process.env.ATOM_SIMULATOR_ORIGIN='http://127.0.0.1:'+server.address().port;
 const {mirrorDevice}=await import('../simulator.mjs');
 const key=Buffer.alloc(32,7),data={'atom.app.v1.demo':'{"score":42}'},version='a'.repeat(64);
 const c={relayState:{paired:[{client_id:'device'}]},pairings:{device:{state:'on',key}},request:async path=>{assert.equal(path,'/v1/device/snapshot/device');return {version,envelope:e2e.sealJSON(key,data,'snapshot|device|'+version),updated:1};}};
 try{
  await assert.rejects(mirrorDevice(c,'device'),/确认/);
  await assert.rejects(mirrorDevice(c,'stranger',{confirm:true}),/配对/);
  const result=await mirrorDevice(c,'device',{confirm:true});assert.equal(result.version,version);
  assert.deepEqual(seen,[{path:'/api/device-data/preview',origin:process.env.ATOM_SIMULATOR_ORIGIN,body:{data}}]);
 }finally{await new Promise(r=>server.close(r));}
});
