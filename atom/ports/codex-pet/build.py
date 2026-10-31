"""Build a complete offline text bundle; sprites are embedded in pets.js."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
names = ['index.html', 'style.css', 'app.js', 'scene.js', 'pets.js', 'icon.svg', 'SOURCE.md', 'README.md']
bundle = dict(manifest=json.loads((root / 'manifest.json').read_text()),
              files={name: (root / name).read_text() for name in names})
packed = json.dumps(bundle, ensure_ascii=False, indent=2) + '\n'
if len(packed.encode()) > 1024 * 1024:
    raise ValueError('Bundle exceeds 1 MiB')
(root / 'bundle.json').write_text(packed)
print('codex-pet:', len(packed.encode()), 'bytes; all assets included')
