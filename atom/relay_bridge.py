"""Private device-side ATOM Connect client. No credentials cross the iframe bridge."""
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlencode

try:
    import e2e
except ImportError:  # python3-cryptography not installed: pairings stay unencrypted
    e2e = None

IDENTIFIER = re.compile(r'^[A-Za-z0-9_-]{1,128}$')
UNREADABLE = '[无法解密：配对密钥不一致，请解除配对后重新配对]'
MAX_RESPONSE = 2 * 1024 * 1024

class BridgeError(ValueError):
    def __init__(self, message, status=400, code='connect_error'):
        super().__init__(message)
        self.status, self.code = status, code

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

# The official service. Market browsing and account login work against it before the device
# registers; pairing still needs an explicit connect. Override for self-hosting or tests.
DEFAULT_RELAY = os.environ.get('ATOM_DEFAULT_RELAY', 'https://ldcx.tech/atom').rstrip('/')

def relay_url(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 2048:
        raise BridgeError('请输入中继服务器地址')
    value = value.strip().rstrip('/')
    url = urlsplit(value)
    try: port = url.port
    except ValueError: raise BridgeError('服务器端口无效')
    if not url.hostname or url.username or url.password or url.query or url.fragment or '\\' in value or any(c.isspace() for c in value):
        raise BridgeError('服务器地址无效，请勿包含凭据或查询参数')
    if any(p in ('.', '..') for p in url.path.split('/')):
        raise BridgeError('服务器路径无效')
    if url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise BridgeError('服务器需使用 HTTPS；HTTP 仅限本机调试')
    return value

def identifier(value, label='任务'):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise BridgeError(label + '标识无效')
    return value

class DeviceBridge:
    def __init__(self, state_dir):
        self.root = Path(state_dir)
        self.path = self.root / 'connect.json'
        self.lock = threading.RLock()
        self.config = {}
        self.key_cache = {}
        self.opener = build_opener(NoRedirect())
        try:
            if self.path.is_symlink(): raise ValueError('symlink')
            data = json.loads(self.path.read_text(encoding='utf-8'))
            relay_url(data['relay_url'])
            identifier(data['client_id'], '设备')
            if not isinstance(data.get('token'), str) or not 16 <= len(data['token']) <= 4096: raise ValueError('token')
            self.config = data
            self.ensure_key()
        except (OSError, ValueError, TypeError, KeyError): pass

    def ensure_key(self):
        # One X25519 identity per device registration; peers are pinned on first sight.
        if e2e and self.config.get('token') and not self.config.get('e2e_private'):
            self._save(dict(self.config, e2e_private=e2e.new_private_key(), peers={}))

    def pairing(self, computer_id, entry=None):
        """Encryption state of one pairing from a /v1/state entry: off, on, or a refusal reason."""
        # Always revalidate the peer before sending: cached keys can outlive a pairing.
        if entry is None:
            entry = next((p for p in self._request('/v1/state').get('paired', []) if p.get('client_id') == computer_id), None)
            if entry is None: return dict(state='changed' if self.config.get('peers', {}).get(computer_id) else 'off')
        if not e2e or not self.config.get('e2e_private'): return dict(state='off')
        mine = e2e.public_key(self.config['e2e_private'])
        if entry.get('own_key') is None:
            self._request('/v1/pair/keys', {'client_id': computer_id, 'public_key': mine})
            entry['own_key'] = mine
        if entry['own_key'] != mine: return dict(state='mismatch')
        peer, pinned = entry.get('public_key'), self.config.get('peers', {}).get(computer_id)
        if not peer: return dict(state='changed' if pinned else 'off')
        if pinned and pinned != peer: return dict(state='changed')
        if not pinned:
            self._save(dict(self.config, peers=dict(self.config.get('peers', {}), **{computer_id: peer})))
        info = dict(state='on', key=e2e.pair_key(self.config['e2e_private'], peer, self.config['client_id'], computer_id), code=e2e.safety_code(mine, peer))
        self.key_cache[computer_id] = info
        return info

    def reveal(self, key, envelope, aad, fallback=UNREADABLE):
        try: return e2e.open_sealed(key, envelope, aad)
        except (e2e.E2EError, AttributeError): return fallback

    def reveal_task(self, task, key):
        if key and isinstance(task, dict) and task.get('enc_prompt'):
            task['prompt'] = self.reveal(key, task.pop('enc_prompt'), 'prompt|' + str(task.get('request_id')))
        return task

    def reveal_event(self, event, task_id, key):
        if not key or not isinstance(event, dict): return event
        if 'enc_text' in event: event['text'] = self.reveal(key, event.pop('enc_text'), 'text|' + task_id + '|' + str(event.get('event_id')))
        event.pop('enc_artifact', None)
        approval = event.get('approval')
        if isinstance(approval, dict):
            for field in ('title', 'detail'):
                if 'enc_' + field in approval:
                    approval[field] = self.reveal(key, approval.pop('enc_' + field), 'approval|' + task_id + '|' + str(approval.get('request_id')) + '|' + field)
        return event

    def task_key(self, task_id):
        task = self._request('/v1/tasks/' + task_id + '/events?after=999999999').get('task', {})
        if not task.get('e2e'): return None, task
        info = self.pairing(task.get('computer_id'))
        return (info['key'] if info['state'] == 'on' else b''), task

    def _save(self, config):
        if self.root.is_symlink() or any(p.is_symlink() for p in self.root.parents): raise BridgeError('配置路径不可用')
        self.root.mkdir(parents=True, exist_ok=True)
        if self.path.is_symlink(): raise BridgeError('配置路径不可用')
        fd, name = tempfile.mkstemp(prefix='.connect-', dir=str(self.root))
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False); f.flush(); os.fsync(f.fileno())
            os.replace(name, str(self.path))
        finally:
            if os.path.exists(name): os.unlink(name)
        self.config = config
        self.key_cache.clear()

    def _request(self, path, data=None, config=None, authenticated=True):
        config = config or self.config
        if not config.get('relay_url'): raise BridgeError('请先连接中继服务器')
        headers = {'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ATOM-Device-Connect/1'}
        if authenticated:
            if not config.get('token'): raise BridgeError('设备尚未完成注册')
            headers['Authorization'] = 'Bearer ' + config['token']
        body = None if data is None else json.dumps(data, ensure_ascii=False).encode('utf-8')
        if body and len(body) > (96 * 1024 if path == '/v1/device/snapshot' else 64 * 1024): raise BridgeError('请求内容过大')
        req = Request(config['relay_url'] + path, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=6) as response:
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE: raise BridgeError('服务器响应过大', 502)
                result = json.loads(raw.decode('utf-8'))
                if not isinstance(result, dict): raise BridgeError('服务器响应格式错误', 502)
                return result
        except HTTPError as exc:
            labels = {401:'连接身份已失效，请重新配对',403:'当前设备没有操作权限',404:'任务不存在或已失效',409:'当前状态不允许此操作，电脑可能离线',429:'请求过于频繁，请稍后重试'}
            raise BridgeError(labels.get(exc.code, '服务器暂时无法处理请求'), exc.code if exc.code in (401,403,404,409,429) else 502, 'relay_http_' + str(exc.code))
        except (URLError, OSError, TimeoutError): raise BridgeError('无法连接服务器，请检查网络和服务器状态', 503, 'relay_unreachable')
        except (ValueError, UnicodeError) as exc:
            if isinstance(exc, BridgeError): raise
            raise BridgeError('服务器响应格式错误', 502)

    def configure(self, data):
        value = relay_url(data.get('relay_url'))
        name = data.get('name') or 'ATOM 小电脑'
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80: raise BridgeError('设备名称需为 1–80 字')
        with self.lock:
            if self.config.get('relay_url') == value and self.config.get('token') and data.get('reset_identity') is not True:
                config = dict(self.config, name=name.strip())
            else:
                result = self._request('/v1/clients/register', {'role':'device','name':name.strip()}, {'relay_url':value}, authenticated=False)
                identifier(result.get('client_id'), '设备')
                token = result.get('token')
                if not isinstance(token, str) or not 16 <= len(token) <= 4096: raise BridgeError('服务器注册响应无效', 502)
                config = dict(relay_url=value, name=name.strip(), client_id=result['client_id'], token=token)
                if e2e: config.update(e2e_private=e2e.new_private_key(), peers={})
            self._save(config)
        return self.state()

    def state(self):
        public = dict(configured=bool(self.config.get('token')), relay_url=self.config.get('relay_url',''), default_relay_url=DEFAULT_RELAY, device_name=self.config.get('name','ATOM 小电脑'), paired=[], pair_requests=[], tasks=[])
        if not public['configured']: return public
        try:
            response = self._request('/v1/state')
            self.key_cache.clear()
            # Never expose the private config or arbitrary relay response properties.
            for key in ('client_id','role','paired','pair_requests','tasks'):
                if key in response: public[key] = response[key]
            keys = {}
            for entry in public['paired']:
                info = self.pairing(entry.get('client_id'), entry)
                keys[entry.get('client_id')] = info.get('key')
                entry['e2e'] = info['state']
                if info.get('code'): entry['safety_code'] = info['code']
                entry.pop('public_key', None); entry.pop('own_key', None)
            for task in public['tasks']:
                if task.get('e2e'): self.reveal_task(task, keys.get(task.get('computer_id')) or b'')
        except BridgeError as exc:
            public.update(connection_error=str(exc), connection_code=exc.code)
        return public

    def execute(self, action, data):
        if not isinstance(data, dict): raise BridgeError('请求格式无效')
        if action == 'state': return self.state()
        if action == 'configure': return self.configure(data)
        if action == 'pair-code': return self._request('/v1/pair/code', {})
        if action == 'pair-confirm':
            if type(data.get('accept')) is not bool: raise BridgeError('请确认是否连接电脑')
            body = {'request_id':identifier(data.get('request_id')), 'accept':data['accept']}
            if e2e and self.config.get('e2e_private'): body['public_key'] = e2e.public_key(self.config['e2e_private'])
            return self._request('/v1/pair/confirm', body)
        if action == 'unpair':
            computer = identifier(data.get('client_id'), '电脑')
            result = self._request('/v1/pair/remove', {'client_id':computer})
            self.key_cache.pop(computer, None)
            with self.lock:
                if computer in self.config.get('peers', {}):
                    self._save(dict(self.config, peers={k:v for k,v in self.config['peers'].items() if k != computer}))
            return result
        if action == 'create-task':
            payload = {k:data[k] for k in ('request_id','computer_id','project_id','agent_id','prompt','session_id','kind') if k in data}
            if payload.get('kind', 'task') not in ('task', 'app'): raise BridgeError('任务类型无效')
            for key in ('request_id','computer_id','project_id','agent_id'): identifier(payload.get(key), key)
            if not isinstance(payload.get('prompt'), str) or not 1 <= len(payload['prompt'].strip()) <= 16000: raise BridgeError('请输入 1–16000 字的任务')
            if 'session_id' in payload: identifier(payload['session_id'], '会话')
            info = self.pairing(payload['computer_id'])
            if info['state'] in ('mismatch', 'changed'): raise BridgeError('这台电脑的加密密钥发生了变化，为安全起见已停止发送。请解除配对后重新配对。', 409, 'e2e_key_changed')
            if info['state'] == 'on':
                payload['enc_prompt'] = e2e.seal(info['key'], payload.pop('prompt'), 'prompt|' + payload['request_id'])
            result = self._request('/v1/tasks', payload)
            self.reveal_task(result.get('task'), info.get('key'))
            return result
        task = identifier(data.get('task_id'))
        if action == 'artifact':
            result = self._request('/v1/tasks/' + task + '/artifact')
            if 'enc_artifact' in result:
                key, _ = self.task_key(task)
                try: return {'artifact': e2e.open_json(key, result['enc_artifact'], 'artifact|' + task)}
                except (e2e.E2EError, AttributeError): raise BridgeError('应用结果无法解密，请解除配对后重新配对', 409, 'e2e_unreadable')
            return result
        if action == 'task-events':
            after = data.get('after',0)
            if type(after) is not int or not 0 <= after <= 10**10: raise BridgeError('事件序号无效')
            result = self._request('/v1/tasks/' + task + '/events?' + urlencode({'after':after}))
            info = result.get('task') or {}
            if info.get('e2e'):
                key = self.pairing(info.get('computer_id')).get('key') or b''
                self.reveal_task(info, key)
                for event in result.get('events', []): self.reveal_event(event, task, key)
            return result
        if action == 'cancel-task': return self._request('/v1/tasks/' + task + '/cancel', {})
        if action == 'approve-task':
            if data.get('decision') not in ('accept','decline'): raise BridgeError('审批选项无效')
            return self._request('/v1/tasks/' + task + '/approve', {'request_id':identifier(data.get('request_id')), 'decision':data['decision']})
        raise BridgeError('不支持的连接操作')
