const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('storage acknowledgements wait for persistence and stay bound to the original frame',async()=>{
 let listener,complete,fail,messages=[];
 const context={window:null,TextEncoder,JSON,Error,setTimeout,clearTimeout,addEventListener:(t,f)=>listener=f,removeEventListener(){}};context.window=context;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../static/app-host.js'),'utf8'),context);
 const host=context.AtomAppHost({read:()=>null,write:()=>new Promise((r,j)=>{complete=r;fail=j;}),onStatus(){}});
 const frame={isConnected:true,contentWindow:{postMessage:m=>messages.push(m)}};
 const send=id=>listener({source:frame.contentWindow,data:{type:'atom:storage',action:'set',request_id:id,data:{n:1}}});
 host.begin(frame,'test');send('1');assert.equal(messages.length,0);complete(true);await new Promise(r=>setImmediate(r));assert.equal(messages[0].ok,true);
 send('2');fail(Error('disk unavailable'));await new Promise(r=>setImmediate(r));assert.equal(messages.at(-1).ok,false);
 send('3');host.end();const count=messages.length;complete(true);await new Promise(r=>setImmediate(r));assert.equal(messages.length,count);
 host.destroy();
});
