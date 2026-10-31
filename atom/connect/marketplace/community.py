"""Source collaboration: private copies, immutable suggestions and reviewed adoption.

All database operations run under Marketplace.lock and its transaction. Model requests
run outside that lock; only validated, revision-matched results can change a draft.
"""
import copy
import hashlib
import json
import re
import secrets
import threading

from app_input import validate_input_bundle


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


class Community:
    def __init__(self, market, error, validate, scan):
        self.m, self.Error, self.validate, self.scan = market, error, validate, scan
        self.ai = None
        self.closed = threading.Event()
        self.workers = set()
        market.db.executescript('''
        CREATE TABLE IF NOT EXISTS community_requests(user TEXT,key TEXT,digest TEXT,result TEXT,PRIMARY KEY(user,key));
        CREATE TABLE IF NOT EXISTS suggestions(id TEXT PRIMARY KEY,user TEXT,owner TEXT,data TEXT,bundle TEXT);
        CREATE TABLE IF NOT EXISTS creation_jobs(id TEXT PRIMARY KEY,user TEXT,data TEXT);
        CREATE INDEX IF NOT EXISTS suggestions_owner ON suggestions(owner);
        CREATE INDEX IF NOT EXISTS creation_jobs_user ON creation_jobs(user);
        CREATE TABLE IF NOT EXISTS draft_history(id TEXT PRIMARY KEY,draft TEXT,user TEXT,data TEXT,bundle TEXT);
        ''')
        with market.db:
            for row in market.rows('SELECT * FROM creation_jobs'):
                job = json.loads(row['data'])
                if job['status'] in ('queued', 'generating'):
                    job.update(status='interrupted', error='服务已重启，原稿保留；请重新发起修改。')
                    market.db.execute('UPDATE creation_jobs SET data=? WHERE id=?', (packed(job), row['id']))

    def require(self, condition, message, status=400, code='invalid_request'):
        if not condition:
            raise self.Error(status, message, code)

    def ident(self, value):
        self.require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value), '标识无效')
        return value

    def string(self, data, key, limit, optional=False):
        value = data.get(key, '')
        self.require(isinstance(value, str) and len(value) <= limit and (optional or value.strip()), '请填写有效的' + key)
        return value.strip()

    def handle(self, action, user, body):
        body = dict(body)
        methods = {'suggestions': self.suggestions, 'suggestion': self.suggestion,
                   'suggest': self.suggest, 'review': self.review, 'generate': self.generate,
                   'jobs': self.jobs, 'job': self.job, 'undo': self.undo,
                   'copy': self.copy, 'create': self.create, 'save': self.save, 'publish': self.publish, 'cover': self.cover,
                   'installation': self.installation}
        self.require(action in methods, '未知创作操作', 404)
        if action in ('suggestions', 'suggestion', 'jobs', 'job', 'installation'):
            return methods[action](user, body)
        key = self.ident(body.get('request_id'))
        digest = hashlib.sha256((action + packed(body)).encode()).hexdigest()
        old = self.m.row('SELECT * FROM community_requests WHERE user=? AND key=?', (user['id'], key))
        if old:
            self.require(old['digest'] == digest, '这次操作内容已改变，请重新提交', 409)
            return json.loads(old['result'])
        self.require(self.m.row('SELECT COUNT(*) n FROM community_requests WHERE user=?', (user['id'],))['n'] < 5000, '操作记录已达上限，请联系管理员', 409)
        result = methods[action](user, body)
        self.m.db.execute('INSERT INTO community_requests VALUES(?,?,?,?)', (user['id'], key, digest, packed(result)))
        return result

    def copy(self, user, body):
        return self.m._handle('POST', '/market/v1/forks', '', body, 'community', trusted_user=user)

    def create(self, user, body):
        from creation_prompt import starter
        title = self.string(body, 'title', 80)
        bundle = self.validate(body['bundle']) if 'bundle' in body else starter(title)
        # Export is a new private copy, never ownership of an existing desktop app.
        if 'bundle' in body:
            bundle['manifest']['id'] = 'creation-' + secrets.token_hex(10)
        draft = self.m.new_draft(user, dict(title=title, description=self.string(body, 'description', 500, True),
                                          category=body.get('category', 'play'), license='MIT'), bundle)
        if 'bundle' not in body:
            draft['creation_pending'] = True
            self.m.db.execute('UPDATE drafts SET data=? WHERE id=?', (packed(draft), draft['id']))
        return {'draft': draft}

    def installation(self, user, body):
        self.require(bool(body.get('draft_id')) != bool(body.get('version_id')), '请选择一个草稿或公开版本')
        if body.get('draft_id'):
            row, draft = self.m.own_draft(self.ident(body['draft_id']), user)
            self.require(not draft.get('creation_pending'), '先完成创作，再添加到桌面')
            source = {'draft': draft, 'bundle': json.loads(row['bundle'])}
            work_id = draft.get('work_id')
        else:
            source = self.m.version(self.ident(body['version_id']))
            work_id = source['version']['work_id']
        aliases = []
        work = self.m.row('SELECT user FROM works WHERE id=?', (work_id,)) if work_id else None
        if work and work['user'] == user['id']:
            aliases.append('work:' + work_id)
            for row in self.m.rows('SELECT id,data FROM drafts WHERE user=?', (user['id'],)):
                if json.loads(row['data']).get('work_id') == work_id:
                    aliases.append('draft:' + user['id'] + ':' + row['id'])
        source['install_aliases'] = aliases
        return source

    def draft_action(self, user, body, action):
        # The enclosing request already authenticated this account. Preserve the regular
        # API's validation and conflict behavior without inventing a second save contract.
        return self.m._handle('POST', '/market/v1/drafts/' + self.ident(body.get('draft_id')) + '/' + action, '', body, 'community', trusted_user=user)

    def save(self, user, body):
        row, draft = self.m.own_draft(self.ident(body.get('draft_id')), user)
        self.remember(user, draft, json.loads(row['bundle']), '保存之前')
        return self.draft_action(user, body, 'save')

    def publish(self, user, body):
        if 'title' in body or 'description' in body:
            row, draft = self.m.own_draft(self.ident(body.get('draft_id')), user)
            saved = self.draft_action(user, dict(body, bundle=json.loads(row['bundle'])), 'save')
            body['revision'] = saved['draft']['revision']
        body['require_cover'] = True
        return self.draft_action(user, body, 'publish')

    def cover(self, user, body):
        return self.draft_action(user, body, 'cover')

    def remember(self, user, draft, bundle, label):
        self.m.db.execute('INSERT INTO draft_history VALUES(?,?,?,?,?)', (secrets.token_hex(16), draft['id'], user['id'], packed(dict(draft=draft, label=label)), packed(bundle)))
        self.m.db.execute('DELETE FROM draft_history WHERE draft=? AND id NOT IN (SELECT id FROM draft_history WHERE draft=? ORDER BY rowid DESC LIMIT 5)', (draft['id'], draft['id']))

    def undo(self, user, body):
        row, draft = self.m.own_draft(self.ident(body.get('draft_id')), user)
        self.require(body.get('revision') == draft['revision'], '草稿已改变，请重新打开', 409)
        old = self.m.row('SELECT * FROM draft_history WHERE draft=? AND user=? ORDER BY rowid DESC LIMIT 1', (draft['id'], user['id']))
        self.require(old, '没有可撤回的修改', 404)
        draft.update(revision=draft['revision'] + 1, updated_at=self.m.clock())
        self.m.db.execute('UPDATE drafts SET data=?,bundle=? WHERE id=?', (packed(draft), old['bundle'], draft['id']))
        self.m.db.execute('DELETE FROM draft_history WHERE id=?', (old['id'],))
        return {'draft': draft}

    def suggestions(self, user, body):
        rows = self.m.rows('SELECT data FROM suggestions WHERE user=? OR owner=? ORDER BY rowid DESC LIMIT 100', (user['id'], user['id']))
        return {'suggestions': [json.loads(r['data']) for r in rows]}

    def own_suggestion(self, user, body):
        row = self.m.row('SELECT * FROM suggestions WHERE id=? AND (user=? OR owner=?)', (self.ident(body.get('id')), user['id'], user['id']))
        self.require(row, '改进建议不存在', 404)
        return row, json.loads(row['data'])

    def suggestion(self, user, body):
        row, item = self.own_suggestion(user, body)
        base = self.m.version(item['base_version_id'])['bundle']
        candidate = json.loads(row['bundle'])
        changes = [name for name in sorted(set(base['files']) | set(candidate['files'])) if base['files'].get(name) != candidate['files'].get(name)]
        work = json.loads(self.m.row('SELECT data FROM works WHERE id=?', (item['work_id'],))['data'])
        return {'suggestion': item, 'bundle': candidate, 'base_bundle': base, 'changed_files': changes, 'head_version_id': work['latest_version_id'], 'can_review': row['owner'] == user['id']}

    def suggest(self, user, body):
        row, draft = self.m.own_draft(self.ident(body.get('draft_id')), user)
        self.require(body.get('confirm') is True, '请确认将这份源码交给原作者审阅')
        self.require(body.get('revision') == draft['revision'], '草稿已改变，请重新打开', 409)
        self.require(draft.get('parent_version_id'), '这个作品没有可提交改进的原作')
        work = self.m.row('SELECT * FROM works WHERE id=?', (draft['parent_id'],))
        self.require(work and work['user'] != user['id'] and work['user'] != 'official', '该原作暂不接收账号内改进建议')
        self.require(self.m.row('SELECT COUNT(*) n FROM suggestions WHERE user=?', (user['id'],))['n'] < 100, '改进建议已达上限', 409)
        bundle = self.validate(json.loads(row['bundle']))
        self.m.check_parent_license(draft, bundle)
        self.scan(bundle)
        try:
            validate_input_bundle(bundle)
        except ValueError as exc:
            raise self.Error(400, str(exc))
        base = self.m.version(draft['parent_version_id'])['bundle']
        bundle['manifest']['id'] = base['manifest']['id']
        # A copy's display name is not an unsolicited rename of the original app.
        bundle['manifest']['name'] = base['manifest']['name']
        self.require(bundle != base, '还没有修改，先做一点改进再提交')
        item = dict(id=secrets.token_hex(16), work_id=draft['parent_id'], base_version_id=draft['parent_version_id'],
                    title=draft['title'], author=user['username'], owner=json.loads(work['data'])['author'],
                    summary=self.string(body, 'summary', 500), status='open', created_at=self.m.clock())
        self.m.db.execute('INSERT INTO suggestions VALUES(?,?,?,?,?)', (item['id'], user['id'], work['user'], packed(item), packed(bundle)))
        return {'suggestion': item}

    def merge(self, base, current, proposed):
        result = copy.deepcopy(current)
        # File-level three-way merge. Concurrent changes to the same file need a person.
        for group in ('manifest', 'files'):
            for name in set(base[group]) | set(proposed[group]):
                before, after = base[group].get(name), proposed[group].get(name)
                if before == after:
                    continue
                self.require(current[group].get(name) in (before, after), '原作也修改了 ' + name + '，请先调整建议后重新提交', 409, 'merge_conflict')
                if name in proposed[group]:
                    result[group][name] = after
                else:
                    result[group].pop(name, None)
        return result

    def review(self, user, body):
        row, item = self.own_suggestion(user, body)
        self.require(row['owner'] == user['id'], '只有原作者可以处理建议', 403)
        self.require(item['status'] == 'open', '建议已经处理', 409)
        self.require(body.get('decision') in ('accept', 'decline') and body.get('confirm') is True, '请明确选择采用或暂不采用')
        if body['decision'] == 'accept':
            work = json.loads(self.m.row('SELECT data FROM works WHERE id=?', (item['work_id'],))['data'])
            self.require(body.get('head_version_id') == work['latest_version_id'], '原作已有更新，请重新预览再采用', 409)
            base = self.m.version(item['base_version_id'])['bundle']
            current = self.m.version(work['latest_version_id'])
            merged = self.validate(self.merge(base, current['bundle'], json.loads(row['bundle'])))
            self.scan(merged)
            validate_input_bundle(merged)
            # Separate review draft: never overwrite the author's existing unpublished work.
            draft = self.m.new_draft(user, work, merged)
            draft.update(work_id=work['id'], parent_id=work.get('parent_id'), parent_version_id=work.get('parent_version_id'),
                         attribution=work.get('attribution'), cover_id=work.get('cover_id'),
                         contributors=list(dict.fromkeys((work.get('contributors') or []) + [item['author']])),
                         expected_head=work['latest_version_id'])
            self.m.check_parent_license(draft, merged)
            self.m.db.execute('UPDATE drafts SET data=? WHERE id=?', (packed(draft), draft['id']))
            item.update(status='accepted', review_draft_id=draft['id'])
        else:
            item['status'] = 'declined'
        item.update(reviewed_at=self.m.clock(), response=self.string(body, 'response', 500, True))
        self.m.db.execute('UPDATE suggestions SET data=? WHERE id=?', (packed(item), item['id']))
        return {'suggestion': item}

    def jobs(self, user, body):
        return {'jobs': [json.loads(r['data']) for r in self.m.rows('SELECT data FROM creation_jobs WHERE user=? ORDER BY rowid DESC LIMIT 30', (user['id'],))]}

    def job(self, user, body):
        row = self.m.row('SELECT data FROM creation_jobs WHERE id=? AND user=?', (self.ident(body.get('id')), user['id']))
        self.require(row, '任务不存在', 404)
        return {'job': json.loads(row['data'])}

    def generate(self, user, body):
        self.require(self.ai is not None, '官方创作服务尚未配置', 503)
        prompt = self.string(body, 'prompt', 4000)
        row, draft = self.m.own_draft(self.ident(body.get('draft_id')), user)
        self.require(body.get('revision') == draft['revision'], '草稿已改变，请重新打开', 409)
        self.require(len(self.workers) < 8 and not any(j['draft_id'] == draft['id'] and j['status'] in ('queued', 'generating') for j in self.jobs(user, {})['jobs']), '已有修改任务，请等待完成', 409)
        bundle = json.loads(row['bundle'])
        job = dict(id=secrets.token_hex(16), draft_id=draft['id'], revision=draft['revision'], status='queued', created_at=self.m.clock())
        self.m.db.execute('INSERT INTO creation_jobs VALUES(?,?,?)', (job['id'], user['id'], packed(job)))
        worker = threading.Thread(target=self.generate_worker, args=(dict(user), job, bundle, prompt), daemon=True)
        self.workers.add(worker)
        try:
            worker.start()
        except RuntimeError:
            self.workers.discard(worker)
            raise self.Error(503, '生成暂时无法启动，请重试')
        return {'job': job}

    def generate_worker(self, user, job, bundle, prompt):
        try:
            from creation_prompt import messages, apply_changes
            with self.m.lock, self.m.db:
                job['status'] = 'generating'
                self.store_job(job)
            submitted = self.ai.submit(user['id'], {'purpose': 'generate', 'messages': messages(bundle, prompt), 'json': True, 'max_tokens': 8000})
            for _ in range(180):
                if self.closed.wait(2):
                    return
                answer = self.ai.result(user['id'], submitted['job_id'])
                if answer['status'] != 'running':
                    break
            self.require(answer['status'] == 'completed', answer.get('error') or '生成未能完成，请重试', 503)
            value = answer['result']['choices'][0]['message']['content']
            candidate = self.validate(apply_changes(bundle, value))
            validate_input_bundle(candidate)
            self.scan(candidate)
            with self.m.lock, self.m.db:
                if self.closed.is_set():
                    return
                row, current = self.m.own_draft(job['draft_id'], user)
                self.require(current['revision'] == job['revision'], '生成期间草稿已有修改，未覆盖；请按新版本重新修改', 409)
                self.m.check_parent_license(current, candidate)
                self.remember(user, current, json.loads(row['bundle']), 'AI 修改之前')
                current.update(revision=current['revision'] + 1, updated_at=self.m.clock(), creation_pending=False)
                self.m.db.execute('UPDATE drafts SET data=?,bundle=? WHERE id=?', (packed(current), packed(candidate), current['id']))
                job.update(status='completed', result_revision=current['revision'])
                self.store_job(job)
        except Exception as exc:
            with self.m.lock:
                if self.closed.is_set():
                    return
                with self.m.db:
                    job.update(status='failed', error=exc.message if isinstance(exc, self.Error) else '生成结果未通过检查，原稿保留，请重试或缩小修改要求。')
                    self.store_job(job)
        finally:
            with self.m.lock:
                self.workers.discard(threading.current_thread())

    def store_job(self, job):
        self.m.db.execute('UPDATE creation_jobs SET data=? WHERE id=?', (packed(job), job['id']))

    def close(self):
        self.closed.set()
        for worker in list(self.workers):
            worker.join(timeout=5)
