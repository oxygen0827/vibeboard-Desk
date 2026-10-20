import importlib.util
from pathlib import Path
import tempfile
import wave
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('voice',str(Path(__file__).resolve().parents[1]/'voice.py'))
voice=importlib.util.module_from_spec(spec);spec.loader.exec_module(voice)

class VoiceTests(unittest.TestCase):
    def fake_capture(self, popen):
        def capture(args, **kwargs):
            Path(args[-1]).write_bytes(b'RIFF'+b'0'*100)
            process=mock.Mock();process.poll.return_value=None;self.capture_process=process
            return process
        popen.side_effect=capture

    def test_user_start_stop_and_paths(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(voice.subprocess,'Popen') as popen, mock.patch.object(voice.threading,'Timer'):
            s=voice.VoiceRecorder(d);self.fake_capture(popen)
            with mock.patch.object(s,'_run',return_value='0\tmic\tx\tx\tIDLE'):
                self.assertFalse(s.public_status()['recording']);popen.assert_not_called()
                value=s.start();rid=value['recording_id'];self.assertTrue(value['recording'])
                with self.assertRaises(ValueError):s.start()
                with self.assertRaises(ValueError):s.recording_path(rid)
                (s.root/(rid+'.wav')).write_bytes(b'RIFFtest')
                s.stop();self.capture_process.terminate.assert_called_once()
                self.assertEqual(s.recording_path(rid).read_bytes(),b'RIFFtest')
                with self.assertRaises(ValueError):s.recording_path('../../password')

    def test_monitor_fallback_and_failure_cleanup(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(voice.subprocess,'Popen') as popen, mock.patch.object(voice.threading,'Timer'):
            s=voice.VoiceRecorder(d);self.fake_capture(popen)
            with mock.patch.object(s,'_run',side_effect=['0\tsink.monitor\tx','8','1\tatom_mic\tx',''] ) as run:
                s.start();s.stop()
                self.assertIn(mock.call(['pactl','unload-module','8']),run.call_args_list)
            with mock.patch.object(s,'_run',side_effect=['','9','','']) as run:
                with self.assertRaises(ValueError):s.start()
                self.assertIn(mock.call(['pactl','unload-module','9']),run.call_args_list)

    def test_recording_is_capped_to_provider_thirty_seconds(self):
        with tempfile.TemporaryDirectory() as d:
            recorder=voice.VoiceRecorder(d);recorder.root.mkdir();recorder.recording_id='a'*32
            path=recorder.root/(recorder.recording_id+'.wav')
            with wave.open(str(path),'wb') as wav:
                wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\0\0'*16000*31)
            recorder.stop()
            with wave.open(str(path),'rb') as wav:self.assertEqual(wav.getnframes(),16000*30)

    def test_size_and_timer_generation(self):
        with tempfile.TemporaryDirectory() as d:
            s=voice.VoiceRecorder(d);s.root.mkdir();s.recording_id='a'*32
            path=s.root/(s.recording_id+'.wav');path.write_bytes(b'x'*(voice.MAX_BYTES+1))
            self.assertEqual(s.stop()['error'],'recording too large');self.assertFalse(path.exists())
            with mock.patch.object(s,'stop') as stop:
                s._auto_stop('b'*32);stop.assert_not_called()

    def test_voice_fan_lifecycle_and_failure(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(voice.subprocess,'Popen') as popen, mock.patch.object(voice.threading,'Timer'):
            s=voice.VoiceRecorder(d);self.fake_capture(popen)
            with mock.patch.object(s,'_run',return_value='0\tmic\tx'),mock.patch.object(s,'_fan',return_value={'quiet':True}) as fan:
                s.start(quiet_fan=True);self.assertTrue(s.fan_quiet)
                s.stop();self.assertFalse(s.fan_quiet);self.assertEqual(fan.call_args,mock.call('auto'))
            with mock.patch.object(s,'_run',return_value=''),mock.patch.object(s,'_fan',return_value={'quiet':True}) as fan:
                with self.assertRaises(ValueError):s.start(quiet_fan=True)
                self.assertEqual(fan.call_args,mock.call('auto'))

    def test_targeted_stop_cannot_stop_newer_recording(self):
        with tempfile.TemporaryDirectory() as d:
            s=voice.VoiceRecorder(d);s.recording_id='b'*32;s.process=mock.Mock();s.timer=mock.Mock()
            self.assertTrue(s.stop('a'*32)['ignored'])
            s.process.terminate.assert_not_called();s.timer.cancel.assert_not_called()
