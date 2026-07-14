# -*- coding: utf-8 -*-
"""
importer.py — turns spreadsheet rows into devices + cables.

The spreadsheet layout itself is described declaratively by an ExcelForm (see
excel.py and forms/patchen.py) whose columns are matched BY NAME, so users may
rename or reorder them. This module only owns the domain logic.

Cabling built per row:  switch port → panel FRONT, panel REAR → socket REAR.
"Anschluss alt" is history — not imported (unless sw_mode says otherwise).

Excel pitfall handled in excel.cell_str: "6902/1/08" is a valid date, so
openpyxl returns a datetime; it is restored to "year/month/day".
"""

import re

from .excel import cell_str, get_form, read_records  # noqa: F401 (cell_str re-exported)

_RE_NUM = re.compile(r"\d+")


def _strip_zero(p):
    """Normalise a numeric port: "08" → "8". Leaves compound refs ("1/0/2") as is."""
    p = str(p or "").strip()
    return str(int(p)) if p.isdigit() else p


def _pnum(name):
    """Last integer in a component name (for matching a model's ports by number):
    "Gi1/0/41" → 41, "Порт 22" → 22, "8" → 8, "REAR" → None."""
    m = _RE_NUM.findall(str(name))
    return int(m[-1]) if m else None


def parse_workbook(file_or_path, form=None):
    """→ (rows, meta). `form` is an ExcelForm (default: the first registered one)."""
    return read_records(file_or_path, form or get_form("patchen"))


def parse_sw_ref(ref):
    """Switch reference from the sheet → (device_name, port, stack, member).

    The sheet writes "<stack>/<member>/<port>": "6002/4/41" is port 41 of the
    4th switch in stack 6002. Members of one stack are separate physical
    switches (6902/1 and 6902/2), modelled as a NetBox VirtualChassis.
    Member device names keep the sheet's "stack/member" notation: "SW 6002/4"
    (the "/" convention — same as the UI stack picker; NetBox allows "/" in names,
    the real member index is vc_position, the name is a readable label).

    Two segments → no stack: ("SW 6002", "41", None, None).
    One segment  → device only.
    """
    ref = (ref or "").strip()
    if not ref:
        return None, None, None, None
    parts = [p for p in ref.split("/") if p != ""]
    if len(parts) >= 3:
        stack, member, port = parts[0], parts[1], _strip_zero("/".join(parts[2:]))
        return "SW %s/%s" % (stack, member), port, stack, member
    if len(parts) == 2:
        return "SW %s" % parts[0], _strip_zero(parts[1]), None, None
    return "SW %s" % parts[0], "", None, None


def build_plan(rows, sw_mode="neu_else_alt"):
    """rows → list of connection plans (what to create). Switch picked by sw_mode:
    neu_else_alt | neu | alt. Returns (plan, summary)."""
    plan = []
    seen_dev = set()      # (kind, key) of unique devices
    for r in rows:
        if sw_mode == "neu":
            ref = r["neu_ref"]
        elif sw_mode == "alt":
            ref = r["alt_ref"]
        else:  # neu_else_alt
            ref = r["neu_ref"] or r["alt_ref"]
        sw_name, sw_port, stack, member = parse_sw_ref(ref)
        item = {
            "row": r["row"], "location": r["location"], "rack": r["rack"],
            "socket": r["socket"], "panel": r["panel"], "panel_port": r["panel_port"],
            "switch": sw_name, "sw_port": sw_port,
            "stack": stack, "member": member, "netz": r["netz"],
        }
        plan.append(item)
        if r["location"]:
            seen_dev.add(("loc", r["location"]))
        if r["rack"]:
            seen_dev.add(("rack", r["location"] + "|" + r["rack"]))
        if r["socket"] and r["panel"]:            # only sockets that reach a panel
            seen_dev.add(("socket", r["socket"]))
        if r["panel"]:
            seen_dev.add(("panel", r["location"] + "|" + r["rack"] + "|" + r["panel"]))
        if sw_name:
            seen_dev.add(("switch", sw_name))
    kinds = {}
    for k, _ in seen_dev:
        kinds[k] = kinds.get(k, 0) + 1
    # cables: 2 per connection with a switch (socket→front, rear→switch), else 1 (socket→front)
    cables = sum(2 if p["switch"] and p["panel"] else (1 if p["panel"] else 0) for p in plan)
    summary = {
        "connections": len(plan),
        "locations": kinds.get("loc", 0), "racks": kinds.get("rack", 0),
        "sockets": kinds.get("socket", 0), "panels": kinds.get("panel", 0),
        "switches": kinds.get("switch", 0), "cables": cables,
    }
    return plan, summary


def plan_warnings(plan):
    """Inconsistencies worth showing in the preview (they do NOT block the import).
    Each: {"row": <sheet row>, "msg": <text>}. Detects dangling refs and reuse:
    a socket with no panel, a switch/panel without a port number, the same switch
    port on two rows, and one socket wired to two different patch ports."""
    out = []
    sw_port, sock_target = {}, {}
    for p in plan:
        row = p.get("row")
        socket, panel, port = p.get("socket"), p.get("panel"), p.get("panel_port")
        switch, sw_p = p.get("switch"), p.get("sw_port")
        if socket and not panel:
            out.append({"row": row, "msg": "розетка «%s» без патч-панели — не будет создана" % socket})
        if switch and not sw_p:
            out.append({"row": row, "msg": "свич «%s» без номера порта" % switch})
        if panel and not port:
            out.append({"row": row, "msg": "патч-панель «%s» без номера порта" % panel})
        if switch and sw_p:
            k = (switch, str(sw_p))
            if k in sw_port:
                out.append({"row": row, "msg": "порт свича %s/%s уже занят строкой %s" % (switch, sw_p, sw_port[k])})
            else:
                sw_port[k] = row
        if socket and panel:
            tgt = (panel, str(port))
            if socket in sock_target and sock_target[socket][0] != tgt:
                prev_tgt, prev_row = sock_target[socket]
                out.append({"row": row, "msg": "розетка %s ведёт на разные порты панели: %s:%s (стр. %s) и %s:%s" % (
                    socket, prev_tgt[0], prev_tgt[1], prev_row, tgt[0], tgt[1])})
            else:
                sock_target[socket] = (tgt, row)
    return out


def _role_kind(role_name):
    """Map an existing device's role name → import kind (for the editor icon)."""
    n = (role_name or "").lower()
    if "оммутатор" in n or "switch" in n:
        return "switch"
    if "розет" in n or "socket" in n:
        return "socket"
    if "панел" in n or "patch" in n:
        return "panel"
    return "dev"


# Conflicts table shows every device in the SAME Excel columns for «сейчас» (traced
# from the DB) and «из файла» (the plan row). These normalise both to one shape.
CONFLICT_COLS = [("socket", "Розетка"), ("location", "Серверная"), ("rack", "Шкаф"),
                 ("panel", "Панель"), ("port", "Порт"), ("switch", "Свич")]


def _disp_plan(p):
    """Plan item → conflicts-table row (what the FILE brings). The switch is written
    in the SAME «stack/member/port» (or «name/port») form the exporter uses for
    «сейчас», so the two columns line up and a diff means a real difference."""
    if p.get("stack") and p.get("member"):
        sw = "%s/%s/%s" % (p["stack"], p["member"], p.get("sw_port") or "")
    elif p.get("switch"):
        nm = p["switch"][3:] if p["switch"].upper().startswith("SW ") else p["switch"]
        sw = ("%s/%s" % (nm, p["sw_port"])) if p.get("sw_port") else nm
    else:
        sw = ""
    return {"socket": p.get("socket") or "", "location": p.get("location") or "",
            "rack": p.get("rack") or "", "panel": p.get("panel") or "",
            "port": p.get("panel_port") or "", "switch": sw}


def _disp_export(r):
    """Exporter row (a device's CURRENT cabling) → the same columns."""
    return {"socket": r.get("socket") or "", "location": r.get("location") or "",
            "rack": r.get("rack") or "", "panel": r.get("panel") or "",
            "port": r.get("panel_port") or "", "switch": r.get("neu_ref") or ""}


def _plan_refs(p, name, kind):
    """Does plan item p reference the conflict device `name` (of `kind`)?"""
    if kind == "switch":
        return p.get("switch") == name
    if kind == "panel":
        return bool(p.get("panel")) and ("Панель %s" % p["panel"]) == name
    if kind == "socket":
        return p.get("socket") == name
    return False


def _conflict_anchor(row):
    """What identifies a physical run across «сейчас» and «из файла». The stable
    endpoint is the WALL SOCKET — a run is patched socket → panel → switch, and BOTH
    the panel port AND the switch port may be re-patched, but the socket stays put.
    So JOIN the two sides on the socket; only then does re-patching read as ONE diff
    (whichever end moved). Fall back to (panel, port) then the switch port for
    socket-less links (panel↔switch infra, a device wired straight into a switch)."""
    sk = row.get("socket") or ""
    if sk:
        return "sk:" + sk
    port = row.get("port") or ""
    if port:
        return "pp:%s/%s" % (row.get("panel") or "", port)
    m = _RE_NUM.findall(row.get("switch") or "")
    return "sw:" + (m[-1] if m else "")


def _build_conflict(current, loaded):
    """JOIN «сейчас» ↔ «из файла» on the socket and keep only the RUNS THAT CHANGED —
    those are the real conflicts that need a keep/replace decision. A run the file
    merely ADDS (no current match) or leaves IDENTICAL is not a conflict. Returns
    (pairs, added, untouched): pairs = [{cur, new, diff}] where diff = the changed
    column keys; added = file runs with no current counterpart; untouched = current
    runs the file doesn't mention."""
    cur_by = {}
    for r in current:
        cur_by.setdefault(_conflict_anchor(r), r)
    file_anchors, pairs, added = set(), [], 0
    for r in loaded:
        a = _conflict_anchor(r)
        file_anchors.add(a)
        m = cur_by.get(a)
        if m is None:
            added += 1                     # the file adds this run — nothing to decide
            continue
        diff = [k for k, _ in CONFLICT_COLS if (m.get(k) or "") != (r.get(k) or "")]
        if diff:
            pairs.append({"cur": m, "new": r, "diff": diff})
        # else identical → not a conflict either
    untouched = sum(1 for r in current if _conflict_anchor(r) not in file_anchors)
    return pairs, added, untouched


def import_conflicts(plan, site):
    """Read-only look at what the plan collides with in `site` (NO DB writes).

    Returns {"devices": [...], "occupancy": {...}, "columns": [[key, label], …]}.
      * devices — devices that ALREADY exist AND have a run the file CHANGES
        (matched BY NAME, joined BY SOCKET): {name, kind, pairs, added, untouched}.
        pairs = [{cur, new, diff}] — only the changed runs (cur = current cabling
        traced from the DB via the exporter, new = the file's row, both in the file's
        Excel columns, diff = changed column keys). added / untouched = counts of runs
        the file merely adds / leaves alone (shown as a note — they're NOT conflicts).
      * occupancy — every device already sitting in a target rack (name, unit,
        height, kind), so the import editor lays the new gear into the FREE units
        instead of overlapping (the duplicate-rack-position crash) and greys the
        existing rows.
    Site None (not chosen yet) → empty, the dialog just shows the plain plan."""
    if site is None:
        return {"devices": [], "occupancy": {}, "columns": CONFLICT_COLS}
    from dcim.models import Device, Rack
    from . import exporter
    ROLE = "role" if any(f.name == "role" for f in Device._meta.get_fields()) else "device_role"

    plan_devs, planned_rack, plan_racks = {}, {}, {}
    for p in plan:
        loc = p.get("location")
        if p.get("panel"):
            nm = "Панель %s" % p["panel"]
            plan_devs.setdefault(nm, "panel"); planned_rack[nm] = p.get("rack")
        if p.get("switch"):
            plan_devs.setdefault(p["switch"], "switch"); planned_rack[p["switch"]] = p.get("rack")
        if p.get("socket") and p.get("panel"):
            plan_devs.setdefault(p["socket"], "socket")
        if p.get("rack"):
            plan_racks.setdefault(p["rack"], loc)

    devices = []
    existing = {d.name: d for d in
                Device.objects.filter(site=site, name__in=list(plan_devs))
                .select_related("device_type", ROLE, "rack", "location")}
    for name, kind in plan_devs.items():
        d = existing.get(name)
        if not d:
            continue
        loaded = [_disp_plan(p) for p in plan if _plan_refs(p, name, kind)]
        try:
            # «сейчас» — the device's live cabling, in the file's own columns.
            current = [_disp_export(r) for r in exporter.collect_rows(device_ids=[d.id])]
        except Exception:
            current = []   # a trace error must never block the preview
        pairs, added, untouched = _build_conflict(current, loaded)
        if not pairs:
            continue   # device exists but no run CHANGED → not a conflict, skip it
        devices.append({"name": name, "kind": kind, "pairs": pairs,
                        "added": added, "untouched": untouched})

    occupancy = {}
    for rname in plan_racks:
        rk = Rack.objects.filter(site=site, name=rname).first()
        if not rk:
            continue
        rows = []
        for d in Device.objects.filter(rack=rk).select_related("device_type", ROLE):
            if d.position is None:
                continue
            role_obj = getattr(d, ROLE, None)
            rows.append({
                "name": d.name, "unit": int(d.position),
                "height": int(getattr(d.device_type, "u_height", 1) or 1),
                "kind": _role_kind(role_obj.name if role_obj else ""),
            })
        if rows:
            occupancy[rname] = rows
    return {"devices": devices, "occupancy": occupancy, "columns": CONFLICT_COLS}


def placement_preview(plan):
    """What the import dialog needs to lay out its rack editor: for every rack
    the panels/switches that will land in it, plus the standalone devices (no
    DVS). Mirrors apply_plan's placement so preview == result. Racks keyed by
    NAME (unique per site). Devices ordered panels-first, then switches."""
    racks, standalone, seen = {}, [], set()
    def add(name, kind, rack, location):
        if not name or (name, kind) in seen:
            return
        seen.add((name, kind))
        if rack:
            r = racks.setdefault(rack, {"rack": rack, "location": location, "devices": []})
            r["devices"].append({"name": name, "kind": kind})
        else:
            standalone.append({"name": name, "kind": kind, "location": location})
    for p in plan:
        loc = p.get("location")
        if p.get("panel"):
            add("Панель %s" % p["panel"], "panel", p.get("rack"), loc)
        if p.get("switch"):
            add(p["switch"], "switch", p.get("rack"), loc)
        if p.get("socket") and p.get("panel"):
            add(p["socket"], "socket", None, loc)   # sockets never rack; skip if no panel
    for r in racks.values():
        r["devices"].sort(key=lambda d: 0 if d["kind"] == "panel" else 1)
    return {"racks": list(racks.values()), "standalone": standalone}


def apply_plan(plan, site, slugify=None, forced_loc=None, placements=None,
               rack_sizes=None, overrides=None, conflict_modes=None):
    """Create/find devices and cables per plan within site `site`.
    forced_loc — if set, ALL cabinets/devices go to that location (otherwise the
    location comes from the row's Technikraum column).
    placements — {device_name: unit} to force rack slots (from the import editor);
    rack_sizes — {rack_name: u_height} for NEW racks. Idempotent (get_or_create).
    conflict_modes — {device_name: "keep"|"update"} per existing device (the
      «Без замены / Заменить» choice). Default (missing) = "keep":
      "keep"   — leave it untouched (only new devices/cables are added);
      "update" — overwrite role/model from that device's override ("Заменить").
      Existing devices are never auto-moved between rack units either way — the
      editor shows them locked; users arrange racks by hand.
    Runs inside the caller's transaction. Returns created stats."""
    import re as _re
    from django.utils.text import slugify as _slug
    from dcim.models import (
        Manufacturer, DeviceType, DeviceRole, Location, Rack, Device,
        Interface, FrontPort, RearPort, PortMapping, Cable, VirtualChassis,
    )
    slugify = slugify or _slug
    ROLE_FIELD = "role" if any(f.name == "role" for f in Device._meta.get_fields()) else "device_role"

    mfr = (Manufacturer.objects.filter(name="Схематика").first()
           or Manufacturer.objects.create(name="Схематика", slug="schematic"))

    def role(name, color, mslug, u=1):
        r = (DeviceRole.objects.filter(name=name).first()
             or DeviceRole.objects.create(name=name, slug=slugify(name) or mslug, color=color))
        dt = (DeviceType.objects.filter(manufacturer=mfr, model=name).first()
              or DeviceType.objects.create(manufacturer=mfr, model=name, slug=mslug, u_height=u))
        return r, dt
    r_sock, dt_sock = role("Розетки", "78909c", "imp-socket")
    r_pan, dt_pan = role("Патч-панель", "9e9e9e", "imp-patch")
    r_sw, dt_sw = role("Коммутатор", "8bc34a", "imp-switch")

    st = {"loc": 0, "rack": 0, "dev": 0, "cable": 0, "stack": 0, "netz": 0}

    def join_stack(device, stack, member):
        """Put the switch into its stack (NetBox VirtualChassis), member at
        vc_position. Members of one stack are separate physical switches, so a
        chassis — not a fake cable between them — is the honest model.

        Defensive when the switch is ALREADY stacked (re-import / manual edits):
          * same stack + position → no-op (clean, idempotent re-import);
          * a DIFFERENT stack → move it here (the sheet drives stack membership),
            handing off the old chassis' master first so it is never left
            pointing at a non-member;
          * the sheet's slot already taken by another switch → join WITHOUT a
            fixed position instead of aborting the whole import on the
            (virtual_chassis, vc_position) unique constraint. The admin (or a
            corrected sheet) resolves the clash; a crash would lose everything.
        """
        if not (stack and member):
            return
        vc, made = VirtualChassis.objects.get_or_create(name=stack)
        st["stack"] += made
        pos = int(member) if str(member).isdigit() else None

        def promote(p):
            # Master = the lowest member number, not whichever row we hit first.
            cur = vc.master
            if cur is None or (p is not None and (cur.vc_position is None or p < cur.vc_position)):
                vc.master = device
                vc.save()

        if device.virtual_chassis_id == vc.id and device.vc_position == pos:
            promote(pos)                       # already correctly placed
            return

        # Leaving another chassis where it was master → hand off first.
        old = device.virtual_chassis
        if old and old.id != vc.id and old.master_id == device.id:
            old.master = (Device.objects.filter(virtual_chassis=old)
                          .exclude(pk=device.pk).order_by("vc_position").first())
            old.save()

        # Slot already taken by a different switch → join unpositioned (no crash).
        clash = pos is not None and (Device.objects
                                     .filter(virtual_chassis=vc, vc_position=pos)
                                     .exclude(pk=device.pk).exists())
        device.virtual_chassis = vc
        device.vc_position = None if clash else pos
        device.save()
        promote(device.vc_position)

    def loc(name):
        if not name:
            return None
        o, c = Location.objects.get_or_create(site=site, name=name,
                                              defaults={"slug": (slugify(name) or "loc")[:100], "status": "active"})
        st["loc"] += c
        return o

    def rack(name, location):
        if not name:
            return None
        size = int((rack_sizes or {}).get(name) or 42)
        o, c = Rack.objects.get_or_create(site=site, name=name,
                                          defaults={"location": location, "u_height": size, "status": "active"})
        st["rack"] += c
        return o

    def dev(name, r_role, dt, location, rk=None):
        # Per-device override from the import editor: a custom model / role for a
        # NEW device (existing ones keep theirs — defaults are ignored on match).
        ov = (overrides or {}).get(name)
        if ov:
            if ov.get("role"):
                r_role = (DeviceRole.objects.filter(name=ov["role"]).first()
                          or DeviceRole.objects.create(
                              name=ov["role"], slug=(slugify(ov["role"]) or "role")[:100], color="607d8b"))
            if ov.get("model"):
                dt = (DeviceType.objects.filter(model=ov["model"]).first()
                      or DeviceType.objects.create(
                          manufacturer=mfr, model=ov["model"],
                          slug=(slugify(ov["model"]) or "model")[:100], u_height=dt.u_height))
        kw = {"device_type": dt, ROLE_FIELD: r_role, "location": location, "status": "active"}
        if rk is not None:
            kw["rack"] = rk
        o, c = Device.objects.get_or_create(name=name, site=site, defaults=kw)
        # «Заменить» for THIS device: overwrite role/model from its override
        # (get_or_create ignored the defaults on a match). «Без замены» leaves it.
        if not c and (conflict_modes or {}).get(name) == "update" and ov:
            changed = False
            if ov.get("role"):
                setattr(o, ROLE_FIELD, r_role); changed = True
            if ov.get("model"):
                o.device_type = dt; changed = True
            if changed:
                o.save()
        st["dev"] += c
        return o

    def iface(device, num):
        # If the device's MODEL already provides an interface with this number
        # (e.g. a real switch template), cable onto it — don't spawn a duplicate.
        want = _pnum(num)
        if want is not None:
            for i in Interface.objects.filter(device=device):
                if _pnum(i.name) == want:
                    return i
        return Interface.objects.get_or_create(device=device, name=str(num), defaults={"type": "1000base-t"})[0]

    def frontrear(dev, num, adhoc_name):
        # Reuse the model's front/rear port matching `num` (a 24-port patch-panel
        # template already has ports 1-24 — the cable must land on port 22, not a
        # new «Порт 22»). Only when BOTH sides match; otherwise make an ad-hoc pair.
        want = _pnum(num)
        fp = rp = None
        if want is not None:
            rp = next((p for p in RearPort.objects.filter(device=dev) if _pnum(p.name) == want), None)
            fp = next((p for p in FrontPort.objects.filter(device=dev) if _pnum(p.name) == want), None)
        if fp and rp:
            PortMapping.objects.get_or_create(front_port=fp, front_port_position=1,
                                              defaults={"rear_port": rp, "rear_port_position": 1})
            return fp, rp
        rp = (RearPort.objects.filter(device=dev, name=adhoc_name).first()
              or RearPort.objects.create(device=dev, name=adhoc_name, type="8p8c", positions=1))
        fp = (FrontPort.objects.filter(device=dev, name=adhoc_name).first()
              or FrontPort.objects.create(device=dev, name=adhoc_name, type="8p8c", positions=1))
        PortMapping.objects.get_or_create(front_port=fp, front_port_position=1,
                                          defaults={"rear_port": rp, "rear_port_position": 1})
        return fp, rp

    def link(a, b):
        if a is None or b is None or getattr(a, "cable_id", None) or getattr(b, "cable_id", None):
            return
        c = Cable(status="connected"); c.a_terminations = [a]; c.b_terminations = [b]; c.save()
        a.cable_id = b.cable_id = c.id
        st["cable"] += 1

    def free_port(port, dev_name):
        """«Заменить» for THIS device → drop an existing cable on its port so the
        file's wiring replaces it (a socket that moved to a different patch panel,
        a panel port re-patched to another switch, …). «Без замены» (the default)
        leaves the port alone, so link() below keeps the current cable. Only the
        device the user explicitly chose to replace is ever unwired."""
        if port is None or (conflict_modes or {}).get(dev_name) != "update":
            return
        cid = getattr(port, "cable_id", None)
        if cid:
            Cable.objects.filter(id=cid).delete()   # frees BOTH ends in the DB
            port.cable_id = None
            st["recabled"] = st.get("recabled", 0) + 1

    def place(device, rk):
        """Rack the device in the HIGHEST free unit (panels/switches fill from the
        top). No-op if it isn't racked or already has a slot — so re-import never
        moves a device the user has since repositioned."""
        if rk is None or device.rack_id != rk.id or device.position is not None:
            return
        # Units already taken by OTHER devices in this rack (existing gear + imports
        # placed earlier this run). We honour the editor's explicit slot ONLY when
        # it is free — otherwise fall back to the highest free unit, so a stale/
        # overlapping placement never aborts the whole import on the
        # (rack, position, face) unique constraint (the "duplicate key" crash).
        used = set()
        for d in Device.objects.filter(rack=rk).exclude(pk=device.pk):
            if d.position is None:
                continue
            h = int(getattr(d.device_type, "u_height", 1) or 1)
            for u in range(int(d.position), int(d.position) + max(h, 1)):
                used.add(u)
        h = int(getattr(device.device_type, "u_height", 1) or 1)
        want = (placements or {}).get(device.name)
        if want is not None:                       # explicit slot from the import editor
            want = int(want)
            if all((want + i) not in used for i in range(h)):
                device.position = want; device.face = "front"; device.save()
                return
            # editor slot got occupied (existing gear) → auto-place below
        top = int(rk.u_height or 42)
        for start in range(top - h + 1, 0, -1):
            if all((start + i) not in used for i in range(h)):
                device.position = start
                device.face = "front"
                device.save()
                return

    _RE_NETZ = _re.compile(r"\s*\[Сеть:[^\]]*\]")

    def set_netz(port, netz):
        # Option-2 storage for the sheet's «Netz» column: keep the value as a
        # parseable [Сеть: …] marker in the switch-port description (no VLAN objects
        # yet — see roadmap). Idempotent; never clobbers human text; the exporter
        # reads it back, and a later VLAN migration can consume it.
        netz = (netz or "").strip()
        if not (port and netz):
            return
        marker = "[Сеть: %s]" % netz
        desc = port.description or ""
        if marker in desc:
            return
        base = _RE_NETZ.sub("", desc).strip()          # drop a stale marker if any
        new = (base + " " + marker).strip() if base else marker
        if new != (port.description or ""):
            port.description = new
            port.save()
            st["netz"] += 1

    for p in plan:
        location = loc(forced_loc or p["location"])   # forced_loc overrides Technikraum
        rk = rack(p["rack"], location)
        # Socket = panel-like node (front↔rear): rear faces the patch panel,
        # front faces the end device (PC, phone, camera…). Only create it when the
        # row actually connects it to a panel — a socket with nothing to cable to
        # would be a dangling "occupied" port, which confuses the schema.
        s_rp = None
        if p["socket"] and p["panel"]:
            sock = dev(p["socket"], r_sock, dt_sock, location)
            _, s_rp = frontrear(sock, "1", "Гнездо 1")
        # Patch panel: always created. With a DVS it goes into that rack, at the
        # top unit (placed first, so it wins the highest slot); without one it's a
        # standalone node.
        fp = rp = None
        if p["panel"]:
            panel = dev("Панель %s" % p["panel"], r_pan, dt_pan, location, rk)
            place(panel, rk)
            fp, rp = frontrear(panel, p["panel_port"], "Порт %s" % (p["panel_port"] or "1"))
        sw_if = None
        if p["switch"]:
            # New switch → same DVS rack if the row names one (filling from the top,
            # below the panel), else standalone. Existing ones keep their place.
            sw = dev(p["switch"], r_sw, dt_sw, location, rk)
            place(sw, rk)
            join_stack(sw, p.get("stack"), p.get("member"))
            sw_if = iface(sw, p["sw_port"] or "1")
            set_netz(sw_if, p.get("netz"))   # «Netz» → switch-port description marker (option 2)
        # «Заменить»: free this row's ports whose device the user chose to replace,
        # so a changed cabling actually swaps instead of being skipped as "occupied".
        pname = ("Панель %s" % p["panel"]) if p["panel"] else None
        free_port(sw_if, p["switch"])
        free_port(fp, pname); free_port(rp, pname)
        free_port(s_rp, p["socket"])
        # Real cabling: switch port → panel FRONT; panel REAR → socket REAR.
        # (The panel's front faces the switch, its rear runs into the wall.)
        link(sw_if, fp)
        link(rp, s_rp)
    return st
