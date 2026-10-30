from pathlib import Path
import json
root = Path(__file__).resolve().parent
names = ['index.html', 'style.css', 'app.js', 'icon.svg', 'LICENSE', 'SOURCE.md', 'README.md']
(root / 'bundle.json').write_text(json.dumps({'manifest': json.loads((root / 'manifest.json').read_text()), 'files': {name: (root / name).read_text() for name in names}}, ensure_ascii=False, indent=2))
