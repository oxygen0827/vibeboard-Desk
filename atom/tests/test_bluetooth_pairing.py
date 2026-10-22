import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bluetooth
from bluetooth_pairing import PairingManager, PairingError, answer

ADDRESS='AA:BB:CC:DD:EE:01'
REQUEST='a'*32

class Worker:
    def __init__(self,address,receive):
        self.address,self.receive=address,receive
        self.messages=[];self.running=True;self.killed=False
    def send(self,value):self.messages.append(value)
    def alive(self):return self.running
    def kill(self):self.running=False;self.killed=True
    def event(self,**value):self.receive(value)

class PairingTests(unittest.TestCase):
    def setUp(self):
        self.now=0;self.workers=[]
        def factory(*args):
            w=Worker(*args);self.workers.append(w);return w
        self.manager=PairingManager(factory,clock=lambda:self.now,watchdog=False)
    def start(self):
        return self.manager.start(ADDRESS,True,REQUEST)
    def challenge(self,kind,ident=1,**fields):
        self.workers[-1].event(state='waiting',challenge=dict(id=ident,kind=kind,**fields))

    def test_only_explicit_confirmed_valid_selected_device_starts_worker(self):
        for address,confirm,ident in [(ADDRESS,False,REQUEST),('AA;reboot',True,REQUEST),(ADDRESS,True,'')]:
            with self.assertRaises(PairingError):self.manager.start(address,confirm,ident)
        self.assertEqual(self.workers,[])
        self.start();self.assertEqual(self.workers[0].address,ADDRESS)

    def test_idempotent_start_and_single_session(self):
        first=self.start();self.assertEqual(first,self.start());self.assertEqual(len(self.workers),1)
        with self.assertRaises(PairingError):self.manager.start(ADDRESS,True,'b'*32)
        with self.assertRaises(PairingError):self.manager.start('AA:BB:CC:DD:EE:02',True,REQUEST)

    def test_cancel_before_late_start_prevents_pairing(self):
        self.manager.cancel(REQUEST)
        self.assertEqual(self.start()['state'],'cancelled')
        self.assertEqual(self.workers,[])

    def test_pin_validation_then_exactly_one_response_without_retaining_pin(self):
        self.start();self.challenge('pin')
        for bad in ['', 'a'*17, 'a\n']:
            with self.assertRaises(PairingError):self.manager.respond(REQUEST,1,bad)
        result=self.manager.respond(REQUEST,1,'secret-pin')
        self.assertNotIn('secret-pin',str(result));self.assertEqual(self.workers[0].messages[-1]['value'],'secret-pin')
        with self.assertRaises(PairingError):self.manager.respond(REQUEST,1,'again')

    def test_passkey_type_and_bounds(self):
        self.assertEqual(answer('passkey','000042'),42)
        self.assertEqual(answer('passkey','999999'),999999)
        for value in [42,True,'1000000','-1','１２３４','1.5','']:
            with self.assertRaises(PairingError):answer('passkey',value)

    def test_confirmation_must_be_boolean_and_carries_current_challenge(self):
        self.start();self.challenge('confirm',2,code='000042')
        for ident,value in [(1,True),(True,True),(2,'yes')]:
            with self.assertRaises(PairingError):self.manager.respond(REQUEST,ident,value)
        self.manager.respond(REQUEST,2,False)
        self.assertEqual(self.workers[0].messages[-1],dict(action='respond',challenge=2,value=False))

    def test_display_does_not_accept_fabricated_confirmation(self):
        self.start();self.challenge('display-passkey',code='000042',entered=3)
        self.assertEqual(self.manager.poll(REQUEST)['challenge']['entered'],3)
        with self.assertRaises(PairingError):self.manager.respond(REQUEST,1,True)

    def test_service_and_authorization_both_require_explicit_response(self):
        for i,kind in enumerate(['authorize','service']):
            if not self.workers:self.start()
            self.challenge(kind,i+1)
            self.manager.respond(REQUEST,i+1,True)
        self.assertEqual(len(self.workers[0].messages),2)

    def test_cancel_prevents_late_success_and_releases_worker(self):
        self.start();self.challenge('confirm',code='000042')
        self.manager.cancel(REQUEST);self.workers[0].event(state='connected')
        self.assertEqual(self.manager.poll(REQUEST)['state'],'cancelled')
        self.assertEqual(self.workers[0].messages[-1],{'action':'cancel'})
        self.now=4;self.manager.expire();self.assertTrue(self.workers[0].killed)
        self.manager.start(ADDRESS,True,'b'*32)
        self.assertEqual(len(self.workers),2)

    def test_page_lease_expiry_and_absolute_deadline(self):
        self.start();self.now=20;self.manager.expire()
        self.assertEqual(self.manager.poll(REQUEST)['state'],'expired')
        self.assertEqual(self.workers[0].messages[-1]['action'],'cancel')
        self.now=24;self.manager.expire();self.manager.start(ADDRESS,True,'b'*32)
        for moment in range(34,205,10):
            self.now=moment;self.manager.poll('b'*32)
        self.now=204;self.manager.expire()
        self.assertEqual(self.manager.poll('b'*32)['state'],'expired')

    def test_worker_exit_is_truthful_and_success_keeps_terminal_state(self):
        self.start();self.workers[0].event(event='exit')
        self.assertEqual(self.manager.poll(REQUEST)['state'],'failed')
        self.workers[0].running=False
        self.manager.start(ADDRESS,True,'b'*32);self.workers[1].event(state='connected');self.workers[1].event(event='exit')
        self.assertEqual(self.manager.poll('b'*32)['state'],'connected')
        self.assertEqual(self.manager.cancel('b'*32)['state'],'connected')

    def test_session_cache_has_a_limit_and_expires(self):
        for i in range(32):self.manager.cancel('%032x'%i)
        with self.assertRaises(PairingError):self.manager.cancel('f'*32)
        self.now=61;self.manager.expire();self.assertEqual(len(self.manager.jobs),0)

    def test_bluetooth_facade_translates_safe_errors(self):
        with mock.patch('bluetooth_pairing.manager',return_value=self.manager):
            with self.assertRaisesRegex(bluetooth.BluetoothError,'确认'):bluetooth.connect(ADDRESS,request_id=REQUEST)
            self.assertEqual(bluetooth.connect(ADDRESS,True,REQUEST)['pairing']['state'],'starting')
            self.assertEqual(bluetooth.pairing('cancel',{'id':REQUEST})['pairing']['state'],'cancelled')

if __name__=='__main__':unittest.main()
