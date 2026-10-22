import importlib.util, json, os, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('simulator_seed',Path(__file__).resolve().parents[1]/'tools/simulator.py')
sim=importlib.util.module_from_spec(spec);spec.loader.exec_module(sim)
class SeedTests(unittest.TestCase):
    def test_nested_asset_refresh_preserves_desktop_order(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);source=root/'seed/demo';source.mkdir(parents=True);target=root/'apps'
            (source/'manifest.json').write_text('{"id":"demo"}');(source/'assets').mkdir();(source/'assets/main.js').write_text('old')
            sim.seed(target,source.parent);manifest=target/'demo/manifest.json';os.utime(manifest,(1000,1000))
            (source/'assets/main.js').write_text('new');sim.seed(target,source.parent)
            self.assertEqual((target/'demo/assets/main.js').read_text(),'new')
            self.assertEqual(manifest.stat().st_mtime,1000)
