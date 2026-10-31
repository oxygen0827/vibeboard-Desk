import json
from pathlib import Path
p=Path(__file__).resolve().parent
names=['index.html','style.css','runtime.js','app.js','songs.js','samples.js','pianist.js','asset-sources.json','licenses/salamander-CC-BY-3.0.txt','icon.svg','LICENSE','SOURCE.md','README.md']
(p/'bundle.json').write_text(json.dumps({'manifest':json.loads((p/'manifest.json').read_text()),'files':{n:(p/n).read_text() for n in names}},ensure_ascii=False,indent=2)+'\n')
