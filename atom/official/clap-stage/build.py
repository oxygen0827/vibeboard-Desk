from pathlib import Path
import json
p=Path(__file__).resolve().parent
names=['index.html','style.css','app.js','rhythm.js','icon.svg','LICENSE','README.md']
(p/'bundle.json').write_text(json.dumps({'manifest':json.loads((p/'manifest.json').read_text()),'files':{n:(p/n).read_text() for n in names}},ensure_ascii=False,indent=2)+'\n')
