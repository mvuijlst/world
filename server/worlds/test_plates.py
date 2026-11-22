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


class SubductionTests(TestCase):
    @skipUnless(HAVE, 'pyGPlates not installed')
    def test_subduction_zones_arcs_and_a_later_rift_round_trip(self):
        pg = pygplates()
        world = json.loads(json.dumps(DRIFT))
        world['features'] += [
            {'kind': 'subduction', 'plateId': 2, 'name': 'Trench', 'coords': [[-20, 25], [0, 26], [20, 25]], 'side': 'right', 'begin': 950, 'end': 850},
            {'kind': 'arc', 'plateId': 2, 'name': 'Arc', 'coords': [[-5, 23], [5, 23], [5, 24], [-5, 24]], 'begin': 950},
            {'kind': 'rift', 'plateId': 2, 'name': 'Late rift', 'coords': [[-30, 10], [0, 10], [30, 10]], 'left': 2, 'right': 3, 'begin': 900},
        ]
        world['plates'].append({'id': 3, 'name': 'Split', 'fixed': 2, 'rotations': []})
        c = Client()
        r = c.post('/api/plates/export', json.dumps(world), content_type='application/json')
        self.assertEqual(r.status_code, 200, r.content[:300])
        z = zipfile.ZipFile(io.BytesIO(r.content))
        gpml = z.read('Drift.gpml')
        self.assertIn(b'gpml:SubductionZone', gpml)
        self.assertIn(b'gpml:IslandArc', gpml)
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            z.extractall(tmp)
            fc = pg.FeatureCollection(os.path.join(tmp, 'Drift.gpml'))
        trench = next(f for f in fc if f.get_name() == 'Trench')
        self.assertEqual(trench.get_enumeration(pg.PropertyName.create_gpml('subductionPolarity')), 'Right')
        self.assertEqual(trench.get_valid_time(), (950.0, 850.0))
        late = next(f for f in fc if f.get_name() == 'Late rift flowline')
        self.assertEqual(late.get_valid_time()[0], 900.0)

        r = c.post('/api/plates/import', {'file': SimpleUploadedFile('Drift.gpml', gpml, content_type='application/xml')})
        self.assertEqual(r.status_code, 200, r.content[:300])
        got = {f['name']: f for f in r.json()['features']}
        self.assertEqual((got['Trench']['kind'], got['Trench']['side'], got['Trench']['begin'], got['Trench']['end']), ('subduction', 'right', 950.0, 850.0))
        self.assertEqual((got['Arc']['kind'], got['Arc']['begin']), ('arc', 950.0))
        self.assertEqual(got['Late rift']['begin'], 900.0)
        self.assertEqual(got['West crust'].get('begin'), 1000.0)                  # from the start: the app keeps it as drawn


class CrossoverTests(TestCase):
    @skipUnless(HAVE, 'pyGPlates not installed')
    def test_a_plate_riding_another_then_on_its_own(self):
        """As tests/rotation.test.js: plate 3 rides on 2 until 900 Ma, then moves relative to the frame."""
        pg = pygplates()
        world = {
            'name': 'Cross', 'start': 1000, 'step': 10,
            'plates': [
                {'id': 2, 'fixed': 0, 'rotations': [{'age': 900, 'lat': 90, 'lon': 0, 'angle': 20}, {'age': 800, 'lat': 90, 'lon': 0, 'angle': 40}]},
                {'id': 3, 'fixed': 0, 'rotations': [{'age': 900, 'lat': 90, 'lon': 0, 'angle': 0, 'fixed': 2},
                                                    {'age': 900, 'lat': 90, 'lon': 0, 'angle': 20},
                                                    {'age': 800, 'lat': 90, 'lon': 0, 'angle': 10}]},
            ],
            'features': [{'kind': 'crust', 'plateId': 3, 'name': 'Piece', 'coords': [[0, 0], [10, 0], [10, 10]]}],
        }
        r = Client().post('/api/plates/export', json.dumps(world), content_type='application/json')
        self.assertEqual(r.status_code, 200, r.content[:300])
        rot = zipfile.ZipFile(io.BytesIO(r.content)).read('Cross.rot').decode()
        lines = [ln.split() for ln in rot.splitlines() if ln.strip().startswith('003')]
        at900 = sorted(ln[5] for ln in lines if float(ln[1]) == 900.0)
        self.assertEqual(at900, ['000', '002'], 'a crossover: two lines at 900 Ma')
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'c.rot')
            with open(path, 'w') as fh:
                fh.write(rot)
            model = pg.RotationModel(path)
        lon = lambda age: (model.get_rotation(age, 3) * pg.PointOnSphere(0, 0)).to_lat_lon()[1]  # noqa: E731
        self.assertAlmostEqual(lon(950), 10, places=6)   # riding on 2, halfway to its 20°
        self.assertAlmostEqual(lon(900), 20, places=6)
        self.assertAlmostEqual(lon(850), 15, places=6)   # its own way
        self.assertAlmostEqual(lon(500), 10, places=6)   # held after its last pole
