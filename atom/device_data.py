"""Device-local data snapshots, explicit backups and one-way simulator mirroring.

Only the shell's reviewed storage keys are accepted. Account credentials, model keys,
installed source bundles and photos are never part of a snapshot.
"""
import hashlib
import json
import re
import secrets
import threading
import time
from pathlib import Path
from system_update import _write

LIMIT = 1500 * 1024
MIRROR_LIMIT = 64 * 1024
KEYS = {'atom.desktop.v2', 'atom.widget', 'atom.timer', 'atom.notes', 'atom.speechFeedback',
        'atom.experienceAnimations', 'atom.appearance', 'atom.appearance.v1'}
AUTO_KEEP = 7  # daily automatic snapshots kept alongside up to 10 manual backups
BACKUP_ID = re.compile(r'^(?:[0-9]{8}-[0-9]{6}-[a-f0-9]{6}|auto-[0-9]{8})$')
APP_KEY = re.compile(r'^atom\.app\.v1\.[a-z][a-z0-9_-]{0,47}$')


def validate(data, limit=LIMIT):
    if not isinstance(data, dict) or len(data) > 300:
        raise ValueError('备份数据格式无效')
    for key, value in data.items():
        if key not in KEYS and not APP_KEY.fullmatch(key):
            raise ValueError('备份包含不支持的数据字段')
        if not isinstance(value, str) or len(value.encode('utf-8')) > 65536:
            raise ValueError('单个应用的记录不能超过 64 KiB')
        try:
            json.loads(value)
        except ValueError:
            raise ValueError('应用记录格式无效')
    raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    if len(raw) > limit:
        raise ValueError('记录超过同步上限；本机数据已保留，请先使用本地备份')
    return hashlib.sha256(raw).hexdigest(), len(raw)


class DeviceData:
    def __init__(self, root, bridge=None):
        self.root = Path(root)
        self.folder = self.root / 'user-backups'
        self.path = self.root / 'user-data.json'
        self.previous = self.root / 'user-data.prev.json'
        self.mirror_path = self.root / 'mirror.json'
        self.pending = self.root / 'pending-restore.json'
        self.bridge = bridge
        self.lock = threading.RLock()
        self.mirror_lock = threading.RLock()
        self.closed = False
        self.last_sent = {}
        self.last_error = ''
        self.sending = False

    def _read(self, path, default):
        try:
            return json.loads(path.read_text())
        except FileNotFoundError:
            return default
        except (OSError, ValueError):
            raise ValueError('本机记录无法读取，请重试；已有数据没有被覆盖')

    def current(self):
        """The authoritative copy; falls back to the previous version if the newest file is damaged."""
        try:
            return self._read(self.path, {})
        except ValueError:
            value = self._read(self.previous, None)
            if value is None:
                raise
            return value

    def capture(self, data):
        with self.lock:
            if self.closed or self.pending.exists():
                raise ValueError('正在恢复记录，请完成恢复后重试')
            version, size = validate(data)
            old = self.current()
            if old.get('version') != version:
                if old:
                    _write(self.previous, old)
                _write(self.path, dict(version=version, data=data, size=size, updated=time.time()))
                if data:
                    self._daily(version, data)
        self.push()
        return dict(version=version, size=size)

    def _daily(self, version, data):
        name = 'auto-' + time.strftime('%Y%m%d')
        target = self.folder / (name + '.json')
        _write(target, dict(format='atom-user-data-v1', created=time.time(), version=version, data=data, automatic=True))
        for old in sorted(self.folder.glob('auto-*.json'))[:-AUTO_KEEP]:
            old.unlink()

    def recover_current(self):
        """Hand the saved copy back to a shell whose browser storage came up empty."""
        with self.lock:
            if self.pending.exists():
                return dict(pending=self._read(self.pending, {}).get('id'))
            snap = self.current()
            if not snap.get('data'):
                raise ValueError('没有可恢复的本机记录')
            token = secrets.token_hex(16)
            _write(self.pending, dict(id=token, data=snap['data'], source='recover'))
            return dict(pending=token)

    def status(self):
        with self.lock:
            backups = []
            for p in sorted(self.folder.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
                value = self._read(p, {})
                backups.append(dict(id=p.stem, created=value.get('created'), size=p.stat().st_size, automatic=p.stem.startswith('auto-')))
            snap = self.current()
            return dict(backups=backups, mirror=self._read(self.mirror_path, {}).get('enabled', False),
                        mirror_clear_pending=self._read(self.mirror_path, {}).get('clear_pending', False),
                        mirror_error=self.last_error, version=snap.get('version'), size=snap.get('size', 0),
                        pending=self._read(self.pending, None))

    def backup(self, data):
        with self.lock:
            self.capture(data)
            if len([p for p in self.folder.glob('*.json') if not p.stem.startswith('auto-')]) >= 10:
                raise ValueError('已保存 10 份备份，请先导出并删除一份旧备份')
            version, _ = validate(data)
            value = dict(format='atom-user-data-v1', created=time.time(), version=version, data=data)
            ident = time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3)
            _write(self.folder / (ident + '.json'), value)
            return dict(id=ident, backup=value)

    def read_backup(self, ident):
        if not isinstance(ident, str) or not BACKUP_ID.fullmatch(ident):
            raise ValueError('备份标识无效')
        value = self._read(self.folder / (ident + '.json'), None)
        if value is None:
            raise ValueError('找不到这份备份')
        return value

    def restore(self, backup, confirm):
        if confirm is not True:
            raise ValueError('请确认用备份覆盖当前桌面与本地记录')
        if not isinstance(backup, dict) or backup.get('format') != 'atom-user-data-v1':
            raise ValueError('请选择 ATOM 用户数据备份')
        version, _ = validate(backup.get('data'))
        if version != backup.get('version'):
            raise ValueError('备份校验失败，原有记录未改变')
        token = secrets.token_hex(16)
        with self.lock:
            _write(self.pending, dict(id=token, data=backup['data'], source='backup'))
        return dict(pending=token)

    def mirror_import(self, data):
        validate(data, MIRROR_LIMIT)
        token = secrets.token_hex(16)
        with self.lock:
            _write(self.pending, dict(id=token, data=data, source='mirror'))
        return dict(pending=token)

    def acknowledge(self, token):
        with self.lock:
            value = self._read(self.pending, None)
            if value and value.get('id') == token:
                version, size = validate(value['data'])
                _write(self.path, dict(version=version, data=value['data'], size=size, updated=time.time()))
                self.pending.unlink()
        return dict(ok=True)

    def enable_mirror(self, enabled):
        if type(enabled) is not bool:
            raise ValueError('请选择是否同步')
        with self.mirror_lock:
            _write(self.mirror_path, dict(enabled=enabled))
            if not enabled and self.bridge and self.bridge.config:
                # Serialize with in-flight uploads so nothing can be re-uploaded after clearing.
                try:
                    self.bridge._request('/v1/device/snapshot/clear', {})
                    self.last_error = ''
                    self.last_sent.clear()
                except Exception:
                    _write(self.mirror_path, dict(enabled=False, clear_pending=True))
                    self.last_error = '本机已停止同步；云端副本暂未清除，联网后请点击重试'
                    raise ValueError(self.last_error)
        self.push()
        return self.status()

    def close(self):
        with self.mirror_lock:
            self.closed = True

    def push(self):
        if self.closed or not self.bridge or not self.bridge.config or self.sending:
            return
        if not self._read(self.mirror_path, {}).get('enabled'):
            return
        self.sending = True
        threading.Thread(target=self._push, daemon=True).start()

    def _push(self):
        try:
            snap = self._read(self.path, {})
            if not snap:
                return
            version, _ = validate(snap['data'], MIRROR_LIMIT)
            import e2e
            peers = self.bridge._request('/v1/state').get('paired', [])
            for peer in peers:
                cid = peer['client_id']
                info = self.bridge.pairing(cid, peer)
                if info['state'] != 'on':
                    raise ValueError('请先完成与电脑的加密配对')
                if self.last_sent.get(cid) == version:
                    continue
                aad = 'snapshot|' + self.bridge.config['client_id'] + '|' + version
                sealed = e2e.seal_json(info['key'], snap['data'], aad)
                with self.mirror_lock:
                    if self.closed or not self._read(self.mirror_path, {}).get('enabled'):
                        return
                    self.bridge._request('/v1/device/snapshot', dict(computer_id=cid, version=version, envelope=sealed))
                    self.last_sent[cid] = version
            self.last_error = '' if peers else '请先配对一台电脑'
        except Exception as exc:
            self.last_error = str(exc) if isinstance(exc, ValueError) else '同步暂未完成，联网后会重试'
        finally:
            self.sending = False
