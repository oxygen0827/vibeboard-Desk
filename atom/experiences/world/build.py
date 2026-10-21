import json
from pathlib import Path
root=Path(__file__).resolve().parent
names=['index.html','style.css','app.js','icon.svg','LICENSE','README.md']
bundle={'manifest':json.loads((root/'manifest.json').read_text()),'files':{n:(root/n).read_text() for n in names}}
(root/'bundle.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+'\n')
print('Built symbiotic-world complete bundle')
