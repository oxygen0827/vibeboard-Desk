"""Read-only sensor snapshots. No GPIO probing, bus writes, identity or occupancy history.

IIO acceleration follows the Linux ABI: (raw + offset) * scale, in m/s².
Optional hardware adapters atomically replace /run/atom/sensors.json (schema in docs).
Unknown, stale and disconnected are never translated into 'nobody is here'.
"""
import json
import math
import os
import stat
import threading
import time
from pathlib import Path


def number(value, limit=200):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or abs(value) > limit or not math.isfinite(value):
        raise ValueError('invalid sensor number')
    return float(value)


class Sensors:
    def __init__(self, iio='/sys/bus/iio/devices', adapter=None, clock=time.time, monotonic=time.monotonic):
        self.iio = Path(iio)
        self.adapter = Path(adapter or os.environ.get('ATOM_SENSOR_INPUT', '/run/atom/sensors.json'))
        self.clock, self.monotonic = clock, monotonic
        self.lock = threading.Lock()
        self.cached, self.sample_time = None, -1
        self.filtered = None
        self.last_motion = None
        self.candidate, self.candidate_since, self.present = None, 0, None

    def adapter_snapshot(self):
        fd = os.open(str(self.adapter), os.O_RDONLY | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0))
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > 2048:
                raise ValueError('invalid adapter file')
            raw = os.read(fd, 2049)
            if len(raw) > 2048:
                raise ValueError('adapter too large')
            data = json.loads(raw)
        finally:
            os.close(fd)
        if not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] != 1:
            raise ValueError('invalid adapter schema')
        stamp = number(data.get('updated_at'), 1e15)
        age = self.clock() * 1000 - stamp
        if not -1000 <= age <= 3000:
            raise ValueError('stale sensor adapter')
        return data

    @staticmethod
    def read_number(path):
        with path.open() as handle:
            value = float(handle.read(80).strip())
        return number(value, 1e12)

    def acceleration(self):
        devices = [p for p in self.iio.glob('iio:device*')
                   if (p / 'in_accel_x_raw').exists() or (p / 'in_accel_x_input').exists()]
        if len(devices) != 1:
            return None
        device, values = devices[0], []
        for axis in 'xyz':
            prefix = 'in_accel_' + axis
            if (device / (prefix + '_input')).exists():
                value = self.read_number(device / (prefix + '_input'))
            else:
                raw = self.read_number(device / (prefix + '_raw'))
                scale_path = device / (prefix + '_scale')
                if not scale_path.exists():
                    scale_path = device / 'in_accel_scale'
                scale = self.read_number(scale_path)
                if scale <= 0:
                    raise ValueError('invalid scale')
                offset_path = device / (prefix + '_offset')
                if not offset_path.exists():
                    offset_path = device / 'in_accel_offset'
                offset = self.read_number(offset_path) if offset_path.exists() else 0
                value = (raw + offset) * scale
            values.append(number(value))
        return values

    def motion(self, xyz, now):
        # Tilt is derived from gravity; vigorous movement is not accurate orientation tracking.
        length = math.sqrt(sum(x * x for x in xyz))
        if not 1 <= length <= 100:
            self.filtered = self.last_motion = None
            return None
        gap = now - self.last_motion[0] if self.last_motion else 1
        alpha = 1 - math.exp(-max(0, gap) / .12)
        previous = self.last_motion[1] if self.last_motion else xyz
        moving = abs(length - 9.80665) > 1.4 or math.sqrt(sum((a-b)**2 for a, b in zip(xyz, previous))) > .8
        self.filtered = [v if self.filtered is None or gap > 1 else old + alpha * (v-old)
                         for v, old in zip(xyz, self.filtered or xyz)]
        self.last_motion = (now, xyz)
        x, y, z = self.filtered
        return dict(roll=round(math.degrees(math.atan2(y, z)), 2),
                    pitch=round(math.degrees(math.atan2(-x, math.hypot(y, z))), 2),
                    ax=round(xyz[0], 3), ay=round(xyz[1], 3), az=round(xyz[2], 3), moving=moving)

    def presence(self, value, now):
        if type(value) is not bool:
            self.present = self.candidate = None
            return None
        if value != self.candidate:
            self.candidate, self.candidate_since = value, now
        if now - self.candidate_since >= (.25 if value else 2):
            self.present = value
        return None if self.present is None else {'present': self.present}

    def snapshot(self):
        with self.lock:
            now = self.monotonic()
            if self.cached is not None and 0 <= now - self.sample_time < .05:
                return json.loads(json.dumps(self.cached))
            adapter = {}
            try:
                adapter = self.adapter_snapshot()
            except (OSError, ValueError, TypeError):
                pass
            presence = self.presence(adapter.get('presence'), now)
            motion = None
            try:
                accel = adapter.get('acceleration')
                if accel is not None:
                    if not isinstance(accel, list) or len(accel) != 3:
                        raise ValueError('invalid acceleration')
                    xyz = [number(x) for x in accel]
                else:
                    xyz = self.acceleration()
                if xyz is not None:
                    motion = self.motion(xyz, now)
            except (OSError, ValueError, TypeError):
                pass
            if motion is None:
                self.filtered = self.last_motion = None
            available = dict(presence=presence is not None, motion=motion is not None)
            self.cached = dict(version=1, source='device' if any(available.values()) else 'unavailable',
                               available=available, presence=presence, motion=motion,
                               updated_at=round(self.clock() * 1000))
            self.sample_time = now
            return json.loads(json.dumps(self.cached))
