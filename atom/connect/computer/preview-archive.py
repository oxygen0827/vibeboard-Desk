"""Read a verified archive into memory. Never extract or execute package files."""
import base64
import io
import json
import stat
import sys
import zipfile

LIMIT = 96 * 1024 * 1024

def unpack(data):
    files = {}
    size = 0
    root = None
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist()) > 4096:
            raise ValueError('Too many archive files')
        for item in archive.infolist():
            parts = item.filename.split('/')
            if item.is_dir():
                parts = parts[:-1]
            if not parts or any(p in ('', '.', '..') for p in parts) or any('\\' in p or ':' in p or '\x00' in p for p in parts):
                raise ValueError('Invalid archive path')
            if root is None:
                root = parts[0]
            if parts[0] != root or (not item.is_dir() and len(parts) < 2):
                raise ValueError('Archive must contain one app directory')
            mode = item.external_attr >> 16
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR) or item.flag_bits & 1:
                raise ValueError('Links, special files and encrypted files are unsupported')
            if item.is_dir():
                continue
            name = '/'.join(parts[1:])
            if name in files:
                raise ValueError('Duplicate archive file')
            size += item.file_size
            if size > LIMIT or item.file_size > 32 * 1024 * 1024:
                raise ValueError('Archive is too large')
            content = archive.read(item)  # Verifies CRC and size while decompressing.
            if len(content) != item.file_size:
                raise ValueError('Archive size mismatch')
            files[name] = base64.b64encode(content).decode('ascii')
    if 'manifest.json' not in files or 'index.html' not in files:
        raise ValueError('Missing app entry')
    manifest = json.loads(base64.b64decode(files.pop('manifest.json')))
    if manifest.get('id') != root or manifest.get('entry', 'index.html') != 'index.html':
        raise ValueError('Invalid app manifest')
    return {'manifest': manifest, 'files': files}

if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(64 * 1024 * 1024 + 1)
        if len(data) > 64 * 1024 * 1024:
            raise ValueError('Archive is too large')
        print(json.dumps(unpack(data), separators=(',', ':')))
    except Exception as exc:
        print(type(exc).__name__ + ': invalid preview archive', file=sys.stderr)
        sys.exit(1)
