#!/usr/bin/env python3
"""Bound only ATOM's exact backup objects. Never changes bucket lifecycle or ECS snapshots."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

NAME = re.compile(r'atom-[0-9]{8}T[0-9]{6}Z\.tar\.gz\Z')
KEEP = 3


def api(action, **params):
    args = ['/usr/local/bin/ossutil', 'api', action, '--bucket', os.environ['OSS_BUCKET'],
            '--output-format', 'json', '-e', os.environ['OSS_ENDPOINT'], '--region', os.environ.get('OSS_REGION', 'cn-shanghai')]
    for key, value in params.items():
        args += ['--' + key.replace('_', '-'), str(value)]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError('OSS backup operation failed: ' + action)  # Do not print provider output/credentials.
    if not result.stdout.strip():
        return {}
    return json.JSONDecoder().raw_decode(result.stdout.lstrip())[0]


def prefix():
    value = os.environ.get('OSS_PREFIX', 'atom/backups').strip('/')
    if not value or any(p in ('.', '..') for p in value.split('/')):
        raise ValueError('A dedicated nonempty backup prefix is required')
    return value + '/'


def check_versioning(call=api):
    status = call('get-bucket-versioning').get('Status', '')
    if status not in ('', 'Disabled'):
        raise RuntimeError('OSS version history is active/suspended; configure reviewed lifecycle retention before new backups')


def obsolete(keys, base, keep=KEEP):
    managed = sorted(set(k for k in keys if k.startswith(base) and NAME.fullmatch(k[len(base):])))
    return managed[:-keep] if len(managed) > keep else []


def prune_remote(call=api):
    check_versioning(call)
    base = prefix()
    keys = []
    token = None
    seen = set()
    while True:
        args = dict(prefix=base, max_keys=1000)
        if token:
            args['continuation_token'] = token
        result = call('list-objects-v2', **args)
        keys.extend(row['Key'] for row in result.get('Contents', []) if isinstance(row.get('Key'), str))
        if str(result.get('IsTruncated', '')).lower() != 'true':
            break
        token = result.get('NextContinuationToken')
        if not token or token in seen:
            raise RuntimeError('Incomplete OSS backup listing; no objects deleted')
        seen.add(token)
    remove = obsolete(keys, base)
    for key in remove:
        call('delete-object', key=key)
    return len(remove)


def prune_local(folder):
    root = Path(folder)
    paths = sorted(p for p in root.iterdir() if p.is_file() and not p.is_symlink() and NAME.fullmatch(p.name))
    for path in paths[:-KEEP]:
        path.unlink()
    return max(0, len(paths) - KEEP)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'prune'])
    parser.add_argument('--local', default='/var/lib/atom/backups')
    args = parser.parse_args()
    if args.action == 'check':
        check_versioning()
    else:
        remote = prune_remote()
        local = prune_local(args.local)
        print(json.dumps(dict(keep=KEEP, remote_deleted=remote, local_deleted=local)))
