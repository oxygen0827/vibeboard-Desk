"""Signed core updates, durable rollback and boot-time recovery (Python 3.7+).

User applications, identities and state are outside the release. The stable installer in
~/.local/lib/atom runs as linaro; it never needs root or restarts the display server.
"""
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen

BASE = Path(os.environ.get('ATOM_ROOT', str(Path(__file__).resolve().parent)))
RELEASES = BASE.parent / 'atom-releases'
UPDATE = BASE / 'state' / 'update'
CORE_DIRS = ('static', 'templates', 'deploy')
MAX_PACKAGE = 8 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
VERSION = re.compile(r'^[0-9]+(?:\.[0-9]+){1,4}$')


class UpdateError(Exception):
    """Safe to show without paths, tokens or provider details."""


def _version(value):
    if not isinstance(value, str) or len(value) > 40 or not VERSION.fullmatch(value):
        raise UpdateError('更新版本号无效')
    return value


def current_version():
    try:
        return (BASE / 'VERSION').read_text(encoding='utf-8').strip() or 'dev'
    except OSError:
        return 'dev'


# Health must describe the code actually running, not a VERSION file replaced under an old process.
RUNNING_VERSION = current_version()


def _sync_dir(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.atomic-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(value, out, ensure_ascii=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, str(path))
        _sync_dir(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def _locked():
    UPDATE.mkdir(parents=True, exist_ok=True)
    with (UPDATE / 'operation.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise UpdateError('正在处理另一个系统操作，请稍后再试')
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _idle():
    if (UPDATE / 'request.json').exists() or (UPDATE / 'journal.json').exists():
        raise UpdateError('更新尚未结束，请等待恢复完成')


def _is_core(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name or str(path) != name:
        return False
    if len(path.parts) == 1:
        return (not name.startswith('.') and path.suffix == '.py') or name == 'VERSION'
    return path.parts[0] in CORE_DIRS and not any(p.startswith('.') or p == '__pycache__' for p in path.parts)


def _key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        raw = base64.b64decode((BASE / 'deploy' / 'release-public.key').read_text().strip(), validate=True)
        return Ed25519PublicKey.from_public_bytes(raw)
    except (OSError, ValueError):
        raise UpdateError('设备缺少有效的更新验签公钥，请联系维护者')


def verify_manifest(manifest):
    from cryptography.exceptions import InvalidSignature
    if not isinstance(manifest, dict):
        raise UpdateError('更新信息格式无效')
    body = {k: v for k, v in manifest.items() if k != 'signature'}
    data = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    try:
        _key().verify(base64.b64decode(manifest.get('signature', ''), validate=True), data)
    except (InvalidSignature, ValueError, TypeError):
        raise UpdateError('更新包签名不正确，已拒绝安装')
    _version(manifest.get('version'))
    if type(manifest.get('size')) is not int or not 0 < manifest['size'] <= MAX_PACKAGE:
        raise UpdateError('更新包大小不符合要求')
    return manifest


def _get(relay, path):
    from relay_bridge import relay_url
    relay = relay_url(relay)
    request = Request(relay + path, headers={'Accept': 'application/json'})
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read(MAX_PACKAGE * 2 + 1)
            if len(raw) > MAX_PACKAGE * 2:
                raise ValueError('large')
            result = json.loads(raw.decode('utf-8'))
            if not isinstance(result, dict):
                raise ValueError('object expected')
            return result
    except Exception:
        raise UpdateError('无法读取 ATOM 更新服务，请检查网络后重试')


def check(relay):
    latest = _get(relay, '/market/v1/system/latest')
    if not latest.get('version'):
        return dict(current=current_version(), latest=None, available=False)
    verify_manifest(latest)
    current = current_version()
    newer = not VERSION.fullmatch(current) or tuple(map(int, latest['version'].split('.'))) > tuple(map(int, current.split('.')))
    return dict(current=current, latest={k: latest.get(k) for k in ('version', 'notes', 'size', 'created')}, available=newer)


def _unpack(package, manifest, target):
    """Reverify the original signed bytes, then extract only regular core files with bounded size."""
    verify_manifest(manifest)
    if len(package) != manifest['size'] or hashlib.sha256(package).hexdigest() != manifest.get('sha256'):
        raise UpdateError('更新包下载不完整，请重新下载')
    try:
        with tarfile.open(fileobj=io.BytesIO(package), mode='r:gz') as archive:
            members = archive.getmembers()
            names = [m.name for m in members]
            if len(names) > 5000 or len(set(names)) != len(names) or sum(m.size for m in members) > MAX_EXPANDED:
                raise UpdateError('更新包内容不符合要求')
            if not all(m.isfile() and _is_core(m.name) for m in members):
                raise UpdateError('更新包内容不符合要求，已拒绝安装')
            if not {'VERSION', 'server.py', 'static/app.js'}.issubset(names):
                raise UpdateError('更新包内容不完整')
            for member in members:
                dest = target / member.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, dest.open('wb') as out:
                    shutil.copyfileobj(source, out)
                dest.chmod(0o755 if member.mode & 0o111 else 0o644)
        if (target / 'VERSION').read_text().strip() != manifest['version']:
            raise UpdateError('更新包版本不匹配')
    except (tarfile.TarError, OSError, UnicodeError) as exc:
        raise UpdateError('无法解压更新包，请检查存储空间并重新下载') from exc


def stage(relay):
    with _locked():
        _idle()
        latest = verify_manifest(_get(relay, '/market/v1/system/latest'))
        version = latest['version']
        try:
            package = base64.b64decode(_get(relay, '/market/v1/system/package/' + version).get('data', ''), validate=True)
        except (ValueError, TypeError):
            raise UpdateError('更新包下载不完整，请重试')
        RELEASES.mkdir(parents=True, exist_ok=True)
        # Python 3.7's TemporaryDirectory raises when its directory was renamed on success.
        target = Path(tempfile.mkdtemp(prefix='.download-', dir=str(RELEASES)))
        try:
            _unpack(package, latest, target)
            (target / '.package').write_bytes(package)
            _write(target / '.verified', latest)
            final = RELEASES / version
            if final.exists():
                shutil.rmtree(str(final))
            os.rename(str(target), str(final))
        finally:
            if target.exists():
                shutil.rmtree(str(target))
        return version


def request_install(version):
    with _locked():
        _idle()
        _version(version)
        staged = RELEASES / version
        if not (staged / '.verified').is_file() or not (staged / '.package').is_file():
            raise UpdateError('请先下载更新')
        if version == current_version():
            raise UpdateError('当前已经是这个版本')
        result = UPDATE / 'result.json'
        if result.exists():
            result.unlink()
        _write(UPDATE / 'request.json', dict(version=version, previous=current_version(), at=time.time()))
        return dict(installing=version)


def supported():
    return sys.platform.startswith('linux') and Path('/etc/systemd/system/atom-update.path').is_file()


def status():
    out = dict(supported=supported(), current=current_version(), installing=None, result=None, recovery_required=(UPDATE / 'journal.json').exists())
    for name, key in [('request', 'installing'), ('result', 'result')]:
        try:
            value = json.loads((UPDATE / (name + '.json')).read_text())
            out[key] = value.get('version') if key == 'installing' else value
        except (OSError, ValueError):
            pass
    return out


def _core_files(root):
    files = list(root.glob('*.py')) + ([root / 'VERSION'] if (root / 'VERSION').exists() else [])
    for name in CORE_DIRS:
        files += list((root / name).rglob('*'))
    return sorted(p.relative_to(root) for p in files if p.is_file() and not p.is_symlink() and _is_core(p.relative_to(root).as_posix()))


def _copy_core(source, dest):
    for rel in _core_files(source):
        target = dest / rel
        if target.is_symlink() or any(p.is_symlink() for p in target.parents):
            raise UpdateError('系统文件路径异常，已停止更新')
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name('.' + target.name + '.new')
        try:
            shutil.copy2(str(source / rel), str(tmp))
            with tmp.open('rb') as data:
                os.fsync(data.fileno())
            os.replace(str(tmp), str(target))
            _sync_dir(target.parent)
        finally:
            if tmp.exists():
                tmp.unlink()


def _restart_and_wait(version, timeout=60):
    try:
        pid = int(subprocess.run(['systemctl', 'show', '-p', 'MainPID', '--value', 'atom'], stdout=subprocess.PIPE, timeout=10).stdout.decode().strip() or 0)
        if pid > 1:
            os.kill(pid, signal.SIGTERM)
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
    deadline = time.monotonic() + timeout
    time.sleep(3)
    while time.monotonic() < deadline:
        try:
            with urlopen('http://127.0.0.1:8770/api/health', timeout=3) as response:
                if json.loads(response.read().decode()).get('version') == version:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def _restore(journal):
    backup = RELEASES / journal['backup']
    if backup.parent != RELEASES or not backup.is_dir():
        raise UpdateError('恢复副本不可用，请联系维护者')
    old, new = set(journal['old_files']), set(journal['new_files'])
    if not all(_is_core(n) for n in old | new) or set(p.as_posix() for p in _core_files(backup)) != old:
        raise UpdateError('恢复副本不完整，请联系维护者')
    _copy_core(backup, BASE)
    for name in new - old:
        path = BASE / name
        if path.exists():
            path.unlink()
    _sync_dir(BASE)


def recover():
    """Runs before atom.service at boot. A journal always means restore the last complete core."""
    with _locked():
        path = UPDATE / 'journal.json'
        if not path.exists():
            return
        journal = json.loads(path.read_text())
        _restore(journal)
        _write(UPDATE / 'result.json', dict(version=journal['version'], previous=journal['previous'], ok=False,
               rolled_back=True, at=time.time(), error='上次更新被中断，已恢复到 ' + journal['previous']))
        path.unlink()
        request = UPDATE / 'request.json'
        if request.exists():
            request.unlink()
        _sync_dir(UPDATE)


def apply():
    with _locked():
        request_path = UPDATE / 'request.json'
        if not request_path.exists():
            return
        journal_path = UPDATE / 'journal.json'
        result = dict(ok=False, rolled_back=False, at=time.time())
        journal = None
        try:
            if journal_path.exists():
                journal = json.loads(journal_path.read_text())
                raise UpdateError('检测到未完成的更新，正在恢复')
            request = json.loads(request_path.read_text())
            version = _version(request.get('version'))
            previous = current_version()
            result.update(version=version, previous=previous)
            staged = RELEASES / version
            manifest = json.loads((staged / '.verified').read_text())
            if manifest.get('version') != version:
                raise UpdateError('更新版本不匹配')
            with tempfile.TemporaryDirectory(prefix='.install-', dir=str(RELEASES)) as folder:
                clean = Path(folder)
                _unpack((staged / '.package').read_bytes(), manifest, clean)
                required = sum((BASE / p).stat().st_size for p in _core_files(BASE)) + MAX_EXPANDED
                if shutil.disk_usage(str(BASE)).free < required:
                    raise UpdateError('存储空间不足，请腾出至少 100 MB 再试')
                backup = Path(tempfile.mkdtemp(prefix='backup-', dir=str(RELEASES)))
                _copy_core(BASE, backup)
                journal = dict(version=version, previous=previous, backup=backup.name,
                               old_files=[p.as_posix() for p in _core_files(backup)], new_files=[p.as_posix() for p in _core_files(clean)])
                _write(journal_path, journal)  # durable before the first live-file replacement
                _copy_core(clean, BASE)
                for name in set(journal['old_files']) - set(journal['new_files']):
                    (BASE / name).unlink()
                if not _restart_and_wait(version):
                    raise UpdateError('新版本未能正常启动')
                result['ok'] = True
                journal_path.unlink()
                journal = None
        except Exception as exc:
            result['error'] = str(exc) if isinstance(exc, UpdateError) else '更新未完成，请检查存储空间后重试'
            if journal is not None:
                try:
                    _restore(journal)
                    healthy = _restart_and_wait(journal['previous'])
                    result.update(version=journal['version'], previous=journal['previous'], rolled_back=True,
                                  error='更新未完成，已恢复到 ' + journal['previous'] + ('' if healthy else '；服务尚未恢复，请重启设备'))
                    journal_path.unlink()
                except Exception:
                    result['error'] = '自动恢复未完成，请重启设备继续恢复；若仍失败请联系维护者'
        _write(UPDATE / 'result.json', result)
        if request_path.exists():
            request_path.unlink()
        _sync_dir(UPDATE)


if __name__ == '__main__':
    if sys.argv[1:] == ['apply']:
        apply()
    elif sys.argv[1:] == ['recover']:
        recover()
