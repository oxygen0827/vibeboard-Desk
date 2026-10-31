import json
import secrets
import time
import unittest
from test_marketplace import MarketplaceTests, bundle, m


class CommunityTests(unittest.TestCase):
    setUp = MarketplaceTests.setUp
    tearDown = MarketplaceTests.tearDown
    call = MarketplaceTests.call
    denied = MarketplaceTests.denied
    draft = MarketplaceTests.draft
    publish = MarketplaceTests.publish

    def action(self, who, name, **data):
        data.setdefault('request_id', secrets.token_hex(16))
        return self.call('/community/' + name, data, who)

    def suggestion(self):
        original = self.draft()
        published = self.publish(original)
        fork = self.action(self.b, 'copy', version_id=published['version']['id'])['draft']
        copy = self.call('/drafts/' + fork['id'], who=self.b)['bundle']
        copy['files']['logic.js'] = 'console.log("improved");'
        saved = self.action(self.b, 'save', draft_id=fork['id'], revision=fork['revision'], bundle=copy)['draft']
        suggestion = self.action(self.b, 'suggest', draft_id=saved['id'], revision=saved['revision'], summary='改善交互', confirm=True)['suggestion']
        return original, published, suggestion

    def test_copy_idempotency_and_private_scope(self):
        published = self.publish(self.draft())
        key = secrets.token_hex(16)
        a = self.action(self.b, 'copy', version_id=published['version']['id'], request_id=key)
        b = self.action(self.b, 'copy', version_id=published['version']['id'], request_id=key)
        self.assertEqual(a, b)
        self.assertEqual(len(self.call('/drafts', who=self.b)['drafts']), 1)
        self.denied(404, lambda: self.call('/drafts/' + a['draft']['id'], who=self.a))
        self.denied(409, lambda: self.action(self.b, 'copy', version_id='other', request_id=key))

    def test_author_reviews_immutable_suggestion_then_publishes_separately(self):
        original, published, suggestion = self.suggestion()
        info = self.action(self.a, 'suggestion', id=suggestion['id'])
        self.assertTrue(info['can_review'])
        self.assertEqual(info['changed_files'], ['logic.js'])
        self.denied(403, lambda: self.action(self.b, 'review', id=suggestion['id'], decision='accept', confirm=True, head_version_id=info['head_version_id']))
        result = self.action(self.a, 'review', id=suggestion['id'], decision='accept', confirm=True, head_version_id=info['head_version_id'])
        draft = self.call('/drafts/' + result['suggestion']['review_draft_id'], who=self.a)
        self.assertEqual(self.call('/works/' + published['work']['id'])['work']['latest_version_id'], published['version']['id'])
        self.assertEqual(self.call('/drafts/' + original['id'], who=self.a)['bundle']['files']['logic.js'], 'console.log("Hello");')
        next_version = self.publish(draft['draft'])
        self.assertEqual(next_version['work']['id'], published['work']['id'])
        self.assertEqual(next_version['work']['contributors'], ['bobby'])
        self.assertEqual(draft['bundle']['manifest']['id'], 'my-sample')
        stale = self.call('/drafts/' + original['id'], who=self.a)['draft']
        self.denied(409, lambda: self.publish(stale))
        self.denied(409, lambda: self.action(self.a, 'review', id=suggestion['id'], decision='decline', confirm=True))

    def test_stale_review_and_concurrent_edit_do_not_overwrite(self):
        original, published, suggestion = self.suggestion()
        current = self.call('/drafts/' + original['id'], who=self.a)
        current['bundle']['files']['logic.js'] = 'changed by author'
        changed = self.call('/drafts/' + original['id'] + '/save', dict(revision=current['draft']['revision'], bundle=current['bundle']), self.a)['draft']
        latest = self.publish(changed)
        self.denied(409, lambda: self.action(self.a, 'review', id=suggestion['id'], decision='accept', confirm=True, head_version_id=published['version']['id']))
        error = self.denied(409, lambda: self.action(self.a, 'review', id=suggestion['id'], decision='accept', confirm=True, head_version_id=latest['version']['id']))
        self.assertEqual(error.code, 'merge_conflict')
        self.assertEqual(self.action(self.a, 'suggestion', id=suggestion['id'])['suggestion']['status'], 'open')

    def test_undo_keeps_revision_monotonic_and_license_checks(self):
        draft = self.draft()
        changed = bundle(); changed['files']['logic.js'] = 'changed'
        saved = self.action(self.a, 'save', draft_id=draft['id'], revision=draft['revision'], bundle=changed)['draft']
        restored = self.action(self.a, 'undo', draft_id=draft['id'], revision=saved['revision'])['draft']
        self.assertGreater(restored['revision'], saved['revision'])
        self.assertEqual(self.call('/drafts/' + draft['id'], who=self.a)['bundle'], bundle())
        self.denied(400, lambda: self.action(self.a, 'publish', draft_id=draft['id'], revision=restored['revision'], confirm=True, changelog='publish'))

    def test_generation_preserves_resources_and_enforces_revision(self):
        class FakeAI:
            def submit(self, user, body):
                self.messages = body['messages']
                return {'job_id': 'test'}
            def result(self, user, job):
                return {'status': 'completed', 'result': {'choices': [{'message': {'content': json.dumps({'files': {'logic.js': 'AI improved'}})}}]}}
        ai = FakeAI(); self.market.community.ai = ai
        draft = self.draft()
        job = self.action(self.a, 'generate', draft_id=draft['id'], revision=draft['revision'], prompt='改进逻辑')['job']
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            state = self.action(self.a, 'job', id=job['id'])['job']
            if state['status'] not in ('queued', 'generating'):
                break
            time.sleep(.05)
        self.assertEqual(state['status'], 'completed', state)
        value = self.call('/drafts/' + draft['id'], who=self.a)['bundle']
        self.assertEqual(value['files']['logic.js'], 'AI improved')
        self.assertEqual(value['files']['LICENSE'], bundle()['files']['LICENSE'])
        self.assertIn('five-way', ai.messages[0]['content'])
        self.denied(404, lambda: self.action(self.b, 'job', id=job['id']))

    def test_patch_cannot_drop_hidden_resources_or_change_id(self):
        from creation_prompt import apply_changes
        source = bundle(); source['files']['large.js'] = 'a' * 40000
        changed = apply_changes(source, '{"files":{"logic.js":"new"}}')
        self.assertEqual(changed['files']['large.js'], source['files']['large.js'])
        for value in ['{"delete":["large.js"]}', '{"manifest":{"id":"other"}}']:
            with self.assertRaises(ValueError):
                apply_changes(source, value)

    def test_install_aliases_are_proved_by_same_account_ownership(self):
        draft = self.draft()
        published = self.publish(draft)
        mine = self.action(self.a, 'installation', version_id=published['version']['id'])
        other = self.action(self.b, 'installation', version_id=published['version']['id'])
        self.assertEqual(other['install_aliases'], [])
        self.assertIn('work:' + published['work']['id'], mine['install_aliases'])
        self.assertTrue(any(alias.endswith(':' + draft['id']) for alias in mine['install_aliases']))
        self.denied(404, lambda: self.action(self.b, 'installation', draft_id=draft['id']))

    def test_workshop_export_is_new_id_and_retries_reuse_draft(self):
        request = dict(title='工作坊副本', bundle=bundle(), request_id='workshop-fixture')
        first = self.action(self.a, 'create', **request)
        self.assertEqual(first, self.action(self.a, 'create', **request))
        saved = self.call('/drafts/' + first['draft']['id'], who=self.a)
        self.assertNotEqual(saved['bundle']['manifest']['id'], bundle()['manifest']['id'])

    def test_unfinished_starter_cannot_be_installed_or_published(self):
        draft = self.action(self.a, 'create', title='等待生成')['draft']
        self.assertTrue(draft['creation_pending'])
        self.denied(400, lambda: self.action(self.a, 'installation', draft_id=draft['id']))
        self.denied(400, lambda: self.publish(draft))


del MarketplaceTests

if __name__ == '__main__':
    unittest.main()
