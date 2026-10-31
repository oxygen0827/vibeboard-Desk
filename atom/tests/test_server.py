import importlib.util
import json
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('atom_server', str(Path(__file__).resolve().parents[1] / 'server.py'))
server = importlib.util.module_from_spec(spec); spec.loader.exec_module(server)

class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve() / 'apps'
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.http.apps_root = self.root
        self.http.settings_path = Path(self.temp.name).resolve() / 'state' / 'settings.json'
        server.save_settings(self.http.settings_path, True)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True); self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.http.server_port)

    def test_install_gate_rejects_undeclared_input_without_writing_files(self):
        package = self.package(); del package['manifest']['input']
        code, body = self.request('/api/apps/install', package)
        self.assertEqual(code, 400)
        self.assertIn('manifest.input', body.decode())
        self.assertFalse((self.root / 'demo').exists())

    def test_codex_pet_snapshot_is_same_origin_and_read_only(self):
        import codex_pet
        self.assertEqual(self.request('/api/codex-pet/state', {}, origin=False)[0], 403)
        code, body = self.request('/api/codex-pet/state', {})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), dict(tasks=[], error=''))
        self.assertFalse((self.http.settings_path.parent / 'codex-pet-desktop.json').exists())
        import time
        event = dict(hook_event_name='PermissionRequest', session_id='session', timestamp=time.time(), project='Demo')
        codex_pet.receive(self.http.settings_path.parent, event)
        result = json.loads(self.request('/api/codex-pet/state', {})[1])
        self.assertEqual(result['tasks'][0]['status'], 'needs_input')
        self.assertNotIn('token', result)

    def test_legacy_seed_remains_readable_but_updates_need_input_contract(self):
        package = self.package(); del package['manifest']['input']
        server.install_app(self.root, package, require_input=False)
        original = (self.root / 'demo' / 'manifest.json').read_bytes()
        self.assertIn('demo', [item['id'] for item in server.apps(self.root)])
        with self.assertRaises(ValueError): server.install_app(self.root, package, update=True)
        self.assertEqual((self.root / 'demo' / 'manifest.json').read_bytes(), original)

    def test_expired_workshop_job_is_not_a_retryable_bad_request(self):
        code,body=self.request('/api/workshop/jobs/'+'a'*32)
        self.assertEqual(code,404)
        self.assertIn('error',json.loads(body))
        self.assertEqual(self.request('/api/workshop/jobs/invalid')[0],400)

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.temp.cleanup()

    def request(self, path, data=None, origin=True):
        headers = {'Content-Type': 'application/json'}
        if origin: headers['Origin'] = self.url
        req = urllib.request.Request(self.url + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try: response = urllib.request.urlopen(req)
        except urllib.error.HTTPError as exc: response = exc
        return response.status, response.read()

    def package(self):
        return {'manifest': {'id': 'demo', 'name': 'Demo', 'entry': 'index.html', 'input': {'version':1,'profile':'five-way','back':'root'}}, 'files': {'index.html': '<h1>Hello</h1>', 'nested/main.js': 'hello'}}

    def test_sensor_endpoint_is_read_only_and_not_cross_origin(self):
        snapshot = {'version': 1, 'source': 'unavailable',
                    'available': {'presence': False, 'motion': False},
                    'presence': None, 'motion': None, 'updated_at': 0}
        self.http.sensors = mock.Mock()
        self.http.sensors.snapshot.return_value = snapshot
        with urllib.request.urlopen(self.url + '/api/sensors') as response:
            self.assertEqual(json.load(response), snapshot)
            self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
        self.assertNotEqual(self.request('/api/sensors', {'presence': True})[0], 200)


    def test_sensor_capability_survives_install_and_update(self):
        package = self.package()
        package['manifest']['capabilities'] = ['sensors']
        self.assertEqual(self.request('/api/apps/install', package)[0], 201)
        self.assertEqual(self.request('/api/apps/update', package)[0], 201)
        manifest = json.loads((self.root / 'demo' / 'manifest.json').read_text())
        self.assertEqual(manifest['capabilities'], ['sensors'])


    def test_system_shell_is_not_cached(self):
        for path in ('/', '/app.js', '/home-key.js', '/style.css', '/app-runtime.js', '/app-input-standard.json', '/input-navigation.js', '/app-host.js', '/companion.js'):
            with urllib.request.urlopen(self.url + path) as response:
                self.assertEqual(response.headers.get('Cache-Control'), 'no-store')

    def test_public_app_asset_cors_only(self):
        server.install_app(self.root, self.package())
        with urllib.request.urlopen(self.url + '/user-apps/demo/nested/main.js') as response:
            self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), '*'); self.assertEqual(response.headers.get('Cache-Control'), 'no-cache')
        with urllib.request.urlopen(self.url + '/api/model-config') as response:
            self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))

    def test_install_serve_list_uninstall(self):
        self.assertEqual(self.request('/api/apps/install', self.package())[0], 201)
        self.assertIn(b'<h1>Hello</h1>', self.request('/user-apps/demo/index.html')[1])
        body = json.loads(self.request('/api/apps')[1])
        self.assertEqual(body['apps'][-1]['entry'], '/user-apps/demo/index.html')
        self.assertEqual(self.request('/api/apps/install', self.package())[0], 400)
        self.assertEqual(self.request('/api/apps/uninstall', {'id':'demo'})[0], 200)
        self.assertEqual(self.request('/user-apps/demo/index.html')[0], 404)

    def test_runtime_is_injected_before_app_code(self):
        bundle = self.package()
        bundle['files']['index.html'] = '<html><head><script>window.sdkSeen=typeof AtomApp;</script></head><body>Hello</body></html>'
        server.install_app(self.root, bundle)
        html = self.request('/user-apps/demo/index.html')[1].decode()
        self.assertLess(html.index('/app-runtime.js'), html.index('window.sdkSeen'))
        self.assertEqual(html.count('src="/app-runtime.js"'), 1)
        self.assertIn('/home-key.js', html)
        self.assertIn('/input-navigation.js', html)

    def test_developer_persistence_and_body_validation(self):
        self.assertEqual(self.request('/api/developer', {'enabled': False})[0], 200)
        self.assertFalse(json.loads(self.request('/api/developer')[1])['enabled'])
        self.assertEqual(self.request('/api/apps/install', self.package())[0], 403)
        self.assertFalse(server.read_settings(self.http.settings_path)['enabled'])
        for value in [None, 1, 'true', [], {}]:
            self.assertEqual(self.request('/api/developer', {'enabled':value})[0], 400)
        self.assertFalse(server.read_settings(self.http.settings_path)['enabled'])
        self.assertEqual(self.request('/api/developer', {'enabled':True})[0], 200)
        self.assertTrue(server.read_settings(self.http.settings_path)['enabled'])
        settings = self.http.settings_path
        self.http.shutdown(); self.http.server_close()
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.http.apps_root = self.root; self.http.settings_path = settings
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True); self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.http.server_port)
        self.assertTrue(json.loads(self.request('/api/developer')[1])['enabled'])
        self.assertFalse(server.read_settings(self.http.settings_path.parent / 'missing.json')['enabled'])

    def test_display_validation_and_device_write(self):
        fake = Path(self.temp.name).resolve() / 'backlight'
        device = fake / 'panel'; device.mkdir(parents=True)
        (device / 'brightness').write_text('40'); (device / 'max_brightness').write_text('200')
        with mock.patch.object(server, 'BACKLIGHT_ROOT', fake):
            self.assertEqual(json.loads(self.request('/api/display')[1])['brightness'], 20)
            self.assertEqual(self.request('/api/display/brightness', {'brightness':50})[0], 200)
            self.assertEqual((device / 'brightness').read_text(), '100')
            for value in [True, -1, 101, '50', None]:
                self.assertEqual(self.request('/api/display/brightness', {'brightness':value})[0], 400)
        with mock.patch.object(server, 'BACKLIGHT_ROOT', fake / 'missing'):
            self.assertFalse(json.loads(self.request('/api/display')[1])['available'])
            self.assertEqual(self.request('/api/display/brightness', {'brightness':50})[0], 503)

    def test_update_and_failed_swap_restores_previous(self):
        self.assertEqual(self.request('/api/apps/install', self.package())[0], 201)
        package = self.package(); package['files']['index.html'] = 'updated'
        self.assertEqual(self.request('/api/apps/update', package)[0], 201)
        self.assertIn(b'updated', self.request('/user-apps/demo/index.html')[1])
        real_rename = server.os.rename
        def fail_stage(source, target):
            if Path(source).name.startswith('.install-'):
                raise OSError('simulated disk failure')
            return real_rename(source, target)
        with mock.patch.object(server.os, 'rename', side_effect=fail_stage):
            self.assertEqual(self.request('/api/apps/update', self.package())[0], 503)
        self.assertIn(b'updated', self.request('/user-apps/demo/index.html')[1])
        self.assertFalse(any(p.name.startswith('.install-') for p in self.root.iterdir()))

    def test_requires_origin_and_input_validation(self):
        self.assertEqual(self.request('/api/apps/install', self.package(), False)[0], 403)
        for value in [-1, 101, True, '50', 3.5]:
            self.assertEqual(self.request('/api/audio/volume', {'volume':value})[0], 400)
        self.assertEqual(self.request('/api/apps/uninstall', {'id':'clock'})[0], 400)

    def test_no_traversal_or_symlinks(self):
        for name in ['../escape', '/tmp/escape', 'a/../../escape', 'a\\escape', 'manifest.json']:
            package = self.package(); package['files'][name] = 'bad'
            self.assertEqual(self.request('/api/apps/install', package)[0], 400)
        self.root.mkdir()
        (self.root / 'demo').symlink_to(self.temp.name)
        self.assertEqual(self.request('/api/apps/install', self.package())[0], 400)
        self.assertEqual(self.request('/user-apps/demo/something')[0], 404)
        self.assertEqual(self.request('/user-apps/../server.py')[0], 404)
        self.assertEqual(self.request('/api/apps/uninstall', {'id':'demo'})[0], 400)

    def test_health_status_and_manifest_validation(self):
        self.assertTrue(json.loads(self.request('/api/health')[1])['ok'])
        status = json.loads(self.request('/api/status')[1])
        self.assertIn('available', status['memory']); self.assertIn('connected', status['network'])
        for patch in [{'id':'../x'}, {'name':None}, {'entry':'main.py'}]:
            package = self.package(); package['manifest'].update(patch)
            self.assertEqual(self.request('/api/apps/install', package)[0], 400)

    def test_workshop_and_theme_http_integration(self):
        import time
        self.assertEqual(self.request('/api/workshop/generate', {'prompt':'make a timer','theme_id':'system'})[0], 400)
        self.assertEqual(self.request('/api/workshop/jobs/unknown')[0], 400)
        self.assertEqual(self.request('/api/model-config', {'provider':'custom','base_url':'https://example.com/v1','model':'test','api_key':'test-only-secret'})[0], 200)
        public = self.request('/api/model-config')[1]
        self.assertNotIn(b'test-only-secret', public)
        self.assertTrue(json.loads(public)['api_key_set'])
        self.assertEqual(self.request('/api/themes/activate', {'id':'system'})[0], 200)
        service = server.features(self.http)
        with mock.patch.object(service.workshop, '_call_model', return_value=json.dumps(self.package())):
            code, body = self.request('/api/workshop/generate', {'prompt':'make demo','theme_id':'system'})
            self.assertEqual(code, 200)
            job_id = json.loads(body)['job_id']
            for _ in range(100):
                job = json.loads(self.request('/api/workshop/jobs/'+job_id)[1])
                if job['status'] in ('ready','failed'): break
                time.sleep(.01)
            self.assertEqual(job['status'], 'ready')
        self.request('/api/developer', {'enabled':False})
        self.assertEqual(self.request('/api/workshop/install', {'job_id':job_id})[0], 200)
        self.request('/api/themes/activate', {'id':'system'})
        html = self.request('/user-apps/demo/index.html')[1]
        self.assertIn(b'#f2f2f7', html)
        self.assertIn(b'data-atom-theme', html)
        self.assertEqual(self.request('/api/voice/transcribe', {'recording_id':'../../bad'})[0], 400)

    def test_sampled_piano_market_preview_install_update_preserves_resources_and_order(self):
        bundle = json.loads((Path(__file__).resolve().parents[1] / 'official/mini-piano/bundle.json').read_text())
        source = dict(bundle=bundle, version={'id':'v1','work_id':'piano'}, license='MIT', author='test', official=True)
        service = server.features(self.http)
        self.request('/api/developer', {'enabled':False})
        with mock.patch.object(service.market, 'execute', return_value=source):
            status, body = self.request('/api/market/preview', {'version_id':'v1'})
            self.assertEqual(status,200,body[:300])
            self.assertEqual(json.loads(body)['bundle']['files']['samples.js'],bundle['files']['samples.js'])
            status, body = self.request('/api/market/install', {'version_id':'v1','confirm':True})
            self.assertEqual(status,200,body[:300])
            installed = json.loads((self.root/'mini-piano/manifest.json').read_text())
            status, body = self.request('/api/market/install', {'version_id':'v1','confirm':True,'update':True})
            self.assertEqual(status,200,body[:300])
            updated = json.loads((self.root/'mini-piano/manifest.json').read_text())
            self.assertEqual(installed['_installed_at_ns'],updated['_installed_at_ns'])
        self.assertEqual((self.root/'mini-piano/samples.js').read_text(),bundle['files']['samples.js'])

    def test_market_install_does_not_require_developer_mode(self):
        self.request('/api/developer', {'enabled': False})
        icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 8H56V56H8Z" stroke="currentColor" fill="none"/></svg>'
        source = {'bundle': {'manifest': {'id': 'market-demo', 'name': 'Market Demo', 'entry': 'index.html', 'input': {'version':1,'profile':'five-way','back':'root'}, 'icon': 'icon.svg'}, 'files': {'index.html': '<h1>Hi</h1>', 'icon.svg': icon}},
                  'version': {'id': 'v1', 'work_id': 'w1'}, 'license': 'MIT', 'author': 'alice', 'official': False}
        service = server.features(self.http)
        with mock.patch.object(service.market, 'execute', return_value=source):
            self.assertEqual(self.request('/api/market/install', {'version_id': 'v1'})[0], 400, 'explicit confirmation is still required')
            self.assertEqual(self.request('/api/market/install', {'version_id': 'v1', 'confirm': True})[0], 200)
        self.assertIn(b'<h1>Hi</h1>', self.request('/user-apps/market-demo/index.html')[1])
        self.assertEqual(self.request('/api/apps/install', self.package())[0], 403, 'raw bundles still need developer mode')

if __name__ == '__main__': unittest.main()
