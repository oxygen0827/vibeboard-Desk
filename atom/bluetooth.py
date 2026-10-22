"""Bluetooth through BlueZ (bluetoothctl): adapter state, scan, pair, connect and forget devices.

Interactive pairing is handled by a scoped BlueZ Agent1 in bluetooth_pairing. The service user must be
in the `bluetooth` group (BlueZ's D-Bus policy); audio devices also need pulseaudio-module-bluetooth.
"""
import re
import time
import subprocess

MAC = re.compile(r'^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$')
KINDS = {'audio-card': 'audio', 'audio-headphones': 'audio', 'audio-headset': 'audio', 'input-keyboard': 'keyboard',
         'input-mouse': 'mouse', 'input-gaming': 'gamepad', 'phone': 'phone', 'computer': 'computer'}


class BluetoothError(Exception):
    """Safe to show the person as is."""


def _ctl(args, timeout=25):
    try:
        done = subprocess.run(['bluetoothctl'] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                              stdin=subprocess.DEVNULL, env={'LC_ALL': 'C.UTF-8', 'LANG': 'C.UTF-8', 'PATH': '/usr/bin:/bin'})
    except FileNotFoundError:
        raise BluetoothError('这台设备没有安装蓝牙工具')
    except subprocess.TimeoutExpired:
        raise BluetoothError('蓝牙没有及时响应，请让设备靠近一些再试')
    out = re.sub(r'\x1b\[[0-9;]*m', '', done.stdout.decode('utf-8', 'replace'))
    if 'Access denied' in out or 'org.freedesktop.DBus.Error.AccessDenied' in done.stderr.decode('utf-8', 'replace'):
        raise BluetoothError('没有使用蓝牙的权限，需要管理员把服务用户加入 bluetooth 组')
    if 'No default controller available' in out:
        raise BluetoothError('没有找到蓝牙硬件')
    return done.returncode, out


def _mac(value):
    if not isinstance(value, str) or not MAC.fullmatch(value.upper()):
        raise BluetoothError('设备地址无效')
    return value.upper()


def _info(mac):
    _, out = _ctl(['info', mac], timeout=2)
    fields = {}
    for line in out.splitlines():
        if ':' in line and line.startswith('\t'):
            key, value = line.strip().split(':', 1)
            fields[key.strip()] = value.strip()
    return fields


def status():
    _, out = _ctl(['show'], timeout=10)
    powered = re.search(r'Powered:\s*(yes|no)', out)
    return dict(available='Controller' in out, powered=bool(powered and powered.group(1) == 'yes'))


def devices():
    _, out = _ctl(['devices'], timeout=10)
    found = []
    deadline = time.monotonic() + 6
    for line in out.splitlines():
        m = re.match(r'^Device ([0-9A-F:]{17}) (.+)$', line.strip())
        if not m:
            continue
        if len(found) >= 24 or time.monotonic() >= deadline:
            break
        info = _info(m.group(1))
        name = info.get('Alias') or m.group(2)
        if re.fullmatch(r'([0-9A-F]{2}-){5}[0-9A-F]{2}', name):
            continue  # nameless advertisers are noise on a small screen
        found.append(dict(address=m.group(1), name=name[:60], kind=KINDS.get(info.get('Icon', ''), 'other'),
                          paired=info.get('Paired') == 'yes', connected=info.get('Connected') == 'yes'))
    found.sort(key=lambda d: (not d['connected'], not d['paired'], d['name']))
    return found


def power(on):
    if type(on) is not bool:
        raise BluetoothError('请选择打开或关闭蓝牙')
    code, out = _ctl(['power', 'on' if on else 'off'])
    if code != 0 or 'Failed' in out or status()['powered'] != on:
        raise BluetoothError('蓝牙开关没有切换成功')
    return dict(status=status(), devices=devices())


def scan(seconds=8):
    if not status()['powered']:
        power(True)
    code, out = _ctl(['--timeout', str(seconds), 'scan', 'on'], timeout=seconds + 10)
    if 'Failed' in out or code not in (0, 124):
        raise BluetoothError('未能开始扫描，请确认蓝牙已打开后重试')
    return dict(status=status(), devices=devices())


def connect(address, confirm=False, request_id=None):
    """Start an explicit, asynchronous pairing/connection flow; poll for challenges."""
    return pairing('start', dict(address=address, confirm=confirm, id=request_id))


def pairing(action, data):
    import bluetooth_pairing
    try:
        service = bluetooth_pairing.manager()
        if action == 'start':
            result = service.start(_mac(data.get('address')), data.get('confirm'), data.get('id'))
        elif action == 'status':
            result = service.poll(data.get('id'))
        elif action == 'respond':
            result = service.respond(data.get('id'), data.get('challenge'), data.get('value'))
        elif action == 'cancel':
            result = service.cancel(data.get('id'))
        else:
            raise BluetoothError('不支持的配对操作')
        return dict(pairing=result)
    except bluetooth_pairing.PairingError as exc:
        raise BluetoothError(str(exc))


def disconnect(address):
    mac = _mac(address)
    code, out = _ctl(['disconnect', mac])
    if code != 0 or 'Failed' in out or _info(mac).get('Connected') == 'yes':
        raise BluetoothError('没有断开连接，请重试')
    return dict(status=status(), devices=devices())


def forget(address):
    code, out = _ctl(['remove', _mac(address)])
    if code != 0 or 'Failed' in out or 'removed' not in out.lower():
        raise BluetoothError('没能移除这个设备')
    return dict(status=status(), devices=devices())
