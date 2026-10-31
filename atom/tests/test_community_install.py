"""Installation provenance and lost-ACK recovery, without device hardware."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from community_install import CommunityInstaller


class CommunityInstallTests(unittest.TestCase):
    def test_receipt_retry_and_verified_publication_transition(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            calls = []
            def install(apps, bundle, **flags):
                calls.append(flags)
                folder = apps / bundle['manifest']['id']
                folder.mkdir(exist_ok=True)
                (folder / 'ATOM-SOURCE.json').write_text(bundle['files']['ATOM-SOURCE.json'])
                return {'id': bundle['manifest']['id']}
            service = SimpleNamespace(apps_root=root, releases=SimpleNamespace(capture=Mock()))
            receiver = CommunityInstaller(service, lambda b, **kw: b, install)
            def bundle(): return {'manifest': {'id':'test-app','name':'Test'},'files':{}}
            private = {'draft':{'id':'draft1'}, 'bundle':bundle()}
            receiver.apply(private, 'alice', 'receipt1')
            receiver.apply(private, 'alice', 'receipt1')
            self.assertEqual(len(calls), 1)
            public = {'version':{'work_id':'work1'},'bundle':bundle()}
            with self.assertRaises(ValueError): receiver.apply(public, 'alice')
            public['install_aliases'] = ['draft:alice:draft1']
            receiver.apply(public, 'alice')
            self.assertEqual(calls[-1]['update'], True)
            self.assertEqual(json.loads((root/'test-app/ATOM-SOURCE.json').read_text())['community_origin'], 'work:work1')
            with self.assertRaises(ValueError): receiver.apply({'draft':{'id':'draft1'},'bundle':bundle()}, 'bob')
            self.assertEqual(len(calls), 2)


if __name__ == '__main__': unittest.main()
