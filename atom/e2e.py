"""End-to-end encryption shared by the ATOM device and ATOM Connect (twin: connect/computer/e2e.mjs).

Pairing keys are raw X25519; the pair key is HKDF-SHA256 over the shared secret. Account data keys are
random and wrapped by a PBKDF2 password key and by a recovery key. Every value is sealed with AES-256-GCM
into {"v":1,"iv","ct"} (base64url), with associated data naming exactly what the value is.
Written against cryptography 2.6 (the device's Debian package) and newer.
"""
import base64
import hashlib
import json
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SALT = b'atom-e2e-v1'
PASSWORD_ITERATIONS = 310000
CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'


class E2EError(ValueError):
    pass


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def unb64(text, size=None):
    try:
        data = base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))
    except (TypeError, ValueError):
        raise E2EError('invalid encoding')
    if size is not None and len(data) != size:
        raise E2EError('invalid key length')
    return data


def hkdf(material, info):
    return HKDF(hashes.SHA256(), 32, SALT, info.encode('utf-8'), default_backend()).derive(material)


def new_private_key():
    key = X25519PrivateKey.generate()
    return b64(key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))


def public_key(private):
    key = X25519PrivateKey.from_private_bytes(unb64(private, 32))
    return b64(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))


def pair_key(private, peer_public, device_id, computer_id):
    shared = X25519PrivateKey.from_private_bytes(unb64(private, 32)).exchange(X25519PublicKey.from_public_bytes(unb64(peer_public, 32)))
    return hkdf(shared, 'atom-task|' + device_id + '|' + computer_id)


def safety_code(device_public, computer_public):
    digest = hashlib.sha256(unb64(device_public, 32) + unb64(computer_public, 32)).digest()
    value = int.from_bytes(digest[:4], 'big') % 1000000
    return '%03d %03d' % (value // 1000, value % 1000)


def seal(key, text, aad):
    iv = os.urandom(12)
    return {'v': 1, 'iv': b64(iv), 'ct': b64(AESGCM(key).encrypt(iv, text.encode('utf-8'), aad.encode('utf-8')))}


def open_sealed(key, envelope, aad):
    if not isinstance(envelope, dict) or envelope.get('v') != 1 or not isinstance(envelope.get('iv'), str) or not isinstance(envelope.get('ct'), str):
        raise E2EError('invalid envelope')
    try:
        return AESGCM(key).decrypt(unb64(envelope['iv'], 12), unb64(envelope['ct']), aad.encode('utf-8')).decode('utf-8')
    except (InvalidTag, UnicodeError):
        raise E2EError('cannot decrypt')


def seal_json(key, value, aad):
    return seal(key, json.dumps(value, ensure_ascii=False, separators=(',', ':')), aad)


def open_json(key, envelope, aad):
    try:
        return json.loads(open_sealed(key, envelope, aad))
    except ValueError as exc:
        if isinstance(exc, E2EError):
            raise
        raise E2EError('invalid sealed JSON')


# Account keys (notes and agenda)

def password_key(password, salt, iterations=PASSWORD_ITERATIONS):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), unb64(salt), iterations)


def new_recovery_code():
    raw = os.urandom(15)  # 120 bits, 24 Crockford characters
    bits = int.from_bytes(raw, 'big')
    chars = ''.join(CROCKFORD[(bits >> (5 * i)) & 31] for i in reversed(range(24)))
    return '-'.join(chars[i:i + 4] for i in range(0, 24, 4))


def recovery_key(code):
    clean = code.upper().replace('-', '').replace(' ', '').translate(str.maketrans('OIL', '011'))
    if len(clean) != 24 or any(c not in CROCKFORD for c in clean):
        raise E2EError('invalid recovery code')
    bits = 0
    for c in clean:
        bits = (bits << 5) | CROCKFORD.index(c)
    return hkdf(bits.to_bytes(15, 'big'), 'atom-recovery')


def new_account_keys(password):
    """Returns (data_key, recovery_code, server_record)."""
    data_key, salt, code = os.urandom(32), b64(os.urandom(16)), new_recovery_code()
    record = {'v': 1, 'key_id': b64(hashlib.sha256(data_key).digest()[:9]), 'salt': salt, 'iterations': PASSWORD_ITERATIONS,
              'by_password': seal(password_key(password, salt), b64(data_key), 'atom-account-key'),
              'by_recovery': seal(recovery_key(code), b64(data_key), 'atom-account-key')}
    return data_key, code, record


def unlock_with_password(record, password):
    return unb64(open_sealed(password_key(password, record['salt'], record.get('iterations', PASSWORD_ITERATIONS)), record['by_password'], 'atom-account-key'), 32)


def unlock_with_recovery(record, code):
    return unb64(open_sealed(recovery_key(code), record['by_recovery'], 'atom-account-key'), 32)


def rewrap_password(record, data_key, password):
    salt = b64(os.urandom(16))
    return dict(record, salt=salt, iterations=PASSWORD_ITERATIONS, by_password=seal(password_key(password, salt), b64(data_key), 'atom-account-key'))
