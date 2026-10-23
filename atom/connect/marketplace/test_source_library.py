import json,tempfile,unittest
from pathlib import Path
from service import Marketplace,MarketError

class SourceLibraryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.seed=self.root/'official';self.seed.mkdir();(self.root/'app-library').mkdir();self.market=Marketplace(str(self.root/'market.db'),seeds=self.seed)
  self.row=dict(id='sample',name='星光',description='完整资源',category='visual',archive='/atom/assets/library/sample-'+'a'*16+'.zip',sha256='a'*64,input_status='legacy')
 def tearDown(self):self.market.close();self.tmp.cleanup()
 def write(self,rows): (self.root/'app-library/catalog.json').write_text(json.dumps({'apps':rows},ensure_ascii=False))
 def catalog(self,q=''):return self.market.handle('GET','/market/v1/catalog'+q)
 def test_missing_library_remains_backward_compatible(self):self.assertEqual(self.catalog()['library'],[])
 def test_full_resource_library_does_not_publish_or_certify_legacy(self):
  self.write([self.row]);r=self.catalog();self.assertEqual(r['library'][0]['input_status'],'legacy');self.assertEqual(r['works'],[]);self.assertEqual(self.market.row('SELECT count(*) n FROM works')['n'],0)
  self.assertEqual(len(self.catalog('?category=play&q=%E6%98%9F')['library']),1);self.assertEqual(self.catalog('?q=missing')['library'],[])
 def test_retired_apps_remain_hidden(self):
  row=dict(self.row,id='task-pal');self.write([row]);self.assertEqual(self.catalog()['library'],[])
 def test_archive_url_and_digest_are_constrained(self):
  for patch in [dict(archive='https://evil.test/a.zip'),dict(archive='/atom/assets/library/../secret.zip'),dict(sha256='not-a-hash')]:
   self.write([dict(self.row,**patch)])
   with self.assertRaises(MarketError):self.catalog()
 def test_public_library_cover_is_lazy_and_not_stored_in_private_database(self):
  self.write([dict(self.row,cover_image='data:image/jpeg;base64,YQ==')])
  row=self.catalog()['library'][0]
  self.assertNotIn('cover_image',row)
  self.assertEqual(len(row['cover_id']),32)
  self.assertEqual(self.market.handle('GET','/market/v1/covers/'+row['cover_id'])['image'],'data:image/jpeg;base64,YQ==')
  self.assertEqual(self.market.row('SELECT count(*) n FROM covers')['n'],0)
 def test_metadata_size_is_bounded(self):
  (self.root/'app-library/catalog.json').write_text(' '* (2*1024*1024+1))
  with self.assertRaises(MarketError):self.catalog()
if __name__=='__main__':unittest.main()
