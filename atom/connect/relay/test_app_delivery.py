import json
import unittest
from test_relay import RelayTests


class DeliveryTests(unittest.TestCase):
    setUp = RelayTests.setUp
    tearDown = RelayTests.tearDown
    call = RelayTests.call
    register = RelayTests.register
    denied = RelayTests.denied

    def link(self, client, username='delivery-user'):
        try:
            who = self.relay.marketplace.handle('POST', '/market/v1/register', body={'username': username, 'password': 'fixture1234'})
        except Exception:
            who = self.relay.marketplace.handle('POST', '/market/v1/login', body={'username': username, 'password': 'fixture1234'})
        self.call(client, '/v1/account/link', {'market_token': who['token']})
        return who

    def test_ack_required_private_ownership_immutable_delivery(self):
        user = self.link(self.pc); self.link(self.device)
        from marketplace.creation_prompt import starter
        source = starter('测试应用')
        draft = self.relay.marketplace.handle('POST', '/market/v1/drafts', user['token'], {'title':'测试应用','category':'play','license':'MIT','bundle':source})['draft']
        request = dict(device_id=self.device['client_id'], draft_id=draft['id'], request_id='install-request-1', confirm=True)
        delivery = self.call(self.pc, '/v1/apps/install', request)['delivery']
        self.assertEqual(delivery['status'], 'queued')
        self.assertEqual(self.call(self.pc, '/v1/apps/install', request)['delivery'], delivery)
        self.denied(lambda: self.call(self.pc, '/v1/apps/install', dict(request, device_id=self.stranger['client_id'])),404)
        self.link(self.otherpc, 'different-user')
        self.denied(lambda: self.call(self.otherpc, '/v1/apps/install', dict(request,request_id='other-request')),404)
        self.denied(lambda: self.call(self.pc, '/v1/apps/ack', {'id':delivery['id'],'status':'installed'}),403)
        self.assertEqual(self.call(self.device,'/v1/apps/pending')['delivery']['source']['bundle'],source)
        changed = dict(source,files=dict(source['files'],extra='later edit'))
        self.relay.marketplace.handle('POST','/market/v1/drafts/'+draft['id']+'/save',user['token'],{'revision':1,'bundle':changed})
        self.assertEqual(self.call(self.device,'/v1/apps/pending')['delivery']['source']['bundle'],source)
        self.call(self.device,'/v1/apps/ack',{'id':delivery['id'],'status':'installed'})
        self.assertIsNone(self.call(self.device,'/v1/apps/pending')['delivery'])
        self.assertEqual(self.call(self.pc,'/v1/apps/deliveries')['deliveries'][0]['status'],'installed')
        self.assertEqual(self.relay.one('SELECT bundle FROM app_deliveries WHERE id=?',(delivery['id'],))['bundle'],'{}')
        self.assertEqual(self.call(self.device,'/v1/apps/ack',{'id':delivery['id'],'status':'failed'})['delivery']['status'],'installed')


del RelayTests
