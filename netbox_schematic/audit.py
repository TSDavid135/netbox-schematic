# -*- coding: utf-8 -*-
"""
audit.py — "what's missing and where" over a scope (typically a Campus = site
group). Walks the devices and reports gaps: end devices with no link, sockets
that aren't patched, patch panels / switches with free ports, orphan cables —
and the POWER side: gear with no supply, free outlets, unused panel feeds.
Read-only; returns a JSON-serialisable report grouped by site → location.
"""

_INFRA = ("коммутатор", "switch", "роутер", "router", "межсетев", "firewall",
          "патч", "пач", "panel", "pdu", "ибп", "ups", "стабилизатор", "щит", "медиаконв")


def _role(dev):
    return (dev.role.name if dev.role_id else "").lower()


def _is_socket(dev):
    r = _role(dev)
    return ("розет" in r) or ("socket" in r) or ("dose" in r)


def _is_infra(dev):
    r = _role(dev)
    return any(k in r for k in _INFRA)


def _expand_groups(ids):
    """A site group + all its descendant groups (the Campus subtree)."""
    from dcim.models import SiteGroup
    out = set(ids)
    frontier = set(ids)
    while frontier:
        kids = set(SiteGroup.objects.filter(parent_id__in=frontier).values_list("id", flat=True))
        frontier = kids - out
        out |= kids
    return out


def collect_audit(site_group_ids=None, site_ids=None, location_ids=None,
                  rack_ids=None, device_ids=None):
    from django.db.models import Q
    from dcim.models import (Device, Interface, FrontPort, RearPort,
                             PowerPort, PowerOutlet, PowerPanel, PowerFeed,
                             Cable, CableTermination)

    q = Q()
    if site_group_ids:
        q |= Q(site__group_id__in=_expand_groups(list(site_group_ids)))
    if site_ids:
        q |= Q(site_id__in=list(site_ids))
    if location_ids:
        q |= Q(location_id__in=list(location_ids))
    if rack_ids:
        q |= Q(rack_id__in=list(rack_ids))
    if device_ids:
        q |= Q(pk__in=list(device_ids))
    if not q:
        return {"summary": {"devices": 0, "warnings": 0, "infos": 0}, "sites": []}

    devs = (Device.objects.filter(q)
            .select_related("role", "site", "location").distinct()
            .order_by("site__name", "location__name", "name"))

    # site → location → [findings]
    tree = {}
    warns = infos = 0

    def add_at(site, loc, name, severity, kind, msg):
        """Finding for anything placeable — devices AND power panels (a panel is
        not a Device, but lives in the same site/location tree)."""
        nonlocal warns, infos
        tree.setdefault(site or "—", {}).setdefault(loc or "—", []).append(
            {"severity": severity, "kind": kind, "device": name, "msg": msg})
        if severity == "warn":
            warns += 1
        else:
            infos += 1

    def add(dev, severity, kind, msg):
        add_at(dev.site.name if dev.site_id else "—",
               dev.location.name if dev.location_id else "—",
               dev.name, severity, kind, msg)

    dev_ids = []
    for d in devs:
        dev_ids.append(d.id)
        ifaces = list(Interface.objects.filter(device=d))
        fronts = list(FrontPort.objects.filter(device=d))
        rears = list(RearPort.objects.filter(device=d))
        all_ports = ifaces + fronts + rears
        cabled = sum(1 for p in all_ports if p.cable_id)
        total = len(all_ports)

        if _is_socket(d):
            if not any(p.cable_id for p in rears):
                add(d, "warn", "socket_unpatched", "розетка не подключена (нет патча)")
        elif _is_infra(d):
            free = total - cabled
            if total and free:
                add(d, "info", "free_ports", "%d свободных портов из %d" % (free, total))
        else:                                   # end device (PC / camera / server / …)
            if cabled == 0 and total:
                add(d, "warn", "isolated", "нет ни одной связи")

        # ── power side ────────────────────────────────────────────────────
        # An inlet (power port) TAKES power, an outlet GIVES it. A device with
        # inlets and none of them cabled simply isn't powered — the single most
        # useful power finding; free outlets are spare capacity (info).
        inlets = list(PowerPort.objects.filter(device=d))
        outlets = list(PowerOutlet.objects.filter(device=d))
        if inlets and not any(p.cable_id for p in inlets):
            add(d, "warn", "unpowered",
                "нет питания — %d %s не подключён%s" % (
                    len(inlets), "ввод" if len(inlets) == 1 else "вводов",
                    "" if len(inlets) == 1 else "ы"))
        if outlets:
            free_out = sum(1 for p in outlets if not p.cable_id)
            if free_out:
                add(d, "info", "free_outlets",
                    "%d свободных розеток из %d" % (free_out, len(outlets)))

    # ── power panels: a feed nobody uses is a planned circuit left hanging ──
    # Panels aren't Devices, so they need their own scope query (same filters).
    pq = Q()
    if site_group_ids:
        pq |= Q(site__group_id__in=_expand_groups(list(site_group_ids)))
    if site_ids:
        pq |= Q(site_id__in=list(site_ids))
    if location_ids:
        pq |= Q(location_id__in=list(location_ids))
    if pq:
        panels = (PowerPanel.objects.filter(pq)
                  .select_related("site", "location").distinct())
        for panel in panels:
            feeds = list(PowerFeed.objects.filter(power_panel=panel))
            site = panel.site.name if panel.site_id else "—"
            loc = panel.location.name if panel.location_id else "—"
            if not feeds:
                add_at(site, loc, panel.name, "info", "panel_empty", "у щита нет фидеров")
                continue
            free = [f.name for f in feeds if not f.cable_id]
            if free:
                shown = ", ".join(free[:3]) + ("…" if len(free) > 3 else "")
                add_at(site, loc, panel.name, "warn", "feed_unused",
                       "%d из %d фидеров никуда не идут: %s" % (len(free), len(feeds), shown))

    # orphan cables: a cable in scope with a termination that points to nothing.
    orphans = 0
    scope_cables = (Cable.objects.filter(terminations___device_id__in=dev_ids).distinct()
                    if dev_ids else Cable.objects.none())
    for cab in scope_cables:
        terms = list(CableTermination.objects.filter(cable=cab))
        if not terms or any(t.termination is None for t in terms):
            orphans += 1

    sites = []
    for site in sorted(tree):
        locs = []
        for loc in sorted(tree[site]):
            fs = tree[site][loc]
            fs.sort(key=lambda f: (0 if f["severity"] == "warn" else 1, f["device"]))
            locs.append({"location": loc, "findings": fs})
        sites.append({"site": site, "locations": locs})

    return {
        "summary": {"devices": len(dev_ids), "warnings": warns, "infos": infos, "orphan_cables": orphans},
        "sites": sites,
    }
