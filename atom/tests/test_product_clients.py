import json,sys,tempfile,unittest,os
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from market_client import MarketClient
from relay_bridge import BridgeError
from release_store import ReleaseStore
from server import install_app, apps, validate_manifest
class ProductClients(unittest.TestCase):
    def test_photo_proxy_is_account_bound_and_uses_fixed_routes(self):
        with tempfile.TemporaryDirectory() as d:
            c=self.setup_client(d)
            with mock.patch.object(c,'request',return_value={'items':[]}) as req:
                with self.assertRaises(BridgeError):c.execute('photo-list',{'expected_user_id':'other'})
                with self.assertRaises(BridgeError):c.execute('photo-get',{'id':'../../keys'})
                req.assert_not_called()
                c.execute('photo-list',{'expected_user_id':'alice','page':0,'filter':'all','limit':6})
                self.assertEqual(req.call_args.args[0],'photos?page=0&filter=all&limit=6')
                self.assertTrue(req.call_args.kwargs['authenticated'])
    def setup_client(self,folder):
        connect=mock.Mock();connect.config={'relay_url':'http://127.0.0.1:19441'}
        c=MarketClient(Path(folder).resolve(),connect);c.save({'relay_url':connect.config['relay_url'],'token':'private-market-token'*3,'user':{'id':'alice','username':'Alice'}});return c
    def test_account_is_private_and_bound_to_server_and_expected_owner(self):
        with tempfile.TemporaryDirectory() as d:
            c=self.setup_client(d);self.assertNotIn('token',json.dumps(c.execute('state',{})))
            with mock.patch.object(c,'request') as req:
                with self.assertRaises(BridgeError):c.execute('save-note',{'id':'n','text':'private','expected_user_id':'bob'})
                req.assert_not_called()
            c.connect.config={'relay_url':'https://different.example'}
            self.assertFalse(c.execute('state',{})['authenticated'])
            self.assertEqual(os.stat(c.path).st_mode&0o777,0o600)
    def test_expired_or_offline_logout_still_clears_local_identity(self):
        for status in (401,503):
            with tempfile.TemporaryDirectory() as d:
                c=self.setup_client(d)
                with mock.patch.object(c,'request',side_effect=BridgeError('unavailable',status)):
                    r=c.execute('logout',{})
                self.assertTrue(r['local_cleared']);self.assertFalse(r['remote_revoked']);self.assertFalse(c.execute('state',{})['authenticated'])
    def test_paths_cannot_escape_fixed_routes(self):
        with tempfile.TemporaryDirectory() as d:
            c=self.setup_client(d)
            with mock.patch.object(c,'request') as req:
                for action,body in [('source',{'version_id':'../private'}),('work',{'work_id':'https://other'}),('fork',{'version_id':'a/b'}),('save-note',{'id':'../x'})]:
                    with self.assertRaises(BridgeError):c.execute(action,body)
                req.assert_not_called()
    def bundle(self,text):
        return {'manifest':{'id':'history-demo','name':'History','entry':'index.html','input':{'version':1,'profile':'five-way','back':'root'},'icon':'icon.svg','capabilities':['agenda']},'files':{'index.html':text,'icon.svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor"><circle cx="32" cy="32" r="20"/></svg>','lib/helper.js':'complete resource'}}
    def test_resource_restore_keeps_full_files_and_desktop_position(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();folder=root/'apps';store=ReleaseStore(root/'private')
            install_app(folder,self.bundle('v1'));stamp=apps(folder)[-1]['installation_id'];store.capture(folder,'history-demo')
            install_app(folder,self.bundle('v2'),update=True)
            entry=store.history('history-demo')[0];old=store.read('history-demo',entry['release_id'])
            self.assertEqual(old['files']['lib/helper.js'],'complete resource');install_app(folder,old,update=True)
            self.assertEqual((folder/'history-demo/index.html').read_text(),'v1');self.assertEqual(apps(folder)[-1]['installation_id'],stamp)
            (folder/'history-demo/lib/unsafe').symlink_to(root/'private')
            with self.assertRaises(ValueError):store.capture(folder,'history-demo')
    def test_capabilities_are_narrow_and_cannot_escalate(self):
        for caps in (['connect'],['notes','notes'],[{}],[['notes']],['notes','agenda','task-state','notes']):
            b=self.bundle('v1');b['manifest']['capabilities']=caps
            with self.assertRaises(ValueError):validate_manifest(b['manifest'])
