# -*- coding: utf-8 -*-
"""netbox-schematic 0.68.46 — release smoke test (RUN ON THE SERVER).

Covers this release's work: import-conflict detection (join on the socket),
«Без замены / Заменить» re-cabling, export filling the REAL template, the rack
duplicate-slot fix, and the wireless-link delete order. Synthetic fixtures, ONE
transaction, rolled back — nothing is persisted. Prints PASS/FAIL as it goes.
"""
import sys, os, io
for _d in ("/tmp", "tests", os.path.join(os.getcwd(), "tests"), os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."):
    if os.path.isfile(os.path.join(_d, "_tx.py")):
        sys.path.insert(0, _d); break
import _tx
from django.db import transaction
from django.db.models import ProtectedError
from dcim.models import (Site, Manufacturer, DeviceType, DeviceRole, Device,
                         Interface, RearPort)
from wireless.models import WirelessLink
from netbox_schematic import importer, exporter
from netbox_schematic.excel import get_form

PASS, FAIL = [], []
def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (("  — " + detail) if detail else ""))

def row(r, socket, panel, port, sw, swport, loc="RT-LOC", rack="RT-RACK"):
    return {"row": r, "location": loc, "rack": rack, "socket": socket, "panel": panel,
            "panel_port": port, "switch": sw, "sw_port": swport,
            "stack": None, "member": None, "netz": ""}

def cur_panel(dev):
    rows = exporter.collect_rows(device_ids=[dev.id])
    return rows[0]["panel"] if rows else None

_tx.begin()
try:
    print("=== netbox-schematic 0.68.46 — release smoke test ===")
    site = Site.objects.create(name="RT-SMOKE", slug="rt-smoke", status="active")

    # Fixture: RT-A -> panel 1 port 5 -> SW RT-X port 10 (real socket/panel/switch + cables)
    with transaction.atomic():
        importer.apply_plan([row(2, "RT-A", "1", "5", "SW RT-X", "10")], site)
    a = Device.objects.get(name="RT-A", site=site)
    check("fixture built (RT-A on panel 1)", cur_panel(a) == "1", "panel=%s" % cur_panel(a))

    # Re-import: MOVE RT-A to panel 2 (same switch port), and ADD a new socket RT-B.
    reimp = [row(2, "RT-A", "2", "5", "SW RT-X", "10"),
             row(3, "RT-B", "2", "6", "SW RT-X", "11")]

    # 1) import_conflicts — only the CHANGED run is a conflict; the added one is not.
    print("--- 1. import_conflicts (join on socket) ---")
    conf = importer.import_conflicts(reimp, site)
    devs = {d["name"]: d for d in conf["devices"]}
    check("socket RT-A is flagged as a conflict", "RT-A" in devs, "conflict devices=%s" % list(devs))
    if "RT-A" in devs:
        d = devs["RT-A"]
        check("RT-A has exactly 1 changed pair", len(d["pairs"]) == 1, "pairs=%d" % len(d["pairs"]))
        check("RT-A diff is the panel (1->2)", bool(d["pairs"]) and "panel" in d["pairs"][0]["diff"],
              "diff=%s" % (d["pairs"][0]["diff"] if d["pairs"] else None))
    check("new socket RT-B is NOT a conflict", "RT-B" not in devs)

    # 2) «Без замены» keeps the current cabling; «Заменить» re-cables the socket.
    print("--- 2. keep vs replace (free_port) ---")
    with transaction.atomic():
        importer.apply_plan(reimp, site, conflict_modes={})            # keep (default)
    check("«Без замены»: RT-A still on panel 1", cur_panel(a) == "1", "panel=%s" % cur_panel(a))
    with transaction.atomic():
        importer.apply_plan(reimp, site, conflict_modes={"RT-A": "update"})   # replace
    check("«Заменить»: RT-A moved to panel 2", cur_panel(a) == "2", "panel=%s" % cur_panel(a))

    # 3) Export fills the REAL template (merged title A1:Q3) and re-imports.
    print("--- 3. export fills the real template ---")
    rows_out = exporter.collect_rows(site_ids=[site.id])
    data = exporter.write_workbook(rows_out, get_form("patchen"))
    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(data)).active
    check("export used the template (title merged A1:Q3)",
          any(str(m) == "A1:Q3" for m in ws.merged_cells.ranges), "merges=%d" % len(ws.merged_cells.ranges))
    rt, _m = importer.parse_workbook(io.BytesIO(data), get_form("patchen"))
    check("exported sheet re-imports (round-trip)", len(rt) >= 1, "rows=%d" % len(rt))

    # 4) Rack duplicate-slot fix — applying more gear into the same rack must not crash.
    print("--- 4. rack placement never crashes ---")
    crashed = False
    try:
        with transaction.atomic():
            importer.apply_plan([row(9, "RT-C", "3", "1", "SW RT-Y", "1")], site)
    except Exception as e:
        crashed = True; print("     crash:", e)
    check("apply_plan did not hit the (rack,position,face) unique constraint", not crashed)

    # 5) Wireless: a link PROTECTs its interfaces; delete the link BEFORE the device.
    print("--- 5. wireless delete order ---")
    mfr = Manufacturer.objects.create(name="RT-MFR", slug="rt-mfr")
    dt = DeviceType.objects.create(manufacturer=mfr, model="RT-DT", slug="rt-dt")
    role = DeviceRole.objects.create(name="RT-ROLE", slug="rt-role")
    ROLE = "role" if any(f.name == "role" for f in Device._meta.get_fields()) else "device_role"
    d1 = Device.objects.create(name="RT-W1", device_type=dt, site=site, **{ROLE: role})
    d2 = Device.objects.create(name="RT-W2", device_type=dt, site=site, **{ROLE: role})
    i1 = Interface.objects.create(device=d1, name="wlan0", type="ieee802.11ac")
    i2 = Interface.objects.create(device=d2, name="wlan0", type="ieee802.11ac")
    wl = WirelessLink.objects.create(interface_a=i1, interface_b=i2)
    protected = False
    try:
        d1.delete()
    except ProtectedError:
        protected = True
    check("deleting a device with a live radio link is PROTECTed (the HTTP 409)", protected)
    wl.delete(); d1.delete(); d2.delete()
    check("after dropping the WirelessLink, the devices delete cleanly", True)

    print("\n=== RESULT: %d passed, %d failed ===" % (len(PASS), len(FAIL)))
    if FAIL:
        print("FAILURES: " + ", ".join(FAIL))
except Exception as e:
    import traceback; traceback.print_exc()
    print("SMOKE TEST ERRORED:", e)
finally:
    _tx.rollback((Site, {"slug": "rt-smoke"}),
                 (Device, {"site__slug": "rt-smoke"}),
                 (Manufacturer, {"slug": "rt-mfr"}))
