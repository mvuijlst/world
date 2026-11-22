import io
import json
import zipfile
from unittest import skipUnless

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from .plates import pygplates

HAVE = pygplates() is not None

WORLD = {
    'name': 'Pangaea Test',
    'plates': [{'id': 101, 'name': 'North'}, {'id': 102, 'name': 'South'}],
    'features': [
        {'kind': 'craton', 'plateId': 101, 'name': 'Old Shield', 'coords': [[10, 0], [10, 20], [30, 20], [30, 0]]},
        {'kind': 'crust', 'plateId': 101, 'name': 'Crust', 'coords': [[0, -10], [0, 30], [40, 30], [40, -10]]},
        {'kind': 'craton', 'plateId': 102, 'name': 'Second Shield', 'coords': [[-30, 0], [-30, 20], [-10, 20], [-10, 0]]},
        {'kind': 'rift', 'plateId': 101, 'name': 'Great Rift', 'coords': [[0, -10], [0, 40]]},
        {'kind': 'failed', 'plateId': 101, 'name': 'Arm', 'coords': [[0, 15], [-15, 15]]},
        {'kind': 'crust', 'plateId': 101, 'name': 'bad', 'coords': [[0, 0], [1, 1]]},          # too few points: skipped
    ],
}


class PlatesTests(TestCase):
    def test_status(self):
        r = Client().get('/api/plates/status')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['available'], HAVE)

    @skipUnless(HAVE, 'pyGPlates not installed')
    def test_export_then_import_round_trip(self):
        c = Client()
        r = c.post('/api/plates/export', json.dumps(WORLD), content_type='application/json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertEqual(r['Content-Type'], 'application/zip')
        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = sorted(z.namelist())
        self.assertEqual(names, ['Pangaea_Test.gpml', 'Pangaea_Test.rot', 'README.txt'])
        rot = z.read('Pangaea_Test.rot').decode()
        self.assertIn('101', rot)
        self.assertIn('102', rot)
        gpml = z.read('Pangaea_Test.gpml')
        self.assertIn(b'gpml:Craton', gpml)
        self.assertIn(b'gpml:ContinentalCrust', gpml)
        self.assertIn(b'gpml:ContinentalRift', gpml)

        up = SimpleUploadedFile('Pangaea_Test.gpml', gpml, content_type='application/xml')
        r = c.post('/api/plates/import', {'file': up})
        self.assertEqual(r.status_code, 200, r.content[:200])
        data = r.json()
        kinds = sorted(f['kind'] for f in data['features'])
        self.assertEqual(kinds, ['craton', 'craton', 'crust', 'failed', 'rift'])
        shield = next(f for f in data['features'] if f['name'] == 'Old Shield')
        self.assertEqual(shield['plateId'], 101)
        self.assertEqual(len(shield['coords']), 4)
        self.assertEqual(shield['coords'][0], [10.0, 0.0])
        self.assertEqual(sorted(p['id'] for p in data['plates']), [101, 102])

    @skipUnless(HAVE, 'pyGPlates not installed')
    def test_rejects_rubbish(self):
        c = Client()
        self.assertEqual(c.post('/api/plates/export', 'nope', content_type='application/json').status_code, 400)
        self.assertEqual(c.post('/api/plates/export', json.dumps({'features': []}), content_type='application/json').status_code, 400)
        bad = SimpleUploadedFile('x.gpml', b'<not gpml>', content_type='application/xml')
        self.assertEqual(c.post('/api/plates/import', {'file': bad}).status_code, 400)
        txt = SimpleUploadedFile('x.txt', b'hello', content_type='text/plain')
        self.assertEqual(c.post('/api/plates/import', {'file': txt}).status_code, 400)


DRIFT = {
    'name': 'Drift',
    'start': 1000, 'step': 10,
    # plate 2 turns 20 degrees about the north pole by 900 Ma; plate 1 stays put (as in tests/rotation.test.js)
    'plates': [{'id': 1, 'name': 'West', 'fixed': 0, 'rotations': []},
               {'id': 2, 'name': 'East', 'fixed': 0, 'rotations': [{'age': 900, 'lat': 90, 'lon': 0, 'angle': 20},
                                                                  {'age': 2000, 'lat': 0, 'lon': 0, 'angle': 5},   # older than start: dropped
                                                                  {'age': 950, 'lat': 'x', 'lon': 0, 'angle': 5}]}],  # junk: dropped
    'features': [
        {'kind': 'crust', 'plateId': 1, 'name': 'West crust', 'coords': [[-30, -20], [30, -20], [30, 0], [-30, 0]]},
        {'kind': 'crust', 'plateId': 2, 'name': 'East crust', 'coords': [[-30, 0], [30, 0], [30, 20], [-30, 20]]},
        {'kind': 'rift', 'plateId': 1, 'name': 'Rift', 'coords': [[-30, 0], [0, 0], [30, 0]], 'left': 1, 'right': 2},
    ],
}


class DriftTests(TestCase):
    @skipUnless(HAVE, 'pyGPlates not installed')
    def test_rotations_and_flowlines_match_the_app(self):
        pg = pygplates()
        r = Client().post('/api/plates/export', json.dumps(DRIFT), content_type='application/json')
        self.assertEqual(r.status_code, 200, r.content[:300])
        z = zipfile.ZipFile(io.BytesIO(r.content))
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            z.extractall(tmp)
            rot = pg.FeatureCollection(os.path.join(tmp, 'Drift.rot'))
            gpml = pg.FeatureCollection(os.path.join(tmp, 'Drift.gpml'))
        model = pg.RotationModel(rot)
        # plate 2: at rest at 1000, turned 20 degrees by 900 and held there to the present
        p = pg.PointOnSphere(0, 0)
        self.assertAlmostEqual((model.get_rotation(1000, 2) * p).to_lat_lon()[1], 0, places=6)
        self.assertAlmostEqual((model.get_rotation(950, 2) * p).to_lat_lon()[1], 10, places=6)
        self.assertAlmostEqual((model.get_rotation(900, 2) * p).to_lat_lon()[1], 20, places=6)
        self.assertAlmostEqual((model.get_rotation(0, 2) * p).to_lat_lon()[1], 20, places=6)
        flows = [f for f in gpml if f.get_feature_type() == pg.FeatureType.gpml_flowline]
        self.assertEqual(len(flows), 1)
        self.assertEqual((flows[0].get_left_plate(), flows[0].get_right_plate()), (1, 2))
        # the ridge sits halfway at 900 Ma, as the app draws it (rotation.spreading)
        rec = []
        pg.reconstruct(flows, model, rec, 900, reconstruct_type=pg.ReconstructType.flowline)
        seeds = sorted(fl.get_reconstructed_seed_point().to_lat_lon() for fl in rec)
        self.assertEqual(len(seeds), 3)
        self.assertAlmostEqual(seeds[1][0], 0, places=5)
        self.assertAlmostEqual(seeds[1][1], 10, places=5)
        # its left arm runs from the ridge back to the left plate's rift edge, 1 degree per 10 Myr, as in the app
        # (pyGPlates draws the right arm offset by the right plate's own rotation, so that one is not compared)
        mid = next(fl for fl in rec if abs(fl.get_reconstructed_seed_point().to_lat_lon()[0]) < 1e-6)
        left = [round(q.to_lat_lon()[1], 4) for q in mid.get_left_flowline()]
        self.assertEqual(left, [10.0, 9.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0, 0.0])

    @skipUnless(HAVE, 'pyGPlates not installed')
    def test_bad_start_age(self):
        r = Client().post('/api/plates/export', json.dumps({**DRIFT, 'start': -5}), content_type='application/json')
        self.assertEqual(r.status_code, 400)
