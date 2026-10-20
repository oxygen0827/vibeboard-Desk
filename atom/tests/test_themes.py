import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('themes',str(Path(__file__).resolve().parents[1]/'themes.py'))
themes=importlib.util.module_from_spec(spec);spec.loader.exec_module(themes)

class ThemeTests(unittest.TestCase):
    def test_persistence_and_validation(self):
        with tempfile.TemporaryDirectory() as d:
            s=themes.ThemeStore(d)
            self.assertEqual(s.list_themes()['active'],'system')
            s.activate('system'); self.assertEqual(themes.ThemeStore(d).list_themes()['active'],'system')
            data=dict(id='custom',name='Custom',tokens={k:'#ffffff' for k in themes.KEYS})
            s.install(data);s.activate('custom');self.assertIn('--atom-paper:#ffffff',s.css())
            self.assertEqual(themes.ThemeStore(d).list_themes()['active'],'custom')
            data['id']='system'
            with self.assertRaises(ValueError):s.install(data)
            data['id']='evil';data['tokens']['bg']='#fff;display:none'
            with self.assertRaises(ValueError):s.install(data)
            with self.assertRaises(ValueError):s.activate('unknown')

    def test_icon_styles_and_custom_override(self):
        from app_icons import GLYPHS,generate_icon
        with tempfile.TemporaryDirectory() as d:
            store=themes.ThemeStore(d)
            styles=[(t['icons']['radius'],t['icons']['stroke']) for t in store.list_themes()['themes']]
            self.assertEqual(len(set(styles)),1)
            data=dict(id='custom-icon',name='Custom',tokens={k:'#ffffff' for k in themes.KEYS},icons={'radius':12,'overrides':{'clock':generate_icon(dict(id='model-viewer',name='Clock'))}})
            store.install(data);store.activate(data['id']);self.assertIn('--icon-radius:12px',store.css())
            icon=themes.ThemeStore(d).list_themes()['themes'][-1]['icons']['overrides']['clock'];self.assertIn('currentColor',icon);self.assertNotIn('#',icon)
            data['icons']['overrides']['clock']='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><script/></svg>'
            with self.assertRaises(ValueError):store.install(data)

    def test_retired_themes_are_removed_once_and_do_not_return(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'themes.json';p.write_text(json.dumps({'active':'sunshine','themes':[{'id':'mint','name':'Mint','tokens':{k:'#ffffff' for k in themes.KEYS}}]}))
            store=themes.ThemeStore(d)
            self.assertEqual([t['id'] for t in store.list_themes()['themes']],['system'])
            self.assertEqual(themes.ThemeStore(d).active,'system')
            self.assertEqual(json.loads(p.read_text())['themes'],[])
            self.assertNotIn('#ffe49b',store.css())
