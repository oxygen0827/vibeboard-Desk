#!/usr/bin/env python3
"""Bounded, passive BSP evidence recorder. Never changes display or power state."""
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import time

ROOT = Path('/var/lib/atom/display-health')

def read(path, limit=16384):
    try:
        with Path(path).open() as stream:
            return stream.read(limit).strip()
    except OSError:
        return ''

def sample():
    summary = read('/sys/kernel/debug/dri/0/summary')
    memory = dict(line.split(':', 1) for line in read('/proc/meminfo').splitlines() if ':' in line)
    processes = []
    for proc in Path('/proc').glob('[0-9]*'):
        name = read(proc / 'comm', 100)
        if name not in ('Xorg', 'X', 'chromium-bin', 'chromium'):
            continue
        stat = read(proc / 'stat').rsplit(')', 1)
        if len(stat) != 2 or not stat[1].split():
            continue
        state = stat[1].split()[0]
        if name in ('Xorg', 'X') or state == 'D':
            row = dict(pid=int(proc.name), name=name, state=state, wait=read(proc/'wchan', 256))
            if state == 'D':
                row['stack'] = read(proc/'stack', 8192)
            processes.append(row)
    return dict(time=time.time(), boot=read('/proc/sys/kernel/random/boot_id', 100),
                uptime=read('/proc/uptime', 100), temperature=read('/sys/class/thermal/thermal_zone0/temp', 100),
                available_kb=memory.get('MemAvailable', '').strip(), display=summary,
                processes=processes)

def main():
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger('display-health')
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(str(ROOT/'samples.jsonl'), maxBytes=1024*1024, backupCount=3)
    logger.addHandler(handler)
    while True:
        try:
            logger.info(json.dumps(sample(), separators=(',', ':')))
        except Exception as exc:
            logger.error(json.dumps({'time':time.time(), 'error':type(exc).__name__}))
        time.sleep(10)

if __name__ == '__main__':
    main()
