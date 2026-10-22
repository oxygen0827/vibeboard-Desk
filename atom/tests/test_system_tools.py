import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bluetooth
import system_tools


def fake(table):
    """Map a command prefix to (returncode, stdout, stderr); record the calls."""
    calls = []
    def run(args, **kw):
        calls.append(args)
        for prefix, result in table:
            if args[:len(prefix)] == prefix:
                code, out, err = result(args) if callable(result) else result
                return subprocess.CompletedProcess(args, code, out.encode(), err.encode())
        return subprocess.CompletedProcess(args, 0, b'', b'')
    return run, calls


TIME = (0, 'Timezone=Asia/Shanghai\nNTP=no\nNTPSynchronized=no\n', '')
UNITS = (0, 'systemd-timesyncd.service disabled\n', '')
ZONES = (0, 'Asia/Shanghai\nEurope/Berlin\nUTC\n', '')


class SystemToolTests(unittest.TestCase):
    def test_time_status_and_changes(self):
        run, calls = fake([(['timedatectl', 'show'], TIME), (['systemctl', 'list-unit-files'], UNITS), (['timedatectl', 'list-timezones'], ZONES)])
        with mock.patch('subprocess.run', run):
            s = system_tools.time_status()
            self.assertEqual((s['timezone'], s['automatic'], s['automatic_available']), ('Asia/Shanghai', False, True))
            system_tools.set_timezone('Europe/Berlin')
            self.assertIn(['timedatectl', 'set-timezone', 'Europe/Berlin'], calls)
            for bad in ('../etc/passwd', 'Mars/Base', '', 5):
                with self.assertRaises(system_tools.SystemError_):
                    system_tools.set_timezone(bad)
            system_tools.set_automatic(True)
            self.assertIn(['timedatectl', 'set-ntp', 'true'], calls)

    def test_missing_grant_is_explained(self):
        run, _ = fake([(['systemctl', 'reboot'], (1, '', 'Failed to reboot system via logind: Interactive authentication required.\nAccess denied')),
                       (['timedatectl', 'set-ntp'], (1, '', 'Failed to set ntp: NTP not supported'))])
        with mock.patch('subprocess.run', run):
            with self.assertRaisesRegex(system_tools.SystemError_, 'atom-system'):
                system_tools.power('reboot')
            with self.assertRaisesRegex(system_tools.SystemError_, 'timesyncd'):
                system_tools.set_automatic(True)
            with self.assertRaisesRegex(system_tools.SystemError_, '不支持'):
                system_tools.power('halt')


SHOW = (0, 'Controller 11:22:33:44:55:66 (public)\n\tName: taishan-gray\n\tPowered: yes\n', '')
DEVICES = (0, 'Device AA:BB:CC:DD:EE:01 Speaker\nDevice AA:BB:CC:DD:EE:02 Keyboard K3\nDevice AA:BB:CC:DD:EE:03 6A-7B-8C-9D-0E-1F\n', '')


def info(args):
    mac = args[2]
    extra = {'AA:BB:CC:DD:EE:01': '\tAlias: Speaker\n\tIcon: audio-card\n\tPaired: yes\n\tConnected: yes\n',
             'AA:BB:CC:DD:EE:02': '\tAlias: Keyboard K3\n\tIcon: input-keyboard\n\tPaired: no\n\tConnected: no\n',
             'AA:BB:CC:DD:EE:03': '\tAlias: 6A-7B-8C-9D-0E-1F\n\tPaired: no\n\tConnected: no\n'}[mac]
    return 0, 'Device %s (public)\n%s' % (mac, extra), ''


class BluetoothTests(unittest.TestCase):
    def test_lists_named_devices_connected_first(self):
        run, _ = fake([(['bluetoothctl', 'show'], SHOW), (['bluetoothctl', 'devices'], DEVICES), (['bluetoothctl', 'info'], info)])
        with mock.patch('subprocess.run', run):
            self.assertEqual(bluetooth.status(), dict(available=True, powered=True))
            devices = bluetooth.devices()
        self.assertEqual([(d['name'], d['kind'], d['connected'], d['paired']) for d in devices],
                         [('Speaker', 'audio', True, True), ('Keyboard K3', 'keyboard', False, False)])

    def test_connect_pairs_trusts_and_connects(self):
        run, calls = fake([(['bluetoothctl', 'show'], SHOW), (['bluetoothctl', 'devices'], DEVICES), (['bluetoothctl', 'info'], info),
                           (['bluetoothctl', '--agent', 'DisplayYesNo', 'pair'], (0, 'Attempting to pair with AA:BB:CC:DD:EE:02\nPairing successful\n', '')),
                           (['bluetoothctl', 'connect'], (0, 'Connection successful\n', ''))])
        with mock.patch('subprocess.run', run):
            bluetooth.connect('aa:bb:cc:dd:ee:02')
        names = [c[-2] for c in calls if c[0] == 'bluetoothctl' and c[-2] in ('pair', 'trust', 'connect')]
        self.assertEqual(names, ['pair', 'trust', 'connect'])

    def test_exit_zero_does_not_mean_bluetooth_succeeded(self):
        run, _ = fake([(['bluetoothctl', 'power'], (0, 'Failed to set power: org.bluez.Error.Failed', '')),
                       (['bluetoothctl', 'disconnect'], (0, 'Failed to disconnect', '')),
                       (['bluetoothctl', 'remove'], (0, 'Failed to remove device', ''))])
        with mock.patch('subprocess.run', run):
            for action in (lambda: bluetooth.power(False), lambda: bluetooth.disconnect('AA:BB:CC:DD:EE:01'),
                           lambda: bluetooth.forget('AA:BB:CC:DD:EE:01')):
                with self.assertRaises(bluetooth.BluetoothError): action()

    def test_failures_and_validation(self):
        run, _ = fake([(['bluetoothctl', 'info'], info), (['bluetoothctl', '--agent', 'DisplayYesNo', 'pair'], (1, 'Failed to pair: org.bluez.Error.AuthenticationFailed\n', '')),
                       (['bluetoothctl', 'show'], (1, 'No default controller available\n', ''))])
        with mock.patch('subprocess.run', run):
            with self.assertRaisesRegex(bluetooth.BluetoothError, '配对码'):
                bluetooth.connect('AA:BB:CC:DD:EE:02')
            with self.assertRaisesRegex(bluetooth.BluetoothError, '没有找到蓝牙硬件'):
                bluetooth.status()
            with self.assertRaisesRegex(bluetooth.BluetoothError, '地址无效'):
                bluetooth.forget('AA:BB; reboot')
        denied, _ = fake([(['bluetoothctl'], (1, '', 'org.freedesktop.DBus.Error.AccessDenied'))])
        with mock.patch('subprocess.run', denied):
            with self.assertRaisesRegex(bluetooth.BluetoothError, 'bluetooth 组'):
                bluetooth.status()


if __name__ == '__main__':
    unittest.main()
