from django.urls import path

from .views import SchematicView

urlpatterns = [
    # Пустой путь = холст «Инфраструктура» (имя 'schematic' сохранено ради
    # обратной совместимости со старыми ссылками на плагин).
    path('', SchematicView.as_view(canvas='infra'), name='schematic'),
    path('network/', SchematicView.as_view(canvas='network'), name='network'),
    path('virtualization/', SchematicView.as_view(canvas='virtualization'), name='virtualization'),
    path('vpn/', SchematicView.as_view(canvas='vpn'), name='vpn'),
]
