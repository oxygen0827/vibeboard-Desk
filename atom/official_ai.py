"""ATOM official AI channel, used when the device has no model key of its own.

The service proxy closes requests after 30 s and generations take longer, so a call is a job:
submit the chat messages with the market session token, then poll until it finishes. The service
picks the model and meters each account per month; this module never sees a model key.
"""
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class OfficialError(Exception):
    """A message that is safe and useful to show the person as is."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def overlay(config, relay, token):
    """Model config that routes text generation through the official channel."""
    return dict(config, provider='atom', protocol='openai', model='atom-official', base_url=relay.rstrip('/'), api_key=token, official=True)


def voice_overlay(config, relay, token):
    """Robot chat, transcription and speech through the service's Zhipu-compatible proxy."""
    base = relay.rstrip('/') + '/market/v1/ai/zhipu'
    return dict(config, stt_base_url=base, stt_model='glm-asr-2512', stt_api_key=token,
                tts_base_url=base, tts_model='glm-tts', tts_api_key=token, official_voice=True)


def _call(config, method, path, body=None):
    url = urlsplit(config['base_url'])
    if not (url.scheme == 'https' or (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost'))):
        raise OfficialError('ATOM 服务地址无效')
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    request = Request(config['base_url'] + path, data=data, method=method, headers={'Authorization': 'Bearer ' + config['api_key'], 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with build_opener(_NoRedirect()).open(request, timeout=25) as response:
            return json.loads(response.read(4 * 1024 * 1024 + 1).decode('utf-8'))
    except HTTPError as exc:
        try:
            message = json.loads(exc.read(4096).decode('utf-8')).get('error')
        except (ValueError, UnicodeError, AttributeError):
            message = None
        if exc.code == 401:
            raise OfficialError('账号登录已过期，请在应用市场重新登录')
        raise OfficialError(message if isinstance(message, str) and message else 'ATOM 官方 AI 暂时不可用，请稍后再试')
    except (URLError, OSError, ValueError):
        raise OfficialError('连不上 ATOM 服务，请检查网络')


def complete(config, messages, max_tokens=8000, want_json=False, deadline=200, on_wait=None):
    """Run one chat completion and return the OpenAI-shaped response dict."""
    job = _call(config, 'POST', '/market/v1/ai/jobs', {'purpose': 'generate', 'messages': messages, 'max_tokens': max_tokens, 'json': want_json})
    job_id = job.get('job_id')
    if not isinstance(job_id, str):
        raise OfficialError('ATOM 服务没有接受这次生成')
    started = time.monotonic()
    while time.monotonic() - started < deadline:
        time.sleep(2)
        if on_wait:
            on_wait(time.monotonic() - started)
        state = _call(config, 'GET', '/market/v1/ai/jobs/' + job_id)
        if state.get('status') == 'completed' and isinstance(state.get('result'), dict):
            return state['result']
        if state.get('status') == 'failed':
            raise OfficialError(state.get('error') or '生成失败，这次不计入额度')
    raise OfficialError('生成超时，请稍后再试')


def quota(config):
    return _call(config, 'GET', '/market/v1/ai/quota')
