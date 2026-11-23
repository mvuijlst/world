from django.conf import settings
from django.db import models


class World(models.Model):
    """One world as the app keeps it: the whole JSON document, owned by one account.

    `uid` is the id the app gave the world (so a world made offline keeps its identity once it
    syncs); `rev` goes up by one on every save and lets the app notice another device's edit.
    """

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='worlds')
    uid = models.CharField(max_length=64)
    name = models.CharField(max_length=200, blank=True)
    data = models.JSONField()
    rev = models.PositiveIntegerField(default=1)
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)
    deleted = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-updated']
        constraints = [models.UniqueConstraint(fields=['owner', 'uid'], name='one_world_per_uid')]

    def __str__(self):
        return self.name or self.uid

    def summary(self):
        return {
            'id': self.uid, 'name': self.name, 'rev': self.rev,
            'updated': self.updated.isoformat(), 'deleted': self.deleted is not None,
        }


class ApiToken(models.Model):
    """A key for a script or tool to use the world API as its owner, without a session.

    Sent as `Authorization: Bearer <token>`; honoured on /api/worlds only. Only a SHA-256 digest
    of the token is kept: it is shown once, when made in the admin. Delete it to revoke it.
    """

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='api_tokens')
    name = models.CharField(max_length=100, help_text='What it is for, e.g. “Claude, test worlds”.')
    prefix = models.CharField(max_length=12, editable=False, help_text='The start of the token, to tell tokens apart.')
    digest = models.CharField(max_length=64, unique=True, editable=False)
    created = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ['-created']
        verbose_name = 'API token'

    def __str__(self):
        return f'{self.name} ({self.prefix}…)'

    @staticmethod
    def digest_of(token):
        import hashlib
        return hashlib.sha256(token.encode()).hexdigest()

    @classmethod
    def issue(cls, owner, name):
        """Make a token; returns (the saved row, the token itself, which is not kept)."""
        import secrets
        token = 'ws_' + secrets.token_urlsafe(32)
        row = cls.objects.create(owner=owner, name=name, prefix=token[:10], digest=cls.digest_of(token))
        return row, token
