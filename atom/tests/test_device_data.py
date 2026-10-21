import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from device_data import DeviceData, validate, MIRROR_LIMIT

class DataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store = DeviceData(Path(self.tmp.name))
        self.data = {'atom.desktop.v2':json.dumps({'order':['clock']}),'atom.app.v1.clock':'{"alarm":12}'}
    def test_backup_restore_confirm_and_corruption(self):
        b=self.store.backup(self.data)
        with self.assertRaises(ValueError):self.store.restore(b['backup'],False)
        self.store.restore(b['backup'],True)
        s=self.store.status();self.assertEqual(s['pending']['data'],self.data)
        self.store.acknowledge('wrong');self.assertIsNotNone(self.store.status()['pending'])
        self.store.acknowledge(s['pending']['id']);self.assertIsNone(self.store.status()['pending'])
        b['backup']['data']['atom.timer']='1'
        with self.assertRaisesRegex(ValueError,'校验'):self.store.restore(b['backup'],True)
    def test_private_config_and_paths_are_rejected(self):
        for key in ['api_key','atom.capabilities.v1','atom.app.v1../model','atom.workshopDraft']:
            with self.assertRaises(ValueError):validate({key:'{}'})
        with self.assertRaises(ValueError):self.store.read_backup('../../model')
    def test_corrupted_snapshot_not_overwritten(self):
        self.store.root.mkdir(exist_ok=True);self.store.path.write_text('{broken')
        with self.assertRaises(ValueError):self.store.capture(self.data)
        self.assertEqual(self.store.path.read_text(),'{broken')
    def test_empty_browser_recovers_the_saved_copy(self):
        with self.assertRaisesRegex(ValueError,'没有可恢复'):self.store.recover_current()
        self.store.capture(self.data)
        token=self.store.recover_current()['pending']
        self.assertEqual(self.store.status()['pending'],dict(id=token,data=self.data,source='recover'))
        self.assertEqual(self.store.recover_current()['pending'],token,'a second empty shell gets the same pending restore')
        self.store.acknowledge(token);self.assertIsNone(self.store.status()['pending'])
    def test_damaged_copy_falls_back_to_previous_version(self):
        self.store.capture(self.data)
        newer=dict(self.data,**{'atom.timer':'{"seconds":60}'})
        self.store.capture(newer)
        self.store.path.write_text('{broken')
        self.assertEqual(self.store.current()['data'],self.data)
        self.store.capture(newer)
        self.assertEqual(json.loads(self.store.path.read_text())['data'],newer)
    def test_daily_snapshots_rotate_and_do_not_count_as_manual(self):
        import device_data,time as t
        days=iter(['20261001','20261002','20261003','20261004','20261005','20261006','20261007','20261008','20261009'])
        real=t.strftime
        for i,day in enumerate(days):
            device_data.time.strftime=lambda f,day=day:day if f=='%Y%m%d' else real(f)
            try:self.store.capture(dict(self.data,**{'atom.timer':json.dumps({'n':i})}))
            finally:device_data.time.strftime=real
        autos=sorted(p.stem for p in self.store.folder.glob('auto-*.json'))
        self.assertEqual(autos,['auto-202610%02d'%d for d in range(3,10)])
        self.assertTrue(all(b['automatic'] for b in self.store.status()['backups']))
        self.assertEqual(self.store.read_backup('auto-20261009')['data']['atom.timer'],json.dumps({'n':8}))
        for _ in range(10):self.store.backup(dict(self.data,**{'atom.notes':json.dumps(_)}))
        with self.assertRaisesRegex(ValueError,'10 份'):self.store.backup(self.data)
    def test_mirror_has_strict_whole_snapshot_limit(self):
        with self.assertRaises(ValueError):validate({'atom.app.v1.a':json.dumps('x'*40000),'atom.app.v1.b':json.dumps('x'*40000)},MIRROR_LIMIT)
        self.assertFalse(self.store.status()['mirror'])

    def test_pending_restore_blocks_stale_capture_and_ack_persists(self):
        backup = self.store.backup(self.data)['backup']
        self.store.capture({'atom.timer':'99'})
        self.store.restore(backup, True)
        with self.assertRaisesRegex(ValueError, '恢复'):
            self.store.capture({'atom.timer':'99'})
        self.store.acknowledge(self.store.status()['pending']['id'])
        self.assertEqual(json.loads(self.store.path.read_text())['data'], self.data)

    def test_closed_store_cannot_repopulate_reset_data(self):
        self.store.close()
        with self.assertRaises(ValueError): self.store.capture(self.data)
        self.assertFalse(self.store.path.exists())
