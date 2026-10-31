"""Bundle the complete offline resource graph declared by the entry document."""
import json
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text())
entry = manifest['entry']

class Resources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.names = [entry, manifest['icon']]

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        name = attrs.get('src') if tag == 'script' else attrs.get('href') if tag == 'link' else None
        if name:
            path = Path(name)
            if path.is_absolute() or '..' in path.parts or ':' in name or '?' in name:
                raise ValueError('Only bundled local resources are allowed: ' + name)
            self.names.append(name)

resources = Resources()
resources.feed((root / entry).read_text())
assert len(resources.names) == len(set(resources.names)), 'Duplicate resource declaration'
bundle = {'manifest': manifest, 'files': {name: (root / name).read_text() for name in resources.names}}
(root / 'bundle.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + '\n')
assert (root / 'bundle.json').stat().st_size < 2 * 1024 * 1024, 'Bundle exceeds device admission limit'
