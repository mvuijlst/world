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


class ApiTokenTests(TestCase):
    def setUp(self):
        from .models import ApiToken
        User = get_user_model()
        self.alice = User.objects.create_user('alice', password='correct horse battery')
        self.bob = User.objects.create_user('bob', password='another long secret')
        self.row, self.token = ApiToken.issue(self.alice, 'script')
        # a client that enforces CSRF as a browser's request would be
        self.c = Client(enforce_csrf_checks=True)
        self.auth = {'HTTP_AUTHORIZATION': f'Bearer {self.token}'}

    def put(self, uid, data, rev=None, **extra):
        return self.c.put(f'/api/worlds/{uid}', json.dumps({'rev': rev, 'data': data}), content_type='application/json', **extra)

    def test_a_token_reads_and_writes_its_owners_worlds(self):
        r = self.put('w1', world('w1', 'Featherfall'), **self.auth)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.c.get('/api/worlds', **self.auth).json()['worlds'][0]['name'], 'Featherfall')
        self.assertEqual(self.c.get('/api/worlds/w1', **self.auth).json()['data']['name'], 'Featherfall')
        r = self.put('w1', world('w1', 'Featherfall II'), rev=1, **self.auth)
        self.assertEqual(r.json()['rev'], 2)
        from .models import ApiToken, World
        self.assertEqual(World.objects.get(uid='w1').owner, self.alice)
        self.assertIsNotNone(ApiToken.objects.get(pk=self.row.pk).last_used)
        # no session was made
        self.assertEqual(self.c.get('/api/session').json(), {'user': None})

    def test_only_the_owners_worlds(self):
        bobs = Client()
        bobs.force_login(self.bob)
        bobs.put('/api/worlds/b1', json.dumps({'rev': None, 'data': world('b1', 'Bob’s')}), content_type='application/json')
        self.assertEqual(self.c.get('/api/worlds', **self.auth).json()['worlds'], [])
        self.assertEqual(self.c.get('/api/worlds/b1', **self.auth).status_code, 404)

    def test_bad_missing_and_revoked_tokens(self):
        self.assertEqual(self.c.get('/api/worlds', HTTP_AUTHORIZATION='Bearer ws_nope').status_code, 401)
        self.assertEqual(self.c.get('/api/worlds').status_code, 401)
        self.row.delete()
        self.assertEqual(self.c.get('/api/worlds', **self.auth).status_code, 401)

    def test_an_inactive_owner_cannot_use_it(self):
        self.alice.is_active = False
        self.alice.save()
        self.assertEqual(self.c.get('/api/worlds', **self.auth).status_code, 401)

    def test_only_on_the_world_api(self):
        # not a way to sign in, and no way into the admin
        self.assertEqual(self.c.get('/api/session', **self.auth).json(), {'user': None})
        self.assertNotEqual(self.c.get('/admin/', **self.auth).status_code, 200)
        # without the token, a write still needs the CSRF token of a session
        session = Client(enforce_csrf_checks=True)
        session.force_login(self.alice)
        r = session.put('/api/worlds/w2', json.dumps({'rev': None, 'data': world('w2')}), content_type='application/json')
        self.assertEqual(r.status_code, 403)

    def test_only_a_digest_is_kept(self):
        from .models import ApiToken
        self.assertNotIn(self.token, json.dumps(list(ApiToken.objects.values()), default=str), 'the token itself is not stored')
        self.assertTrue(self.token.startswith(self.row.prefix))

    def test_made_in_the_admin_and_shown_once(self):
        from .models import ApiToken
        User = get_user_model()
        boss = User.objects.create_superuser('boss', password='a long admin secret')
        admin = Client()
        admin.force_login(boss)
        r = admin.post('/admin/worlds/apitoken/add/', {'owner': self.alice.pk, 'name': 'Claude, test worlds'}, follow=True)
        self.assertEqual(r.status_code, 200)
        shown = [str(m) for m in r.context['messages']]
        self.assertTrue(any('ws_' in m for m in shown), shown)
        token = next(m for m in shown if 'ws_' in m).split(': ', 1)[1].split()[0]
        self.assertTrue(ApiToken.objects.filter(digest=ApiToken.digest_of(token), owner=self.alice, name='Claude, test worlds').exists())
        self.assertEqual(Client().get('/api/worlds', HTTP_AUTHORIZATION=f'Bearer {token}').status_code, 200)
        listing = admin.get('/admin/worlds/apitoken/')
        self.assertNotContains(listing, token)
