#!/usr/bin/env python3
"""Rebuild the complete text bundles of the nine reviewed ritual/life applications."""
from pathlib import Path
import json
ROOT = Path(__file__).resolve().parents[1]
IDS = ['oracle-tarot','zodiac-atlas','echo-book','moon-letter','rain-radio','personality-planet','natal-whispers','glass-ecosystem','element-sandbox']
for aid in IDS:
    folder = ROOT / 'ports' / aid
    files = {p.relative_to(folder).as_posix():p.read_text(encoding='utf-8') for p in sorted(folder.rglob('*')) if p.is_file() and p.name not in ('manifest.json','bundle.json')}
    bundle = dict(manifest=json.loads((folder/'manifest.json').read_text()),files=files)
    (folder/'bundle.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(aid, len(json.dumps(bundle,ensure_ascii=False).encode('utf-8')))
