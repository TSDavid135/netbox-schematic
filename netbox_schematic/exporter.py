# -*- coding: utf-8 -*-
"""
exporter.py — exports cable links of the selected scope into the
"Patchen / Unpatchen Datenanschlüsse" Excel template (inverse of importer.py).

For each socket (role «Розетки») we trace: socket → patch panel front →
(mapping) rear → switch, and write a template row. Column positions match what
importer.COL reads (F=room, G=socket, H=cabinet, I=PF, J=port, N/O=switch,
P=network) so the exported file can be read back by the import.
"""

import io
import re


def _num(name):
    """«Панель 10»/«Порт 20» → "10"/"20"; otherwise the original name."""
    if not name:
        return ""
    m = re.search(r"(\d+)", str(name))
    return m.group(1) if m else str(name)


def _far_port(port):
    """Port on the OTHER end of the cable (or None)."""
    from dcim.models import Cable
    cid = getattr(port, "cable_id", None)
    if not cid:
        return None
    cable = Cable.objects.filter(id=cid).prefetch_related("terminations").first()
    if not cable:
        return None
    for ct in cable.terminations.all():
        t = ct.termination
        if t and not (t.__class__ is port.__class__ and t.pk == port.pk):
            return t
    return None


def _mapped_rear(front_port):
    """RearPort mapped to the front port (PortMapping)."""
    from dcim.models import PortMapping
    pm = PortMapping.objects.filter(front_port=front_port).select_related("rear_port").first()
    return pm.rear_port if pm else None


def _mapped_front(rear_port):
    """FrontPort mapped to the rear port (reverse PortMapping)."""
    from dcim.models import PortMapping
    pm = PortMapping.objects.filter(rear_port=rear_port).select_related("front_port").first()
    return pm.front_port if pm else None


def _is_socket(dev):
    role = (dev.role.name if dev.role_id else "").lower()
    return ("розет" in role) or ("socket" in role) or ("dose" in role)


def _is_panel(dev):
    role = (dev.role.name if dev.role_id else "").lower()
    return ("патч" in role) or ("пач" in role) or ("panel" in role)


def _sw_ref(dev, port_name):
    """Switch interface → the sheet's "<stack>/<member>/<port>" reference.
    Rebuilt from the VirtualChassis the switch belongs to, so the device name
    ("SW 6002/4") never has to be parsed back."""
    vc = getattr(dev, "virtual_chassis", None)
    if vc and dev.vc_position is not None:
        return "%s/%s/%s" % (vc.name, dev.vc_position, port_name)
    name = dev.name or ""
    if name.upper().startswith("SW "):
        name = name[3:]
    return "%s/%s" % (name, port_name)


# Infrastructure (not "end devices") — we do NOT build rows from these: switches/
# routers and panels are the far side of a row; power gear is outside the
# Datenanschlüsse template.
_INFRA = ("коммутатор", "switch", "роутер", "router", "межсетев", "firewall",
          "патч", "panel", "pdu", "ибп", "ups", "стабилизатор", "щит", "медиаконв")


def _is_infra(dev):
    role = (dev.role.name if dev.role_id else "").lower()
    return any(k in role for k in _INFRA)


def _row_for(d, s_rp):
    """Export row from socket d's rear port (None if the port is not cabled).

    Real cabling (see importer): switch port → panel FRONT, panel REAR → socket
    REAR. So walking back from the socket: socket(rear) → panel REAR →
    (mapping) → panel FRONT → switch port.
    """
    from dcim.models import RearPort, Interface
    far = _far_port(s_rp)
    if far is None:
        return None
    panel = port = switch = swref = None
    if isinstance(far, RearPort):
        panel = far.device
        port = _num(far.name)
        fp = _mapped_front(far)
        if fp:
            swp = _far_port(fp)
            if isinstance(swp, Interface):
                switch, swref = swp.device, _sw_ref(swp.device, swp.name)
    elif isinstance(far, Interface):
        switch, swref = far.device, _sw_ref(far.device, far.name)   # socket straight into a switch
    # DVS (cabinet): the panel's rack; with no panel (device straight into a
    # switch), the SWITCH's rack — that's where the patch lands. Fall back to the
    # socket's own rack only if neither is racked.
    rack = ((panel.rack if (panel and panel.rack_id) else None)
            or (switch.rack if (switch and switch.rack_id) else None) or d.rack)
    return {
        # Standort Endgerät = the socket's office; Technikraum = the rack's room.
        "standort": d.location.name if d.location_id else "",
        "location": rack.location.name if (rack and rack.location_id) else "",
        "socket": d.name, "rack": rack.name if rack else "",
        "panel": _num(panel.name) if panel else "", "panel_port": port or "",
        "neu_type": "SW" if switch else "", "neu_ref": swref or "",
        "netz": "",
    }


def _row_from_endpoint(d, iface):
    """Row from an interface of END device d (PC/camera/server/…):
    device → [socket] → [panel] → switch."""
    from dcim.models import FrontPort, RearPort, Interface
    far = _far_port(iface)
    if far is None:
        return None
    # Plugged into a SOCKET's FRONT → hop to that socket's rear and reuse its trace
    # (its row already carries the socket's location as Standort).
    if isinstance(far, FrontPort) and _is_socket(far.device):
        rp = _mapped_rear(far)
        row = _row_for(far.device, rp) if rp else None
        if row is None:
            row = {"standort": far.device.location.name if far.device.location_id else "",
                   "location": "", "socket": far.device.name, "rack": "", "panel": "",
                   "panel_port": "", "neu_type": "", "neu_ref": "", "netz": ""}
        return row
    panel = port = switch = swref = None
    if isinstance(far, RearPort):                      # straight into a patch panel's rear
        panel = far.device
        port = _num(far.name)
        fp = _mapped_front(far)
        if fp:
            swp = _far_port(fp)
            if isinstance(swp, Interface):
                switch, swref = swp.device, _sw_ref(swp.device, swp.name)
    elif isinstance(far, Interface):                   # straight into a switch (or another device)
        switch, swref = far.device, _sw_ref(far.device, far.name)
    else:
        return None
    rack = ((panel.rack if (panel and panel.rack_id) else None)
            or (switch.rack if (switch and switch.rack_id) else None) or d.rack)
    return {
        # No connected socket in this chain → Standort Endgerät stays empty
        # (it names WHERE THE SOCKET is, not the end device).
        "standort": "",
        "location": rack.location.name if (rack and rack.location_id) else "",  # Technikraum
        "socket": "", "rack": rack.name if rack else "",
        "panel": _num(panel.name) if panel else "", "panel_port": port or "",
        "neu_type": "SW" if switch else "", "neu_ref": swref or "",
        "netz": "",
    }


def _row_from_panel(panel, fp):
    """Row from a patch panel FRONT port → switch (its REAR → socket if any).
    Fills PF/Port even when nothing hangs off the rear — the switch↔panel links
    that live inside the racks. None if the front port doesn't reach a switch."""
    from dcim.models import Interface, RearPort
    swp = _far_port(fp)
    if not isinstance(swp, Interface):
        return None
    switch, swref = swp.device, _sw_ref(swp.device, swp.name)
    socket = None
    rp = _mapped_rear(fp)
    if rp:
        srear = _far_port(rp)
        if isinstance(srear, RearPort) and _is_socket(srear.device):
            socket = srear.device
    rack = panel.rack if panel.rack_id else (switch.rack if switch.rack_id else None)
    return {
        "standort": socket.location.name if (socket and socket.location_id) else "",
        "location": rack.location.name if (rack and rack.location_id) else "",
        "socket": socket.name if socket else "",
        "rack": rack.name if rack else "",
        "panel": _num(panel.name), "panel_port": _num(fp.name),
        "neu_type": "SW", "neu_ref": swref, "netz": "",
    }


def collect_rows(location_ids=None, rack_ids=None, site_ids=None, device_ids=None):
    """Collect connection rows for the selected scope. One row per END device
    (PC/camera/server/socket/…), traced through the socket and/or panel to the
    switch. Switches/panels/power yield no rows (unless a specific switch/panel
    is picked via device_ids — then a reverse trace)."""
    from django.db.models import Q
    from dcim.models import Device, FrontPort, Interface, RearPort

    q = Q()
    if site_ids:
        q |= Q(site_id__in=list(site_ids))
    if location_ids:
        q |= Q(location_id__in=list(location_ids))
    if rack_ids:
        q |= Q(rack_id__in=list(rack_ids))
    if device_ids:
        q |= Q(pk__in=list(device_ids))
    if not q:
        return []
    devs = (Device.objects.filter(q)
            .select_related("role", "location", "rack", "site").distinct())

    rows, seen = [], set()

    def push(row):
        if not row:
            return
        key = (row["socket"], row["panel"], row["panel_port"], row["neu_ref"])
        if key not in seen:
            seen.add(key)
            rows.append(row)

    # 1) end devices (not sockets, not infrastructure) — from their interfaces.
    #    They go first: their rows are richer (Standort filled) and win the dedup.
    for d in devs:
        if _is_socket(d) or _is_infra(d):
            continue
        for i in Interface.objects.filter(device=d):
            push(_row_from_endpoint(d, i))

    # 2) sockets — from their REAR ports (wall/panel side), even "dangling" ones.
    for d in devs:
        if not _is_socket(d):
            continue
        for s_rp in RearPort.objects.filter(device=d):
            push(_row_for(d, s_rp))

    # 2b) patch panels — FRONT → switch. Covers switch↔panel links that live in
    #     the racks even when no socket hangs off the rear (fills PF/Port/DVS).
    for d in devs:
        if not _is_panel(d):
            continue
        for fp in FrontPort.objects.filter(device=d):
            push(_row_from_panel(d, fp))

    # 3) Picked NON-end devices (panel / switch) — walk the cabling backwards.
    #    Chain is: switch → panel FRONT | panel REAR → socket REAR | socket FRONT → device.
    if device_ids:
        def from_panel_rear(rp):
            """panel rear → socket rear (or an end device wired straight into it)."""
            far = _far_port(rp)
            if isinstance(far, RearPort) and _is_socket(far.device):
                push(_row_for(far.device, far))
            elif isinstance(far, Interface) and not _is_infra(far.device):
                push(_row_from_endpoint(far.device, far))

        for d in devs.filter(pk__in=list(device_ids)):
            if _is_socket(d) or not _is_infra(d):
                continue
            for rp in RearPort.objects.filter(device=d):      # panel: rear → socket/device
                from_panel_rear(rp)
            for i in Interface.objects.filter(device=d):      # switch: iface → panel front → …
                far = _far_port(i)
                if isinstance(far, FrontPort):
                    rp = _mapped_rear(far)
                    if rp:
                        from_panel_rear(rp)
                elif isinstance(far, RearPort) and _is_socket(far.device):
                    push(_row_for(far.device, far))           # switch straight into a socket
                elif isinstance(far, Interface) and not _is_infra(far.device) and not _is_socket(far.device):
                    push(_row_from_endpoint(far.device, far))

    rows.sort(key=lambda r: (r["location"], r["rack"], r["socket"] or r["standort"]))
    return rows


# ── Universal export: one row per device with its rack/slot and links ───────
# A plain device inventory (any scope), not tied to the socket→panel→switch
# template — so a rack device (switch/panel/PDU) shows its rack, a loose end
# device leaves it blank. Export-only; column captions are Ru or En.
def collect_universal(location_ids=None, rack_ids=None, site_ids=None, device_ids=None):
    from django.db.models import Q
    from dcim.models import Device, Interface, FrontPort, RearPort

    q = Q()
    if site_ids:
        q |= Q(site_id__in=list(site_ids))
    if location_ids:
        q |= Q(location_id__in=list(location_ids))
    if rack_ids:
        q |= Q(rack_id__in=list(rack_ids))
    if device_ids:
        q |= Q(pk__in=list(device_ids))
    if not q:
        return []
    devs = (Device.objects.filter(q)
            .select_related("role", "location", "rack", "site", "device_type").distinct())

    rows = []
    for d in devs.order_by("site__name", "location__name", "rack__name", "name"):
        links = []
        ports = (list(Interface.objects.filter(device=d))
                 + list(FrontPort.objects.filter(device=d))
                 + list(RearPort.objects.filter(device=d)))
        for port in ports:
            far = _far_port(port)
            if far is not None and getattr(far, "device", None):
                links.append("%s → %s/%s" % (port.name, far.device.name, far.name))
        rows.append({
            "name": d.name,
            "role": d.role.name if d.role_id else "",
            "model": d.device_type.model if d.device_type_id else "",
            "site": d.site.name if d.site_id else "",
            "location": d.location.name if d.location_id else "",
            "rack": d.rack.name if d.rack_id else "",
            "unit": ("U%d" % int(d.position)) if d.position is not None else "",
            "links": "; ".join(links),
        })
    return rows


def write_workbook(rows, form=None, lang="ru"):
    """rows → .xlsx bytes, laid out by the form's template (re-importable)."""
    from .excel import get_form, write_workbook as _write
    return _write(form or get_form("patchen"), rows, lang=lang)
