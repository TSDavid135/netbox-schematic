# -*- coding: utf-8 -*-
"""
The "Patchen / Unpatchen Datenanschlüsse" sheet.

Cabling it describes (see importer): switch port → patch panel FRONT,
panel REAR → socket REAR, socket FRONT → end device.

A switch reference "6002/4/41" is stack 6002, member 4, port 41 — members are
separate physical switches, modelled as a NetBox VirtualChassis.

Columns are matched by name on import, so users may rename or reorder them.
`pos` only reproduces the original layout when exporting. `after` marks the
columns whose header cell is merged with the previous one ("Anschluß alt:" and
"Anschluß neu:" each span a type + number pair).
"""

from ..excel import Col, ExcelForm, register_form


@register_form
class PatchenForm(ExcelForm):
    id = "patchen"
    label = "Patchen / Unpatchen (Datenanschlüsse)"

    title = "Patchen / Unpatchen — Datenanschlüsse"
    sheet_name = "Datenanschlüsse"
    header_row = 3
    key_columns = ("location", "socket", "rack")
    template = "patchen.xlsx"   # export fills the real template (forms/templates/) 1:1

    columns = [
        Col("anwender", "Anwender(in):", "пользователь", ["user", "пользователь"], pos=1),
        Col("tel", "Tel.:", "телефон", ["phone", "телефон"], pos=2),
        Col("kst", "Kst.:", "", ["kst"], pos=3),
        Col("standort", "Standort Endgerät:", "расположение розеток",
            ["standort", "расположение", "расположение розетки", "placement"], pos=4),
        Col("location", "Technikraum", "серверная",
            ["серверная", "technikraum", "room", "серверная комната"], pos=6),
        Col("socket", "Dose:", "розетка", ["розетка", "dose", "socket", "outlet"], pos=7),
        Col("rack", "DVS:", "шкаф", ["шкаф", "dvs", "cabinet", "rack", "стойка"], pos=8),
        Col("panel", "PF:", "патч-панель",
            ["патч-панель", "патчпанель", "pf", "patchpanel", "panel"], pos=9),
        Col("panel_port", "Port:", "порт", ["порт", "port"], pos=10),
        Col("alt_type", "Anschluß alt:", "демонтаж: свич",
            ["anschluss alt", "демонтаж", "старый свич", "old"], pos=11),
        Col("alt_ref", "", "№ порта", ["№ порта старый", "old port"],
            after="alt_type", pos=12),
        Col("length", "Länge", "длина", ["длина", "laenge", "length"], pos=13),
        Col("neu_type", "Anschluß neu:", "свич",
            ["anschluss neu", "свич", "новый свич", "new", "switch"], pos=14),
        Col("neu_ref", "", "№ порта", ["№ порта", "номер порта", "port no", "sw port"],
            after="neu_type", pos=15),
        Col("netz", "Netz:", "сеть", ["сеть", "netz", "network", "vlan"], pos=16),
        Col("datum", "Datum:", "дата", ["дата", "datum", "date"], pos=17),
    ]

    # ── domain logic lives in importer/exporter; the form just wires it up ──

    def build_plan(self, records, sw_mode="neu_else_alt", **_o):
        from .. import importer
        return importer.build_plan(records, sw_mode=sw_mode)

    def apply_plan(self, plan, site, forced_loc=None, placements=None,
                   rack_sizes=None, overrides=None, conflict_modes=None, **_o):
        from .. import importer
        return importer.apply_plan(plan, site, forced_loc=forced_loc,
                                   placements=placements, rack_sizes=rack_sizes,
                                   overrides=overrides, conflict_modes=conflict_modes)

    def placement(self, plan):
        from .. import importer
        return importer.placement_preview(plan)

    def conflicts(self, plan, site):
        from .. import importer
        return importer.import_conflicts(plan, site)

    def collect(self, **scope):
        from .. import exporter
        return exporter.collect_rows(**scope)
