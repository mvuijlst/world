from django.urls import path

from . import views

urlpatterns = [
    path('session', views.session, name='session'),
    path('login', views.login_view, name='login'),
    path('logout', views.logout_view, name='logout'),
    path('worlds', views.world_list, name='world-list'),
    path('worlds/<str:uid>', views.world_detail, name='world-detail'),
]
