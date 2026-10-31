import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('distribution_audit', TOOLS / 'audit_app_distribution.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.expected = {'demo': {'manifest': {'id': 'demo'}, 'files': {'app.js': 'new', 'icon.svg': 'icon'}}}

    def test_stale_runtime_fails_but_preserved_icon_is_reported(self):
        old = {'demo': {'manifest': {'id': 'demo', '_installed_at_ns': 10}, 'files': {'app.js': 'old', 'icon.svg': 'custom'}}}
        row = audit.compare(self.expected, old, True)[0]
        self.assertEqual(row['state'], 'different')
        self.assertEqual(row['runtime_files'], ['app.js'])
        self.assertEqual(row['other_files'], ['icon.svg'])
        old['demo']['files']['app.js'] = 'new'
        self.assertEqual(audit.compare(self.expected, old, True)[0]['state'], 'current')

    def test_missing_seed_is_an_error_but_absent_device_apps_are_not_installed(self):
        self.assertEqual(audit.compare(self.expected, {})[0]['state'], 'missing')
        self.assertEqual(audit.compare(self.expected, {}, True)[0]['state'], 'not_installed')

    def test_manifest_changes_are_detected(self):
        actual = {'demo': {'manifest': {'id': 'demo', 'input': {'version': 1}}, 'files': self.expected['demo']['files']}}
        self.assertEqual(audit.compare(self.expected, actual)[0]['state'], 'different')

    def test_stale_or_missing_library_download_is_rejected(self):
        expected = [{'id': 'piano', 'sha256': 'current', 'archive': '/new.zip'}]
        stale = [{'id': 'piano', 'sha256': 'current', 'archive': '/old.zip'}]
        self.assertFalse(audit.compare_library(expected, stale)[0]['verified'])
        self.assertFalse(audit.compare_library(expected, [])[0]['verified'])
        self.assertTrue(audit.compare_library(expected, expected)[0]['verified'])
