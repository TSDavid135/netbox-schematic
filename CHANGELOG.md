# Changelog

Running record of changes. Newest first. Deploy = bump `pyproject.toml` +
`gen_deploy.py`, `pip wheel . --no-deps -w dist`, regenerate `deploy_paste.sh`
(SHA256 round-trip must MATCH), paste into the server SSH session.

Verified locally each version: `py_compile`, `node --check`, CSS brace balance,
and the DB regression scripts in the scratchpad (`test_stack` round-trip,
`test_del_stack`, `test_cascade`, `test_place`, `test_modelports`, etc.) using
the real-rollback harness `_tx` (NOT `savepoint()`, which is a no-op outside an
atomic block and silently commits — see the netbox-test-harness memory).

## 0.68.46
- **Export now fills the REAL template** — it no longer builds a simplified sheet
  (title row 1, single German header row 3) that didn't match what people import.
  A form may ship an `.xlsx` template (`forms/templates/patchen.xlsx`, the actual
  Datenanschlüsse sheet: merged title `A1:Q3`, the Ru/Ru/DE header rows 4–7 with the
  merged «Anschluß alt/neu» groups, styling); export loads it and writes only the
  data rows, mapping columns with the SAME header detection as import. So export ==
  the imported sheet, 1:1, and stays re-importable. Forms without a template still
  use the generated sheet (`_build_workbook`).
- **NetBox compatibility documented + enforced** — README (EN+RU) now carries a version
  table and a per-version support matrix, and `PluginConfig.min_version = '4.5.0'` makes
  NetBox refuse to load on older releases (clean message instead of a runtime crash).
  The floor is **4.5** (`PortMapping`, added by migration `0222_port_mappings`) for Excel
  import/export; `Prefix.scope` (4.2) gates the IPAM canvas; `vpn` (3.7) the Tunnels
  canvas; `Device.role` is auto-detected. Runnable checks now live in `tests/`
  (`check_compat.py` introspects a live NetBox; `test_release.py` is the rolled-back smoke
  test).
- **License → MIT** (was Apache-2.0) — matches the common NetBox-plugin convention;
  `LICENSE`, `pyproject.toml` and both READMEs updated.

## 0.68.45
- **Import conflict resolution + no more duplicate-slot crash.** Re-importing into a
  site that already has some of the gear used to abort with
  `duplicate key … dcim_device_unique_rack_position_face`. Now:
  - Preview is site-aware (`import_conflicts`): it matches existing gear **by name**
    and returns each rack's current occupancy. Picking a different site re-scans.
  - A collapsed red **«Конфликты (N)»** bar sits under «Будет создано»; **«Посмотреть»**
    opens a full-width table below the three columns. Per device it shows «сейчас»
    rows (its live cabling, traced by reusing the exporter) and «из файла» rows — both
    in the file's own Excel columns — with a **per-device** choice: **Без замены**
    (default; leave it) or **Заменить** (overwrite role/model from «Настроить»). Sent
    as `conflict_modes` {name: keep|update}. The old per-row plan table (`imp-tbl`) is
    dropped — that layout is already in the tree beside the panel.
  - Only the runs that actually **CHANGE** are listed — the two sides are JOINed on
    the **wall socket** (the stable end of a run: socket → panel → switch; either the
    panel port or the switch port may be re-patched, the socket stays), and the
    changed cells are **outlined**. Runs the file merely ADDS or leaves IDENTICAL are
    not conflicts — they're a count in a footnote («файл также: N новых · M без
    изменений»), not rows. A device with no changed run doesn't appear at all. So the
    keep/replace buttons always sit next to the real conflict.
  - **Cable conflicts** (a port the file targets is already cabled elsewhere — e.g.
    a socket moved to a different patch panel): «Заменить» for that device now drops
    the stale cable so the file's wiring wins (`free_port`); «Без замены» keeps the
    current cable (previously the new one was silently skipped as "occupied"). Only a
    device explicitly set to «Заменить» is ever unwired.
  - The rack editor shows existing gear (greyed, locked) and auto-places the new
    devices into the FREE units, so it never overlaps them.
  - `place()` honours the editor's slot only when it's actually free, else falls back
    to the highest free unit — the unique-constraint crash can't happen anymore.
- **Release polish**: package `description` → English, PluginConfig `version` now
  derives from the installed package (was a stale hardcoded `0.1.0`), README version
  badges synced.

## 0.68.44
- **Delete accounts for wireless links** — a device with a radio link 409'd
  («N dependent objects»), because a `WirelessLink` PROTECTs its interfaces. Tree
  cascade now drops each device's wireless links (`delDeviceWireless`) BEFORE the
  devices, alongside the existing cable pass.
- **Remove a radio link from the schema** — wireless connections had no removal
  «дропбар». Now clicking a radio wire (or an already-linked radio port) in build
  mode opens the same link menu as a cable: «Удалить связь» drops the
  `WirelessLink`, «перевесить» re-pends the far radio port. `_refreshRadio` updates
  `state.wirelessLinks` + frees the two ports + redraws (no full reload).
- **Group / region delete says what it does** — deleting a site-group or region
  only detaches its sites (they stay, group-less); the modal now spells this out
  and points to per-location delete for removing content.

## 0.68.43
- **Import preview shows inconsistencies** (`importer.plan_warnings` → preview
  response → `.imp-warns` block above the table): socket without a panel, switch /
  panel without a port number, the same switch port on two rows, one socket wired
  to two different patch ports. Non-blocking — the import still runs.

## 0.68.42
- **Restored the schema mode toggle on desktop** — it went missing (removed in
  0.68.35; the topbar mode button is mobile-only). Back to the LEFT of the
  «Физический / Беспроводной» switch (`schem-topbtn`); hidden on mobile.
- **Batch ops report failures**: «Перенести» / «Удалить» in the «Сети» select mode
  count and surface failed items (+ `console.warn`) instead of swallowing per-item
  errors silently.
- `example_filled2.xlsx` — a second import test file: adds members/ports to the
  stacks from file 1 (6002 +5, 6006 +4, new ports on 7001) and repeats a socket
  pointing at a different switch port.

## 0.68.41
- **Fix: the «Сети» tree couldn't scroll** — `body.ipam-mode #side-ipam` was
  `display: block`, which broke `.side-block`'s flex-column so `#ipam-tree-side`
  grew to content height instead of being a constrained scroll area. Now flex-column
  (like `#side-infra`).
- **Scroll space under the action bar (both trees)**: `#tree` / `#ipam-tree-side`
  get bottom padding in select/move mode so the last item (incl. «Сети вне мест»)
  scrolls ABOVE the fixed `#tree-actions` / `#ipam-actions` bar into empty space.

## 0.68.40
- **No more page zoom/scroll (Сети + everywhere)**: browser pinch-zoom disabled
  app-wide — `user-scalable=no` in the viewport PLUS an iOS `gesturestart`
  preventDefault (iOS ignores the meta). Canvases keep their own pinch
  (`attachPinchZoom`); the topbar no longer scrolls off and the tree no longer
  browser-zooms.
- **«Сети вне мест» scroll inside the tree** (bottom padding in select/move mode)
  so the bottom action bar no longer covers them.
- **«Перенести» replaces «Убрать из мест»**: select networks → «Перенести» →
  every place lights «← сюда?» + a «Вне мест» target at the tree bottom → tap one
  → «Применить». Same mechanism/look as the Infra tree move (`.move-target` /
  `.move-armed` + `#tree-actions` buttons). «Удалить» stays. Moving to «Вне мест»
  is the old unassign.

## 0.68.39
- **Shared pinch-zoom** — extracted `attachPinchZoom` (core.js); Инфраструктура
  now uses the shared helper, and **«Сети» gains two-finger pinch-zoom on touch**
  (was the browser's page-zoom). `#ipam-scroll` got `touch-action: pan-x pan-y`.
  One helper for every canvas (ready for Виртуализация/Туннели too).
- **«Сети»: tap a place title to add a network** (edit mode) — the canvas has no
  "+" palette, so the floating location/site titles open `_createNet` on tap; a
  drag still moves the place; empty places show a "+" hint.

## 0.68.38
- **«Выбрать» (Сети): select mode now cancels ALL tree handlers** — one
  capture-phase guard suppresses place-focus, network details, drag and context
  menus; a click only toggles a network's selection (the folder chevron still
  collapses for navigation). Fixes clicking a location still loading it.
- **Batch-action bar reuses the Infrastructure `#tree-actions` styling** (same
  buttons) instead of a bespoke look.

## 0.68.37
- **Sticky contour titles («Сети»)**: each title slides along its own top border to
  stay visible while you pan/zoom, pinned to the viewport's left edge once the
  contour's left scrolls off and stopping at the right corner (`_stickTitles`,
  rAF-throttled on scroll/zoom/resize). CSS `position: sticky` can't do this — the
  `#ipam-clouds` scale transform breaks it — so it's computed in JS from
  getBoundingClientRect and converted back to the title's local offset.

## 0.68.36
- **«Выбрать» in the «Сети» tree** — multi-select of networks (tap to toggle,
  `.sel` highlight) with a floating action bar: «Убрать из мест (N)» (batch
  unassign, `scope→null`) / «Удалить (N)» (batch delete) / «Готово». Works on
  desktop and touch; dragging is suppressed while selecting. Fills the gap left by
  removing the tree mode toggle in 0.68.35.

## 0.68.35
- **«Сети» tree: mode toggle removed** — tree editing (drag networks, right-click
  create) is now always on, like the Infrastructure tree; a plain click still
  opens details (`_editTree()` → true).
- **Audit hidden on the «Сети» canvas** (it's an Infrastructure tool); on mobile
  Import/Export flow inline in one row there instead of a separate full-width line.
- **Contour titles sit ON the top border** (fieldset-legend style, `.place-cap`
  absolute + opaque backing that breaks the dashed line), freeing the space inside.

## 0.68.34
- Mobile: the "+" (palette) square shows **only in edit mode** (like the old FAB).
- Schema-switcher `<select>`: **options were invisible** (transparent bg) → given
  an explicit panel bg + text color.
- Schema-switcher: the native arrow drifted far from short names ("Сети") because a
  `<select>` sizes to its widest option → now **JS-fits the width to the selected
  value** (`fitCanvasSwitch`).
- `#side-ipam .side-head` («Места и сети») had `padding-top: 0` → restored to `12px`
  (matches «Инфраструктура»).
- **«Сети» canvas no longer compresses on small screens**: `.place` contours use
  `max-content` (not `fit-content`) and `#ipam-clouds` is `width: max-content;
  min-width: 100%` — so the diagram is content-sized and pans (like the Infra
  `#schema`) instead of being squeezed to the page width.

## 0.68.33
- **Mobile add: round "+" FAB → palette "+" square** (under «UI»). On touch,
  tapping the palette square opens the bottom add-catalog for the current scope
  (no dragging); the FAB is retired and the palette now shows on phones too.
- **Add-catalog is fully hierarchical**: contextual to the loaded scope (device
  in a location, location in a site, site in a group) AND always carries a
  **«Верхний уровень»** section to create a group / ungrouped site — so the whole
  tree is buildable from "+" on mobile. (Answers "how to create locations/sites/
  groups" once the FAB is gone.)

## 0.68.32
- **Multi-unit placement now fills the whole selection**: NetBox takes a device's
  height from its type, so selecting N cells offers a **«▭ Блок NU (без модели)»**
  type (created on demand, `_ensureBlockType`) as the default — the device occupies
  all N cells. A real N-U type, if present, is preferred. Fixes "created only in
  the first selected cell".
- **Touch — tap empty schema space** clears the stack highlight/dim.
- **Touch — re-tap a port** re-opens its tooltip (`attachTip` returns its show fn;
  the port click re-shows it on coarse pointers). Nothing else removed.
- Removed the **schema-canvas mode toggle** (the topbar one already covers it).
- **Touch polish**: killed the tap-flash on all controls
  (`-webkit-tap-highlight-color: transparent`), turned `[data-tip]` hover tooltips
  off on touch, fully reset the user-button hover.
- Removed the «Для добавления устройств загрузите локацию» note in the mobile add
  sheet.
- Deferred: swap the round "+" FAB for the palette square (needs a wiring choice).

## 0.68.31
- **Member naming unified on "/"**: the importer now names stack members
  `SW <stack>/<member>` (was `-`), matching the UI stack picker and the sheet's
  `6002/4/41` notation. Node suffix-split and `_stackBase` already accept both;
  export rebuilds refs from the VC (`_sw_ref`), so it's unaffected.
- **Dim the canvas on stack highlight**: `#schema.stack-focus` fades all
  non-member nodes + wires so the highlighted stack pops.
- Passport «Стек»: removed the redundant «Открыть стек» button (the stack line
  above already opens it).
- **Fix (real cause) — the rack mode toggle collapsed «Стойки»**: `render()`
  re-applied "collapse for a non-rack scope" on EVERY re-render, so toggling rack
  edit mode (which re-renders) re-collapsed an opened pane. Now it auto-collapses
  only when the SCOPE actually changes. (The earlier flex fix stays — real cause
  was this.)
- **Details breadcrumbs**: device name now sits BELOW its location; the location
  details show their **site** above the name, and the site details their **site
  group** — each a clickable crumb.

## 0.68.30
- **Multi-unit rack placement (queue-select)**: in rack edit mode, clicking a
  free unit no longer opens the modal at once — it builds a **contiguous green
  selection** (extend up/down by clicking adjacent cells; click inside to cancel).
  A **«Занять место?»** dialog floats beside the rack (fixed on `<body>`, a CSS
  triangle points at the cells) with «Нет» / «Да»; «Да» opens the create modal for
  that span. Position = the bottom cell; NetBox derives height from the type, so
  if a type is exactly N-U high (N = selected cells) it is pre-selected. Replaces
  the old touch two-tap "arm" mechanic (unified for mouse + touch).

## 0.68.29
- **Tree right-click on a device** now opens the context menu (the handler's
  selector was missing `.tree-dev`) → «Переименовать» / «Удалить». Delete cascades
  properly (cables + VC-master detach, already handled by `_cascadeDelete`).
  «Переместить» stays hidden for devices (the modal move has no device branch —
  move a device from its passport instead).
- **Stack list in the create-device modal**: the plain count badge became a
  **members button** (independent of selecting the stack — `stopPropagation`).
  Clicking it opens a popover *outside* the modal box (`_stackNamesPopover`, on
  `<body>` so `overflow:hidden` doesn't clip it) listing the member switch names
  + their `vc_position` — the "which names/positions are taken" view.

## 0.68.28
- **Stack assignment moved to device creation** (in the rack): the create-device
  modal now has a two-column layout — left = fields, right = **«Список стеков»**
  (`#modal-side`). Click a stack → the device joins that VirtualChassis and the
  «Имя» field becomes **`Имя/<позиция>`** (next free `vc_position`); on submit the
  `/N` in the name drives the position. **«Создать сейчас»** makes a new stack
  inline. The old «Создать свич» button in the stack window is gone (creation
  belongs at device creation); the stack window keeps «Добавить существующий» /
  «Расформировать», and the device passport keeps «Создать стек» / «В существующий».
- **Fix**: new device in a rack now refreshes the **tree** too (was only
  re-rendering the canvas — `tree.reload()` instead of `renderAll`).
- **Fix**: rack-pane header is now a flex row (`.pt-actions`) so the mode toggle
  and the collapse «‹» can't overlap — clicking «Редактировать» no longer risks
  hitting collapse.
- Deferred: multi-unit rack placement (queue-select cells → «Занять место?»).

## 0.68.27
- **Stack passport «Создать свич»** — create a brand-NEW physical member without
  inventing the name: the plugin proposes `<base>-<nextPos>` from an existing
  member (e.g. `SW 6002-1` → `SW 6002-2`) and inherits the stack-mates'
  site/role/type; the user just confirms. The old add is now **«Добавить
  существующий»** (attach an already-existing switch). Answers "how do I add
  6002-2 when 6002-1 already exists" — device name is unique per site (not a PK,
  and a stack doesn't relax that; see the netbox46-device-name-uniqueness note),
  so members must be distinctly named and the plugin owns the suffix.
  (Regression: `test_create_member`.)

## 0.68.26
- Passport «Стек» block moved **above «Интерфейсы и IP»** (was between interfaces
  and connections).
- Schema edit toggle moved from the pane title to the top-right overlay bar,
  **next to the «Физический / Беспроводной» view switch** (`schem-topbtn`).
- **Importer `join_stack` hardened** for already-stacked switches: same
  stack+position → no-op (idempotent re-import); a *different* stack → move here,
  handing off the old chassis' master first (never a dangling master); the sheet's
  `vc_position` already taken by another switch → join **unpositioned** instead of
  aborting the whole import on the `(virtual_chassis, vc_position)` unique
  constraint. (Regression: `test_join_stack` — create/idempotent/move/clash.)

## 0.68.25
- **Stacks (VirtualChassis) are now visible and manageable** (were write-only —
  import created them, nothing showed or edited them):
  - Graph endpoint sends `virtual_chassis {id,name,master}` + `vc_position` per
    device (`SchematicGraphView.dev_json`).
  - **Node**: the member suffix ("SW 6002**-4**") is split off in the `--stack`
    color (`_stackName`), and a clickable **stack badge** (position + layers icon)
    sits on the node's left-center (`_placeStackBadge`). Click ≠ a port: it
    outlines all stack members (`_highlightStack`) and opens the stack passport.
  - **Passport "Стек" block** (before "Соединения"): shows the current stack +
    position + master ★; in edit — «Создать стек» / «В существующий» /
    «Убрать из стека».
  - **Stack passport** (`showStack`): members by position (master ★, click → the
    device), rename, «Добавить свич», per-member ★-master / remove, «Расформировать».
    Master hand-off respects the PROTECT FK; the VC is deleted when it empties.
  - New `--stack` theme token (violet, distinct from power/console).

## 0.68.24
- **Export**: `Standort Endgerät` now filled ONLY from a *connected* socket. A
  direct end-device→switch link (no socket) leaves it blank (was wrongly showing
  the end device's location — the "many Server Room 1" rows).
- **Campus audit screen** (new): `audit.py` `collect_audit()` + `SchematicAuditView`
  at `/plugins/schematic/audit/`; "Аудит" button + `#audit-modal` + `auditui.js`.
  Pick a site group (or "Все площадки") → report grouped site→location: isolated
  devices (no link), unpatched sockets, free ports on panels/switches (info),
  orphan cables. Summary chips on top.

## 0.68.23
- **Export sources rows from patch panels too** (`_row_from_panel`, step "2b" in
  `collect_rows`): switch↔panel links inside racks now export with **PF/Port**
  filled even when no socket hangs off the rear.
- Column semantics fixed: **Technikraum = the rack's location**, **Standort
  Endgerät = the socket's location** (empty if none).
- `example_filled.xlsx` enriched with 4 socket-less panel↔switch rows.

## 0.68.22
- Export **DVS** falls back to the **switch's rack** when there's no panel (direct
  device→switch), instead of the end device's (empty) rack.

## 0.68.21
- Export-modal `<select>`s were unstyled (the CSS rule covered `#import-modal
  select` and `#export-modal input` but not `#export-modal select`) — fixed.
- "Экспортировать" button: block-on-click guard + loading spinner (like import).
- `dump_devices.py` (server terminal dump of every device → site/loc/rack/unit).

## 0.68.20
- **Universal export format** (`forms/universal.py`, export-only): plain device
  inventory of the scope — Device·Role·Model·Site·Location·**Rack·Unit**·Connections.
  Racked infra (switch/panel/PDU) shows its rack; loose end devices blank.
- **Ru/En column captions**: `Col.label_en` + `Col.header(lang)`, `write_workbook(..., lang)`;
  Format + Language pickers in the export modal. Patchen stays the fixed German template.
- "Всё дерево" root move target shows ONLY while a site/group is being moved.

## 0.68.19
- "**Всё дерево**" — root drop/move target at the tree bottom (drag a site out of
  its group, or a group to the top level); move-targets never hidden in move mode.
- Mobile: Import + Export on ONE second row of the "more" popup (`#imp-exp-row`).
- **No sticky hover on touch** (`@media (hover: none)` neutralises hover backgrounds).
- Version badge visible on phones, low z-index so drawer/sheets/tree-actions cover it.

## 0.68.18
- Racked patch panels render **FRONT down / REAR up** consistently (`_assignSides`).
- Import: a socket row with **no panel** creates no socket (no dangling occupied port).
- `check.md` — version-compatibility checklist (endpoints, fields, filter gotchas).

## 0.68.17
- Swap Import/Export button order (Import first).
- Import modal: tree + racks taller on desktop (reach the bottom).
- Version badge below modals (z-index 90→ later 30).
- Import reference lists (sites, device-types, roles) reloaded on every open — no
  stale data after a delete elsewhere.
- Switch port `"08"` → `"8"` (`_strip_zero`).
- **Cabling reuses a selected model's ports** (`frontrear`/`iface` match by last
  number, `_pnum`) — a 24-port panel stays 24 ports, no ad-hoc «Порт N».

## 0.68.16
- Import modal desktop layout: LEFT (upload + preview) / RIGHT (tree + rack editor).
- Per-device config: **Model & Role are dropdowns** from device-types/device-roles.
- "Импортировать" AND the delete-confirm "Удалить" block visually + physically on click.
- Import spinner floats just outside the modal's right edge (doesn't shift the button).

## 0.68.15
- Interactive import editor: mobile **accordion**, commit guard, reset selects on
  open, import spinner, **per-device config** ("Настроить" → model/role, sent on commit).
- **Deleting a scope clears the schema** (`reload()` wipes the canvas when scope is gone).

## 0.68.13
- Importer **rack placement**: panel always created (top unit if racked, else
  standalone); new switches → the DVS rack from the top, else standalone; `place()`
  allocator; re-import never moves an existing device.
- `docs/custom-forms.md` — dev guide for the Excel form registry.

## 0.68.10–0.68.12
- **Tablet adaptivity** = phone layout below ~1024px, with orientation-aware detail
  sheet (bottom in portrait, right-with-left-handle in landscape) and the device
  palette kept for drag-add.
- Networks canvas gets the topbar mode toggle (`data-mode="ipam"`).
- Trace **whisker "expand" button** (tap a whisker port → arrow button → loads the node);
  tap keeps the tooltip; tap-empty clears selection.
- Theme icons swapped (dark = lit bulb) + NetBox-style `[data-tip]` tooltips.
- Mobile: native `<select>`; narrow-topbar (≤400px) one-line brand; tree header above
  the scroll (no gap); import/export restored to the topbar + "more" popup.

## 0.68.9
- **Excel form registry** (`excel.py`: `ExcelForm`, `Col`, `@register_form`, matcher;
  `forms/patchen.py`). Import/export/`/forms/` run off registered forms — third
  parties can plug in their own. Import/export refactored onto it.
- **Loading pill** rewritten: fills left→right by share of finished requests, click
  expands the list of in-flight endpoints (×N, timings), timer freezes on finish.

## 0.68.7–0.68.8
- Cascade delete fix: `PowerFeedFilterSet` has no `location_id` (NetBox returns ALL
  feeds for an unknown filter) → scope via `power_panel_id`, delete orphan cables
  explicitly, detach a PROTECT `VirtualChassis.master` before deleting members.
- Cabling direction corrected (switch → panel FRONT, panel REAR → socket REAR);
  stacked switches modelled as a NetBox **VirtualChassis** (`join_stack`).

---

## Open / next
- **Full UI i18n** — UI strings are Russian; only package metadata is English so far.
  Deferred post-launch (extract strings to a catalog + English pass across ~20 JS files).
- Re-run stress tests → refresh numbers in README.
- Screenshots in README (user supplies; images "coming soon" placeholder for now).
- Decide: translate Patchen columns Ru/En too, or hide the language picker for Patchen.
