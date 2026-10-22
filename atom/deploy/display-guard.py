#!/usr/bin/env python3
"""Bounded scanout recovery. Never hot-restart Xorg on the vendor BSP."""
import os,subprocess,time,json
from pathlib import Path
SUMMARY=Path('/sys/kernel/debug/dri/0/summary')
DIAGNOSTICS=Path('/var/lib/atom/display-diagnostics.json')
def missing_scanout(text):
    return 'Video Port1: ACTIVE' in text and 'DSI-1' in text and not any('win' in line.lower() and ': ACTIVE' in line for line in text.splitlines())
def run(args,env=None):
    return subprocess.run(args,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=12).returncode

def capture_diagnostics(summary, root=Path('/proc')):
    result={'time':int(time.time()),'scanout':summary[:16384],'xorg':[]}
    for entry in root.iterdir():
        if not entry.name.isdigit():continue
        try:
            if entry.joinpath('comm').read_text().strip() not in ('Xorg','X'):continue
            stat=entry.joinpath('stat').read_text().rsplit(')',1)[1].split()
            record={'pid':int(entry.name),'state':stat[0]}
            for name in ('wchan','stack'):
                try:record[name]=entry.joinpath(name).read_text()[:8192]
                except OSError:pass
            result['xorg'].append(record)
        except (OSError,IndexError):pass
    return result

def recover_output(summary):
    evidence=capture_diagnostics(summary)
    try:
        DIAGNOSTICS.parent.mkdir(parents=True,exist_ok=True)
        fd=os.open(str(DIAGNOSTICS),os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as f:json.dump(evidence,f)
    except OSError:pass
    if any(p['state']=='D' for p in evidence['xorg']):
        print('Xorg is blocked in the kernel; saved diagnostics. A planned device reboot is required.',flush=True)
        return False
    env=dict(os.environ,DISPLAY=':0',XAUTHORITY='/home/linaro/.Xauthority')
    run(['xrandr','--output','DSI-1','--off'],env)
    run(['xrandr','--output','DSI-1','--mode','480x360'],env)
    time.sleep(2)
    recovered=not missing_scanout(SUMMARY.read_text())
    if not recovered:
        print('Scanout did not recover; saved diagnostics. Avoiding a LightDM restart on this BSP.',flush=True)
    return recovered

def main():
    failures=0;last_recovery=0;attempted=False
    while True:
        time.sleep(3)
        try:
            if run(['pgrep','-f','^/bin/sh /home/linaro/atom/deploy/atom-session.sh'])!=0:
                failures=0;continue
            if not SUMMARY.exists():continue
            bad=missing_scanout(SUMMARY.read_text())
            if not bad:attempted=False
            failures=failures+1 if bad else 0
            if failures<2 or attempted or time.monotonic()-last_recovery<60:continue
            last_recovery=time.monotonic();failures=0;attempted=True
            print('Active DSI has no scanout plane; restoring output',flush=True)
            recover_output(SUMMARY.read_text())
        except (OSError,subprocess.SubprocessError) as exc:
            print('Display recovery check failed: '+type(exc).__name__,flush=True)
if __name__=='__main__':main()
