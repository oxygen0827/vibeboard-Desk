import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import e2e

NODE_TWIN = Path(__file__).resolve().parents[1] / 'connect' / 'computer' / 'e2e.mjs'


class E2ETests(unittest.TestCase):
    def test_pair_key_agreement_and_tamper_detection(self):
        device, computer = e2e.new_private_key(), e2e.new_private_key()
        a = e2e.pair_key(device, e2e.public_key(computer), 'dev', 'pc')
        b = e2e.pair_key(computer, e2e.public_key(device), 'dev', 'pc')
        self.assertEqual(a, b)
        self.assertNotEqual(a, e2e.pair_key(device, e2e.public_key(computer), 'dev', 'other-pc'))
        sealed = e2e.seal(a, '任务内容', 'task|t1|prompt')
        self.assertEqual(e2e.open_sealed(b, sealed, 'task|t1|prompt'), '任务内容')
        with self.assertRaises(e2e.E2EError):
            e2e.open_sealed(b, sealed, 'task|t2|prompt')
        broken = dict(sealed, ct=sealed['ct'][:-2] + ('AA' if sealed['ct'][-2:] != 'AA' else 'BB'))
        with self.assertRaises(e2e.E2EError):
            e2e.open_sealed(b, broken, 'task|t1|prompt')
        self.assertRegex(e2e.safety_code(e2e.public_key(device), e2e.public_key(computer)), r'^\d{3} \d{3}$')

    def test_account_keys_password_recovery_and_rewrap(self):
        data_key, code, record = e2e.new_account_keys('long-test-password-a')
        self.assertRegex(code, r'^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$')
        self.assertEqual(e2e.unlock_with_password(record, 'long-test-password-a'), data_key)
        self.assertEqual(e2e.unlock_with_recovery(record, code.lower().replace('-', ' ')), data_key)
        with self.assertRaises(e2e.E2EError):
            e2e.unlock_with_password(record, 'wrong-password-xxx')
        moved = e2e.rewrap_password(record, data_key, 'brand-new-password-a')
        self.assertEqual(e2e.unlock_with_password(moved, 'brand-new-password-a'), data_key)
        self.assertEqual(moved['by_recovery'], record['by_recovery'])

    @unittest.skipUnless(shutil.which('node'), 'node not installed')
    def test_python_and_node_interoperate(self):
        device, computer = e2e.new_private_key(), e2e.new_private_key()
        key = e2e.pair_key(device, e2e.public_key(computer), 'dev', 'pc')
        data_key, code, record = e2e.new_account_keys('long-test-password-a')
        given = dict(computer=computer, device_public=e2e.public_key(device), sealed=e2e.seal(key, '来自小电脑', 'aad'),
                     record=record, code=code)
        script = '''
import * as e from %s;
const g=JSON.parse(process.argv[1]);
const key=e.pairKey(g.computer,g.device_public,'dev','pc');
const acct=e.newAccountKeys('node-password-0001');
console.log(JSON.stringify({opened:e.open(key,g.sealed,'aad'),reply:e.seal(key,'来自电脑','aad'),
  computer_public:e.publicKey(g.computer),safety:e.safetyCode(g.device_public,e.publicKey(g.computer)),
  by_password:e.b64(e.unlockWithPassword(g.record,'long-test-password-a')),by_recovery:e.b64(e.unlockWithRecovery(g.record,g.code)),
  node_record:acct.record,node_code:acct.code,node_key:e.b64(acct.dataKey)}));
''' % json.dumps(NODE_TWIN.as_uri())
        out = subprocess.run(['node', '--input-type=module', '-e', script, json.dumps(given)], capture_output=True, text=True, check=True)
        got = json.loads(out.stdout)
        self.assertEqual(got['opened'], '来自小电脑')
        self.assertEqual(e2e.open_sealed(key, got['reply'], 'aad'), '来自电脑')
        self.assertEqual(got['computer_public'], e2e.public_key(computer))
        self.assertEqual(got['safety'], e2e.safety_code(e2e.public_key(device), e2e.public_key(computer)))
        self.assertEqual(got['by_password'], e2e.b64(data_key))
        self.assertEqual(got['by_recovery'], e2e.b64(data_key))
        self.assertEqual(e2e.b64(e2e.unlock_with_password(got['node_record'], 'node-password-0001')), got['node_key'])
        self.assertEqual(e2e.b64(e2e.unlock_with_recovery(got['node_record'], got['node_code'])), got['node_key'])


if __name__ == '__main__':
    unittest.main()
