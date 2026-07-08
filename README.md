# netbox-schematic

**English** · [Русский](README.ru.md)

A visual builder for racks and cable paths in [NetBox](https://netbox.dev):
sites, racks, devices, ports and cables on a single interactive 2D schematic.
Watch a signal travel from a server through patch panels to the core switch,
and build your infrastructure with clicks — no forms, no tables.

## Features

- A "region → site → room → rack" tree with drag-and-drop (move nodes between
  parents like folders in an OS) and racks with units.
- 2D schematic: devices as rectangles, ports as dots (front/rear of patch
  panels shown separately), cables as non-crossing lines.
- Path tracing: clicking an occupied port highlights the whole signal path
  end-to-end through patch panels.
- Build mode: create sites, rooms, racks, devices (by clicking a unit), cables
  (by clicking two ports), prefixes and IP addresses.
- Canvas panning, custom tooltips, a demo traffic animation.
- The schematic is never stored — it is always computed from NetBox data.

## Canvases

The plugin has four canvases (switch via the sidebar):

- **Инфраструктура (Infrastructure)** — racks, devices, ports, cables, power. *Ready.*
- **Сети / IPAM (Networks)** — address space: prefixes bound to places
  (region/site/location) via NetBox `scope`, occupied vs free IPs. *Ready.*
- **Виртуализация (Virtualization)** — clusters, VMs, VM interfaces, a VLAN bus. *Planned.*
- **Туннели / VPN (Tunnels)** — tunnels / L2VPN as an overlay over interfaces. *Planned.*

## Installation (plugin)

Requirements: **NetBox 4.6** (Django 6, Python 3.12) — the version this plugin is
developed and tested against. It uses current NetBox REST models (`Prefix.scope`,
the `vpn` app, the `PortMapping` front↔rear model), so older 4.x releases may
differ. Broad version compatibility (detect the NetBox version and adapt, or declare
a supported range) is a planned follow-up.

```bash
pip install -e .          # from the repository root, inside the NetBox venv
```

In `configuration.py`:

```python
PLUGINS = ['netbox_schematic']
```

Restart NetBox — a **Plugins → Схематика** entry appears in the menu
(`/plugins/schematic/`). Authentication is the regular NetBox session;
no tokens or CORS required.

## Ready-made devices

Beyond adding devices from any existing NetBox device type, the plugin ships a
built-in catalog of **ready-made device solutions** — add them with one click from
the palette or the tree's "Add" menu, without choosing a device type. Each solution
creates (on demand) a `DeviceType` under the manufacturer **«Схематика»** with a
role, an icon and a default number of network / power ports:

- **Consumers** — PC, laptop, printer, IP camera, TV, IP phone, CNC machine, POS
  terminal, sensor, generic equipment.
- **Networking** — router, switch, access point, firewall, media converter, patch
  panel, provider (WAN).
- **Power** — PDU, UPS, voltage stabiliser, distribution panel.
- **Racks.**

The catalog lives in `static/netbox_schematic/js/solutions.js` and is editable
without touching any logic (labels, icons, roles, colors, default port counts).

## Demo data

`demo_seed.py` (repository root) seeds NetBox with the full reference catalog plus a
demo topology (a "Кампус → Головной офис" group with two server rooms, a
"Филиалы → Филиал Юг" subgroup, racks, cables, power, off-rack devices and IPAM). It
is idempotent. Run it against your NetBox (not via `manage.py shell`):

```bash
source /opt/netbox/venv/bin/activate
cd /opt/netbox/netbox
python /path/to/demo_seed.py
```

## Device libraries from other repositories

The plugin renders **any** device already in NetBox — its built-in catalog is just a
convenience. To use real vendor models, import an external device-type library:

- **[netbox-community/devicetype-library](https://github.com/netbox-community/devicetype-library)**
  — a large community collection of `DeviceType` definitions (YAML) for real hardware.
- Import them one at a time via NetBox's device-type import (paste YAML/JSON), or in
  bulk with the community importer
  **[netbox-community/Device-Type-Library-Import](https://github.com/netbox-community/Device-Type-Library-Import)**
  (a script that loads the library through the REST API).

Once the device types exist in NetBox, add devices of those types (via NetBox or the
plugin) and they appear on the schematic. Icons are chosen automatically from the
device's role / name / model (`iconForDevice()` in `solutions.js`), so imported
devices get sensible icons out of the box.

## Repository layout

```text
netbox-schematic/
├── README.md                     — this file (EN)
├── README.ru.md                  — Russian version
├── LICENSE                       — MIT license
├── pyproject.toml                — plugin package
├── demo_seed.py                  — idempotent demo-data seeder
└── netbox_schematic/             — NetBox plugin
    ├── __init__.py               — PluginConfig
    ├── navigation.py             — menu entry
    ├── views.py                  — view (LoginRequired)
    ├── urls.py
    ├── templates/netbox_schematic/
    │   └── schematic.html        — thin shell: {% static %} + {% csrf_token %}
    └── static/netbox_schematic/  — client-side logic (JS modules) and styles (CSS)
```

Tech: plain DOM + SVG + `fetch`, no dependencies and no build step.
Authentication is the NetBox session + CSRF (`X-CSRFToken` from a hidden form).

## Development

The plugin installs editable (`pip install -e .`); template edits are picked up
by the dev server immediately. After changing files in `static/`, run
`manage.py collectstatic` (or reload with caching disabled — with `DEBUG=True`
the dev server serves app static files directly).
