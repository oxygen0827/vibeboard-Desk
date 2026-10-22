import importlib.util,unittest,tempfile,json
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('display_guard',Path(__file__).resolve().parents[1]/'deploy/display-guard.py');guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
class DisplayGuardTests(unittest.TestCase):
    def test_missing_plane(self):self.assertTrue(guard.missing_scanout('Video Port1: ACTIVE\n Connector: DSI-1\n'))
    def test_scanout_present(self):self.assertFalse(guard.missing_scanout('Video Port1: ACTIVE\n Connector: DSI-1\n Smart0-win0: ACTIVE\n'))
    def test_inactive_display(self):self.assertFalse(guard.missing_scanout('Video Port1: DISABLED\n Connector: DSI-1\n'))
    def test_blocked_xorg_records_evidence_without_restarting_display(self):
        with tempfile.TemporaryDirectory() as home:
            target=Path(home)/'diagnostics.json'
            with patch.object(guard,'DIAGNOSTICS',target),patch.object(guard,'capture_diagnostics',return_value={'xorg':[{'state':'D'}]}),patch.object(guard,'run') as run:
                self.assertFalse(guard.recover_output('Video Port1: ACTIVE\n Connector: DSI-1\n'))
                run.assert_not_called()
                self.assertEqual(json.loads(target.read_text())['xorg'][0]['state'],'D')
                self.assertEqual(target.stat().st_mode & 0o777,0o600)
    def test_failed_modeset_never_restarts_lightdm(self):
        with tempfile.TemporaryDirectory() as home:
            summary=Path(home)/'summary';summary.write_text('Video Port1: ACTIVE\n Connector: DSI-1\n')
            with patch.object(guard,'DIAGNOSTICS',Path(home)/'evidence.json'),patch.object(guard,'SUMMARY',summary),patch.object(guard,'capture_diagnostics',return_value={'xorg':[]}),patch.object(guard.time,'sleep'),patch.object(guard,'run',return_value=0) as run:
                self.assertFalse(guard.recover_output(summary.read_text()))
                self.assertEqual([c.args[0][0] for c in run.call_args_list],['xrandr','xrandr'])
