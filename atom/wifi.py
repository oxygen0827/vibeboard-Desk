"""Wi-Fi through NetworkManager (nmcli): nearby networks, connect with a password, current state.

The ATOM service runs as the desktop user outside a login session, so connecting needs the polkit
grant in deploy/atom-network.pkla. Without it scanning still works and connect explains the problem.
"""
import re
import subprocess

TIMEOUT = 40


class WifiError(Exception):
    """Safe to show the person as is."""


def _nmcli(args, timeout=TIMEOUT):
    try:
        done = subprocess.run(['nmcli'] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                              env={'LC_ALL': 'C.UTF-8', 'LANG': 'C.UTF-8', 'PATH': '/usr/bin:/bin'})
    except FileNotFoundError:
        raise WifiError('这台设备没有 NetworkManager，无法在这里设置 Wi‑Fi')
    except subprocess.TimeoutExpired:
        raise WifiError('连接超时，请靠近路由器后重试')
    return done.returncode, done.stdout.decode('utf-8', 'replace'), done.stderr.decode('utf-8', 'replace')


def _fields(line):
    """Split one `nmcli -t` line: fields are ':'-separated, literal ':' and '\\' are backslash-escaped."""
    out, cur, escaped = [], '', False
    for ch in line:
        if escaped:
            cur, escaped = cur + ch, False
        elif ch == '\\':
            escaped = True
        elif ch == ':':
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return out


def status():
    code, out, _ = _nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device'], timeout=10)
    wifi = next((f for f in (_fields(l) for l in out.splitlines()) if len(f) >= 4 and f[1] == 'wifi'), None)
    _, conn, _ = _nmcli(['-t', '-f', 'CONNECTIVITY', 'general'], timeout=10)
    return dict(available=wifi is not None, connected=bool(wifi and wifi[2] == 'connected'),
                ssid=wifi[3] if wifi and wifi[2] == 'connected' else '', internet=conn.strip() == 'full')


def networks(rescan=False):
    code, out, err = _nmcli(['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes' if rescan else 'auto'], timeout=30)
    if code != 0:
        raise WifiError('扫描 Wi‑Fi 失败，请稍后重试')
    found = {}
    for line in out.splitlines():
        f = _fields(line)
        if len(f) < 4 or not f[1].strip():
            continue  # hidden networks have no name to show
        ssid = f[1]
        item = dict(ssid=ssid, signal=int(f[2]) if f[2].isdigit() else 0, secure=f[3] not in ('', '--'), active=f[0] == '*')
        old = found.get(ssid)
        if not old or item['active'] or (not old['active'] and item['signal'] > old['signal']):
            found[ssid] = item
    return sorted(found.values(), key=lambda n: (not n['active'], -n['signal']))[:30]


def connect(ssid, password):
    if not isinstance(ssid, str) or not 1 <= len(ssid.encode('utf-8')) <= 32:
        raise WifiError('请选择一个 Wi‑Fi')
    if not isinstance(password, str) or (password and not 8 <= len(password) <= 63) or '\n' in password:
        raise WifiError('Wi‑Fi 密码一般是 8–63 位')
    # Clicking the active network must not tear down its working connection.
    active = next((n for n in networks() if n['active']), None)
    if active and active['ssid'] == ssid:
        return status()
    _, profiles, _ = _nmcli(['-t', '-f', 'UUID,TYPE', 'connection', 'show', '--active'], timeout=10)
    previous = next((f[0] for f in (_fields(line) for line in profiles.splitlines())
                     if len(f) == 2 and f[1] in ('wifi', '802-11-wireless')
                     and re.fullmatch(r'[0-9a-fA-F-]{36}', f[0])), None)
    args = ['-w', '35', 'device', 'wifi', 'connect', ssid] + (['password', password] if password else [])
    failure = None
    try:
        code, out, err = _nmcli(args)
        if code == 0:
            connected = status()
            if connected['connected']:
                return connected
            failure = '新网络尚未连接成功'
        else:
            failure = _connection_error(out + err)
    except WifiError as exc:
        failure = str(exc)
    if previous:
        try:
            restored, _, _ = _nmcli(['-w', '20', 'connection', 'up', 'uuid', previous], timeout=25)
            failure += '；已恢复原网络' if restored == 0 else '；请重新选择原网络'
        except WifiError:
            failure += '；请重新选择原网络'
    raise WifiError(failure)


def _connection_error(output):
    text = output.lower()
    if 'not authorized' in text or 'insufficient privileges' in text:
        return '系统还没有允许 ATOM 设置网络，请联系管理员'
    if 'secrets were required' in text or 'invalid passphrase' in text or 'psk' in text or re.search(r'\b(7|10)\b.*password', text):
        return '密码不对，请再试一次'
    if 'no network with ssid' in text:
        return '附近找不到这个 Wi‑Fi，请刷新后重试'
    return '连不上这个 Wi‑Fi，请检查密码或换一个网络'
