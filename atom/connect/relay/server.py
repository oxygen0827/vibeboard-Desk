"""ATOM Connect durable HTTP relay. Standard library only; never logs request bodies."""
import argparse
import hashlib
import ipaddress
import json
import math
import re
import os
import secrets
import sys
from pathlib import Path
import sqlite3
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from marketplace.service import Marketplace, MarketError
from marketplace.ai import OfficialAI

TERMINAL = {'completed', 'failed', 'cancelled', 'interrupted'}
STATUSES = {'queued', 'running', 'waiting_approval'} | TERMINAL
MAX_BODY = 192 * 1024
MAX_ARTIFACT = 96 * 1024
PUBLIC_KEY = re.compile(r'^[A-Za-z0-9_-]{43}$')
B64 = re.compile(r'^[A-Za-z0-9_-]+$')
# Hard upper bounds for a self-hosted prototype; never silently prune task history.
MAX_CLIENTS = 10000
MAX_TASKS = 10000
MAX_DEVICE_TASKS = 1000
MAX_COMMANDS = 100000
MAX_PAIR_REQUESTS = 50000
MAX_TASK_EVENTS = 4096
MAX_TASK_EVENT_BYTES = 8 * 1024 * 1024
# Per-peer (count, window seconds). A client registers once, so open enrollment cannot cheaply exhaust MAX_CLIENTS.
PEER_LIMITS = {'/v1/clients/register': (10, 3600), '/v1/pair/claim': (30, 60)}


def url_is_market(target):
    path = urllib.parse.urlsplit(target).path
    return path == '/market/v1' or path.startswith('/market/v1/')


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require(value, message='Invalid request', status=400):
    if not value:
        raise ApiError(status, message)


def sealed(data, key, plain_limit):
    # End-to-end envelope from atom/e2e.py; the relay checks shape and size only.
    value = data.get(key)
    require(isinstance(value, dict) and set(value) == {'v', 'iv', 'ct'} and value['v'] == 1 and isinstance(value['iv'], str) and len(value['iv']) == 16 and B64.fullmatch(value['iv'])
            and isinstance(value['ct'], str) and 22 <= len(value['ct']) <= (plain_limit * 3 + 16) * 4 // 3 + 4 and B64.fullmatch(value['ct']), 'Invalid encrypted ' + key)
    return value


def public_key(data):
    value = data.get('public_key')
    require(value is None or isinstance(value, str) and PUBLIC_KEY.fullmatch(value), 'Invalid public key')
    return value


def string(data, key, limit=256, optional=False):
    value = data.get(key, '' if optional else None)
    require(isinstance(value, str) and (optional or bool(value.strip())) and len(value) <= limit,
            'Invalid ' + key)
    return value


class Relay:
    def __init__(self, path, clock=time.time, lease=45):
        self.clock, self.lease = clock, lease
        market_path = str(Path(path).with_name(Path(path).stem + '.marketplace.sqlite3')) if path != ':memory:' else ':memory:'
        self.marketplace = Marketplace(market_path, clock=clock)
        self.ai = OfficialAI(str(Path(path).with_name(Path(path).stem + '.ai.sqlite3')) if path != ':memory:' else ':memory:', self.marketplace, clock=clock)
        self.lock = threading.RLock()
        if path != ':memory:':
            os.makedirs(os.path.dirname(os.path.abspath(path)), mode=0o700, exist_ok=True)
        if path != ':memory:':
            fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
            os.close(fd)
            os.chmod(path, 0o600)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        PRAGMA max_page_count=65536;
        PRAGMA wal_autocheckpoint=256;
        PRAGMA journal_size_limit=16777216;

        CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, role TEXT, name TEXT, heartbeat REAL DEFAULT 0, metadata TEXT DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS codes(code_hash TEXT PRIMARY KEY, device TEXT, expires REAL, used INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, device TEXT, computer TEXT, expires REAL, status TEXT);
        CREATE TABLE IF NOT EXISTS bindings(device TEXT, computer TEXT, PRIMARY KEY(device,computer));
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, device TEXT, computer TEXT, request TEXT, data TEXT, UNIQUE(device,request));
        CREATE TABLE IF NOT EXISTS events(task TEXT, event_id TEXT, seq INTEGER, data TEXT, PRIMARY KEY(task,event_id), UNIQUE(task,seq));
        CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, computer TEXT, task TEXT, data TEXT, acked INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS approvals(task TEXT, request TEXT, data TEXT, answered INTEGER DEFAULT 0, PRIMARY KEY(task,request));
        ''')
        for table, column in (('bindings', 'device_key'), ('bindings', 'computer_key'), ('requests', 'computer_key'), ('clients', 'account')):
            if column not in {r[1] for r in self.db.execute('PRAGMA table_info(' + table + ')')}:
                self.db.execute('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' TEXT')
        self.db.commit()
        if path != ':memory:':
            os.chmod(path, 0o600)

    def close(self):
        self.ai.close()
        self.marketplace.close()
        self.db.close()

    def one(self, sql, args=()):
        return self.db.execute(sql, args).fetchone()

    def rows(self, sql, args=()):
        return self.db.execute(sql, args).fetchall()

    def auth(self, token):
        require(isinstance(token, str) and 20 <= len(token) <= 256, 'Authentication required', 401)
        row = self.one('SELECT * FROM clients WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
        require(row, 'Authentication required', 401)
        return row

    def task(self, ident, client, computer_only=False):
        row = self.one('SELECT * FROM tasks WHERE id=?', (ident,))
        require(row and ((row['computer'] == client['id'] and client['role'] == 'computer') or
                         (not computer_only and row['device'] == client['id'] and client['role'] == 'device')),
                'Task not found', 404)
        return json.loads(row['data'])

    def binding(self, device, computer):
        return self.one('SELECT * FROM bindings WHERE device=? AND computer=?', (device, computer))

    def command(self, computer, task, kind, payload):
        require(self.one('SELECT COUNT(*) n FROM commands')['n'] < MAX_COMMANDS, 'Command capacity reached; operator maintenance required', 503)
        item = {'id': secrets.token_hex(16), 'type': kind, 'task_id': task, 'payload': payload}
        self.db.execute('INSERT INTO commands(id,computer,task,data) VALUES(?,?,?,?)',
                        (item['id'], computer, task, json.dumps(item)))

    def handle(self, method, target, token='', body=None, peer='local'):
        if urllib.parse.urlsplit(target).path.startswith('/market/v1/ai/'):
            # Outside every lock: a model call takes minutes and must not stall the marketplace.
            return self.ai.handle(method, urllib.parse.urlsplit(target).path.rstrip('/'), token, body or {})
        if url_is_market(target):
            return self.marketplace.handle(method, target, token, body, peer)
        with self.lock, self.db:
            return self._handle(method, target, token, body or {})

    def _handle(self, method, target, token, body):
        parsed = urllib.parse.urlsplit(target)
        path = parsed.path.rstrip('/')
        now = self.clock()
        require(isinstance(body, dict))
        if method == 'POST' and path == '/v1/clients/register':
            role = body.get('role')
            require(role in ('computer', 'device'), 'Invalid role')
            require(self.one('SELECT COUNT(*) n FROM clients')['n'] < MAX_CLIENTS, 'Enrollment capacity reached', 503)
            name = string(body, 'name', 80)
            ident, token = secrets.token_hex(16), secrets.token_urlsafe(32)
            self.db.execute('INSERT INTO clients(id,token_hash,role,name) VALUES(?,?,?,?)',
                            (ident, hashlib.sha256(token.encode()).hexdigest(), role, name))
            return {'client_id': ident, 'token': token}
        client = self.auth(token)
        cid, role = client['id'], client['role']
        if role == 'device':
            self.db.execute('UPDATE clients SET heartbeat=? WHERE id=?', (now, cid))
        def only(expected):
            require(role == expected, 'Role not permitted', 403)
        if method == 'GET' and path == '/v1/state':
            other = 'computer' if role == 'device' else 'device'
            bound = self.rows('SELECT c.*, b.device_key, b.computer_key FROM clients c JOIN bindings b ON c.id=b.' + other + ' WHERE b.' + role + '=?', (cid,))
            paired = []
            for row in bound:
                meta = json.loads(row['metadata'])
                paired.append(dict(client_id=row['id'], name=row['name'], online=now-row['heartbeat'] < self.lease,
                                   projects=meta.get('projects', []), agents=meta.get('agents', []),
                                   public_key=row[other + '_key'], own_key=row[role + '_key']))
                if row['role'] == 'computer' and isinstance(meta.get('activity'), dict):
                    paired[-1]['activity'] = meta['activity']
            requests = [dict(request_id=r['id'], computer_id=r['computer'], computer_name=r['name']) for r in
                        self.rows("SELECT r.*,c.name FROM requests r JOIN clients c ON c.id=r.computer WHERE r.device=? AND r.status='pending' AND r.expires>?", (cid, now))] if role == 'device' else []
            tasks = [json.loads(r['data']) for r in self.rows('SELECT data FROM tasks WHERE ' + role + '=? ORDER BY rowid DESC LIMIT 100', (cid,))]
            for item in tasks:
                for key in ('artifact', 'enc_artifact'):
                    if key in item:
                        item.pop(key)
                        item['artifact_available'] = True
            return dict(client_id=cid, role=role, paired=paired, pair_requests=requests, tasks=tasks)
        if method == 'POST' and path == '/v1/pair/code':
            only('device')
            code = secrets.token_hex(6).upper()
            self.db.execute('DELETE FROM codes WHERE device=? OR expires<?', (cid, now))
            self.db.execute('DELETE FROM requests WHERE expires<?', (now-86400,))
            self.db.execute("UPDATE requests SET status='expired' WHERE device=? AND status='pending'", (cid,))
            self.db.execute('INSERT INTO codes VALUES(?,?,?,0)', (hashlib.sha256(code.encode()).hexdigest(), cid, now+300))
            return dict(code=code, expires_at=now+300)
        if method == 'POST' and path == '/v1/pair/claim':
            only('computer')
            code = string(body, 'code', 32).replace('-', '').replace(' ', '').upper()
            row = self.one('SELECT * FROM codes WHERE code_hash=?', (hashlib.sha256(code.encode()).hexdigest(),))
            require(row and not row['used'] and row['expires'] > now, 'Pair code expired or unavailable', 409)
            require(self.one('SELECT COUNT(*) n FROM requests')['n'] < MAX_PAIR_REQUESTS, 'Pairing capacity reached', 503)
            rid = secrets.token_hex(16)
            self.db.execute('UPDATE codes SET used=1 WHERE code_hash=?', (row['code_hash'],))
            self.db.execute("INSERT INTO requests(id,device,computer,expires,status,computer_key) VALUES(?,?,?,?,'pending',?)", (rid, row['device'], cid, row['expires'], public_key(body)))
            dev = self.one('SELECT name FROM clients WHERE id=?', (row['device'],))
            return dict(request_id=rid, device_id=row['device'], device_name=dev['name'])
        # Same-account discovery: a device and a computer signed in to the same market account see
        # each other and the computer may ask to connect without a code. The device still confirms,
        # and encryption keys are exchanged exactly as with a code.
        if method == 'POST' and path == '/v1/account/link':
            try:
                user = self.marketplace.auth(string(body, 'market_token', 256))
            except MarketError:
                raise ApiError(401, 'Market sign-in expired')
            self.db.execute('UPDATE clients SET account=? WHERE id=?', (user['id'], cid))
            return {'ok': True}
        if method == 'POST' and path == '/v1/account/unlink':
            self.db.execute('UPDATE clients SET account=NULL WHERE id=?', (cid,))
            return {'ok': True}
        if method == 'GET' and path == '/v1/account/peers':
            if not client['account']:
                return {'linked': False, 'peers': []}
            other = 'computer' if role == 'device' else 'device'
            peers = []
            for row in self.rows('SELECT * FROM clients WHERE account=? AND role=? AND id!=? ORDER BY heartbeat DESC LIMIT 20', (client['account'], other, cid)):
                device, computer = (cid, row['id']) if role == 'device' else (row['id'], cid)
                pending = self.one("SELECT 1 FROM requests WHERE device=? AND computer=? AND status='pending' AND expires>?", (device, computer, now))
                peers.append(dict(client_id=row['id'], name=row['name'], online=now-row['heartbeat'] < self.lease,
                                  paired=bool(self.binding(device, computer)), pending=bool(pending)))
            return {'linked': True, 'peers': peers}
        if method == 'POST' and path == '/v1/pair/invite':
            only('computer')
            device = string(body, 'device_id', 100)
            row = self.one("SELECT * FROM clients WHERE id=? AND role='device'", (device,))
            require(row and client['account'] and row['account'] == client['account'], 'Device not found on this account', 404)
            require(not self.binding(device, cid), 'Already connected', 409)
            require(self.one('SELECT COUNT(*) n FROM requests')['n'] < MAX_PAIR_REQUESTS, 'Pairing capacity reached', 503)
            self.db.execute("UPDATE requests SET status='expired' WHERE device=? AND computer=? AND status='pending'", (device, cid))
            rid = secrets.token_hex(16)
            self.db.execute("INSERT INTO requests(id,device,computer,expires,status,computer_key) VALUES(?,?,?,?,'pending',?)", (rid, device, cid, now+300, public_key(body)))
            return dict(request_id=rid, device_id=device, device_name=row['name'])
        if method == 'POST' and path == '/v1/pair/confirm':
            only('device')
            rid = string(body, 'request_id')
            require(type(body.get('accept')) is bool, 'Invalid accept')
            row = self.one('SELECT * FROM requests WHERE id=? AND device=?', (rid, cid))
            require(row and row['status'] == 'pending' and row['expires'] > now, 'Pair request expired or unavailable', 409)
            self.db.execute('UPDATE requests SET status=? WHERE id=?', ('accepted' if body['accept'] else 'declined', rid))
            if body['accept']:
                require(self.one('SELECT COUNT(*) n FROM bindings WHERE device=? OR computer=?', (cid, row['computer']))['n'] < 100, 'Pairing limit reached', 409)
                self.db.execute('INSERT OR IGNORE INTO bindings(device,computer) VALUES(?,?)', (cid, row['computer']))
                # A fresh pairing replaces both keys; either side may still be a client without encryption.
                self.db.execute('UPDATE bindings SET device_key=?,computer_key=? WHERE device=? AND computer=?', (public_key(body), row['computer_key'], cid, row['computer']))
            return {'ok': True}
        if method == 'POST' and path == '/v1/pair/keys':
            # Existing pairings publish keys once; a different key needs a fresh pairing.
            other, key = string(body, 'client_id', 100), public_key(body)
            require(key, 'Invalid public key')
            device, computer = (cid, other) if role == 'device' else (other, cid)
            bound = self.binding(device, computer)
            require(bound, 'Pairing not found', 404)
            current = bound[role + '_key']
            require(current in (None, key), 'Key already set; pair again to change it', 409)
            self.db.execute('UPDATE bindings SET ' + role + '_key=? WHERE device=? AND computer=?', (key, device, computer))
            return {'ok': True}
        if method == 'POST' and path == '/v1/pair/remove':
            other = string(body, 'client_id', 100)
            device, computer = (cid, other) if role == 'device' else (other, cid)
            require(self.one('SELECT 1 FROM bindings WHERE device=? AND computer=?', (device, computer)), 'Pairing not found', 404)
            self.db.execute('DELETE FROM bindings WHERE device=? AND computer=?', (device, computer))
            self.db.execute("UPDATE requests SET status='revoked' WHERE device=? AND computer=? AND status='pending'", (device, computer))
            for row in self.rows('SELECT id, data FROM tasks WHERE device=? AND computer=?', (device, computer)):
                task = json.loads(row['data'])
                if task['status'] in TERMINAL:
                    continue
                if task['status'] == 'queued' and self.one("SELECT 1 FROM commands WHERE task=? AND acked=0 AND json_extract(data,'$.type')='task.start'", (row['id'],)):
                    # Never delivered: drop it and close the task here.
                    self.db.execute('DELETE FROM commands WHERE task=? AND acked=0', (row['id'],))
                    task.update(status='cancelled', updated_at=now)
                elif not task.get('cancel_requested'):
                    # Already on the computer: ask it to stop and let it report the terminal event.
                    self.command(computer, row['id'], 'task.cancel', {})
                    task['cancel_requested'] = True
                self.db.execute('UPDATE tasks SET data=? WHERE id=?', (json.dumps(task), row['id']))
            return {'ok': True}
        if method == 'POST' and path == '/v1/computer/state':
            only('computer')
            projects, agents = body.get('projects'), body.get('agents')
            require(isinstance(projects, list) and len(projects) <= 50 and isinstance(agents, list) and len(agents) <= 20)
            clean_projects, clean_agents = [], []
            for item in projects:
                require(isinstance(item, dict))
                clean_projects.append(dict(id=string(item, 'id', 100), name=string(item, 'name', 100)))
            for item in agents:
                require(isinstance(item, dict) and type(item.get('available')) is bool and type(item.get('authenticated')) is bool)
                clean_agents.append(dict(id=string(item, 'id', 100), name=string(item, 'name', 100), available=item['available'], authenticated=item['authenticated'], reason=string(item, 'reason', 300, True)))
            require(len({x['id'] for x in clean_projects}) == len(projects) and len({x['id'] for x in clean_agents}) == len(agents), 'Duplicate IDs')
            metadata = dict(projects=clean_projects, agents=clean_agents)
            activity = body.get('activity')
            if activity is not None:
                require(isinstance(activity, dict), 'Invalid activity')
                activity_id = string(activity, 'id', 128)
                require(re.fullmatch(r'[A-Za-z0-9_-]{1,128}', activity_id), 'Invalid activity ID')
                require(activity.get('type') in ('app-modify', 'notes-organize'), 'Invalid activity type')
                require(activity.get('status') in ('queued','running','completed','failed','cancelled','interrupted'), 'Invalid activity status')
                stamp = activity.get('updated_at')
                require(type(stamp) in (int, float) and 0 <= stamp <= 100000000000 and math.isfinite(stamp), 'Invalid activity timestamp')
                metadata['activity'] = dict(id=activity_id, type=activity['type'], status=activity['status'], updated_at=stamp)
            self.db.execute('UPDATE clients SET heartbeat=?,metadata=? WHERE id=?', (now, json.dumps(metadata), cid))
            return {'ok': True}
        if method == 'POST' and path == '/v1/tasks':
            only('device')
            rid = string(body, 'request_id', 128)
            existing = self.one('SELECT data FROM tasks WHERE device=? AND request=?', (cid, rid))
            if existing:
                return {'task': json.loads(existing['data'])}
            require(self.one('SELECT COUNT(*) n FROM tasks')['n'] < MAX_TASKS and self.one('SELECT COUNT(*) n FROM tasks WHERE device=?', (cid,))['n'] < MAX_DEVICE_TASKS, 'Task history capacity reached; operator maintenance required', 503)
            computer = string(body, 'computer_id', 100)
            bound = self.binding(cid, computer)
            require(bound, 'Computer unavailable', 403)
            encrypted = bool(bound['device_key'] and bound['computer_key'])
            host = self.one('SELECT * FROM clients WHERE id=?', (computer,))
            require(host and now-host['heartbeat'] < self.lease, 'Computer offline', 409)
            meta = json.loads(host['metadata'])
            project, agent = string(body, 'project_id', 100), string(body, 'agent_id', 100)
            require(any(x['id'] == project for x in meta.get('projects', [])), 'Project unavailable', 409)
            require(any(x['id'] == agent and x['available'] and x['authenticated'] for x in meta.get('agents', [])), 'Agent unavailable', 409)
            task_kind = body.get('kind', 'task')
            require(task_kind in ('task', 'app'), 'Invalid task kind')
            task = dict(kind=task_kind, id=secrets.token_hex(16), request_id=rid, device_id=cid, computer_id=computer, project_id=project, agent_id=agent,
                        status='queued', last_seq=0, created_at=now, updated_at=now)
            if encrypted:
                require('prompt' not in body, 'This pairing requires an encrypted prompt', 400)
                task.update(e2e=True, enc_prompt=sealed(body, 'enc_prompt', 16000 * 3))
            else:
                task['prompt'] = string(body, 'prompt', 16000)
            session = string(body, 'session_id', 256, True)
            if session:
                previous = [json.loads(r['data']) for r in self.rows('SELECT data FROM tasks WHERE device=? AND computer=?', (cid, computer))]
                require(any(t.get('session_id') == session and t['project_id'] == project and t['agent_id'] == agent for t in previous), 'Session unavailable', 409)
                task['session_id'] = session
            self.db.execute('INSERT INTO tasks VALUES(?,?,?,?,?)', (task['id'], cid, computer, rid, json.dumps(task)))
            self.command(computer, task['id'], 'task.start', task)
            return {'task': task}
        if path == '/v1/computer/commands' and method == 'GET':
            only('computer')
            return {'commands': [json.loads(r['data']) for r in self.rows('SELECT data FROM commands WHERE computer=? AND acked=0 ORDER BY rowid LIMIT 50', (cid,))]}
        if path == '/v1/computer/commands/ack' and method == 'POST':
            only('computer')
            ident = string(body, 'command_id')
            require(self.one('SELECT 1 FROM commands WHERE id=? AND computer=?', (ident, cid)), 'Command not found', 404)
            self.db.execute('UPDATE commands SET acked=1 WHERE id=?', (ident,))
            return {'ok': True}
        parts = path.split('/')
        if len(parts) == 5 and parts[1:3] == ['v1', 'tasks']:
            task = self.task(parts[3], client, method == 'POST' and parts[4] == 'events')
            ident, action = task['id'], parts[4]
            if action == 'artifact' and method == 'GET':
                require(task.get('kind') == 'app' and task['status'] == 'completed' and isinstance(task.get('artifact') or task.get('enc_artifact'), dict), 'App artifact unavailable', 409)
                return {'enc_artifact': task['enc_artifact']} if task.get('e2e') else {'artifact': task['artifact']}
            if action == 'events' and method == 'GET':
                try:
                    after = int(urllib.parse.parse_qs(parsed.query).get('after', ['0'])[0])
                except ValueError:
                    raise ApiError(400, 'Invalid cursor')
                require(after >= 0, 'Invalid cursor')
                return {'task': task, 'events': [json.loads(r['data']) for r in self.rows('SELECT data FROM events WHERE task=? AND seq>? ORDER BY seq LIMIT 100', (ident, after))]}
            if action == 'events' and method == 'POST':
                only('computer')
                eid = string(body, 'event_id', 128)
                existing = self.one('SELECT data FROM events WHERE task=? AND event_id=?', (ident, eid))
                if existing:
                    return {'event': json.loads(existing['data'])}
                require(task['status'] not in TERMINAL, 'Task already finished', 409)
                kind = body.get('type')
                require(kind in ('status', 'delta', 'approval', 'result', 'error'), 'Invalid event type')
                event = dict(event_id=eid, type=kind, seq=task['last_seq']+1, created_at=now)
                if task.get('e2e'):
                    require(not any(k in body for k in ('text', 'artifact')), 'This task requires encrypted content')
                    if 'enc_text' in body:
                        event['enc_text'] = sealed(body, 'enc_text', 32000 * 3)
                elif 'text' in body:
                    event['text'] = string(body, 'text', 32000, True)
                if 'session_id' in body:
                    event['session_id'] = string(body, 'session_id', 256)
                    task['session_id'] = event['session_id']
                status = body.get('status')
                if 'enc_artifact' in body:
                    require(task.get('e2e') and kind == 'result' and task.get('kind') == 'app' and status in (None, 'completed'), 'Artifact requires completed app result')
                    event['enc_artifact'] = task['enc_artifact'] = sealed(body, 'enc_artifact', MAX_ARTIFACT)
                if 'artifact' in body:
                    require(kind == 'result' and task.get('kind') == 'app' and status in (None, 'completed'), 'Artifact requires completed app result')
                    artifact = body['artifact']
                    require(isinstance(artifact, dict), 'Invalid app artifact')
                    try:
                        size = len(json.dumps(artifact, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8'))
                    except (ValueError, TypeError, UnicodeError):
                        raise ApiError(400, 'Invalid app artifact')
                    require(size <= MAX_ARTIFACT, 'App artifact exceeds 96 KiB', 413)
                    event['artifact'] = artifact
                    task['artifact'] = artifact
                if kind == 'result':
                    status = 'completed'
                elif kind == 'error':
                    status = status or 'failed'
                    require(status in {'failed', 'cancelled', 'interrupted'}, 'Invalid error status')
                elif kind == 'approval':
                    approval = body.get('approval')
                    require(isinstance(approval, dict), 'Invalid approval')
                    req = string(approval, 'request_id', 128)
                    choices = approval.get('choices')
                    require(choices == ['accept', 'decline'], 'Invalid approval choices')
                    require(not self.one('SELECT 1 FROM approvals WHERE task=? AND request=?', (ident, req)), 'Approval already exists', 409)
                    require(not self.one('SELECT 1 FROM approvals WHERE task=? AND answered=0', (ident,)), 'Approval pending', 409)
                    if task.get('e2e'):
                        require(not any(k in approval for k in ('title', 'detail')), 'This task requires encrypted content')
                        event['approval'] = dict(request_id=req, enc_title=sealed(approval, 'enc_title', 200 * 3), enc_detail=sealed(approval, 'enc_detail', 8000 * 3), choices=choices)
                    else:
                        event['approval'] = dict(request_id=req, title=string(approval, 'title', 200), detail=string(approval, 'detail', 8000, True), choices=choices)
                    self.db.execute('INSERT INTO approvals VALUES(?,?,?,0)', (ident, req, json.dumps(event['approval'])))
                    status = 'waiting_approval'
                if status is not None:
                    require(status in STATUSES and not (task['status'] != 'queued' and status == 'queued'), 'Invalid task status')
                    require(not (kind != 'result' and status == 'completed'), 'Completion requires result event')
                    event['status'] = status
                    task['status'] = status
                pending = self.one('SELECT 1 FROM approvals WHERE task=? AND answered=0', (ident,))
                require(not (pending and task['status'] not in {'waiting_approval', 'cancelled', 'interrupted', 'failed'}), 'Approval must be answered before task continues', 409)
                require(not (status == 'waiting_approval' and not pending and kind != 'approval'), 'No pending approval', 409)
                usage = self.one('SELECT COUNT(*) n, COALESCE(SUM(LENGTH(data)),0) bytes FROM events WHERE task=?', (ident,))
                terminal = task['status'] in TERMINAL
                require((usage['n'] < MAX_TASK_EVENTS or terminal) and usage['bytes'] + len(json.dumps(event).encode('utf-8')) <= MAX_TASK_EVENT_BYTES - (0 if terminal else 512 * 1024), 'Task event capacity reached; cancel or finish task', 413)
                task['last_seq'], task['updated_at'] = event['seq'], now
                self.db.execute('INSERT INTO events VALUES(?,?,?,?)', (ident, eid, event['seq'], json.dumps(event)))
                self.db.execute('UPDATE tasks SET data=? WHERE id=?', (json.dumps(task), ident))
                return {'event': event}
            if action == 'cancel' and method == 'POST':
                only('device')
                require(task['status'] not in TERMINAL, 'Task already finished', 409)
                if not task.get('cancel_requested'):
                    self.command(task['computer_id'], ident, 'task.cancel', {})
                    task['cancel_requested'] = True
                    self.db.execute('UPDATE tasks SET data=? WHERE id=?', (json.dumps(task), ident))
                return {'ok': True}
            if action == 'approve' and method == 'POST':
                only('device')
                req = string(body, 'request_id', 128)
                decision = body.get('decision')
                require(decision in ('accept', 'decline'), 'Invalid decision')
                row = self.one('SELECT * FROM approvals WHERE task=? AND request=?', (ident, req))
                require(row and not row['answered'] and task['status'] == 'waiting_approval' and not task.get('cancel_requested'), 'Approval unavailable', 409)
                self.db.execute('UPDATE approvals SET answered=1 WHERE task=? AND request=?', (ident, req))
                self.command(task['computer_id'], ident, 'approval.response', dict(request_id=req, decision=decision))
                return {'ok': True}
        raise ApiError(404, 'Endpoint not found')


def trusted_networks(values):
    return tuple(ipaddress.ip_network(v.strip(), strict=False) for v in values if v.strip())


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def peer(self):
        # Only a configured reverse proxy may name the client; its X-Real-IP must overwrite any client-sent value.
        direct = self.client_address[0]
        trusted = getattr(self.server, 'trusted_proxies', ())
        try:
            if trusted and any(ipaddress.ip_address(direct) in net for net in trusted):
                return str(ipaddress.ip_address(self.headers.get('X-Real-IP', '').strip()))
        except ValueError:
            pass
        return direct

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        try:
            require(len(self.path) <= 2048, 'URL too long', 414)
            require(self.command != 'POST' or self.headers.get('Origin') is None, 'Browser-origin mutations are not permitted', 403)
            length = int(self.headers.get('Content-Length', '0'))
            limit = 28 * 1024 * 1024 if self.path == '/market/v1/photos' else (2 * 1024 * 1024 if url_is_market(self.path) else MAX_BODY)
            require(0 <= length <= limit, 'Request too large', 413)
            require(not self.headers.get('Transfer-Encoding'), 'Transfer encoding unsupported')
            self.connection.settimeout(10)
            require(length == 0 or self.headers.get('Content-Type', '').split(';')[0].strip() == 'application/json', 'JSON content type required', 415)
            peer = self.peer()
            if self.path in PEER_LIMITS:
                with self.server.relay.lock:
                    stamp = time.monotonic()
                    buckets = getattr(self.server, 'rate_buckets', {})
                    buckets = {k: v for k, v in buckets.items() if stamp-v[0] < PEER_LIMITS[k[1]][1]}
                    key = (peer, self.path)
                    start, count = buckets.get(key, (stamp, 0))
                    require(count < PEER_LIMITS[self.path][0] and (key in buckets or len(buckets) < 10000), 'Please retry later', 429)
                    buckets[key] = (start, count+1)
                    self.server.rate_buckets = buckets
            body = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
            token = self.headers.get('Authorization', '')
            token = token[7:] if token.startswith('Bearer ') else ''
            result = self.server.relay.handle(self.command, self.path, token, body, peer=peer)
            status = 200
        except MarketError as exc:
            status, result = exc.status, dict(error=exc.message, code=exc.code, **exc.extra)
        except ApiError as exc:
            status, result = exc.status, {'error': exc.message}
        except sqlite3.OperationalError:
            status, result = 503, {'error': 'Relay storage unavailable or capacity reached'}
        except (ValueError, UnicodeError):
            status, result = 400, {'error': 'Invalid JSON request'}
        except Exception:
            status, result = 500, {'error': 'Relay operation failed'}
        payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        self.end_headers()
        # A 20 MiB original becomes ~28 MiB JSON; allow slow downstream export
        # after authentication without extending unauthenticated request reads.
        if status == 200 and re.fullmatch(r'/market/v1/photos/[a-f0-9]{32}/original', self.path):
            self.connection.settimeout(120)
        self.wfile.write(payload)
        self.close_connection = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--db', default=os.path.expanduser('~/.local/share/atom-connect/relay.sqlite3'))
    parser.add_argument('--trusted-proxy', action='append', default=[], help='CIDR of a reverse proxy whose X-Real-IP is trusted; repeatable')
    args = parser.parse_args()
    os.umask(0o077)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.trusted_proxies = trusted_networks(args.trusted_proxy)
    server.relay = Relay(args.db)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.relay.close()


if __name__ == '__main__':
    main()
