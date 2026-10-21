"""Copy the shared reviewed design source into each complete offline source bundle."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
def sync(base):
    (base/'device-ui.css').write_text((root/'design/device-ui.css').read_text())
    p=base/'index.html';s=p.read_text();ident=json.loads((base/'manifest.json').read_text())['id']
    if 'data-atom-app=' not in s:s=s.replace('<body>', '<body data-atom-app="'+ident+'">')
    if 'href="device-ui.css"' not in s:s=s.replace('</head>','<link rel="stylesheet" href="device-ui.css"></head>')
    p.write_text(s)
if __name__=='__main__':
    for folder in ['market-app','notes-app','computer-app']+[str(p.relative_to(root)) for p in (root/'official').iterdir() if (p/'manifest.json').exists()]:sync(root/folder)
