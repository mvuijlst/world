from django.contrib import admin

from .models import World


@admin.register(World)
class WorldAdmin(admin.ModelAdmin):
    list_display = ['name', 'owner', 'rev', 'updated', 'deleted']
    list_filter = ['owner', ('deleted', admin.EmptyFieldListFilter)]
    search_fields = ['name', 'uid']
    readonly_fields = ['uid', 'rev', 'created', 'updated']
