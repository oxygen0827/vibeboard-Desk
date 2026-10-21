"""Robot companion conversation: streaming Zhipu chat -> sentence-by-sentence streaming TTS -> one PulseAudio player.

Each sentence may begin with an emotion tag; the status reports the emotion, subtitle and loudness of the audio
that is playing right now so the eyes follow the voice. One conversation turn runs at a time; a new turn or stop
cancels the previous one. Credentials stay in the device model config and never reach the app.
"""
import audioop
import base64
import json
import queue
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from tts import VOICES
from workshop import NoRedirect

CHAT_MODELS = ('glm-4.5-air', 'glm-4-flash-250414')  # second is free; used when the first is unavailable
EMOTIONS = {'开心': 'happy', '难过': 'sad', '惊讶': 'surprised', '生气': 'angry', '害羞': 'shy',
            '思考': 'thinking', '困': 'sleepy', '喜欢': 'love', '疑惑': 'confused', '平静': 'calm'}
STYLES = {
    'lively': '活泼开朗、好奇心强，喜欢用轻松俏皮的语气，偶尔开个小玩笑',
    'gentle': '温柔体贴、耐心细致，说话轻声细语，善于安慰和鼓励',
    'witty': '机智幽默、略带一点嘴贫但不刻薄，喜欢接梗',
    'scholar': '博学冷静、条理清楚，喜欢用简单的话讲清楚道理',
}
RATE, FRAME = 24000, 1200  # 16-bit mono PCM at 24 kHz; loudness frames of 50 ms
CUE_SECONDS = 0.6  # provider's AI-content audio label at the start of each clip; kept, never stripped
TAG = re.compile(r'^\s*[\[【]([^\]】]{1,4})[\]】]\s*')
SENTENCE_END = re.compile(r'[。！？!?；;…\n]')
EMOJI = re.compile('[\U0001F000-\U0001FAFF☀-➿️]')


def system_prompt(name, style, note):
    now = datetime.now().strftime('%Y年%m月%d日 %H:%M，星期') + '一二三四五六日'[datetime.now().weekday()]
    return (f'你叫{name}，是住在用户桌面小电脑里的机器人伙伴，有一双会动的大眼睛，通过语音和用户聊天。性格：{STYLES[style]}。'
            + (f'用户希望你：{note}。' if note else '') +
            f'现在是{now}。\n'
            '说话规则：\n'
            '1. 你的话会被直接朗读出来，所以要像朋友聊天一样口语化、简短，通常一到三句，不超过80个字；用户要求讲故事或解释时可以长一些，但不超过200字。\n'
            '2. 每一句话开头都加一个情绪标签，只能从这些里选：[开心][难过][惊讶][生气][害羞][思考][困][喜欢][疑惑][平静]。例如：[开心]好呀！[思考]让我想想。\n'
            '3. 不要使用表情符号、颜文字、Markdown、列表或括号里的动作描写。\n'
            '4. 你只能聊天：不能播放音乐、设闹钟、上网查询、看图或控制设备，不要主动提出做这些事。不知道的事情（比如实时新闻、天气）就坦率说不知道，不要编造。\n'
            '5. 用户说中文就用中文回答。')


def clean(text):
    return re.sub(r'\s+', ' ', EMOJI.sub('', re.sub(r'[*#`_>~]|\([^)]{0,20}\)|（[^）]{0,20}）', '', text))).strip()


class RobotTalk:
    def __init__(self, opener=None, player=None):
        self.lock = threading.RLock()
        self.job = None
        self.opener = opener or build_opener(NoRedirect())
        self.player = player or (lambda: subprocess.Popen(['paplay', '--raw', '--format=s16le', '--rate=%d' % RATE, '--channels=1'],
                                                          stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

    # Public API ------------------------------------------------------------
    def start(self, config, data):
        text = data.get('text')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500: raise ValueError('请说 1–500 字')
        key, base = config.get('tts_api_key') or config.get('stt_api_key'), (config.get('tts_base_url') or config.get('stt_base_url') or '').rstrip('/')
        if not (key and base.startswith('https://')): raise ValueError('请先在工作坊配置智谱语音服务')
        history = data.get('history') or []
        if not isinstance(history, list) or len(history) > 16: raise ValueError('对话记录无效')
        messages = []
        for item in history:
            if not (isinstance(item, dict) and item.get('role') in ('user', 'assistant') and isinstance(item.get('content'), str) and len(item['content']) <= 600):
                raise ValueError('对话记录无效')
            messages.append({'role': item['role'], 'content': item['content']})
        name = data.get('name') if isinstance(data.get('name'), str) and 1 <= len(data['name'].strip()) <= 12 else '小原'
        style = data.get('style') if data.get('style') in STYLES else 'lively'
        note = data.get('note') if isinstance(data.get('note'), str) and len(data['note']) <= 200 else ''
        voice = data.get('voice') if data.get('voice') in VOICES else config.get('tts_voice', 'tongtong')
        messages = [{'role': 'system', 'content': system_prompt(name.strip(), style, note.strip())}] + messages + [{'role': 'user', 'content': text.strip()}]
        job = dict(id=uuid.uuid4().hex, phase='thinking', emotion='thinking', reply='', segments=[], levels=[],
                   started=None, error=None, speech=True, cancelled=False, process=None, model=None)
        with self.lock:
            self._cancel()
            self.job = job
        threading.Thread(target=self._run, args=(job, base, key, voice, messages), daemon=True).start()
        return {'job_id': job['id']}

    def status(self, job_id):
        with self.lock:
            job = self.job
            if not job or job['id'] != job_id: return {'phase': 'gone'}
            now = time.monotonic()
            played = 0.0 if job['started'] is None else max(0.0, now - job['started'] - 0.15)  # PulseAudio latency
            written = len(job['levels']) * FRAME / RATE
            position = min(played, written)
            current = [s for s in job['segments'] if s['at'] <= position]
            frame = int(position * RATE / FRAME)
            playing = job['phase'] == 'speaking' and job['started'] is not None and played < written + 0.2
            return dict(phase=job['phase'], emotion=(current[-1]['emotion'] if current else job['emotion']),
                        subtitle=(current[-1]['text'] if current else ''),
                        reply=job['reply'], level=job['levels'][frame] if playing and frame < len(job['levels']) else 0.0,
                        ahead=job['levels'][frame + 1:frame + 7] if playing else [], speech=job['speech'], error=job['error'])

    def stop(self):
        with self.lock:
            self._cancel()
            return {'ok': True}

    # Internals -------------------------------------------------------------
    def _cancel(self):
        job, self.job = self.job, None
        if job:
            job['cancelled'] = True
            if job['process']:
                try: job['process'].kill()
                except OSError: pass

    def _post(self, url, key, body, timeout=30):
        request = Request(url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                          headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        return self.opener.open(request, timeout=timeout)

    def _events(self, response):
        for line in response:
            line = line.decode('utf-8', 'replace').strip()
            if not line.startswith('data:'): continue
            payload = line[5:].strip()
            if payload == '[DONE]': return
            try: yield json.loads(payload)
            except ValueError: continue

    def _chat(self, job, base, key, messages):
        """Yield reply text deltas, falling back to the free model when the first one is unavailable."""
        last = None
        for model in CHAT_MODELS:
            body = dict(model=model, messages=messages, stream=True, max_tokens=400, temperature=0.8)
            if model.startswith('glm-4.5'): body['thinking'] = {'type': 'disabled'}
            try:
                response = self._post(base + '/chat/completions', key, body)
            except HTTPError as exc:
                last = exc
                if exc.code in (401, 403): break
                continue
            job['model'] = model
            with response:
                for event in self._events(response):
                    if job['cancelled']: return
                    delta = (event.get('choices') or [{}])[0].get('delta') or {}
                    if delta.get('content'): yield delta['content']
            return
        labels = {401: '密钥无效', 402: '账户余额不足', 403: '服务未开通', 429: '请求太频繁'}
        raise ValueError('聊天服务暂不可用：' + (labels.get(last.code, 'HTTP %d' % last.code) if isinstance(last, HTTPError) else '网络错误'))

    def _sentences(self, job, base, key, messages, out):
        buffer, emotion = '', 'calm'
        def emit(piece):
            nonlocal emotion
            piece = piece.strip()
            while True:
                tag = TAG.match(piece)
                if not tag: break
                emotion = EMOTIONS.get(tag.group(1), emotion)
                piece = piece[tag.end():]
            text = clean(piece)
            if text:
                job['reply'] += text
                out.put((emotion, text))
        try:
            for delta in self._chat(job, base, key, messages):
                buffer += delta
                while True:
                    end = SENTENCE_END.search(buffer)
                    if end:
                        cut = end.end()
                    elif len(buffer) > 40:  # long clause: cut at a comma so speech can start early
                        comma = re.search(r'[，,、]', buffer[20:])
                        cut = 20 + comma.end() if comma else None
                    else:
                        cut = None
                    if not cut: break
                    emit(buffer[:cut]); buffer = buffer[cut:]
                if job['cancelled']: return
            emit(buffer)
        except ValueError as exc:
            job['llm_error'] = str(exc)
        except Exception:
            job['llm_error'] = '聊天服务暂不可用：网络错误'
        finally:
            job['llm_done'] = True
            out.put(None)

    def _speak(self, job, base, key, voice, text, process):
        body = dict(model='glm-tts', input=text[:1024], voice=voice, response_format='pcm', stream=True, encode_format='base64')
        with self._post(base + '/audio/speech', key, body, timeout=30) as response:
            for event in self._events(response):
                if job['cancelled']: return
                chunk = ((event.get('choices') or [{}])[0].get('delta') or {}).get('content')
                if not chunk: continue
                pcm = base64.b64decode(chunk)
                pcm = pcm[:len(pcm) - len(pcm) % 2]
                for i in range(0, len(pcm) - FRAME * 2 + 1, FRAME * 2):
                    job['levels'].append(round(min(1.0, audioop.rms(pcm[i:i + FRAME * 2], 2) / 6000.0), 3))
                if job['started'] is None: job['started'] = time.monotonic()
                process.stdin.write(pcm)
                process.stdin.flush()

    def _run(self, job, base, key, voice, messages):
        # The provider prefixes every synthesized clip with a mandatory AI-content audio cue (about 0.6 s),
        # so the whole reply is synthesized in one request and the cue plays once per reply, not per sentence.
        sentences = queue.Queue()
        threading.Thread(target=self._sentences, args=(job, base, key, messages, sentences), daemon=True).start()
        process = None
        try:
            parts = []
            while True:
                item = sentences.get(timeout=60)
                if item is None or job['cancelled']: break
                parts.append(item)
                job['emotion'] = item[0]
            if job['cancelled']: return
            if job.get('llm_error'): raise ValueError(job['llm_error'])
            if not parts: raise ValueError('没有听清，再说一次吧')
            text = ''.join(t for _, t in parts)
            job['segments'] = [dict(at=0.0 if i == 0 else float('inf'), emotion=e, text=t) for i, (e, t) in enumerate(parts)]
            try:
                with self.lock:
                    if job['cancelled']: return
                    process = job['process'] = self.player()
                    job['phase'] = 'speaking'
                self._speak(job, base, key, voice, text, process)
                # Place each sentence in the audio by its share of the text, after the leading cue.
                total = len(job['levels']) * FRAME / RATE
                cue = min(CUE_SECONDS, total / 2)
                done = 0
                for segment in job['segments']:
                    segment['at'] = cue + (total - cue) * done / max(1, len(text)) if done else 0.0
                    done += len(segment['text'])
            except (HTTPError, URLError, OSError, ValueError):
                # Keep the conversation going as subtitles when speech is unavailable.
                job['speech'], job['error'] = False, '语音播报暂不可用，已显示文字'
                for segment in job['segments']: segment['at'] = 0.0
            if process and not job['cancelled']:
                process.stdin.close()
                process.wait(timeout=120)
            if job['cancelled']: return
            job['phase'] = 'done'
        except queue.Empty:
            job['error'], job['phase'] = '回答超时，请再试一次', 'error'
        except ValueError as exc:
            job['error'], job['phase'] = str(exc), 'error'
        except Exception:
            job['error'], job['phase'] = '对话出错了，请再试一次', 'error'
        finally:
            if process and process.poll() is None and job['cancelled']:
                try: process.kill()
                except OSError: pass
