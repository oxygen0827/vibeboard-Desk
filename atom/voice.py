"""User initiated PulseAudio recording; never records during status checks."""
import re
import subprocess
import threading
import time
import wave
import uuid
from pathlib import Path

MAX_BYTES = 5 * 1024 * 1024
RECORDING_ID = re.compile(r'^[0-9a-f]{32}$')


class VoiceRecorder:
    def __init__(self, state_dir):
        self.root = Path(state_dir) / 'recordings'
        self.lock = threading.RLock()
        self.process = None
        self.timer = None
        self.module = None
        self.recording_id = None
        self.error = None
        self.fan_quiet = False
        self.fan_timer = None

    def _run(self, args):
        return subprocess.check_output(args, stderr=subprocess.DEVNULL, timeout=5).decode('utf-8').strip()

    def _sources(self):
        return [line.split('\t')[1] for line in self._run(['pactl','list','short','sources']).splitlines()
                if len(line.split('\t')) > 1 and not line.split('\t')[1].endswith('.monitor')]

    def public_status(self):
        with self.lock:
            try: sources=self._sources()
            except (OSError,subprocess.SubprocessError): sources=[]
            return dict(recording=self.process is not None,recording_id=self.recording_id,
                        available=bool(sources),sources=sources,error=self.error,max_seconds=30)

    def _unload(self):
        if self.module:
            try: self._run(['pactl','unload-module',self.module])
            except (OSError,subprocess.SubprocessError): pass
            self.module=None

    def start(self, quiet_fan=False):
        with self.lock:
            if self.process is not None: raise ValueError('recording already active')
            self.error=None
            try:
                if quiet_fan:
                    try: self.fan_quiet = bool(self._fan('off').get('quiet'))
                    except (OSError,ValueError): self.fan_quiet = False
                sources=self._sources()
                if not sources:
                    # Temporary route only when the user explicitly starts recording.
                    self.module=self._run(['pactl','load-module','module-alsa-source','device=hw:0,0','source_name=atom_mic'])
                    if not self.module.isdigit(): raise ValueError('invalid PulseAudio module id')
                    sources=self._sources()
                if not sources: raise ValueError('microphone unavailable')
                self.root.mkdir(parents=True,exist_ok=True)
                self.root.chmod(0o700)
                self.recording_id=uuid.uuid4().hex
                path=self.root/(self.recording_id+'.wav')
                with path.open('xb'):
                    pass
                path.chmod(0o600)
                self.process=subprocess.Popen(['parec','--device='+sources[0],'--rate=16000','--channels=1',
                    '--format=s16le','--latency-msec=50','--process-time-msec=10','--file-format=wav',str(path)],stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                deadline=time.monotonic()+2
                while path.stat().st_size<=44:
                    if self.process.poll() is not None or time.monotonic()>=deadline:
                        self.process.terminate();self.process.wait(timeout=3);self.process=None
                        raise ValueError('microphone not producing audio')
                    time.sleep(.02)
                if Path('/etc/atom/mic-single-ended.enabled').exists():
                    self._single_ended()
                self.timer=threading.Timer(30,self._auto_stop,args=(self.recording_id,))
                self.timer.daemon=True; self.timer.start()
                if self.fan_quiet:self._fan_heartbeat(self.recording_id)
                return dict(recording=True,recording_id=self.recording_id,max_seconds=30,fan_quiet=self.fan_quiet)
            except (OSError,subprocess.SubprocessError,ValueError):
                if self.process is not None:
                    try:
                        self.process.terminate();self.process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        self.process.kill();self.process.wait(timeout=2)
                    except OSError:pass
                    self.process=None
                self._restore_fan()
                self._unload(); self.error='microphone unavailable'
                raise ValueError(self.error)

    def _auto_stop(self, recording_id):
        with self.lock:
            if self.recording_id==recording_id: self.stop()

    def stop(self, recording_id=None):
        with self.lock:
            if recording_id is not None:
                if not isinstance(recording_id,str) or not RECORDING_ID.fullmatch(recording_id):raise ValueError('invalid recording id')
                if recording_id!=self.recording_id:return dict(recording=self.process is not None,recording_id=self.recording_id,ignored=True)
            if self.timer: self.timer.cancel(); self.timer=None
            process=self.process
            if process:
                process.terminate()
                try: process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill();process.wait(timeout=3)
                self.process=None
            self._restore_fan()
            self._unload()
            path=self.root/(self.recording_id+'.wav') if self.recording_id else None
            if path and path.is_file():
                try:
                    with wave.open(str(path),'rb') as wav:
                        params=wav.getparams();limit=wav.getframerate()*30;data=wav.readframes(limit+1)
                    frame_size=params.nchannels*params.sampwidth
                    if len(data)>limit*frame_size:
                        with wave.open(str(path),'wb') as wav:
                            wav.setparams(params);wav.writeframes(data[:limit*frame_size])
                except (wave.Error,EOFError,OSError):pass
            size=path.stat().st_size if path and path.is_file() else 0
            if size>MAX_BYTES:
                path.unlink();self.error='recording too large';size=0
            return dict(recording=False,recording_id=self.recording_id,bytes=size,error=self.error)

    def recording_path(self, recording_id):
        with self.lock:
            if not isinstance(recording_id,str) or not RECORDING_ID.fullmatch(recording_id):
                raise ValueError('invalid recording id')
            if self.process and recording_id==self.recording_id: raise ValueError('recording still active')
            path=self.root/(recording_id+'.wav')
            if path.is_symlink() or not path.is_file() or path.stat().st_size>MAX_BYTES:
                raise ValueError('recording unavailable')
            return path

    def meter(self, recording_id):
        import array
        import math
        with self.lock:
            if recording_id != self.recording_id: raise ValueError('recording unavailable')
            path = self.root / (recording_id + '.wav')
            if path.is_symlink() or not path.is_file(): raise ValueError('recording unavailable')
            # Pulse writes a standard PCM WAV; locate data instead of assuming a 44-byte header.
            import struct
            with path.open('rb') as f:
                if f.read(4) != b'RIFF': raise ValueError('invalid recording')
                f.read(8)
                while True:
                    header=f.read(8)
                    if len(header)!=8: raise ValueError('audio not ready')
                    tag,size=struct.unpack('<4sI',header)
                    if tag==b'data': break
                    f.seek(size+(size%2),1)
                offset=f.tell();total=max(0,path.stat().st_size-offset)
                count=min(total,6400) if self.process else total
                count-=count%2;f.seek(offset+total-count);raw=f.read(count)
            pcm=array.array('h',raw)
            import sys
            if sys.byteorder!='little': pcm.byteswap()
            peak=max((abs(x) for x in pcm),default=0)
            rms=math.sqrt(sum(x*x for x in pcm)/max(1,len(pcm)))
            return dict(recording=self.process is not None,seconds=round(total/32000,2),
                        rms_db=round(20*math.log10(max(1,rms)/32768),1),
                        peak_db=round(20*math.log10(max(1,peak)/32768),1),
                        clipping=round(sum(abs(x)>=32760 for x in pcm)/max(1,len(pcm))*100,3),
                        playing=getattr(self,'playback',None) is not None and self.playback.poll() is None)

    def stop_playback(self):
        with self.lock:
            playback=getattr(self,'playback',None)
            if playback and playback.poll() is None:
                playback.terminate()
                try: playback.wait(timeout=2)
                except subprocess.TimeoutExpired: playback.kill();playback.wait(timeout=2)
            self.playback=None
            return dict(ok=True)

    def play_recording(self, recording_id):
        with self.lock:
            path=self.recording_path(recording_id)
            self.stop_playback()
            self.playback=subprocess.Popen(['paplay',str(path)],stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            return dict(playing=True)

    def _single_ended(self):
        import socket,json
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
            client.settimeout(5);client.connect('/run/atom-mic-mode.sock');client.sendall(b'apply')
            result=json.loads(client.recv(4096).decode())
            if result.get('mode')!='single-ended':raise ValueError('codec configuration failed')

    def _fan(self, action):
        import socket,json
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
            client.settimeout(2);client.connect('/run/atom-fan.sock');client.sendall(action.encode())
            return json.loads(client.recv(4096).decode())

    def _fan_heartbeat(self, recording_id):
        with self.lock:
            if self.process is None or self.recording_id!=recording_id or not self.fan_quiet:return
            try:
                if not self._fan('status').get('quiet'):
                    self.fan_quiet=False;return
            except (OSError,ValueError):
                self.fan_quiet=False;return
            self.fan_timer=threading.Timer(2,self._fan_heartbeat,args=(recording_id,))
            self.fan_timer.daemon=True;self.fan_timer.start()

    def _restore_fan(self):
        if self.fan_timer:self.fan_timer.cancel();self.fan_timer=None
        if self.fan_quiet:
            self.fan_quiet=False
            try:self._fan('auto')
            except (OSError,ValueError):pass
