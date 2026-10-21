#!/usr/bin/env python3
"""ATOM local device API. Python 3.7+, no third-party dependencies."""
import argparse
import io
import getpass
import json
import os
import re
import shutil
import socket
import sys
import subprocess
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, unquote

BASE = Path(__file__).resolve().parent
if str(BASE) not in sys.path: sys.path.insert(0, str(BASE))
from app_icons import ensure_icon, validate_svg, theme_glyph
from relay_bridge import DeviceBridge, BridgeError
MAX_BODY = 2 * 1024 * 1024
ID = re.compile(r'^[a-z][a-z0-9_-]{0,47}$')
BUILTINS = [dict(id='clock', name='时钟', description='桌面时钟', entry='/#clock'), dict(id='timer', name='计时器', description='倒计时提醒', entry='/#timer'), dict(id='status', name='设备状态', description='系统与连接状态', entry='/#status')]
TRUSTED_CLIENT_IDS = {'my-computer', 'market', 'quick-notes', 'today', 'task-pal', 'robot'}
RESERVED_IDS = {a['id'] for a in BUILTINS} | {'notes', 'settings', 'developer', 'manager', 'home', 'widgets', 'workshop', 'themes', 'my-computer', 'connect-preview', 'market', 'quick-notes', 'today', 'task-pal', 'app-library', 'robot'}
LOCK = threading.Lock()
FEATURE_LOCK = threading.Lock()


def validate_generated(bundle, trusted_connect=False):
    with tempfile.TemporaryDirectory() as folder:
        install_app(Path(folder).resolve() / 'apps', bundle, trusted_connect=trusted_connect)
    return bundle


def connect_app_bundle(bridge, data):
    result = bridge.execute('artifact', {'task_id': data.get('task_id')})
    return validate_delivery_bundle(result.get('artifact'))

def validate_delivery_bundle(bundle, trusted_connect=False, maximum=96*1024):
    bundle = json.loads(json.dumps(bundle))
    if not isinstance(bundle, dict) or not isinstance(bundle.get('manifest'), dict) or not isinstance(bundle.get('files'), dict):
        raise ValueError('电脑尚未提供可安装的应用')
    if len(json.dumps(bundle, ensure_ascii=False).encode('utf-8')) > maximum:
        raise ValueError('应用交付包过大')
    manifest = bundle['manifest']
    if manifest.get('icon') != 'icon.svg': raise ValueError('应用必须包含自己的图标')
    icon = bundle['files'].get('icon.svg')
    validate_svg(icon)
    import xml.etree.ElementTree as ET
    root = ET.fromstring(icon)
    if root.get('viewBox') != '0 0 64 64': raise ValueError('应用图标必须使用 64×64 画布')
    for node in root.iter():
        for key in ('fill','stroke','color'):
            if key in node.attrib and node.attrib[key] not in ('none','currentColor'): raise ValueError('应用图标颜色应跟随系统主题')
    manifest.pop('theme_mode', None)
    manifest.pop('theme_id', None)
    return validate_generated(bundle, trusted_connect=trusted_connect)


def features(http):
    with FEATURE_LOCK:
        if not hasattr(http, 'workshop'):
            from themes import ThemeStore
            from workshop import Workshop
            from voice import VoiceRecorder
            from tts import SpeechPlayer
            state = http.settings_path.parent
            http.theme_store = ThemeStore(state)
            http.workshop = Workshop(state, validate_generated, http.theme_store.css)
            http.voice = VoiceRecorder(state)
            http.speech = SpeechPlayer(state)
            http.connect = DeviceBridge(state)
            from market_client import MarketClient
            http.market = MarketClient(state, http.connect)
            from robot import RobotTalk
            http.robot = RobotTalk()
            from release_store import ReleaseStore
            http.releases = ReleaseStore(state / 'app-releases')
    return http


SETTINGS_LOCK = threading.Lock()
BACKLIGHT_ROOT = Path('/sys/class/backlight')


def read_settings(path):
    try:
        if path.is_symlink(): return dict(enabled=False)
        value = json.loads(path.read_text(encoding='utf-8'))
        return dict(enabled=value.get('enabled') is True)
    except (OSError, ValueError, AttributeError):
        return dict(enabled=False)


def save_settings(path, enabled):
    with SETTINGS_LOCK:
        ensure_safe_root(path.parent)
        if path.is_symlink():
            raise ValueError('symlink settings')
        fd, name = tempfile.mkstemp(prefix='.settings-', dir=str(path.parent))
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                json.dump(dict(enabled=enabled), handle)
                handle.flush(); os.fsync(handle.fileno())
            os.replace(name, str(path))
        finally:
            if os.path.exists(name): os.unlink(name)


def backlight_device():
    for child in sorted(BACKLIGHT_ROOT.iterdir()) if BACKLIGHT_ROOT.exists() else []:
        if (child / 'brightness').exists() and (child / 'max_brightness').exists():
            return child
    return None


def display_status():
    try:
        device = backlight_device()
        if device is None: return dict(available=False, brightness=None, max_brightness=None)
        maximum = int((device / 'max_brightness').read_text())
        current = int((device / 'brightness').read_text())
        if maximum <= 0: raise ValueError('invalid maximum')
        return dict(available=os.access(str(device / 'brightness'), os.W_OK), brightness=round(current * 100 / maximum), max_brightness=maximum)
    except (OSError, ValueError):
        return dict(available=False, brightness=None, max_brightness=None)


def set_brightness(value):
    device = backlight_device()
    if device is None: raise OSError('backlight unavailable')
    maximum = int((device / 'max_brightness').read_text())
    if maximum <= 0: raise OSError('backlight unavailable')
    (device / 'brightness').write_text(str(round(value * maximum / 100)))


def relative_path(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        raise ValueError('invalid file path')
    path = PurePosixPath(value)
    if path.is_absolute() or any(p in ('..', '.') for p in value.split('/')) or '' in value.split('/'):
        raise ValueError('invalid file path')
    return path


def validate_manifest(value, trusted_connect=False):
    if not isinstance(value, dict) or not isinstance(value.get('id'), str) or not ID.fullmatch(value['id']):
        raise ValueError('invalid app id')
    if value['id'] in RESERVED_IDS and not (trusted_connect and value['id'] in TRUSTED_CLIENT_IDS):
        raise ValueError('reserved app id')
    if not isinstance(value.get('name'), str) or not 1 <= len(value['name']) <= 80:
        raise ValueError('invalid app name')
    if not isinstance(value.get('description', ''), str) or len(value.get('description', '')) > 500:
        raise ValueError('invalid description')
    if value.get('entry') != 'index.html':
        raise ValueError('entry must be index.html')
    if 'icon' in value and value['icon'] != 'icon.svg': raise ValueError('icon must be icon.svg')
    result = dict(id=value['id'], name=value['name'], description=value.get('description', ''), entry='index.html')
    if 'icon' in value: result['icon'] = value['icon']
    if 'capabilities' in value:
        caps = value['capabilities']
        if not isinstance(caps,list) or len(caps)>3 or any(not isinstance(c,str) or c not in ('notes','agenda','task-state') for c in caps) or len(set(caps))!=len(caps): raise ValueError('invalid app capabilities')
        result['capabilities'] = caps
    if 'theme_ui' in value:
        if value['theme_ui'] != 'controls': raise ValueError('invalid theme_ui')
        result['theme_ui'] = 'controls'
    if 'layout' in value:
        if value['layout'] != 'fullscreen': raise ValueError('layout must be fullscreen')
        result['layout'] = 'fullscreen'
    if value.get('theme_mode') == 'fixed':
        if not isinstance(value.get('theme_id'), str) or not ID.fullmatch(value['theme_id']):
            raise ValueError('invalid theme id')
        result.update(theme_mode='fixed', theme_id=value['theme_id'])
    return result


def ensure_safe_root(root):
    if root.is_symlink():
        raise ValueError('symlink app root')
    root.mkdir(parents=True, exist_ok=True)
    if any(p.is_symlink() for p in root.parents):
        raise ValueError('symlink parent')


def install_app(root, data, update=False, trusted_connect=False):
    provided_icon = isinstance(data,dict) and isinstance(data.get('manifest'),dict) and 'icon' in data['manifest']
    data = ensure_icon(data)
    manifest = validate_manifest(data.get('manifest'), trusted_connect=trusted_connect)
    files = data.get('files')
    if not isinstance(files, dict) or not 1 <= len(files) <= 100 or 'index.html' not in files:
        raise ValueError('files must include index.html')
    size = 0
    for name, content in files.items():
        relative_path(name)
        if name == 'manifest.json' or not isinstance(content, str):
            raise ValueError('invalid file')
        size += len(content.encode('utf-8'))
    if size > MAX_BODY:
        raise ValueError('application too large')
    with LOCK:
        ensure_safe_root(root)
        target = root / manifest['id']
        if target.is_symlink():
            raise ValueError('symlink app')
        if update and not target.is_dir():
            raise ValueError('app not installed')
        if not update and target.exists():
            raise ValueError('app already installed; use update')
        installed_at = time.time_ns()
        if update:
            old_path = target / 'manifest.json'
            old = json.loads(old_path.read_text(encoding='utf-8'))
            installed_at = old.get('_installed_at_ns', old_path.stat().st_mtime_ns)
            old_icon = target / 'icon.svg'
            if not provided_icon and old.get('icon') == 'icon.svg' and not old_icon.is_symlink() and old_icon.is_file() and old_icon.stat().st_size <= 32768:
                text = validate_svg(old_icon.read_text(encoding='utf-8'))
                if size - len(files['icon.svg'].encode('utf-8')) + len(text.encode('utf-8')) > MAX_BODY: raise ValueError('application too large')
                files['icon.svg'] = text
        manifest['_installed_at_ns'] = installed_at
        stage = Path(tempfile.mkdtemp(prefix='.install-', dir=str(root)))
        try:
            for name, content in files.items():
                dest = stage / str(relative_path(name))
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content, encoding='utf-8')
            (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
            if update:
                backup = root / ('.backup-' + manifest['id'] + '-' + str(time.time_ns()))
                os.rename(str(target), str(backup))
                try:
                    os.rename(str(stage), str(target))
                except Exception:
                    os.rename(str(backup), str(target))
                    raise
                shutil.rmtree(str(backup))
            else:
                os.rename(str(stage), str(target))
        finally:
            if stage.exists():
                shutil.rmtree(str(stage))
    return manifest


def uninstall_app(root, app_id):
    if not isinstance(app_id, str) or not ID.fullmatch(app_id) or app_id in RESERVED_IDS:
        raise ValueError('invalid or protected app id')
    with LOCK:
        ensure_safe_root(root)
        target = root / app_id
        if target.is_symlink() or not target.is_dir():
            raise ValueError('app not installed')
        tomb = root / ('.remove-' + app_id + '-' + str(time.time_ns()))
        os.rename(str(target), str(tomb))
        shutil.rmtree(str(tomb))


def apps(root):
    result = [dict(a) for a in BUILTINS]
    installed = []
    if root.exists() and not root.is_symlink():
        for child in sorted(root.iterdir()):
            if not child.is_dir() or child.is_symlink() or not ID.fullmatch(child.name):
                continue
            try:
                path = child / 'manifest.json'
                if path.is_symlink() or path.stat().st_size > 4096:
                    continue
                raw = json.loads(path.read_text(encoding='utf-8'))
                item = validate_manifest(raw, trusted_connect=child.name in TRUSTED_CLIENT_IDS)
                stamp = raw.get('_installed_at_ns', path.stat().st_mtime_ns)
                if not isinstance(stamp, int): stamp = path.stat().st_mtime_ns
                if item['id'] != child.name:
                    continue
                item['entry'] = '/user-apps/' + item['id'] + '/index.html'
                if item.get('icon'):
                    icon_file = child / 'icon.svg'
                    if not icon_file.is_symlink() and icon_file.is_file() and icon_file.stat().st_size <= 32768:
                        item['icon_svg'] = theme_glyph(icon_file.read_text(encoding='utf-8'))
                    item['icon'] = '/user-apps/' + item['id'] + '/icon.svg'
                item['installation_id'] = str(stamp)
                installed.append((stamp, item))
            except (ValueError, OSError, TypeError):
                continue
    result.extend(item for stamp, item in sorted(installed, key=lambda pair: (pair[0], pair[1]['id'])))
    return result


def command(args):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=3, check=True).stdout


def audio_status():
    try:
        output = command(['pactl', 'list', 'sinks'])
        volume_line = next((line for line in output.splitlines() if 'Volume:' in line), '')
        values = re.findall(r'(\d+)%', volume_line)
        sources = []
        for line in command(['pactl', 'list', 'short', 'sources']).splitlines():
            columns = line.split('\t')
            if len(columns) >= 2:
                sources.append(dict(id=columns[0], name=columns[1], monitor=columns[1].endswith('.monitor')))
        return dict(volume=int(values[0]) if values else None, sources=sources)
    except (OSError, subprocess.SubprocessError):
        return dict(volume=None, sources=[], available=False)


def system_status():
    total = available = 0
    try:
        values = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1)
            values[key] = int(value.strip().split()[0]) * 1024
        total = values['MemTotal']; available = values.get('MemAvailable', values.get('MemFree', 0))
    except (OSError, ValueError, KeyError):
        pass
    temp = None
    for path in sorted(Path('/sys/class/thermal').glob('thermal_zone*/temp')):
        try:
            temp = float(path.read_text()) / 1000; break
        except (OSError, ValueError):
            pass
    try:
        uptime = float(Path('/proc/uptime').read_text().split()[0])
    except (OSError, ValueError):
        uptime = 0
    ip = None
    try:
        output = command(['ip', '-4', '-o', 'addr', 'show', 'scope', 'global'])
        found = re.search(r'\binet\s+(\d+\.\d+\.\d+\.\d+)/', output)
        ip = found.group(1) if found else None
    except (OSError, subprocess.SubprocessError):
        pass
    disk = shutil.disk_usage(str(BASE))
    return dict(hostname=socket.gethostname(), cpu_temp=temp, uptime=uptime,
                memory=dict(total=total, available=available, used=total-available, percent=round(100*(total-available)/total, 1) if total else 0),
                disk=dict(total=disk.total, used=disk.used, free=disk.free, percent=round(100*disk.used/disk.total, 1)),
                network=dict(ip=ip, connected=bool(ip)))


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # System shell changes must not retain an obsolete bridge or keyboard handler.
        if urlsplit(self.path).path in ('/', '/index.html', '/app.js', '/home-key.js', '/style.css', '/app-runtime.js', '/app-host.js', '/companion.js', '/system-appearance.css', '/app-appearance.css', '/theme-controls.css', '/atom-ui.css'):
            self.send_header('Cache-Control', 'no-store')
        # Public application assets must load inside opaque-origin sandbox frames.
        if self.command in ('GET', 'HEAD') and urlsplit(self.path).path.startswith('/user-apps/'):
            self.send_header('Access-Control-Allow-Origin', '*')
            if not urlsplit(self.path).path.endswith(('.html', '/')):
                self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE / 'static'), **kwargs)

    def json_response(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers(); self.wfile.write(payload)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/api/themes', '/api/model-config', '/api/voice/status', '/api/voice/speech-status', '/api/connect/state') or path.startswith('/api/workshop/jobs/'):
            service = features(self.server)
            try:
                if path == '/api/connect/state': result = service.connect.state()
                elif path == '/api/themes': result = service.theme_store.list_themes()
                elif path == '/api/model-config': result = service.workshop.public_config()
                elif path == '/api/voice/speech-status': result = service.speech.public_status()
                elif path == '/api/voice/status':
                    result = service.voice.public_status()
                    result['reason'] = result.get('error') or ('' if result['available'] else '按录音时尝试初始化麦克风')
                    config=service.workshop.public_config()
                    result['stt_configured'] = bool(config['stt_api_key_set'] and config['stt_base_url'] and config['stt_model'])
                    result['tts_configured'] = bool(config['tts_api_key_set'] and config['tts_base_url'] and config['tts_model'])
                else: result = service.workshop.get_job(path.rsplit('/', 1)[-1])
                self.json_response(200, result)
            except KeyError: self.json_response(404, dict(error='生成任务不存在或已失效'))
            except (ValueError, TypeError): self.json_response(400, dict(error='请求无效'))
        elif path == '/api/health':
            self.json_response(200, dict(ok=True, service='atom', version='0.5.0'))
        elif path == '/api/status':
            self.json_response(200, system_status())
        elif path == '/api/apps':
            self.json_response(200, dict(apps=apps(self.server.apps_root)))
        elif path == '/api/developer':
            value = read_settings(self.server.settings_path)
            status = system_status()
            value.update(hostname=status['hostname'], ip=status['network']['ip'], user=getpass.getuser())
            self.json_response(200, value)
        elif path == '/api/display':
            self.json_response(200, display_status())
        elif path == '/api/audio':
            self.json_response(200, audio_status())
        elif path.startswith('/api/'):
            self.json_response(404, dict(error='unknown endpoint'))
        else:
            super().do_GET()

    def translate_path(self, path):
        decoded = unquote(urlsplit(path).path)
        root = self.server.apps_root if decoded.startswith('/user-apps/') else BASE / 'static'
        suffix = decoded[len('/user-apps/'):] if decoded.startswith('/user-apps/') else decoded.lstrip('/')
        try:
            relative = relative_path(suffix) if suffix else PurePosixPath('index.html')
            target = root / str(relative)
            if root.is_symlink() or any(p.is_symlink() for p in [target] + list(target.parents)):
                raise ValueError('symlink')
            return str(target)
        except ValueError:
            return str(BASE / '.nonexistent-forbidden')

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        if path.startswith('/user-apps/') and (path.endswith('.html') or path.endswith('/')):
            target = Path(self.translate_path(self.path))
            if target.is_dir(): target = target / 'index.html'
            try:
                content = target.read_text(encoding='utf-8')
                service = features(self.server)
                manifest = json.loads((service.apps_root / path.split('/')[2] / 'manifest.json').read_text())
                theme_id = manifest.get('theme_id') if manifest.get('theme_mode') == 'fixed' else None
                try: css = service.theme_store.css(theme_id)
                except ValueError: css = service.theme_store.css()
                policy = 'html,body{height:100%!important;max-width:100%;margin:0;overflow:hidden!important;box-sizing:border-box}.atom-scroll,[data-atom-scroll]{min-height:0;overflow-y:auto;overscroll-behavior:contain}'
                appearance = 'theme-controls.css' if manifest.get('theme_ui') == 'controls' else 'app-appearance.css'
                policy += (BASE / 'static' / appearance).read_text(encoding='utf-8')
                style = '<style data-atom-theme>' + css + policy + '</style>'
                content = content.replace('</head>', style + '</head>', 1) if '</head>' in content else style + content
                runtime = '<script src="/app-runtime.js"></script>'
                content = re.sub(r'<head\b[^>]*>', lambda match: match.group(0) + runtime, content, count=1, flags=re.I) if re.search(r'<head\b', content, re.I) else runtime + content
                relay = '<script src="/home-key.js"></script>'
                content = content.replace('</body>', relay + '</body>', 1) if '</body>' in content else content + relay
                payload = content.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                return io.BytesIO(payload)
            except (OSError, ValueError, IndexError): pass
        return super().send_head()

    def do_POST(self):
        host = self.headers.get('Host', '')
        allowed = {'127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port)}
        if host not in allowed or self.headers.get('Origin') != 'http://' + host:
            self.json_response(403, dict(error='same-origin request required')); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY or self.headers.get_content_type() != 'application/json':
                raise ValueError('invalid request body')
            data = json.loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(data, dict):
                raise ValueError('JSON object required')
            path = urlsplit(self.path).path
            if path.startswith('/api/market/'):
                action = path.rsplit('/', 1)[-1]
                service = features(self.server)
                if action == 'rollback':
                    if data.get('confirm') is not True: raise ValueError('请确认恢复应用资源')
                    app_id = data.get('app_id')
                    if app_id in TRUSTED_CLIENT_IDS and app_id not in ('today','task-pal'): raise ValueError('系统入口不能通过市场回滚')
                    previous = service.releases.read(app_id, data.get('release_id'))
                    if previous.get('manifest', {}).get('id') != app_id: raise ValueError('恢复副本与应用不匹配')
                    bundle = validate_delivery_bundle(previous, trusted_connect=app_id in ('today','task-pal'), maximum=2*1024*1024)
                    service.releases.capture(self.server.apps_root, app_id)
                    result = dict(ok=True, app=install_app(self.server.apps_root, bundle, update=True, trusted_connect=app_id in ('today','task-pal')))
                elif action in ('preview','install','install-state'):

                    source = service.market.execute('source', data)
                    source_id = source.get('bundle', {}).get('manifest', {}).get('id')
                    trusted = source.get('official') is True and source_id in {'today','task-pal'}
                    bundle = validate_delivery_bundle(source.get('bundle'), trusted_connect=trusted, maximum=1024*1024)
                    if action == 'preview': result = dict(bundle=bundle)
                    elif action == 'install-state': result = dict(installed=(self.server.apps_root / bundle['manifest']['id']).is_dir(), app_id=bundle['manifest']['id'], history=service.releases.history(bundle['manifest']['id']))
                    else:

                        if data.get('confirm') is not True: raise ValueError('请确认安装应用')
                        app_id = bundle['manifest']['id']
                        if data.get('update') is True:
                            installed_source = self.server.apps_root / app_id / 'ATOM-SOURCE.json'
                            if installed_source.is_symlink(): raise ValueError('应用来源路径无效')
                            if installed_source.is_file():
                                origin = json.loads(installed_source.read_text(encoding='utf-8'))
                                if origin.get('version', {}).get('work_id') != source.get('version', {}).get('work_id'): raise ValueError('此应用来自其他作品，不能覆盖')
                            elif not trusted: raise ValueError('已有应用没有此作品的来源记录，不能覆盖')
                            service.releases.capture(self.server.apps_root, app_id)
                        bundle['files']['ATOM-SOURCE.json'] = json.dumps({k:source.get(k) for k in ('version','license','author','parent_id','parent_version_id','official')}, ensure_ascii=False)
                        result = dict(ok=True, app=install_app(self.server.apps_root, bundle, update=data.get('update') is True, trusted_connect=trusted))
                else: result = service.market.execute(action, data)
                self.json_response(200, result)
            elif path.startswith('/api/connect/'):

                action = path.rsplit('/',1)[-1]
                bridge = features(self.server).connect
                if action == 'client-update':
                    if not read_settings(self.server.settings_path)['enabled']:
                        self.json_response(403, dict(error='developer mode required')); return
                    if not isinstance(data.get('bundle'), dict) or data['bundle'].get('manifest', {}).get('id') not in TRUSTED_CLIENT_IDS:
                        raise ValueError('only reviewed Connect client updates are accepted here')
                    result = dict(ok=True, app=install_app(self.server.apps_root, data['bundle'], update=data.get('update') is not False, trusted_connect=True))
                elif action in ('preview-app','install-app'):
                    bundle = connect_app_bundle(bridge, data)
                    if action == 'preview-app': result = dict(bundle=bundle)
                    else:
                        if data.get('update'): raise ValueError('已有应用不会被自动覆盖，请使用新的应用名称和标识')
                        result = dict(ok=True, app=install_app(self.server.apps_root, bundle, update=False))
                else: result = bridge.execute(action, data)
                self.json_response(200, result)
            elif path.startswith('/api/themes/') or path.startswith('/api/workshop/') or path.startswith('/api/voice/') or path == '/api/model-config':
                service = features(self.server)
                if path == '/api/themes/activate': result = service.theme_store.activate(data.get('id'))
                elif path == '/api/themes/install':
                    theme = dict(data.get('manifest', {}), tokens=data.get('tokens'),icons=data.get('icons')) if 'manifest' in data else data
                    result = service.theme_store.install(theme)
                elif path == '/api/model-config': result = service.workshop.save_config(data)
                elif path == '/api/workshop/generate':
                    data.setdefault('theme_id', service.theme_store.active)
                    service.theme_store.css(data.get('theme_id'))
                    result = service.workshop.start_generation(data)
                elif path == '/api/workshop/install':
                    job = service.workshop.get_job(data.get('job_id'))
                    if job['status'] != 'ready': raise ValueError('应用尚未完成生成')
                    bundle = json.loads(json.dumps(job['bundle']))
                    bundle['manifest'].pop('theme_mode',None);bundle['manifest'].pop('theme_id',None)
                    if data.get('theme_mode')=='fixed': bundle['manifest'].update(theme_mode='fixed',theme_id=job['theme_id'])
                    result = dict(ok=True, app=install_app(service.apps_root, bundle, update=data.get('update') is True))
                elif path == '/api/voice/fan':
                    import socket
                    action=data.get('action')
                    if action not in ('off','auto','status'): raise ValueError('invalid fan action')
                    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
                        client.settimeout(3);client.connect('/run/atom-fan.sock');client.sendall(action.encode())
                        result=json.loads(client.recv(4096).decode())
                    if result.get('error'): raise ValueError(result['error'])
                elif path == '/api/voice/meter': result = service.voice.meter(data.get('recording_id'))
                elif path == '/api/voice/play-recording': result = service.voice.play_recording(data.get('recording_id'))
                elif path == '/api/voice/playback-stop': result = service.voice.stop_playback()
                elif path == '/api/voice/start':
                    service.speech.stop()
                    service.robot.stop()
                    service.voice.stop_playback()
                    result = service.voice.start(quiet_fan=data.get('quiet_fan') is True)
                elif path == '/api/voice/speak':
                    if service.voice.public_status()['recording']: raise ValueError('请先结束录音再朗读')
                    result = service.speech.start(service.workshop.read_private_config(), data.get('text'))
                elif path == '/api/voice/speech-stop': result = service.speech.stop(data.get('speech_id'))
                elif path == '/api/voice/stop': result = service.voice.stop(data.get('recording_id'))
                elif path == '/api/voice/transcribe':
                    from stt import transcribe
                    recording = service.voice.recording_path(data.get('recording_id'))
                    result = transcribe(service.workshop.read_private_config(), recording)
                    recording.unlink()
                else: raise ValueError('unknown endpoint')
                self.json_response(200, result)
            elif path.startswith('/api/robot/'):
                service = features(self.server)
                action = path.rsplit('/', 1)[-1]
                if action == 'chat': result = service.robot.start(service.workshop.read_private_config(), data)
                elif action == 'status': result = service.robot.status(str(data.get('job_id', ''))[:64])
                elif action == 'stop': result = service.robot.stop()
                else: raise ValueError('unknown endpoint')
                self.json_response(200, result)
            elif path in ('/api/apps/install', '/api/apps/update'):
                if not read_settings(self.server.settings_path)['enabled']:
                    self.json_response(403, dict(error='developer mode required')); return
                item = install_app(self.server.apps_root, data, update=path.endswith('/update'))
                self.json_response(201, dict(ok=True, app=item))
            elif path == '/api/apps/uninstall':
                uninstall_app(self.server.apps_root, data.get('id'))
                self.json_response(200, dict(ok=True))
            elif path == '/api/developer':
                enabled = data.get('enabled')
                if type(enabled) is not bool: raise ValueError('enabled must be boolean')
                save_settings(self.server.settings_path, enabled)
                self.json_response(200, dict(enabled=enabled))
            elif path == '/api/display/brightness':
                brightness = data.get('brightness')
                if type(brightness) is not int or not 0 <= brightness <= 100:
                    raise ValueError('brightness must be an integer from 0 to 100')
                set_brightness(brightness)
                self.json_response(200, dict(ok=True, brightness=brightness))
            elif path == '/api/audio/volume':
                volume = data.get('volume')
                if type(volume) is not int or not 0 <= volume <= 100:
                    raise ValueError('volume must be an integer from 0 to 100')
                command(['pactl', 'set-sink-volume', '@DEFAULT_SINK@', str(volume) + '%'])
                self.json_response(200, dict(ok=True, volume=volume))
            else:
                self.json_response(404, dict(error='unknown endpoint'))
        except BridgeError as exc:
            self.json_response(exc.status, dict(error=str(exc), code=exc.code, **({'current':exc.current} if hasattr(exc,'current') else {})))
        except (KeyError, TypeError):
            self.json_response(400, dict(error='请求参数无效或任务不存在'))
        except (ValueError, UnicodeDecodeError) as exc:
            self.json_response(400, dict(error=str(exc)))
        except (OSError, subprocess.SubprocessError):
            self.json_response(503, dict(error='device operation unavailable'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8770)
    parser.add_argument('--apps-dir', default=str(BASE / 'apps'))
    args = parser.parse_args()
    # Ported engines may request dozens of shaders/textures concurrently.
    ThreadingHTTPServer.request_queue_size = 128
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.apps_root = Path(args.apps_dir).absolute()
    server.settings_path = BASE / 'state' / 'settings.json'
    server.serve_forever()


if __name__ == '__main__':
    main()
