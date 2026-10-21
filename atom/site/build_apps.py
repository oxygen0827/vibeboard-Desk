"""Build public, reviewed application metadata. Never copies runtime state or credentials."""
from pathlib import Path
import json,sys,shutil,html
ROOT=Path(__file__).resolve().parents[1]; SITE=ROOT/'site'
sys.path.insert(0,str(ROOT))
from app_icons import validate_svg,theme_glyph,GLYPHS
catalog=json.loads((ROOT/'official/catalog.json').read_text())
retired=set(catalog['retired'])
CATS={'create':'AI 与创作','visual':'光影与陪伴','sound':'声音与音乐','life':'日常与记录','science':'科学与造物','connect':'连接与工具'}
# Editorial descriptions explain actual behaviour, not roadmap promises.
metadata={
'language-alchemy':('create','用一句话生成 GPU 材质，移动鼠标改变光纹，保存喜欢的作品。','language-alchemy.png','需要联网与模型服务'),
'symbiotic-world':('create','改变建筑、天气与小物件，亲手搭建一座可以交互的小岛。','symbiotic-world.png','AI 创作需要联网与模型服务'),
'ai-duet':('sound','先弹奏几个音符，再让 AI 接下一句，保存你们一起做的旋律。','ai-duet.png','弹奏可在本机运行；AI 接奏需要模型'),
'agent-studio':('connect','用一间小工作室呈现真实电脑任务，关注进度、审批与作品。','agent-studio.png','需要配对电脑在线；截图任务为演示数据'),
'photo-album':('life','电脑导入照片，桌边全屏欣赏；支持收藏、同步和照片风格改写。',None,'同步需要联网；生图需配置并开通模型'),
'weather-window':('life','七种实拍天气风景，手选城市，温度与天气轻轻留在画面上。','ambient-apps/weather-480.png','天气需要联网；界面截图中的天气为示例数据'),
'clap-stage':('sound','点按或拍手找到速度，跟着木音、拍手与轻鼓练习自己的节奏。','ambient-apps/clap-480.png','本机运行；拍手定速需要麦克风与更新后的设备系统'),
'pixel-lab':('visual','绘制点阵生命、沙粒和涟漪，亲眼看看简单规则如何产生变化。','official-ui-refresh/pixel-lab.png','本机运行'),
'sound-lab':('sound','四轨十六步编排，调节速度与音量，保存自己的声音实验。','sound-lab.png','本机声音合成'),
'today':('life','把日程和待办放在桌边，与电脑工作台同步，离线也保留修改。','today.png','跨设备同步需要同一账号和网络'),
}
rows=[]
def icon_for(aid,path=None):
 if path and path.exists():s=path.read_text()
 else:
  glyph=GLYPHS.get(aid)
  basic={'clock':'<circle cx="32" cy="32" r="22"/><path d="M32 17v15l11 8"/>','timer':'<circle cx="32" cy="37" r="19"/><path d="M24 7h16M32 7v11M32 26v11l8 6"/>','workshop':'<path d="m12 48 6-17L43 6l14 14-25 25ZM18 31l14 14M12 48l-3 7 7-3M40 9l14 14"/>'}
  glyph=glyph or basic.get(aid)
  if not glyph:raise ValueError('Missing purpose icon: '+aid)
  s=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">{glyph}</svg>'
 s=theme_glyph(s);validate_svg(s)
 dest=SITE/'assets/apps'/f'{aid}.svg';dest.write_text(s);return '/atom/assets/apps/'+dest.name

def shot(name,aid):
 if not name:return None
 for base in [SITE/'assets',ROOT/'artifacts']:
  p=base/name
  if p.exists():
   if base==SITE/'assets':return '/atom/assets/'+name
   dst=SITE/'assets/apps'/f'{aid}.png';shutil.copyfile(p,dst);return '/atom/assets/apps/'+dst.name
 raise ValueError('Missing screenshot '+name)
def add(aid,name,category,desc,source=None,kind='market',image=None,needs='本机运行',path=None):
 rel=str(path.relative_to(ROOT))if path else None
 rows.append(dict(id=aid,name=name,category=category,description=desc,kind=kind,market_id='official-'+aid if kind=='market' else None,source=('https://github.com/wangqioo/vibeboard-Desk/'+('blob'if Path(source or rel).suffix else 'tree')+'/deploy/ldcx-public/atom/'+(source or rel)) if source or rel else None,icon=icon_for(aid,path/'icon.svg'if path else None),image=shot(image,aid),needs=needs,guide='/atom/guide/#'+('market' if kind=='market' else 'developer'if kind=='port'else 'desktop')))
for bundle in list((ROOT/'official').glob('*/bundle.json'))+[ROOT/p for p in ['experiences/visual/bundle.json','experiences/world/bundle.json','experiences/duet/bundle.json','experiences/agents/bundle.json']]:
 m=json.loads(bundle.read_text())['manifest'];aid=m['id']
 if aid in retired:continue
 cat,desc,img,needs=metadata.get(aid,('create',m.get('description',''),None,'以应用说明为准'))
 add(aid,m['name'],cat,desc,path=bundle.parent,image=img,needs=needs)
ports=[
('water-pool','visual','拨动水面、拖动球体，观察反射、折射与池底焦散。','showcase-water.png'),
('volume-flow','visual','数千颗粒子勾出流场，旋转、换色，观察光与体积。','showcase-flow.png'),
('moon-ocean','visual','FFT 波浪模拟，一键切换月夜、白昼、日落与风力。','showcase-ocean.png'),
('planetarium','science','环绕地球、木星和土星，观察球面纹理、大气与行星环。','showcase-planets.png'),
('robo-face','visual','会眨眼、会犯困的小眼睛，跟着鼠标转动视线。','showcase-eyes.png'),
('pocket-studio','sound','七轨十六步音序，旋律与鼓点合成，边播放边编排。','showcase-studio.png'),
('music-vision','sound','本地音频驱动 MilkDrop 视觉预设，让音乐有自己的画面。','music-vision.png'),
('rhythm-orbits','sound','三轨欧几里得节奏与本地合成器，把节拍排进轨道。','interiors/rhythm-orbits.png'),
('physics-playground','science','碰撞、多米诺、悬索桥和弹弓，拖动物体做小实验。','showcase-physics.png'),
('model-viewer','science','本地查看 STL / OBJ，旋转、缩放、线框与模型尺寸检查。','interiors/model-viewer.png'),
('math-playground','science','拖动参数点，探索复数分形、光线包络与三角几何。','showcase-math.png'),
('clay-studio','science','在三维表面堆土或凹起，转动视角，体验真正的网格雕刻。','interiors/clay-studio.png'),
('parametric-maker','science','调整尺寸、壁厚与模型类型，用布尔运算生成小物件。','interiors/parametric-maker.png'),
('circuit-lab','science','切换 RLC、整流与 555 电路，调整参数并观察波形。','showcase-circuit.png'),
('material-world','science','用沙、水、火、木等材料画一场实验，看真实规则产生反应。',None),
]
for aid,cat,desc,img in ports:
 path=ROOT/'ports'/aid;m=json.loads((path/'bundle.json').read_text())['manifest'];add(aid,m['name'],cat,desc,path=path,kind='port',image=img,needs='完整资源安装后本机运行；查看源码目录中的许可与边界')
add('particle-lab','粒子实验室','visual','操控粒子组成的画面，探索鼠标与动态光点之间的互动。',kind='device',image='particle-lab.png',needs='样机定制应用；独立源码包尚未收录官网')
add('local-music','随身唱片','sound','在小电脑上播放本地音乐，让桌边有自己的背景声。',kind='device',image='interiors/local-music.png',needs='样机定制应用；独立源码包尚未收录官网')
add('mic-test','麦克风测试','sound','录音、回放，观察音量、峰值和削波，比较真实收音效果。',path=ROOT/'mic-test',source='examples/mic-test.json',kind='system',image='interiors/mic-test.png',needs='需要设备麦克风；风扇控制受温度保护')
for aid,folder,cat,desc,img,needs in [
('my-computer','computer-app','connect','连接电脑 Agent，选择授权项目，发起任务并查看进度与审批。',None,'电脑任务需要配对电脑在线'),
('quick-notes','notes-app','life','随手记录想法，在电脑整理，在小电脑查看；离线修改保留。',None,'同步需要同一账号和网络'),
('market','market-app','create','发现带源码的作品，预览安装，基于原作改造并发布新版本。',None,'需要联网；安装与发布在客户端确认'),
('robot','robot-app','visual','长按说话，用表情和声音回应你的桌面语音伙伴。',None,'语音聊天需要麦克风、网络及已配置模型服务')]:
 m=json.loads((ROOT/folder/'manifest.json').read_text());add(aid,m['name'],cat,desc,path=ROOT/folder,kind='system',image=img,needs=needs)
for aid,name,cat,desc,img in [('workshop','工作坊','create','说出或输入想法，生成、预览，再确认安装一个属于自己的应用。',None),('clock','时钟','life','一眼看清现在的时间，让小电脑安静留在桌边。',None),('timer','计时器','life','设定一段时间，开始、暂停和重置，保持专注的节奏。',None)]:
 add(aid,name,cat,desc,source='static/app.js',kind='system',image=img,needs='工作坊生成需要有效模型服务'if aid=='workshop'else '本机运行')
priority=['language-alchemy','symbiotic-world','ai-duet','weather-window','clap-stage','photo-album','agent-studio','water-pool','moon-ocean','robo-face','pocket-studio','planetarium']
rows.sort(key=lambda r:priority.index(r['id'])if r['id']in priority else len(priority))
assert len({r['id'] for r in rows})==len(rows)
assert not retired.intersection(r['id']for r in rows)
payload={'updated':'2026-10-21','categories':CATS,'apps':rows}
(SITE/'assets/apps/catalog.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
def card(r):
 e=html.escape
 return f'''<a class="app-card" href="{e(r['source']or r['guide'])}" data-app="{r['id']}"><span class="app-card-top"><span class="catalog-icon" data-category="{r['category']}"><img src="{r['icon']}" width="64" height="64" alt="" loading="lazy"></span><span class="card-kind">{ {'market':'官方作品','port':'开源适配','system':'系统应用','device':'样机定制'}[r['kind']] }</span></span><h3>{e(r['name'])}</h3><p>{e(r['description'])}</p><span class="card-foot"><span>{CATS[r['category']]}</span><span aria-hidden="true">↗</span></span></a>'''
template=(SITE/'apps/template.html').read_text();(SITE/'apps/index.html').write_text(template.replace('<!-- CATALOG CARDS -->','\n'.join(card(r)for r in rows)).replace('<!-- TOTAL -->',str(len(rows))))
print(f'Built {len(rows)} app listings with validated purpose icons; no runtime files copied')
