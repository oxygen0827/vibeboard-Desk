import importlib.util
import json
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock
spec = importlib.util.spec_from_file_location('workshop',str(Path(__file__).resolve().parents[1]/'workshop.py'))
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
BUNDLE = dict(manifest=dict(id='myapp',name='Example',entry='index.html',input={'version':1,'profile':'five-way','back':'root'}),files={'index.html':'<button>Start</button>'})

class WorkshopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name).resolve()
        self.work = w.Workshop(self.root,theme_css_fn=lambda _: ':root{--bg:white}')
    def tearDown(self): self.temp.cleanup()
    def configure(self, **extra):
        value=dict(provider='custom',base_url='https://example.com/v1',model='test',api_key='secret-test-key'); value.update(extra)
        return self.work.save_config(value)
    def wait_job(self,job_id):
        for _ in range(100):
            result=self.work.get_job(job_id)
            if result['status'] in ('ready','failed'): return result
            time.sleep(.01)
        self.fail('job did not finish')
    def test_redaction_persistence_and_clear(self):
        public=self.configure(stt_api_key='speech-key')
        self.assertNotIn('secret-test-key',json.dumps(public)); self.assertNotIn('speech-key',json.dumps(public))
        self.assertTrue(public['api_key_set']); self.assertTrue(public['stt_api_key_set'])
        self.assertEqual(stat.S_IMODE(self.work.path.stat().st_mode),0o600)
        self.work.save_config({'api_key':''}); self.assertEqual(self.work.read_private_config()['api_key'],'secret-test-key')
        reopened=w.Workshop(self.root); self.assertTrue(reopened.public_config()['api_key_set'])
        self.assertFalse(self.work.save_config({'clear_api_key':True})['api_key_set'])
    def test_tts_config_is_redacted_and_endpoint_change_clears_key(self):
        public=self.configure(tts_base_url='https://open.bigmodel.cn/api/paas/v4',tts_model='glm-tts',tts_voice='tongtong',tts_api_key='tts-test-secret')
        self.assertTrue(public['tts_api_key_set']); self.assertNotIn('tts-test-secret',json.dumps(public))
        self.work.save_config({'tts_api_key':''});self.assertTrue(self.work.public_config()['tts_api_key_set'])
        self.work.save_config({'tts_base_url':'https://other.example/v1'});self.assertFalse(self.work.public_config()['tts_api_key_set'])
        with self.assertRaises(ValueError):self.work.save_config({'tts_voice':'invalid'})

    def test_input_unconfigured_and_https(self):
        with self.assertRaises(ValueError): self.work.start_generation({'prompt':'test'})
        for base in ['http://example.com','https://user:pass@example.com','https://example.com?key=secret']:
            with self.assertRaises(ValueError): self.configure(base_url=base)
    def test_deepseek_stream_uses_json_and_disables_thinking(self):
        self.configure(provider='deepseek', model='deepseek-flash')
        response = mock.MagicMock()
        text = json.dumps(BUNDLE)
        line = ('data: '+json.dumps({'choices':[{'delta':{'content':text},'finish_reason':'stop'}]})+'\n').encode()
        response.__enter__.return_value.readline.side_effect = [line, b'data: [DONE]\n']
        opener = mock.MagicMock(); opener.open.return_value = response
        with mock.patch.object(w, 'build_opener', return_value=opener):
            self.assertEqual(self.work._call_model(self.work.read_private_config(),'test',''), text)
        request = opener.open.call_args[0][0]
        payload = json.loads(request.data)
        self.assertEqual(payload['thinking'], {'type':'disabled'})
        self.assertEqual(payload['response_format'], {'type':'json_object'})
        self.assertTrue(payload['stream'])
        self.assertIn(w.generation_input_standard(), payload['messages'][0]['content'])
    def test_changing_endpoint_does_not_reuse_key(self):
        self.configure(stt_base_url='https://speech.example/v1',stt_api_key='speech-key')
        self.work.save_config({'base_url':'https://other.example/v1','stt_base_url':'https://other-speech.example/v1'})
        self.assertFalse(self.work.public_config()['api_key_set'])
        self.assertFalse(self.work.public_config()['stt_api_key_set'])
    def test_generation_fenced_json_and_failure_redacted(self):
        self.configure()
        with mock.patch.object(self.work,'_call_model',return_value='```json\n'+json.dumps(BUNDLE)+'\n```'):
            job=self.work.start_generation({'prompt':'timer','theme_id':'light'})
            ready=self.wait_job(job['job_id'])['bundle']; self.assertEqual(ready['manifest'],dict(BUNDLE['manifest'],icon='icon.svg')); self.assertIn('icon.svg',ready['files']); self.assertIn('atom-theme',ready['files']['index.html'])
        with mock.patch.object(self.work,'_call_model',side_effect=RuntimeError('secret-test-key')):
            job=self.work.start_generation({'prompt':'timer'})
            result=self.wait_job(job['job_id']); self.assertEqual(result['status'],'failed'); self.assertNotIn('secret-test-key',json.dumps(result))
    def test_fullscreen_layout_and_job_id(self):
        value=json.loads(json.dumps(BUNDLE)); value['manifest']['layout']='fullscreen'
        self.assertEqual(w.validate_bundle(value)['manifest']['layout'],'fullscreen')
        value['manifest']['layout']='scroll'
        with self.assertRaises(ValueError): w.validate_bundle(value)
        for job_id in [None,[],42,'../x']:
            with self.assertRaises(ValueError): self.work.get_job(job_id)

    def test_invalid_bundle_paths(self):
        value=json.loads(json.dumps(BUNDLE)); value['files']['../escape']='x'
        with self.assertRaises(ValueError): w.validate_bundle(value)
    def test_protocol_headers_and_response_parsing(self):
        self.configure()
        response=mock.MagicMock(); response.__enter__.return_value=response
        response.read.return_value=json.dumps({'choices':[{'message':{'content':json.dumps(BUNDLE)}}]}).encode()
        opener=mock.Mock(); opener.open.return_value=response
        with mock.patch.object(w,'build_opener',return_value=opener):
            self.assertEqual(self.work._call_model(self.work.read_private_config(),'hello',''),json.dumps(BUNDLE))
            req=opener.open.call_args[0][0]
            prompt=json.loads(req.data)['messages'][0]['content']
            self.assertIn('480x360',prompt); self.assertIn('.atom-scroll',prompt); self.assertIn('Never hide overflow',prompt); self.assertIn('AtomApp.save',prompt); self.assertIn('64KiB',prompt); self.assertIn('AtomApp.onSuspend',prompt)
            self.assertEqual(req.full_url,'https://example.com/v1/chat/completions'); self.assertEqual(req.get_header('Authorization'),'Bearer secret-test-key')
            self.assertEqual(opener.open.call_args[1]['timeout'],90)
        self.configure(provider='anthropic',protocol='anthropic',base_url='https://api.anthropic.com/v1')
        response.read.return_value=json.dumps({'content':[{'type':'text','text':'hello'}]}).encode()
        with mock.patch.object(w,'build_opener',return_value=opener):
            self.assertEqual(self.work._call_model(self.work.read_private_config(),'hello',''),'hello')
            req=opener.open.call_args[0][0]; self.assertEqual(req.get_header('X-api-key'),'secret-test-key'); self.assertTrue(req.full_url.endswith('/messages'))
        self.assertIsNone(w.NoRedirect().redirect_request(None,None,302,'',{},'https://other.example'))
