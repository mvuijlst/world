from django.contrib import admin, messages

from .models import ApiToken, World


@admin.register(World)
class WorldAdmin(admin.ModelAdmin):
    list_display = ['name', 'owner', 'rev', 'updated', 'deleted']
    list_filter = ['owner', ('deleted', admin.EmptyFieldListFilter)]
    search_fields = ['name', 'uid']
    readonly_fields = ['uid', 'rev', 'created', 'updated']


@admin.register(ApiToken)
class ApiTokenAdmin(admin.ModelAdmin):
    """Add one to get a token (shown once, at the top of the page); delete it to revoke it."""

    list_display = ['name', 'owner', 'prefix', 'created', 'last_used']
    list_filter = ['owner']
    fields = ['owner', 'name', 'prefix', 'created', 'last_used']
    readonly_fields = ['prefix', 'created', 'last_used']

    def has_change_permission(self, request, obj=None):
        return False                        # a token is made or deleted, never edited

    def save_model(self, request, obj, form, change):
        if change:
            return
        row, token = ApiToken.issue(obj.owner, obj.name)
        obj.pk, obj.prefix, obj.digest, obj.created = row.pk, row.prefix, row.digest, row.created
        messages.warning(request, f'Copy the token for “{row.name}” now; it is not kept and will not be shown again: {token}')
