"""Build complete original official sources for the marketplace seed importer."""
import runpy
import json
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[1]/'design/sync_device_ui.py'),run_name='__main__')
root=Path(__file__).resolve().parent
for name in ('official-companion','pixel-lab','task-pal','today','sound-lab'):
    base=root/name
    files={p.name:p.read_text() for p in sorted(base.iterdir()) if p.is_file() and p.name not in ('bundle.json','manifest.json') and (p.suffix in ('.html','.css','.js','.svg','.md') or p.name=='LICENSE')}
    bundle={'manifest':json.loads((base/'manifest.json').read_text()),'files':files}
    (base/'bundle.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+'\n')
