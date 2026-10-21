"""Power and date/time for Settings, through systemd (systemctl, timedatectl).

The service runs as the desktop user outside a login session, so these actions need the polkit grant
in deploy/atom-system.pkla (reboot, power off, time zone and automatic time only).
"""
import re
import subprocess
from datetime import datetime

# Shown first in Settings; any zone that timedatectl knows is accepted.
COMMON_ZONES = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London',
                'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC']
ZONE = re.compile(r'^[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+){0,2}$')


class SystemError_(Exception):
    """Safe to show the person as is."""


def _run(args, timeout=20):
    try:
        done = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                              env={'LC_ALL': 'C.UTF-8', 'LANG': 'C.UTF-8', 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'})
    except FileNotFoundError:
        raise SystemError_('这台设备缺少系统工具 ' + args[0])
    except subprocess.TimeoutExpired:
        raise SystemError_('系统没有及时响应，请稍后重试')
    return done.returncode, done.stdout.decode('utf-8', 'replace'), done.stderr.decode('utf-8', 'replace')


def _denied(err):
    return 'authoriz' in err.lower() or 'access denied' in err.lower() or 'not authorized' in err.lower()


def power(action):
    if action not in ('reboot', 'poweroff'):
        raise SystemError_('不支持的电源操作')
    code, _, err = _run(['systemctl', action, '--no-wall'])
    if code != 0:
        raise SystemError_('没有重启/关机权限，需要管理员安装 atom-system 授权' if _denied(err) else '系统没有执行这个操作，请稍后重试')
    return dict(ok=True, action=action)


def time_status():
    code, out, _ = _run(['timedatectl', 'show'], timeout=10)
    values = dict(line.split('=', 1) for line in out.splitlines() if '=' in line) if code == 0 else {}
    zone = values.get('Timezone', '')
    _, units, _ = _run(['systemctl', 'list-unit-files', 'systemd-timesyncd.service', '--no-legend'], timeout=10)
    return dict(now=datetime.now().astimezone().isoformat(timespec='seconds'), timezone=zone,
                automatic=values.get('NTP') == 'yes', synchronized=values.get('NTPSynchronized') == 'yes',
                automatic_available='systemd-timesyncd' in units, zones=COMMON_ZONES if zone in COMMON_ZONES or not zone else [zone] + COMMON_ZONES)


def set_timezone(zone):
    if not isinstance(zone, str) or not ZONE.fullmatch(zone):
        raise SystemError_('时区无效')
    code, out, _ = _run(['timedatectl', 'list-timezones'], timeout=10)
    if code == 0 and zone not in out.split():
        raise SystemError_('系统不认识这个时区')
    code, _, err = _run(['timedatectl', 'set-timezone', zone])
    if code != 0:
        raise SystemError_('没有修改时区的权限，需要管理员安装 atom-system 授权' if _denied(err) else '时区没有修改成功')
    return time_status()


def set_automatic(enabled):
    if type(enabled) is not bool:
        raise SystemError_('请选择是否自动校时')
    code, _, err = _run(['timedatectl', 'set-ntp', 'true' if enabled else 'false'])
    if code != 0:
        if _denied(err):
            raise SystemError_('没有修改自动校时的权限，需要管理员安装 atom-system 授权')
        raise SystemError_('这台设备没有安装自动校时服务（systemd-timesyncd）' if 'NTP not supported' in err else '自动校时没有设置成功')
    return time_status()
