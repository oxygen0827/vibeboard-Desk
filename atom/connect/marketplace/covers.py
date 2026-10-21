"""Reviewed market cover images, separate from application source and private photos."""
import base64
import hashlib
import json
import re
from photos import decode_image, prepare, PhotoError

COVER_ID = re.compile(r'^[a-f0-9]{32}$')
MAX_UPLOAD = 1024 * 1024  # Clients optimize a screenshot before sending it.
MAX_COVER = 512 * 1024


def normalize(value):
    raw, mime = decode_image(value)
    if len(raw) > MAX_UPLOAD:
        raise PhotoError('请先将封面优化到 1 MiB 以内', 413)
    _, width, height, image, _ = prepare(raw, mime)
    if len(image) > MAX_COVER:
        raise PhotoError('封面内容过大，请降低分辨率后重试', 413)
    return image, width, height


def save(market, owner, image, width, height, public=False):
    ident = hashlib.sha256(owner.encode() + b'|' + image).hexdigest()[:32]
    if not market.row('SELECT 1 FROM covers WHERE id=?', (ident,)):
        own = market.row('SELECT COALESCE(SUM(length(image)),0) n FROM covers WHERE owner=?', (owner,))['n']
        total = market.row('SELECT COALESCE(SUM(length(image)),0) n FROM covers')['n']
        if own + len(image) > 8 * 1024 * 1024 or total + len(image) > 32 * 1024 * 1024:
            raise PhotoError('封面存储空间已满，请联系管理员', 409)
        market.db.execute('INSERT INTO covers VALUES(?,?,?,?,?,?,?)', (ident, owner, image, width, height, int(public), market.clock()))
    elif public:
        market.db.execute('UPDATE covers SET public=1 WHERE id=?', (ident,))
    return ident


def official(market):
    """Update presentation metadata without rewriting immutable application versions."""
    folder = market.seed_root / 'covers'
    if not folder.exists():
        return
    with market.lock, market.db:
        for path in sorted(folder.glob('*.jpg')):
            row = market.row('SELECT data FROM works WHERE id=? AND user=?', ('official-' + path.stem, 'official'))
            if not row:
                continue
            image, width, height = normalize('data:image/jpeg;base64,' + base64.b64encode(path.read_bytes()).decode())
            ident = save(market, 'official', image, width, height, True)
            work = json.loads(row['data'])
            if work.get('cover_id') != ident:
                work['cover_id'] = ident
                market.db.execute('UPDATE works SET data=? WHERE id=?', (json.dumps(work, ensure_ascii=False), work['id']))
