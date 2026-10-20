"""Point the Mac ATOM Connect app and the ATOM device at a new relay URL, keeping tokens, pairing and Studio drafts.

Only valid after the relay databases were moved to that server (import-db.sh); tokens are reused, not re-issued.
Usage: python3 atom/connect/server/switch-clients.py mac|device [--url https://ldcx.tech/atom]
Quit ATOM Connect.app before `mac`. Every changed file is first copied to a timestamped backup.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

STAMP = time.strftime('%Y%m%dT%H%M%S')
DEVICE = ['ssh', '-p', '6223', '-i', os.path.expanduser('~/.ssh/atom_transparent_ed25519'),
          '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', 'linaro@150.158.146.192']


def scope(url, user_id):
    # Must match Studio.scope() in connect/computer/studio.mjs.
    return hashlib.sha256((url + '\0' + user_id).encode()).hexdigest()[:24]


def write_json(path, data):
    tmp = path.with_suffix('.tmp-switch')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def mac(url):
    root = Path.home() / 'Library/Application Support/ATOMConnect'
    if subprocess.run(['pgrep', '-f', 'ATOM Connect.app/Contents'], capture_output=True).returncode == 0:
        sys.exit('ATOM Connect.app is running; quit it first')
    backup = root / 'backups' / ('pre-switch-' + STAMP)
    backup.mkdir(parents=True)
    state_path, studio_path = root / 'state.json', root / 'studio.json'
    for p in (state_path, studio_path):
        shutil.copy2(p, backup / p.name)
    state = json.loads(state_path.read_text(encoding='utf-8'))
    old = state['config']['relay_url']
    state['config']['relay_url'] = url
    studio = json.loads(studio_path.read_text(encoding='utf-8'))
    account = studio.get('account')
    moved = []
    if account and account.get('relay_url') == old:
        user = account['user']['id']
        before, after = scope(old, user), scope(url, user)
        account['relay_url'] = url
        if before in studio.get('profiles', {}):
            studio['profiles'][after] = studio['profiles'].pop(before)
        for job in studio.get('jobs', {}).values():
            if job.get('scope') == before:
                job['scope'] = after
        src, dst = root / 'workspaces' / before, root / 'workspaces' / after
        if src.exists():
            if dst.exists():
                sys.exit('workspace %s already exists; nothing changed' % dst)
            moved.append((src, dst))
    write_json(studio_path, studio)
    write_json(state_path, state)
    for src, dst in moved:
        src.rename(dst)
    print('mac: %s -> %s, account %s, workspaces moved %d, backup %s' % (old, url, bool(account), len(moved), backup))


DEVICE_SCRIPT = r'''
import json, os, shutil, sys, time
url = sys.argv[1]
state = '/home/linaro/atom/state'
backup = os.path.join(state, 'backups', 'pre-switch-' + time.strftime('%Y%m%dT%H%M%S'))
os.makedirs(backup, mode=0o700)
for name in ('connect.json', 'market-account.json'):
    path = os.path.join(state, name)
    if not os.path.exists(path):
        continue
    shutil.copy2(path, os.path.join(backup, name))
    data = json.load(open(path, encoding='utf-8'))
    old = data.get('relay_url')
    data['relay_url'] = url
    tmp = path + '.tmp-switch'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    print('device:', name, old, '->', url)
print('backup', backup)
'''


def device(url):
    subprocess.run(DEVICE + ['python3', '-', url], input=DEVICE_SCRIPT, text=True, check=True)
    subprocess.run(DEVICE + ['sudo', '-n', 'systemctl', 'restart', 'atom'], check=True)
    print('device: atom service restarted')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('target', choices=['mac', 'device'])
    parser.add_argument('--url', default='https://ldcx.tech/atom')
    args = parser.parse_args()
    (mac if args.target == 'mac' else device)(args.url)
