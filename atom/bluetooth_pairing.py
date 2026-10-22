"""Bounded, user-owned BlueZ pairing sessions; no default agent and no implicit pairing.

The D-Bus worker runs separately so the web server never blocks its event loop on a PIN dialog.
Only the caller's selected Device1 may request input. PINs travel through private pipes, never logs
or persisted state. Protocol: BlueZ 5.50 doc/agent-api.txt and doc/device-api.txt.
"""
import json
import re
import subprocess
import sys
import threading
import time

MAC = re.compile(r'^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$')
ID = re.compile(r'^[a-f0-9]{32}$')
ACTIVE = {'starting', 'pairing', 'connecting', 'waiting'}
TERMINAL = {'connected', 'cancelled', 'expired', 'failed'}
TTL, LEASE = 180, 20


class PairingError(Exception):
    pass


def answer(kind, value):
    if kind == 'pin':
        if not isinstance(value, str) or not re.fullmatch(r'[\x21-\x7e]{1,16}', value):
            raise PairingError('请输入 1–16 位字母、数字或符号的 PIN 码')
        return value
    if kind == 'passkey':
        if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,6}', value):
            raise PairingError('请输入 0–999999 之间的数字配对码')
        return int(value)
    if kind in ('confirm', 'authorize', 'service'):
        if type(value) is not bool:
            raise PairingError('请明确选择允许或拒绝')
        return value
    raise PairingError('这一步只需在外设上操作，无需提交')


class ProcessWorker:
    def __init__(self, address, receive):
        self.receive = receive
        self.lock = threading.Lock()
        self.process = subprocess.Popen([sys.executable, '-u', __file__, '--worker', address],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.process.stdout:
                if len(line) > 4096:
                    break
                self.receive(json.loads(line))
        except (ValueError, OSError):
            pass
        finally:
            self.receive({'event': 'exit'})
            self.process.stdout.close()

    def send(self, data):
        with self.lock:
            try:
                self.process.stdin.write(json.dumps(data) + '\n')
                self.process.stdin.flush()
            except (OSError, ValueError):
                raise PairingError('蓝牙配对进程已结束，请重试')

    def alive(self):
        return self.process.poll() is None

    def kill(self):
        if self.alive():
            self.process.kill()
        try:
            self.process.stdin.close()
        except OSError:
            pass


class PairingManager:
    def __init__(self, factory=ProcessWorker, clock=time.monotonic, watchdog=True):
        self.factory, self.clock = factory, clock
        self.jobs, self.lock = {}, threading.RLock()
        if watchdog:
            threading.Thread(target=self._watch, daemon=True).start()

    def _watch(self):
        while True:
            time.sleep(1)
            self.expire()

    def _id(self, value):
        if not isinstance(value, str) or not ID.fullmatch(value):
            raise PairingError('配对请求无效，请重新选择设备')
        return value

    def _view(self, job):
        return {k: job[k] for k in ('id', 'address', 'name', 'state', 'challenge', 'error')}

    def _job(self, ident):
        job = self.jobs.get(self._id(ident))
        if not job:
            raise PairingError('配对请求已过期，请重新选择设备')
        return job

    def _stop(self, job, state, message=''):
        job.update(state=state, error=message, challenge=None, ended=self.clock())
        if job.get('worker'):
            try:
                job['worker'].send({'action': 'cancel'})
            except PairingError:
                pass

    def expire(self):
        with self.lock:
            now = self.clock()
            for ident, job in list(self.jobs.items()):
                if job['state'] in ACTIVE and (now >= job['deadline'] or now - job['seen'] >= LEASE):
                    self._stop(job, 'expired', '配对已超时或页面已离开，请让外设进入配对模式后重试')
                if job['state'] in TERMINAL:
                    if job.get('worker') and now - job['ended'] >= 3:
                        job['worker'].kill()
                    if now - job['ended'] >= 60:
                        del self.jobs[ident]

    def start(self, address, confirm, ident):
        self._id(ident)
        if confirm is not True:
            raise PairingError('请先确认要连接的外设')
        if not isinstance(address, str) or not MAC.fullmatch(address.upper()):
            raise PairingError('设备地址无效')
        address = address.upper()
        with self.lock:
            self.expire()
            existing = self.jobs.get(ident)
            if existing:
                if existing['address'] and existing['address'] != address:
                    raise PairingError('这次请求已用于另一台设备')
                return self._view(existing)  # retries and cancel-before-start are idempotent
            if any(j['state'] in ACTIVE or j.get('worker') and j['worker'].alive() for j in self.jobs.values()):
                raise PairingError('正在结束上一次配对，请稍候再试')
            if len(self.jobs) >= 32:
                raise PairingError('配对操作过于频繁，请稍后再试')
            now = self.clock()
            job = dict(id=ident, address=address, name=address, state='starting', challenge=None,
                       error='', seen=now, deadline=now + TTL, worker=None)
            self.jobs[ident] = job
            try:
                job['worker'] = self.factory(address, lambda event: self._receive(ident, event))
            except (OSError, PairingError):
                self._stop(job, 'failed', '无法启动蓝牙配对，请检查系统蓝牙服务')
            return self._view(job)

    def _receive(self, ident, event):
        with self.lock:
            job = self.jobs.get(ident)
            if not job or job['state'] not in ACTIVE:
                return
            if event.get('event') == 'exit':
                self._stop(job, 'failed', '蓝牙配对进程已结束，请检查蓝牙后重试')
                return
            state = event.get('state')
            if state not in ACTIVE | TERMINAL:
                return
            job.update(state=state, challenge=event.get('challenge'), error=str(event.get('error', ''))[:180])
            if event.get('name'):
                job['name'] = str(event['name'])[:60]
            if state in TERMINAL:
                job.update(challenge=None, ended=self.clock())

    def poll(self, ident):
        with self.lock:
            self.expire()
            job = self._job(ident)
            job['seen'] = self.clock()
            return self._view(job)

    def respond(self, ident, challenge, value):
        with self.lock:
            self.expire()
            job = self._job(ident)
            prompt = job.get('challenge')
            if job['state'] != 'waiting' or not prompt or type(challenge) is not int or challenge != prompt['id']:
                raise PairingError('配对步骤已变化，请查看当前提示')
            validated = answer(prompt['kind'], value)
            job['worker'].send({'action': 'respond', 'challenge': challenge, 'value': validated})
            job.update(state='pairing', challenge=None, seen=self.clock())
            return self._view(job)

    def cancel(self, ident):
        with self.lock:
            self.expire()
            ident = self._id(ident)
            if ident not in self.jobs:
                if len(self.jobs) >= 32:
                    raise PairingError('配对操作过于频繁，请稍后再试')
                self.jobs[ident] = dict(id=ident, address='', name='', state='cancelled', challenge=None,
                                       error='', ended=self.clock(), worker=None)
            job = self.jobs[ident]
            if job['state'] in ACTIVE:
                self._stop(job, 'cancelled')
            return self._view(job)


_singleton, _singleton_lock = None, threading.Lock()


def manager():
    global _singleton
    with _singleton_lock:
        if _singleton is None:
            _singleton = PairingManager()
        return _singleton


def run_agent(address):
    """Private worker protocol. No code or error emitted here includes an entered PIN."""
    def emit(state, **fields):
        print(json.dumps(dict(state=state, **fields)), flush=True)
    try:
        import dbus
        import dbus.service
        from dbus.mainloop.glib import DBusGMainLoop
        from gi.repository import GLib
    except ImportError:
        emit('failed', error='系统缺少 python3-dbus 或 python3-gi，请更新设备的蓝牙支持')
        return
    DBusGMainLoop(set_as_default=True)
    bus = None
    loop = GLib.MainLoop()
    ctx = dict(device=None, properties=None, path=None, owner=None, agent=None, registered=False,
               pending=None, challenge=0, phase='pairing', closing=False, finished=False, initial_connected=False)
    iface = 'org.bluez.Device1'
    agent_path = '/org/atom/PairingAgent'

    class Rejected(dbus.DBusException):
        _dbus_error_name = 'org.bluez.Error.Rejected'

    class Cancelled(dbus.DBusException):
        _dbus_error_name = 'org.bluez.Error.Canceled'

    def clear_pending(reason=None):
        pending, ctx['pending'] = ctx['pending'], None
        if pending:
            pending['reject'](reason or Cancelled('Request cancelled'))

    def cleanup(state, message=''):
        if ctx['closing']:
            return
        ctx['closing'] = True
        clear_pending()
        def done():
            if ctx['registered']:
                try:
                    ctx['manager'].UnregisterAgent(agent_path, timeout=2)
                except dbus.DBusException:
                    pass
            ctx['registered'] = False
            ctx['finished'] = True
            emit(state, error=message)
            loop.quit()
            return False
        if state != 'connected' and ctx['device']:
            ctx['device'].CancelPairing(reply_handler=lambda: None, error_handler=lambda e: None, timeout=2)
            if ctx['phase'] == 'connecting' and not ctx['initial_connected']:
                ctx['device'].Disconnect(reply_handler=lambda: None, error_handler=lambda e: None, timeout=2)
            GLib.timeout_add(200, done)
        else:
            done()

    def failure(error):
        name = error.get_dbus_name() if hasattr(error, 'get_dbus_name') else ''
        messages = {'AuthenticationRejected': '对方拒绝了配对，请在外设上确认后重试',
                    'AuthenticationCanceled': '配对已取消，请重新连接',
                    'AuthenticationFailed': '配对码不匹配或认证失败，请重试',
                    'AuthenticationTimeout': '等待外设确认超时，请重试',
                    'NotReady': '蓝牙尚未开启，请打开蓝牙后重试',
                    'InProgress': '设备正在处理另一项连接，请稍后重试',
                    'ConnectionAttemptFailed': '没有连上外设，请确认它已开机并进入配对模式',
                    'AccessDenied': '没有使用蓝牙的权限，请更新设备蓝牙授权',
                    'NoReply': '外设没有及时响应，请靠近设备后重试'}
        message = messages.get(name.rsplit('.', 1)[-1], '蓝牙连接未完成，请确认外设可连接后重试')
        if ctx['phase'] == 'connecting':
            message = '已配对，' + message
        cleanup('failed', message)

    def check(device, sender):
        if ctx['closing'] or str(device) != ctx['path'] or str(sender) != ctx['owner']:
            raise Rejected('This device was not selected')

    def prompt(kind, device, sender, reply, reject, **details):
        try:
            check(device, sender)
            clear_pending()
            ctx['challenge'] += 1
            ctx['pending'] = dict(id=ctx['challenge'], kind=kind, reply=reply, reject=reject)
            emit('waiting', challenge=dict(id=ctx['challenge'], kind=kind, **details))
        except dbus.DBusException as exc:
            reject(exc)

    def display(kind, device, sender, **details):
        check(device, sender)
        ctx['challenge'] += 1
        emit('waiting', challenge=dict(id=ctx['challenge'], kind=kind, **details))

    class Agent(dbus.service.Object):
        @dbus.service.method('org.bluez.Agent1', in_signature='', out_signature='', sender_keyword='sender')
        def Release(self, sender=None):
            if str(sender) != ctx['owner']:
                raise Rejected('Unknown sender')
            ctx['registered'] = False
            cleanup('failed', '系统结束了配对代理，请重试')

        @dbus.service.method('org.bluez.Agent1', in_signature='o', out_signature='s',
                             async_callbacks=('reply', 'reject'), sender_keyword='sender')
        def RequestPinCode(self, device, reply, reject, sender=None):
            prompt('pin', device, sender, reply, reject)

        @dbus.service.method('org.bluez.Agent1', in_signature='o', out_signature='u',
                             async_callbacks=('reply', 'reject'), sender_keyword='sender')
        def RequestPasskey(self, device, reply, reject, sender=None):
            prompt('passkey', device, sender, reply, reject)

        @dbus.service.method('org.bluez.Agent1', in_signature='ou', out_signature='',
                             async_callbacks=('reply', 'reject'), sender_keyword='sender')
        def RequestConfirmation(self, device, passkey, reply, reject, sender=None):
            prompt('confirm', device, sender, reply, reject, code='%06d' % passkey)

        @dbus.service.method('org.bluez.Agent1', in_signature='os', out_signature='', sender_keyword='sender')
        def DisplayPinCode(self, device, pincode, sender=None):
            display('display-pin', device, sender, code=str(pincode)[:16])

        @dbus.service.method('org.bluez.Agent1', in_signature='ouq', out_signature='', sender_keyword='sender')
        def DisplayPasskey(self, device, passkey, entered, sender=None):
            display('display-passkey', device, sender, code='%06d' % passkey, entered=min(6, int(entered)))

        @dbus.service.method('org.bluez.Agent1', in_signature='o', out_signature='',
                             async_callbacks=('reply', 'reject'), sender_keyword='sender')
        def RequestAuthorization(self, device, reply, reject, sender=None):
            prompt('authorize', device, sender, reply, reject)

        @dbus.service.method('org.bluez.Agent1', in_signature='os', out_signature='',
                             async_callbacks=('reply', 'reject'), sender_keyword='sender')
        def AuthorizeService(self, device, uuid, reply, reject, sender=None):
            prompt('service', device, sender, reply, reject, service=str(uuid)[:64])

        @dbus.service.method('org.bluez.Agent1', in_signature='', out_signature='', sender_keyword='sender')
        def Cancel(self, sender=None):
            if str(sender) != ctx['owner']:
                raise Rejected('Unknown sender')
            clear_pending()
            if not ctx['closing']:
                emit(ctx['phase'], challenge=None)

    def connected():
        if ctx['closing']:
            return
        try:
            if not bool(ctx['properties'].Get(iface, 'Connected', timeout=3)):
                raise PairingError('not connected')
            ctx['properties'].Set(iface, 'Trusted', dbus.Boolean(True), timeout=3)
            cleanup('connected')
        except (dbus.DBusException, PairingError) as exc:
            failure(exc)

    def connect():
        if ctx['closing']:
            return
        ctx['phase'] = 'connecting'
        clear_pending()
        emit('connecting', challenge=None)
        ctx['device'].Connect(reply_handler=connected, error_handler=lambda e: connected() if e.get_dbus_name().endswith('.AlreadyConnected') else failure(e), timeout=30)

    def command(source, condition):
        if condition & GLib.IO_IN:
            line = source.readline(2048)
            if not line:
                cleanup('cancelled')
                return False
            try:
                value = json.loads(line)
                if value.get('action') == 'cancel':
                    cleanup('cancelled')
                    return False
                pending = ctx['pending']
                if value.get('action') == 'respond' and pending and value.get('challenge') == pending['id']:
                    raw = value.get('value')
                    # Manager validates, worker independently enforces the typed D-Bus boundary.
                    checked = answer(pending['kind'], str(raw) if pending['kind'] == 'passkey' and type(raw) is int else raw)
                    ctx['pending'] = None
                    if pending['kind'] in ('pin', 'passkey'):
                        pending['reply'](dbus.UInt32(checked) if pending['kind'] == 'passkey' else checked)
                    elif checked:
                        pending['reply']()
                    else:
                        pending['reject'](Rejected('Declined by user'))
                    emit(ctx['phase'], challenge=None)
            except (ValueError, PairingError):
                cleanup('failed', '配对输入无效，请重新开始')
        if condition & GLib.IO_HUP:
            cleanup('cancelled')
            return False
        return not ctx['closing']

    try:
        bus = dbus.SystemBus(private=True)
        ctx['owner'] = str(bus.get_name_owner('org.bluez'))
        objects = dbus.Interface(bus.get_object('org.bluez', '/'), 'org.freedesktop.DBus.ObjectManager').GetManagedObjects(timeout=5)
        selected = [(str(path), props[iface]) for path, props in objects.items()
                    if iface in props and str(props[iface].get('Address', '')).upper() == address]
        if len(selected) != 1:
            emit('failed', error='没有找到这台外设，请重新扫描后选择')
            return
        path, props = selected[0]
        ctx.update(path=path, initial_connected=bool(props.get('Connected')))
        obj = bus.get_object('org.bluez', path)
        ctx['device'] = dbus.Interface(obj, iface)
        ctx['properties'] = dbus.Interface(obj, 'org.freedesktop.DBus.Properties')
        ctx['agent'] = Agent(bus, agent_path)
        ctx['manager'] = dbus.Interface(bus.get_object('org.bluez', '/org/bluez'), 'org.bluez.AgentManager1')
        ctx['manager'].RegisterAgent(agent_path, 'KeyboardDisplay', timeout=5)
        ctx['registered'] = True
        GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, command)
        GLib.timeout_add_seconds(TTL, lambda: (cleanup('expired', '配对超时，请重试'), False)[1])
        emit('pairing', name=str(props.get('Alias') or props.get('Name') or address)[:60])
        if props.get('Paired'):
            GLib.idle_add(lambda: (connect(), False)[1])
        else:
            ctx['device'].Pair(reply_handler=connect, error_handler=failure, timeout=TTL)
        loop.run()
    except dbus.DBusException as exc:
        failure(exc)
        # Startup failures may happen before the loop ever runs.
        if not ctx['finished']:
            loop.run()
    finally:
        if bus:
            if ctx['registered']:
                try:
                    ctx['manager'].UnregisterAgent(agent_path, timeout=2)
                except dbus.DBusException:
                    pass
            bus.close()


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--worker' and MAC.fullmatch(sys.argv[2]):
        run_agent(sys.argv[2])
