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

    def test_unpair_from_either_side_stops_pending_work(self):
        self.pair()
        queued = self.create(request_id='queued')
        self.denied(lambda: self.call(self.stranger, '/v1/pair/remove', {'client_id': self.pc['client_id']}), 404)
        self.call(self.device, '/v1/pair/remove', {'client_id': self.pc['client_id']})
        self.assertEqual(self.call(self.device, '/v1/state')['paired'], [])
        self.assertEqual(self.call(self.pc, '/v1/state')['paired'], [])
        self.assertEqual(self.call(self.pc, '/v1/computer/commands')['commands'], [], 'undelivered start is withdrawn')
        self.assertEqual(self.call(self.device, '/v1/tasks/'+queued['id']+'/events')['task']['status'], 'cancelled')
        self.denied(lambda: self.create(request_id='after'), 403)
        self.denied(lambda: self.call(self.device, '/v1/pair/remove', {'client_id': self.pc['client_id']}), 404)
        # A task already running on the computer gets a cancel command; the computer reports the end.
        self.pair()
        running = self.create(request_id='running')
        for command in self.call(self.pc, '/v1/computer/commands')['commands']:
            self.call(self.pc, '/v1/computer/commands/ack', {'command_id': command['id']})
        self.event(running, 'e1', status='running')
        self.call(self.pc, '/v1/pair/remove', {'client_id': self.device['client_id']})
        self.assertEqual([c['type'] for c in self.call(self.pc, '/v1/computer/commands')['commands']], ['task.cancel'])
        self.event(running, 'e2', 'error', status='cancelled')

    def test_key_exchange_and_encrypted_tasks_refuse_plaintext(self):
        pk = lambda c: c*43
        env = lambda: {'v': 1, 'iv': 'A'*16, 'ct': 'B'*40}
        code = self.call(self.device, '/v1/pair/code', {})['code']
        claim = self.call(self.pc, '/v1/pair/claim', {'code': code, 'public_key': pk('c')})
        self.denied(lambda: self.call(self.device, '/v1/pair/confirm', {'request_id': claim['request_id'], 'accept': True, 'public_key': 'short'}), 400)
        self.call(self.device, '/v1/pair/confirm', {'request_id': claim['request_id'], 'accept': True, 'public_key': pk('d')})
        self.call(self.pc, '/v1/computer/state', {'projects': [{'id': 'project', 'name': 'Demo'}], 'agents': [{'id': 'codex', 'name': 'Codex', 'available': True, 'authenticated': True}]})
        host = self.call(self.device, '/v1/state')['paired'][0]
        self.assertEqual((host['public_key'], host['own_key']), (pk('c'), pk('d')))
        self.assertEqual(self.call(self.pc, '/v1/state')['paired'][0]['public_key'], pk('d'))
        self.denied(lambda: self.create(), 400)
        t = self.call(self.device, '/v1/tasks', dict(request_id='r1', computer_id=self.pc['client_id'], project_id='project', agent_id='codex', enc_prompt=env()))['task']
        self.assertTrue(t['e2e'])
        self.assertNotIn('prompt', t)
        self.assertEqual(t['request_id'], 'r1')
        self.denied(lambda: self.event(t, 'plain', text='leak'), 400)
        self.denied(lambda: self.event(t, 'bad', enc_text={'v': 1, 'iv': 'A'*16, 'ct': 'not base64!'}), 400)
        e = self.event(t, 'e1', enc_text=env(), status='running')
        self.assertNotIn('text', e)
        self.denied(lambda: self.event(t, 'a0', 'approval', approval={'request_id': 'q', 'title': 'leak', 'choices': ['accept', 'decline']}), 400)
        self.event(t, 'a1', 'approval', approval={'request_id': 'q', 'enc_title': env(), 'enc_detail': env(), 'choices': ['accept', 'decline']})
        # Keys of an existing pairing are set once and cannot be swapped silently.
        self.denied(lambda: self.call(self.pc, '/v1/pair/keys', {'client_id': self.device['client_id'], 'public_key': pk('x')}), 409)
        self.call(self.pc, '/v1/pair/keys', {'client_id': self.device['client_id'], 'public_key': pk('c')})

    def test_existing_pairing_publishes_keys_later(self):
        self.pair()
        self.assertIsNone(self.call(self.device, '/v1/state')['paired'][0]['public_key'])
        self.create(request_id='plain')
        self.call(self.device, '/v1/pair/keys', {'client_id': self.pc['client_id'], 'public_key': 'd'*43})
        self.create(request_id='still-plain')
        self.call(self.pc, '/v1/pair/keys', {'client_id': self.device['client_id'], 'public_key': 'c'*43})
        self.denied(lambda: self.create(request_id='now-encrypted'), 400)
        self.denied(lambda: self.call(self.stranger, '/v1/pair/keys', {'client_id': self.pc['client_id'], 'public_key': 'e'*43}), 404)

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
            self.assertEqual(request('POST', '/v1/clients/register', 'x'*(module.MAX_BODY+1), {'Content-Type':'application/json'})[0], 413)
            server.rate_buckets = {('127.0.0.1', '/v1/clients/register'): (module.time.monotonic()-120, 10)}
            self.assertEqual(request('POST', '/v1/clients/register', '{"role":"device","name":"x"}', {'Content-Type':'application/json'})[0], 429, 'registration window is hourly, not per minute')
            server.rate_buckets = {('127.0.0.1', '/v1/pair/claim'): (module.time.monotonic(), 30)}
            self.assertEqual(request('POST', '/v1/pair/claim', '{}', {'Content-Type':'application/json'})[0], 429)
            spoof = {'Content-Type':'application/json', 'X-Real-IP':'203.0.113.9'}
            self.assertEqual(request('POST', '/v1/pair/claim', '{}', spoof)[0], 429, 'untrusted peers cannot choose their rate-limit key')
            server.trusted_proxies = module.trusted_networks(['127.0.0.0/8'])
            self.assertNotEqual(request('POST', '/v1/pair/claim', '{}', spoof)[0], 429)
            server.rate_buckets[('203.0.113.9', '/v1/pair/claim')] = (module.time.monotonic(), 30)
            self.assertEqual(request('POST', '/v1/pair/claim', '{}', spoof)[0], 429)
            self.assertNotEqual(request('POST', '/v1/pair/claim', '{}', {'Content-Type':'application/json', 'X-Real-IP':'198.51.100.7'})[0], 429)
            self.assertEqual(request('POST', '/v1/pair/claim', '{}', {'Content-Type':'application/json', 'X-Real-IP':'bogus'})[0], 429, 'invalid proxy header falls back to the proxy address')
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_same_account_discovery_and_invite(self):
        alice = self.relay.handle('POST', '/market/v1/register', body={'username': 'alice', 'password': 'long-test-password-a'})
        bob = self.relay.handle('POST', '/market/v1/register', body={'username': 'bobby', 'password': 'long-test-password-b'})
        self.assertEqual(self.call(self.pc, '/v1/account/peers'), {'linked': False, 'peers': []})
        self.denied(lambda: self.call(self.pc, '/v1/account/link', {'market_token': 'x' * 40}), 401)
        for client in (self.device, self.pc):
            self.call(client, '/v1/account/link', {'market_token': alice['token']})
        self.call(self.stranger, '/v1/account/link', {'market_token': bob['token']})
        peers = self.call(self.pc, '/v1/account/peers')['peers']
        self.assertEqual([p['client_id'] for p in peers], [self.device['client_id']], 'only same-account devices are listed')
        self.assertFalse(peers[0]['paired'])
        self.denied(lambda: self.call(self.pc, '/v1/pair/invite', {'device_id': self.stranger['client_id']}), 404)
        self.denied(lambda: self.call(self.otherpc, '/v1/pair/invite', {'device_id': self.device['client_id']}), 404)
        self.denied(lambda: self.call(self.device, '/v1/pair/invite', {'device_id': self.device['client_id']}), 403)
        invite = self.call(self.pc, '/v1/pair/invite', {'device_id': self.device['client_id']})
        self.assertTrue(self.call(self.pc, '/v1/account/peers')['peers'][0]['pending'])
        requests = self.call(self.device, '/v1/state')['pair_requests']
        self.assertEqual([r['request_id'] for r in requests], [invite['request_id']], 'the device still has to confirm')
        self.assertEqual(self.call(self.pc, '/v1/state')['paired'], [])
        self.call(self.device, '/v1/pair/confirm', {'request_id': invite['request_id'], 'accept': True})
        self.assertTrue(self.call(self.pc, '/v1/account/peers')['peers'][0]['paired'])
        self.denied(lambda: self.call(self.pc, '/v1/pair/invite', {'device_id': self.device['client_id']}), 409)
        self.call(self.device, '/v1/account/unlink', {})
        self.assertEqual(self.call(self.pc, '/v1/account/peers')['peers'], [])

    def test_official_ai_jobs_are_metered_per_account(self):
        import time as _time
        from unittest import mock
        alice = self.relay.handle('POST', '/market/v1/register', body={'username': 'alice', 'password': 'long-test-password-a'})
        bob = self.relay.handle('POST', '/market/v1/register', body={'username': 'bobby', 'password': 'long-test-password-b'})
        ai = lambda token, method, path, body=None: self.relay.handle(method, path, token, body)
        def refused(fn, status):
            with self.assertRaises(module.MarketError) as caught:
                fn()
            self.assertEqual(caught.exception.status, status)
        msg = {'purpose': 'generate', 'messages': [{'role': 'user', 'content': '做一个计时器'}], 'json': True}
        with mock.patch.dict(os.environ, {'ATOM_AI_ZHIPU_KEY': '', 'ATOM_AI_QUOTA_GENERATE': '2'}):
            refused(lambda: ai(alice['token'], 'POST', '/market/v1/ai/jobs', msg), 503)
        seen = []
        def fake(key, payload):
            seen.append((key, payload))
            if payload['messages'][-1]['content'] == 'fail':
                raise module.MarketError(502, 'upstream down')
            return {'choices': [{'message': {'role': 'assistant', 'content': '{}'}, 'finish_reason': 'stop'}]}
        self.relay.ai.call = fake
        def wait(token, job):
            for _ in range(100):
                r = ai(token, 'GET', '/market/v1/ai/jobs/' + job)
                if r['status'] != 'running':
                    return r
                _time.sleep(0.01)
        with mock.patch.dict(os.environ, {'ATOM_AI_ZHIPU_KEY': 'server-key', 'ATOM_AI_QUOTA_GENERATE': '2', 'ATOM_AI_GENERATE_MODEL': 'glm-4.5-air'}):
            refused(lambda: ai('x' * 40, 'POST', '/market/v1/ai/jobs', msg), 401)
            job = ai(alice['token'], 'POST', '/market/v1/ai/jobs', msg)['job_id']
            refused(lambda: ai(bob['token'], 'GET', '/market/v1/ai/jobs/' + job), 404)
            done = wait(alice['token'], job)
            self.assertEqual(done['status'], 'completed')
            self.assertEqual(done['result']['choices'][0]['message']['content'], '{}')
            self.assertEqual(seen[0][0], 'server-key')
            self.assertEqual(seen[0][1]['model'], 'glm-4.5-air', 'the server picks the model, not the device')
            self.assertEqual(seen[0][1]['response_format'], {'type': 'json_object'})
            failed = wait(alice['token'], ai(alice['token'], 'POST', '/market/v1/ai/jobs', dict(msg, messages=[{'role': 'user', 'content': 'fail'}]))['job_id'])
            self.assertEqual(failed['status'], 'failed')
            self.assertEqual(ai(alice['token'], 'GET', '/market/v1/ai/quota')['generate']['used'], 1, 'failed calls are refunded')
            wait(alice['token'], ai(alice['token'], 'POST', '/market/v1/ai/jobs', msg)['job_id'])
            refused(lambda: ai(alice['token'], 'POST', '/market/v1/ai/jobs', msg), 429)
            self.assertEqual(ai(bob['token'], 'GET', '/market/v1/ai/quota')['generate']['remaining'], 2, 'quotas are per account')
            self.now[0] += 40 * 86400
            fresh = self.relay.handle('POST', '/market/v1/login', body={'username': 'alice', 'password': 'long-test-password-a'})
            self.assertEqual(ai(fresh['token'], 'GET', '/market/v1/ai/quota')['generate']['used'], 0, 'a new month starts fresh')

    def test_official_voice_proxy_streams_and_meters(self):
        from unittest import mock
        from http.server import BaseHTTPRequestHandler
        seen = []
        class Zhipu(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                seen.append((self.path, self.headers.get('Authorization'), body))
                if self.path == '/chat/completions' and b'bad words' in body:
                    data = b'{"error":{"code":"1301","message":"sensitive"}}'
                    self.send_response(400); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data); return
                if self.path == '/chat/completions':
                    self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                    for piece in ('[开心]你', '好呀'):
                        self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': {'content': piece}}]}, ensure_ascii=False) + '\n\n').encode()); self.wfile.flush()
                    self.wfile.write(b'data: [DONE]\n\n'); return
                data = b'RIFFfakewav'
                self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
            def log_message(self, *args):
                pass
        upstream = module.ThreadingHTTPServer(('127.0.0.1', 0), Zhipu)
        server = module.ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        server.relay = self.relay
        for s in (upstream, server):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        alice = self.relay.handle('POST', '/market/v1/register', body={'username': 'alice', 'password': 'long-test-password-a'})
        def post(path, body, token=alice['token'], kind='application/json'):
            conn = http.client.HTTPConnection(*server.server_address, timeout=5)
            conn.request('POST', '/market/v1/ai/zhipu' + path, body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode(), {'Authorization': 'Bearer ' + token, 'Content-Type': kind})
            res = conn.getresponse(); data = res.read(); conn.close()
            return res.status, data
        chat = {'model': 'glm-4.5-air', 'messages': [{'role': 'user', 'content': '你好'}], 'stream': True, 'max_tokens': 5000}
        env = {'ATOM_AI_ZHIPU_KEY': 'server-key', 'ATOM_AI_ZHIPU_BASE': 'http://%s:%d' % upstream.server_address, 'ATOM_AI_QUOTA_CHAT': '2', 'ATOM_AI_QUOTA_VOICE': '5'}
        try:
            with mock.patch.dict(os.environ, env):
                self.assertEqual(post('/chat/completions', chat, token='x' * 40)[0], 401)
                status, data = post('/chat/completions', chat)
                self.assertEqual(status, 200)
                self.assertIn('好呀', data.decode())
                path, auth, sent = seen[-1]
                self.assertEqual(auth, 'Bearer server-key', 'the device token never reaches the provider')
                self.assertEqual(json.loads(sent)['max_tokens'], 600)
                self.assertEqual(json.loads(sent)['thinking'], {'type': 'disabled'})
                status, data = post('/chat/completions', dict(chat, messages=[{'role': 'user', 'content': 'bad words'}]))
                self.assertEqual(status, 400)
                self.assertIn(b'1301', data, 'the content-filter code passes through for the robot')
                self.assertEqual(self.relay.ai.quota(alice['user']['id'])['chat']['used'], 1, 'rejected calls are refunded')
                self.assertEqual(post('/audio/speech', {'model': 'anything', 'input': '你好', 'voice': 'tongtong', 'response_format': 'wav'}), (200, b'RIFFfakewav'))
                self.assertEqual(json.loads(seen[-1][2])['model'], 'glm-tts')
                self.assertEqual(post('/audio/transcriptions', {'x': 1})[0], 415)
                self.assertEqual(post('/audio/transcriptions', b'--b\r\n', kind='multipart/form-data; boundary=b')[0], 200)
                post('/chat/completions', chat)
                status, data = post('/chat/completions', chat)
                self.assertEqual(status, 200)
                self.assertIn('额度用完', data.decode(), 'the robot says it in character when the month is used up')
                self.assertEqual(post('/nope', chat)[0], 404)
        finally:
            for s in (upstream, server):
                s.shutdown(); s.server_close()

    def test_system_releases_are_public_and_read_only(self):
        self.assertEqual(self.relay.handle('GET', '/market/v1/system/latest'), {}, 'no release published yet')
        folder = os.path.join(self.tmp.name, 'system'); os.makedirs(folder)
        with open(os.path.join(folder, 'latest.json'), 'w') as f: json.dump({'version': '2026.1.1', 'signature': 'x'}, f)
        with open(os.path.join(folder, '2026.1.1.tar.gz'), 'wb') as f: f.write(b'pkg')
        self.assertEqual(self.relay.handle('GET', '/market/v1/system/latest')['version'], '2026.1.1')
        self.assertEqual(self.relay.handle('GET', '/market/v1/system/package/2026.1.1')['data'], 'cGtn')
        for path in ('/market/v1/system/package/..%2Fstate', '/market/v1/system/package/9.9', '/market/v1/system/other'):
            with self.assertRaises(module.MarketError) as caught:
                self.relay.handle('GET', path)
            self.assertEqual(caught.exception.status, 404)
        with self.assertRaises(module.MarketError):
            self.relay.handle('POST', '/market/v1/system/latest', body={})

    def test_snapshot_encrypted_pair_scope_change_detection_and_removal(self):
        self.pair()
        envelope={'v':1,'iv':'A'*16,'ct':'B'*40}
        body={'computer_id':self.pc['client_id'],'version':'a'*64,'envelope':envelope}
        self.denied(lambda:self.call(self.device,'/v1/device/snapshot',body),403)
        for client,other in [(self.device,self.pc),(self.pc,self.device)]:
            self.call(client,'/v1/pair/keys',{'client_id':other['client_id'],'public_key':'A'*43})
        self.call(self.device,'/v1/device/snapshot',body)
        path='/v1/device/snapshot/'+self.device['client_id']
        self.assertEqual(self.call(self.pc,path)['envelope'],envelope)
        self.denied(lambda:self.call(self.otherpc,path),403)
        meta=self.call(self.pc,'/v1/state')['paired'][0]['snapshot']
        self.now[0]+=10
        self.call(self.device,'/v1/device/snapshot',body)
        self.assertEqual(self.call(self.pc,'/v1/state')['paired'][0]['snapshot'],meta)
        self.call(self.device,'/v1/device/snapshot/clear',{})
        self.denied(lambda:self.call(self.pc,path),404)
        self.call(self.device,'/v1/device/snapshot',body)
        self.call(self.device,'/v1/pair/remove',{'client_id':self.pc['client_id']})
        self.assertFalse(self.relay.one('SELECT 1 FROM snapshots'))

    def test_qr_login_hands_over_a_session_once(self):
        self.relay.handle('POST', '/market/v1/register', body={'username': 'alice', 'password': 'long-test-password-a'})
        qr = lambda action, body=None: self.relay.handle('POST', '/market/v1/qr-login/' + action, '', body or {})
        def refused(fn, status):
            with self.assertRaises(module.MarketError) as caught:
                fn()
            self.assertEqual(caught.exception.status, status)
        start = qr('start')
        self.assertEqual(qr('poll', {'poll': start['poll']})['status'], 'pending')
        refused(lambda: qr('approve', {'code': 'ZZZZZZZZ', 'username': 'alice', 'password': 'long-test-password-a', 'attempt':'x'*43}), 404)
        refused(lambda: qr('seal', {'code': start['code'], 'sealed': None}), 409)
        refused(lambda: qr('approve', {'code': start['code'], 'username': 'alice', 'password': 'wrong-password-xx', 'attempt':'x'*43}), 401)
        approved = qr('approve', {'code': start['code'], 'username': 'alice', 'password': 'long-test-password-a', 'attempt':'x'*43})
        self.assertEqual(approved['user'], {'username': 'alice'})
        refused(lambda: qr('approve', {'code': start['code'], 'username': 'alice', 'password': 'long-test-password-a', 'attempt':'y'*43}), 409)
        self.assertEqual(qr('poll', {'poll': start['poll']})['status'], 'signing-in')
        refused(lambda: qr('seal', {'code': start['code'], 'sealed': None}), 403)
        qr('seal', {'code': start['code'], 'handoff': approved['handoff'], 'sealed': {'v': 1, 'iv': 'A'*16, 'ct': 'B'*80}})
        ready = qr('poll', {'poll': start['poll']})
        self.assertEqual((ready['status'], ready['user']['username'], ready['sealed']['ct']), ('ready', 'alice', 'B'*80))
        self.assertEqual(self.relay.handle('GET', '/market/v1/me', ready['token'])['user']['username'], 'alice', 'a real session')
        self.assertEqual(qr('poll', {'poll': start['poll']}), ready, 'lost response can be retried')
        qr('ack', {'poll':start['poll']})
        self.assertEqual(qr('poll', {'poll':start['poll']})['status'], 'expired')
        late = qr('start')
        self.now[0] += 301
        self.assertEqual(qr('poll', {'poll': late['poll']})['status'], 'expired')
        refused(lambda: qr('approve', {'code': late['code'], 'username': 'alice', 'password': 'long-test-password-a', 'attempt':'x'*43}), 404)

    def test_qr_cancel_expiry_and_approval_retry(self):
        self.relay.handle('POST','/market/v1/register',body={'username':'phone','password':'long-test-password-a'})
        qr=lambda action,body={}:self.relay.handle('POST','/market/v1/qr-login/'+action,'',body)
        for mode in ('cancel','expire'):
            start=qr('start');body=dict(code=start['code'],username='phone',password='long-test-password-a',attempt='r'*43)
            approved=qr('approve',body)
            self.assertEqual(qr('approve',body),approved,'lost approval response is retryable')
            token=self.relay.qrlogin.requests[start['code']]['token']
            if mode=='cancel':qr('cancel',{'poll':start['poll']})
            else:self.now[0]+=301
            self.assertEqual(qr('poll',{'poll':start['poll']})['status'],'expired')
            with self.assertRaises(module.MarketError):self.relay.handle('GET','/market/v1/me',token)
        start=qr('start')
        self.assertEqual(qr('poll',{'poll':'z'*43})['status'],'expired')
        self.assertEqual(qr('poll',{'poll':start['poll']})['status'],'pending')
        with self.assertRaises(module.MarketError):qr('approve',[])

    def test_qr_login_page_and_web_origin(self):
        server = module.ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        server.relay = self.relay
        threading.Thread(target=server.serve_forever, daemon=True).start()
        def request(method, path, body=None, headers=None):
            conn = http.client.HTTPConnection(*server.server_address, timeout=3)
            conn.request(method, path, body, headers or {})
            res = conn.getresponse(); data = res.read(); conn.close()
            return res.status, res.getheader('Content-Security-Policy') or '', data
        try:
            status, csp, page = request('GET', '/login')
            self.assertEqual(status, 200)
            self.assertIn(b'qr-login', page)
            self.assertIn("frame-ancestors 'none'", csp)
            json_headers = {'Content-Type': 'application/json'}
            for origin in (None, 'https://evil.example'):
                headers = dict(json_headers, **({'Origin': origin} if origin else {}))
                self.assertEqual(request('POST', '/market/v1/qr-login/approve', '{}', headers)[0], 403, origin)
            self.assertEqual(request('POST', '/market/v1/qr-login/approve', '{"code":"ZZZZZZZZ"}', dict(json_headers, Origin=module.WEB_ORIGINS[0]))[0], 404)
            self.assertEqual(request('POST', '/market/v1/qr-login/start', '{}', dict(json_headers, Origin=module.WEB_ORIGINS[0]))[0], 403, 'only the page posts carry an origin')
        finally:
            server.shutdown(); server.server_close()

    def test_qr_registration_requires_recovery_and_preserves_keys_on_retry(self):
        from unittest.mock import patch
        qr = lambda action, body=None: self.relay.handle('POST', '/market/v1/qr-login/' + action, '', body or {})
        start = qr('start')
        envelope = {'v': 1, 'iv': 'A'*16, 'ct': 'B'*80}
        record = dict(v=1, key_id='C'*12, salt='D'*22, iterations=310000, by_password=envelope, by_recovery=envelope)
        body = dict(code=start['code'], attempt='x'*43, username='phone_new', password='long-test-password-a', mode='register', keys=record)
        with self.assertRaises(module.MarketError): qr('approve', body)
        self.assertIsNone(self.relay.marketplace.row('SELECT 1 FROM users WHERE username=?', ('phone_new',)))
        body['recovery_confirmed'] = True
        # The account is created once even if its first key write fails.
        original = self.relay.marketplace.handle
        def interrupted(method, path, *args, **kwargs):
            if method == 'POST' and path == '/market/v1/keys': raise RuntimeError('test write interrupted')
            return original(method, path, *args, **kwargs)
        with patch.object(self.relay.marketplace, 'handle', side_effect=interrupted):
            with self.assertRaises(RuntimeError): qr('approve', body)
        approved = qr('approve', body)
        self.assertEqual(qr('approve', body), approved)
        self.assertEqual(approved['keys'], record)
        self.assertEqual(self.relay.marketplace.row('SELECT COUNT(*) n FROM users WHERE username=?', ('phone_new',))['n'], 1)
        with self.assertRaises(module.MarketError): qr('seal', dict(code=start['code'], handoff=approved['handoff'], sealed=None))
        qr('seal', dict(code=start['code'], handoff=approved['handoff'], sealed=envelope))
        ready = qr('poll', {'poll': start['poll']})
        self.assertEqual(ready['key_id'], record['key_id'])
        self.assertEqual(ready['user']['username'], 'phone_new')
        # Cancel revokes access, without deleting the deliberately created account.
        qr('cancel', {'poll': start['poll']})
        with self.assertRaises(module.MarketError): self.relay.marketplace.handle('GET', '/market/v1/me', ready['token'])
        again = qr('start')
        with self.assertRaises(module.MarketError) as existing:
            qr('approve', dict(body, code=again['code']))
        self.assertEqual(existing.exception.code, 'username_unavailable')
        session = self.relay.marketplace.handle('POST', '/market/v1/login', body={'username':'phone_new','password':body['password']})
        self.assertEqual(self.relay.marketplace.handle('GET', '/market/v1/keys', session['token'])['keys'], record)

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
