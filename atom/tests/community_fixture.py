"""Disposable real relay + device backends for creator browser tests. No real accounts/AI."""
import json
import sys
import tempfile
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer

ATOM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ATOM / 'connect'))
sys.path.insert(0, str(ATOM))
from relay.server import Relay, Handler as RelayHandler
import server

class FakeAI:
    def submit(self, user, body):
        self.messages = body['messages']
        return {'job_id': 'fixture'}
    def result(self, user, job):
        patch = {'files': {'index.html': '<!doctype html><html><body><h1>会变色的天气窗</h1><button onclick="this.textContent=\'雨天\'">晴天</button></body></html>'}}
        return {'status': 'completed', 'result': {'choices': [{'message': {'content': json.dumps(patch)}}]}}

with tempfile.TemporaryDirectory(prefix='atom-community-fixture-') as temp:
    temp = str(Path(temp).resolve())
    relay = Relay(str(Path(temp)/'relay.db'))
    relay.marketplace.community.ai = FakeAI()
    cloud = ThreadingHTTPServer(('127.0.0.1',0),RelayHandler);cloud.relay=relay
    cloud_url='http://127.0.0.1:'+str(cloud.server_port)
    threading.Thread(target=cloud.serve_forever,daemon=True).start()
    def market(path, data=None, who=None):
        return relay.handle('POST' if data is not None else 'GET','/market/v1'+path,(who or {}).get('token',''),data)
    alice=market('/register',{'username':'fixture-alice','password':'fixture1234'})
    bob=market('/register',{'username':'fixture-bob','password':'fixture1234'})
    from marketplace.creation_prompt import starter
    b=starter('天气之窗');b['files']['index.html']='<html><head></head><body><h1>天气之窗</h1><button onclick="this.textContent=\'雨天\'">晴天</button></body></html>'
    draft=market('/drafts',{'title':'天气之窗','description':'切换晴雨，做一扇自己的天气窗','category':'life','license':'MIT','bundle':b},alice)['draft']
    published=market('/drafts/'+draft['id']+'/publish',{'revision':1,'confirm':True,'changelog':'测试用天气窗'},alice)
    pc=relay.handle('POST','/v1/clients/register',body={'role':'computer','name':'测试 Mac'})
    relay.handle('POST','/v1/account/link',pc['token'],{'market_token':bob['token']})
    device=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
    device.apps_root=Path(temp)/'apps';device.settings_path=Path(temp)/'state/settings.json'
    server.save_settings(device.settings_path,False)
    service=server.features(device)
    service.connect.configure({'relay_url':cloud_url,'name':'测试 ATOM'})
    service.market.save(dict(relay_url=cloud_url,token=bob['token'],user=bob['user']))
    service.market.link_account()
    server.install_app(device.apps_root,json.loads((ATOM/'examples/market.json').read_text()),trusted_connect=True)
    threading.Thread(target=device.serve_forever,daemon=True).start()
    print(json.dumps(dict(relay=cloud_url,device='http://127.0.0.1:'+str(device.server_port),alice=alice,bob=bob,pc=pc,work=published['work']['id'],device_id=service.connect.config['client_id'])),flush=True)
    try: sys.stdin.read()
    finally:
        cloud.shutdown();device.shutdown();cloud.server_close();device.server_close();relay.close()
