"""Build four self-contained ports of the owner's GrayOS prototypes."""
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from app_icons import validate_svg
SHARED=Path(__file__).resolve().parent
APPS={
 'photon-chip':dict(name='光子芯片',old='photon',description='点击六条光路注入光点，观察相位变化、交叉路径与探测器响应的交互演示。',subtitle='光路交互演示 · 数字键 1–6 注入',icon='<rect x="14" y="14" width="36" height="36" rx="7"/><path d="M23 6v8m9-8v8m9-8v8M23 50v8m9-8v8m9-8v8M6 23h8m-8 9h8m-8 9h8m36-18h8m-8 9h8m-8 9h8M22 25c8 0 12 14 20 14M22 39c8 0 12-14 20-14"/>',body='<div class="controls"><span class="caption"><b id="count">0</b><small>光路交互次数</small></span><button id="auto" aria-pressed="true">自动流动</button><button id="clear">清空</button></div>'),
 'photon-runner':dict(name='光子快跑',old='runner',description='点按或按 Enter 控制光子跃起，穿过逐渐加速的光门，最高纪录保存在本机。',subtitle='点按或 Enter 跃起 · 空格回桌面',icon='<path d="M45 8h10v15H45V8Zm0 33h10v15H45V41ZM7 24h13M5 33h11M9 42h12"/><circle cx="29" cy="32" r="9"/><path d="m26 28 7 4-7 4"/>',body='<div class="scoreboard"><span id="score" class="score">0</span><div class="record">最高纪录 <b id="best">0</b><div id="notice" role="status"></div></div></div><div id="prompt" class="runner-prompt"><h2>穿过下一道光门</h2><p>点按画面或按 Enter，让光子跃起</p></div><div class="controls"><span class="caption">保持轻盈，穿过光门</span><button id="retry-save" hidden>重试保存</button><button id="play" class="primary">开始</button></div>'),
 'finger-fireworks':dict(name='指尖烟花',old='fireworks',description='在画面上点燃烟花，连放、齐放或写一句短话，让文字变成光点。',subtitle='点击夜空 · 数字键 1–9 定点燃放',icon='<path d="M32 7v12m0 26v12M7 32h12m26 0h12M14 14l9 9m18 18 9 9M14 50l9-9m18-18 9-9M29 26l3-6 3 6 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',body='<div class="controls"><button id="words">写一句话</button><button id="auto" aria-pressed="false">自动连放</button><button id="finale" class="primary">齐放</button></div><section class="sheet" hidden><h2>让文字亮起来</h2><p>最多 8 个字，点击燃放即可看见。</p><input maxlength="8" aria-label="烟花文字" value="ATOM"><div class="actions"><button id="cancel">取消</button><button id="send-words" class="primary">燃放文字</button></div></section>'),
 'mini-piano':dict(name='迷你钢琴',old='piano',description='十个白键与七个黑键，双音色本机合成，支持鼠标、触屏、数字键和小星星自动演奏。',subtitle='数字键 1–0 · 本机合成',icon='<rect x="8" y="12" width="48" height="40" rx="6"/><path d="M20 12v40m12-40v40m12-40v40"/><path d="M16 12h8v23h-8zm24 0h8v23h-8z" fill="currentColor"/>',body='<div class="controls"><span id="notice" role="status">轻点琴键，弹一段旋律</span><button id="tone">音色 · 木琴</button><button id="demo">小星星</button></div><div id="keys" aria-label="琴键"></div>'),
}
for aid,data in APPS.items():
 p=ROOT/'official'/aid;p.mkdir(exist_ok=True)
 svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'+data['icon']+'</svg>'
 validate_svg(svg)
 (p/'icon.svg').write_text(svg+'\n')
 manifest=dict(id=aid,name=data['name'],description=data['description'],entry='index.html',icon='icon.svg',theme_ui='controls',layout='fullscreen')
 (p/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 (p/'index.html').write_text('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+data['name']+'</title><link rel="stylesheet" href="style.css"></head><body'+(' class="piano"'if aid=='mini-piano'else '')+'><canvas width="480" height="360" aria-label="'+data['name']+'画面"></canvas><header class="scene-head"><div><h1>'+data['name']+'</h1><small>'+data['subtitle']+'</small></div><button data-sound aria-pressed="false">声音 关</button></header>'+data['body']+'<script src="runtime.js"></script><script src="app.js"></script></body></html>\n')
 for name in ['runtime.js','style.css']:(p/name).write_text((SHARED/name).read_text())
 (p/'LICENSE').write_text((ROOT/'official'/'clap-stage'/'LICENSE').read_text())
 (p/'SOURCE.md').write_text('# '+data['name']+'\n\n源自本项目所有者灰色板 GrayOS 的 `apps/'+data['old']+'/index.html`。原版已保存在迁移前的私有整机应用备份中。此次保留原来的 Canvas / WebAudio 玩法，适配 ATOM 当前主题、独立图标、全屏和鼠标/触屏操作。移除旧的 GrayOS HTTP、RGB、全局 Home 按钮及遥测依赖；空格/Home 留给系统。\n\n完整源码随 bundle 发布，采用仓库 MIT 许可。页面不包含账号、模型密钥、外部资源或网络调用。\n')
 notes='点击画面或屏幕按钮；空格/Home 由系统返回。退出时释放计时器、动画与音频，隐藏时暂停。图标和控件跟随当前主题，场景颜色保留。'
 if aid=='photon-chip':notes+=' 光点路由和相位耦合为交互示意，不是量子/光学求解器，也不是芯片性能测试；计数仅为实际发生的路径交互事件。'
 if aid=='photon-runner':notes+=' 最高纪录使用 AtomApp 保存；读取失败先重试，保存失败可重试，预览数据独立。'
 if aid=='mini-piano':notes+=' 音色由浏览器本机合成，并非采样钢琴；不需要旧服务器蜂鸣接口。小星星演奏可随时停止。'
 (p/'README.md').write_text('# '+data['name']+'\n\n'+data['description']+'\n\n'+notes+'\n\n构建：`python3 atom/official/gray-ports/build.py`，再运行 `python3 atom/tools/prepare_icon_bundles.py`。\n')
 names=['index.html','style.css','runtime.js','app.js','icon.svg','LICENSE','SOURCE.md','README.md']
 (p/'bundle.json').write_text(json.dumps(dict(manifest=manifest,files={n:(p/n).read_text() for n in names}),ensure_ascii=False,indent=2)+'\n')
 print('Built '+aid)
