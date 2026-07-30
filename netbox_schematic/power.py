# -*- coding: utf-8 -*-
"""
power.py — the «Питание» sheet's domain logic (inverse of exporter.collect_power).

One row = one power cable: SOURCE (panel feed or a device outlet) → CONSUMER
inlet (power port). Missing objects are CREATED, same as the patch-panel import
does with devices/sockets: panels, feeds, devices, ports and the cable itself.

Kept apart from importer.py on purpose — that module is the Patchen sheet's
socket→panel→switch chain, this one is the electrical chain, and mixing them
would tangle two unrelated plans.
"""

from .exporter import SRC_PANEL, SRC_DEVICE

MANUFACTURER = "Схематика"
# Role/model given to devices the sheet mentions but NetBox doesn't have yet.
ROLE_PDU = ("PDU", "ff9800", "imp-pdu")
ROLE_LOAD = ("Оборудование", "78909c", "imp-load")


def _s(v):
    return ("" if v is None else str(v)).strip()


def _num(v):
    """«230»/«230 В»/«32,5» → number or None (feed voltage/amperage)."""
    txt = _s(v).replace(",", ".")
    keep = "".join(c for c in txt if c.isdigit() or c == ".")
    if not keep:
        return None
    try:
        f = float(keep)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def _kind_of(raw, src_port):
    """Source kind from the column; empty/unknown → guess by the port name
    («Фидер …» is a panel feed, anything else an outlet), so a hand-typed sheet
    still imports."""
    k = _s(raw).lower()
    if k.startswith("щит") or k.startswith("panel") or k.startswith("фид"):
        return SRC_PANEL
    if k:
        return SRC_DEVICE
    return SRC_PANEL if _s(src_port).lower().startswith("фид") else SRC_DEVICE


def build_plan(records, **_o):
    """Sheet records → plan entries (no DB access). A row missing a piece is KEPT
    and flagged `incomplete` instead of being dropped silently — apply_plan skips
    those, plan_warnings names them, so nothing vanishes without the user seeing
    it. Returns (plan, summary)."""
    plan = []
    for i, r in enumerate(records or []):
        src, src_port = _s(r.get("src")), _s(r.get("src_port"))
        dst, dst_port = _s(r.get("dst")), _s(r.get("dst_port"))
        if not (src or dst):
            continue                       # wholly empty row — nothing to report
        kind = _kind_of(r.get("src_kind"), src_port)
        missing = []
        if not src:
            missing.append("источник")
        if not dst:
            missing.append("потребитель")
        if not dst_port:
            missing.append("ввод")
        plan.append({
            "row": r.get("row") or (i + 1),     # read_records stamps the sheet row
            "site": _s(r.get("site")), "location": _s(r.get("location")),
            "rack": _s(r.get("rack")),
            "src_kind": kind,
            "src": src,
            # No port named? Assume the first one OF THE RIGHT KIND (a feed for a
            # panel, an outlet for a device) and say so in the warnings.
            "src_port": src_port or (("Фидер 1" if kind == SRC_PANEL else "Розетка 1") if src else ""),
            "src_port_guessed": bool(src and not src_port),
            "dst": dst, "dst_port": dst_port,
            "dst_role": _s(r.get("dst_role")),
            "voltage": _num(r.get("voltage")), "amperage": _num(r.get("amperage")),
            "incomplete": ", ".join(missing),
        })
    usable = [p for p in plan if not p["incomplete"]]
    panels = {p["src"] for p in usable if p["src_kind"] == SRC_PANEL}
    sources = {p["src"] for p in usable if p["src_kind"] == SRC_DEVICE}
    summary = {"links": len(usable), "panels": len(panels),
               "sources": len(sources), "consumers": len({p["dst"] for p in usable})}
    return plan, summary


def plan_warnings(plan):
    """Inconsistencies to show in the import preview (they don't block it) —
    the power analogue of importer.plan_warnings. Each: {"row", "msg"}.
    A port carries ONE cable, so the same inlet (or the same feed/outlet) on two
    rows means the second one will be skipped — the user must see that BEFORE
    committing, otherwise part of the file silently doesn't import."""
    out = []
    seen_dst, seen_src = {}, {}
    for p in plan:
        row = p.get("row")
        if p.get("incomplete"):
            out.append({"row": row, "msg": "строка не будет импортирована — не указано: %s" % p["incomplete"]})
            continue
        if p.get("src_port_guessed"):
            out.append({"row": row, "msg": "у источника «%s» не указан порт — беру «%s»" % (p["src"], p["src_port"])})
        # State the FACT (the port appears twice), don't promise which row loses:
        # whichever is applied first wins, and an earlier row may itself have been
        # skipped for another reason.
        dk = (p["dst"], p["dst_port"])
        if dk in seen_dst:
            out.append({"row": row, "msg": "ввод %s/%s указан ещё в строке %s — порт принимает только один кабель"
                                           % (p["dst"], p["dst_port"], seen_dst[dk])})
        else:
            seen_dst[dk] = row
        sk = (p["src"], p["src_port"])
        if sk in seen_src:
            out.append({"row": row, "msg": "%s %s/%s указан ещё в строке %s — источник отдаёт только один кабель"
                                           % ("фидер" if p["src_kind"] == SRC_PANEL else "розетка",
                                              p["src"], p["src_port"], seen_src[sk])})
        else:
            seen_src[sk] = row
        if p["src"] == p["dst"]:
            out.append({"row": row, "msg": "устройство «%s» запитано само от себя" % p["src"]})
    return out


def conflicts(plan, site):
    """Preview: consumer inlets that are ALREADY cabled elsewhere — importing
    would skip them (a port takes one cable). Shape matches what the import
    dialog renders for the patch sheet."""
    cols = [{"key": "dst", "label": "Потребитель"}, {"key": "dst_port", "label": "Ввод"},
            {"key": "cur", "label": "Сейчас подключён к"}, {"key": "new", "label": "В файле"}]
    if not site:
        return {"devices": [], "occupancy": {}, "columns": cols}
    from dcim.models import Device, PowerPort
    from .exporter import _far_ref, _far_port
    out = []
    for p in plan:
        if p.get("incomplete"):
            continue
        dev = Device.objects.filter(site=site, name=p["dst"]).first()
        if not dev:
            continue
        port = PowerPort.objects.filter(device=dev, name=p["dst_port"]).first()
        if not port or not port.cable_id:
            continue
        cur = _far_ref(_far_port(port))
        new = "%s/%s" % (p["src"], p["src_port"])
        if cur and cur != new:
            out.append({"name": p["dst"], "dst": p["dst"], "dst_port": p["dst_port"],
                        "cur": cur, "new": new, "row": p["row"]})
    return {"devices": out, "occupancy": {}, "columns": cols}


def apply_plan(plan, site, forced_loc=None, **_o):
    """Create what's missing and cable it up, inside the caller's transaction.
    Idempotent: existing panels/feeds/devices/ports are reused, an inlet that
    already carries a cable is left alone (counted as `skipped`)."""
    from django.utils.text import slugify as _slug
    from dcim.models import (Manufacturer, DeviceType, DeviceRole, Location, Device,
                             PowerPanel, PowerFeed, PowerPort, PowerOutlet, Cable)

    mfr = (Manufacturer.objects.filter(name=MANUFACTURER).first()
           or Manufacturer.objects.create(name=MANUFACTURER, slug="schematic"))
    st = {"loc": 0, "panel": 0, "feed": 0, "dev": 0, "port": 0, "cable": 0, "skipped": 0}
    _roles = {}

    def role_type(spec):
        name, color, mslug = spec
        if name in _roles:
            return _roles[name]
        r = (DeviceRole.objects.filter(name=name).first()
             or DeviceRole.objects.create(name=name, slug=_slug(name) or mslug, color=color))
        dt = (DeviceType.objects.filter(manufacturer=mfr, model=name).first()
              or DeviceType.objects.create(manufacturer=mfr, model=name, slug=mslug, u_height=1))
        _roles[name] = (r, dt)
        return r, dt

    def loc(name):
        name = forced_loc or name
        if not name:
            return None
        o, made = Location.objects.get_or_create(
            site=site, name=name, defaults={"slug": (_slug(name) or "loc")[:100]})
        st["loc"] += made
        return o

    def device(name, location, spec):
        d = Device.objects.filter(site=site, name=name).first()
        if d:
            return d
        r, dt = role_type(spec)
        d = Device.objects.create(name=name, site=site, location=location,
                                  device_type=dt, role=r, status="active")
        st["dev"] += 1
        return d

    def source_end(p, location):
        """The cable's A side: a panel feed or a device outlet (created if new)."""
        if p["src_kind"] == SRC_PANEL:
            panel = PowerPanel.objects.filter(site=site, name=p["src"]).first()
            if not panel:
                panel = PowerPanel.objects.create(site=site, name=p["src"], location=location)
                st["panel"] += 1
            feed = PowerFeed.objects.filter(power_panel=panel, name=p["src_port"]).first()
            if not feed:
                feed = PowerFeed.objects.create(
                    power_panel=panel, name=p["src_port"], status="active", supply="ac",
                    phase="single-phase",
                    **{k: v for k, v in (("voltage", p["voltage"]), ("amperage", p["amperage"]))
                       if v is not None})
                st["feed"] += 1
            return feed
        dev = device(p["src"], location, ROLE_PDU)
        out = PowerOutlet.objects.filter(device=dev, name=p["src_port"]).first()
        if not out:
            out = PowerOutlet.objects.create(device=dev, name=p["src_port"])
            st["port"] += 1
        return out

    for p in plan:
        if p.get("incomplete"):            # flagged in the preview — never guessed at here
            st["skipped"] += 1
            continue
        location = loc(p["location"])
        dst = device(p["dst"], location, ROLE_LOAD)
        inlet = PowerPort.objects.filter(device=dst, name=p["dst_port"]).first()
        if not inlet:
            inlet = PowerPort.objects.create(device=dst, name=p["dst_port"])
            st["port"] += 1
        if inlet.cable_id:                 # already cabled — never re-wire silently
            st["skipped"] += 1
            continue
        src = source_end(p, location)
        if getattr(src, "cable_id", None):  # source busy (outlet/feed take one cable)
            st["skipped"] += 1
            continue
        c = Cable(status="connected")
        c.a_terminations = [src]
        c.b_terminations = [inlet]
        c.save()
        st["cable"] += 1
    return st
