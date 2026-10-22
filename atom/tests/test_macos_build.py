"""The Mac builder must not destroy an installed app when a dependency is missing."""
import platform
import subprocess
import tempfile
import unittest
from pathlib import Path

ATOM = Path(__file__).resolve().parents[1]
NODE = ATOM / 'connect/dist/ATOM Connect.app/Contents/Resources/runtime/node'


@unittest.skipUnless(platform.system() == 'Darwin' and NODE.is_file(), 'requires the local Mac build runtime')
class MacBuildRecovery(unittest.TestCase):
    def test_missing_python_preserves_previous_bundle(self):
        with tempfile.TemporaryDirectory(prefix='atom-build-recovery-') as folder:
            app = Path(folder) / 'Previous.app'
            app.mkdir()
            sentinel = app / 'sentinel'
            sentinel.write_text('existing usable app')
            result = subprocess.run(['python3', str(ATOM / 'connect/desktop/build-macos.py'),
                '--node', str(NODE), '--python-root', str(Path(folder) / 'missing-python'),
                '--output', str(app)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(sentinel.read_text(), 'existing usable app')
            self.assertEqual(list(Path(folder).iterdir()), [app])
