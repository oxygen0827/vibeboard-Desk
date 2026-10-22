import json,sys,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server,system_update
from http.server import ThreadingHTTPServer

class MaintenanceHTTP(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name).resolve();self.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.http.apps_root=root/'apps';self.http.apps_root.mkdir();(self.http.apps_root/'keep.txt').write_text('installed app')
        self.http.settings_path=root/'state/settings.json';self.http.settings_path.parent.mkdir()
        (self.http.settings_path.parent/'model.json').write_text('{"api_key":"test-only-key"}')
        self.http.is_simulator=True
        p=patch.object(system_update,'UPDATE',root/'update');p.start();self.addCleanup(p.stop)
        threading.Thread(target=self.http.serve_forever,daemon=True).start()
        self.addCleanup(self.http.server_close);self.addCleanup(self.http.shutdown)
        self.base='http://127.0.0.1:'+str(self.http.server_port)
    def post(self,action,data):
        req=urllib.request.Request(self.base+'/api/device-data/'+action,data=json.dumps(data).encode(),headers={'Origin':self.base,'Content-Type':'application/json'})
        with urllib.request.urlopen(req) as r:return json.load(r)
    def test_reset_requires_phrase_clears_private_config_retains_apps_and_requests_browser_clear(self):
        self.post('backup',{'data':{'atom.app.v1.demo':'{"x":1}'}})
        with self.assertRaises(urllib.error.HTTPError):self.post('reset',{'confirm':True})
        self.assertTrue((self.http.settings_path.parent/'model.json').exists())
        self.post('reset',{'confirm':'重置这台设备'})
        self.assertFalse((self.http.settings_path.parent/'model.json').exists())
        self.assertTrue((self.http.apps_root/'keep.txt').exists())
        self.assertEqual(self.post('status',{})['pending']['source'],'reset')
        self.assertEqual(self.post('status',{})['backups'],[])
    def test_preview_import_is_only_for_simulator(self):
        self.http.is_simulator=False
        with self.assertRaises(urllib.error.HTTPError):self.post('preview',{'data':{}})

    def test_power_requires_real_device_confirmation_and_no_update(self):
        import system_tools
        def power(data):
            req=urllib.request.Request(self.base+'/api/system/power',data=json.dumps(data).encode(),headers={'Origin':self.base,'Content-Type':'application/json'})
            with urllib.request.urlopen(req) as r:return json.load(r)
        with patch.object(system_tools,'power',return_value={'ok':True}) as command, patch.object(system_update,'status',return_value={'installing':False}):
            with self.assertRaises(urllib.error.HTTPError):power({'action':'reboot','confirm':True})
            self.http.is_simulator=False
            with self.assertRaises(urllib.error.HTTPError):power({'action':'reboot'})
            command.assert_not_called()
            self.assertTrue(power({'action':'reboot','confirm':True})['ok'])
            command.assert_called_once_with('reboot')
        with patch.object(system_tools,'power') as command, patch.object(system_update,'status',return_value={'installing':True}):
            with self.assertRaises(urllib.error.HTTPError):power({'action':'poweroff','confirm':True})
            command.assert_not_called()

class ModelFallback(unittest.TestCase):
    def test_own_transcription_and_official_speech_are_independent(self):
        config={'api_key':'own-text','stt_api_key':'own-stt','stt_base_url':'https://own','stt_model':'own'}
        service=SimpleNamespace(workshop=SimpleNamespace(read_private_config=lambda:config.copy()),market=SimpleNamespace(current=lambda:{'token':'account-token'},base=lambda:'https://official'))
        result=server.model_config(service)
        self.assertEqual(result['stt_api_key'],'own-stt');self.assertEqual(result['api_key'],'own-text')
        self.assertEqual(result['tts_api_key'],'account-token');self.assertEqual(result['tts_model'],'glm-tts')
