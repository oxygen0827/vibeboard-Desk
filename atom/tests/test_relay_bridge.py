import json,os,stat,tempfile,unittest
from pathlib import Path
from unittest import mock
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from relay_bridge import DeviceBridge,BridgeError,relay_url
class DeviceBridgeTests(unittest.TestCase):
    def test_only_https_or_loopback_and_no_credentials(self):
        for value in ('http://example.com','https://user:pass@example.com','https://example.com?a=b','https://example.com/../x','https://example.com#token','ftp://127.0.0.1'):
            with self.assertRaises(BridgeError):relay_url(value)
        self.assertEqual(relay_url('http://127.0.0.1:8787/'),'http://127.0.0.1:8787')
        self.assertEqual(relay_url('https://relay.example'),'https://relay.example')
    def test_credentials_never_public_and_file_private(self):
        with tempfile.TemporaryDirectory() as d:
            bridge=DeviceBridge(Path(d).resolve())
            responses=[dict(client_id='device_1',token='secret-token-that-stays-private'),dict(client_id='device_1',role='device',paired=[],tasks=[])]
            with mock.patch.object(bridge,'_request',side_effect=responses):r=bridge.configure(dict(relay_url='http://localhost:8787'))
            self.assertNotIn('token',json.dumps(r));self.assertEqual(stat.S_IMODE(bridge.path.stat().st_mode),0o600)
            self.assertEqual(DeviceBridge(Path(d).resolve()).config['client_id'],'device_1')
    def test_cached_pairing_cannot_hide_a_changed_peer(self):
        import e2e
        with tempfile.TemporaryDirectory() as d:
            bridge=DeviceBridge(Path(d).resolve())
            private=e2e.new_private_key()
            old=e2e.public_key(e2e.new_private_key())
            new=e2e.public_key(e2e.new_private_key())
            bridge._save(dict(relay_url='https://relay.example',client_id='device',token='s'*32,e2e_private=private,peers={'computer':old}))
            bridge.key_cache['computer']={'state':'on','key':b'old'}
            response={'paired':[{'client_id':'computer','own_key':e2e.public_key(private),'public_key':new}]}
            with mock.patch.object(bridge,'_request',return_value=response) as request:
                self.assertEqual(bridge.pairing('computer')['state'],'changed')
                with self.assertRaisesRegex(BridgeError,'密钥发生'):
                    bridge.execute('create-task',dict(request_id='r',computer_id='computer',project_id='p',agent_id='codex',prompt='hello'))
                self.assertTrue(all(c.args[0]=='/v1/state' for c in request.call_args_list))
            response['paired'][0]['public_key']=None
            with mock.patch.object(bridge,'_request',return_value=response):
                self.assertEqual(bridge.pairing('computer')['state'],'changed')
            with mock.patch.object(bridge,'_request',return_value={'paired':[]}):
                self.assertEqual(bridge.pairing('computer')['state'],'changed')

    def test_invalid_paths_and_input_are_not_forwarded(self):
        with tempfile.TemporaryDirectory() as d:
            bridge=DeviceBridge(Path(d).resolve())
            with mock.patch.object(bridge,'_request') as request:
                for action,data in [('task-events',{'task_id':'../../model.json'}),('approve-task',{'task_id':'a','request_id':'b','decision':'acceptForSession'}),('task-events',{'task_id':'a','after':True})]:
                    with self.assertRaises(BridgeError):bridge.execute(action,data)
                request.assert_not_called()
    def test_failed_new_configuration_keeps_previous_identity(self):
        with tempfile.TemporaryDirectory() as d:
            bridge=DeviceBridge(Path(d).resolve());bridge._save(dict(relay_url='https://old.example',client_id='a',token='s'*32))
            with mock.patch.object(bridge,'_request',side_effect=BridgeError('offline')):
                with self.assertRaises(BridgeError):bridge.configure(dict(relay_url='https://new.example'))
            self.assertEqual(bridge.config['relay_url'],'https://old.example')
            with mock.patch.object(bridge,'_request',side_effect=BridgeError('offline')):
                self.assertEqual(bridge.state()['connection_error'],'offline')

class AppDeliveryTests(unittest.TestCase):
    def bundle(self):
        return {'manifest':{'id':'connect-test','name':'测试应用','description':'测试','entry':'index.html','icon':'icon.svg'},'files':{'index.html':'<!doctype html><html><body>test</body></html>','icon.svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor"><circle cx="32" cy="32" r="20"/></svg>'}}
    def test_valid_delivery_follows_system_theme(self):
        from server import connect_app_bundle
        b=self.bundle();b['manifest'].update(theme_mode='fixed',theme_id='old')
        bridge=mock.Mock();bridge.execute.return_value={'artifact':b}
        result=connect_app_bundle(bridge,{'task_id':'a'})
        self.assertNotIn('theme_mode',result['manifest']);self.assertEqual(result['files']['icon.svg'],b['files']['icon.svg'])
    def test_rejects_unsafe_or_missing_icon_and_path(self):
        from server import connect_app_bundle
        for mutation in ['missing','active','palette','path']:
            b=self.bundle()
            if mutation=='missing':del b['files']['icon.svg']
            if mutation=='active':b['files']['icon.svg']=b['files']['icon.svg'].replace('</svg>','<script>alert(1)</script></svg>')
            if mutation=='palette':b['files']['icon.svg']=b['files']['icon.svg'].replace('currentColor','#f00')
            if mutation=='path':b['files']['../private']='bad'
            bridge=mock.Mock();bridge.execute.return_value={'artifact':b}
            with self.assertRaises(ValueError):connect_app_bundle(bridge,{'task_id':'a'})

    def test_generated_app_cannot_replace_privileged_connect_entry(self):
        from server import connect_app_bundle
        bridge=mock.Mock();b=self.bundle();b['manifest']['id']='my-computer';bridge.execute.return_value={'artifact':b}
        with self.assertRaises(ValueError):connect_app_bundle(bridge,{'task_id':'a'})
