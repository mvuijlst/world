from django.urls import path

from . import plates, views

urlpatterns = [
    path('session', views.session, name='session'),
    path('login', views.login_view, name='login'),
    path('logout', views.logout_view, name='logout'),
    path('worlds', views.world_list, name='world-list'),
    path('worlds/<str:uid>', views.world_detail, name='world-detail'),
    path('plates/status', plates.status, name='plates-status'),
    path('plates/export', plates.export, name='plates-export'),
    path('plates/import', plates.import_, name='plates-import'),
]
