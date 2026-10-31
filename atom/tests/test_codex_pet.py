import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import codex_pet

spec = importlib.util.spec_from_file_location('pet_hook', Path(__file__).resolve().parents[1] / 'tools/codex_pet_hook.py')
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


class CodexPetTests(unittest.TestCase):
    def event(self, name='PreToolUse', stamp=1000, turn='one'):
        return dict(hook_event_name=name, session_id='session', turn_id=turn, timestamp=stamp, project='示例项目')

    def test_privacy_boundary(self):
        item = hook.payload(dict(hook_event_name='PermissionRequest', session_id='session', cwd='/secret/path/project', prompt='SECRET', tool_input={'command': 'PASSWORD'}))
        text = json.dumps(item)
        self.assertNotIn('SECRET', text)
        self.assertNotIn('PASSWORD', text)
        self.assertNotIn('/secret', text)
        self.assertEqual(item['project'], 'project')

    def test_mapping_subtask_is_not_parent_completion(self):
        self.assertEqual(codex_pet.normalize(self.event('SubagentStop'), 1000)['status'], 'running')
        self.assertEqual(codex_pet.normalize(self.event('PermissionRequest'), 1000)['detail'], '请在电脑端审批')

    def test_ordering_and_completed_turn_latch(self):
        with tempfile.TemporaryDirectory() as folder:
            codex_pet.receive(folder, self.event('Stop'), 1000)
            codex_pet.receive(folder, self.event(stamp=999), 1001)
            codex_pet.receive(folder, self.event(stamp=1002), 1002)
            self.assertEqual(codex_pet.snapshot(folder, 1002)['tasks'][0]['status'], 'ready')
            codex_pet.receive(folder, self.event('UserPromptSubmit', 1003, 'two'), 1003)
            self.assertEqual(codex_pet.snapshot(folder, 1003)['tasks'][0]['status'], 'running')
            codex_pet.receive(folder, self.event('Stop', 1004, 'one'), 1004)
            self.assertEqual(codex_pet.snapshot(folder, 1004)['tasks'][0]['status'], 'running')

    def test_corrupt_state_retained_and_expiration(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'codex-pet-desktop.json'
            path.write_text('broken')
            with self.assertRaises(ValueError):
                codex_pet.receive(folder, self.event(), 1000)
            self.assertEqual(path.read_text(), 'broken')
            path.unlink()
            codex_pet.receive(folder, self.event(), 1000)
            self.assertEqual(codex_pet.snapshot(folder, 1000+7201)['tasks'], [])

    def test_bound_and_no_raw_session_or_private_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            for i in range(15):
                event = self.event(stamp=1000+i)
                event['session_id'] = 'private-session-' + str(i)
                event['prompt'] = 'secret'
                codex_pet.receive(folder, event, 1000+i)
            text = (Path(folder) / 'codex-pet-desktop.json').read_text()
            self.assertNotIn('private-session-', text)
            self.assertNotIn('secret', text)
            self.assertEqual(len(codex_pet.snapshot(folder, 1015)['tasks']), 10)
            self.assertEqual((Path(folder) / 'codex-pet-desktop.json').stat().st_mode & 0o777, 0o600)

    def test_future_or_stale_events_rejected(self):
        for stamp in (9000, -9000, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                codex_pet.normalize(self.event(stamp=stamp), 1000)
