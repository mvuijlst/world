from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path

admin.site.site_header = 'WorldSmith'
admin.site.site_title = 'WorldSmith'
admin.site.index_title = 'Accounts and worlds'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('worlds.urls')),
]

if settings.DEBUG:
    # Local development: serve the app from the repository root on the same origin.
    # In production nginx serves those files and only /api/ and /admin/ reach Django.
    from django.views.static import serve as static_serve

    APP_ROOT = settings.BASE_DIR.parent

    def serve(request, **kwargs):
        # never let the browser keep an old copy of an edited script
        response = static_serve(request, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response
    urlpatterns += [
        path('', serve, {'path': 'index.html', 'document_root': APP_ROOT}),
        re_path(r'^(?P<path>(?!server/).+)$', serve, {'document_root': APP_ROOT}),
    ]
