"""Shared layout builds must not modify unrelated, independently packaged apps."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BuildAssetTests(unittest.TestCase):
    def test_design_sync_only_changes_adopted_clients(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            design = root / 'design'
            design.mkdir()
            (design / 'device-ui.css').write_text('/* shared layout */')
            script = design / 'sync_device_ui.py'
            script.write_bytes((ROOT / 'design/sync_device_ui.py').read_bytes())
            clients = ['market-app', 'notes-app', 'computer-app']
            clients += ['official/' + name for name in
                        ('official-companion', 'pixel-lab', 'task-pal', 'today', 'sound-lab')]
            original = '<html><head></head><body>Scene</body></html>'
            for name in clients + ['official/independent-scene']:
                app = root / name
                app.mkdir(parents=True)
                (app / 'manifest.json').write_text(json.dumps({'id': app.name}))
                (app / 'index.html').write_text(original)
            subprocess.run([sys.executable, str(script)], check=True)
            for name in clients:
                self.assertTrue((root / name / 'device-ui.css').is_file())
                self.assertIn('href="device-ui.css"', (root / name / 'index.html').read_text())
            scene = root / 'official/independent-scene'
            self.assertEqual((scene / 'index.html').read_text(), original)
            self.assertFalse((scene / 'device-ui.css').exists())

    def test_piano_entry_resources_are_in_the_complete_bundle(self):
        bundle = json.loads((ROOT / 'official/mini-piano/bundle.json').read_text())
        files = bundle['files']
        for name in re.findall(r'(?:src|href)="([^"]+)"', files['index.html']):
            if not name.startswith(('data:', 'http:', 'https:', '#')):
                self.assertIn(name, files, 'Missing packaged resource: ' + name)
