from pathlib import Path
import json,base64
p=Path(__file__).resolve().parent
photos=json.loads((p/'photos/sources.json').read_text())
scenes={item['id']:{**item,'data':'data:image/jpeg;base64,'+base64.b64encode((p/'photos'/f"{item['id']}.jpg").read_bytes()).decode()} for item in photos}
(p/'scenes.js').write_text('window.ATOMScenes='+json.dumps(scenes,ensure_ascii=False,separators=(',',':'))+';\n')
names=['index.html','style.css','app.js','scenes.js','icon.svg','LICENSE','PHOTO-LICENSE.md','SOURCE.md','README.md']
bundle={'manifest':json.loads((p/'manifest.json').read_text()),'files':{n:(p/n).read_text() for n in names}}
packed=json.dumps(bundle,ensure_ascii=False,indent=2)+'\n'
assert len(packed.encode())<1024*1024
(p/'bundle.json').write_text(packed)
print('weather bundle',len(packed.encode()),'bytes; all seven photos embedded')
