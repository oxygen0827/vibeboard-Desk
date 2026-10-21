import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wifi


class WifiRecovery(unittest.TestCase):
    prior = '12345678-1234-1234-1234-123456789abc'

    def test_selecting_connected_network_does_not_reconnect(self):
        with patch.object(wifi, 'networks', return_value=[{'active':True, 'ssid':'current'}]), \
             patch.object(wifi, 'status', return_value={'connected':True}), \
             patch.object(wifi, '_nmcli') as nm:
            self.assertTrue(wifi.connect('current', '')['connected'])
            nm.assert_not_called()

    leftover = 'abcdefab-1234-1234-1234-123456789abc'

    def attempt(self, failure):
        profiles = (0, self.prior+':802-11-wireless\n', '')
        replies = [profiles, profiles, failure, (0, self.prior+':802-11-wireless\n'+self.leftover+':802-11-wireless\n', ''), (0, '', ''), (0, '', '')]
        with patch.object(wifi, 'networks', return_value=[{'active':True, 'ssid':'current'}]), \
             patch.object(wifi, 'status', side_effect=[{'connected':False}, {'connected':True, 'ssid':'current'}]), \
             patch.object(wifi.time, 'sleep'), \
             patch.object(wifi, '_nmcli', side_effect=replies) as nm:
            with self.assertRaisesRegex(wifi.WifiError, '已回到原来的网络「current」'):
                wifi.connect('different', 'test-passphrase')
            calls = [c[0][0] for c in nm.call_args_list]
            self.assertIn(['connection', 'delete', 'uuid', self.leftover], calls, 'the failed profile with the wrong password is removed')
            self.assertNotIn(['connection', 'delete', 'uuid', self.prior], calls)
            self.assertEqual(calls[-1], ['-w','20','connection','up','uuid',self.prior])

    def test_bad_password_recovers_previous_profile(self):
        self.attempt((10, '', 'Secrets were required'))

    def test_previous_network_not_back_says_so(self):
        profiles = (0, self.prior+':802-11-wireless\n', '')
        replies = [profiles, profiles, (10, '', 'Secrets were required'), profiles, (4, '', 'busy')]
        with patch.object(wifi, 'networks', return_value=[{'active':True, 'ssid':'current'}]), \
             patch.object(wifi, 'status', return_value={'connected':False}), \
             patch.object(wifi.time, 'sleep'), patch.object(wifi.time, 'monotonic', side_effect=[0, 0, 100]), \
             patch.object(wifi, '_nmcli', side_effect=replies):
            with self.assertRaisesRegex(wifi.WifiError, '密码不对.*重新选择原来的网络'):
                wifi.connect('different', 'test-passphrase')

    def test_timeout_recovers_previous_profile(self):
        self.attempt(wifi.WifiError('连接超时'))
