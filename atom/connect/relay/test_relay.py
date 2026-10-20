import importlib.util
import os
import http.client
import json
import threading
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('atom_relay', os.path.join(os.path.dirname(__file__), 'server.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Relay, ApiError = module.Relay, module.ApiError


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, 'state.db')
        self.now = [1000]
        self.relay = Relay(self.path, clock=lambda: self.now[0])
        self.device = self.register('device')
        self.pc = self.register('computer')
        self.stranger = self.register('device')
        self.otherpc = self.register('computer')

    def tearDown(self):
        self.relay.close()
        self.tmp.cleanup()

    def call(self, client, path, body=None, method=None):
        return self.relay.handle(method or ('GET' if body is None else 'POST'), path, client['token'], body)

    def register(self, role):
        return self.relay.handle('POST', '/v1/clients/register', body={'role': role, 'name': role})

    def pair(self):
        code = self.call(self.device, '/v1/pair/code', {})['code']
        claim = self.call(self.pc, '/v1/pair/claim', {'code': code})
        self.call(self.device, '/v1/pair/confirm', {'request_id': claim['request_id'], 'accept': True})
        self.call(self.pc, '/v1/computer/state', {'projects': [{'id': 'project', 'name': 'Demo', 'path': '/secret'}], 'agents': [{'id': 'codex', 'name': 'Codex', 'available': True, 'authenticated': True}]})

    def create(self, **kw):
        data = dict(request_id='r1', computer_id=self.pc['client_id'], project_id='project', agent_id='codex', prompt='Do a useful task')
        data.update(kw)
        return self.call(self.device, '/v1/tasks', data)['task']

    def event(self, task, eid, kind='status', **kw):
        data = dict(event_id=eid, type=kind)
        data.update(kw)
        return self.call(self.pc, '/v1/tasks/'+task['id']+'/events', data)['event']

    def denied(self, fn, status):
        with self.assertRaises(ApiError) as caught:
            fn()
        self.assertEqual(caught.exception.status, status)

    def test_pair_confirmation_replay_expiry_and_hashes(self):
        code = self.call(self.device, '/v1/pair/code', {})['code']
        claim = self.call(self.pc, '/v1/pair/claim', {'code': code})
        self.assertEqual(self.call(self.device, '/v1/state')['paired'], [])
        self.denied(lambda: self.call(self.pc, '/v1/pair/claim', {'code': code}), 409)
        self.denied(lambda: self.call(self.stranger, '/v1/pair/confirm', {'request_id': claim['request_id'], 'accept': True}), 409)
        self.now[0] += 301
        self.denied(lambda: self.call(self.device, '/v1/pair/confirm', {'request_id': claim['request_id'], 'accept': True}), 409)
        self.assertNotIn(self.device['token'], str([tuple(r) for r in self.relay.rows('SELECT * FROM clients')]))
        self.assertNotIn(code, str([tuple(r) for r in self.relay.rows('SELECT * FROM codes')]))

    def test_task_isolation_and_idempotency(self):
        self.pair()
        t = self.create()
        self.assertEqual(self.create(prompt='Changed payload')['id'], t['id'])
        self.assertEqual(len(self.call(self.pc, '/v1/computer/commands')['commands']), 1)
        for client in (self.stranger, self.otherpc):
            self.denied(lambda: self.call(client, '/v1/tasks/'+t['id']+'/events'), 404)
            self.denied(lambda: self.call(client, '/v1/tasks/'+t['id']+'/cancel', {}), 404)
        self.denied(lambda: self.call(self.otherpc, '/v1/tasks/'+t['id']+'/events', {'event_id': 'a', 'type': 'result'}), 404)
        self.denied(lambda: self.call(self.stranger, '/v1/tasks', dict(request_id='a', computer_id=self.pc['client_id'], project_id='project', agent_id='codex', prompt='x')), 403)
        host = self.call(self.device, '/v1/state')['paired'][0]
        self.assertNotIn('path', host['projects'][0])

    def test_events_approvals_and_terminal_lifecycle(self):
        self.pair()
        t = self.create()
        a = self.event(t, 'a', status='running')
        self.assertEqual(self.event(t, 'a', status='failed'), a)
        self.denied(lambda: self.event(t, 'bad', status='completed'), 400)
        self.denied(lambda: self.call(self.device, '/v1/tasks/'+t['id']+'/approve', {'request_id': 'missing', 'decision': 'accept'}), 409)
        self.event(t, 'b', kind='approval', approval=dict(request_id='p1', title='Allow command?', detail='Known command', choices=['accept', 'decline']))
        self.call(self.device, '/v1/tasks/'+t['id']+'/approve', dict(request_id='p1', decision='decline'))
        self.denied(lambda: self.call(self.device, '/v1/tasks/'+t['id']+'/approve', dict(request_id='p1', decision='accept')), 409)
        commands = self.call(self.pc, '/v1/computer/commands')['commands']
        self.assertEqual(commands[-1]['type'], 'approval.response')
        self.denied(lambda: self.call(self.otherpc, '/v1/computer/commands/ack', dict(command_id=commands[0]['id'])), 404)
        self.event(t, 'c', kind='result', text='Done')
        events = self.call(self.device, '/v1/tasks/'+t['id']+'/events?after=1')
        self.assertEqual([e['seq'] for e in events['events']], [2, 3])
        self.assertEqual(events['task']['status'], 'completed')
        self.denied(lambda: self.event(t, 'd', kind='delta', text='late'), 409)

    def test_offline_and_restart_persistence(self):
        self.pair()
        t = self.create()
        self.event(t, 'a', status='running', session_id='session1')
        self.call(self.device, '/v1/tasks/'+t['id']+'/cancel', {})
        self.call(self.device, '/v1/tasks/'+t['id']+'/cancel', {})
        self.assertEqual(len(self.call(self.pc, '/v1/computer/commands')['commands']), 2)
        self.relay.close()
        self.relay = Relay(self.path, clock=lambda: self.now[0])
        self.assertEqual(self.call(self.device, '/v1/tasks/'+t['id']+'/events')['task']['status'], 'running')
        self.assertEqual(len(self.call(self.pc, '/v1/computer/commands')['commands']), 2)
        self.create(request_id='next', session_id='session1')
        self.denied(lambda: self.create(request_id='wrong', session_id='unknown-session'), 409)
        self.now[0] += 46
        self.assertFalse(self.call(self.device, '/v1/state')['paired'][0]['online'])
        self.denied(lambda: self.create(request_id='offline'), 409)

    def test_computer_activity_allowlist_pairing_and_old_client_compatibility(self):
        self.pair()
        activity=dict(id='opaque-activity-1',type='app-modify',status='running',updated_at=1000,title='Private title',prompt='Private prompt',source='Private source',user='private-user')
        heartbeat=dict(projects=[],agents=[],activity=activity)
        self.call(self.pc,'/v1/computer/state',heartbeat)
        paired=self.call(self.device,'/v1/state')['paired'][0]
        self.assertEqual(paired['activity'],dict(id='opaque-activity-1',type='app-modify',status='running',updated_at=1000))
        self.assertEqual(self.call(self.stranger,'/v1/state')['paired'],[])
        for invalid in (dict(activity,status='waiting_approval'),dict(activity,type='admin'),dict(activity,updated_at=float('nan')),dict(activity,updated_at=True),dict(activity,id='../path'),[],False):
            self.denied(lambda:self.call(self.pc,'/v1/computer/state',dict(projects=[],agents=[],activity=invalid)),400)
        self.call(self.pc,'/v1/computer/state',dict(projects=[],agents=[]))
        self.assertNotIn('activity',self.call(self.device,'/v1/state')['paired'][0])

    def test_device_bridge_app_kind_and_artifact_action(self):
        bridge_path = os.path.join(os.path.dirname(__file__), '..', '..', 'relay_bridge.py')
        bs = importlib.util.spec_from_file_location('artifact_bridge_test', bridge_path)
        bm = importlib.util.module_from_spec(bs)
        bs.loader.exec_module(bm)
        bridge = bm.DeviceBridge(os.path.join(self.tmp.name, 'device'))
        calls = []
        def request(path, data=None):
            calls.append((path, data))
            return {'artifact': {'files': {}}}
        bridge._request = request
        bridge.execute('create-task', dict(request_id='request1', computer_id='computer1', project_id='project1', agent_id='codex', prompt='Build app', kind='app'))
        self.assertEqual(calls[-1][1]['kind'], 'app')
        self.assertEqual(bridge.execute('artifact', {'task_id':'task1'}), {'artifact':{'files':{}}})
        self.assertEqual(calls[-1], ('/v1/tasks/task1/artifact', None))
        with self.assertRaises(bm.BridgeError):
            bridge.execute('create-task', {'kind':'unknown'})
        with self.assertRaises(bm.BridgeError):
            bridge.execute('artifact', {'task_id':'../secret'})

    def test_app_artifact_owner_result_and_restart(self):
        self.pair()
        t = self.create(kind='app')
        route = '/v1/tasks/'+t['id']+'/artifact'
        self.denied(lambda: self.call(self.device, route), 409)
        bundle = {'manifest': {'id': 'demo', 'name': 'Demo'}, 'files': {'index.html': '<p>你好</p>'}}
        self.denied(lambda: self.call(self.device, '/v1/tasks/'+t['id']+'/events', dict(event_id='fake', type='result', artifact=bundle)), 404)
        self.denied(lambda: self.call(self.otherpc, '/v1/tasks/'+t['id']+'/events', dict(event_id='fake', type='result', artifact=bundle)), 404)
        self.denied(lambda: self.event(t, 'wrong-event', kind='delta', artifact=bundle), 400)
        self.denied(lambda: self.event(t, 'wrong-status', kind='result', status='failed', artifact=bundle), 400)
        result = self.event(t, 'result', kind='result', text='App ready', artifact=bundle)
        self.assertEqual(result['artifact'], bundle)
        self.assertEqual(self.call(self.device, route), {'artifact': bundle})
        self.assertEqual(self.call(self.pc, route), {'artifact': bundle})
        self.denied(lambda: self.call(self.stranger, route), 404)
        self.denied(lambda: self.call(self.otherpc, route), 404)
        state = self.call(self.device, '/v1/state')['tasks'][0]
        self.assertTrue(state['artifact_available'])
        self.assertNotIn('artifact', state)
        self.relay.close()
        self.relay = Relay(self.path, clock=lambda: self.now[0])
        self.assertEqual(self.call(self.device, route)['artifact'], bundle)
        self.assertEqual(self.event(t, 'result', kind='result', artifact=bundle), result)

    def test_artifact_kind_missing_and_utf8_size(self):
        self.pair()
        self.denied(lambda: self.create(kind='invalid'), 400)
        ordinary = self.create()
        self.denied(lambda: self.event(ordinary, 'invalid', kind='result', artifact={}), 400)
        self.event(ordinary, 'result', kind='result', text='Done')
        self.denied(lambda: self.call(self.device, '/v1/tasks/'+ordinary['id']+'/artifact'), 409)
        app = self.create(request_id='app', kind='app')
        self.denied(lambda: self.event(app, 'oversize', kind='result', artifact={'x':'中'*32768}), 413)
        self.denied(lambda: self.event(app, 'invalid', kind='result', artifact=[]), 400)
        self.denied(lambda: self.event(app, 'nan', kind='result', artifact={'x':float('nan')}), 400)
        self.event(app, 'done', kind='result', text='No artifact produced')
        self.denied(lambda: self.call(self.device, '/v1/tasks/'+app['id']+'/artifact'), 409)

    def test_approval_transition_guards_and_history_quota(self):
        self.pair()
        t = self.create()
        self.event(t, 'start', status='running')
        self.denied(lambda: self.event(t, 'fake-wait', status='waiting_approval'), 409)
        self.event(t, 'approval', kind='approval', approval=dict(request_id='a', title='Permit?', detail='', choices=['accept', 'decline']))
        self.denied(lambda: self.event(t, 'bypass', status='running'), 409)
        self.denied(lambda: self.event(t, 'bypass-delta', kind='delta', status='running', text='no'), 409)
        self.denied(lambda: self.event(t, 'early-result', kind='result', text='no'), 409)
        self.assertEqual(self.call(self.device, '/v1/tasks/'+t['id']+'/events')['task']['status'], 'waiting_approval')
        self.event(t, 'cancelled', kind='error', status='cancelled', text='Cancelled')
        old = module.MAX_DEVICE_TASKS
        try:
            module.MAX_DEVICE_TASKS = 1
            self.denied(lambda: self.create(request_id='over-quota'), 503)
            self.assertEqual(self.create()['id'], t['id'])
        finally:
            module.MAX_DEVICE_TASKS = old
        self.assertEqual(self.relay.one('PRAGMA max_page_count')[0], 65536)

    def test_event_quota_keeps_terminal_event_capacity(self):
        self.pair()
        t = self.create()
        old = module.MAX_TASK_EVENTS
        try:
            module.MAX_TASK_EVENTS = 1
            self.event(t, 'first', status='running')
            self.denied(lambda: self.event(t, 'excess', kind='delta', text='x'), 413)
            self.event(t, 'finish', kind='result', text='Finished without losing terminal event')
        finally:
            module.MAX_TASK_EVENTS = old

    def test_http_auth_json_and_rate_limits(self):
        server = module.ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        server.relay = self.relay
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        def request(method, path, body=None, headers=None):
            conn = http.client.HTTPConnection(*server.server_address, timeout=3)
            conn.request(method, path, body, headers or {})
            res = conn.getresponse()
            result = (res.status, json.loads(res.read()))
            conn.close()
            return result
        try:
            self.assertEqual(request('GET', '/v1/state')[0], 401)
            self.assertEqual(request('POST', '/v1/clients/register', '{}', {'Content-Type':'application/json', 'Origin':'https://attacker.example'})[0], 403)
            self.assertEqual(request('GET', '/v1/state', headers={'Authorization': 'Bearer '+self.device['token']})[0], 200)
            self.assertEqual(request('POST', '/v1/clients/register', '{}')[0], 415)
            self.assertEqual(request('POST', '/v1/clients/register', '{', {'Content-Type':'application/json'})[0], 400)
            self.assertEqual(request('POST', '/v1/clients/register', 'x'*131073, {'Content-Type':'application/json'})[0], 413)
            server.rate_buckets = {('127.0.0.1', '/v1/pair/claim'): (module.time.monotonic(), 30)}
            self.assertEqual(request('POST', '/v1/pair/claim', '{}', {'Content-Type':'application/json'})[0], 429)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_auth_roles_and_bounds(self):
        self.denied(lambda: self.relay.handle('GET', '/v1/state', self.device['client_id']), 401)
        self.denied(lambda: self.call(self.pc, '/v1/pair/code', {}), 403)
        self.denied(lambda: self.call(self.device, '/v1/computer/state', {}), 403)
        self.pair()
        self.denied(lambda: self.create(prompt='x'*16001), 400)
        self.denied(lambda: self.create(project_id='/etc/passwd'), 409)
        self.assertEqual(self.call(self.device, '/v1/state')['tasks'], [])


if __name__ == '__main__':
    unittest.main()
