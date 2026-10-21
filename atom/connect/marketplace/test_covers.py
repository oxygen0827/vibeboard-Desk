import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from PIL import Image
from service import Marketplace, MarketError
from test_marketplace import bundle


def screenshot(color='navy'):
    out=io.BytesIO()
    Image.new('RGB',(480,360),color).save(out,'PNG')
    return 'data:image/png;base64,'+base64.b64encode(out.getvalue()).decode()


class CoverTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'market.db'
        self.market=Marketplace(str(self.path),seeds=Path(self.tmp.name)/'seeds')
        self.a=self.call('/register',{'username':'cover-alice','password':'long-cover-test-password'})
        self.b=self.call('/register',{'username':'cover-bobby','password':'long-cover-test-password'})
        self.draft=self.call('/drafts',{'title':'Screenshot app','category':'life','license':'MIT','bundle':bundle()},self.a)['draft']

    def tearDown(self):
        self.market.close();self.tmp.cleanup()

    def call(self,path,body=None,user=None):
        return self.market.handle('GET' if body is None else 'POST','/market/v1'+path,(user or {}).get('token',''),body)

    def upload(self,data=None,user=None,revision=None):
        return self.call('/drafts/'+self.draft['id']+'/cover',{'image':data or screenshot(),'revision':revision or self.draft['revision']},user or self.a)['draft']

    def denied(self,status,fn):
        with self.assertRaises(MarketError) as e:fn()
        self.assertEqual(e.exception.status,status)
        return e.exception

    def test_private_until_publish_normalized_no_source_mutation(self):
        self.denied(401,lambda:self.call('/drafts/'+self.draft['id']+'/cover',{}))
        self.denied(404,lambda:self.upload(user=self.b))
        self.draft=self.upload();cid=self.draft['cover_id']
        self.denied(401,lambda:self.call('/covers/'+cid))
        self.denied(404,lambda:self.call('/covers/'+cid,user=self.b))
        cover=self.call('/covers/'+cid,user=self.a)
        raw=base64.b64decode(cover['image'].split(',')[1]);image=Image.open(io.BytesIO(raw))
        self.assertEqual(image.format,'JPEG');self.assertFalse(image.getexif())
        self.assertEqual(self.call('/drafts/'+self.draft['id'],user=self.a)['bundle'],bundle())
        result=self.call('/drafts/'+self.draft['id']+'/publish',{'revision':self.draft['revision'],'changelog':'Screenshot release','confirm':True,'require_cover':True},self.a)
        self.assertEqual(result['work']['cover_id'],cid)
        self.assertEqual(result['version']['cover_id'],cid)
        self.assertEqual(self.call('/covers/'+cid)['image'],cover['image'])
        self.assertEqual(self.call('/catalog')['works'][0]['cover_id'],cid)
        self.draft=self.call('/drafts/'+self.draft['id'],user=self.a)['draft']
        self.draft=self.upload(screenshot('red'))
        self.assertNotEqual(self.draft['cover_id'],cid)
        self.assertEqual(self.call('/catalog')['works'][0]['cover_id'],cid)
        self.assertEqual(self.call('/versions/'+result['version']['id'])['version']['cover_id'],cid)
        self.market.close();self.market=Marketplace(str(self.path),seeds=Path(self.tmp.name)/'seeds')
        self.assertEqual(self.call('/covers/'+cid)['image'],cover['image'])

    def test_rejected_image_and_revision_preserve_previous_cover(self):
        self.draft=self.upload();cid=self.draft['cover_id']
        self.denied(409,lambda:self.upload(revision=1))
        self.denied(400,lambda:self.upload('data:image/svg+xml;base64,'+base64.b64encode(b'<svg/>').decode()))
        self.denied(400,lambda:self.upload('data:image/png;base64,'+base64.b64encode(b'not an image').decode()))
        self.assertEqual(self.call('/drafts/'+self.draft['id'],user=self.a)['draft']['cover_id'],cid)
        self.denied(400,lambda:self.call('/covers/not-valid'))

    def test_publish_prompt_contract_and_private_replacement_cleanup(self):
        self.denied(400,lambda:self.call('/drafts/'+self.draft['id']+'/publish',{'revision':1,'changelog':'Needs cover','confirm':True,'require_cover':True},self.a))
        self.draft=self.upload();old=self.draft['cover_id'];self.draft=self.upload(screenshot('green'))
        self.denied(404,lambda:self.call('/covers/'+old,user=self.a))
        self.assertEqual(self.market.row('SELECT COUNT(*) n FROM covers')['n'],1)

    def test_reviewed_backfill_preserves_existing_cover_and_source_versions(self):
        from ops import set_cover, OpsError
        published=self.call('/drafts/'+self.draft['id']+'/publish',{'revision':1,'confirm':True,'changelog':'Legacy client'},self.a)
        wid=published['work']['id'];vid=published['version']['id'];before=self.call('/versions/'+vid)
        path=Path(self.tmp.name)/'reviewed.png';path.write_bytes(base64.b64decode(screenshot().split(',')[1]))
        with self.assertRaises(OpsError):set_cover(str(self.path),wid,str(path),'wrong')
        result=set_cover(str(self.path),wid,str(path),wid)
        self.assertTrue(result['cover_id'])
        self.assertTrue(set_cover(str(self.path),wid,str(path),wid)['unchanged'])
        self.assertEqual(self.call('/versions/'+vid),before)
        self.assertEqual(self.call('/works/'+wid)['work']['author'],'cover-alice')
        self.assertTrue(self.call('/covers/'+result['cover_id'])['image'])

if __name__=='__main__':unittest.main()
