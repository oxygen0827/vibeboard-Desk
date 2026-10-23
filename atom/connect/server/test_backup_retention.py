import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('backup_retention', Path(__file__).with_name('backup_retention.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class RetentionTests(unittest.TestCase):
    def test_scope_and_latest_three(self):
        keys=['atom/backups/atom-202610%02dT042000Z.tar.gz'%i for i in range(1,7)]
        foreign=['atom/backups/other.txt','atom/backups/nested/atom-20261001T042000Z.tar.gz','elsewhere/atom-20261001T042000Z.tar.gz']
        self.assertEqual(m.obsolete(keys+foreign,'atom/backups/'),keys[:3])
        self.assertEqual(m.obsolete(keys[:2],'atom/backups/'),[])

    def test_version_history_blocks_upload_and_pruning(self):
        for status in ['Enabled','Suspended','unexpected']:
            calls=[]
            def fake(action,**kwargs):
                calls.append(action);return {'Status':status}
            with self.assertRaises(RuntimeError):m.prune_remote(fake)
            self.assertEqual(calls,['get-bucket-versioning'])

    def test_pagination_and_no_delete_on_incomplete_listing(self):
        deleted=[];calls=[]
        def fake(action,**kw):
            calls.append(action)
            if action=='get-bucket-versioning':return {}
            if action=='delete-object':deleted.append(kw['key']);return {}
            if 'continuation_token' not in kw:return dict(Contents=[{'Key':'atom/backups/atom-20261001T042000Z.tar.gz'}],IsTruncated=True,NextContinuationToken='next')
            return dict(Contents=[{'Key':'atom/backups/atom-202610%02dT042000Z.tar.gz'%i} for i in range(2,5)],IsTruncated=False)
        with patch.dict(os.environ,{'OSS_PREFIX':'atom/backups'}):self.assertEqual(m.prune_remote(fake),1)
        self.assertEqual(len(deleted),1)
        def broken(action,**kw):return {} if action=='get-bucket-versioning' else dict(IsTruncated=True)
        with self.assertRaises(RuntimeError):m.prune_remote(broken)

    def test_local_never_follows_symlinks_or_removes_unrelated_files(self):
        with tempfile.TemporaryDirectory() as t:
            r=Path(t)
            for i in range(1,6):(r/('atom-202610%02dT042000Z.tar.gz'%i)).write_text('backup')
            (r/'manual-keep.tar.gz').write_text('keep')
            (r/'atom-20260901T042000Z.tar.gz').symlink_to(r/'manual-keep.tar.gz')
            self.assertEqual(m.prune_local(r),2)
            self.assertEqual((r/'manual-keep.tar.gz').read_text(),'keep')
            self.assertTrue((r/'atom-20260901T042000Z.tar.gz').is_symlink())


if __name__=='__main__':unittest.main()
