import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('atom_monitor', Path(__file__).with_name('monitor.py'))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'monitor.json'
        self.sent = []
        self.mailer = monitor.Mailer({'host': 'smtp.test', 'port': 465, 'user': 'u', 'password': 'p', 'sender': 'noreply@atom.test', 'alert_to': 'ops@atom.test'},
                                     transport=self.sent.append)

    def tearDown(self):
        self.tmp.cleanup()

    def step(self, now, **failing):
        checks = {name: (name not in failing, failing.get(name, 'fine')) for name in monitor.LABELS}
        return monitor.run('https://example.test/health', self.state, self.mailer, now=now, checks=checks)[1]

    def test_alerts_on_change_reminds_daily_and_reports_recovery(self):
        self.assertEqual(self.step(1000), [])
        self.assertEqual(self.sent, [], 'healthy start sends nothing')
        self.assertEqual([a[:2] for a in self.step(1300, service='inactive')], [('故障', 'service')])
        self.assertIn('atom-connect 服务', self.sent[-1]['Subject'])
        self.assertEqual(self.sent[-1]['To'], 'ops@atom.test')
        self.assertEqual(self.step(1600, service='inactive'), [], 'no repeat within a day')
        self.assertEqual([a[:2] for a in self.step(1300 + 86400, service='inactive')], [('仍未恢复', 'service')])
        self.assertEqual([a[:2] for a in self.step(1300 + 86700)], [('恢复', 'service')])
        self.assertIn('全部恢复正常', self.sent[-1]['Subject'])
        self.assertEqual(len(self.sent), 3)

    def test_without_mail_configuration_checks_still_record_state(self):
        self.mailer = monitor.Mailer({})
        self.assertEqual([a[:2] for a in self.step(1000, disk='3% free')], [('故障', 'disk')])
        self.assertIn('disk', self.state.read_text())


if __name__ == '__main__':
    unittest.main()
