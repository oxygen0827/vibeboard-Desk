"""Bounded creative planning contracts; no network or model credentials required."""
import copy
import json
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import experiences

WORLD = dict(title='小岛', sky='night', weather='rain', atmosphere=.5,
             objects=[dict(id='cafe', type='cafe', x=-4, z=4, scale=.4, color='#AABBCC')])
DUET = dict(title='回声', bpm=90, instrument='bell', notes=[dict(pitch=60, time=0, duration=.4, velocity=.7)])
VISUAL = dict(title='星尘', fragment='precision mediump float; void main(){gl_FragColor=vec4(1.0);}', palette=['#aabbcc'])
CONFIG = dict(api_key='sk-test-DO-NOT-LEAK-123456', base_url='https://models.example/v1', model='test')

class ValidationTests(unittest.TestCase):
    def test_world_accepts_boundary_and_removes_untrusted_extra_fields(self):
        value=copy.deepcopy(WORLD);value['script']='alert(1)';value['objects'][0]['onclick']='bad()'
        result=experiences.validate('world',value)
        self.assertEqual(result['objects'][0]['x'],-4)
        self.assertNotIn('script',result);self.assertNotIn('onclick',result['objects'][0])

    def test_world_rejects_out_of_range_nonfinite_and_invalid_objects(self):
        for field,value in [('x',4.01),('z',-4.01),('scale',.39),('scale',2.01),('x',True),('x',float('nan')),('z',float('inf')),('type','script'),('color','url(secret)')]:
            with self.subTest(field=field,value=value):
                scene=copy.deepcopy(WORLD);scene['objects'][0][field]=value
                with self.assertRaises(ValueError):experiences.validate('world',scene)
        for field,value in [('sky','invalid'),('weather','fog'),('atmosphere',1.1),('objects',[WORLD['objects'][0]]*33)]:
            scene=copy.deepcopy(WORLD);scene[field]=value
            with self.assertRaises(ValueError):experiences.validate('world',scene)

    def test_duet_note_and_timing_boundaries(self):
        good=copy.deepcopy(DUET);good.update(bpm=160);good['notes']=[dict(pitch=48,time=0,duration=.1,velocity=.1),dict(pitch=84,time=32,duration=2,velocity=1)]
        self.assertEqual(len(experiences.validate('duet',good)['notes']),2)
        for field,value in [('pitch',47),('pitch',84.1),('pitch',60.5),('time',32.1),('time',-1),('duration',0),('velocity',True),('velocity',1.01)]:
            with self.subTest(field=field,value=value):
                bad=copy.deepcopy(DUET);bad['notes'][0][field]=value
                with self.assertRaises(ValueError):experiences.validate('duet',bad)
        for field,value in [('notes',[]),('notes',DUET['notes']*129),('bpm',49),('instrument','unknown')]:
            bad=copy.deepcopy(DUET);bad[field]=value
            with self.assertRaises(ValueError):experiences.validate('duet',bad)

    def test_shader_allows_small_fixed_loop_but_blocks_unbounded_work(self):
        good=copy.deepcopy(VISUAL);good['fragment']='void main(){for(int i=0;i<32;i++){ } gl_FragColor=vec4(1.);}'
        experiences.validate('visual',good)
        for fragment in ['void main(){while(true){}}','void main(){do{}while(true);}','void main(){discard;}','#extension GL_OES_x : enable\nvoid main(){}','#define N 999\nvoid main(){}','void main(){for(int i=0;i<33;i++){}}','void main(){for(int i=0;i<u_time;i++){}}','void main(){for(int i=1;i<10;i++){}}','void main(){for(;;){}}','x'*20001]:
            with self.subTest(fragment=fragment[:70]):
                with self.assertRaises(ValueError):experiences.validate('visual',dict(VISUAL,fragment=fragment))
        for palette in [['red'],['#ffffff']*9,'#ffffff']:
            with self.assertRaises(ValueError):experiences.validate('visual',dict(VISUAL,palette=palette))
        with self.assertRaises(ValueError):experiences.validate('unknown',{})

class JobTests(unittest.TestCase):
    def queued(self, service, kind='world', jid='one'):
        service.jobs[jid]=dict(id=jid,kind=kind,status='queued',phase='等待模型')
        return jid

    def test_concurrency_cancel_and_kind_isolation(self):
        s=experiences.Experiences()
        with mock.patch.object(experiences.threading,'Thread') as thread:
            a=s.start(CONFIG,dict(kind='world',prompt='一座小岛'))['job']['id']
            b=s.start(CONFIG,dict(kind='duet',prompt='回应'))['job']['id']
            with self.assertRaises(ValueError):s.start(CONFIG,dict(kind='visual',prompt='星尘'))
            with self.assertRaises(ValueError):s.status(a,'duet')
            with self.assertRaises(ValueError):s.cancel(a,'duet')
            self.assertEqual(s.cancel(a,'world')['job']['status'],'cancelled')
            self.assertFalse(s._set(a,status='completed',result=WORLD))
            c=s.start(CONFIG,dict(kind='visual',prompt='星尘'))['job']['id']
            self.assertNotEqual(b,c);self.assertEqual(thread.call_count,3)
        self.assertNotIn(CONFIG['api_key'],json.dumps(s.jobs))

    def test_cancel_inflight_cannot_publish_late_model_result(self):
        s=experiences.Experiences();jid=self.queued(s);entered=threading.Event();release=threading.Event()
        response=mock.MagicMock()
        def read(_):
            entered.set();release.wait(2)
            return json.dumps(dict(choices=[dict(message=dict(content=json.dumps(WORLD)))])).encode()
        response.__enter__.return_value.read.side_effect=read
        opener=mock.Mock();opener.open.return_value=response
        with mock.patch.object(experiences,'build_opener',return_value=opener):
            t=threading.Thread(target=s._run,args=(jid,CONFIG,'小岛',{}));t.start()
            self.assertTrue(entered.wait(2));s.cancel(jid,'world');release.set();t.join(2)
        self.assertFalse(t.is_alive());self.assertEqual(s.status(jid,'world')['job']['status'],'cancelled')
        self.assertNotIn('result',s.status(jid,'world')['job'])

    def test_invalid_config_input_does_not_start_worker(self):
        s=experiences.Experiences()
        for data in [dict(kind='invalid',prompt='x'),dict(kind='world',prompt=''),dict(kind='world',prompt='x'*2001),dict(kind='world',prompt='x',state={'big':'x'*65537})]:
            with self.assertRaises(ValueError):s.start(CONFIG,data)
        with self.assertRaises(ValueError):s.start({},dict(kind='world',prompt='x'))
        self.assertEqual(s.jobs,{})

    def test_http_and_runtime_upstream_errors_never_expose_secrets(self):
        for error in [RuntimeError(CONFIG['api_key']),OSError('https://secret.example/?key='+CONFIG['api_key'])]:
            s=experiences.Experiences();jid=self.queued(s)
            opener=mock.Mock();opener.open.side_effect=error
            with mock.patch.object(experiences,'build_opener',return_value=opener):s._run(jid,CONFIG,'x',{})
            status=s.status(jid,'world')['job'];self.assertEqual(status['status'],'failed');self.assertNotIn(CONFIG['api_key'],json.dumps(status))

    def test_valueerror_from_upstream_never_exposes_secrets(self):
        s=experiences.Experiences();jid=self.queued(s)
        opener=mock.Mock();opener.open.side_effect=ValueError(CONFIG['api_key'])
        with mock.patch.object(experiences,'build_opener',return_value=opener):s._run(jid,CONFIG,'x',{})
        self.assertNotIn(CONFIG['api_key'],json.dumps(s.status(jid,'world')))

if __name__=='__main__':unittest.main()
