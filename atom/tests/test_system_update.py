import base64, hashlib, io, json, sys, tarfile, tempfile, unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import system_update as su
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def package(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name); info.size = len(data); tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class SystemUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.key = Ed25519PrivateKey.generate()
        patches = [mock.patch.object(su, '_key', lambda: self.key.public_key()), mock.patch.object(su, 'RELEASES', Path(self.tmp.name).resolve() / 'releases'),
                   mock.patch.object(su, 'UPDATE', Path(self.tmp.name).resolve() / 'update'), mock.patch.object(su, 'current_version', lambda: '1.0')]
        for p in patches:
            p.start(); self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def release(self, version='1.1', files=None, sign_with=None, tamper=False):
        pkg = package(files or {'server.py': b'print(1)', 'VERSION': version.encode(), 'static/app.js': b'//'})
        manifest = dict(version=version, notes='n', created='t', size=len(pkg), sha256=hashlib.sha256(pkg).hexdigest(), commit='c', files=3)
        body = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        manifest['signature'] = base64.b64encode((sign_with or self.key).sign(body)).decode()
        if tamper:
            pkg = pkg[:-1] + bytes([pkg[-1] ^ 1])
        served = {'/market/v1/system/latest': manifest, '/market/v1/system/package/' + version: {'data': base64.b64encode(pkg).decode()}}
        return mock.patch.object(su, '_get', lambda relay, path: served[path])

    def test_check_and_stage_a_signed_release(self):
        with self.release():
            self.assertEqual(su.check('https://x'), dict(current='1.0', latest=dict(version='1.1', notes='n', size=su.check('https://x')['latest']['size'], created='t'), available=True))
            self.assertEqual(su.stage('https://x'), '1.1')
        self.assertEqual((su.RELEASES / '1.1' / 'static' / 'app.js').read_bytes(), b'//')
        self.assertEqual(su.request_install('1.1'), {'installing': '1.1'})
        self.assertEqual(su.status()['installing'], '1.1')

    def test_rejects_wrong_key_tampering_and_foreign_files(self):
        with self.release(sign_with=Ed25519PrivateKey.generate()):
            with self.assertRaisesRegex(su.UpdateError, '签名'):
                su.check('https://x')
        with self.release(tamper=True):
            with self.assertRaisesRegex(su.UpdateError, '不完整'):
                su.stage('https://x')
        for bad in ({'apps/x/index.html': b'x', 'server.py': b'', 'VERSION': b'1.1'}, {'../evil.py': b'x', 'server.py': b'', 'VERSION': b'1.1'}, {'state/connect.json': b'{}', 'server.py': b'', 'VERSION': b'1.1'}):
            with self.release(files=bad):
                with self.assertRaisesRegex(su.UpdateError, '内容'):
                    su.stage('https://x')
        with self.assertRaisesRegex(su.UpdateError, '下载'):
            su.request_install('9.9')


if __name__ == '__main__':
    unittest.main()

class InstallRecovery(SystemUpdate):
    def setUp(self):
        super().setUp()
        self.base = Path(self.tmp.name).resolve() / 'atom'
        (self.base / 'static').mkdir(parents=True)
        (self.base / 'state').mkdir()
        (self.base / 'apps').mkdir()
        (self.base / 'server.py').write_text('old server')
        (self.base / 'VERSION').write_text('1.0')
        (self.base / 'obsolete.py').write_text('old module')
        (self.base / 'static/app.js').write_text('old ui')
        (self.base / 'state/private.json').write_text('private unchanged')
        (self.base / 'apps/user.html').write_text('user unchanged')
        p = mock.patch.object(su, 'BASE', self.base); p.start(); self.addCleanup(p.stop)

    def prepare(self):
        with self.release(files={'server.py': b'new server', 'VERSION': b'1.1', 'static/app.js': b'new ui', 'added.py': b'new module'}):
            su.stage('https://x')
        su.request_install('1.1')

    def assert_preserved(self):
        self.assertEqual((self.base / 'state/private.json').read_text(), 'private unchanged')
        self.assertEqual((self.base / 'apps/user.html').read_text(), 'user unchanged')

    def test_success_and_removed_modules(self):
        self.prepare()
        with mock.patch.object(su, '_restart_and_wait', return_value=True): su.apply()
        self.assertTrue(su.status()['result']['ok'])
        self.assertEqual((self.base / 'server.py').read_text(), 'new server')
        self.assertFalse((self.base / 'obsolete.py').exists())
        self.assertFalse((su.UPDATE / 'journal.json').exists())
        self.assert_preserved()

    def test_partial_copy_failure_restores_and_removes_added_files(self):
        self.prepare()
        original = su._copy_core
        def fail_once(source, dest):
            if source.name.startswith('.install-'):
                (dest / 'server.py').write_text('partial new')
                (dest / 'added.py').write_text('partial module')
                raise OSError('simulated disk failure')
            original(source, dest)
        with mock.patch.object(su, '_copy_core', side_effect=fail_once), mock.patch.object(su, '_restart_and_wait', return_value=True): su.apply()
        self.assertTrue(su.status()['result']['rolled_back'])
        self.assertEqual((self.base / 'server.py').read_text(), 'old server')
        self.assertFalse((self.base / 'added.py').exists())
        self.assert_preserved()

    def test_unhealthy_release_rolls_back(self):
        self.prepare()
        with mock.patch.object(su, '_restart_and_wait', side_effect=[False, True]): su.apply()
        self.assertTrue(su.status()['result']['rolled_back'])
        self.assertEqual((self.base / 'VERSION').read_text(), '1.0')
        self.assertTrue((self.base / 'obsolete.py').exists())
        self.assertFalse((self.base / 'added.py').exists())
        self.assert_preserved()

    def test_power_loss_recovers_before_next_start(self):
        self.prepare()
        original = su._copy_core
        def power_cut(source, dest):
            if source.name.startswith('.install-'):
                (dest / 'server.py').write_text('partial new')
                raise SystemExit('simulated power loss')
            original(source, dest)
        with mock.patch.object(su, '_copy_core', side_effect=power_cut):
            with self.assertRaises(SystemExit): su.apply()
        self.assertTrue((su.UPDATE / 'journal.json').exists())
        su.recover()
        self.assertEqual((self.base / 'server.py').read_text(), 'old server')
        self.assertTrue(su.status()['result']['rolled_back'])
        self.assertIsNone(su.status()['installing'])
        self.assert_preserved()

    def test_staged_files_are_reextracted_from_signed_package(self):
        self.prepare()
        (su.RELEASES / '1.1/server.py').write_text('tampered')
        with mock.patch.object(su, '_restart_and_wait', return_value=True): su.apply()
        self.assertEqual((self.base / 'server.py').read_text(), 'new server')

    def test_changed_package_rejected_at_install(self):
        self.prepare()
        (su.RELEASES / '1.1/.package').write_bytes(b'changed')
        su.apply()
        self.assertFalse(su.status()['result']['ok'])
        self.assertEqual((self.base / 'server.py').read_text(), 'old server')

    def test_invalid_version_and_parallel_request(self):
        with self.assertRaises(su.UpdateError): su.request_install('../other')
        self.prepare()
        with self.assertRaisesRegex(su.UpdateError, '尚未结束'): su.request_install('1.1')
        with self.assertRaisesRegex(su.UpdateError, '尚未结束'): su.stage('https://x')
