const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/request.js'),'utf8');
function client(fetch){const context={window:{},fetch,AbortController,setTimeout,clearTimeout,TypeError};vm.runInNewContext(source,context);return context.window.AtomRequest;}
test('invalid successful response is not treated as saved',async()=>{
 for(const value of [null,[],true])await assert.rejects(client(async()=>({ok:true,json:async()=>value}))('/api/save'),{code:'invalid_response'});
 await assert.rejects(client(async()=>({ok:true,status:200,json:async()=>{throw Error('html');}}))('/api/save'),{code:'invalid_response'});
});
test('timeout covers response body and does not retry a write',async()=>{
 let calls=0;const request=client(async(_,opts)=>{calls++;return {ok:true,json:()=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'AbortError'}))))};});
 await assert.rejects(request('/api/save',{method:'POST',timeoutMs:10}),{code:'request_timeout'});assert.equal(calls,1);
});
test('conflict metadata is preserved',async()=>{await assert.rejects(client(async()=>({ok:false,status:409,json:async()=>({error:'conflict',code:'revision',current:7})}))('/api/save'),e=>e.status===409&&e.current===7&&e.code==='revision');});
test('network failure is actionable and cancellation remains cancellation',async()=>{
 await assert.rejects(client(async()=>{throw new TypeError('Failed to fetch');})('/api/status'),{code:'network_error'});
 const controller=new AbortController();controller.abort();await assert.rejects(client(async(_,opts)=>{assert.ok(opts.signal.aborted);throw Object.assign(Error(),{name:'AbortError'});})('/api/status',{signal:controller.signal}),{name:'AbortError'});
});
