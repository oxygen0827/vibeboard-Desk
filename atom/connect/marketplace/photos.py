"""Account-private photo media and durable image jobs. No credentials in responses.

Media is stored as SQLite BLOBs, separately from source bundles/app state, so the
existing consistent database backup also captures every original and thumbnail.
Unlike notes/agenda, photos are server-readable for explicit image-edit requests.
"""
import base64
import hashlib
import io
import json
import os
import re
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

MAX_ORIGINAL = 20 * 1024 * 1024
MAX_PIXELS = 64_000_000
# Only previews are decoded; originals are retained byte-for-byte. Serialize
# decoding so concurrent 48 MP imports don't multiply peak memory usage.
DECODE_SLOT = threading.BoundedSemaphore(1)
try:
    from pillow_heif import register_heif_opener
    register_heif_opener(thumbnails=False)
    HEIF_AVAILABLE = True
except ImportError:
    HEIF_AVAILABLE = False
USER_BYTES = 64 * 1024 * 1024
TOTAL_BYTES = 128 * 1024 * 1024
PHOTO_ID = re.compile(r'^[a-f0-9]{32}$')
from photo_prompts import STYLES, TEMPLATES, PROMPT_VERSION, build_prompt
from pet_reference import reference_prompt
STYLES = {**STYLES, "pet": ("桌面宠物形象", "")}
ACTIVE = ('queued', 'generating', 'saving')


class PhotoError(Exception):
    def __init__(self, message, status=400, code='photo_error'):
        self.message, self.status, self.code = message, status, code


def check(ok, message, status=400, code='photo_error'):
    if not ok:
        raise PhotoError(message, status, code)


def ident(value):
    check(isinstance(value, str) and PHOTO_ID.fullmatch(value), '照片标识无效')
    return value


def data_url(raw, mime):
    return 'data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii')


def decode_image(value):
    check(isinstance(value, str) and len(value) <= MAX_ORIGINAL * 4 // 3 + 100,
          '单张照片最大支持 20 MiB，请导出较小版本后重试', 413)
    match = re.fullmatch(r'data:(image/(?:jpeg|png|webp|heic|heif));base64,([A-Za-z0-9+/=]+)', value)
    check(match, '支持 HEIC、HEIF、JPEG、PNG 和 WebP；请从相册导出这些格式')
    try:
        raw = base64.b64decode(match[2], validate=True)
    except ValueError:
        raise PhotoError('图片编码无效')
    check(0 < len(raw) <= MAX_ORIGINAL, '单张照片最大支持 20 MiB', 413)
    return raw, match[1]


def prepare(raw, declared=None):
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise PhotoError('相册服务缺少 Pillow 图片处理依赖', 503)
    check(declared not in ('image/heic', 'image/heif') or HEIF_AVAILABLE,
          '服务器尚未启用 HEIC 解码，请更新相册服务后重试', 503)
    try:
        with DECODE_SLOT:
            with Image.open(io.BytesIO(raw)) as source:
                mime = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp', 'HEIF': 'image/heic'}.get(source.format)
                heif = source.format == 'HEIF'
                check(mime and (declared is None or mime == declared or heif and declared == 'image/heif'),
                      '图片内容与格式不符，请重新从相册导出')
                if heif:
                    # HEIF can contain a primary still plus additional images.
                    # Display its primary image without discarding the original container.
                    check(source.n_frames <= 32, 'HEIF 内图片数量过多，请单独导出主照片')
                    for index in range(source.n_frames):
                        source.seek(index)
                        if source.info.get('primary'):
                            break
                    else:
                        source.seek(0)
                    if declared == 'image/heif':
                        mime = declared
                else:
                    check(getattr(source, 'n_frames', 1) == 1, '请上传静态照片')
                check(0 < source.width * source.height <= MAX_PIXELS, '照片最多支持 6400 万像素，请导出较小分辨率')
                width, height = source.size
                if source.getexif().get(274) in (5, 6, 7, 8):
                    width, height = height, width
                # Resize before transpose/alpha conversion: a full-resolution RGBA
                # copy of every 48 MP iPhone photo would waste hundreds of MiB.
                source.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
                image = ImageOps.exif_transpose(source).convert('RGBA')
            flat = Image.new('RGB', image.size, 'white')
            flat.paste(image, mask=image.getchannel('A'))
            outputs = []
            for size, quality in (((1280, 1280), 84), ((240, 180), 70)):
                copy = flat.copy()
                copy.thumbnail(size, Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS)
                out = io.BytesIO()
                copy.save(out, format='JPEG', quality=quality, optimize=True)
                outputs.append(out.getvalue())
            return mime, width, height, outputs[0], outputs[1]
    except PhotoError:
        raise
    except Exception:
        raise PhotoError('图片无法读取，请换一张照片')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ArkImages:
    def __init__(self):
        self.key = os.environ.get('ARK_API_KEY', '')
        mode = os.environ.get('ATOM_IMAGE_API_MODE', 'standard')
        if mode not in ('standard', 'agent-plan'):
            raise ValueError('ATOM_IMAGE_API_MODE must be standard or agent-plan')
        self.endpoint = 'https://ark.cn-beijing.volces.com/api/' + ('plan/' if mode == 'agent-plan' else '') + 'v3/images/generations'
        self.model = os.environ.get('ATOM_IMAGE_MODEL', 'doubao-seedream-5-0-flash-260915')
        self.allowed = set(filter(None, os.environ.get('ATOM_IMAGE_ALLOWED_USERS', '').split(',')))
        self.opener = build_opener(NoRedirect())

    def enabled(self, uid):
        # An explicit account allowlist keeps a shared deployment's key private.
        return bool(self.key and uid in self.allowed)

    def generate(self, prompt, reference=None):
        payload = dict(model=self.model, prompt=prompt, size='1K',
                       output_format='jpeg', response_format='b64_json', watermark=True)
        if reference:
            payload['image'] = reference
        request = Request(self.endpoint,
                          data=json.dumps(payload).encode(), headers={
                              'Authorization': 'Bearer ' + self.key, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=180) as response:
                raw = response.read(12 * 1024 * 1024 + 1)
            check(len(raw) <= 12 * 1024 * 1024, '生成结果过大', 502)
            result = json.loads(raw)
            item = result.get('data', [])[0]
            # Never fetch arbitrary remote output URLs. Persist returned bytes now.
            content = base64.b64decode(item['b64_json'], validate=True)
            check(0 < len(content) <= MAX_ORIGINAL, '生成结果超过相册单张上限', 502)
            return content
        except PhotoError:
            raise
        except HTTPError as exc:
            try:
                code = json.loads(exc.read(8192)).get('error', {}).get('code', '')
            except Exception:
                code = ''
            if code == 'ModelNotOpen':
                raise PhotoError('方舟账号尚未开通所选生图模型，请在控制台开通后重新生成', 503, 'model_not_open')
            if exc.code in (401, 403):
                raise PhotoError('生图服务认证或权限异常，请检查服务端配置', 503)
            if exc.code == 429:
                raise PhotoError('生图服务繁忙或额度不足，请稍后手动重试', 429)
            raise PhotoError('生图服务未完成请求，请检查模型权限或换个描述重试', 502)
        except (URLError, OSError, TimeoutError):
            raise PhotoError('生图请求超时或网络中断，未自动重试；可稍后手动重新生成', 503)
        except Exception:
            raise PhotoError('生图服务未返回有效图片', 502)


class PhotoLibrary:
    def __init__(self, market, provider=None):
        self.m = market
        self.provider = provider or ArkImages()
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='atom-image')
        self.closed = False
        with market.lock, market.db:
            market.db.executescript('''
              CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,user TEXT NOT NULL,data TEXT NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS photos_user ON photos(user);
              CREATE TABLE IF NOT EXISTS photo_media(id TEXT PRIMARY KEY,original BLOB NOT NULL,display BLOB NOT NULL,thumb BLOB NOT NULL);
              CREATE TABLE IF NOT EXISTS photo_jobs(id TEXT PRIMARY KEY,user TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(user,request_id));
              CREATE INDEX IF NOT EXISTS photo_jobs_user ON photo_jobs(user);
            ''')
            for row in market.rows('SELECT id,data FROM photo_jobs'):
                job = json.loads(row['data'])
                if job['status'] in ACTIVE:
                    job.update(status='interrupted', error='服务已重启；为避免重复计费，没有自动重试', updated_at=market.clock())
                    market.db.execute('UPDATE photo_jobs SET data=? WHERE id=?', (json.dumps(job, ensure_ascii=False), row['id']))

    def close(self):
        self.closed = True
        self.pool.shutdown(wait=True)

    def auth(self, token):
        with self.m.lock:
            return dict(self.m.auth(token))

    def own(self, uid, photo):
        row = self.m.row('SELECT * FROM photos WHERE id=? AND user=?', (ident(photo), uid))
        check(row, '照片不存在或已删除', 404)
        return row, json.loads(row['data'])

    def save_photo(self, uid, raw, prepared, name, photo_id, parent=None, prompt='', style='', digest=None):
        mime, width, height, display, thumb = prepared
        cost = len(raw) + len(display) + len(thumb)
        with self.m.lock, self.m.db:
            old = self.m.row('SELECT * FROM photos WHERE id=?', (photo_id,))
            if old:
                check(old['user'] == uid and old['digest'] == digest, '上传标识已用于其他照片', 409)
                return json.loads(old['data'])
            sums = self.m.row('SELECT COUNT(*) n,COALESCE(SUM(bytes),0) size FROM photos WHERE user=?', (uid,))
            total = self.m.row('SELECT COALESCE(SUM(bytes),0) size FROM photos')['size']
            check(sums['n'] < 100 and sums['size'] + cost <= USER_BYTES and total + cost <= TOTAL_BYTES,
                  '相册空间已满，请下载并移除不需要的照片后重试', 409, 'photo_quota')
            item = dict(id=photo_id, name=name[:100], mime=mime, width=width, height=height,
                        bytes=len(raw), favorite=False, revision=1, created_at=self.m.clock(),
                        parent_id=parent, prompt=prompt, style=style, generated=bool(prompt))
            self.m.db.execute('INSERT INTO photos VALUES(?,?,?,?,?)',
                              (photo_id, uid, json.dumps(item, ensure_ascii=False), cost, digest or hashlib.sha256(raw).hexdigest()))
            self.m.db.execute('INSERT INTO photo_media VALUES(?,?,?,?)', (photo_id, raw, display, thumb))
            return item

    def handle(self, method, target, token, body):
        check(isinstance(body, dict), '请求格式无效')
        user = self.auth(token)
        uid = user['id']
        parsed = urlsplit(target)
        suffix = parsed.path.rstrip('/').split('/photos', 1)[1]
        if suffix == '/state' and method == 'GET':
            with self.m.lock:
                used = self.m.row('SELECT COALESCE(SUM(bytes),0) size,COUNT(*) n FROM photos WHERE user=?', (uid,))
                return dict(user={'id': uid, 'username': user['username']}, generation_enabled=self.provider.enabled(uid),
                            provider='火山方舟', model=self.provider.model, used_bytes=used['size'], limit_bytes=USER_BYTES,
                            max_original_bytes=MAX_ORIGINAL, max_pixels=MAX_PIXELS,
                            total=used['n'], prompt_version=PROMPT_VERSION, templates=TEMPLATES, styles=[{'id': k, 'name': v[0]} for k, v in STYLES.items()])
        if suffix == '' and method == 'GET':
            q = parse_qs(parsed.query)
            try:
                page = int(q.get('page', ['0'])[0])
                limit = int(q.get('limit', ['12'])[0])
            except ValueError:
                raise PhotoError('页码无效')
            check(0 <= page <= 100, '页码无效')
            check(limit in (6, 12), '分页大小无效')
            kind = q.get('filter', ['all'])[0]
            check(kind in ('all', 'favorites', 'generated'), '筛选无效')
            with self.m.lock:
                items = [json.loads(r['data']) for r in self.m.rows('SELECT data FROM photos WHERE user=? ORDER BY rowid DESC', (uid,))]
                items = [p for p in items if kind == 'all' or kind == 'favorites' and p['favorite'] or kind == 'generated' and p['generated']]
                count = len(items)
                items = items[page * limit:(page + 1) * limit]
                for item in items:
                    media = self.m.row('SELECT thumb FROM photo_media WHERE id=?', (item['id'],))
                    item['thumbnail'] = data_url(media['thumb'], 'image/jpeg')
            return {'items': items, 'page': page, 'total': count, 'pages': (count + limit - 1) // limit}
        if suffix == '' and method == 'POST':
            photo_id = ident(body.get('id'))
            raw, mime = decode_image(body.get('data_url'))
            name = body.get('name', '未命名照片')
            check(isinstance(name, str) and 0 < len(name) <= 100, '照片名称无效')
            prepared = prepare(raw, mime)
            # A request that took time decoding must still belong to this session.
            self.auth(token)
            return {'photo': self.save_photo(uid, raw, prepared, name, photo_id, digest=hashlib.sha256(raw).hexdigest())}
        if suffix == '/generate' and method == 'POST':
            return self.enqueue(uid, body)
        if suffix == '/jobs' and method == 'GET':
            with self.m.lock:
                return {'jobs': [json.loads(r['data']) for r in self.m.rows('SELECT data FROM photo_jobs WHERE user=? ORDER BY rowid DESC LIMIT 12', (uid,))]}
        match = re.fullmatch(r'/jobs/([a-f0-9]{32})', suffix)
        if match and method == 'GET':
            with self.m.lock:
                row = self.m.row('SELECT data FROM photo_jobs WHERE id=? AND user=?', (match[1], uid))
                check(row, '生成任务不存在', 404)
                return {'job': json.loads(row['data'])}
        match = re.fullmatch(r'/([a-f0-9]{32})(?:/(update|delete|original))?', suffix)
        if match:
            with self.m.lock, self.m.db:
                row, item = self.own(uid, match[1])
                action = match[2]
                if method == 'GET' and action in (None, 'original'):
                    media = self.m.row('SELECT original,display FROM photo_media WHERE id=?', (item['id'],))
                    return {'photo': item, 'data_url': data_url(media['original'] if action else media['display'], item['mime'] if action else 'image/jpeg')}
                if method == 'POST' and action in ('update', 'delete'):
                    check(type(body.get('revision')) is int and body['revision'] == item['revision'], '照片已在另一端更新，请刷新后重试', 409)
                    if action == 'delete':
                        check(body.get('confirm') is True, '请确认从所有设备删除这张照片')
                        self.m.db.execute('DELETE FROM photo_media WHERE id=?', (item['id'],))
                        self.m.db.execute('DELETE FROM photos WHERE id=?', (item['id'],))
                        return {'ok': True}
                    if 'favorite' in body:
                        check(type(body['favorite']) is bool, '收藏状态无效')
                        item['favorite'] = body['favorite']
                    if 'name' in body:
                        check(isinstance(body['name'], str) and 0 < len(body['name']) <= 100, '照片名称无效')
                        item['name'] = body['name']
                    item['revision'] += 1
                    self.m.db.execute('UPDATE photos SET data=? WHERE id=?', (json.dumps(item, ensure_ascii=False), item['id']))
                    return {'photo': item}
        raise PhotoError('相册接口不存在', 404)

    def enqueue(self, uid, body):
        check(self.provider.enabled(uid), '当前账号尚未启用生图服务，请联系设备管理员', 503, 'images_not_enabled')
        request_id = ident(body.get('request_id'))
        prompt, style, source = body.get('prompt', ''), body.get('style', 'natural'), body.get('source_id')
        check(isinstance(prompt, str) and len(prompt) <= 1500 and (prompt or source), '请描述要生成的画面')
        prompt = prompt.strip()
        check(prompt or source, '请描述要生成的画面')
        check(isinstance(style, str) and style in STYLES, '请选择支持的风格')
        check(style != 'pet' or source, '生成宠物形象需要先选择一张参考照片')
        digest = hashlib.sha256(json.dumps([prompt, style, source]).encode()).hexdigest()
        with self.m.lock, self.m.db:
            previous = self.m.row('SELECT * FROM photo_jobs WHERE user=? AND request_id=?', (uid, request_id))
            if previous:
                check(previous['digest'] == digest, '此请求标识已经使用', 409)
                return {'job': json.loads(previous['data'])}
            if source:
                self.own(uid, source)
            jobs = [json.loads(r['data']) for r in self.m.rows('SELECT data FROM photo_jobs')]
            own = [j for j in jobs if j['user_id'] == uid]
            check(not any(j['status'] in ACTIVE for j in own), '已有一张图片正在生成，请等待完成', 409)
            check(sum(j['status'] in ACTIVE for j in jobs) < 6, '生成队列已满，请稍后再试', 429)
            check(sum(j['created_at'] > self.m.clock() - 86400 for j in own) < 20,
                  '今天的生图次数已用完，请明天再试', 429)
            job = dict(id=secrets.token_hex(16), user_id=uid, status='queued', created_at=self.m.clock(),
                       updated_at=self.m.clock(), prompt=prompt, style=style, source_id=source,
                       photo_id=None, error=None, prompt_version=PROMPT_VERSION, render_prompt=reference_prompt(prompt) if style == "pet" else build_prompt(prompt, style, bool(source)))
            self.m.db.execute('INSERT INTO photo_jobs VALUES(?,?,?,?,?)', (job['id'], uid, request_id, digest, json.dumps(job, ensure_ascii=False)))
            self.pool.submit(self.run, dict(job))
            return {'job': job}

    def update_job(self, job, **values):
        job.update(values, updated_at=self.m.clock())
        with self.m.lock, self.m.db:
            self.m.db.execute('UPDATE photo_jobs SET data=? WHERE id=?', (json.dumps(job, ensure_ascii=False), job['id']))

    def run(self, job):
        try:
            if self.closed:
                return self.update_job(job, status='interrupted', error='服务已关闭，请手动重试')
            reference = None
            if job['source_id']:
                with self.m.lock:
                    self.own(job['user_id'], job['source_id'])
                    row = self.m.row('SELECT display FROM photo_media WHERE id=?', (job['source_id'],))
                    reference = data_url(row['display'], 'image/jpeg')
            self.update_job(job, status='generating')
            prompt = job.get('render_prompt') or (reference_prompt(job['prompt']) if job['style'] == 'pet' else build_prompt(job['prompt'], job['style'], bool(reference)))
            raw = self.provider.generate(prompt, reference)
            self.update_job(job, status='saving')
            item = self.save_photo(job['user_id'], raw, prepare(raw), STYLES[job['style']][0] + ' · ' + (job['prompt'] or '照片新版本')[:60],
                                   secrets.token_hex(16), parent=job['source_id'], prompt=job['prompt'] or STYLES[job['style']][0], style=job['style'])
            self.update_job(job, status='completed', photo_id=item['id'])
        except PhotoError as exc:
            self.update_job(job, status='failed', error=exc.message)
        except Exception:
            self.update_job(job, status='failed', error='生成或保存失败，原照片仍然保留；请稍后重试')
