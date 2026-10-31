"""Build complete reviewed device-client bundles; no credentials or runtime state."""
import runpy
import json
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[1]/'design/sync_device_ui.py'),run_name='__main__')
root=Path(__file__).resolve().parents[1]
runpy.run_path(str(root/'tools/build_community.py'),run_name='__main__')
for folder in ('market-app','notes-app'):
    base=root/folder
    manifest=json.loads((base/'manifest.json').read_text())
    names=('index.html','style.css','device-ui.css','bridge.js','app.js','icon.svg')
    if folder=='market-app': names+=('community.js','community.css','community-preview.js')
    bundle={'manifest':manifest,'files':{name:(base/name).read_text() for name in names}}
    (root/'examples'/(manifest['id']+'.json')).write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+'\n')
