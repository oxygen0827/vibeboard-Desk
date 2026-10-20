import runpy
import json
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[1]/'design/sync_device_ui.py'),run_name='__main__')
root=Path(__file__).resolve().parent
license_text='''MIT License

Copyright (c) 2026 ATOM contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
'''
for app_id,title,desc in [('today','今日','电脑与设备共享日程和待办，支持本机离线队列与修改冲突处理。'),('sound-lab','声音实验室','四轨十六步节拍器，轻点编排，保存自己的声音实验。')]:
 p=root/app_id
 (p/'LICENSE').write_text(license_text)
 manifest=dict(id=app_id,name=title,description=desc,entry='index.html',icon='icon.svg',theme_ui='controls',layout='fullscreen')
 if app_id=='today':manifest['capabilities']=['agenda']
 (p/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
 bundle=dict(manifest=manifest,files={name:(p/name).read_text()for name in ('index.html','style.css','device-ui.css','app.js','icon.svg','LICENSE')})
 (p/'bundle.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2))
