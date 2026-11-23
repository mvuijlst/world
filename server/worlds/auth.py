"""Sign-in by API token for /api/worlds: `Authorization: Bearer <token>` (see models.ApiToken).

A request with a valid token is that token's owner for this request only (no session is made),
and the CSRF check is skipped for it: a browser never sends this header by itself, so another
site cannot make it. A request with a bad token is refused outright rather than treated as
anonymous, so a mistyped token is noticed. Without the header nothing changes.
"""
import re
from datetime import timedelta

from django.http import JsonResponse
from django.utils import timezone

from .models import ApiToken

PATHS = ('/api/worlds',)
# the token itself, wherever it sits in the header (a pasted 'Bearer ws_…', or the text around it)
TOKEN = re.compile(r'ws_[A-Za-z0-9_-]{20,}')


class ApiTokenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        header = request.META.get('HTTP_AUTHORIZATION', '')
        if header[:7].lower() == 'bearer ' and request.path.startswith(PATHS):
            found = TOKEN.search(header)
            token = found.group(0) if found else ''
            row = ApiToken.objects.select_related('owner').filter(digest=ApiToken.digest_of(token)).first() if token else None
            if row is None or not row.owner.is_active:
                # say what arrived (its start and length only), to compare with the prefix in the admin
                seen = f'{token[:10]}…, {len(token)} characters' if token else f'no ws_ token in the header ({len(header) - 7} characters after Bearer)'
                return JsonResponse({'error': f'That API token is not valid ({seen}).'}, status=401)
            request.user = row.owner
            request._dont_enforce_csrf_checks = True
            now = timezone.now()
            if row.last_used is None or now - row.last_used > timedelta(minutes=5):
                ApiToken.objects.filter(pk=row.pk).update(last_used=now)
        return self.get_response(request)
