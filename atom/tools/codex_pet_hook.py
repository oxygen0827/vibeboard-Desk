#!/usr/bin/env python3
"""Forward only Codex status metadata over the user's existing SSH connection."""
import argparse
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time


def payload(event):
    # Never forward prompt, command, tool input, credentials, or full workspace path.
    allowed = {'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SubagentStop'}
    if not isinstance(event, dict) or event.get('hook_event_name') not in allowed:
        raise ValueError('unsupported Hook')
    session = event.get('session_id')
    turn = event.get('turn_id', '')
    if not isinstance(session, str) or not 1 <= len(session) <= 128 or not isinstance(turn, str) or len(turn) > 128:
        raise ValueError('invalid session')
    cwd = event.get('cwd')
    return dict(hook_event_name=event['hook_event_name'], session_id=session, turn_id=turn,
                project=Path(cwd).name[:56] if isinstance(cwd, str) else 'Codex', timestamp=time.time())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--ssh-host', help='Existing SSH alias or user@host; never include a password')
    p.add_argument('--ssh-port', type=int, help='Optional port override; otherwise use SSH configuration')
    p.add_argument('--identity-file', type=Path, help='Optional local SSH private-key path; never copied into the app')
    p.add_argument('--remote-root', default='/home/linaro/atom')
    p.add_argument('--receive', action='store_true', help='Device-side receiver, not a Codex hook')
    p.add_argument('--state-dir', type=Path)
    args = p.parse_args()
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise ValueError('Hook too large')
        event = json.loads(raw)
        if args.receive:
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from codex_pet import receive
            result = receive(args.state_dir or Path(__file__).resolve().parents[1] / 'state', event)
            print(json.dumps(result))
            return 0
        if not args.ssh_host or not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,200}', args.ssh_host):
            raise ValueError('Set a valid --ssh-host')
        if args.ssh_port is not None and not 1 <= args.ssh_port <= 65535:
            raise ValueError('invalid SSH port')
        if not args.remote_root.startswith('/') or '\n' in args.remote_root:
            raise ValueError('Set an absolute --remote-root')
        command = 'python3 ' + shlex.quote(args.remote_root.rstrip('/') + '/tools/codex_pet_hook.py') + ' --receive'
        ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=3']
        # Leave port selection to an existing SSH alias unless explicitly supplied.
        if args.ssh_port is not None:
            ssh.extend(['-p', str(args.ssh_port)])
        if args.identity_file:
            ssh.extend(['-i', str(args.identity_file.expanduser())])
        result = subprocess.run(ssh + [args.ssh_host, command],
                                input=json.dumps(payload(event)).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        if result.returncode or json.loads(result.stdout).get('ok') is not True:
            raise ValueError('Hook not acknowledged')
    except (ValueError, OSError, subprocess.TimeoutExpired):
        # Hook failures must never interrupt the coding task or leak private inputs.
        print('ATOM 宠物状态未送达；请检查 SSH 与设备接收脚本。', file=sys.stderr)
        return 0 if not args.receive else 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
