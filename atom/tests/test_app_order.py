import unittest,tempfile,json
from pathlib import Path
from test_server import server
class OrderTests(unittest.TestCase):
    def test_append_update_reinstall(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve()/'apps'
            def bundle(id): return dict(manifest=dict(id=id,name=id,entry='index.html',input={'version':1,'profile':'five-way','back':'root'}),files={'index.html':'<p>app</p>'})
            def ids(): return [a['id'] for a in server.apps(root) if a['id'] not in server.RESERVED_IDS]
            server.install_app(root,bundle('z-app'))
            server.install_app(root,bundle('a-app'))
            self.assertEqual(ids(),['z-app','a-app'])
            stamp=json.loads((root/'z-app/manifest.json').read_text())['_installed_at_ns']
            server.install_app(root,bundle('z-app'),update=True)
            self.assertEqual(ids(),['z-app','a-app'])
            self.assertEqual(json.loads((root/'z-app/manifest.json').read_text())['_installed_at_ns'],stamp)
            server.uninstall_app(root,'z-app');server.install_app(root,bundle('z-app'))
            self.assertEqual(ids(),['a-app','z-app'])
