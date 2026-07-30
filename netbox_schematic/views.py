from importlib.metadata import PackageNotFoundError, version as _pkg_version

from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.http import JsonResponse
from django.views import View
from django.views.generic import TemplateView

try:
    PLUGIN_VERSION = _pkg_version("netbox-schematic")   # actual version of the installed wheel
except PackageNotFoundError:
    PLUGIN_VERSION = ""

# Schematic canvases. The key comes from the URL (see urls.py) and reaches the
# frontend via data-canvas on <body>; JS decides what to draw. Only "infra" is
# implemented so far — the rest show an "under development" stub.
CANVASES = {
    'infra': 'Инфраструктура',
    'network': 'Сети',
    'virtualization': 'Виртуализация',
    'vpn': 'Туннели',
}


class SchematicView(LoginRequiredMixin, TemplateView):
    """
    Full-screen schematic page. Runs under the NetBox session: template JS
    calls /api/ on the same host, no tokens needed.

    One view serves all canvases; the specific canvas is set via the
    ``canvas`` attribute (see urls.py) and passed to the template.
    """
    template_name = 'netbox_schematic/schematic.html'
    canvas = 'infra'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['canvas'] = self.canvas
        context['canvas_title'] = CANVASES.get(self.canvas, '')
        # Header user block (as in stock NetBox): show the logged-in user's
        # name with links to their profile/logout.
        user = self.request.user
        context['user_name'] = user.get_full_name() or user.get_username()
        context['user_login'] = user.get_username()
        context['plugin_version'] = PLUGIN_VERSION
        return context


def _otype(ct_id):
    """content_type_id → "dcim.interface"-style string (object_type in NetBox REST)."""
    ct = ContentType.objects.get_for_id(ct_id)   # cached by Django, no per-loop queries
    return "%s.%s" % (ct.app_label, ct.model)


class SchematicGraphView(LoginRequiredMixin, View):
    """
    The ENTIRE graph of the selected scope in ONE response — instead of ~50
    generic NetBox REST requests (minutes of loading on a weak 2-worker server).

    A few optimized queries (no N+1: direct FK ids, denormalized _device on
    terminations, ContentType cache) + compact manual serialization of ONLY the
    fields the frontend needs. Field shapes stay NetBox-REST-compatible
    (type={value,label}, cable={id}, terminations {object_type, object_id,
    object:{device:{id,name}}}) so the renderer needs no changes.

    GET /plugins/schematic/graph/?rack_id=1&rack_id=2&site_id=3[&scope=rack]
      rack_id — scope racks; site_id — sites (for off-rack devices);
      scope=rack — single rack, off-rack devices are not fetched.
    """

    def get(self, request):
        from dcim.models import (
            Device, Interface, FrontPort, RearPort, ConsolePort,
            ConsoleServerPort, PowerPort, PowerOutlet, Cable, CableTermination,
        )
        from ipam.models import IPAddress

        rack_ids = [int(x) for x in request.GET.getlist("rack_id") if x.isdigit()]
        site_ids = [int(x) for x in request.GET.getlist("site_id") if x.isdigit()]
        skip_off = request.GET.get("scope") == "rack"

        # ── devices: in scope racks + (optionally) the sites' off-rack devices ──
        q = Q(rack_id__in=rack_ids) if rack_ids else Q(pk__in=[])
        if site_ids and not skip_off:
            q |= Q(site_id__in=site_ids, rack__isnull=True)
        devices = list(
            Device.objects.filter(q).select_related(
                "device_type", "role", "rack", "site", "location", "virtual_chassis")
        )
        dev_ids = [d.id for d in devices]
        dev_name = {d.id: d.name for d in devices}

        def dev_json(d):
            return {
                "id": d.id, "name": d.name,
                # position is Decimal (may be half a unit); cast to float, otherwise
                # DjangoJSONEncoder emits a string and frontend sorting/"U…" breaks.
                "position": float(d.position) if d.position is not None else None,
                "face": d.face or None,
                "rack": {"id": d.rack_id, "name": d.rack.name} if d.rack_id else None,
                # location is CRITICAL for contours: off-rack devices are grouped into
                # their room's contour by dev.location.id (schema.js/schema_contours.js).
                "location": {"id": d.location_id, "name": d.location.name} if d.location_id else None,
                "role": ({"id": d.role_id, "name": d.role.name, "slug": d.role.slug,
                          "color": d.role.color} if d.role_id else None),
                "device_type": {"id": d.device_type_id, "model": d.device_type.model},
                "site": {"id": d.site_id, "name": d.site.name} if d.site_id else None,
                # Stack (VirtualChassis): the node badge + suffix separation need
                # the stack id/name/master and this member's position. master is a
                # device id (the VC's master FK) so the frontend can mark ★.
                "virtual_chassis": ({"id": d.virtual_chassis_id, "name": d.virtual_chassis.name,
                                     "master": d.virtual_chassis.master_id}
                                    if d.virtual_chassis_id else None),
                "vc_position": d.vc_position,
            }

        # ── ports by kind (direct fields — no N+1; device name from dev_name) ──
        PORTS = [
            ("interface", Interface, "dcim.interface"),
            ("frontport", FrontPort, "dcim.frontport"),
            ("rearport", RearPort, "dcim.rearport"),
            ("consoleport", ConsolePort, "dcim.consoleport"),
            ("consoleserverport", ConsoleServerPort, "dcim.consoleserverport"),
            ("powerport", PowerPort, "dcim.powerport"),
            ("poweroutlet", PowerOutlet, "dcim.poweroutlet"),
        ]
        ports = {}
        port_index = {}   # (otype, id) → {id, name, device} — for embedding into cable terminations

        def vlan_json(v):
            # Compact VLAN stub: layers.js (panel + port badge), the VLAN form and
            # ipform's "prefixes of this port's VLAN" branch need only id/vid/name.
            return {"id": v.id, "vid": v.vid, "name": v.name} if v else None

        for key, Model, otype in PORTS:
            # Every port kind has a `type` field (interface speed, console/power
            # connector) — expose it so the tooltip can show the port type.
            has_type = True
            qs = Model.objects.filter(device_id__in=dev_ids)
            if key == "interface":
                # VLAN fields are read per interface — without these two the graph
                # would fire 3 extra queries PER PORT (untagged, svlan, tagged).
                qs = qs.select_related("untagged_vlan", "qinq_svlan") \
                       .prefetch_related("tagged_vlans")
            arr = []
            for p in qs:
                dev = {"id": p.device_id, "name": dev_name.get(p.device_id)}
                o = {
                    "id": p.id, "name": p.name, "device": dev,
                    "cable": {"id": p.cable_id} if p.cable_id else None,
                }
                if has_type:
                    o["type"] = ({"value": p.type, "label": p.get_type_display()}
                                 if p.type else None)
                if key == "interface":
                    o["wireless_link"] = {"id": p.wireless_link_id} if p.wireless_link_id else None
                    # L2 membership. Shapes match the NetBox REST serializer, so the
                    # frontend treats a graph port and a REST interface the same way.
                    o["mode"] = ({"value": p.mode, "label": p.get_mode_display()}
                                 if p.mode else None)
                    o["untagged_vlan"] = vlan_json(p.untagged_vlan)
                    o["tagged_vlans"] = [vlan_json(v) for v in p.tagged_vlans.all()]
                    o["qinq_svlan"] = vlan_json(p.qinq_svlan)
                arr.append(o)
                port_index[(otype, p.id)] = {"id": p.id, "name": p.name, "device": dev}
            ports[key] = arr

        # ── cables touching scope devices (via denormalized _device) ──
        cable_ids = list(set(
            CableTermination.objects.filter(_device_id__in=dev_ids).values_list("cable_id", flat=True)
        ))
        cables = []
        for c in Cable.objects.filter(id__in=cable_ids).prefetch_related("terminations"):
            a, b = [], []
            for t in c.terminations.all():
                ot = _otype(t.termination_type_id)
                obj = port_index.get((ot, t.termination_id))
                if obj is None:   # far end outside scope — device id suffices (for the "hair" stub)
                    obj = {"device": {"id": t._device_id}} if t._device_id else None
                td = {"object_type": ot, "object_id": t.termination_id, "object": obj}
                (a if t.cable_end == "A" else b).append(td)
            cables.append({
                "id": c.id, "label": c.label or "", "type": c.type, "status": c.status,
                "color": c.color, "a_terminations": a, "b_terminations": b,
            })

        # ── IPs on scope interfaces ──
        iface_ct = ContentType.objects.get_for_model(Interface)
        iface_ids = [p["id"] for p in ports["interface"]]
        ips = [
            {"id": ip.id, "address": str(ip.address),
             "assigned_object_type": "dcim.interface", "assigned_object_id": ip.assigned_object_id}
            for ip in IPAddress.objects.filter(
                assigned_object_type=iface_ct, assigned_object_id__in=iface_ids)
        ]

        return JsonResponse({
            "devices": [dev_json(d) for d in devices],
            "ports": ports,
            "cables": cables,
            "ips": ips,
        })


class SchematicFormsView(LoginRequiredMixin, View):
    """Excel forms available for import/export (bundled + registered by other
    plugins). GET /plugins/schematic/forms/"""

    def get(self, request):
        from .excel import all_forms
        return JsonResponse({"forms": [
            {"id": f.id, "label": f.label,
             "columns": [{"key": c.key, "label": c.label, "sub": c.sub} for c in f.columns]}
            for f in all_forms().values()
        ]})


class SchematicImportView(LoginRequiredMixin, View):
    """
    Excel import → devices + cables. Two POST actions:
      action=preview — parse the file, return summary and plan (NO DB writes);
      action=commit  — create per plan in the chosen site (inside a transaction).
    `form` picks the sheet layout (default: the Patchen/Unpatchen one); its
    columns are matched by name, so users may rename or reorder them.
    File is multipart `file`; CSRF via the X-CSRFToken header (sent by the frontend).
    """

    def post(self, request):
        from django.db import transaction
        from dcim.models import Site
        from . import importer
        from .excel import get_form, detect_form

        f = request.FILES.get("file")
        if not f:
            return JsonResponse({"error": "файл не получен"}, status=400)
        picked = (request.POST.get("form") or "").strip()
        try:
            # Empty → sniff the layout from the header (Патчен / Питание / …), so
            # a power sheet imports without the user picking a format by hand.
            form = get_form(picked) if picked else detect_form(f)
        except KeyError as e:
            return JsonResponse({"error": str(e)}, status=400)
        if not type(form).importable():
            # Export-only layout (no build_plan) — say so instead of blowing up
            # with NotImplementedError deeper in.
            return JsonResponse({"error": "форма «%s» только для экспорта — импортировать её нельзя"
                                          % (form.label or form.id)}, status=400)
        try:
            f.seek(0)
        except Exception:
            pass
        sw_mode = request.POST.get("sw_mode", "neu_else_alt")
        try:
            rows, meta = importer.parse_workbook(f, form)
        except Exception as e:
            return JsonResponse({"error": "не удалось разобрать файл: %s" % e}, status=400)
        if not rows:
            return JsonResponse({"error": "в файле не найдено строк данных — проверь заголовки колонок"}, status=400)
        plan, summary = form.build_plan(rows, sw_mode=sw_mode)

        if request.POST.get("action") == "commit":
            from django.utils.text import slugify as _slug
            site_new = (request.POST.get("site_new") or "").strip()
            if site_new:   # create a new site by name
                site, _c = Site.objects.get_or_create(
                    name=site_new, defaults={"slug": (_slug(site_new) or "site")[:100], "status": "active"})
            else:
                site = Site.objects.filter(id=request.POST.get("site_id") or 0).first()
            if not site:
                return JsonResponse({"error": "не выбрана/не создана площадка"}, status=400)
            forced_loc = (request.POST.get("loc_name") or "").strip() or None
            import json as _json
            def _parse(name):
                try:
                    return _json.loads(request.POST.get(name) or "{}")
                except Exception:
                    return {}
            placements = _parse("placements")   # {device_name: unit}
            rack_sizes = _parse("rack_sizes")    # {rack_name: u_height}
            overrides = _parse("overrides")      # {device_name: {model, role}}
            conflict_modes = _parse("conflict_modes")   # {device_name: "keep"|"update"}
            try:
                with transaction.atomic():
                    created = form.apply_plan(plan, site, forced_loc=forced_loc,
                                              placements=placements, rack_sizes=rack_sizes,
                                              overrides=overrides, conflict_modes=conflict_modes)
            except Exception as e:
                return JsonResponse({"error": "ошибка создания: %s" % e}, status=400)
            return JsonResponse({"ok": True, "created": created, "summary": summary})

        # preview (default) — the rack layout for the editor, the inconsistencies to
        # show, and — when a site is already picked — what the plan collides with
        # there: existing devices (old→new) so the dialog can offer keep / overwrite,
        # plus rack occupancy so new gear lands in FREE units (no duplicate-slot crash).
        site_new = (request.POST.get("site_new") or "").strip()
        prev_site = (Site.objects.filter(name=site_new).first() if site_new
                     else Site.objects.filter(id=request.POST.get("site_id") or 0).first())
        conflicts = form.conflicts(plan, prev_site)
        return JsonResponse({"ok": True, "summary": summary, "total": len(plan),
                             "plan": plan[:60], "meta": meta, "placement": form.placement(plan),
                             "warnings": form.warnings(plan),   # per-form checks (patch ≠ power)
                             "conflicts": conflicts.get("devices", []),
                             "occupancy": conflicts.get("occupancy", {}),
                             "conflict_cols": conflicts.get("columns", [])})


class SchematicExportView(LoginRequiredMixin, View):
    """
    Export of the selected scope to an Excel form (inverse of import): trace
    socket→panel→switch and write rows. POST (JSON): site_ids / location_ids /
    rack_ids / device_ids, plus `form` to choose the layout. Returns a ready
    .xlsx file. CSRF via X-CSRFToken.
    """

    def post(self, request):
        import json as _json
        from django.http import HttpResponse
        from .excel import get_form, write_workbook

        try:
            body = _json.loads((request.body or b"{}").decode("utf-8"))
        except Exception:
            body = {}

        def ids(k):
            v = body.get(k) or request.POST.getlist(k)
            return [int(x) for x in v if str(x).isdigit()]

        try:
            form = get_form(body.get("form") or request.POST.get("form") or "patchen")
        except KeyError as e:
            return JsonResponse({"error": str(e)}, status=400)

        rows = form.collect(location_ids=ids("location_ids"),
                            rack_ids=ids("rack_ids"), site_ids=ids("site_ids"),
                            device_ids=ids("device_ids"))
        lang = "en" if (body.get("lang") or request.POST.get("lang")) == "en" else "ru"
        data = write_workbook(form, rows, lang=lang)
        resp = HttpResponse(
            data, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        resp["Content-Disposition"] = 'attachment; filename="schematic-%s.xlsx"' % form.id
        resp["X-Row-Count"] = str(len(rows))
        return resp


class SchematicAuditView(LoginRequiredMixin, View):
    """Audit a scope (a Campus / site group) — reports gaps: isolated devices,
    unpatched sockets, free ports, orphan cables. → /plugins/schematic/audit/"""

    def post(self, request):
        import json as _json
        from . import audit

        try:
            body = _json.loads((request.body or b"{}").decode("utf-8"))
        except Exception:
            body = {}

        def ids(k):
            v = body.get(k) or request.POST.getlist(k)
            return [int(x) for x in v if str(x).isdigit()]

        report = audit.collect_audit(
            site_group_ids=ids("site_group_ids"), site_ids=ids("site_ids"),
            location_ids=ids("location_ids"), rack_ids=ids("rack_ids"),
            device_ids=ids("device_ids"))
        return JsonResponse(report)
