# -*- coding: utf-8 -*-
"""netbox-schematic — проверка совместимости с текущим NetBox (запуск на сервере):
  /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py shell -c "exec(open('/tmp/check_compat.py').read())"
Только интроспекция + резолв URL — БЕЗ записи в БД. Печатает OK/FAIL по каждому
допущению плагина из check.md (поля моделей — «настоящие ломатели» — и эндпоинты)."""
from django.conf import settings
from django.urls import resolve, Resolver404
from django.db.models import PROTECT

PASS, FAIL, WARN = [], [], []
def ok(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (("  — " + detail) if detail else ""))
def warn(name, detail=""):
    WARN.append(name); print("  [WARN] " + name + (("  — " + detail) if detail else ""))

# ── версии ───────────────────────────────────────────────────────────────────
nb = getattr(settings, "VERSION", None) or getattr(settings, "RELEASE", "?")
try:
    from importlib.metadata import version
    pl = version("netbox-schematic")
except Exception:
    try:
        from netbox_schematic import config as _c; pl = _c.version
    except Exception:
        pl = "?"
print("=== Совместимость netbox-schematic ===")
print("NetBox:", nb, "| плагин netbox-schematic:", pl, "| таргет плагина: 4.6")
print()

from dcim.models import (Device, FrontPort, RearPort, PortMapping, Cable,
                         VirtualChassis, Interface)
from ipam.models import Prefix, IPAddress
def has(model, name):
    return any(f.name == name for f in model._meta.get_fields())

# ── §3/§4 поля моделей (главные риски) ─────────────────────────────────────────
print("— поля моделей (ORM: импорт/экспорт/каскады) —")
ok("Device.role field (ROLE_FIELD)", has(Device, "role") or has(Device, "device_role"),
   "role=%s / device_role=%s" % (has(Device, "role"), has(Device, "device_role")))
pm = {f.name for f in PortMapping._meta.get_fields()}
ok("PortMapping + поля front/rear+position",
   {"front_port", "front_port_position", "rear_port", "rear_port_position"} <= pm)
ok("FrontPort БЕЗ прямого rear_port FK (маппинг через PortMapping)", not has(FrontPort, "rear_port"))
ok("Cable: a_terminations (запись) + terminations (GenericRelation)",
   hasattr(Cable, "a_terminations") and has(Cable, "terminations"))
ok("Prefix.scope (generic), а не старый .site FK", has(Prefix, "scope") or has(Prefix, "scope_id"))
if has(Prefix, "site"):
    warn("у Prefix ещё есть .site FK", "плагин ходит через scope_type/scope_id — ок, но перепроверь ipform.js")
try:
    od = VirtualChassis._meta.get_field("master").remote_field.on_delete
    ok("VirtualChassis.master on_delete=PROTECT", od is PROTECT,
       "on_delete=%s" % getattr(od, "__name__", od))
except Exception as e:
    ok("VirtualChassis.master on_delete=PROTECT", False, str(e))
ok("IPAddress.assigned_object_type/id",
   has(IPAddress, "assigned_object_type") and has(IPAddress, "assigned_object_id"))
try:
    from wireless.models import WirelessLink
    ok("WirelessLink.interface_a/b", has(WirelessLink, "interface_a") and has(WirelessLink, "interface_b"))
except Exception as e:
    ok("wireless.models.WirelessLink импортируется", False, str(e))

# ── §1 собственные эндпоинты плагина резолвятся ────────────────────────────────
print("\n— эндпоинты плагина —")
for p in ["/plugins/schematic/", "/plugins/schematic/graph/", "/plugins/schematic/import/",
          "/plugins/schematic/export/", "/plugins/schematic/forms/", "/plugins/schematic/audit/"]:
    try:
        m = resolve(p); ok("резолв %s" % p, True, getattr(m.func, "__name__", str(m.func)))
    except Resolver404:
        ok("резолв %s" % p, False, "Resolver404")

# ── §2 REST-эндпоинты NetBox, что дёргает браузер ──────────────────────────────
print("\n— REST-эндпоинты NetBox (роутинг) —")
for p in ["/api/dcim/devices/", "/api/dcim/cables/", "/api/dcim/interfaces/",
          "/api/dcim/front-ports/", "/api/dcim/rear-ports/", "/api/dcim/virtual-chassis/",
          "/api/dcim/power-feeds/", "/api/ipam/prefixes/", "/api/ipam/ip-addresses/",
          "/api/wireless/wireless-links/", "/api/circuits/circuits/"]:
    try:
        resolve(p); ok("резолв %s" % p, True)
    except Resolver404:
        ok("резолв %s" % p, False, "нет такого эндпоинта")

print("\n=== ИТОГ: %d OK · %d FAIL · %d WARN ===" % (len(PASS), len(FAIL), len(WARN)))
if FAIL:
    print("ЛОМАЕТ: " + ", ".join(FAIL))
elif nb and not str(nb).startswith("4.6"):
    print("Всё сходится, но NetBox не 4.6 (%s) — прогони ещё смоук-тест из check.md §5." % nb)
else:
    print("Все допущения плагина выполняются на этом NetBox.")
