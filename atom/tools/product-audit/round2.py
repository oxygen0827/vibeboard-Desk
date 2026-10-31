from pathlib import Path
import json
W=Path('/tmp/atom-product-audit/working')
ids=['water-pool','volume-flow','moon-ocean','planetarium','parametric-maker','physics-playground','rhythm-orbits','particle-lab','model-viewer']
for id in ids:
 p=W/id;(p/'scene-controls.js').write_text(Path('atom/tools/product-audit/scene-controls.js').read_text());f=p/'index.html';s=f.read_text().replace('<script src="scene-session.js"></script>','<script src="scene-session.js"></script><script src="scene-controls.js"></script>');f.write_text(s)
def append(id,name,code):
 p=W/id/name;p.write_text(p.read_text()+'\n'+code+'\n')
def replace(id,name,old,new):
 p=W/id/name;s=p.read_text();assert old in s,(id,old[:50]);p.write_text(s.replace(old,new))
for id in ['model-viewer','planetarium']:
 append(id,'main.js',"AtomSceneControls.attach(AtomSceneControls.orbit("+("viz.getViewer().get3jsCamera()" if id=='planetarium' else 'camera')+",controls),'调整视角');")
replace('parametric-maker','main.js','generate();tick();',"generate();tick();AtomSceneControls.attach(AtomSceneControls.orbit(camera,controls),'调整视角');")
replace('moon-ocean','index.html','\t\t\trender();',"\t\t\trender();AtomSceneControls.attach(AtomSceneControls.orbit(DEMO.ms_Camera,DEMO.ms_Controls),'调整视角');AtomSceneSession.onStop(function(){DEMO.ms_Controls.dispose && DEMO.ms_Controls.dispose();DEMO.ms_Renderer.dispose && DEMO.ms_Renderer.dispose();});")
replace('volume-flow','flow.js','var recomputeViewMatrix = function () {',"this.orbit=function(x,y){azimuth+=x;elevation=Math.max(MIN_ELEVATION,Math.min(MAX_ELEVATION,elevation+y));recomputeViewMatrix();};\n    var recomputeViewMatrix = function () {")
replace('volume-flow','flow.js','var camera = new Camera(canvas);','var camera = new Camera(canvas);this.orbit=function(x,y){camera.orbit(x,y);};')
append('volume-flow','main.js',"AtomSceneControls.attach([['向左环绕',()=>flow.orbit(-.2,0)],['向右环绕',()=>flow.orbit(.2,0)],['俯视一点',()=>flow.orbit(0,.15)],['仰视一点',()=>flow.orbit(0,-.15)]],'调整视角');")
append('water-pool','main.js',"window.addEventListener('load',function(){AtomSceneControls.attach([['向左环绕',()=>{angleY-=15;draw()}],['向右环绕',()=>{angleY+=15;draw()}],['俯视一点',()=>{angleX=Math.max(-80,angleX-10);draw()}],['仰视一点',()=>{angleX=Math.min(-5,angleX+10);draw()}],['球向左',()=>{center.x=Math.max(-.7,center.x-.2);draw()}],['球向右',()=>{center.x=Math.min(.7,center.x+.2);draw()}]],'移动球与视角');AtomSceneSession.onStop(function(){var ext=gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext()});});")
replace('particle-lab','index.html','resize();window.addEventListener',"AtomSceneControls.attach([['引力左上',()=>target={x:w*.2,y:h*.2}],['引力上方',()=>target={x:w*.5,y:h*.2}],['引力右上',()=>target={x:w*.8,y:h*.2}],['引力左侧',()=>target={x:w*.2,y:h*.5}],['引力居中',()=>target={x:w*.5,y:h*.5}],['引力右侧',()=>target={x:w*.8,y:h*.5}],['引力左下',()=>target={x:w*.2,y:h*.8}],['引力下方',()=>target={x:w*.5,y:h*.8}],['引力右下',()=>target={x:w*.8,y:h*.8}]],'引力位置');resize();window.addEventListener")
replace('particle-lab','index.html','移动鼠标改变引力中心 · 帧率是当前实测值','场景操作可移动引力中心 · 帧率为实测值')
replace('particle-lab','index.html','<h1 class="grow">','<h1 class="grow" style="padding-left:44px;font-size:18px">')
append('physics-playground','main.js',"AtomSceneControls.attach([['左侧落物',()=>spawn(110,95)],['中间落物',()=>spawn(240,95)],['右侧落物',()=>spawn(370,95)],['推倒骨牌',()=>{setup('domino');M.Body.setAngularVelocity(M.Composite.allBodies(world)[3],.15)}],['弹弓发射',()=>{setup('sling');M.Composite.remove(world,elastic);elastic=null;M.Body.setVelocity(shot,{x:12,y:-6});launched=true}],['拉动桥板',()=>{if(mode!=='bridge')setup('bridge');var b=M.Composite.allBodies(world).filter(b=>!b.isStatic)[6];if(b)M.Body.setVelocity(b,{x:0,y:6})}]],'实验操作');")
replace('rhythm-orbits','main.js','readout();window.rhythmOrbits=',"readout();AtomSceneControls.attach(voices.map((v,i)=>[v.name,()=>{selected=i;readout()}]),'选择轨道');window.rhythmOrbits=")
# Existing settings panel: nested back closes settings before leaving; shared runtime owns focus.
replace('robo-face','common.js',"let panel=document.getElementById('panel');", "let panel=document.getElementById('panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','眼睛设置');if(window.AtomApp)AtomApp.navigation.setBackHandler(()=>{if(!panel.hidden){panel.hidden=true;if(window.AtomInput)AtomInput.focus(document.getElementById('menu'))}else AtomApp.home()});")
replace('robo-face','index.html','控制会自动隐藏 · 空格键返回桌面','方向键选择 · 短按确认 · 左上角逐层返回')
replace('robo-face','index.html','<meta charset="utf-8"><script','<meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><script')
replace('robo-face','main.js',"let bytes=await", "let bytes=await") # Own async completion must not restart after suspend.
replace('robo-face','main.js','m.__wasm_call_ctors();','if(!AtomSceneSession.active)return;m.__wasm_call_ctors();')
# Input declaration is scoped to the reviewed, explicitly adapted applications above.
for id in ids+['robo-face','music-vision','pocket-studio']:
 p=W/id/'manifest.json';s=json.loads(p.read_text());s['input']={'version':1,'profile':'five-way','back':'custom' if id in ids+['robo-face'] else 'root','scene':'controls'};s['theme_ui']='controls';p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
print('Added explicit scene actions and nested navigation to reviewed apps')
