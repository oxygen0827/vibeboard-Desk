import json
import math
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sensors import Sensors


class SensorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.now = 1000.
        self.sensor = Sensors(self.root/'iio', self.root/'sensor.json', clock=lambda:self.now, monotonic=lambda:self.now)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, **fields):
        (self.root/'sensor.json').write_text(json.dumps(dict(version=1, updated_at=self.now*1000, **fields)))

    def tick(self, amount=.1):
        self.now += amount
        return self.sensor.snapshot()

    def test_missing_is_unknown_not_absent(self):
        result=self.sensor.snapshot()
        self.assertEqual(result['source'], 'unavailable')
        self.assertIsNone(result['presence'])
        self.assertIsNone(result['motion'])

    def test_presence_debounce_then_disconnect(self):
        self.write(presence=True)
        self.assertIsNone(self.sensor.snapshot()['presence'])
        self.assertTrue(self.tick(.3)['presence']['present'])
        self.write(presence=False)
        self.assertTrue(self.tick()['presence']['present'])
        self.assertTrue(self.tick(1)['presence']['present'])
        self.assertFalse(self.tick(1.1)['presence']['present'])
        self.assertIsNone(self.tick(3)['presence'])
        self.assertEqual(self.sensor.snapshot()['source'], 'unavailable')

    def test_presence_jitter_never_marks_absent(self):
        self.write(presence=True);self.sensor.snapshot();self.tick(.3)
        self.write(presence=False);self.tick(.5)
        self.write(presence=True)
        self.assertTrue(self.tick(.3)['presence']['present'])

    def test_motion_units_and_filter(self):
        self.write(acceleration=[0,0,9.80665]);r=self.sensor.snapshot()['motion']
        self.assertEqual((r['pitch'],r['roll']), (0,0));self.assertFalse(r['moving'])
        self.write(acceleration=[0,9.80665,0]);r=self.tick()['motion']
        self.assertTrue(0 < r['roll'] < 90);self.assertTrue(r['moving'])
        self.assertTrue(80 < self.tick(.5)['motion']['roll'] <= 90)

    def test_invalid_nonfinite_bool_freefall_and_stale(self):
        for xyz in ([True,0,9], [float('nan'),0,9], [10**500,0,9], [0,0,0], [0,0,300], [1,2]):
            self.write(acceleration=xyz)
            self.assertIsNone(self.tick()['motion'])
        self.write(acceleration=[0,0,9]);self.tick(4)
        self.assertIsNone(self.sensor.snapshot()['motion'])

    def test_symlink_and_large_file(self):
        (self.root/'other').write_text('{}')
        (self.root/'sensor.json').symlink_to(self.root/'other')
        self.assertEqual(self.sensor.snapshot()['source'], 'unavailable')
        (self.root/'sensor.json').unlink();(self.root/'sensor.json').write_text('x'*2049)
        self.assertEqual(self.tick()['source'], 'unavailable')

    def test_iio_scaled_offsets_and_no_ambiguous_devices(self):
        device=self.root/'iio/iio:device0';device.mkdir(parents=True)
        for axis, raw in zip('xyz', [-1,-1,9805.65]):
            (device/('in_accel_'+axis+'_raw')).write_text(str(raw))
        (device/'in_accel_scale').write_text('.001');(device/'in_accel_offset').write_text('1')
        r=self.sensor.snapshot()['motion'];self.assertAlmostEqual(r['az'],9.807,places=3)
        self.assertEqual(r['roll'],0)
        other=self.root/'iio/iio:device1';other.mkdir();(other/'in_accel_x_input').write_text('0')
        self.assertIsNone(self.tick()['motion'])

    def test_cached_sample_cannot_be_mutated_by_consumer(self):
        r=self.sensor.snapshot();r['available']['motion']=True
        self.assertFalse(self.sensor.snapshot()['available']['motion'])

    def test_adapter_can_supply_presence_with_iio_motion(self):
        device=self.root/'iio/iio:device0';device.mkdir(parents=True)
        for axis,value in zip('xyz',[0,0,9.8]):(device/('in_accel_'+axis+'_input')).write_text(str(value))
        self.write(presence=True);self.sensor.snapshot()
        self.assertEqual(self.tick(.3)['available'],dict(presence=True,motion=True))

if __name__=='__main__':unittest.main()
