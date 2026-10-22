"""ATOM model-backed application workshop. No credentials discovered automatically."""
import json
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_icons import ensure_icon
from app_input import validate_input_bundle
import official_ai

class GenerationError(ValueError):
    pass

PRESETS = {
    'deepseek': {'base_url':'https://api.deepseek.com/v1','model':'deepseek-flash','protocol':'openai'},
    'openai': {'base_url':'https://api.openai.com/v1','model':'','protocol':'openai'},
    'qwen': {'base_url':'https://dashscope.aliyuncs.com/compatible-mode/v1','model':'','protocol':'openai'},
    'minimax': {'base_url':'https://api.minimax.io/v1','model':'','protocol':'openai'},
    'moonshot': {'base_url':'https://api.moonshot.cn/v1','model':'','protocol':'openai'},
    'anthropic': {'base_url':'https://api.anthropic.com/v1','model':'','protocol':'anthropic'},
    'gemini': {'base_url':'https://generativelanguage.googleapis.com/v1beta/openai','model':'','protocol':'openai'},
    'custom': {'base_url':'','model':'','protocol':'openai'},
}
LIMIT = 2 * 1024 * 1024

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_bundle(bundle):
    if not isinstance(bundle, dict): raise ValueError('模型输出必须是 JSON 对象')
    manifest = bundle.get('manifest'); files = bundle.get('files')
    if not isinstance(manifest, dict) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,47}', str(manifest.get('id', ''))): raise ValueError('应用 id 无效')
    if manifest['id'] in ('clock','timer','status'): raise ValueError('应用 id 保留')
    if not isinstance(manifest.get('name'),str) or not 1 <= len(manifest['name']) <= 80: raise ValueError('应用名称无效')
    if not isinstance(manifest.get('description',''),str) or len(manifest.get('description','')) > 500: raise ValueError('应用描述无效')
    if 'layout' in manifest and manifest['layout'] != 'fullscreen': raise ValueError('应用布局必须是 fullscreen')
    if manifest.get('entry') != 'index.html': raise ValueError('应用入口必须是 index.html')
    if not isinstance(files,dict) or not 1 <= len(files) <= 100 or 'index.html' not in files: raise ValueError('应用文件无效')
    size = 0
    for name,text in files.items():
        if not isinstance(name,str) or not name or name.startswith('/') or '\\' in name or '\x00' in name or any(x in ('','.','..') for x in name.split('/')) or name == 'manifest.json': raise ValueError('应用路径无效')
        if not isinstance(text,str): raise ValueError('应用文件必须是文本')
        size += len(text.encode('utf-8'))
    if size > LIMIT: raise ValueError('应用文件过大')
    validate_input_bundle(bundle)
    return ensure_icon(bundle)


def parse_bundle(text):
    text = text.strip()
    match = re.fullmatch(r'```(?:json)?\s*\n?(.*?)\n?```',text,re.S|re.I)
    if match: text = match.group(1).strip()
    return validate_bundle(json.loads(text))


class Workshop:
    def __init__(self,state_dir,validate_fn=None,theme_css_fn=None):
        self.state_dir = Path(state_dir); self.path = self.state_dir / 'model.json'
        self.validate_fn = validate_fn or validate_bundle
        self.theme_css_fn = theme_css_fn or (lambda theme_id: '')
        self.lock = threading.RLock(); self.jobs = {}

    def _config(self):
        try:
            if self.path.is_symlink(): return {}
            value = json.loads(self.path.read_text(encoding='utf-8'))
            return value if isinstance(value,dict) else {}
        except (OSError,ValueError): return {}

    def public_config(self):
        with self.lock:
            config = self._config()
            return dict(provider=config.get('provider','deepseek'),base_url=config.get('base_url',PRESETS.get(config.get('provider','deepseek'),{}).get('base_url','')),model=config.get('model',PRESETS.get(config.get('provider','deepseek'),{}).get('model','')),protocol=config.get('protocol','openai'),api_key_set=bool(config.get('api_key')),stt_base_url=config.get('stt_base_url',''),stt_model=config.get('stt_model',''),stt_api_key_set=bool(config.get('stt_api_key')),tts_base_url=config.get('tts_base_url',''),tts_model=config.get('tts_model',''),tts_voice=config.get('tts_voice','tongtong'),tts_api_key_set=bool(config.get('tts_api_key')),presets=[dict(id=k,name=k.title(),**v) for k,v in PRESETS.items()])

    def read_private_config(self):
        # Server-only method; never serialize this result in an HTTP response.
        with self.lock: return dict(self._config())

    def save_config(self,data):
        if not isinstance(data,dict): raise ValueError('配置必须是 JSON 对象')
        with self.lock:
            old = self._config(); provider = data.get('provider',old.get('provider','deepseek'))
            if provider not in PRESETS: raise ValueError('未知模型厂商')
            preset = PRESETS[provider]
            config = dict(provider=provider)
            for key in ('base_url','model','protocol'):
                default = old.get(key,preset[key]) if provider == old.get('provider') else preset[key]
                config[key] = data.get(key,default)
                if not isinstance(config[key],str): raise ValueError('模型配置字段必须是文本')
            config['base_url'] = config['base_url'].rstrip('/')
            url = urlsplit(config['base_url'])
            if config['base_url'] and (url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment): raise ValueError('模型地址必须是 HTTPS，无认证参数')
            if config['protocol'] not in ('openai','anthropic'): raise ValueError('未知模型协议')
            if len(config['model']) > 200: raise ValueError('模型名称过长')
            key = data.get('api_key','')
            if not isinstance(key,str) or len(key) > 4096 or '\n' in key or '\r' in key: raise ValueError('API key 无效')
            if 'clear_api_key' in data and type(data['clear_api_key']) is not bool: raise ValueError('clear_api_key 必须是布尔值')
            same_service = old.get('provider',provider) == provider and old.get('base_url',config['base_url']) == config['base_url']
            config['api_key'] = '' if data.get('clear_api_key') else (key or (old.get('api_key','') if same_service else ''))
            for field in ('stt_base_url','stt_model'):
                config[field] = data.get(field,old.get(field,''))
                if not isinstance(config[field],str): raise ValueError('语音配置必须是文本')
            config['stt_base_url'] = config['stt_base_url'].rstrip('/')
            stt_url = urlsplit(config['stt_base_url'])
            if config['stt_base_url'] and (stt_url.scheme != 'https' or not stt_url.hostname or stt_url.username or stt_url.password or stt_url.query or stt_url.fragment): raise ValueError('语音地址必须是 HTTPS')
            stt_key = data.get('stt_api_key','')
            if not isinstance(stt_key,str) or len(stt_key) > 4096 or '\n' in stt_key or '\r' in stt_key: raise ValueError('语音 API key 无效')
            if 'clear_stt_api_key' in data and type(data['clear_stt_api_key']) is not bool: raise ValueError('clear_stt_api_key 必须是布尔值')
            same_stt = old.get('stt_base_url',config['stt_base_url']) == config['stt_base_url']
            config['stt_api_key'] = '' if data.get('clear_stt_api_key') else (stt_key or (old.get('stt_api_key','') if same_stt else ''))
            for field in ('tts_base_url','tts_model','tts_voice'):
                config[field] = data.get(field, old.get(field, 'tongtong' if field == 'tts_voice' else ''))
                if not isinstance(config[field],str) or len(config[field])>500 or '\n' in config[field] or '\r' in config[field]: raise ValueError('语音播报配置无效')
            config['tts_base_url'] = config['tts_base_url'].rstrip('/')
            tts_url = urlsplit(config['tts_base_url'])
            if config['tts_base_url'] and (tts_url.scheme != 'https' or not tts_url.hostname or tts_url.username or tts_url.password or tts_url.query or tts_url.fragment): raise ValueError('语音播报地址必须是 HTTPS')
            if config['tts_voice'] not in ('tongtong','chuichui','xiaochen','jam','kazi','douji','luodo'): raise ValueError('音色无效')
            tts_key = data.get('tts_api_key','')
            if not isinstance(tts_key,str) or len(tts_key)>4096 or '\n' in tts_key or '\r' in tts_key: raise ValueError('语音播报密钥无效')
            if 'clear_tts_api_key' in data and type(data['clear_tts_api_key']) is not bool: raise ValueError('clear_tts_api_key 必须是布尔值')
            same_tts = old.get('tts_base_url',config['tts_base_url']) == config['tts_base_url']
            config['tts_api_key'] = '' if data.get('clear_tts_api_key') else (tts_key or (old.get('tts_api_key','') if same_tts else ''))
            if self.state_dir.is_symlink() or any(p.is_symlink() for p in self.state_dir.parents): raise ValueError('配置目录不可为符号链接')
            self.state_dir.mkdir(parents=True,exist_ok=True)
            if self.path.is_symlink(): raise ValueError('配置文件不可为符号链接')
            fd,name = tempfile.mkstemp(prefix='.model-',dir=str(self.state_dir))
            try:
                os.fchmod(fd,0o600)
                with os.fdopen(fd,'w',encoding='utf-8') as handle:
                    json.dump(config,handle); handle.flush(); os.fsync(handle.fileno())
                os.replace(name,str(self.path))
            finally:
                if os.path.exists(name): os.unlink(name)
            return self.public_config()

    def start_generation(self,data,config=None):
        if not isinstance(data,dict) or not isinstance(data.get('prompt'),str) or not 1 <= len(data['prompt'].strip()) <= 4000: raise ValueError('请输入 1–4000 字的应用需求')
        theme = data.get('theme_id','default')
        if not isinstance(theme,str) or len(theme) > 80: raise ValueError('主题无效')
        css = self.theme_css_fn(theme)
        if not isinstance(css,str): raise ValueError('主题无效')
        with self.lock:
            config = config or self._config()
            if not all(config.get(x) for x in ('api_key','base_url','model')): raise ValueError('尚未配置模型：登录 ATOM 账号即可使用官方额度，或填写自己的模型 API key')
            if sum(j['status'] in ('queued','generating','checking') for j in self.jobs.values()) >= 2: raise ValueError('已有生成任务，请稍后重试')
            if len(self.jobs) >= 30:
                for old_id in list(self.jobs):
                    if self.jobs[old_id]['status'] in ('ready','failed'): del self.jobs[old_id]; break
            job_id = uuid.uuid4().hex
            self.jobs[job_id] = dict(job_id=job_id,status='queued',theme_id=theme,created_at=time.time())
            threading.Thread(target=self._generate,args=(job_id,config,data['prompt'],css),daemon=True).start()
            return dict(job_id=job_id)

    def get_job(self,job_id):
        if not isinstance(job_id,str) or not re.fullmatch(r'[a-f0-9]{32}',job_id): raise ValueError('生成任务 id 无效')
        with self.lock:
            if job_id not in self.jobs: raise KeyError('生成任务不存在')
            return json.loads(json.dumps(self.jobs[job_id]))

    def _set(self,job_id,**fields):
        with self.lock: self.jobs[job_id].update(fields)

    def _call_model(self,config,prompt,css):
        url = urlsplit(config['base_url'])
        if not config.get('official') and (url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment): raise ValueError('invalid HTTPS endpoint')
        system = ('Generate a complete functional ATOM Web app bundle. Output ONLY JSON {"manifest":{"id":"unique-lowercase-id","name":"中文名称","description":"用途","entry":"index.html","layout":"fullscreen","icon":"icon.svg","input":{"version":1,"profile":"five-way","back":"root","scene":"none"}},"files":{"index.html":"...","icon.svg":"..."}}. '
                  'Viewport 480x360 CSS pixels, Chromium 91. Fullscreen app: no permanent system header, nav, Home bar or duplicate shell controls. Set html/body height:100%; body height:100vh; margin:0; prevent root scrolling through a complete bounded layout. Default operation view must fit one screen. If content does not fit, split into views or steps. Never hide overflow to clip primary actions. Long song lists or long reading content may scroll only in an explicitly marked .atom-scroll or [data-atom-scroll] bounded-height region; keep local navigation and primary actions outside and fixed.  No CDN, external fonts, libraries, network dependencies or fake live data. HTML/CSS/JS UTF-8 local files only. '
                  'Run in sandbox iframe without allow-same-origin: no direct device API, no localStorage assumptions. Use semantic buttons, visible focus, 16px+ body text, complete states and real local logic. '
                  'Shell owns Home; no permanent header/navigation. Respect supplied CSS theme variables, include supplied CSS verbatim inside a style element in index.html; apply its variables to body foreground/background, borders and action controls. Do not output secrets. Theme CSS:\n' + css)
        system += ' ATOM system design: calm iOS-inspired typography, light grouped surfaces, blue primary actions, 16px consistent spacing, 13px rounded controls, 16px white grouped panels on a light grey surface, blue filled primary action and white secondary actions, 25px semibold page titles and tabular system-font numerals, no heavy borders, no decorative dashboards or unnecessary labels. Use inherited semantic tokens. Keep the 480x360 screen fullscreen and use scrolling only inside necessary content regions. Selected theme is a design reference; installed apps follow the active system theme by default. Use semantic CSS variables for all interface colors and controls, no hardcoded theme palette. Preserve purposeful scene/data colors. Every app MUST include a unique, purpose-specific icon.svg with viewBox=0 0 64 64, and manifest.icon=icon.svg. The icon is a TRANSPARENT monochrome semantic glyph: use fill=none and stroke=currentColor for outlines (fill=currentColor only for intentional solid marks). Do not draw a colored tile, background rectangle, shadow, badge, or fixed color; the active theme owns icon foreground, surface, radius, border and stroke weight. Preserve negative space and readability across themes. Use a simple readable pictogram, harmonious colors, no lettering or generic plus icon. SVG must be static: only svg/g/path/rect/circle/ellipse/line/polyline/polygon/title/desc/defs/linearGradient/radialGradient/stop, no scripts, events, images, style, links or external resources. Keep it below 32 KiB.'
        system += ' REQUIRED manifest.input: version=1, profile=five-way, back=root for one-level apps or custom for nested pages; custom requires AtomApp.navigation.setBackHandler. Canvas requires scene=controls with semantic DOM controls, or scene=passive for viewing-only artwork. Never label an interactive canvas passive. See the five-way input contract. Five-way joystick is a primary input: arrows move focus, short Enter activates, holding Enter starts voice (release stops). Use native buttons and labeled editable fields; never intercept Enter/arrow events globally. The shell provides a top-left back control: reserve a 48x48 safe area there. Register AtomApp.navigation.setBackHandler(handler) for nested pages and call AtomApp.home() at root. Canvas scenes must expose their core actions as focusable DOM buttons. Do not implement separate recording for text fields; the shell supplies dictation. Use necessary scroll regions and semantic disabled/hidden/modal states.'
        system += (' ATOM App contract v1 is injected by the shell before app scripts; do not bundle or override the SDK. '
                   'Use AtomApp.load(defaultState) and await AtomApp.save(jsonState) for durable notes, counters, settings and progress (64KiB per app). '
                   'Show saved only after save resolves; surface errors and disable conflicting writes during initialization. If load fails, offer a retry and do not overwrite potentially existing records with defaults. Never use localStorage/sessionStorage in this opaque sandbox. '
                   'Preview storage is temporary, installed app storage survives reopen. For async initialization call AtomApp.deferReady() before starting and AtomApp.ready() after the first usable screen renders. '
                   'Release audio, timers and GPU work with AtomApp.onSuspend(callback); root owns exit. Model must supply real loading, empty, success and failure states, semantic controls >=44px, and no fake live information. '
                   'Use calm typography, one main action per screen, appropriate whitespace; avoid dashboard cards for simple tasks, excessive gradients, decorative status pills and redundant headings. '
                   'Animation should explain a real interaction, respect prefers-reduced-motion and pause when hidden. Long lists require bounded .atom-scroll. Include viewport meta.')
        if config['protocol'] == 'anthropic':
            endpoint = '/messages'; headers = {'x-api-key':config['api_key'],'anthropic-version':'2023-06-01'}
            payload = dict(model=config['model'],max_tokens=8000,system=system,messages=[dict(role='user',content=prompt)])
        else:
            endpoint = '/chat/completions'; headers = {'Authorization':'Bearer '+config['api_key']}
            payload = dict(model=config['model'],messages=[dict(role='system',content=system),dict(role='user',content=prompt)],max_tokens=8000)
            if config['provider'] == 'deepseek':
                payload.update(thinking={'type':'disabled'}, response_format={'type':'json_object'}, stream=True)
        if config.get('official'):
            try:
                result = official_ai.complete(config,payload['messages'],payload['max_tokens'],True,on_wait=lambda s: config.get('_job_id') and self._set(config['_job_id'],progress_text='ATOM 官方 AI 正在生成…'))
            except official_ai.OfficialError as exc:
                raise GenerationError(str(exc))
            choice = result['choices'][0]
            if choice.get('finish_reason') == 'length': raise GenerationError('模型输出被长度上限截断，请缩小应用需求后重试')
            if not choice['message'].get('content'): raise GenerationError('模型没有返回应用内容，请重试')
            return choice['message']['content']
        headers['Content-Type'] = 'application/json'
        request = Request(config['base_url']+endpoint,data=json.dumps(payload).encode('utf-8'),headers=headers)
        with build_opener(NoRedirect()).open(request,timeout=90) as response:
            if payload.get('stream'):
                parts = []; size = 0; started = time.monotonic(); last_update = 0; finish = None
                while True:
                    if time.monotonic() - started > 180: raise GenerationError('生成超过三分钟，请稍后重试或缩小需求')
                    line = response.readline(LIMIT+1)
                    if not line: break
                    if len(line) > LIMIT: raise GenerationError('模型回复过大')
                    if not line.startswith(b'data:'): continue
                    data = line[5:].strip()
                    if data == b'[DONE]': break
                    chunk = json.loads(data.decode('utf-8'))
                    if chunk.get('error'): raise GenerationError('模型流式响应失败，请重试')
                    for choice in chunk.get('choices',[]):
                        text = choice.get('delta',{}).get('content') or ''
                        size += len(text.encode('utf-8'))
                        if size > LIMIT: raise GenerationError('模型回复过大')
                        parts.append(text)
                        finish = choice.get('finish_reason') or finish
                    if config.get('_job_id') and time.monotonic() - last_update > .5:
                        self._set(config['_job_id'], received_chars=sum(len(p) for p in parts), progress_text='正在接收应用代码')
                        last_update = time.monotonic()
                if finish == 'length': raise GenerationError('模型输出被长度上限截断，请缩小应用需求后重试')
                text = ''.join(parts)
                if not text.strip(): raise GenerationError('模型没有返回应用内容，请重试')
                return text
            raw = response.read(LIMIT+1)
            if len(raw) > LIMIT: raise ValueError('模型回复过大')
            result = json.loads(raw.decode('utf-8'))
        if config['protocol'] == 'anthropic': return '\n'.join(x.get('text','') for x in result['content'] if x.get('type') == 'text')
        choice = result['choices'][0]
        if choice.get('finish_reason') == 'length': raise GenerationError('模型输出被长度上限截断，请缩小应用需求后重试')
        text = choice['message']['content']
        if not text: raise GenerationError('模型没有返回应用内容，请重试')
        return text

    def _generate(self,job_id,config,prompt,css):
        try:
            self._set(job_id,status='generating')
            config = dict(config, _job_id=job_id)
            text = self._call_model(config,prompt,css)
            self._set(job_id,status='checking')
            if not isinstance(text,str) or len(text.encode('utf-8')) > LIMIT: raise ValueError('invalid model text')
            if config['api_key'] and config['api_key'] in text: raise ValueError('credential in output')
            bundle = parse_bundle(text)
            if css:
                style = '<style id="atom-theme">' + css + '</style>'
                html = bundle['files']['index.html']
                if re.search(r'</head\s*>',html,re.I):
                    html = re.sub(r'</head\s*>',lambda _: style + '</head>',html,count=1,flags=re.I)
                else: html = style + html
                bundle['files']['index.html'] = html
                validate_bundle(bundle)
            checked = self.validate_fn(bundle)
            if isinstance(checked,dict) and 'manifest' in checked and 'files' in checked: bundle = checked
            self._set(job_id,status='ready',bundle=bundle)
        except HTTPError as exc:
            labels = {401:'密钥无效或已失效',402:'账户余额不足',403:'模型服务拒绝访问',429:'请求频率或配额受限'}
            self._set(job_id,status='failed',error='模型请求失败：'+labels.get(exc.code,'服务暂时不可用')+'（HTTP '+str(exc.code)+'）')
        except GenerationError as exc:
            self._set(job_id,status='failed',error=str(exc))
        except (json.JSONDecodeError, ValueError):
            self._set(job_id,status='failed',error='模型返回的应用包未通过结构检查，请缩小需求后重试。')
        except Exception:
            # Never expose exception text: upstream bodies and URLs can contain credentials.
            self._set(job_id,status='failed',error='生成失败：请检查模型配置、网络连接，或重试更明确的需求。')
