#!/usr/bin/env python3
"""ATOM Connect health monitor: emails ALERT_TO when a check starts failing, when it recovers,
and once a day while it keeps failing. Run every few minutes by atom-connect-monitor.timer."""
import argparse
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'marketplace'))
from mailer import Mailer  # noqa: E402

DATA = Path('/var/lib/atom')
REMIND = 24 * 3600
LABELS = {'health': '公网健康检查', 'service': 'atom-connect 服务', 'backup': '每日备份', 'disk': '磁盘空间', 'certificate': 'HTTPS 证书'}


def check_health(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read(4096)).get('ok') is True, 'HTTP %d' % r.status
    except Exception as exc:
        return False, type(exc).__name__ + ': ' + str(exc)[:200]


def check_service():
    try:
        state = subprocess.run(['systemctl', 'is-active', 'atom-connect.service'], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return False, 'systemctl unavailable: ' + type(exc).__name__
    return state == 'active', state or 'unknown'


def check_backup(now):
    if not Path('/etc/atom/oss.env').exists():
        return True, 'backup not configured'
    stamp = DATA / 'backups' / 'last-success'
    try:
        age = now - int(stamp.read_text().strip())
    except (OSError, ValueError):
        return False, 'no successful backup recorded'
    return age < 26 * 3600, 'last success %.1f hours ago' % (age / 3600)


def check_disk():
    usage = shutil.disk_usage('/')
    free = usage.free / usage.total
    return free >= 0.10, '%.1f%% free (%.1f GiB)' % (free * 100, usage.free / 2**30)


def check_certificate(host, now):
    try:
        with socket.create_connection((host, 443), timeout=10) as raw, ssl.create_default_context().wrap_socket(raw, server_hostname=host) as tls:
            expires = ssl.cert_time_to_seconds(tls.getpeercert()['notAfter'])
    except Exception as exc:
        return False, type(exc).__name__ + ': ' + str(exc)[:200]
    days = (expires - now) / 86400
    return days >= 14, 'expires in %.0f days' % days


def run(url, state_path, mailer, now=None, checks=None):
    now = now or time.time()
    host = urllib.request.urlparse(url).hostname
    results = checks or {'health': check_health(url), 'service': check_service(), 'backup': check_backup(now),
                         'disk': check_disk(), 'certificate': check_certificate(host, now)}
    try:
        state = json.loads(state_path.read_text())
    except (OSError, ValueError):
        state = {}
    alerts = []
    for name, (ok, detail) in results.items():
        previous = state.get(name, {'ok': True, 'since': now, 'alerted': 0})
        if ok != previous['ok']:
            previous = {'ok': ok, 'since': now, 'alerted': 0}
            alerts.append(('恢复' if ok else '故障', name, detail))
        elif not ok and now - previous['alerted'] >= REMIND:
            alerts.append(('仍未恢复', name, detail))
        if alerts and alerts[-1][1] == name:
            previous['alerted'] = now
        previous['detail'] = detail
        state[name] = previous
    if alerts and mailer.configured and mailer.config.get('alert_to'):
        failing = [n for n, (ok, _) in results.items() if not ok]
        subject = 'ATOM 告警：' + ('、'.join(LABELS[n] for n in failing) + ' 异常' if failing else '全部恢复正常')
        stamp = datetime.fromtimestamp(now, timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')
        lines = ['%s · %s：%s（%s）' % (kind, LABELS[name], '正常' if kind == '恢复' else '异常', detail) for kind, name, detail in alerts]
        lines += ['', '当前状态：'] + ['  %s %s — %s' % ('✓' if ok else '✗', LABELS[n], d) for n, (ok, d) in results.items()]
        lines += ['', '服务器：' + socket.gethostname() + ' · ' + stamp, '处理方法见 atom/connect/server/README.md']
        mailer.send(mailer.config['alert_to'], subject, '\n'.join(lines) + '\n', wait=True)
    tmp = state_path.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False))
    os.replace(tmp, state_path)
    return results, alerts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='https://ldcx.tech/atom/market/v1/health')
    parser.add_argument('--state', default=str(DATA / 'monitor.json'))
    parser.add_argument('--test-mail', action='store_true', help='send one test message to ALERT_TO and exit')
    args = parser.parse_args()
    mailer = Mailer()
    if args.test_mail:
        if not (mailer.configured and mailer.config.get('alert_to')):
            sys.exit('SMTP or ALERT_TO not configured in /etc/atom/smtp.env')
        mailer.send(mailer.config['alert_to'], 'ATOM 告警邮件测试', '这是一封测试邮件：ATOM 服务器可以正常发送告警。\n', wait=True)
        print('test mail sent to', mailer.config['alert_to'])
        return
    results, alerts = run(args.url, Path(args.state), mailer)
    for name, (ok, detail) in results.items():
        print('%-12s %s %s' % (name, 'ok  ' if ok else 'FAIL', detail))
    if alerts and not mailer.configured:
        print('alerts not sent: SMTP not configured', file=sys.stderr)


if __name__ == '__main__':
    main()
