# Changelog

Running record of changes. Newest first. Deploy = bump `pyproject.toml` +
`gen_deploy.py`, `pip wheel . --no-deps -w dist`, regenerate `deploy_paste.sh`
(SHA256 round-trip must MATCH), paste into the server SSH session.
ALSO add a user-facing entry to `static/netbox_schematic/docs/ru/CHANGELOG.md`
AND `docs/en/CHANGELOG.md` (the version badge renders them in the UI, per user
language).

Verified locally each version: `py_compile`, `node --check`, CSS brace balance,
and the DB regression scripts in the scratchpad (`test_stack` round-trip,
`test_del_stack`, `test_cascade`, `test_place`, `test_modelports`, etc.) using
the real-rollback harness `_tx` (NOT `savepoint()`, which is a no-op outside an
atomic block and silently commits — see the netbox-test-harness memory).

## 0.69.18
- **Learning docs polish (docs-only).** «Схема» is strictly about the canvas now: the «double-click
  the NetBox title» line moved out (it lives in «Шапка страницы») and a «Ноды» section landed —
  node anatomy: role stripe, name→details, port dots (color/fill semantics), row edge-labels,
  stack badge, and the edit-mode ⋮ menu. «Модель устройства» gained the per-node scenario:
  ⋮ → «Модель» (retype this one device), «Порты» (shift free-port numbers), «Изменить» (full form).

## 0.69.17
- **Height lives on the MODEL; the rack multi-shelf selection is gone.** Devices of one model
  CANNOT differ in height (u_height is a type property — the user's 400 «Device 34234 … does not
  have sufficient space» is NetBox validating exactly that), so the plugin now has ONE lever:
  the «Высота, U» field in the catalog editor (kept, live «· NU» preview; PATCH on save applies
  to all devices of the model, collisions surface with the offending device named). The rack's
  contiguous unit-range selection + «Блок NU» on-demand types are REMOVED: in rack edit mode a
  click selects that single shelf → «Занять место?» → create; the footprint comes from the
  chosen model's height (labels show «(NU)»). `_ensureBlockType` deleted; «NU» tag removed from
  the catalog list (`.cat-u`). Docs (model/racks/device topics + both user changelogs) rewritten.

## 0.69.16
- **«Последние изменения» reads a real markdown changelog, language-aware.** The about modal
  fetches `static/netbox_schematic/docs/<lang>/CHANGELOG.md` (ru + en shipped) via
  `import.meta.url`-relative URLs and renders it with a tiny built-in markdown renderer
  (h1–h4 shifted one level, lists, bold/italic/code, images, links, hr). Language:
  localStorage `schematic.lang` (the planned language setting) → page/browser lang; a missing
  translation falls back to ru. `CHANGELOG_RU`/`FEATURES_RU` arrays removed from about.js.
- **«Возможности» → «Обучение»: a topic tree with game-style, case-driven docs.** 11 topics
  (Модель устройства, Каталог моделей, Характеристики устройства, Кабели, Иерархия, Схема,
  Детали, Режим редактирования, Стойки, Импорт/Экспорт, Шапка) live as markdown in
  `docs/ru/learn/<key>.md` — scenarios («Сценарий: …») instead of button descriptions.
  Desktop: tree left / doc right (first topic opens automatically). Phone: the tree fills the
  modal, a chosen topic slides in full-screen with a «←» back arrow. Images supported
  (`![…](../img/…)` — drop files into `docs/img/`).
- **The «· U1» unit tag removed from schema nodes** (the unit lives in device details and the
  rack view; the node subtitle is just the model now).
- **Model height is editable in the catalog («Высота, U», live preview).** Height is a TYPE
  property in NetBox — this is the missing piece that made «one device across several rack
  shelves» impossible to set up by hand: raise the model to 2U and its devices occupy two
  shelves in the rack view (`_saveHeight` PATCH on save/apply; NetBox itself rejects heights
  that would collide with racked neighbors). Rack-side span selection («Занять место», Блок NU)
  already existed.
- Harness `test_about_v16.mjs` (33 checks: renderer, resolveLang, all docs present & render).

## 0.69.15
- **Ввод and розетки standing in ONE row get a gap between the clusters.** When power-ports and
  power-outlets land on the same node edge (e.g. «Сторона: снизу» for both on a PDU), an extra
  STEP separates the input cluster from the outlet strip; width/centering math accounts for it.
  Rule is strictly powerport↔poweroutlet — interfaces next to розетки stay as before.
  (`runPx`/`runL` in `_nodeParts`; harness `test_gap_v15.mjs` — real `_nodeParts`, 12 checks.)
- **The version badge (bottom-right) is a button now** — opens a modal with two tabs:
  «Последние изменения» (user-facing RU changelog, `CHANGELOG_RU`) and «Возможности» (what the
  plugin can do, grouped). New `about.js` (AboutUI + both lists), `.abt-*` styles, Esc/backdrop
  close, mobile-sized. Maintenance: add an RU entry per release (header note above).

## 0.69.14
- **«Сторона» per port row in the catalog editor — put ports on TOP or BOTTOM of the node.**
  Each row gets a select «авто / сверху / снизу» (авто keeps the old heuristic: interfaces and
  розетки up, вводы and консоли down). Applies live in the preview and — after «Сохранить в тип» —
  to every device of the type on the schema (redraw). Stored per kind in an INVISIBLE
  HTML-comment marker inside `DeviceType.comments` (`<!-- schematic:sides {"outlet":"bottom"} -->`),
  so NetBox's rendered view shows nothing and no backend changes are needed (device-types are
  already loaded in full at boot). Front/rear pairs and wireless keep their fixed sides (the
  select is disabled — an override would break «port N under port N» pairing / the radio row).
  (`parseTypeSides`/`writeTypeSides` in schema_util, `_typeSides` + overrides in `_assignSides`,
  `.ced-side` select; harness `test_sides_v14.mjs` — 18 checks on the real `_assignSides`.)

## 0.69.13
- **Power gear now GIVES power through «Розетки» (power outlets).** The PDU / ИБП / стабилизатор
  solutions get a proper port spec: one round «Ввод» (power-port, C14) + N «Розеток» (power-outlet,
  C13) instead of N power-ports. A power-port can only connect to an outlet/feed (never to another
  power-port) — this is WHY device power ports «couldn't connect to anything but feeders»: both
  sides were inputs. Existing PDUs are fixed by applying the model in the catalog (retype needs
  free ports; occupied ones warn). Harness: `test_power_v13.mjs`.
- **Device creation asks ONLY for a name — ports come from the model (type templates).** The
  port-count fields in the «Добавить» modal are gone: they fought the catalog model and produced
  duplicate ports. On first use of a solution its DeviceType is created WITH template ports seeded
  from the spec (NetBox instantiates them on device creation); edits go through the catalog. If the
  type has no templates (pre-existing installs), the status + catalog ⚠ point to «Сохранить в тип» /
  «Применить ко всем». (`addSolution`, `_ensureDeviceType` + `_seedTypeTemplates`, shared
  `solutionRows`; `_createPorts`/`_createPatchPorts` removed.)
- **Power rows live INSIDE their server room now (layout).** Per location, under the racks+pocket
  and centered on the same span the panels row uses: «Питание» (PDU/ИБП type contours in a row,
  orange wrap) → «Стабилизаторы» (own orange row; stabilizers/inverters are now classified as
  power gear, not right-pocket) → «Силовые щиты» below. Their boxes register in
  `state.offContours[locId]`, so the LOCATION CONTOUR encloses them — same mechanism as the panels'
  `powerBoxEls`. Power devices without a room (multi-room area) fall back to one global block
  below everything. Harness: `test_powerlayout_v13.mjs` (real `_computeLocGeometry`, 20 checks).
- Palette label «Распредщиток» → «Щиток» (ships with this build).

## 0.69.12
- **Feed (фидер) port is numbered 1..N** on the panel's left edge (was showing the feed's name);
  the feed name still shows in its row.
- **«Models without ports» warning is a visible block now, not a hover title.** The catalog shows
  an amber banner at the top — how many «Схематика» models lack ports and what to do — so it reads
  on touch too; the topbar «Каталог» button keeps its ⚠ badge.

## 0.69.11
- **⚠ on «Схематика» models that have no ports yet.** A model created in the catalog («+ Модель»)
  has no port templates until you «Сохранить в тип» — applying it to a device then adds nothing.
  Now such models show a ⚠ in the catalog list, and the topbar «Каталог» button gets a ⚠ badge when
  ANY of your models is portless (checked on page load, only «Схематика» types). The ⚠ clears the
  moment you save ports / apply to all. (`_emptyOwnTypes` — one bulk request per template endpoint.)

## 0.69.10
- **Power equipment in ONE block below the racks (layout).** Off-rack POWER devices (PDU, UPS/
  ИБП — detected by power outlets, or role/model name) no longer sit in the right-side pockets
  with cameras; they're gathered into a single «Питание» block UNDER the racks (a wide row of
  type contours), with the «Силовые щиты» (power-panels) block below it. Cameras and other
  peripherals stay in the right pockets; an in-rack PDU stays in its rack. (`_isPowerDev` +
  `_powerArea` in the layout pre-pass; classification/packing harness-verified — the visual
  placement is best eyeballed live.)

## 0.69.9
- **Selected / target port rings show on touch again.** `.port:hover` (base + the touch override)
  had EQUAL specificity to `.port.pending` / `.port.aim-ok` / `.port.hl`, so the sticky `:hover`
  after a tap hid the ring of the SELECTED port (red `.pending`) and of compatible connect-targets
  (green `.aim-ok`) — making them look dim while wiring. Scoped `.port:hover` to
  `:not(.hl):not(.pending):not(.aim-ok)`, so a port in a state always keeps its own ring.
- **Removed the «Отмена привязки» (`#cancelconn`) button.** Cancel a pending connection by tapping
  the port again or tapping empty space (both already work).

## 0.69.8
- **Port type in the tooltip.** The port tooltip now shows the port's type (interface speed,
  console / power connector) next to the kind — e.g. «сетевой интерфейс · 1000BASE-T». The
  graph endpoint now exposes `type` for ALL port kinds (was interface/front/rear only).
- **Reconcile warns on a type mismatch instead of forcing it.** When applying a model, an
  OCCUPIED port whose type differs from the model's is renamed to the model but its TYPE is
  NOT changed (a cable of the old type is attached) — «↦ По роли» and the on-node «Модель»
  now show a ⚠ warning listing those ports, so you decide whether to re-cable. Free ports are
  retyped as before.

## 0.69.7
- **Applying a model reconciles occupied ports BY NUMBER — no more duplicate ports.** A device
  imported with a cabled interface named `eth1` then got a SECOND free port `1` grown beside it
  when you applied its model («↦ По роли» / on-node «Модель») — grow matched by name only, and
  the delete pass kept `eth1` by number. Now `applyModel` first **reconciles**: for each model
  port it renames the existing same-NUMBER port to the model's name + type (preferring the
  OCCUPIED one, keeping its cable) instead of creating a duplicate, and drops free same-number
  duplicates. So a cabled `eth1` **becomes** the model's `1` (RJ45), keeping its connection — and
  re-applying also cleans up devices already left with `eth1` + `1`. Standalone kinds
  (interfaces / console / power / rear); the add-only «Применить ко всем» is unchanged.
  Verified via a Node harness (import / already-broken / both-free / extra-occupied cases).

## 0.69.6
- **Fix the port/cable-selection regressions — back to main's behaviour + the peripheral
  tracing.** Three recent mobile tweaks made selection worse; reverted / fixed:
  - **The tapped port gets its ring now.** `.port:hover` and `.port.hl` have EQUAL specificity,
    and the `.port:hover { box-shadow:none }` I'd added in responsive.css (loaded later) was
    overriding the ring of the very port you tapped — so it showed only on the far end of the
    pair, or after a pan/zoom cleared the sticky `:hover`. Scoped it to `.port:not(.hl):hover`,
    so a selected port keeps its ring (and a pressed-but-unselected port still has no "white ring").
  - **Removed the wide cable hit-path** (0.69.4). With `wiresAbovePorts` it sat ABOVE the ports
    and stole taps → the tooltip flipped between the port and the cable (wire type appearing/
    vanishing) and taps near a port alternated port/cable ("garland"). Back to the plain thin wire.
  - **Removed the `_repaintPorts` display-flush** (0.69.5) — it treated the wrong cause and
    caused the flicker.
  Kept: **tracing from peripheral devices** (front/rear ports via `/paths/`) — the one change
  that was actually needed.

## 0.69.5
- **Port ring paints on the FIRST tap (touch).** Tapping a port lit its cable but the port's
  own ring only appeared after you panned — iOS/WebKit defers painting a `box-shadow` change
  on an element inside the scaled `#schema` layer until the next scroll/zoom (the wire paints
  because it lives in a separate `#wires` layer). Now the two highlighted ports are force-
  repainted (a display flush, touch only) right after the highlight. Behaviour is as intended:
  **1st tap = port + cable selection; 2nd tap on the selected port = full path.**

## 0.69.4
- **Cable & port selection on touch, like desktop.** Wires are only 1.8px wide — near
  impossible to tap with a finger. Each cable now carries a wide TRANSPARENT hit-path
  (16px on touch; inactive on desktop, where precise hover stays on the thin visible wire),
  so tapping a cable selects it. A cable tap now **pins** the connection highlight — the
  cable + its two ports + their nodes lit, everything else dimmed — clearing on a tap in
  empty space, exactly like a port tap. (`_wirePathEl` wraps the wire in a `<g>` with the
  hit-path; the view-mode click → `_traceLocal`.)

## 0.69.3
- **Reverted the tooltip «показать весь путь» button — back to a 2nd tap on the port.** The
  button never worked on iOS (the tap fell through the `pointer-events:none` `#tip` to the
  schema behind), and making `#tip` `pointer-events:auto` broke the canvas pinch (the browser
  page-zoomed instead). Now: 1st tap on a port lights the link + tooltip; a **2nd tap on the
  same port** traces the whole path AND closes the tooltip so the path is visible. Tip hint:
  «ещё раз по порту — весь путь».
- **Touch port polish** (`@media (hover:none)` / `(pointer:coarse)`):
  - no sticky "white ring" / enlarge after a tap (a lingering `:hover` made a port look held);
  - no blue text-selection of port digits on repeated taps (`user-select:none` on nodes/ports/labels);
  - the 2nd (trace) tap no longer triggers the browser's double-tap zoom (`touch-action:manipulation`).

## 0.69.2
- **Fix «показать весь путь» on iOS / touch.** Tapping the button did nothing — it only
  dismissed the tooltip + highlight, never traced. Cause: `#tip` is `pointer-events:none`
  (so it never blocks the desktop cursor), and on iOS the tap **passed through** the button
  to the schema behind it, which the dismiss handlers read as "tap empty space". Fixes:
  - the **touch** tooltip (`.tip-fixed`) is now `pointer-events:auto`, so the button
    actually receives the tap (desktop keeps `pointer-events:none`);
  - the button is **wired directly to its port** in `_onPortClick` (no shared state);
  - a tap **anywhere inside the tip** no longer clears the trace (`_armTraceClear` guards
    the whole `#tip`, not just the button).

## 0.69.1
- **Trace, dimming and tooltip survive pan & zoom on touch.** The mobile «показать путь»
  button was unreachable in practice: panning or pinching the schema dismissed the tooltip,
  and a one-finger pan even cleared the path highlight. Fixed in `_enablePanZoom` —
  - the tooltip now closes only on a genuine **TAP** on empty space; a finger **drag** (pan)
    or a **2-finger pinch** keeps it (tracked over pointer down→up, multi-touch aware);
  - the pan's tap-vs-drag test uses the pointer **down→up distance** instead of a `moved`
    flag that a native-scroll (touch) pan never set — so a pan no longer clears the trace.
  Highlight/dimming already survived zoom (zoom is a CSS scale; `redrawWires` re-applies the
  wire highlight and node/port classes persist).

## 0.69.0
- **Minor-version milestone** + the **«Каталог устройств»** is now a documented, first-class
  feature in the README (preview a device type as a node, edit stock ports, apply to all / by role).
- **«↦ По роли» reconciles ports** (was grow-only): applying a model to a role now ADDS missing
  AND DELETES the device's FREE ports that aren't in the model (cabled/occupied ports kept). So
  returning a device to its own model actually fixes wrong ports — e.g. a camera left with a
  patch panel's 24 rear ports. (Uses `device.applyModel`, same reconcile as the on-node «Модель».)
- **Removed the «Синхронизировать порты с типом» button** and its dead code (`syncComponents` /
  `_applySync` / `KIND_ENDPOINTS`) — it was error-prone; ports are reconciled by the catalog
  apply / «По роли» / on-node «Модель» change instead.
- **Mobile trace via the tooltip.** On touch the tip covers the port, so a 2nd tap on the port
  could never fire the trace — the tooltip now shows a **«показать весь путь»** button that runs
  the full trace (front/rear via `/paths/`, others via `/trace/`).
- **Node action bars** («Модель» / «Порты») now float in the **middle of the screen on phone/
  tablet** (a floating panel, not over the schema) and **above the node on desktop**.
- **Kebab (⋮) menu opens up or down** depending on whether the button sits below or above the
  screen's vertical middle — it never runs off the bottom edge now.
- **Note (patch panels):** if «По роли» gives a panel only REAR ports, its type is missing
  FRONT-port templates — re-save the type in the catalog (it writes front templates via the
  NetBox 4.6 `rear_ports` mapping).

## 0.68.67
- **Trace through patch panels from ANY port type.** Double-tap/dbl-click on a port now
  builds the full physical path to the far end (switch port) for every port kind. Front/rear
  ports have no `/trace/` endpoint (they're pass-through) — they expose `/paths/` (CablePaths).
  `_trace` now fetches `/paths/` for front/rear and `/trace/` for the rest, then extracts
  cables/ports/devices from a unified node list. So a **socket's rear port** finally traces
  through the panel to the switch (before it only lit the local cable). Verified via harness.
- **Tooltip near the port on tablets.** The centered pinned tooltip was for phones (finger
  hides a small port, narrow screen); tablets have room, so the tip now spawns next to the
  port there (still with a tap-to-close button, since touch has no mouseleave).
- **Tooltip layout:** the connection's next port sits right under the **device title** (not
  under the IP), and the **IP pill** moved to the **right of the «сетевой интерфейс» label**.

## 0.68.66
- **Port tooltip: destination + IP, no dead hint on touch.** On a phone the tip appears
  AFTER the tap, so «клик — показать путь» made no sense — dropped on touch (kept on desktop
  hover). Instead the tip now shows the connection's **destination** (near cable neighbour
  `device · port`, computed from the loaded cables; `link_peers` fallback in single view) and
  the interface's **IP** in the same green pill (`chip .c-ip`) as the passport.
- **Opening a device passport closes any open tooltip** (`hideTip()` in `device.show`) — a
  touch tip has no mouseleave to dismiss it otherwise.
- **Passport keeps its scroll position on in-place edits** (e.g. adding an IP re-renders via
  `device.show` — no more jump to the top). A different device starts at the top, and closing
  the detail sheet resets the scroll (responsive.js), so the next open is fresh too.

## 0.68.65
- **No new links from free ports during the «Модель» / «Порты» overlay.** Those on-node
  modes keep schema-edit on, so clicking a FREE port still started/finished a cable. Added
  a guard in `_onPortClick` (after the occupied-port handlers): while `_modelMode` or
  `_portShift` is active, a free-port click just shows a hint and returns. Occupied ports
  are untouched — they still open their link menu above the guard.

## 0.68.64
- **Removed the «На главную» topbar link** — the «NetBox» brand name already links home,
  so it was redundant. Dropped the element and its CSS (schematic.css + responsive.css).

## 0.68.63
- **Whiskers survive zoom in the model/port overlay.** In the on-node «Модель» / «Порты»
  focus mode the node's cables show as short whiskers; zooming or resizing called
  `redrawWires`, which repainted the FULL wires over them. `redrawWires` now early-returns
  to `_drawNodeWhiskers(focusedDev)` whenever a model-change/port-shift overlay is active
  (mirrors the existing `state.single` trace branch), so every redraw path — zoom, resize,
  filter, layers — keeps the whiskers.
- **«+ Модель» is a square plus-icon button** (matches the Import/Export icon squares).

## 0.68.62
- **Mobile polish (phone adaptivity pass).** Five UI fixes for narrow screens:
  - **Import / Export in the header are now icon-only squares** (label dropped, tooltip
    keeps the meaning); Catalog / Audit keep their text labels.
  - **Import conflicts render as a vertical spec-compare** (one card per device: field ·
    Сейчас · Из файла, like a tech-shop comparison) instead of a wide horizontal table —
    the «Без замены / Заменить» buttons now sit in each card's header, always visible
    (they used to scroll off the right on a phone). Changed field values are highlighted.
  - **Catalog on phones is full-screen with a list↔preview slide**: the list shows first,
    tapping a type slides it away to the preview, and a «←» in the header returns.
  - **The on-node «Модель» / «Порты» action bars float like a tooltip pinned near the top
    of the screen** (not over the node), so the dimmed node stays fully visible below.
    The port-shift bar wraps on narrow screens.

## 0.68.61
- **Port-number shift (Phase D — completes the node model/port editor).** Kebab → «Порты»
  opens the dim/whisker overlay with a bar above the node: ⟨N⟩ per category (Интерфейсы /
  Front-Rear / Питание / Console). ⟩ = +N, ⟨ = −N applied to that category's FREE ports
  (N = the model's port count for it); occupied ports stay put and a free port shifted onto
  an occupied number is dropped. Brings imported ports that stuck out (e.g. 41-43 on a stack
  member) back into range. Each click applies immediately (free ports have no cables).

## 0.68.60
- **Model change reconciles ports.** Applying a new model on a node now also DELETES the
  device's FREE ports that aren't in the new model (occupied/cabled ports are always
  kept) — no leftover free ports from the old model. `device.applyModel` (grow + trim-free).
- **Console back at the bottom-right** in the front/rear-centred layout (it was drifting
  into the middle like a power port); interfaces/power are centred between trunk and console.
- **Catalog views stacked again** (Физический above Беспроводной); the model-change window
  now appears ABOVE the node instead of to the side.

## 0.68.59
- **On-node model change (Phase B v2).** Picking a model in the «Модель» window now
  re-renders the node LIVE: the new model's ports appear, occupied ports keep their slot
  BY NUMBER, and occupied ports numbered beyond the model stay visible; ✗/Esc restores
  the original node. The window is pinned next to the node and follows panning. The
  by-role apply warns that over-model connections are kept (grow never deletes).

## 0.68.58
- **Model change is now an overlay, not a navigation.** Kebab → «Модель» no longer
  jumps to the single-device view — it dims the current schema, turns the node's cables
  into whiskers, and shows the model window on top; ✓ applies + re-renders, ✗ restores
  the view. (Phase B v2 groundwork.)
- **Global «↦ По роли» in the catalog header.** Pick a role + a model → sets that model
  on every device of the role and grows its ports (add-only). For a hardware swap where
  cabling stayed put. (Phase C.)

## 0.68.57
- **Fix: patch panels got REAR ports but no FRONT.** In NetBox 4.6 a FrontPort /
  FrontPortTemplate maps to its rear via a writable `rear_ports` array (PortMapping), not
  a `rear_port` FK. The code sent `rear_port`, which is silently ignored → front templates
  weren't created → applying the patch-panel model gave rear-only panels with a stray
  imported pair. Fixed in the catalog's template writer and the device grow
  (`_syncFrontPorts`); verified against the NetBox 4.6 serializers.

## 0.68.56
- **On-node model change (Phase B, v1).** Kebab → «Модель» opens the single-device
  whisker view with a model-picker bar (✗ / model select / ✓). Accept changes the
  device's `device_type` and grows its ports to the new model (adds missing, never
  deletes); cancel/accept return to the area view. `growOneToType` added (grow a single
  device). Live re-render preview is the next increment.

## 0.68.55
- **Node actions → kebab menu (Phase A).** In edit mode the node's pencil is now a ⋮
  (three-dot) button opening a dropdown: «Порты», «Модель», «Изменить». «Изменить» opens
  the existing device-edit modal; «Порты»/«Модель» (on-canvas port-renumber / model-swap
  modes — see node_model_edit.md) are next.

## 0.68.54
- **Stack badge shows the stack SIZE.** The badge on each stacked node now shows how
  many members the virtual chassis has (same number on every member) instead of that
  member's position.
- **Mode switch no longer dims the canvas.** A lingering stack highlight (which dims
  everything except the stack) is now cleared when you toggle the schema's view/edit mode.
- **Catalog progress → the loader.** Catalog status ("adding ports: device i/N…", save/
  apply results) is mirrored into the bright #reqspin loader, so it stays readable over a
  dimmed background.

## 0.68.53
- **Node layout: front/rear-aware centring.** When a node has a front/rear patch trunk
  together with interfaces/power, the trunk now anchors LEFT and the interfaces (top) +
  power (bottom) are centred in the middle, console stays bottom-right (schema and catalog
  alike). Purely visual — port data untouched. Every other node (plain switch, patch panel,
  PDU, …) is byte-identical to before; port positions are computed once in `_nodeParts`
  (`slots`) and shared by both renderers.
- **Catalog: device count** shows the number in blue (accent) when non-zero — no badge.

## 0.68.52
- **Catalog Step 2 — «Применить ко всем».** A footer button writes the model's ports to
  the type AND adds the missing ones to every device of that type. Grow-only: it never
  deletes, so cabled/imported ports and their IPs stay put — it just fills the gaps up to
  the model's set (matched by number). This lets sparse imported devices show their free
  ports on the schema. The schema reloads when done.

## 0.68.51
- **Catalog tweaks.** Delete-model is now a trash button in the footer (opposite the
  save button); the "devices using this model" count is a green-outlined badge on the
  right of the meta line; the per-type template lookups now run in parallel (faster
  type switching).

## 0.68.50
- **Catalog polish (from live feedback).** Port numbering restarts at 1 per kind
  (wireless gets `wlan…` names so it doesn't clash with wired interfaces on the shared
  endpoint); the Физический / Беспроводной previews sit SIDE BY SIDE; «Сохранить в тип»
  moved to a bottom-right footer and «Удалить модель» is a trash icon (top-right); port
  dots use the custom hover tooltip; and the meta line shows how many devices use the model.

## 0.68.49
- **Fix: catalog showed every type's ports as identical.** Template queries used
  `?devicetype_id=` (no underscore), which NetBox silently ignores — so every type
  returned ALL templates in the system. Corrected to `device_type_id` (also in the
  "sync ports to type" path, where the same bug meant the footgun guard never fired).
- **Catalog editor: two live views + wireless.** The Физический/Беспроводной toggle is
  gone — the node renders in BOTH views at once (two labelled panes) and the preview
  follows the editor rows live as you type. Added a «Беспроводной (Wi-Fi)» port kind.
  Unsaved custom types are pre-filled from their `solutions.js` definition (a switch
  shows 24 interfaces, a PDU 8 outlets, …), so different models no longer look the same.

## 0.68.48
- **Catalog opens from the top bar.** The «Каталог» button moved out of the schema
  toolbar into the main header, left of «Импорт» — it's a global device-type tool,
  not schema-specific.

## 0.68.47
- **Fix: editing a racked device no longer 400s on `face`.** `editDevice` defaults
  `face` to `"front"` when a rack position is set but the side was left empty (NetBox
  rejects a position without a face); the face prefill also accepts a bare-string
  value, not only `{value,label}`.
- **Import: the «Netz» column is no longer dropped.** Its value is stored as a
  parseable `[Сеть: …]` marker on the switch interface's `description` (idempotent,
  never clobbers human text) and is read back on export, so it round-trips. Option-2
  (a documentation label); real VLAN objects can be derived from it later.
- **New: device catalog.** Toolbar button «Каталог» opens a window that previews how a
  Device Type lands as a schema node (ports from the type's component templates,
  physical/wireless toggle). For the plugin's own types (manufacturer «Схематика») it
  also EDITS stock ports: «+ Модель» to create a Device Type, rows of kind+type+count
  written as component templates, and model deletion. Editing templates is safe (no
  devices touched); pushing the new port set onto existing devices is a later step.
- **Guard: “sync ports to type” no longer wipes a custom-type device.** A Device Type
  with no component templates (the plugin's synthetic types) put every port into the
  delete set; sync now refuses with a message pointing at the catalog instead of
  removing all ports/cables.

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
