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
