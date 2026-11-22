"""JSON API used by the WorldSmith app.

  GET    /api/session          → {"user": name | null}; also sets the CSRF cookie
  POST   /api/login            {"username", "password"} → {"user": name}
  POST   /api/logout
  GET    /api/worlds           → {"worlds": [{"id", "name", "rev", "updated", "deleted"}…]}
  GET    /api/worlds/<id>      → {"id", "rev", "updated", "data"}
  PUT    /api/worlds/<id>      {"rev": the rev this edit started from (null for a new world), "data"}
                               → {"id", "rev", "updated"}
                               409 {"error", "world": {"id", "rev", "updated", "data"}} when the server
                               copy changed since that rev (another device saved in between)
                               410 when the world was deleted elsewhere
  DELETE /api/worlds/<id>      → {"id", "rev"}; kept as a tombstone so other devices drop it too

Every /api/worlds call needs a signed-in session and only ever sees that account's worlds.
Writes need the X-CSRFToken header (the value of the csrftoken cookie).
"""
import json
import math
import time

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .models import World

MAX_WORLD_BYTES = 2_000_000
LOGIN_LIMIT = 10            # failed attempts …
LOGIN_WINDOW = 15 * 60      # … per this many seconds, per address and per username


def error(message, status=400, **extra):
    return JsonResponse({'error': message, **extra}, status=status)


def body(request):
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def client_ip(request):
    return request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR', '')


def counted(key):
    count, until = cache.get(key) or (0, 0)
    left = until - time.time()
    return (count, left) if left > 0 else (0, 0)


def count(key, window):
    n, left = counted(key)
    if not left:
        left = window
    cache.set(key, (n + 1, time.time() + left), math.ceil(left))


# ───────────────────────── Accounts ─────────────────────────

@require_GET
@ensure_csrf_cookie
def session(request):
    user = request.user.get_username() if request.user.is_authenticated else None
    return JsonResponse({'user': user})


@require_POST
def login_view(request):
    data = body(request)
    if data is None:
        return error('Bad request')
    username = str(data.get('username', '')).strip()[:150]
    password = str(data.get('password', ''))[:1000]
    if not username or not password:
        return error('Enter your username and password.')
    keys = [f'login-ip:{client_ip(request)}', f'login-user:{username.lower()}']
    for key in keys:
        n, left = counted(key)
        if n >= LOGIN_LIMIT:
            return error(f'Too many attempts. Try again in {math.ceil(left / 60)} minutes.', 429)
    user = authenticate(request, username=username, password=password)
    if user is None:
        for key in keys:
            count(key, LOGIN_WINDOW)
        return error('Wrong username or password.', 401)
    login(request, user)
    return JsonResponse({'user': user.get_username()})


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({'user': None})


# ───────────────────────── Worlds ─────────────────────────

def signed_in(view):
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return error('Sign in first.', 401)
        return view(request, *args, **kwargs)
    wrapped.__name__ = view.__name__
    wrapped.__doc__ = view.__doc__
    return wrapped


def full(world):
    return {'id': world.uid, 'rev': world.rev, 'updated': world.updated.isoformat(), 'data': world.data}


@require_GET
@signed_in
def world_list(request):
    return JsonResponse({'worlds': [w.summary() for w in request.user.worlds.all()]})


@require_http_methods(['GET', 'PUT', 'DELETE'])
@signed_in
def world_detail(request, uid):
    uid = uid[:64]
    if request.method == 'GET':
        world = request.user.worlds.filter(uid=uid, deleted__isnull=True).first()
        if world is None:
            return error('No such world.', 404)
        return JsonResponse(full(world))

    if request.method == 'DELETE':
        with transaction.atomic():
            world = request.user.worlds.select_for_update().filter(uid=uid).first()
            if world is None:
                return error('No such world.', 404)
            if world.deleted is None:
                world.deleted = timezone.now()
                world.rev += 1
                world.save()
        return JsonResponse({'id': world.uid, 'rev': world.rev})

    # PUT
    if len(request.body) > MAX_WORLD_BYTES:
        return error('This world is too large to store.', 413)
    payload = body(request)
    if payload is None:
        return error('Bad request')
    data = payload.get('data')
    base = payload.get('rev')
    if not isinstance(data, dict) or not isinstance(data.get('star'), dict) or not isinstance(data.get('planet'), dict):
        return error('That is not a WorldSmith world.')
    if data.get('id') != uid:
        return error('The world id in the address and in the data differ.')
    if base is not None and not isinstance(base, int):
        return error('Bad revision.')
    name = str(data.get('name') or '')[:200]

    with transaction.atomic():
        world = request.user.worlds.select_for_update().filter(uid=uid).first()
        if world is None:
            world = World.objects.create(owner=request.user, uid=uid, name=name, data=data)
            return JsonResponse({'id': world.uid, 'rev': world.rev, 'updated': world.updated.isoformat()}, status=201)
        if world.deleted is not None:
            return error('This world was deleted on another device.', 410)
        if base != world.rev:
            return error('This world was changed on another device.', 409, world=full(world))
        world.data = data
        world.name = name
        world.rev += 1
        world.save()
    return JsonResponse({'id': world.uid, 'rev': world.rev, 'updated': world.updated.isoformat()})
