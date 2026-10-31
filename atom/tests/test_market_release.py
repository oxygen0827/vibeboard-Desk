import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('release_verify', Path(__file__).resolve().parents[1] / 'tools/verify_market_release.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.bundle = {'manifest': {'id': 'demo'}, 'files': {'index.html': 'reviewed'}}
        digest = hashlib.sha256(m.canonical(self.bundle)).hexdigest()
        self.catalog = {'works': [{'id': 'official-demo', 'latest_version_id': 'v1', 'cover_id': 'c1'}]}
        self.source = {'version': {'id': 'v1', 'work_id': 'official-demo', 'sha256': digest}, 'bundle': copy.deepcopy(self.bundle)}
        self.cover = {'image': 'data:image/jpeg;base64,fixture'}

    def fetch(self, url):
        return {'catalog': self.catalog, 'v1': self.source, 'c1': self.cover}[url.rsplit('/', 1)[-1]]

    def verify(self):
        return m.verify(self.bundle, 'official-demo', fetch=self.fetch)

    def test_verified_download_and_cover(self):
        self.assertTrue(self.verify()['cloud_verified'])

    def test_unpublished(self):
        self.catalog['works'] = []
        with self.assertRaisesRegex(ValueError, 'not published'):
            self.verify()

    def test_old_cloud_version(self):
        self.bundle['files']['index.html'] = 'new local draft'
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.verify()

    def test_corrupt_download(self):
        self.source['bundle']['files']['index.html'] = 'corrupt'
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.verify()

    def test_wrong_work(self):
        self.source['version']['work_id'] = 'some-other-work'
        with self.assertRaisesRegex(ValueError, 'does not belong'):
            self.verify()

    def test_missing_or_unavailable_cover(self):
        self.cover = {}
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            self.verify()
        self.catalog['works'][0].pop('cover_id')
        with self.assertRaisesRegex(ValueError, 'no home-screen cover'):
            self.verify()

    def test_credentials_and_insecure_market_rejected(self):
        for market in ['http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret']:
            with self.assertRaises(ValueError):
                m.verify(self.bundle, 'official-demo', market, self.fetch)


if __name__ == '__main__':
    unittest.main()
