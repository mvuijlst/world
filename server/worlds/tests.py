import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase


def world(uid='w1', name='Terra'):
    return {'id': uid, 'name': name, 'star': {'mass': 1}, 'planet': {'mass': 1}}


class ApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.alice = User.objects.create_user('alice', password='correct horse battery')
        self.bob = User.objects.create_user('bob', password='another long secret')
        self.c = Client()
        self.c.force_login(self.alice)

    def put(self, uid, data, rev=None, client=None):
        return (client or self.c).put(f'/api/worlds/{uid}', json.dumps({'rev': rev, 'data': data}), content_type='application/json')

    def test_session_and_login(self):
        anon = Client()
        self.assertEqual(anon.get('/api/session').json(), {'user': None})
        r = anon.post('/api/login', json.dumps({'username': 'alice', 'password': 'nope'}), content_type='application/json')
        self.assertEqual(r.status_code, 401)
        r = anon.post('/api/login', json.dumps({'username': 'alice', 'password': 'correct horse battery'}), content_type='application/json')
        self.assertEqual(r.json(), {'user': 'alice'})
        self.assertEqual(anon.get('/api/session').json(), {'user': 'alice'})

    def test_login_is_throttled(self):
        anon = Client()
        for _ in range(10):
            anon.post('/api/login', json.dumps({'username': 'alice', 'password': 'x'}), content_type='application/json')
        r = anon.post('/api/login', json.dumps({'username': 'alice', 'password': 'correct horse battery'}), content_type='application/json')
        self.assertEqual(r.status_code, 429)

    def test_worlds_need_a_session(self):
        self.assertEqual(Client().get('/api/worlds').status_code, 401)

    def test_create_read_update(self):
        r = self.put('w1', world())
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['rev'], 1)
        self.assertEqual(self.c.get('/api/worlds').json()['worlds'][0]['name'], 'Terra')
        r = self.put('w1', world(name='Terra II'), rev=1)
        self.assertEqual(r.json()['rev'], 2)
        self.assertEqual(self.c.get('/api/worlds/w1').json()['data']['name'], 'Terra II')

    def test_stale_edit_is_a_conflict(self):
        self.put('w1', world())
        self.put('w1', world(name='from laptop'), rev=1)
        r = self.put('w1', world(name='from phone'), rev=1)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()['world']['data']['name'], 'from laptop')

    def test_delete_leaves_a_tombstone(self):
        self.put('w1', world())
        self.assertEqual(self.c.delete('/api/worlds/w1').status_code, 200)
        self.assertTrue(self.c.get('/api/worlds').json()['worlds'][0]['deleted'])
        self.assertEqual(self.c.get('/api/worlds/w1').status_code, 404)
        self.assertEqual(self.put('w1', world(), rev=2).status_code, 410)

    def test_accounts_are_separate(self):
        self.put('w1', world())
        other = Client()
        other.force_login(self.bob)
        self.assertEqual(other.get('/api/worlds').json()['worlds'], [])
        self.assertEqual(other.get('/api/worlds/w1').status_code, 404)
        self.assertEqual(self.put('w1', world(name='bob'), client=other).status_code, 201)
        self.assertEqual(self.c.get('/api/worlds/w1').json()['data']['name'], 'Terra')

    def test_rejects_non_worlds(self):
        self.assertEqual(self.put('w1', {'id': 'w1'}).status_code, 400)
        self.assertEqual(self.put('w1', world(uid='other')).status_code, 400)

    def test_writes_need_csrf(self):
        strict = Client(enforce_csrf_checks=True)
        strict.force_login(self.alice)
        self.assertEqual(self.put('w1', world(), client=strict).status_code, 403)
