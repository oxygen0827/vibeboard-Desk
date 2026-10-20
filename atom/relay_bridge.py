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

IDENTIFIER = re.compile(r'^[A-Za-z0-9_-]{1,128}$')
MAX_RESPONSE = 2 * 1024 * 1024

class BridgeError(ValueError):
    def __init__(self, message, status=400, code='connect_error'):
        super().__init__(message)
        self.status, self.code = status, code

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

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
        self.opener = build_opener(NoRedirect())
        try:
            if self.path.is_symlink(): raise ValueError('symlink')
            data = json.loads(self.path.read_text(encoding='utf-8'))
            relay_url(data['relay_url'])
            identifier(data['client_id'], '设备')
            if not isinstance(data.get('token'), str) or not 16 <= len(data['token']) <= 4096: raise ValueError('token')
            self.config = data
        except (OSError, ValueError, TypeError, KeyError): pass

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

    def _request(self, path, data=None, config=None, authenticated=True):
        config = config or self.config
        if not config.get('relay_url'): raise BridgeError('请先连接中继服务器')
        headers = {'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ATOM-Device-Connect/1'}
        if authenticated:
            if not config.get('token'): raise BridgeError('设备尚未完成注册')
            headers['Authorization'] = 'Bearer ' + config['token']
        body = None if data is None else json.dumps(data, ensure_ascii=False).encode('utf-8')
        if body and len(body) > 64 * 1024: raise BridgeError('请求内容过大')
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
            self._save(config)
        return self.state()

    def state(self):
        public = dict(configured=bool(self.config.get('token')), relay_url=self.config.get('relay_url',''), device_name=self.config.get('name','ATOM 小电脑'), paired=[], pair_requests=[], tasks=[])
        if not public['configured']: return public
        try:
            response = self._request('/v1/state')
            # Never expose the private config or arbitrary relay response properties.
            for key in ('client_id','role','paired','pair_requests','tasks'):
                if key in response: public[key] = response[key]
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
            return self._request('/v1/pair/confirm', {'request_id':identifier(data.get('request_id')), 'accept':data['accept']})
        if action == 'create-task':
            payload = {k:data[k] for k in ('request_id','computer_id','project_id','agent_id','prompt','session_id','kind') if k in data}
            if payload.get('kind', 'task') not in ('task', 'app'): raise BridgeError('任务类型无效')
            for key in ('request_id','computer_id','project_id','agent_id'): identifier(payload.get(key), key)
            if not isinstance(payload.get('prompt'), str) or not 1 <= len(payload['prompt'].strip()) <= 16000: raise BridgeError('请输入 1–16000 字的任务')
            if 'session_id' in payload: identifier(payload['session_id'], '会话')
            return self._request('/v1/tasks', payload)
        task = identifier(data.get('task_id'))
        if action == 'artifact': return self._request('/v1/tasks/' + task + '/artifact')
        if action == 'task-events':
            after = data.get('after',0)
            if type(after) is not int or not 0 <= after <= 10**10: raise BridgeError('事件序号无效')
            return self._request('/v1/tasks/' + task + '/events?' + urlencode({'after':after}))
        if action == 'cancel-task': return self._request('/v1/tasks/' + task + '/cancel', {})
        if action == 'approve-task':
            if data.get('decision') not in ('accept','decline'): raise BridgeError('审批选项无效')
            return self._request('/v1/tasks/' + task + '/approve', {'request_id':identifier(data.get('request_id')), 'decision':data['decision']})
        raise BridgeError('不支持的连接操作')
