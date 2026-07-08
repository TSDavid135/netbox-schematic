from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView

# Холсты схематики. Ключ приходит из URL (см. urls.py), передаётся во фронт
# через data-canvas на <body>; JS решает, что рисовать. Пока реализован
# только «infra» — остальные показывают заглушку «в разработке».
CANVASES = {
    'infra': 'Инфраструктура',
    'network': 'Сети',
    'virtualization': 'Виртуализация',
    'vpn': 'Туннели',
}


class SchematicView(LoginRequiredMixin, TemplateView):
    """
    Полноэкранная страница схематики. Работает под сессией NetBox:
    JS внутри шаблона ходит в /api/ того же хоста, токены не нужны.

    Один view обслуживает все холсты; конкретный холст задаётся атрибутом
    ``canvas`` (см. urls.py) и передаётся в шаблон.
    """
    template_name = 'netbox_schematic/schematic.html'
    canvas = 'infra'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['canvas'] = self.canvas
        context['canvas_title'] = CANVASES.get(self.canvas, '')
        # Блок пользователя в шапке (как в оригинальном NetBox): показываем имя
        # залогиненного пользователя со ссылками на его профиль/выход.
        user = self.request.user
        context['user_name'] = user.get_full_name() or user.get_username()
        context['user_login'] = user.get_username()
        return context
