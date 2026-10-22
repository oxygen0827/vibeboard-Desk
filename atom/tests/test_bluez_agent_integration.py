"""Exercise the actual Agent1 worker against a private D-Bus fake BlueZ, never system Bluetooth.

On Debian: python3 -m unittest discover -s atom/tests -p test_bluez_agent_integration.py -v
Requires python3-dbus, python3-gi and dbus-daemon. Non-Linux development hosts skip this suite.
"""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import unittest

try:
    import dbus
    from gi.repository import GLib
    HAS_DBUS=True
except ImportError:
    HAS_DBUS=False

ADDRESS='AA:BB:CC:DD:EE:01'
DEVICE='/org/bluez/hci0/dev_AA_BB_CC_DD_EE_01'
WORKER=Path(__file__).resolve().parents[1]/'bluetooth_pairing.py'


def lines(process):
    q=queue.Queue()
    def read():
        for line in process.stdout:
            try:q.put(json.loads(line))
            except ValueError:q.put({'bad_output':line[:120]})
        q.put({'closed':True})
    threading.Thread(target=read,daemon=True).start()
    return q


def fake_bluez(scenario):
    import dbus.service
    from dbus.mainloop.glib import DBusGMainLoop
    DBusGMainLoop(set_as_default=True)
    bus=dbus.SystemBus(private=True)
    name=dbus.service.BusName('org.bluez',bus)
    state={'Paired':False,'Connected':False,'Trusted':False,'Address':ADDRESS,'Alias':'Test keyboard'}
    ctx={'agent':None,'reply':None,'reject':None}
    def event(**v):print(json.dumps(v),flush=True)
    class AuthError(dbus.DBusException):_dbus_error_name='org.bluez.Error.AuthenticationRejected'
    class ConnectError(dbus.DBusException):_dbus_error_name='org.bluez.Error.Failed'
    class Root(dbus.service.Object):
        @dbus.service.method('org.freedesktop.DBus.ObjectManager',in_signature='',out_signature='a{oa{sa{sv}}}')
        def GetManagedObjects(self):return {DEVICE:{'org.bluez.Device1':state}}
    class Manager(dbus.service.Object):
        @dbus.service.method('org.bluez.AgentManager1',in_signature='os',out_signature='',sender_keyword='sender')
        def RegisterAgent(self,path,capability,sender=None):
            assert capability=='KeyboardDisplay'
            ctx['agent']=dbus.Interface(bus.get_object(sender,path),'org.bluez.Agent1')
            event(registered=True)
        @dbus.service.method('org.bluez.AgentManager1',in_signature='o',out_signature='')
        def UnregisterAgent(self,path):event(unregistered=True)
        @dbus.service.method('org.bluez.AgentManager1',in_signature='o',out_signature='')
        def RequestDefaultAgent(self,path):raise AssertionError('Must never request the default agent')
    class Device(dbus.service.Object):
        @dbus.service.method('org.freedesktop.DBus.Properties',in_signature='ss',out_signature='v')
        def Get(self,interface,key):return state[str(key)]
        @dbus.service.method('org.freedesktop.DBus.Properties',in_signature='ssv',out_signature='')
        def Set(self,interface,key,value):
            state[str(key)]=bool(value)
            event(trusted=state['Trusted'])
        @dbus.service.method('org.bluez.Device1',in_signature='',out_signature='',async_callbacks=('reply','reject'))
        def Pair(self,reply,reject):
            ctx.update(reply=reply,reject=reject)
            agent=ctx['agent']
            def failure(e):event(rejected=True);reject(AuthError('Rejected'))
            def done(*args):state['Paired']=True;event(pair_reply=list(args));reply()
            if scenario=='pin':agent.RequestPinCode(DEVICE,reply_handler=done,error_handler=failure)
            elif scenario=='passkey':agent.RequestPasskey(DEVICE,reply_handler=done,error_handler=failure)
            elif scenario in ('confirm','reject','cancel','connect-failure','foreign'):
                agent.RequestConfirmation('/org/bluez/hci0/other' if scenario=='foreign' else DEVICE,dbus.UInt32(42),reply_handler=done,error_handler=failure)
            elif scenario=='authorize':
                def service():agent.AuthorizeService(DEVICE,'00001124-0000-1000-8000-00805f9b34fb',reply_handler=done,error_handler=failure)
                agent.RequestAuthorization(DEVICE,reply_handler=service,error_handler=failure)
            elif scenario in ('display-pin','display-passkey'):
                if scenario=='display-pin':agent.DisplayPinCode(DEVICE,'123456')
                else:agent.DisplayPasskey(DEVICE,dbus.UInt32(42),dbus.UInt16(0))
                def more():
                    if scenario=='display-passkey':agent.DisplayPasskey(DEVICE,dbus.UInt32(42),dbus.UInt16(4))
                    agent.Cancel();done();return False
                GLib.timeout_add(300,more)
        @dbus.service.method('org.bluez.Device1',in_signature='',out_signature='')
        def Connect(self):
            if scenario=='connect-failure':raise ConnectError('profile unavailable')
            state['Connected']=True;event(connected=True)
        @dbus.service.method('org.bluez.Device1',in_signature='',out_signature='')
        def CancelPairing(self):event(pair_cancelled=True)
        @dbus.service.method('org.bluez.Device1',in_signature='',out_signature='')
        def Disconnect(self):state['Connected']=False;event(disconnected=True)
    root=Root(bus,'/');manager=Manager(bus,'/org/bluez');device=Device(bus,DEVICE)
    event(ready=True)
    GLib.MainLoop().run()


@unittest.skipUnless(HAS_DBUS and shutil.which('dbus-daemon'),'requires Debian D-Bus/GLib test dependencies')
class AgentIntegration(unittest.TestCase):
    def setUp(self):
        self.bus=subprocess.Popen(['dbus-daemon','--session','--nofork','--print-address=1'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,universal_newlines=True)
        self.addCleanup(self.stop,self.bus)
        address=self.bus.stdout.readline().strip();self.assertTrue(address.startswith('unix:'))
        self.env=dict(os.environ,DBUS_SYSTEM_BUS_ADDRESS=address,PYTHONDONTWRITEBYTECODE='1')
    def stop(self,process):
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=3)
            except subprocess.TimeoutExpired:process.kill();process.wait()
        for stream in (process.stdin,process.stdout,process.stderr):
            if stream:
                try:stream.close()
                except OSError:pass
    def start(self,scenario):
        fake=subprocess.Popen([sys.executable,'-u',__file__,'--fake',scenario],env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True)
        self.addCleanup(self.stop,fake);self.fake=fake;self.fq=lines(fake)
        self.assertEqual(self.fq.get(timeout=5),{'ready':True})
        worker=subprocess.Popen([sys.executable,'-u',str(WORKER),'--worker',ADDRESS],env=self.env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True)
        self.addCleanup(self.stop,worker);self.worker=worker;self.q=lines(worker)
    def receive(self,kind=None,terminal=False):
        while True:
            value=self.q.get(timeout=8)
            self.assertNotIn('closed',value, self.worker.stderr.read() if self.worker.poll() is not None else '')
            if kind and (value.get('challenge') or {}).get('kind')==kind:return value
            if terminal and value.get('state') in ('failed','connected','cancelled','expired'):return value
    def send(self,value):self.worker.stdin.write(json.dumps(value)+'\n');self.worker.stdin.flush()
    def respond(self,prompt,value):self.send(dict(action='respond',challenge=prompt['challenge']['id'],value=value))
    def done(self,state='connected'):
        self.assertEqual(self.receive(terminal=True)['state'],state)
        self.assertEqual(self.worker.wait(timeout=4),0)
        events=[]
        while True:
            try:events.append(self.fq.get(timeout=.2))
            except queue.Empty:break
        self.assertTrue(any(e.get('unregistered') for e in events),events)
        return events
    def test_pin_code_and_trust_after_connection(self):
        self.start('pin');self.respond(self.receive('pin'),'abc123')
        events=self.done();self.assertIn({'pair_reply':['abc123']},events)
        self.assertLess(events.index({'connected':True}),events.index({'trusted':True}))
    def test_numeric_passkey_is_uint_and_padded_confirmation(self):
        self.start('passkey');self.respond(self.receive('passkey'),42)
        self.assertIn({'pair_reply':[42]},self.done())
    def test_confirm_is_not_automatic(self):
        self.start('confirm');prompt=self.receive('confirm');self.assertEqual(prompt['challenge']['code'],'000042');self.respond(prompt,True);self.done()
    def test_reject_does_not_trust_or_connect(self):
        self.start('reject');self.respond(self.receive('confirm'),False);events=self.done('failed');self.assertFalse(any(e.get('trusted') or e.get('connected') for e in events))
    def test_display_passkey_progress_and_cancel_notification(self):
        self.start('display-passkey');self.assertEqual(self.receive('display-passkey')['challenge']['entered'],0);self.assertEqual(self.receive('display-passkey')['challenge']['entered'],4);self.done()
    def test_display_legacy_pin(self):
        self.start('display-pin');self.assertEqual(self.receive('display-pin')['challenge']['code'],'123456');self.done()
    def test_pair_and_service_authorization(self):
        self.start('authorize');self.respond(self.receive('authorize'),True);self.respond(self.receive('service'),True);self.done()
    def test_user_cancel_releases_pending_agent_call(self):
        self.start('cancel');self.receive('confirm');self.send({'action':'cancel'});events=self.done('cancelled');self.assertTrue(any(e.get('pair_cancelled') for e in events));self.assertFalse(any(e.get('trusted') for e in events))
    def test_page_process_disconnect_cancels_pairing(self):
        self.start('cancel');self.receive('confirm');self.worker.stdin.close();self.done('cancelled')
    def test_unselected_device_request_is_rejected(self):
        self.start('foreign');events=self.done('failed');self.assertFalse(any(e.get('trusted') for e in events))
    def test_failed_profile_does_not_claim_connected(self):
        self.start('connect-failure');self.respond(self.receive('confirm'),True);events=self.done('failed');self.assertFalse(any(e.get('trusted') for e in events))

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--fake':fake_bluez(sys.argv[2])
    else:unittest.main()
