import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('check_app', str(Path(__file__).resolve().parents[1] / 'tools' / 'check_app.py'))
checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)

class BundleChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root / 'manifest.json').write_text(json.dumps(dict(id='example',name='Example',entry='index.html',icon='icon.svg',input={'version':1,'profile':'five-way','back':'root'})))
        (self.root / 'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20"/></svg>')
        (self.root / 'index.html').write_text('<meta name="viewport" content="width=device-width"><button>Start</button>')
    def tearDown(self): self.temp.cleanup()
    def test_valid_bundle(self): self.assertEqual(checker.check(self.root), ([], []))
    def test_warnings_not_errors(self):
        (self.root / 'index.html').write_text('<style>p{font-size:10px}</style><script>Math.random()</script>')
        errors, warnings = checker.check(self.root)
        self.assertFalse(errors); self.assertTrue(any('random' in w for w in warnings)); self.assertTrue(any('14px' in w for w in warnings))
    def test_device_browser_baseline_and_alias_warnings(self):
        (self.root / 'index.html').write_text('<meta name="viewport" content="width=device-width"><button>Go</button><style>li:has(b){}</style><script>const A=window.AtomApp;Object.hasOwn({},"a");[1].at(-1);[1].at(i)</script>')
        errors, warnings = checker.check(self.root)
        self.assertFalse(errors)
        newer = [w for w in warnings if 'Chromium 91' in w]
        self.assertEqual(len(newer), 1); self.assertIn('Object.hasOwn', newer[0]); self.assertIn(':has', newer[0]); self.assertIn('.at', newer[0])
        self.assertTrue(any('alias' in w for w in warnings))
    def test_invalid_structure_and_symlink(self):
        (self.root / 'escape').symlink_to('/etc/passwd')
        errors, warnings = checker.check(self.root)
        self.assertTrue(any('symlink' in e for e in errors))
        (self.root / 'manifest.json').write_text('{bad')
        self.assertTrue(checker.check(self.root)[0])
    def test_json_bundle_and_unsafe_paths(self):
        bundle = self.root / 'bundle.json'
        value = dict(manifest=dict(id='example',name='Example',entry='index.html',icon='icon.svg',input={'version':1,'profile':'five-way','back':'root'}), files={'index.html':'<meta name="viewport"><button>Start</button>', 'icon.svg':(self.root/'icon.svg').read_text()})
        bundle.write_text(json.dumps(value))
        self.assertEqual(checker.check(bundle), ([], []))
        value['files']['../escape'] = 'bad'
        bundle.write_text(json.dumps(value))
        self.assertTrue(any('unsafe' in e for e in checker.check(bundle)[0]))
        self.assertFalse((self.root.parent / 'escape').exists())

    def test_fullscreen_scroll_review_warnings(self):
        (self.root / 'index.html').write_text('<meta name="viewport"><style>body{height:auto;min-height:100vh}.list{overflow:auto}.atom-scroll{height:100px;overflow:auto}</style><button>Start</button>')
        errors,warnings=checker.check(self.root)
        self.assertFalse(errors)
        self.assertTrue(any('root height:auto' in item for item in warnings))
        self.assertTrue(any('not explicitly marked' in item for item in warnings))
        self.assertFalse(any('no local height bound' in item for item in warnings))

    def test_paths(self):
        for value in ['../x', '/x', 'a/../b', 'a\\b', 'a//b', 'a/./b']:
            self.assertFalse(checker.valid_path(value))

    def test_complete_port_retains_binary_assets_without_json_limits(self):
        (self.root/'texture.png').write_bytes(b'\x89PNG\xff'+b'\x00'*(2*1024*1024))
        for i in range(101): (self.root/('asset-%s.txt'%i)).write_text('source')
        self.assertTrue(checker.check(self.root)[0])
        self.assertFalse(checker.check(self.root,full_port=True)[0])

    def test_complete_port_still_checks_source_and_navigation(self):
        (self.root/'script.js').write_bytes(b'\xffinvalid')
        manifest=json.loads((self.root/'manifest.json').read_text());del manifest['input']
        (self.root/'manifest.json').write_text(json.dumps(manifest))
        errors,_=checker.check(self.root,full_port=True)
        self.assertTrue(any('UTF-8' in e for e in errors))
        (self.root/'script.js').unlink()
        errors,_=checker.check(self.root,full_port=True)
        self.assertTrue(any('input' in e for e in errors))
