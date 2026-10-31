"""Read-only desktop Hook summaries. SSH transports events; no new network listener."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time

EVENTS = {
    'SessionStart': ('connected', '会话已打开'),
    'UserPromptSubmit': ('running', '正在思考'),
    'PreToolUse': ('running', '正在使用工具'),
    'PostToolUse': ('running', '正在处理结果'),
    'PermissionRequest': ('needs_input', '请在电脑端审批'),
    'Stop': ('ready', '本轮任务已完成'),
    'SubagentStop': ('running', '子任务已返回'),
}
MAX_TASKS = 10
RETENTION = 2 * 60 * 60


def normalize(event, now=None):
    if not isinstance(event, dict):
        raise ValueError('Hook 必须为 JSON 对象')
    name = event.get('hook_event_name')
    session = event.get('session_id')
    if name not in EVENTS or not isinstance(session, str) or not 1 <= len(session) <= 128:
        raise ValueError('Hook 事件或会话无效')
    stamp = event.get('timestamp')
    now = time.time() if now is None else now
    if not isinstance(stamp, (float, int)) or isinstance(stamp, bool) or not now - RETENTION <= stamp <= now + 30:
        raise ValueError('Hook 时间无效或已过期')
    status, detail = EVENTS[name]
    project = event.get('project', 'Codex')
    turn = event.get('turn_id', '')
    if not isinstance(project, str) or not isinstance(turn, str) or len(turn) > 128:
        raise ValueError('Hook 字段无效')
    return dict(id=hashlib.sha256(session.encode()).hexdigest()[:24],
                project=' '.join(project.split())[:56] or 'Codex', status=status,
                detail=detail, updated_at=stamp, received_at=now, turn_id=turn,
                event=name, source='desktop')


def snapshot(root, now=None):
    now = time.time() if now is None else now
    path = Path(root) / 'codex-pet-desktop.json'
    if not path.exists():
        return dict(tasks=[], error='')
    try:
        if path.is_symlink() or path.stat().st_size > 32768:
            raise ValueError('unsafe state')
        rows = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(rows, list) or len(rows) > MAX_TASKS:
            raise ValueError('invalid state')
        tasks = []
        for row in rows:
            if not isinstance(row, dict) or row.get('status') not in {v[0] for v in EVENTS.values()}:
                raise ValueError('invalid task')
            stamp = row['updated_at']
            if not isinstance(stamp, (float, int)) or not now - RETENTION <= stamp <= now + 30:
                continue
            tasks.append({k: row[k] for k in ('id', 'project', 'status', 'detail', 'updated_at', 'received_at', 'turn_id', 'event', 'source')})
        return dict(tasks=tasks, error='')
    except (OSError, ValueError, KeyError, TypeError):
        return dict(tasks=[], error='桌面状态无法读取，请重新发送 Hook')


def receive(root, event, now=None):
    """Single-writer lock covers read/merge/replace, including concurrent Hook processes."""
    import fcntl
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError('unsafe state directory')
    task = normalize(event, now)
    flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
    with os.fdopen(os.open(str(root / '.codex-pet.lock'), flags, 0o600), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = snapshot(root, now)
        if current['error']:
            raise ValueError(current['error'])
        rows = current['tasks']
        old = next((r for r in rows if r['id'] == task['id']), None)
        if old and (old['updated_at'] >= task['updated_at'] or
                    task['event'] == 'SessionStart' and old['status'] != 'connected' or
                    old['turn_id'] and task['turn_id'] and old['turn_id'] != task['turn_id'] and task['event'] != 'UserPromptSubmit' or
                    old['event'] == 'Stop' and old['turn_id'] and old['turn_id'] == task['turn_id'] and task['event'] not in ('Stop', 'UserPromptSubmit')):
            return dict(ok=True, ignored=True)
        rows = sorted([r for r in rows if r['id'] != task['id']] + [task], key=lambda r: r['updated_at'], reverse=True)[:MAX_TASKS]
        fd, name = tempfile.mkstemp(prefix='.codex-pet-', dir=str(root))
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                json.dump(rows, handle, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, str(root / 'codex-pet-desktop.json'))
        finally:
            if os.path.exists(name):
                os.unlink(name)
    return dict(ok=True)
