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

## Installation (plugin)

Requirements: NetBox 4.x.

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

## Repository layout

```text
netbox-schematic/
├── README.md                     — this file (EN)
├── README.ru.md                  — Russian version
├── LICENSE                       — MIT license
├── pyproject.toml                — plugin package
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
