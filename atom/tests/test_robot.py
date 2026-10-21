import base64
import io
import json
import sys
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import robot

CONFIG = {'tts_api_key': 'k', 'tts_base_url': 'https://open.bigmodel.cn/api/paas/v4', 'tts_voice': 'tongtong'}


def sse(events):
    return io.BytesIO(b''.join(b'data: ' + json.dumps(e, ensure_ascii=False).encode() + b'\n\n' for e in events) + b'data: [DONE]\n\n')


class FakeOpener:
    def __init__(self, chat_text, chat_errors=(), tts_error=False):
        self.chat_text, self.chat_errors, self.tts_error = chat_text, list(chat_errors), tts_error
        self.requests = []

    def open(self, request, timeout=None):
        body = json.loads(request.data)
        self.requests.append((request.full_url, body))
        if request.full_url.endswith('/chat/completions'):
            if self.chat_errors:
                raise HTTPError(request.full_url, self.chat_errors.pop(0), 'busy', {}, io.BytesIO())
            return sse([{'choices': [{'delta': {'content': piece}}]} for piece in self.chat_text])
        if self.tts_error:
            raise HTTPError(request.full_url, 429, 'busy', {}, io.BytesIO())
        tone = (b'\x00\x20' * 600 + b'\x00\xe0' * 600) * 4  # 0.2 s of loud square wave
        return sse([{'choices': [{'delta': {'content': base64.b64encode(tone).decode()}}]}])


class FakePlayer:
    def __init__(self):
        self.stdin = io.BytesIO()
        self.stdin.close = lambda: None
        self.killed = False

    def wait(self, timeout=None):
        return 0

    def poll(self):
        return None

    def kill(self):
        self.killed = True


def wait_done(talk, job_id, phases=('done', 'error')):
    for _ in range(200):
        status = talk.status(job_id)
        if status['phase'] in phases:
            return status
        time.sleep(0.01)
    raise AssertionError('timeout: ' + str(status))


class RobotTests(unittest.TestCase):
    def test_reply_is_split_into_tagged_sentences_with_speech_and_levels(self):
        opener, player = FakeOpener(['[开', '心]好呀，我在！', '[思考]让我想', '想今天聊什么。']), FakePlayer()
        talk = robot.RobotTalk(opener=opener, player=lambda: player)
        job = talk.start(CONFIG, {'text': '你好', 'name': '豆豆', 'style': 'gentle', 'history': [{'role': 'user', 'content': '早'}, {'role': 'assistant', 'content': '早呀'}]})['job_id']
        status = wait_done(talk, job)
        self.assertEqual(status['phase'], 'done')
        self.assertEqual(status['reply'], '好呀，我在！让我想想今天聊什么。')
        chat = opener.requests[0][1]
        self.assertEqual(chat['model'], 'glm-4.5-air')
        self.assertIn('豆豆', chat['messages'][0]['content'])
        self.assertEqual([m['role'] for m in chat['messages']], ['system', 'user', 'assistant', 'user'])
        speech = [b['input'] for url, b in opener.requests if url.endswith('/audio/speech')]
        self.assertEqual(speech, ['好呀，我在！', '让我想想今天聊什么。'])
        self.assertEqual(len(player.stdin.getvalue()), 2 * 4800 * 2)
        job_state = talk.job
        self.assertEqual([s['emotion'] for s in job_state['segments']], ['happy', 'thinking'])
        self.assertEqual(job_state['segments'][1]['at'], 0.2)
        self.assertTrue(all(level > 0.5 for level in job_state['levels']))

    def test_status_follows_playback_position(self):
        talk = robot.RobotTalk(opener=FakeOpener(['[开心]第一句。', '[难过]第二句。']), player=FakePlayer)
        job = talk.start(CONFIG, {'text': '你好'})['job_id']
        wait_done(talk, job)
        talk.job['phase'] = 'speaking'
        talk.job['started'] = time.monotonic() - 0.15 - 0.05
        self.assertEqual((talk.status(job)['emotion'], talk.status(job)['subtitle']), ('happy', '第一句。'))
        self.assertGreater(talk.status(job)['level'], 0.5)
        talk.job['started'] = time.monotonic() - 0.15 - 0.3
        self.assertEqual((talk.status(job)['emotion'], talk.status(job)['subtitle']), ('sad', '第二句。'))

    def test_falls_back_to_free_model_and_keeps_text_when_speech_fails(self):
        opener = FakeOpener(['[平静]只有文字。'], chat_errors=[429], tts_error=True)
        talk = robot.RobotTalk(opener=opener, player=FakePlayer)
        status = wait_done(talk, talk.start(CONFIG, {'text': '你好'})['job_id'])
        self.assertEqual(status['phase'], 'done')
        self.assertEqual([b['model'] for url, b in opener.requests if url.endswith('/chat/completions')], ['glm-4.5-air', 'glm-4-flash-250414'])
        self.assertFalse(status['speech'])
        self.assertEqual(status['reply'], '只有文字。')
        self.assertIn('语音播报暂不可用', status['error'])

    def test_bad_key_reports_error(self):
        talk = robot.RobotTalk(opener=FakeOpener([], chat_errors=[401]), player=FakePlayer)
        status = wait_done(talk, talk.start(CONFIG, {'text': '你好'})['job_id'])
        self.assertEqual(status['phase'], 'error')
        self.assertIn('密钥无效', status['error'])

    def test_new_turn_and_stop_cancel_the_previous_one(self):
        gate = threading.Event()
        class Slow(FakeOpener):
            def open(self, request, timeout=None):
                if request.full_url.endswith('/audio/speech'): gate.wait(2)
                return super().open(request, timeout)
        player = FakePlayer()
        talk = robot.RobotTalk(opener=Slow(['[开心]很长的一句话。']), player=lambda: player)
        first = talk.start(CONFIG, {'text': '一'})['job_id']
        time.sleep(0.05)
        talk.stop()
        self.assertTrue(player.killed)
        self.assertEqual(talk.status(first)['phase'], 'gone')
        gate.set()

    def test_input_validation_and_cleaning(self):
        talk = robot.RobotTalk(opener=FakeOpener([]), player=FakePlayer)
        for bad in ({'text': ''}, {'text': 'x' * 501}, {'text': 'hi', 'history': [{'role': 'system', 'content': 'x'}]}):
            with self.assertRaises(ValueError):
                talk.start(CONFIG, bad)
        with self.assertRaises(ValueError):
            talk.start({}, {'text': 'hi'})
        self.assertEqual(robot.clean('**好的**😀（笑）就这样'), '好的就这样')


if __name__ == '__main__':
    unittest.main()
