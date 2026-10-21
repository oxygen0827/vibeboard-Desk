#!/usr/bin/env python3
"""Build and sign an ATOM system release (the core only: *.py, VERSION, static/, templates/, deploy/).

    python3 atom/tools/build_release.py --notes "这次更新了什么" [--key ~/.atom/release-signing.key] [--out DIR]

The version is atom/VERSION. Writes <version>.tar.gz and latest.json (Ed25519-signed manifest). The
private key stays on this computer; devices trust deploy/release-public.key. Publish with
atom/tools/publish_release.sh.
"""
import argparse, base64, hashlib, io, json, os, re, subprocess, tarfile, time
from pathlib import Path

ATOM = Path(__file__).resolve().parents[1]
CORE_DIRS = ('static', 'templates', 'deploy')


def core_files():
    files = sorted(ATOM.glob('*.py')) + [ATOM / 'VERSION']
    for name in CORE_DIRS:
        files += sorted(p for p in (ATOM / name).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name != '.DS_Store' and not p.name.endswith('.pyc'))
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--notes', required=True)
    parser.add_argument('--key', default=str(Path.home() / '.atom' / 'release-signing.key'))
    parser.add_argument('--out', default=str(ATOM.parent / 'release-out'))
    args = parser.parse_args()
    dirty = subprocess.run(['git', '-C', str(ATOM), 'status', '--porcelain', '--', '*.py', 'VERSION', 'static', 'templates', 'deploy'], stdout=subprocess.PIPE, check=True).stdout
    if dirty:
        raise SystemExit('Commit reviewed core changes before building a release')
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(Path(args.key).expanduser().read_text().strip()))
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    if public != base64.b64decode((ATOM / 'deploy/release-public.key').read_text().strip()):
        raise SystemExit('Signing key does not match the bundled public key')
    version = (ATOM / 'VERSION').read_text().strip()
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,4}', version) or len(version) > 40:
        raise SystemExit('Invalid numeric version')
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz', format=tarfile.PAX_FORMAT) as tar:
        for path in core_files():
            if path.is_symlink():
                raise SystemExit('Release core must not contain symbolic links')
            info = tarfile.TarInfo(str(path.relative_to(ATOM)))
            data = path.read_bytes()
            info.size, info.mode, info.mtime = len(data), (0o755 if path.stat().st_mode & 0o111 else 0o644), 0
            tar.addfile(info, io.BytesIO(data))
    package = buffer.getvalue()
    try:
        commit = subprocess.run(['git', '-C', str(ATOM), 'rev-parse', '--short', 'HEAD'], stdout=subprocess.PIPE, check=True).stdout.decode().strip()
    except Exception:
        commit = ''
    manifest = dict(version=version, notes=args.notes, created=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), size=len(package),
                    sha256=hashlib.sha256(package).hexdigest(), commit=commit, files=len(core_files()))
    body = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    manifest['signature'] = base64.b64encode(key.sign(body)).decode()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / (version + '.tar.gz')).write_bytes(package)
    (out / 'latest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print('Built %s (%d files, %d bytes) in %s' % (version, manifest['files'], len(package), out))


if __name__ == '__main__':
    main()
