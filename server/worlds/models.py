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
