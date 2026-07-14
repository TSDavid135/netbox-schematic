<div align="center">

# 🗺️ netbox-schematic

**A visual builder for racks, cable routes, power and IP space in [NetBox](https://netbox.dev).**

Sites, racks, devices, ports and cables on a single interactive 2D schematic —
watch a signal travel from a PC through patch panels to the core switch, and build
your infrastructure with clicks instead of forms and tables.

![version](https://img.shields.io/badge/version-0.69.6-2f81f7)
![NetBox](https://img.shields.io/badge/NetBox-4.6-00d9a6)
![build](https://img.shields.io/badge/build_step-none-2ea043)
![deps](https://img.shields.io/badge/backend_deps-openpyxl-2ea043)
![license](https://img.shields.io/badge/license-MIT-8957e5)

**English** · [Русский](README.ru.md)

</div>

---

The schematic is **never stored** — it is always computed from live NetBox data
(devices, cables, prefixes). No duplicate source of truth, no sync to drift.
The whole frontend is plain DOM + SVG + `fetch`: **no dependencies, no build step.**

> 📸 Screenshots and demo GIFs are coming soon.

## 🧭 Canvases

Switch canvases from the header (native picker on mobile).
*(The plugin UI is currently in Russian; canvas names are given here in English.)*

| Canvas | Status | What it does |
|---|---|---|
| **Infrastructure** | ✅ Ready | Racks, devices, ports, cables, power feeds. |
| **Networks / IPAM** | ✅ Ready | Address space: prefixes bound to places, occupied vs free IPs. |
| **Virtualization** | 🟡 Planned | Clusters, VMs, VM interfaces, a VLAN bus. |
| **Tunnels / VPN** | 🟡 Planned | Tunnels / L2VPN as an overlay over interfaces. |

## ✨ Current version — `0.69.6`

Everything below works today. The project is pre-1.0 and iterating quickly.

**Schematic & tracing**
- Devices as cards, ports as dots (patch-panel **front/rear** shown separately),
  cables as colour-coded non-crossing lines with round or angular (Manhattan) routing.
- **Path tracing** — click an occupied port and the whole signal path lights up
  end-to-end **through patch panels** (NetBox 4.6 `PortMapping` front↔rear aware).
- Layers, family filters, wireless links and provider circuits.

**Build mode** (toggle 👁 / ✏️ in the header)
- Create sites, locations, racks, devices (click a rack unit), cables (click two
  ports), prefixes and IP addresses — all written straight back to NetBox.
- A tree of **site group → site → location → rack** with drag-and-drop: move nodes
  between parents like folders, multi-select same-level items, rename and delete.
  NetBox also has *Regions*, but Region and Site Group are two **independent** grouping
  axes — neither nests inside the other — so putting both in one tree is ambiguous. The
  plugin uses **Site Group** for the organisational hierarchy (it nests: campus →
  office → branch); a site's Region, if set, is just a label, not a tree level.

**Device catalog** (⊞ in the header)
- Browse device types and **preview how each renders as a node** (physical + wireless
  views side by side) before placing it.
- For your own models (manufacturer *Схематика*) edit the **stock ports** — rows of
  kind + type + count — written back as component templates on the type.
- **Apply to all** devices of a type, or **↦ by role**: assign a model to every device of
  a role and **reconcile** its ports — add missing, drop free extras, keep cabled ones.

**📱 Mobile & tablet**
- Sidebar becomes a drawer; details and rack views become bottom-sheets you can
  drag to dismiss; pinch-zoom and one-finger pan on the canvas.
- **Trace explorer** — tap a device to load *just* it, with fading "whiskers" on
  every connected port; tap a port to pull its neighbour in as a **full node** with
  real cables, and keep walking the topology hop by hop.
- **Tree without a mouse**: a **Select** button for same-level multi-select and
  **Move** (tap a destination — "← here?" → "Apply"); a "**+**" button on the canvas
  opens the create catalog.

**Excel import / export** (Patchen/Umpatchen worksheet)
- **Import**: drop an `.xlsx` on the modal → preview ("will create: N sockets,
  panels, switches, cables") → commit. Each row becomes real objects with real
  cabling: wall socket → patch-panel front, mapped rear → switch port — so the
  imported path traces end-to-end. Pick an existing site or create one on the
  fly, and optionally force a single target location. Idempotent: re-importing
  the same file creates nothing new.
- **Export**: a hierarchical tree picker (site groups → sites → locations → racks
  → devices) — check anything at any level, cascade included. A row is produced
  for every **endpoint** (PC, camera, server, wall socket…), tracing through the
  socket and/or patch panel to the switch. Picking a single switch exports
  everything patched to it (reverse trace). Socket rows are round-trip
  compatible: they import back 1:1.

**Fast loading on small servers**
- The whole scope (devices + ports + cables + IPs) is served by **one plugin
  endpoint** with compact serialization instead of ~40 generic REST calls —
  large locations went from minutes to seconds on a 2-worker gunicorn.
- Long id-lists are chunked (no more HTTP 414), pagination survives proxies and
  non-standard ports, cables are fetched once (no double serialization).

**Ready-made devices** — a one-click catalog (PC, switch, router, camera, PDU,
patch panel, wall sockets, controllers…) that provisions a `DeviceType` on demand.
Wall sockets are modelled like mini patch panels (front/rear pairs), so tracing
works through them. See below.

## 🛣️ Roadmap

About **two-thirds of the way to 1.0** — the shipped work is the interactive core;
what remains is mostly the "content" (two more canvases, network entities, platform).

**✅ Shipped · v0.68 — ~2/3 to 1.0**

&nbsp;&nbsp;`▸` Infrastructure canvas &nbsp;·&nbsp; signal tracing through panels &nbsp;·&nbsp; wire routing
&nbsp;&nbsp;`▸` Networks / IPAM &nbsp;·&nbsp; hierarchy tree + move &nbsp;·&nbsp; build mode + device catalog
&nbsp;&nbsp;`▸` Excel **import + export** (Patchen/Umpatchen, round-trip) &nbsp;·&nbsp; one-request scope loading
&nbsp;&nbsp;`▸` Mobile trace explorer + tree ops &nbsp;·&nbsp; theme · docs

**🔜 Toward 1.0**

&nbsp;&nbsp;`▹` Universal field mapping for import/export (match columns by name, not position)
&nbsp;&nbsp;`▹` Network entities: VLAN · IP Range · Aggregate·RIR · FHRP
&nbsp;&nbsp;`▹` Virtualization canvas &nbsp;→&nbsp; Tunnels / VPN canvas
&nbsp;&nbsp;`▹` Device-model picker on create &nbsp;·&nbsp; i18n · contextual hints · permissions &nbsp;·&nbsp; NetBox version range

Priority order:

1. **Wire up network entities** — start with the **VLAN** axis (unblocks
   Virtualization / Tunnels / layers), then IP Range, Aggregate·RIR, Role, FHRP.
2. **Universal import/export field mapping** — match columns by header names
   (with synonyms), not fixed positions.
3. **Device-model picker** — optionally pick a real vendor model on create (e.g. a
   *Canon* printer), on top of the quick ready-made catalog.
4. **Virtualization** canvas, then **Tunnels** (begin as an overlay on Infrastructure).
5. **Platform** — localisation, contextual hints, permission handling (403 → view-only).
6. **NetBox version range** — supported floor is **4.5+** (enforced via `min_version`;
   see [NetBox compatibility](#-netbox-compatibility)). Each new NetBox release is
   re-checked with `tests/check_compat.py` and the tested ceiling bumped; back-compat
   shims for older versions only on concrete demand, not maintained proactively.

## 📦 Installation

Requirements: **NetBox 4.6** (Django 6, Python 3.12) — the version this plugin is
developed and tested against. Needs **4.5 or newer** for full function — see
[NetBox compatibility](#-netbox-compatibility) below.

```bash
# in NetBox's own Python venv (e.g. `source /opt/netbox/venv/bin/activate`):
git clone https://github.com/TSDavid135/netbox-schematic.git
cd netbox-schematic
pip install .             # build + install the plugin into that venv
```

Enable it in `configuration.py`:

```python
PLUGINS = ['netbox_schematic']
```

Collect the plugin's static files, then restart NetBox:

```bash
python manage.py collectstatic --no-input
```

A **Plugins → Схематика** entry appears (`/plugins/schematic/`). **No database
migrations** are needed — the plugin stores nothing of its own (the schema is always
computed from live NetBox data). Authentication is the regular NetBox session; no
tokens or CORS required.

## 🔗 NetBox compatibility

Targets **NetBox 4.6**; needs **4.5 or newer** for full function. The plugin depends
on model changes that landed in specific NetBox releases (dates taken from NetBox's
own migration history — `0071_prefix_scope` @ 4.2, `0222_port_mappings` @ 4.5):

| NetBox model the plugin uses | Landed in | Needed for |
|------------------------------|:---------:|------------|
| `Device.role` (was `device_role`) | 3.6 | — *(auto-detected; works on either name)* |
| `vpn` app (tunnels / L2VPN) | 3.7 | Tunnels / VPN canvas |
| `Prefix.scope` (was a `.site` FK) | 4.2 | Networks / IPAM canvas |
| **`PortMapping`** (front↔rear model) | **4.5** | **Excel import / export + front↔rear tracing** |

What actually works, per NetBox version:

| NetBox | Status | What stops working below it |
|--------|--------|-----------------------------|
| **4.5 – 4.6** | ✅ **Full** | — *(developed & tested on 4.6.4)* |
| 4.2 – 4.4 | ⚠️ Partial | **Excel import/export** (no `PortMapping`) |
| 3.7 – 4.1 | ⚠️ Partial | + **Networks / IPAM** (`Prefix` is a `.site` FK, not `scope`) |
| < 3.7 | ❌ Unsupported | + **Tunnels** canvas (no `vpn` app) |

> **Check your own NetBox:** `tests/check_compat.py` introspects the live models and
> endpoints and prints `OK`/`FAIL` for every assumption above — run it before
> deploying onto an unfamiliar version.

## 🧪 Testing

Developed against a local NetBox 4.6 (Windows + dockerized PostgreSQL/Redis) and
load-tested on a **deliberately weak VPS** — 1 vCPU × 2000 MHz, 1.5 GB RAM, Ubuntu
24.04, bare-metal NetBox with 2 gunicorn workers — to find where a dense location
starts to lag.

**Local load — one location, growing node count.** The whole scope (devices + ports +
cables + IP) is served by a **single** endpoint (`/plugins/schematic/graph/`, compact
and N+1-free), not ~40 generic REST calls — so even a big location opens in seconds on
one core. The platform-independent predictor of smoothness is how many DOM/SVG
elements the canvas draws (nodes + cables + port dots):

| Density (one location) | Nodes | Canvas elements | Result |
|------------------------|:-----:|:---------------:|--------|
| 3 racks  | 30  | ~250   | instant |
| 6 racks  | 78  | ~690   | instant |
| 12 racks | 228 | ~2 100 | brief first-render delay, then smooth |
| 24 racks | 648 | ~6 100 | heavy — pan/zoom lags |

A real location is usually 2–6 racks (instant); 648 devices in *one* location is a
stress extreme to find the ceiling.

**Planned optimization** (post-launch — only bites on very dense locations):
1. **LOD by zoom** — when zoomed out, hide port dots + labels and draw cables straight
   (port dots are ~⅔ of all elements — cheapest, biggest win);
2. **rack clustering** — collapse a rack into one block with a cable-bundle count,
   expand on click;
3. **viewport virtualization** — render only what's on screen.

Also verified: geometry/layout with Node harnesses on the real modules (no-overlap
layout, wire routing, cable-family classification); importer/exporter round-trips
(import → export → re-import gives 1:1); and the checks in [`tests/`](tests/).

## 🧰 Ready-made devices

Beyond adding devices from any existing NetBox device type, the plugin ships a
one-click catalog of **ready-made solutions** — from the palette, the tree's "Add"
menu, or (on mobile) the **+** on the schema. What a solution really sets up is a
sensible **role** (with an icon and default ports); it does **not** lock you to a
model:

- **You still choose the model.** A solution spins up a generic `DeviceType` under a
  manufacturer named `Схематика` ("Schematic") on demand, but you can point the device
  at a **real vendor model** instead (e.g. a *Canon* printer) — from any device-type
  library you've imported — and keep the role.
- **Set the exact port count on create.** When adding a device you can say how many
  network ports it should have, and the plugin generates exactly that many interfaces
  — no need to define a full device-type template first.

The built-in catalog:

- **Consumers** — PC, laptop, printer, IP camera, TV, IP phone, CNC, POS, sensor.
- **Networking** — router, switch, access point, firewall, media converter, patch
  panel, provider (WAN).
- **Power** — PDU, UPS, voltage stabiliser, distribution panel. · **Racks.**

The catalog lives in `static/netbox_schematic/js/solutions.js` and is editable
without touching any logic (labels, icons, roles, colours, default port counts).

## 🔌 Device libraries from other repositories

The plugin renders **any** device already in NetBox — its built-in catalog is just a
convenience. To use real vendor models, import an external device-type library:

- **[netbox-community/devicetype-library](https://github.com/netbox-community/devicetype-library)**
  — a large community collection of `DeviceType` definitions (YAML) for real hardware.
- Import them one at a time via NetBox's device-type import, or in bulk with
  **[netbox-community/Device-Type-Library-Import](https://github.com/netbox-community/Device-Type-Library-Import)**.

Icons are chosen automatically from the device's role / name / model
(`iconForDevice()` in `solutions.js`), so imported devices get sensible icons.

## 🗂️ Repository layout

```text
netbox-schematic/
├── README.md                     — this file (EN)
├── README.ru.md                  — Russian version
├── LICENSE                       — MIT
├── pyproject.toml                — plugin package
└── netbox_schematic/             — NetBox plugin
    ├── __init__.py               — PluginConfig
    ├── navigation.py             — menu entry
    ├── views.py                  — pages + endpoints: graph (fast scope), import, export
    ├── importer.py               — Excel «Patchen/Umpatchen» parser → devices + cables
    ├── exporter.py               — reverse: scope connections → the same Excel form
    ├── urls.py
    ├── templates/netbox_schematic/
    │   └── schematic.html        — thin shell: {% static %} + {% csrf_token %}
    └── static/netbox_schematic/  — client-side logic (JS modules) and styles (CSS)
```

Tech: plain DOM + SVG + `fetch`, no build step; the only backend dependency is
`openpyxl` (Excel import/export). Authentication is the NetBox session + CSRF
(`X-CSRFToken` from a hidden form).

## 🛠️ Development

The plugin installs editable (`pip install -e .`); template edits are picked up by
the dev server immediately. After changing files in `static/`, run
`manage.py collectstatic` (or reload with caching disabled — with `DEBUG=True` the
dev server serves app static files directly). Geometry/layout changes are verified
with small Node harnesses on the real modules.

## 📄 License

MIT — see [LICENSE](LICENSE).
