import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[1] / 'tools/promote_full_library.py'


class LibraryPromotionTests(unittest.TestCase):
    def exercise(self, interrupted=False, invalid=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            incoming, private, public = [root / p for p in ['incoming', 'private', 'public']]
            for p in [incoming, private, public]: p.mkdir()
            archive = incoming / 'pending.zip'
            with zipfile.ZipFile(archive, 'w') as z: z.writestr('demo/index.html', '<html>Demo</html>')
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            name = 'demo-' + digest[:16] + '.zip'
            archive.rename((public if interrupted else incoming) / name)
            payload = {'apps': [{'id': 'demo', 'archive': '/atom/assets/library/' + name, 'sha256': digest, 'files': 1}]}
            (incoming / 'catalog.json').write_text(json.dumps(payload))
            (incoming / 'demo.jpg').write_bytes(b'reviewed-cover')
            if invalid: (incoming / 'unreviewed.exe').write_bytes(b'bad')
            code = SOURCE.read_text()
            for a, b in [('/opt/atom/.library-incoming', incoming), ('/opt/atom/app-library', private), ('/home/lincaigui/nginx/static/atom/assets/library', public)]:
                code = code.replace(repr(a), repr(str(b)))
            result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True)
            if invalid:
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((private / 'catalog.json').exists())
                self.assertTrue((incoming / name).exists(), 'Validation must precede file moves')
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads((private / 'catalog.json').read_text()), payload)
                self.assertTrue((public / name).is_file())
                self.assertTrue((public / 'demo.jpg').is_file())

    def test_jpeg_covers_and_archives_promote(self): self.exercise()
    def test_interrupted_promotion_can_resume_without_redownloading(self): self.exercise(interrupted=True)
    def test_unknown_files_fail_before_mutating_public_catalog(self): self.exercise(invalid=True)
