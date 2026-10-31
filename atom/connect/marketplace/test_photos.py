import base64
import io
import json
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from PIL import Image
from service import Marketplace, MarketError
from photos import ArkImages, PhotoError, data_url, decode_image, prepare, MAX_ORIGINAL


def picture(color='orange', size=(160, 100)):
    out = io.BytesIO()
    Image.new('RGB', size, color).save(out, 'PNG')
    return out.getvalue()


class FakeProvider:
    model = 'test-images'
    def __init__(self):
        self.calls = []
        self.gate = threading.Event()
        self.gate.set()
    def enabled(self, uid): return True
    def generate(self, prompt, reference=None):
        self.calls.append((prompt, reference))
        self.gate.wait(5)
        return picture('blue')


class PhotosTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'market.sqlite3')
        self.market = Marketplace(self.path, seeds=Path(self.temp.name)/'none')
        self.a = self.market.handle('POST', '/market/v1/register', body={'username':'alice','password':'test-password-1234'})
        self.b = self.market.handle('POST', '/market/v1/register', body={'username':'bobby','password':'test-password-5678'})
        self.fake = FakeProvider()
        self.market.photos.provider = self.fake

    def tearDown(self):
        self.fake.gate.set()
        self.market.close()
        self.temp.cleanup()

    def call(self, suffix='', body=None, account=None):
        return self.market.handle('GET' if body is None else 'POST', '/market/v1/photos'+suffix,
                                  (account or self.a)['token'], body)

    def upload(self, name='test.png', photo_id=None, raw=None):
        return self.call(body={'id':photo_id or secrets.token_hex(16),'name':name,'data_url':data_url(raw or picture(),'image/png')})['photo']

    def denied(self, status, fn):
        with self.assertRaises(MarketError) as caught: fn()
        self.assertEqual(status, caught.exception.status)

    def finish(self, ident):
        for _ in range(100):
            job = self.call('/jobs/'+ident)['job']
            if job['status'] not in ('queued','generating','saving'): return job
            time.sleep(.02)
        self.fail('job did not finish')

    def test_pet_reference_requires_owned_photo_and_preserves_original(self):
        self.denied(400, lambda: self.call('/generate', {'request_id':secrets.token_hex(16), 'style':'pet', 'prompt':'毛绒'}))
        source = self.upload()
        body = {'request_id':secrets.token_hex(16), 'source_id':source['id'], 'style':'pet', 'prompt':'毛绒'}
        self.denied(404, lambda: self.call('/generate', body, self.b))
        first = self.call('/generate', body)['job']
        again = self.call('/generate', body)['job']
        self.assertEqual(first['id'], again['id'])
        result = self.finish(first['id'])
        self.assertEqual('completed', result['status'])
        self.assertEqual(1, len(self.fake.calls))
        prompt, reference = self.fake.calls[0]
        self.assertIn('纯黑', prompt)
        self.assertIn('毛绒', prompt)
        self.assertIn('保留原肤色', prompt)
        self.assertTrue(reference.startswith('data:image/jpeg;base64,'))
        generated = self.call('/'+result['photo_id'])['photo']
        self.assertEqual(source['id'], generated['parent_id'])
        self.assertEqual('pet', generated['style'])
        self.assertEqual(source, self.call('/'+source['id'])['photo'])

    def test_original_thumbnail_account_isolation_and_atomic_backup(self):
        raw = picture()
        p = self.upload(raw=raw)
        self.assertEqual(base64.b64decode(self.call('/'+p['id']+'/original')['data_url'].split(',')[1]), raw)
        listing = self.call()
        self.assertEqual(listing['total'], 1)
        self.assertTrue(listing['items'][0]['thumbnail'].startswith('data:image/jpeg;'))
        self.assertEqual(self.call(account=self.b)['items'], [])
        for path in ('/'+p['id'], '/'+p['id']+'/original'):
            self.denied(404, lambda: self.call(path, account=self.b))
        self.denied(401, lambda: self.market.handle('GET','/market/v1/photos', ''))
        import sqlite3
        backup = sqlite3.connect(':memory:')
        self.market.db.backup(backup)
        self.assertEqual(backup.execute('SELECT original FROM photo_media').fetchone()[0], raw)
        backup.close()

    def test_upload_idempotency_validation_and_revision(self):
        key = secrets.token_hex(16)
        p = self.upload(photo_id=key)
        self.assertEqual(self.upload(photo_id=key), p)
        self.denied(409, lambda: self.upload(photo_id=key,raw=picture('red')))
        self.denied(400, lambda: self.call(body={'id':secrets.token_hex(16),'name':'bad','data_url':data_url(b'<svg/>','image/png')}))
        self.denied(400, lambda: self.call('/'+p['id']+'/delete', {'revision':1}))
        updated = self.call('/'+p['id']+'/update', {'revision':1,'favorite':True})['photo']
        self.assertEqual(self.call('?filter=favorites')['total'],1)
        self.denied(409,lambda:self.call('/'+p['id']+'/update',{'revision':1,'favorite':False}))
        self.call('/'+p['id']+'/delete',{'revision':updated['revision'],'confirm':True})
        self.assertEqual(self.call()['total'],0)
        self.assertEqual(self.market.row('SELECT COUNT(*) n FROM photo_media')['n'],0)

    def test_generation_reference_saved_without_overwriting_and_no_double_billing(self):
        p = self.upload()
        request = {'request_id':secrets.token_hex(16),'source_id':p['id'],'style':'clay','prompt':'蓝色的天空'}
        self.fake.gate.clear()
        job = self.call('/generate',request)['job']
        self.assertEqual(self.call('/generate',request)['job']['id'],job['id'])
        self.denied(409, lambda:self.call('/generate',{**request,'request_id':secrets.token_hex(16)}))
        self.denied(404,lambda:self.call('/jobs/'+job['id'],account=self.b))
        self.fake.gate.set()
        done = self.finish(job['id'])
        self.assertEqual(done['status'],'completed')
        result = self.call('/'+done['photo_id'])['photo']
        self.assertEqual(result['parent_id'],p['id'])
        self.assertTrue(result['generated'])
        self.assertEqual(self.call()['total'],2)
        self.assertEqual(len(self.fake.calls),1)
        self.assertTrue(self.fake.calls[0][1].startswith('data:image/jpeg;base64,'))
        self.call('/'+p['id']+'/delete',{'revision':1,'confirm':True})
        self.assertEqual(self.call()['total'],1)
        self.assertEqual(self.call('/generate',request)['job']['id'],job['id'])

    def test_unauthorized_reference_and_bad_input_never_reach_provider(self):
        p = self.upload()
        self.denied(404,lambda:self.call('/generate',{'request_id':secrets.token_hex(16),'source_id':p['id'],'style':'clay'},self.b))
        self.denied(400,lambda:self.call('/generate',{'request_id':secrets.token_hex(16),'prompt':{'not':'text'}}))
        self.denied(400,lambda:self.call('/generate',{'request_id':secrets.token_hex(16),'prompt':'   '}))
        self.assertEqual(self.fake.calls,[])

    def test_restart_preserves_media_and_interrupts_unfinished_job(self):
        p=self.upload()
        job={'id':secrets.token_hex(16),'status':'generating','user_id':self.a['user']['id']}
        with self.market.db:
            self.market.db.execute('INSERT INTO photo_jobs VALUES(?,?,?,?,?)',(job['id'],self.a['user']['id'],secrets.token_hex(16),'hash',json.dumps(job)))
        self.market.close()
        self.market=Marketplace(self.path,seeds=Path(self.temp.name)/'none')
        self.assertEqual(self.call('/jobs/'+job['id'])['job']['status'],'interrupted')
        self.assertEqual(self.call('/'+p['id'])['photo']['name'],'test.png')

    def test_prompt_pack_is_bounded_and_mode_specific(self):
        from photo_prompts import TEMPLATES, STYLES, build_prompt
        self.assertEqual(len(TEMPLATES), 24)
        self.assertEqual(len({t['id'] for t in TEMPLATES}), 24)
        for t in TEMPLATES:
            self.assertIn(t['style'], STYLES)
            self.assertIn(t['mode'], ('text', 'edit'))
            self.assertLess(len(build_prompt(t['prompt'], t['style'], t['mode']=='edit')), 300)
        prompt = build_prompt('只把背景改成蓝色', 'custom', True)
        self.assertTrue(prompt.startswith('只把背景改成蓝色'))
        self.assertIn('保留未要求修改', prompt)
        self.assertNotIn('视觉风格', prompt)
        state = self.call('/state')
        self.assertEqual(state['prompt_version'], 2)
        self.assertEqual(len(state['templates']), 24)

    def test_provider_endpoint_matches_key_type(self):
        from unittest.mock import patch
        for mode, path in [('standard', '/api/v3/'), ('agent-plan', '/api/plan/v3/')]:
            with patch.dict('os.environ', {'ATOM_IMAGE_API_MODE': mode}):
                provider = ArkImages()
                self.assertEqual(provider.endpoint, 'https://ark.cn-beijing.volces.com' + path + 'images/generations')
        with patch.dict('os.environ', {'ATOM_IMAGE_API_MODE': 'https://untrusted.invalid'}):
            with self.assertRaises(ValueError):
                ArkImages()

    def test_provider_errors_do_not_echo_secret(self):
        from urllib.error import HTTPError
        provider=ArkImages();provider.key='private-test-credential'
        class Opener:
            def open(self,*args,**kwargs):
                raise HTTPError('https://example.invalid',404,'bad',{},io.BytesIO(json.dumps({'error':{'code':'ModelNotOpen','message':'private-test-credential'}}).encode()))
        provider.opener=Opener()
        with self.assertRaises(PhotoError) as caught:provider.generate('test')
        self.assertEqual(caught.exception.code,'model_not_open')
        self.assertNotIn(provider.key,caught.exception.message)

    def test_twenty_mib_boundary_and_format_error_are_distinct(self):
        raw = picture() + b'\0' * (MAX_ORIGINAL - len(picture()))
        decoded, mime = decode_image(data_url(raw, 'image/png'))
        self.assertEqual(len(decoded), 20 * 1024 * 1024)
        self.assertEqual(mime, 'image/png')
        with self.assertRaises(PhotoError) as caught:
            decode_image(data_url(raw + b'x', 'image/png'))
        self.assertEqual(caught.exception.status, 413)
        self.assertIn('20 MiB', caught.exception.message)
        with self.assertRaises(PhotoError) as caught:
            decode_image(data_url(b'GIF89a', 'image/gif'))
        self.assertEqual(caught.exception.status, 400)
        self.assertIn('HEIC', caught.exception.message)

    def test_heic_primary_preview_original_and_mime_alias(self):
        # Real HEVC-encoded container, not a mocked decoder or renamed JPEG.
        first = Image.new('RGB', (80, 60), 'red')
        primary = Image.new('RGB', (160, 100), 'blue')
        out = io.BytesIO()
        first.save(out, 'HEIF', append_images=[primary], save_all=True, primary_index=1)
        raw = out.getvalue()
        for mime in ('image/heic', 'image/heif'):
            p = self.call(body={'id':secrets.token_hex(16), 'name':'Apple photo.heic', 'data_url':data_url(raw,mime)})['photo']
            self.assertEqual((p['width'],p['height']),(160,100))
            self.assertEqual(p['mime'],mime)
            self.assertEqual(base64.b64decode(self.call('/'+p['id']+'/original')['data_url'].split(',')[1]),raw)
            preview = self.call('/'+p['id'])['data_url']
            with Image.open(io.BytesIO(base64.b64decode(preview.split(',')[1]))) as decoded:
                r,g,b = decoded.getpixel((80,50))
                self.assertGreater(b, r+100)
                self.assertEqual(len(decoded.getexif()),0)
        with self.assertRaises(PhotoError):
            prepare(picture(), 'image/heic')

    def test_48_megapixel_photo_orientation_and_small_preview(self):
        out = io.BytesIO()
        image = Image.new('RGB', (8000,6000), '#3f7dc1')
        exif = Image.Exif(); exif[274] = 6
        image.save(out, 'JPEG', exif=exif)
        image.close()
        raw = out.getvalue()
        result = prepare(raw, 'image/jpeg')
        self.assertEqual(result[1:3], (6000,8000))
        with Image.open(io.BytesIO(result[3])) as preview:
            self.assertEqual(preview.size, (960,1280))
            self.assertEqual(len(preview.getexif()),0)
        with Image.open(io.BytesIO(result[4])) as thumb:
            self.assertLessEqual(thumb.width,240)
            self.assertLessEqual(thumb.height,180)


if __name__=='__main__': unittest.main()
