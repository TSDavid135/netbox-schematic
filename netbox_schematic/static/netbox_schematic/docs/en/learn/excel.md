# Import / Export

Icons in the header: **«Импорт»** (arrow into a box), **«Экспорт»** (arrow out of a box), **«Аудит»** (the reconciliation check mark).

## Import from Excel

A file in the «Патчен/Непатчен» format (the patching log): rows are port↔port connections.

1. «Импорт» → pick a file. The plugin parses the sheets and shows an **interactive mapping**: which columns are devices, which are ports.
2. Matched devices are highlighted; new ones are offered for creation (rack/unit from the file, if it has them).
3. Confirm — devices, ports and cables are created. Nothing that already exists is duplicated.

Conflicts (the port is already taken by another cable) come out as a list of cards — for each one you decide: keep it as in NetBox or as in the file.

## Export to Excel

Export dumps the **current scope** (whatever is selected in the tree) to xlsx. The format is chosen in the dialog:

- **Patchen / Unpatchen** — the patching log: sockets → patch panels → switches.
- **Питание** (power) — power connections on their own sheet (see below).
- **Универсальный список устройств** (universal device list) — the inventory: device, role, model, location and a «Соединения» (links) column, power ones included.

## Power on its own sheet

The «Питание» sheet — one row per power cable: **«Источник»** (source: a power panel + feed, or a device + outlet) → **«Потребитель»** (consumer: a device + «Ввод», its inlet), plus site, location, rack and the feed parameters (V/A).

It is imported like everything else: whatever is missing gets created (power panels, feeds, devices, ports, cables). Re-importing the same file duplicates nothing, and an inlet that is already taken is never silently re-patched — it lands in the conflicts with a note of where it is plugged in right now.

**On import the file format is detected automatically** from the captions — the preview shows it («Формат: Питание» — format: power), but you can pick it by hand if the file is non-standard.

## Scenario: move power over to another site

1. Pick the server room in the tree → «Экспорт» → the **Питание** format → file.
2. Import that file with the new site: panels, feeds, PDUs and inlets are created, and the cables reproduce the original chain.

## Audit

The audit **does not read a file** — it walks the scope selected in the tree and reports what is missing. It changes nothing.

What it finds:

- **Data:** devices with no link at all, sockets with no patch, free ports on panels and switches, dangling cables.
- **Power:** devices **with no supply** (their inlets are not cabled), free outlets on PDUs and UPSes, and **panel feeds that lead nowhere** (the panel is there, nothing hangs off it).

Findings are grouped by site and server room; warnings (red) come before informational ones (grey).

## Scenario: moving in from a spreadsheet

1. «Импорт» — create what is missing.
2. «Каталог» → «По роли» (by role) — tidy the device ports up to match the models.
3. **«Аудит»** — see what is still unconnected, power included.
4. «Экспорт» — a fresh log back into Excel.
