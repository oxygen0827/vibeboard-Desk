"""Encode approved PNG assets for the text-only ATOM application bundle (requires Pillow)."""
import base64
import json
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent
assets = {}
for key, name in [('scene', 'courtyard-v1'), ('npcs', 'residents-v1'), ('keeper', 'keeper-v1')]:
    image = Image.open(root / 'assets' / f'{name}.png')
    target = root / 'assets' / f'{name}.webp'
    image.save(target, format='WEBP', quality=85, method=6)
    assets[key] = 'data:image/webp;base64,' + base64.b64encode(target.read_bytes()).decode()
(root / 'assets.js').write_text('globalThis.YardAssets=' + json.dumps(assets) + ';\n')
