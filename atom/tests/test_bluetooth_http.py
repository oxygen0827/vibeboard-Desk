import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import bluetooth_pairing

class Worker:
    def __init__(self,address,receive):self.receive=receive;self.messages=[]
    def send(self,data):self.messages.append(data)
    def alive(self):return True
    def kill(self):pass

class BluetoothHTTP(unittest.TestCase):
    def setUp(self):
        self.workers=[]
        def factory(*args):
            w=Worker(*args);self.workers.append(w);return w
        self.manager=bluetooth_pairing.PairingManager(factory,watchdog=False)
        self.patch=mock.patch.object(bluetooth_pairing,'manager',return_value=self.manager);self.patch.start();self.addCleanup(self.patch.stop)
        self.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.http.is_simulator=False
        threading.Thread(target=self.http.serve_forever,daemon=True).start()
        self.addCleanup(self.http.server_close);self.addCleanup(self.http.shutdown)
        self.base='http://127.0.0.1:'+str(self.http.server_port)
    def post(self,action,data,origin=True):
        headers={'Content-Type':'application/json'}
        if origin:headers['Origin']=self.base
        req=urllib.request.Request(self.base+'/api/bluetooth/'+action,data=json.dumps(data).encode(),headers=headers)
        try:r=urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:r=e
        with r:return r.status,json.load(r)
    def test_simulator_and_cross_origin_cannot_start_pairing(self):
        data={'address':'AA:BB:CC:DD:EE:01','id':'a'*32,'confirm':True}
        self.assertEqual(self.post('pair-start',data,origin=False)[0],403)
        self.http.is_simulator=True
        for action in ['pair-start','pair-status','pair-respond','pair-cancel','connect']:
            self.assertEqual(self.post(action,data)[0],400)
        self.assertEqual(self.workers,[])
    def test_confirmed_start_prompt_response_cancel_and_retry(self):
        data={'address':'AA:BB:CC:DD:EE:01','id':'a'*32}
        self.assertEqual(self.post('pair-start',data)[0],400)
        data['confirm']=True
        self.assertEqual(self.post('pair-start',data)[1]['pairing']['state'],'starting')
        self.workers[0].receive({'state':'waiting','challenge':{'id':1,'kind':'pin'}})
        self.assertEqual(self.post('pair-status',{'id':data['id']})[1]['pairing']['challenge']['kind'],'pin')
        code,body=self.post('pair-respond',{'id':data['id'],'challenge':1,'value':'abc123'})
        self.assertEqual(code,200);self.assertNotIn('abc123',str(body))
        self.assertEqual(self.post('pair-respond',{'id':data['id'],'challenge':1,'value':'abc123'})[0],400)
        self.assertEqual(self.post('pair-cancel',{'id':data['id']})[1]['pairing']['state'],'cancelled')
        self.assertEqual(self.post('pair-start',data)[1]['pairing']['state'],'cancelled')
        self.assertEqual(len(self.workers),1)

if __name__=='__main__':unittest.main()
