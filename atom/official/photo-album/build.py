from pathlib import Path
import json, shutil
p=Path(__file__).resolve().parent
names=['index.html','style.css','app.js','icon.svg','LICENSE']
(p/'bundle.json').write_text(json.dumps({'manifest':json.loads((p/'manifest.json').read_text()),'files':{n:(p/n).read_text() for n in names}},ensure_ascii=False,indent=2)+'\n')
target=p.parents[1]/'connect/computer/photo-album'
target.mkdir(exist_ok=True)
for n in names: shutil.copyfile(p/n,target/n)
