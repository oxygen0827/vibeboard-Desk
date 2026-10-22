"""Five-minute phone sign-in. Only the device holds the poll and key-transfer secrets.

A repeated poll is safe until acknowledgement. Expired, never-delivered sessions are revoked;
a delivered session is retained if its acknowledgement was lost (the device may have saved it).
"""
import base64
import hashlib
import secrets
import threading
import time
from .service import MarketError, require

TTL = 300
ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'


def _hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _secret(value):
    return isinstance(value, str) and 32 <= len(value) <= 100


def _sealed(value):
    if value is None:
        return True
    if not isinstance(value, dict) or set(value) != {'v', 'iv', 'ct'} or value['v'] != 1:
        return False
    try:
        raw = [base64.b64decode(value[k] + '=' * (-len(value[k]) % 4), altchars=b'-_', validate=True) for k in ('iv', 'ct')]
        return len(raw[0]) == 12 and 32 <= len(raw[1]) <= 256
    except (TypeError, ValueError):
        return False


class QRLogin:
    def __init__(self, market, clock=time.time):
        self.market, self.clock = market, clock
        self.lock = threading.RLock()
        self.requests = {}

    def _revoke(self, item):
        if item.get('token'):
            try:
                self.market.handle('POST', '/market/v1/logout', item['token'], {})
            except MarketError:
                pass

    def _expire(self):
        for code in [c for c, r in self.requests.items() if self.clock() - r['created'] >= TTL]:
            item = self.requests.pop(code)
            if not item.get('delivered'):
                self._revoke(item)

    def handle(self, method, path, body, peer='local'):
        require(method == 'POST', 'Method not allowed', 405, 'method')
        require(isinstance(body, dict), 'Invalid request')
        # Protect state transitions, including credential checks, against concurrent approvals/cancel.
        with self.lock:
            self._expire()
            action = path.rsplit('/', 1)[-1]
            if action == 'start':
                require(len(self.requests) < 2000, '请稍后再试', 503, 'busy')
                code = ''.join(secrets.choice(ALPHABET) for _ in range(8))
                while code in self.requests:
                    code = ''.join(secrets.choice(ALPHABET) for _ in range(8))
                poll = secrets.token_urlsafe(32)
                self.requests[code] = dict(poll=_hash(poll), created=self.clock(), state='pending')
                return dict(code=code, poll=poll, expires_in=TTL)
            if action in ('poll', 'ack', 'cancel'):
                require(_secret(body.get('poll')), 'Invalid poll token')
                hashed = _hash(body['poll'])
                code = next((c for c, r in self.requests.items() if secrets.compare_digest(r['poll'], hashed)), None)
                if not code:
                    return {'status': 'expired'} if action == 'poll' else {'ok': True}
                item = self.requests[code]
                if action == 'cancel':
                    self._revoke(self.requests.pop(code))
                    return {'ok': True}
                if action == 'ack':
                    require(item.get('delivered'), 'Please collect sign-in first', 409, 'not_ready')
                    self.requests.pop(code)
                    return {'ok': True}
                if item['state'] != 'ready':
                    return {'status': 'pending' if item['state'] == 'pending' else 'signing-in'}
                item['delivered'] = True
                return dict(status='ready', token=item['token'], user=item['user'], sealed=item.get('sealed'), key_id=item.get('key_id'))
            code = body.get('code')
            require(isinstance(code, str) and len(code) == 8, '二维码无效，请重新生成', 404, 'not_found')
            item = self.requests.get(code)
            require(item, '二维码已过期或已取消，请在设备上重新生成', 404, 'not_found')
            if action == 'approve':
                require(_secret(body.get('attempt')), 'Invalid sign-in attempt')
                attempt = _hash(body['attempt'])
                if item['state'] == 'pending':
                    session = self.market.handle('POST', '/market/v1/login', '', {k: body.get(k) for k in ('username', 'password')}, peer)
                    try:
                        keys = self.market.handle('GET', '/market/v1/keys', session['token'], {}).get('keys')
                    except Exception:
                        self._revoke(session)
                        raise
                    item.update(state='approved', token=session['token'], user=session['user'], keys=keys,
                                key_id=(keys or {}).get('key_id'), attempt=attempt, handoff=secrets.token_urlsafe(32))
                require(secrets.compare_digest(item.get('attempt', ''), attempt), '这个二维码已经用过了', 409, 'used')
                return dict(user={'username': item['user']['username']}, keys=item['keys'], handoff=item['handoff'])
            if action == 'seal':
                require(item['state'] in ('approved', 'ready'), '请先登录', 409, 'not_approved')
                require(_secret(body.get('handoff')) and secrets.compare_digest(item['handoff'], body['handoff']), '登录确认无效', 403, 'forbidden')
                require(_sealed(body.get('sealed')), 'Invalid sealed key')
                if item['state'] == 'ready':
                    require(item.get('sealed') == body.get('sealed'), '登录已确认', 409, 'used')
                else:
                    item.update(state='ready', sealed=body.get('sealed'))
                return {'ok': True}
            raise MarketError(404, 'Not found', 'not_found')
