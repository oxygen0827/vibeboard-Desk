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
from app_input import validate_input_manifest, validate_input_bundle
import system_update
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


def model_config(service):
    """The device's own keys where set; otherwise the ATOM official channel for a signed-in account.

    Text generation and voice (robot chat, transcription, speech) are decided separately, so a person
    can bring their own generation key and still use the official voice, or the other way round."""
    config = service.workshop.read_private_config()
    own_voice = config.get('stt_api_key') and config.get('tts_api_key')
    if config.get('api_key') and own_voice: return config
    account = service.market.current()
    if not account.get('token'): return config
    import official_ai
    relay, token = service.market.base(), account['token']
    if not config.get('api_key'): config = official_ai.overlay(config, relay, token)
    if not own_voice:
        official_voice = official_ai.voice_overlay(config, relay, token)
        for kind in ('stt', 'tts'):
            if not config.get(kind + '_api_key'):
                for suffix in ('_api_key', '_base_url', '_model'):
                    config[kind + suffix] = official_voice[kind + suffix]
        config['official_voice'] = True
    return config


def official_status(service):
    config = service.workshop.read_private_config()
    if config.get('api_key'): return dict(active=False)
    account = service.market.current()
    if not account.get('token'): return dict(active=False, reason='sign_in')
    import official_ai
    try:
        q = official_ai.quota(model_config(service))
        return dict(active=bool(q.get('available')), remaining=q.get('generate', {}).get('remaining'), limit=q.get('generate', {}).get('limit'), reason=None if q.get('available') else 'unavailable')
    except official_ai.OfficialError as exc:
        return dict(active=False, reason='error', error=str(exc))


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
            from device_data import DeviceData
            http.device_data = DeviceData(state, http.connect)
            from market_client import MarketClient
            http.market = MarketClient(state, http.connect)
            from robot import RobotTalk
            http.robot = RobotTalk()
            from experiences import Experiences
            http.experiences = Experiences()
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
    input_declaration = validate_input_manifest(value, required=False)
    if input_declaration is not None: result['input'] = input_declaration
    if 'capabilities' in value:
        caps = value['capabilities']
        if not isinstance(caps,list) or len(caps)>4 or any(not isinstance(c,str) or c not in ('notes','agenda','task-state','photos') for c in caps) or len(set(caps))!=len(caps): raise ValueError('invalid app capabilities')
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


def install_app(root, data, update=False, trusted_connect=False, require_input=True):
    provided_icon = isinstance(data,dict) and isinstance(data.get('manifest'),dict) and 'icon' in data['manifest']
    data = ensure_icon(data)
    validate_input_bundle(data, required=require_input)
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
        if urlsplit(self.path).path in ('/', '/index.html', '/app.js', '/home-key.js', '/style.css', '/app-runtime.js', '/input-navigation.js', '/app-host.js', '/companion.js', '/maintenance.js', '/system-settings.js', '/system-appearance.css', '/app-appearance.css', '/theme-controls.css', '/atom-ui.css'):
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
                elif path == '/api/model-config': result = dict(service.workshop.public_config(), official=official_status(service))
                elif path == '/api/voice/speech-status': result = service.speech.public_status()
                elif path == '/api/voice/status':
                    result = service.voice.public_status()
                    result['reason'] = result.get('error') or ('' if result['available'] else '按录音时尝试初始化麦克风')
                    config=model_config(service)
                    result['stt_configured'] = all(config.get(k) for k in ('stt_api_key','stt_base_url','stt_model'))
                    result['tts_configured'] = all(config.get(k) for k in ('tts_api_key','tts_base_url','tts_model'))
                else: result = service.workshop.get_job(path.rsplit('/', 1)[-1])
                self.json_response(200, result)
            except KeyError: self.json_response(404, dict(error='生成任务不存在或已失效'))
            except (ValueError, TypeError): self.json_response(400, dict(error='请求无效'))
        elif path == '/api/health':
            self.json_response(200, dict(ok=True, service='atom', version=system_update.RUNNING_VERSION))
        elif path == '/api/status':
            self.json_response(200, system_status())
        elif path == '/api/system/update':
            self.json_response(200, system_update.status())
        elif path in ('/api/system/time', '/api/bluetooth'):
            import system_tools, bluetooth
            try:
                if path == '/api/system/time': self.json_response(200, system_tools.time_status())
                else: self.json_response(200, dict(status=bluetooth.status(), devices=bluetooth.devices()))
            except (system_tools.SystemError_, bluetooth.BluetoothError) as exc: self.json_response(503, dict(error=str(exc)))
        elif path == '/api/wifi':
            import wifi
            try: self.json_response(200, dict(status=wifi.status(), networks=wifi.networks()))
            except wifi.WifiError as exc: self.json_response(503, dict(error=str(exc)))
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
                runtime = '<script src="/input-navigation.js"></script><script src="/app-runtime.js"></script>'
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
            if path.startswith('/api/device-data/'):
                service = features(self.server)
                store = service.device_data
                action = path.rsplit('/', 1)[-1]
                if action == 'status': result = store.status()
                elif action == 'capture': result = store.capture(data.get('data'))
                elif action == 'backup': result = store.backup(data.get('data'))
                elif action == 'export': result = dict(backup=store.read_backup(data.get('id')))
                elif action == 'restore':
                    result = store.restore(data.get('backup') if 'backup' in data else store.read_backup(data.get('id')), data.get('confirm'))
                elif action == 'delete':
                    if data.get('confirm') is not True: raise ValueError('请确认删除这份备份')
                    store.read_backup(data.get('id'))
                    (store.folder / (data['id'] + '.json')).unlink()
                    result = dict(ok=True)
                elif action == 'ack': result = store.acknowledge(data.get('id'))
                elif action == 'recover': result = store.recover_current()
                elif action == 'mirror': result = store.enable_mirror(data.get('enabled'))
                elif action == 'preview':
                    if not getattr(self.server, 'is_simulator', False): raise ValueError('此接口仅供模拟设备使用')
                    result = store.mirror_import(data.get('data'))
                elif action == 'reset':
                    if data.get('confirm') != '重置这台设备': raise ValueError('请输入「重置这台设备」确认')
                    if any(j['status'] in ('queued','generating','checking') for j in service.workshop.jobs.values()):
                        raise ValueError('请等待生成任务结束再重置')
                    if system_update.status()['installing'] or system_update.status()['recovery_required']:
                        raise ValueError('请等待系统更新完成再重置')
                    service.voice.stop(); service.voice.stop_playback(); service.speech.stop()
                    store.close()
                    # Local credentials are discarded even when the relay is offline. Cloud account content stays.
                    for peer in service.connect.state().get('paired', []):
                        try: service.connect.execute('unpair', {'client_id': peer['client_id']})
                        except BridgeError: pass
                    with FEATURE_LOCK:
                        for child in self.server.settings_path.parent.iterdir():
                            if child.name == 'update': continue
                            if child.is_dir() and not child.is_symlink(): shutil.rmtree(str(child))
                            else: child.unlink()
                        from system_update import _write
                        _write(store.pending, dict(id='reset-' + str(time.time_ns()), data={}, source='reset'))
                        del self.server.workshop
                    result = dict(ok=True)
                else: raise ValueError('未知的数据操作')
                self.json_response(200, result)
            elif path.startswith('/api/market/'):
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
                    result = service.workshop.start_generation(data, model_config(service))
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
                    result = service.speech.start(model_config(service), data.get('text'))
                elif path == '/api/voice/speech-stop': result = service.speech.stop(data.get('speech_id'))
                elif path == '/api/voice/stop': result = service.voice.stop(data.get('recording_id'))
                elif path == '/api/voice/transcribe':
                    from stt import transcribe
                    recording = service.voice.recording_path(data.get('recording_id'))
                    result = transcribe(model_config(service), recording)
                    recording.unlink()
                else: raise ValueError('unknown endpoint')
                self.json_response(200, result)
            elif path.startswith('/api/experiences/'):
                service = features(self.server)
                action = path.rsplit('/', 1)[-1]
                if action == 'generate': result = service.experiences.start(model_config(service), data)
                elif action == 'job': result = service.experiences.status(data.get('job_id'), data.get('kind'))
                elif action == 'cancel': result = service.experiences.cancel(data.get('job_id'), data.get('kind'))
                else: raise ValueError('unknown endpoint')
                self.json_response(200, result)
            elif path.startswith('/api/robot/'):
                service = features(self.server)
                action = path.rsplit('/', 1)[-1]
                if action == 'chat': result = service.robot.start(model_config(service), data)
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
            elif path in ('/api/system/update/check', '/api/system/update/download', '/api/system/update/install'):
                try:
                    relay = features(self.server).market.base()
                    if not system_update.supported(): raise system_update.UpdateError('此环境未安装更新服务；模拟设备请更新 ATOM Connect')
                    if path.endswith('/check'): result = system_update.check(relay)
                    elif path.endswith('/download'): result = dict(staged=system_update.stage(relay))
                    else: result = system_update.request_install(str(data.get('version', '')))
                    self.json_response(200, result)
                except system_update.UpdateError as exc: self.json_response(400, dict(error=str(exc)))
            elif path in ('/api/system/power', '/api/system/timezone', '/api/system/automatic-time'):
                import system_tools
                try:
                    if getattr(self.server, 'is_simulator', False): raise system_tools.SystemError_('模拟设备不能修改电脑的电源或时间，请在小电脑上操作')
                    if path == '/api/system/power':
                        if data.get('confirm') is not True: raise system_tools.SystemError_('请确认' + ('重启' if data.get('action') == 'reboot' else '关机'))
                        if system_update.status()['installing']: raise system_tools.SystemError_('系统正在更新，请等更新完成')
                        result = system_tools.power(data.get('action'))
                    elif path == '/api/system/timezone': result = system_tools.set_timezone(data.get('zone'))
                    else: result = system_tools.set_automatic(data.get('enabled'))
                    self.json_response(200, result)
                except system_tools.SystemError_ as exc: self.json_response(400, dict(error=str(exc)))
            elif path.startswith('/api/bluetooth/'):
                import bluetooth
                action = path.rsplit('/', 1)[-1]
                try:
                    if getattr(self.server, 'is_simulator', False): raise bluetooth.BluetoothError('请在小电脑上操作蓝牙；模拟设备不会修改电脑的蓝牙')
                    if action == 'power': result = bluetooth.power(data.get('on'))
                    elif action == 'scan': result = bluetooth.scan()
                    elif action == 'connect': result = bluetooth.connect(data.get('address'))
                    elif action == 'disconnect': result = bluetooth.disconnect(data.get('address'))
                    elif action == 'forget': result = bluetooth.forget(data.get('address'))
                    else: raise bluetooth.BluetoothError('不支持的蓝牙操作')
                    self.json_response(200, result)
                except bluetooth.BluetoothError as exc: self.json_response(400, dict(error=str(exc)))
            elif path in ('/api/wifi/scan', '/api/wifi/connect'):
                import wifi
                try:
                    if path == '/api/wifi/scan': result = dict(status=wifi.status(), networks=wifi.networks(rescan=True))
                    else: result = dict(status=wifi.connect(data.get('ssid'), data.get('password', '')))
                    self.json_response(200, result)
                except wifi.WifiError as exc: self.json_response(400, dict(error=str(exc)))
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
