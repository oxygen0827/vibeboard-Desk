/* Capture real application UI with empty/demo state. No account, model or device access. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium,executablePath}=require('./browser-test-runtime.cjs');
const atom=path.resolve(__dirname,'..'),out=path.join(atom,'artifacts/market-covers');
const dirs={'photo-album':'official/photo-album','today':'official/today','my-computer':'computer-app','quick-notes':'notes-app','market':'market-app','robot':'robot-app','material-world':'ports/material-world'};
const catalog=JSON.parse(fs.readFileSync(path.join(atom,'site/assets/apps/catalog.json'))).apps.filter(x=>x.market_id);
const works=catalog.map((a,i)=>({id:a.market_id,title:a.name,description:a.description,author:'ATOM',category:'life',license:'MIT',cover_id:a.image?(i+1).toString(16).padStart(32,'0'):null}));
const sdk="window.AtomApp={deferReady(){},ready(){window.appReady=true},load:async d=>d,save:async()=>({mode:'preview'}),onSuspend(){}};";
const mime=f=>f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':f.endsWith('.svg')?'image/svg+xml':f.endsWith('.wasm')?'application/wasm':'text/html';
(async()=>{fs.mkdirSync(out,{recursive:true});const b=await chromium.launch({headless:true,executablePath,args:['--use-gl=angle','--use-angle=swiftshader']});try{
 const themes=JSON.parse(execFileSync('python3',['-c','import sys,json;sys.path.insert(0,"atom");import themes;print(json.dumps(themes.BUILTINS))'],{encoding:'utf8',cwd:path.dirname(atom)}));
 for(const id of [...Object.keys(dirs),'workshop','clock','timer']){
  const p=await b.newPage({viewport:{width:480,height:360}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(sdk);
  await p.exposeFunction('fixtureRPC',async m=>{
   if(m.type==='atom:photos'){if(m.action==='state')return {user:{id:'demo',username:'演示'},generation_enabled:false,styles:[]};if(m.action==='list')return {items:[],pages:0,total:0};return {jobs:[]};}
   if(m.action==='state')return m.type==='atom:connect'?{configured:false,paired:[],tasks:[],config:{relay_url:'',name:'ATOM'}}:{configured:true,authenticated:true,user:{id:'demo',username:'演示'},encryption:'on'};
   if(m.action==='catalog')return {works};
   if(m.action==='cover'){const app=catalog[Number.parseInt(m.data.cover_id,16)-1];if(!app?.image)return {};const file=path.join(atom,'site',app.image.slice('/atom/'.length));return {image:'data:image/jpeg;base64,'+execFileSync(process.env.ATOM_IMAGE_PYTHON||'python3',['-c','from PIL import Image;import io,base64,sys;i=Image.open(sys.argv[1]).convert("RGB");o=io.BytesIO();i.save(o,"JPEG");print(base64.b64encode(o.getvalue()).decode())',file],{encoding:'utf8'}).trim()};}
   return {notes:[],items:[],drafts:[],jobs:[]};
  });
  await p.route('http://capture.test/**',async r=>{const u=new URL(r.request().url());if(u.pathname==='/wrapper'){return r.fulfill({contentType:'text/html',body:'<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe src="/app/index.html"></iframe><script>addEventListener("message",async e=>{const m=e.data;if(!["atom:market","atom:photos","atom:connect","atom:robot"].includes(m?.type))return;const result=await fixtureRPC(m);e.source.postMessage({type:m.type+"-result",id:m.id,result},"*")})</script>'});}
   if(u.pathname.startsWith('/api/')){let data={};if(u.pathname==='/api/themes')data={active:'system',themes};if(u.pathname==='/api/apps')data={apps:[]};if(u.pathname==='/api/connect/state')data={configured:false,paired:[]};if(u.pathname==='/api/status')data={network:{connected:false}};return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});}
   const f=u.pathname.startsWith('/app/')?path.join(atom,dirs[id],u.pathname.slice(5)):path.join(atom,'static',u.pathname==='/'?'index.html':u.pathname);
   if(!fs.existsSync(f))return r.fulfill({status:404,body:''});return r.fulfill({contentType:mime(f),body:fs.readFileSync(f)});
  });
  await p.goto('http://capture.test/'+(dirs[id]?'wrapper':''));
  if(!dirs[id]){await p.locator('[data-app=workshop]').waitFor();await p.evaluate(id=>{const button=document.querySelector('[data-app="'+id+'"]');if(button)button.click();else{const proxy=document.createElement('button');proxy.dataset.app=id;document.querySelector('#main').append(proxy);proxy.click();}},id);await p.waitForFunction(id=>document.body.dataset.view===id,id);}
  else if(id==='material-world'){await p.frames()[1].waitForFunction(()=>window.atomMaterial);}
  await p.waitForTimeout(!dirs[id]?3600:id==='market'?1600:600);await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:path.join(out,id+'.png')});console.log(id,errors.length?errors: 'captured');await p.close();
 }
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
