# -*- coding: utf-8 -*-
"""The «Питание» sheet — power cabling as its own table (panel feed / PDU outlet
→ device inlet). Separate from the Patchen sheet: that one describes the data
chain, this one the electrical chain. Import creates what's missing (panels,
feeds, devices, ports), export writes rows the import reads back 1:1."""

from ..excel import Col, ExcelForm, register_form


@register_form
class PowerForm(ExcelForm):
    id = "power"
    label = "Питание (щиты, PDU, вводы)"
    title = "Питание — силовые подключения"
    sheet_name = "Питание"
    header_row = 2          # row 1 is the merged title, captions on row 2
    key_columns = ("src", "dst")

    # CAREFUL with aliases: a caption is matched against EVERY cell, and the last
    # row matching >=2 columns is taken as the header (see excel._find_header).
    # So an alias that also occurs as a VALUE in this very sheet («щит»,
    # «розетка», «фидер», «устройство» — our own src_kind/src_port contents)
    # would make a DATA row look like the header and swallow the whole file.
    # Captions here are deliberately multi-word; at most ONE column may fuzzily
    # match a value («Ввод» vs «Ввод 1»), which stays under the >=2 rule.
    columns = [
        Col("site",     "Площадка",       label_en="Site",
            aliases=["site"]),
        Col("location", "Локация",        label_en="Location",
            aliases=["серверная", "location", "room"]),
        Col("rack",     "Стойка",         label_en="Rack",
            aliases=["шкаф", "rack", "cabinet"]),
        Col("src_kind", "Тип источника",  label_en="Source kind",
            aliases=["source kind"]),
        Col("src",      "Источник",       label_en="Source",
            aliases=["source"]),
        Col("src_port", "Порт источника", label_en="Source port",
            aliases=["source port"]),
        Col("dst",      "Потребитель",    label_en="Consumer",
            aliases=["consumer"]),
        Col("dst_port", "Ввод",           label_en="Inlet",
            aliases=["порт питания", "power port"]),
        Col("dst_role", "Роль",           label_en="Role",
            aliases=["role"]),
        Col("voltage",  "Напряжение, В",  label_en="Voltage, V",
            aliases=["voltage"]),
        Col("amperage", "Ток, А",         label_en="Current, A",
            aliases=["amperage", "current"]),
    ]

    # ── domain logic lives in power.py; the form just wires it up ──

    def collect(self, **scope):
        from .. import exporter
        return exporter.collect_power(**scope)

    def build_plan(self, records, **opts):
        from .. import power
        return power.build_plan(records, **opts)

    def apply_plan(self, plan, site, forced_loc=None, **opts):
        from .. import power
        return power.apply_plan(plan, site, forced_loc=forced_loc, **opts)

    def conflicts(self, plan, site):
        from .. import power
        return power.conflicts(plan, site)

    def warnings(self, plan):
        from .. import power
        return power.plan_warnings(plan)
