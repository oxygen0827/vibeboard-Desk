"""Disposable local integration fixture; never touches a real account or device."""
import importlib.util
import json
import sys
import tempfile
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
ATOM=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ATOM))
import server
import e2e
spec=importlib.util.spec_from_file_location('qa_relay',ATOM/'connect/relay/server.py')
relay=importlib.util.module_from_spec(spec);spec.loader.exec_module(relay)

if __name__=='__main__':
    with tempfile.TemporaryDirectory(prefix='atom-qr-qa-') as home:
        home=str(Path(home).resolve())
        cloud=ThreadingHTTPServer(('127.0.0.1',0),relay.Handler)
        cloud.relay=relay.Relay(str(Path(home)/'relay.db'))
        base='http://127.0.0.1:'+str(cloud.server_port)
        relay.WEB_ORIGINS=(base,)
        session=cloud.relay.handle('POST','/market/v1/register',body={'username':'phone_test','password':'disposable-test-password'})
        key,_,record=e2e.new_account_keys('disposable-test-password')
        cloud.relay.handle('POST','/market/v1/keys',session['token'],{'keys':record})
        threading.Thread(target=cloud.serve_forever,daemon=True).start()
        class Device(server.Handler):
            def log_message(self,*args):pass
            def do_GET(self):
                if self.path=='/test/key-match':
                    data=json.dumps({'matches':server.features(self.server).market.data_key()==key}).encode()
                    self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
                else:super().do_GET()
        device=ThreadingHTTPServer(('127.0.0.1',0),Device)
        device.apps_root=Path(home)/'apps';device.apps_root.mkdir()
        device.settings_path=Path(home)/'state/settings.json';device.settings_path.parent.mkdir()
        device.is_simulator=True
        features=server.features(device)
        features.connect.configure({'relay_url':base,'name':'Disposable test device'})
        print(json.dumps({'device':'http://127.0.0.1:'+str(device.server_port),'phone':base}),flush=True)
        try:device.serve_forever()
        finally:cloud.shutdown();cloud.relay.close()
