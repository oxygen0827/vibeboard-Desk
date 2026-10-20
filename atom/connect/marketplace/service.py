"""Self-hosted ATOM source marketplace. No server-side builds or model credentials."""
import hashlib
from datetime import datetime
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mailer import Mailer, settings as mailer_settings

CATEGORIES = {'life', 'companion', 'sound', 'play', 'connect'}
LICENSES = {'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'MPL-2.0', 'GPL-3.0-only', 'GPL-3.0-or-later'}
RESERVED = {'clock','timer','notes','status','settings','developer','manager','home','widgets','workshop','themes','my-computer','market','quick-notes','connect-preview','today','task-pal','app-library'}
APP_ID = re.compile(r'^[a-z][a-z0-9_-]{0,47}$')
ID = re.compile(r'^[A-Za-z0-9_-]{1,100}$')
MAX_BUNDLE = 1024 * 1024
EMAIL = re.compile(r'^[^@\s]{1,64}@[A-Za-z0-9.-]{1,189}\.[A-Za-z]{2,24}$')
CODE_TTL, CODE_ATTEMPTS = 900, 5


class MarketError(Exception):
    def __init__(self, status, message, code='market_error', **extra):
        self.status, self.message, self.code, self.extra = status, message, code, extra


def require(value, message='Invalid request', status=400, code='invalid_request'):
    if not value:
        raise MarketError(status, message, code)


def text(data, key, maximum=200, optional=False):
    value = data.get(key, '' if optional else None)
    require(isinstance(value, str) and (optional or bool(value.strip())) and len(value) <= maximum, 'Invalid '+key)
    return value


def packed(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    except (ValueError, TypeError, UnicodeError):
        raise MarketError(400, 'Invalid JSON content')


def validate_bundle(bundle, official=False):
    require(isinstance(bundle, dict) and isinstance(bundle.get('manifest'), dict) and isinstance(bundle.get('files'), dict), 'Complete manifest and files required')
    require(len(packed(bundle).encode('utf-8')) <= MAX_BUNDLE, 'Bundle exceeds 1 MiB')
    manifest, files = bundle['manifest'], bundle['files']
    aid = manifest.get('id')
    require(isinstance(aid, str) and APP_ID.fullmatch(aid) and (aid not in RESERVED or official and aid in ('today','task-pal')), 'Invalid or protected app ID')
    text(manifest, 'name', 80)
    text(manifest, 'description', 500, True)
    require(manifest.get('entry') == 'index.html' and manifest.get('icon') == 'icon.svg', 'index.html and icon.svg required')
    require('theme_ui' not in manifest or manifest['theme_ui'] == 'controls', 'Invalid theme_ui')
    require('layout' not in manifest or manifest['layout'] == 'fullscreen', 'Invalid layout')
    if 'capabilities' in manifest:
        caps=manifest['capabilities']
        require(isinstance(caps,list) and len(caps)<=3 and all(isinstance(c,str) and c in ('notes','agenda','task-state') for c in caps) and len(set(caps))==len(caps),'Invalid capability declaration')
    require(not any(k in manifest for k in ('theme_mode', 'theme_id')), 'Apps must follow the active system theme')
    require(2 <= len(files) <= 100 and 'index.html' in files and 'icon.svg' in files, 'Complete app files required')
    for name, content in files.items():
        require(isinstance(name, str) and 1 <= len(name) <= 200 and '\\' not in name and '%' not in name and ':' not in name and not name.startswith('/') and not any(c.isspace() or ord(c)<32 for c in name), 'Invalid bundle path')
        parts = name.split('/')
        require(all(p not in ('', '.', '..') and not p.startswith('.') for p in parts) and name != 'manifest.json', 'Invalid bundle path')
        require(isinstance(content, str), 'Bundle files must be text')
    icon = files['icon.svg']
    require(len(icon.encode('utf-8')) <= 32768 and not re.search(r'<!|<\?', icon), 'Invalid static SVG icon')
    try:
        root = ET.fromstring(icon)
    except ET.ParseError:
        raise MarketError(400, 'Invalid icon SVG')
    require(root.tag == '{http://www.w3.org/2000/svg}svg' and root.get('viewBox') == '0 0 64 64', 'Icon requires square 64 viewBox')
    tags = {'svg','g','path','rect','circle','ellipse','line','polyline','polygon','title','desc'}
    attrs = {'viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-opacity','fill-opacity','opacity','transform'}
    require(len(list(root.iter())) <= 256, 'Icon too complex')
    for node in root.iter():
        require(node.tag.split('}')[-1] in tags, 'Active SVG content forbidden')
        for key, value in node.attrib.items():
            require(key in attrs and not re.search(r'url\(|javascript:|data:|https?:|//|@', value, re.I), 'Unsafe icon attribute')
            if key in ('fill', 'stroke'):
                require(value in ('none', 'currentColor'), 'Icon must use currentColor')
    # Keep the complete snapshot, not only index.html. No server-side evaluation.
    return json.loads(packed(bundle))


def scan_publish(bundle):
    source = '\n'.join(bundle['files'].values()) + '\n' + packed(bundle['manifest'])
    # A conservative accidental-secret scanner, not a guarantee that source is safe.
    patterns = [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
                r'\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',
                r'(?i)(?:api[_-]?key|access[_-]?token|password|authorization)\s*["\']?\s*[:=]\s*["\'][A-Za-z0-9_./+\-=]{12,}["\']',
                r'(?i)bearer\s+[A-Za-z0-9_.-]{20,}']
    require(not any(re.search(p, source) for p in patterns), 'Possible credential detected; remove secrets before publishing', 400, 'publish_secret_detected')


class Marketplace:
    def __init__(self, db_path, clock=time.time, seeds=None, mailer=None):
        self.clock, self.lock, self.rates = clock, threading.RLock(), {}
        self.mailer = mailer or Mailer()
        target = Path(db_path)
        if db_path != ':memory:':
            self._prepare_path(target)
        self.db = sqlite3.connect(str(target), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._schema()
        self.seed_root = Path(seeds) if seeds else Path(__file__).resolve().parents[2] / 'official'
        self.import_official()

    def _prepare_path(self, target):
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        fd = os.open(str(target), os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(str(target), 0o600)

    def _schema(self):
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        PRAGMA max_page_count=65536;
        PRAGMA wal_autocheckpoint=256;
        PRAGMA journal_size_limit=16777216;
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE,salt TEXT,password_hash TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user TEXT,expires REAL,created REAL);
        CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,user TEXT,data TEXT,bundle TEXT);
        CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY,user TEXT,data TEXT);
        CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,work TEXT,number INTEGER,data TEXT,bundle TEXT,UNIQUE(work,number));
        CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,user TEXT,data TEXT);
        CREATE TABLE IF NOT EXISTS agenda(id TEXT PRIMARY KEY,user TEXT,data TEXT);
        CREATE TABLE IF NOT EXISTS visibility(work TEXT PRIMARY KEY,unlisted INTEGER NOT NULL,updated REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS agenda_user ON agenda(user);
        CREATE INDEX IF NOT EXISTS drafts_user ON drafts(user);
        CREATE INDEX IF NOT EXISTS notes_user ON notes(user);
        CREATE INDEX IF NOT EXISTS versions_work ON versions(work);
        CREATE TABLE IF NOT EXISTS verifications(user TEXT,purpose TEXT,hash TEXT,email TEXT,expires REAL,attempts INTEGER DEFAULT 0,PRIMARY KEY(user,purpose));
        ''')
        columns = {r[1] for r in self.db.execute('PRAGMA table_info(users)')}
        if 'email' not in columns:
            self.db.execute('ALTER TABLE users ADD COLUMN email TEXT')
            self.db.execute('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0')
            self.db.commit()

    def close(self):
        self.db.close()

    def row(self, sql, args=()):
        return self.db.execute(sql, args).fetchone()

    def rows(self, sql, args=()):
        return self.db.execute(sql, args).fetchall()

    def rate(self, key, maximum, window):
        now = self.clock()
        self.rates = {k:v for k,v in self.rates.items() if now-v[0]<3600}
        stamp, count = self.rates.get(key, (now, 0))
        if now-stamp >= window:
            stamp, count = now, 0
        require(count < maximum and (key in self.rates or len(self.rates)<20000), '尝试次数过多，请稍后再试', 429, 'rate_limited')
        self.rates[key] = (stamp, count+1)

    def login_session(self, user):
        now = self.clock()
        self.db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
        old = self.rows('SELECT hash FROM sessions WHERE user=? ORDER BY created DESC LIMIT -1 OFFSET 19', (user['id'],))
        for row in old:
            self.db.execute('DELETE FROM sessions WHERE hash=?', (row['hash'],))
        token = secrets.token_urlsafe(32)
        self.db.execute('INSERT INTO sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user['id'], now+30*86400, now))
        return {'token':token, 'user':{'id':user['id'],'username':user['username']}}

    def auth(self, token):
        require(isinstance(token, str) and 20 <= len(token) <= 256, '请先登录', 401, 'unauthenticated')
        row = self.row('SELECT u.* FROM sessions s JOIN users u ON s.user=u.id WHERE s.hash=? AND s.expires>?', (hashlib.sha256(token.encode()).hexdigest(), self.clock()))
        require(row, '登录已过期，请重新登录', 401, 'unauthenticated')
        return row

    def own_draft(self, ident, user):
        row = self.row('SELECT * FROM drafts WHERE id=? AND user=?', (ident, user['id']))
        require(row, 'Draft not found', 404, 'not_found')
        return row, json.loads(row['data'])

    def version(self, ident):
        row = self.row('SELECT * FROM versions WHERE id=?', (ident,))
        require(row, 'Version not found', 404, 'not_found')
        data = json.loads(row['data'])
        work = json.loads(self.row('SELECT data FROM works WHERE id=?', (row['work'],))['data'])
        return {'version':data, 'bundle':json.loads(row['bundle']), 'license':work['license'], 'author':work['author'], 'parent_id':work.get('parent_id'), 'parent_version_id':work.get('parent_version_id'), 'official':work.get('official') is True}

    def new_draft(self, user, data, bundle, parent=None):
        require(self.row('SELECT COUNT(*) n FROM drafts WHERE user=?', (user['id'],))['n'] < 50, 'Draft quota reached', 409, 'quota_exceeded')
        title, desc = text(data, 'title', 80), text(data, 'description', 500, True)
        category, license = data.get('category'), data.get('license')
        require(isinstance(category, str) and category in CATEGORIES and isinstance(license, str) and license in LICENSES, 'Choose a supported category and license')
        draft = dict(id=secrets.token_hex(16), title=title, description=desc, category=category, license=license, revision=1, created_at=self.clock(), updated_at=self.clock(), author=user['username'], parent_id=None, parent_version_id=None, work_id=None)
        if parent:
            draft.update(parent_id=parent['version']['work_id'], parent_version_id=parent['version']['id'], attribution=parent['author'])
        self.db.execute('INSERT INTO drafts VALUES(?,?,?,?)', (draft['id'], user['id'], packed(draft), packed(bundle)))
        return draft

    def publish(self, user, row, draft, changelog):
        bundle = validate_bundle(json.loads(row['bundle']))
        self.check_parent_license(draft, bundle)
        scan_publish(bundle)
        require(self.row('SELECT COUNT(*) n FROM versions')['n'] < 10000, 'Marketplace version quota reached', 409, 'quota_exceeded')
        work_id = draft.get('work_id') or secrets.token_hex(16)
        old = self.row('SELECT * FROM works WHERE id=?', (work_id,))
        require(not old or old['user'] == user['id'], 'Publication not permitted', 403)
        number = self.row('SELECT COUNT(*) n FROM versions WHERE work=?', (work_id,))['n']+1
        require(number <= 100, 'Work version quota reached', 409, 'quota_exceeded')
        version_id = secrets.token_hex(16)
        canonical = packed(bundle)
        digest = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
        version = dict(id=version_id, work_id=work_id, number=number, created_at=self.clock(), changelog=changelog, sha256=digest, source_sha256=digest)
        work = {k:draft.get(k) for k in ('title','description','category','license','parent_id','parent_version_id','attribution')}
        work.update(id=work_id, author=user['username'], latest_version_id=version_id, updated_at=self.clock(), official=False)
        self.db.execute('INSERT OR REPLACE INTO works VALUES(?,?,?)', (work_id,user['id'],packed(work)))
        self.db.execute('INSERT INTO versions VALUES(?,?,?,?,?)', (version_id,work_id,number,packed(version),canonical))
        draft.update(work_id=work_id, revision=draft['revision']+1, updated_at=self.clock(), published_revision=draft['revision'])
        self.db.execute('UPDATE drafts SET data=? WHERE id=?', (packed(draft), draft['id']))
        return {'work':work, 'version':version}

    def check_parent_license(self, draft, bundle):
        if not draft.get('parent_version_id'):
            return
        parent=self.version(draft['parent_version_id'])
        require(draft['license']==parent['license'] and draft.get('parent_id')==parent['version']['work_id'], 'Parent attribution must be preserved')
        for name, value in parent['bundle']['files'].items():
            if re.fullmatch(r'(LICENSE|COPYING|NOTICE)([._-].*)?', name.rsplit('/',1)[-1], re.I):
                require(bundle['files'].get(name)==value, 'Inherited license and attribution files must be preserved')

    def import_official(self):
        if not self.seed_root.exists():
            return
        with self.lock, self.db:
            paths=sorted(list(self.seed_root.glob('*/bundle.json'))+list(self.seed_root.glob('*.json')))
            require(len(paths)<=100, 'Too many official seed sources')
            for source in paths:
                candidate = json.loads(source.read_text(encoding='utf-8'))
                # Top-level JSON may be an audit report, not an installable seed.
                # Explicit bundle.json and partial bundle schemas must still fail validation.
                if source.name != 'bundle.json' and isinstance(candidate, dict) and not ({'manifest', 'files'} & set(candidate)):
                    continue
                bundle = validate_bundle(candidate, official=True)
                scan_publish(bundle)
                aid=bundle['manifest']['id']
                canonical = packed(bundle)
                digest = hashlib.sha256(canonical.encode()).hexdigest()
                wid, vid = 'official-'+aid, 'official-'+digest[:32]
                if self.row('SELECT 1 FROM versions WHERE id=?', (vid,)):
                    continue
                categories = {'official-companion':'companion','pixel-lab':'play','task-pal':'connect','today':'life','sound-lab':'sound'}
                work = dict(id=wid,title=bundle['manifest']['name'],description=bundle['manifest'].get('description',''),category=categories.get(aid,'life'),license='MIT',author='ATOM',official=True,parent_id=None,parent_version_id=None,latest_version_id=vid,updated_at=self.clock())
                number=self.row('SELECT COUNT(*) n FROM versions WHERE work=?',(wid,))['n']+1
                version=dict(id=vid,work_id=wid,number=number,created_at=self.clock(),changelog='Official source snapshot',sha256=digest,source_sha256=digest)
                self.db.execute('INSERT OR REPLACE INTO works VALUES(?,?,?)',(wid,'official',packed(work)))
                self.db.execute('INSERT INTO versions VALUES(?,?,?,?,?)',(vid,wid,number,packed(version),canonical))

    def handle(self, method, target, token='', body=None, peer='local'):
        body = body if body is not None else {}
        path = urlsplit(target).path.rstrip('/')[len('/market/v1'):]
        if method == 'POST' and path in ('/register', '/login'):
            return self.sign_in(path, body, peer)
        if method == 'POST' and path == '/password/reset':
            return self.reset_password(body, peer)
        if method == 'POST' and path == '/password/change':
            return self.change_password(token, body)
        with self.lock, self.db:
            return self._handle(method,target,token,body,peer)

    @staticmethod
    def hash_password(password, salt):
        return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 310000).hex()

    def credentials(self, body):
        username = text(body,'username',32).strip().lower()
        require(re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,31}',username), '用户名需为 3–32 位小写字母、数字、下划线或连字符')
        password = text(body,'password',256)
        require(len(password)>=12, '密码至少需要 12 位')
        return username, password

    def sign_in(self, path, body, peer):
        # Rate limits are charged before hashing, and PBKDF2 runs outside the lock so it cannot stall other requests.
        require(isinstance(body,dict), 'JSON object required')
        with self.lock:
            self.rate((peer,path), 10 if path=='/register' else 30, 3600 if path=='/register' else 600)
            username, password = self.credentials(body)
            require(username not in ('atom','official','admin','system'), '用户名已被使用')
            self.rate(('account',hashlib.sha256(username.encode()).hexdigest()),30,600)
            user = self.row('SELECT * FROM users WHERE username=?',(username,))
            if path == '/register':
                require(not user,'用户名已被使用',409,'username_unavailable')
            salt = secrets.token_hex(16) if path == '/register' else (user['salt'] if user else '00'*16)
        computed = self.hash_password(password, salt)
        with self.lock, self.db:
            user = self.row('SELECT * FROM users WHERE username=?',(username,))
            if path == '/register':
                require(not user,'用户名已被使用',409,'username_unavailable')
                require(self.row('SELECT COUNT(*) n FROM users')['n']<1000,'服务器账号已满，请联系管理员',409,'quota_exceeded')
                uid=secrets.token_hex(16)
                self.db.execute('INSERT INTO users(id,username,salt,password_hash,created) VALUES(?,?,?,?,?)',(uid,username,salt,computed,self.clock()))
                user=self.row('SELECT * FROM users WHERE id=?',(uid,))
            else:
                require(user and user['salt']==salt and hmac.compare_digest(computed,user['password_hash']),'用户名或密码不正确',401,'invalid_credentials')
            return self.login_session(user)

    def issue_code(self, user, purpose, email):
        code = '%06d' % secrets.randbelow(10**6)
        self.db.execute('INSERT OR REPLACE INTO verifications VALUES(?,?,?,?,?,0)', (user['id'], purpose, self.code_hash(user, purpose, code), email, self.clock()+CODE_TTL))
        return code

    @staticmethod
    def code_hash(user, purpose, code):
        return hashlib.sha256((user['id']+'|'+purpose+'|'+code).encode()).hexdigest()

    def check_code(self, user, purpose, code):
        # Each wrong guess is committed even when the caller's transaction later fails.
        row = self.row('SELECT * FROM verifications WHERE user=? AND purpose=?', (user['id'], purpose))
        require(row and row['expires'] > self.clock() and row['attempts'] < CODE_ATTEMPTS, '验证码已失效，请重新获取', 400, 'code_expired')
        if not (isinstance(code, str) and hmac.compare_digest(self.code_hash(user, purpose, code.strip()), row['hash'])):
            self.db.execute('UPDATE verifications SET attempts=attempts+1 WHERE user=? AND purpose=?', (user['id'], purpose))
            self.db.commit()
            raise MarketError(400, '验证码不正确', 'code_invalid')
        self.db.execute('DELETE FROM verifications WHERE user=? AND purpose=?', (user['id'], purpose))
        return row

    def new_password(self, body, key='new_password'):
        password = text(body, key, 256)
        require(len(password) >= 12, '密码至少需要 12 位')
        return password

    def reset_password(self, body, peer):
        require(isinstance(body, dict), 'JSON object required')
        with self.lock, self.db:
            self.rate((peer, '/password/reset'), 20, 3600)
            username = text(body, 'username', 32).strip().lower()
            password = self.new_password(body)
            user = self.row('SELECT * FROM users WHERE username=?', (username,))
            require(user, '验证码已失效，请重新获取', 400, 'code_expired')
            self.check_code(user, 'reset', body.get('code'))
        salt = secrets.token_hex(16)
        computed = self.hash_password(password, salt)
        with self.lock, self.db:
            self.db.execute('UPDATE users SET salt=?,password_hash=? WHERE id=?', (salt, computed, user['id']))
            self.db.execute('DELETE FROM sessions WHERE user=?', (user['id'],))
            return self.login_session(self.row('SELECT * FROM users WHERE id=?', (user['id'],)))

    def change_password(self, token, body):
        require(isinstance(body, dict), 'JSON object required')
        with self.lock:
            user = self.auth(token)
            self.rate(('change', user['id']), 10, 3600)
            old, new = text(body, 'old_password', 256), self.new_password(body)
        require(hmac.compare_digest(self.hash_password(old, user['salt']), user['password_hash']), '当前密码不正确', 401, 'invalid_credentials')
        salt = secrets.token_hex(16)
        computed = self.hash_password(new, salt)
        with self.lock, self.db:
            current = self.auth(token)
            require(current['salt'] == user['salt'], '密码已在其他地方修改，请重新登录', 409, 'password_changed')
            self.db.execute('UPDATE users SET salt=?,password_hash=? WHERE id=?', (salt, computed, user['id']))
            # Keep this session, sign out every other one.
            self.db.execute('DELETE FROM sessions WHERE user=? AND hash<>?', (user['id'], hashlib.sha256(token.encode()).hexdigest()))
            return {'ok': True}

    def mail(self, to, subject, body):
        require(self.mailer.configured, '服务器暂未配置邮件发送', 503, 'mail_unavailable')
        self.mailer.send(to, subject, body)

    def _handle(self, method, target, token, body, peer):
        parsed = urlsplit(target)
        path = parsed.path.rstrip('/')[len('/market/v1'):]
        require(isinstance(body,dict), 'JSON object required')
        if path == '/health' and method == 'GET':
            return {'ok':True}
        if method == 'GET' and path == '/catalog':
            query=parse_qs(parsed.query)
            category=query.get('category',[''])[0]
            q=query.get('q',[''])[0].strip().lower()
            require(len(q)<=100 and (not category or category in CATEGORIES),'Invalid catalog filter')
            works=[json.loads(r['data']) for r in self.rows('SELECT w.data FROM works w LEFT JOIN visibility v ON v.work=w.id WHERE COALESCE(v.unlisted,0)=0 ORDER BY w.rowid DESC')]
            return {'works':[w for w in works if (not category or w['category']==category) and (not q or q in (w['title']+' '+w['description']+' '+w['author']).lower())][:200]}
        parts=path.strip('/').split('/')
        if method=='GET' and len(parts)==2 and parts[0]=='works':
            row=self.row('SELECT data FROM works WHERE id=?',(parts[1],))
            require(row,'Work not found',404,'not_found')
            work=json.loads(row['data'])
            versions=[json.loads(r['data']) for r in self.rows('SELECT data FROM versions WHERE work=? ORDER BY number DESC',(parts[1],))]
            derivatives=[json.loads(r['data']) for r in self.rows('SELECT w.data FROM works w LEFT JOIN visibility v ON v.work=w.id WHERE COALESCE(v.unlisted,0)=0')]
            return {'work':work,'versions':versions,'derivatives':[w for w in derivatives if w.get('parent_id')==parts[1]][:100]}
        if method=='GET' and len(parts)==2 and parts[0]=='versions':
            return self.version(parts[1])
        if path=='/password/forgot' and method=='POST':
            self.rate((peer,path),10,3600)
            username=text(body,'username',32).strip().lower()
            require(self.mailer.configured,'服务器暂未配置邮件发送',503,'mail_unavailable')
            self.rate(('forgot',hashlib.sha256(username.encode()).hexdigest()),5,3600)
            user=self.row('SELECT * FROM users WHERE username=?',(username,))
            # Same answer whether or not the account exists or has a verified email.
            if user and user['email'] and user['email_verified']:
                code=self.issue_code(user,'reset',user['email'])
                self.mail(user['email'],'ATOM 密码重置验证码',user['username']+'，你好：\n\n你的 ATOM 密码重置验证码是 '+code+'，15 分钟内有效。\n如果不是你本人操作，请忽略这封邮件，你的密码不会改变。\n')
            return {'ok':True}
        user=self.auth(token)
        if path=='/me' and method=='GET':
            return {'user':{'id':user['id'],'username':user['username'],'email':user['email'] or '','email_verified':bool(user['email_verified'])}}
        if path=='/email/start' and method=='POST':
            email=text(body,'email',254).strip()
            require(EMAIL.fullmatch(email),'请输入有效的邮箱地址')
            self.rate(('email',user['id']),5,3600)
            code=self.issue_code(user,'email',email)
            self.mail(email,'ATOM 邮箱验证码',user['username']+'，你好：\n\n你的 ATOM 邮箱验证码是 '+code+'，15 分钟内有效。\n验证后，这个邮箱可以用来找回密码。\n')
            return {'ok':True,'email':email}
        if path=='/email/verify' and method=='POST':
            row=self.check_code(user,'email',body.get('code'))
            self.db.execute('UPDATE users SET email=?,email_verified=1 WHERE id=?',(row['email'],user['id']))
            return {'ok':True,'email':row['email'],'email_verified':True}
        if path=='/logout' and method=='POST':
            self.db.execute('DELETE FROM sessions WHERE hash=?',(hashlib.sha256(token.encode()).hexdigest(),))
            return {'ok':True}
        if path=='/forks' and method=='POST':
            version=self.version(text(body,'version_id',100))
            bundle=version['bundle']
            bundle['manifest']['id']='fork-'+secrets.token_hex(10)
            title=text(body,'title',80,True) or bundle['manifest']['name']
            bundle['manifest']['name']=title
            work=json.loads(self.row('SELECT data FROM works WHERE id=?',(version['version']['work_id'],))['data'])
            draft=self.new_draft(user,dict(title=title,description=work['description'],category=work['category'],license=version['license']),bundle,version)
            return {'draft':draft}
        if path=='/drafts' and method=='GET':
            return {'drafts':[json.loads(r['data']) for r in self.rows('SELECT data FROM drafts WHERE user=? ORDER BY rowid DESC',(user['id'],))]}
        if path=='/drafts' and method=='POST':
            bundle=validate_bundle(body.get('bundle'))
            return {'draft':self.new_draft(user,body,bundle)}
        if len(parts)>=2 and parts[0]=='drafts':
            row,draft=self.own_draft(parts[1],user)
            if len(parts)==2 and method=='GET':
                return {'draft':draft,'bundle':json.loads(row['bundle'])}
            if len(parts)==3 and method=='POST' and parts[2] in ('save','publish'):
                if type(body.get('revision')) is not int or body['revision']!=draft['revision']:
                    raise MarketError(409,'Draft has changed; reload before saving','revision_conflict',current=draft)
                if parts[2]=='publish':
                    require(body.get('confirm') is True,'Explicit publication confirmation required')
                    changelog=text(body,'changelog',500)
                    return self.publish(user,row,draft,changelog)
                bundle=validate_bundle(body.get('bundle'))
                self.check_parent_license(draft,bundle)
                old_bundle=json.loads(row['bundle'])
                require(bundle['manifest']['id']==old_bundle['manifest']['id'],'Application ID cannot change on save')
                for key,maximum in (('title',80),('description',500)):
                    if key in body: draft[key]=text(body,key,maximum,key=='description')
                draft.update(revision=draft['revision']+1,updated_at=self.clock())
                self.db.execute('UPDATE drafts SET data=?,bundle=? WHERE id=?',(packed(draft),packed(bundle),draft['id']))
                return {'draft':draft}
        if path=='/agenda' and method=='GET':
            return {'items':[json.loads(r['data']) for r in self.rows('SELECT data FROM agenda WHERE user=? ORDER BY rowid DESC',(user['id'],))]}
        if path=='/agenda' and method=='POST':
            ident=body.get('id') or secrets.token_hex(16)
            require(isinstance(ident,str) and ID.fullmatch(ident),'Invalid agenda ID')
            row=self.row('SELECT * FROM agenda WHERE id=?',(ident,))
            require(not row or row['user']==user['id'],'Item not found',404,'not_found')
            current=json.loads(row['data']) if row else None
            revision=body.get('revision')
            if current and (type(revision) is not int or revision!=current['revision']):
                raise MarketError(409,'Item has changed; resolve conflict without overwriting','revision_conflict',current=current)
            if not current: require(revision is None or type(revision) is int and revision==0,'Invalid initial item revision')
            require(current or self.row('SELECT COUNT(*) n FROM agenda WHERE user=?',(user['id'],))['n']<200,'Agenda quota reached',409,'quota_exceeded')
            title=text(body,'title',200)
            kind=body.get('kind',current['kind'] if current else 'todo')
            require(kind in ('event','todo'),'Invalid agenda kind')
            starts=text(body,'starts_at',64,True) if 'starts_at' in body else (current['starts_at'] if current else '')
            if starts:
                try: datetime.fromisoformat(starts.replace('Z','+00:00'))
                except ValueError: raise MarketError(400,'Invalid ISO start time')
            done,deleted=body.get('done',current['done'] if current else False),body.get('deleted',current['deleted'] if current else False)
            require(type(done) is bool and type(deleted) is bool,'Invalid item flags')
            item=dict(id=ident,title=title,kind=kind,starts_at=starts,done=done,deleted=deleted,revision=(current['revision'] if current else 0)+1,updated_at=self.clock())
            self.db.execute('INSERT OR REPLACE INTO agenda VALUES(?,?,?)',(ident,user['id'],packed(item)))
            return {'item':item}
        if path=='/notes' and method=='GET':
            return {'notes':[json.loads(r['data']) for r in self.rows('SELECT data FROM notes WHERE user=? ORDER BY rowid DESC',(user['id'],))]}
        if path=='/notes' and method=='POST':
            ident=body.get('id') or secrets.token_hex(16)
            require(isinstance(ident,str) and ID.fullmatch(ident),'Invalid note ID')
            row=self.row('SELECT * FROM notes WHERE id=?',(ident,))
            require(not row or row['user']==user['id'],'Note not found',404,'not_found')
            current=json.loads(row['data']) if row else None
            revision=body.get('revision')
            if current and (type(revision) is not int or revision!=current['revision']):
                raise MarketError(409,'Note has changed; keep your local copy and resolve conflict','revision_conflict',current=current)
            if not current: require(revision is None or type(revision) is int and revision==0,'Invalid initial note revision')
            require(current or self.row('SELECT COUNT(*) n FROM notes WHERE user=?',(user['id'],))['n']<200,'Note quota reached',409,'quota_exceeded')
            value=text(body,'text',4000,True) if 'text' in body else (current['text'] if current else '')
            pinned,deleted=body.get('pinned',current['pinned'] if current else False),body.get('deleted',current['deleted'] if current else False)
            require(type(pinned) is bool and type(deleted) is bool,'Invalid note flags')
            note=dict(id=ident,text=value,pinned=pinned,deleted=deleted,revision=(current['revision'] if current else 0)+1,updated_at=self.clock())
            self.db.execute('INSERT OR REPLACE INTO notes VALUES(?,?,?)',(ident,user['id'],packed(note)))
            return {'note':note}
        raise MarketError(404,'Endpoint not found','not_found')
