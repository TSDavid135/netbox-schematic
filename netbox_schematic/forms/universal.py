# -*- coding: utf-8 -*-
"""Universal device export — a plain inventory of the selected scope (any
devices), with Russian or English column captions. Export-only."""

from ..excel import Col, ExcelForm, register_form


@register_form
class UniversalForm(ExcelForm):
    id = "universal"
    label = "Универсальный список устройств"
    title = "Устройства"
    sheet_name = "Устройства"
    header_row = 2         # row 1 is the merged title, captions on row 2

    columns = [
        Col("name",     "Устройство", label_en="Device"),
        Col("role",     "Роль",       label_en="Role"),
        Col("model",    "Модель",     label_en="Model"),
        Col("site",     "Площадка",   label_en="Site"),
        Col("location", "Локация",    label_en="Location"),
        Col("rack",     "Стойка",     label_en="Rack"),
        Col("unit",     "Юнит",       label_en="Unit"),
        Col("links",    "Соединения", label_en="Connections"),
    ]

    def collect(self, **scope):
        from .. import exporter
        return exporter.collect_universal(**scope)
