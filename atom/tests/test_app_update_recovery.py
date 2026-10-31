"""Isolated process exits during directory swap must never lose the installed app."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class AppRecovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve() / 'apps'
        self.bundle = dict(manifest=dict(id='recovery-demo', name='Recovery', entry='index.html',
                          input=dict(version=1, profile='five-way', back='root')),
                          files={'index.html':'previous', 'asset.txt':'complete resource'})
        server.install_app(self.root, self.bundle)
        self.original = (self.root/'recovery-demo/manifest.json').read_bytes()

    def interrupted(self, point):
        code = '''
import json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import server
root=Path(sys.argv[2]);point=sys.argv[3]
bundle=json.loads(sys.argv[4]);bundle['files']['index.html']='replacement'
rename=server.os.rename
sync_dir=server.system_update._sync_dir
def swap(source,target):
    if Path(source).name=='recovery-demo' and point=='before-backup':os._exit(91)
    if Path(source).name.startswith('.install-') and point=='before-replace':os._exit(91)
    rename(source,target)
    if Path(source).name.startswith('.install-') and point=='after-replace':os._exit(91)
def sync(path):
    sync_dir(path)
    if path==root and not (root/'.app-update.json').exists() and (root/'recovery-demo/index.html').read_text()=='replacement' and point=='after-commit':os._exit(91)
server.os.rename=swap
server.system_update._sync_dir=sync
server.install_app(root,bundle,update=True)
'''
        result = subprocess.run([sys.executable,'-c',code,str(Path(server.__file__).parent),str(self.root),point,json.dumps(self.bundle)], timeout=15)
        self.assertEqual(result.returncode,91)

    def test_process_exit_before_backup_before_replace_and_after_replace(self):
        for point in ('before-backup','before-replace','after-replace'):
            with self.subTest(point=point):
                self.interrupted(point)
                self.assertTrue((self.root/'.app-update.json').exists())
                # Listing is also a recovery entry for embedded simulator servers.
                self.assertIn('recovery-demo',[a['id'] for a in server.apps(self.root)])
                server.recover_app_update(self.root)  # idempotent
                self.assertEqual((self.root/'recovery-demo/index.html').read_text(),'previous')
                self.assertEqual((self.root/'recovery-demo/manifest.json').read_bytes(),self.original)
                self.assertEqual((self.root/'recovery-demo/asset.txt').read_text(),'complete resource')
                self.assertFalse((self.root/'.app-update.json').exists())
                self.assertEqual(list(self.root.glob('.install-*')),[])

    def test_committed_update_is_not_rolled_back_by_leftover_backup(self):
        self.interrupted('after-commit')
        server.recover_app_update(self.root)
        self.assertEqual((self.root/'recovery-demo/index.html').read_text(),'replacement')
        self.assertTrue(list(self.root.glob('.backup-*')))

    def test_invalid_journal_cannot_touch_another_directory(self):
        journal=self.root/'.app-update.json'
        journal.write_text(json.dumps(dict(id='recovery-demo',backup='../outside',stage='.install-test')))
        with self.assertRaises(ValueError):server.recover_app_update(self.root)
        self.assertEqual((self.root/'recovery-demo/index.html').read_text(),'previous')
        self.assertTrue(journal.exists())

    def test_uncommitted_trusted_client_can_recover(self):
        bundle=json.loads(json.dumps(self.bundle));bundle['manifest']['id']='today'
        server.install_app(self.root,bundle,trusted_connect=True)
        rename=server.os.rename
        def exit_on_swap(source,target):
            if Path(source).name.startswith('.install-'):raise SystemExit('interrupted')
            return rename(source,target)
        with mock.patch.object(server.os,'rename',side_effect=exit_on_swap):
            with self.assertRaises(SystemExit):server.install_app(self.root,bundle,update=True,trusted_connect=True)
        server.recover_app_update(self.root)
        self.assertEqual((self.root/'today/index.html').read_text(),'previous')
