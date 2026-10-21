"""Official AI channel: model calls on the service's own key, metered per account and month.

Devices without their own model key submit an OpenAI-style chat payload with their market session
token and poll for the result (nginx closes requests after 30 s, generations take longer). The key is
read from the environment (ATOM_AI_ZHIPU_KEY, root-only /etc/atom/ai.env) and never leaves the server.
Prompts and answers are kept in memory only until the device collects them; usage counts are stored.
"""
import json
import os
import secrets
import sqlite3
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .service import MarketError, require

ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'  # ATOM_AI_ENDPOINT overrides (tests, other OpenAI-compatible providers)
PURPOSES = ('generate', 'chat', 'voice')
# Zhipu-compatible passthrough for the robot and voice features, which stream and must stay unchanged.
ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4'  # ATOM_AI_ZHIPU_BASE overrides (tests)
ROUTES = {'/chat/completions': 'chat', '/audio/speech': 'voice', '/audio/transcriptions': 'voice'}
CHAT_MODELS = ('glm-4.5-air', 'glm-4-flash-250414')
QUOTA_LINE = '[难过]这个月的聊天额度用完啦，下个月一号再来找我聊吧。'
MAX_PAYLOAD = 400 * 1024
JOB_TTL = 900


def settings():
    return dict(
        key=os.environ.get('ATOM_AI_ZHIPU_KEY', '').strip(),
        model=os.environ.get('ATOM_AI_GENERATE_MODEL', 'glm-4.5-air').strip(),
        quota={'generate': int(os.environ.get('ATOM_AI_QUOTA_GENERATE', '30')),
               'chat': int(os.environ.get('ATOM_AI_QUOTA_CHAT', '300')),
               'voice': int(os.environ.get('ATOM_AI_QUOTA_VOICE', '1500'))},
    )


class OfficialAI:
    def __init__(self, path, market, clock=time.time, call=None):
        self.market, self.clock = market, clock
        self.call = call or self.upstream
        self.lock = threading.Lock()
        self.jobs = {}
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS usage(user TEXT, month TEXT, purpose TEXT, count INTEGER, PRIMARY KEY(user,month,purpose))')
        self.db.commit()
        if path != ':memory:':
            os.chmod(path, 0o600)

    def close(self):
        self.db.close()

    def month(self):
        return time.strftime('%Y-%m', time.gmtime(self.clock()))

    def used(self, user, purpose):
        row = self.db.execute('SELECT count FROM usage WHERE user=? AND month=? AND purpose=?', (user, self.month(), purpose)).fetchone()
        return row[0] if row else 0

    def adjust(self, user, purpose, delta):
        self.db.execute('INSERT INTO usage VALUES(?,?,?,0) ON CONFLICT(user,month,purpose) DO NOTHING', (user, self.month(), purpose))
        self.db.execute('UPDATE usage SET count=MAX(0,count+?) WHERE user=? AND month=? AND purpose=?', (delta, user, self.month(), purpose))
        self.db.commit()

    def quota(self, user):
        conf = settings()
        value = {p: dict(limit=conf['quota'][p], used=self.used(user, p), remaining=max(0, conf['quota'][p] - self.used(user, p))) for p in PURPOSES}
        value.update(available=bool(conf['key']), month=self.month())
        return value

    def handle(self, method, path, token, body):
        user = self.market.auth(token)['id']
        if method == 'GET' and path == '/market/v1/ai/quota':
            return self.quota(user)
        if method == 'POST' and path == '/market/v1/ai/jobs':
            return self.submit(user, body)
        if method == 'GET' and path.startswith('/market/v1/ai/jobs/'):
            return self.result(user, path.rsplit('/', 1)[-1])
        raise MarketError(404, 'Not found', 'not_found')

    def submit(self, user, body):
        conf = settings()
        require(conf['key'], 'ATOM 官方 AI 暂未开通，请在工作坊填写自己的模型 Key', 503, 'ai_unavailable')
        purpose = body.get('purpose')
        require(purpose == 'generate', 'Invalid purpose')
        messages = body.get('messages')
        require(isinstance(messages, list) and 1 <= len(messages) <= 8 and all(isinstance(m, dict) and m.get('role') in ('system', 'user', 'assistant') and isinstance(m.get('content'), str) for m in messages), 'Invalid messages')
        require(len(json.dumps(messages, ensure_ascii=False).encode()) <= MAX_PAYLOAD, '需求太长', 413)
        payload = dict(model=conf['model'], messages=messages, max_tokens=min(int(body.get('max_tokens') or 4000), 8000), stream=False)
        if body.get('json'):
            payload['response_format'] = {'type': 'json_object'}
        if payload['model'].startswith('glm-4.5') or payload['model'].startswith('glm-4.6'):
            payload['thinking'] = {'type': 'disabled'}
        with self.lock:
            self.expire()
            require(sum(j['user'] == user and j['status'] == 'running' for j in self.jobs.values()) < 2, '已有生成任务，请稍后再试', 429, 'busy')
            require(self.used(user, purpose) < conf['quota'][purpose], '本月 ATOM 官方额度已用完，下月 1 日恢复；也可以在工作坊填写自己的模型 Key', 429, 'quota_exhausted')
            self.adjust(user, purpose, 1)
            job = secrets.token_hex(16)
            self.jobs[job] = dict(user=user, purpose=purpose, status='running', created=self.clock())
        threading.Thread(target=self.run, args=(job, conf['key'], payload), daemon=True).start()
        return {'job_id': job, 'remaining': max(0, conf['quota'][purpose] - self.used(user, purpose))}

    def run(self, job, key, payload):
        try:
            value, error = self.call(key, payload), None
        except MarketError as exc:
            value, error = None, exc.message
        with self.lock:
            item = self.jobs.get(job)
            if not item:
                return
            if error:
                self.adjust(item['user'], item['purpose'], -1)  # failed calls do not count
                item.update(status='failed', error=error)
            else:
                item.update(status='completed', result=value)

    def result(self, user, job):
        with self.lock:
            item = self.jobs.get(job)
            require(item and item['user'] == user, 'Job not found', 404, 'not_found')
            if item['status'] == 'running':
                return {'status': 'running'}
            self.jobs.pop(job)
            return {'status': item['status'], 'result': item.get('result'), 'error': item.get('error')}

    def expire(self):
        for job in [j for j, v in self.jobs.items() if self.clock() - v['created'] > JOB_TTL]:
            self.jobs.pop(job)

    def proxy(self, handler, sub):
        """Stream one Zhipu call for the robot and voice features (HTTP handler level, no JSON envelope)."""
        def reply(status, value, kind='application/json; charset=utf-8'):
            data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
            handler.send_response(status)
            handler.send_header('Content-Type', kind)
            handler.send_header('Content-Length', str(len(data)))
            handler.send_header('Cache-Control', 'no-store')
            handler.end_headers()
            handler.wfile.write(data)
        purpose = ROUTES.get(sub)
        if not purpose:
            return reply(404, {'error': 'Not found'})
        auth = handler.headers.get('Authorization', '')
        try:
            user = self.market.auth(auth[7:] if auth.startswith('Bearer ') else '')['id']
        except MarketError:
            return reply(401, {'error': '账号登录已过期，请在应用市场重新登录'})
        try:
            length = int(handler.headers.get('Content-Length', '0'))
        except ValueError:
            length = -1
        if not 0 < length <= 3 * 1024 * 1024:
            return reply(413, {'error': 'Request too large'})
        raw, kind = handler.rfile.read(length), handler.headers.get('Content-Type', '')
        if sub == '/audio/transcriptions':
            if not kind.startswith('multipart/form-data'):
                return reply(415, {'error': 'Multipart audio required'})
        else:
            try:
                body = json.loads(raw.decode('utf-8'))
            except (ValueError, UnicodeError):
                return reply(400, {'error': 'Invalid JSON request'})
            if sub == '/chat/completions':
                messages = body.get('messages')
                if not (isinstance(messages, list) and 1 <= len(messages) <= 20 and len(json.dumps(messages, ensure_ascii=False).encode()) <= 64 * 1024):
                    return reply(400, {'error': 'Invalid messages'})
                body = dict(model=body.get('model') if body.get('model') in CHAT_MODELS else CHAT_MODELS[0], messages=messages,
                            stream=body.get('stream') is True, max_tokens=min(int(body.get('max_tokens') or 400), 600), temperature=body.get('temperature', 0.8))
                if body['model'].startswith('glm-4.5'):
                    body['thinking'] = {'type': 'disabled'}
            else:
                if not (isinstance(body.get('input'), str) and 1 <= len(body['input']) <= 1024):
                    return reply(400, {'error': 'Invalid speech text'})
                body = {k: body[k] for k in ('input', 'voice', 'response_format', 'stream', 'encode_format', 'speed', 'volume') if k in body}
                body['model'] = 'glm-tts'
            raw, kind = json.dumps(body, ensure_ascii=False).encode('utf-8'), 'application/json'
        conf = settings()
        if not conf['key']:
            return reply(503, {'error': 'ATOM 官方 AI 暂未开通'})
        with self.lock:
            exhausted = self.used(user, purpose) >= conf['quota'][purpose]
            if not exhausted:
                self.adjust(user, purpose, 1)
        if exhausted:
            if sub == '/chat/completions' and body.get('stream'):
                # Said in character by the robot instead of an error code it cannot explain.
                event = {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': QUOTA_LINE}, 'finish_reason': 'stop'}]}
                return reply(200, ('data: ' + json.dumps(event, ensure_ascii=False) + '\n\ndata: [DONE]\n\n').encode(), 'text/event-stream')
            return reply(429, {'error': '本月 ATOM 官方' + ('聊天' if purpose == 'chat' else '语音') + '额度已用完，下月 1 日恢复'})
        request = Request(os.environ.get('ATOM_AI_ZHIPU_BASE', ZHIPU_BASE) + sub, data=raw, headers={'Authorization': 'Bearer ' + conf['key'], 'Content-Type': kind})
        try:
            response = urlopen(request, timeout=25)
        except HTTPError as exc:
            with self.lock:
                self.adjust(user, purpose, -1)
            # The provider's own error body: the robot recognises its content-filter code.
            return reply(exc.code, exc.read(64 * 1024) or b'{}')
        except (URLError, OSError):
            with self.lock:
                self.adjust(user, purpose, -1)
            return reply(502, {'error': '模型服务暂时无法连接'})
        with response:
            handler.send_response(200)
            handler.send_header('Content-Type', response.headers.get('Content-Type', 'application/octet-stream'))
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('Connection', 'close')
            handler.end_headers()
            while True:
                chunk = response.read1(16384) if hasattr(response, 'read1') else response.read(16384)
                if not chunk:
                    break
                handler.wfile.write(chunk)
                handler.wfile.flush()

    @staticmethod
    def upstream(key, payload):
        request = Request(os.environ.get('ATOM_AI_ENDPOINT', ENDPOINT), data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=170) as response:
                value = json.loads(response.read(4 * 1024 * 1024).decode())
        except HTTPError as exc:
            raise MarketError(502, '模型服务返回错误（' + str(exc.code) + '），请稍后再试', 'ai_upstream')
        except (URLError, OSError, ValueError):
            raise MarketError(502, '模型服务暂时无法连接，请稍后再试', 'ai_upstream')
        require(isinstance(value, dict) and value.get('choices'), '模型服务没有返回内容', 502, 'ai_upstream')
        # Only what the device parses; nothing else from the provider reaches it.
        return {'choices': [{'message': {'role': 'assistant', 'content': c.get('message', {}).get('content', '')}, 'finish_reason': c.get('finish_reason')} for c in value['choices'][:1]]}
