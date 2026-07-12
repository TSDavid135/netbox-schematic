# -*- coding: utf-8 -*-
"""
audit.py — "what's missing and where" over a scope (typically a Campus = site
group). Walks the devices and reports gaps: end devices with no link, sockets
that aren't patched, patch panels / switches with free ports, and orphan cables.
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

    def add(dev, severity, kind, msg):
        nonlocal warns, infos
        site = dev.site.name if dev.site_id else "—"
        loc = dev.location.name if dev.location_id else "—"
        tree.setdefault(site, {}).setdefault(loc, []).append(
            {"severity": severity, "kind": kind, "device": dev.name, "msg": msg})
        if severity == "warn":
            warns += 1
        else:
            infos += 1

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
            if cabled == 0:
                add(d, "warn", "isolated", "нет ни одной связи")

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
