# What's new

## 0.69.49
- **The ⋮ menu on a node opens «Порты / Модель / Изменить» again.** In 0.69.44 the new
  "hide" menu for the single-device view accidentally took the same internal name as the
  existing one and replaced it. Both menus now live separately.
- **A node is outlined green when its "hide" menu opens** — the same way a port is ringed on
  tap, so it is obvious which node the menu is about.
- **The port-pick block puts its buttons in the same order as the link menu**: close, action,
  trash.
- **The trash removes every VLAN from the picked ports.** It asks for confirmation, skips
  ports that carry none, and only appears when there is something to remove.

## 0.69.42 - 0.69.48

**Tapping on a touchscreen.** The same thing kept not working for several versions in a row: a
tap on a port showed the tooltip and nothing else — no green ring — and the bus opened one tap
later than it should. There turned out to be three causes, each hidden behind the last:

- in the single-device view — the one a phone lives in — the VLAN click branch was disabled
  outright;
- on a touchscreen the browser treats the first tap on an element that reacts to hover as the
  hover itself and swallows the click behind it. Touch now acts on the tap directly;
- the ring was applied at the right moment but immediately blanked by the hover rule: after a
  tap the finger leaves the port in a sticky hover, and the mobile rule removes the shadow in
  that state.

The result: a tap on **any** port — free, cabled, in any view — gives the green ring at once.
In the VLAN view the first tap opens the bus and the second expands it across all its ports.

**Stylesheets and scripts now carry the version in their URL.** The plugin serves files with no
build step, so after an upgrade a browser could still show the old CSS — and the old behaviour
with it. Each new version now pulls its own styles.

**Everything else in these versions**

- The ✕ in the link menu no longer deletes the link, it just closes the menu. Deleting is its
  own trash button, right of «перевесить».
- The link menu closes as soon as the schematic is moved: it is pinned to a point on screen and
  after a pan it would point at a different cable.
- A node in the single-device view can be removed from a menu on the node itself: tap its body
  and "скрыть" removes it and everything opened through it. The root stays.
- The VLAN bus caption is always light (it used to come out black on some buses, white on others).
- Port dots sit further from the device body — they no longer cover the «ИНТЕРФЕЙСЫ» and
  «ПИТАНИЕ» row captions.
- The bottom sheet's grab handle is its own header row: content sits below it as a separate
  block instead of sliding underneath.
- Tapping the stack badge on a phone opens the details.
- Opening a single device leaves «Правка» — edit mode belongs to the area you were building.
- Interface chrome is no longer selectable as text. Where text is meant to be copied (passport,
  tooltips, inputs) selection stays.

## 0.69.41
- **A tapped port is highlighted green again** — the same highlight the physical view uses.
  There is no hover on a phone, so without it you could not tell whether the tap had landed
  on the dot you aimed at.
- **The bus opens in two taps, not three.** Ports have no tooltip in the VLAN view any more:
  on touch it pinned itself and swallowed the first tap. The bus block already shows the
  VLAN's name and mode.
- **Port dots are bigger** — two-digit numbers no longer touch the edges.
- **The sliding bus caption keeps a margin** from the bar's edge.
- **Device icon and name are centred.** The card used to be left-aligned, so the same switch
  looked different opened on its own than it did inside a rack.
- **«Отображение» is shown when a single device is loaded** too — it is how the views are
  switched, and on a phone the single-device view is the schematic.

## 0.69.40
- **A wide bus bar's name now slides** along the visible part of the bar — the same way place
  and location captions behave on «Сети». A bar stretched across two racks is wider than the
  screen, so a name centred on it was almost always off-view. It pins to the edge of the
  screen and stops at the bar's right corner, never leaving the bar.
- **Tapping a bus on a phone did not open the details** — fixed.
- **The «Стойки» pane always starts collapsed.** Its state used to be remembered, so a single
  visit to a rack left the pane open on every later load. You can still collapse and expand
  it; that choice simply no longer carries over to the next visit.

## 0.69.39
- **The green hover ring is gone from the VLAN view.** It highlighted a cable's two ends, not
  a VLAN — so it lit up only on ports that have a cable and looked like "some ports react,
  others don't". No cables are drawn in this view, so it pointed at nothing. Hover here is
  now the plain one; clicks answer the VLAN questions.
- **Clicking a bus bar opens the VLAN's details** — every interface on it, grouped by device,
  marked untagged/tagged, with a summary on top. Clicking a device name opens its passport.
- **A wide bar no longer truncates its own name** with an ellipsis.
- **«VLAN» moved next to «Физический»**, «Беспроводной» went last — it is the longest label
  and has the panel edge to grow into there.
- **«Отображение» is now available on phones.** It used to be hidden with the other floating
  controls — but it is the only way to switch to the VLAN and wireless views, and on a phone
  there is no other route to them. Narrower panel, taller rows for fingertips.

## 0.69.38
- **Every link now keeps a gap from its port** — not just the VLAN bus: cables, radio links,
  panel feed lines, trace curves and trace whiskers all start at the edge of the dot rather
  than at its centre. The shape of the lines is unchanged; only the tip moved.
- This shows where lines are drawn ON TOP of the ports: the "wires above ports" toggle and
  the VLAN view. In those modes a cable used to be drawn across its own port's number. In
  the normal mode the dot already covered the tip, so nothing changed there.

## 0.69.37
- **A line no longer covers the port number** — it starts at the edge of the dot rather than
  at its centre.
- **Widening the bus no longer shortens the bar.** When a VLAN's ports sit right next to each
  other their span is narrower than the label itself, so the second click visibly shrank the
  block. The span is now a minimum: the bar never gets shorter than its own label.
- **Panning the schematic no longer drops the selection.** The block used to close on press,
  and dragging the schematic starts with a press — so any movement across the canvas lost the
  widened bus. Only a real click, without dragging, closes it now.

## 0.69.36
- **A link to the bus no longer disappears under the device.** When the bus opens below a
  port the line crosses the node body; it used to run underneath it, leaving the port
  looking unconnected. In the VLAN view the line layer now sits above the devices (it does
  not intercept clicks).
- **One VLAN, one colour everywhere it is named.** The dot in the «Отображение» list and the
  VLAN chip in the device passport now take the same colour as the bus and the port ring.
  The list used to paint every VLAN the same.
- The "+N тег." chip stays muted on purpose: it stands for several VLANs at once, and any
  single colour on it would be untrue.

## 0.69.35
- **The second click now highlights the devices as well**, not just their ports: every
  device with a port on that bus is outlined in the VLAN's colour and the rest dim. On a
  rack of 48-port switches that is how you see who is on the bus — the dots are too small.

## 0.69.34
- **Fixed a highlight that would not clear.** After the second click on a port, clicking
  empty canvas closed the block but left the schematic dimmed. The highlight now goes away
  with the block — by any route: clicking away, a third click on the port, or a view switch.
- The highlight is no longer lost when the schematic is redrawn (zoom, filters, node gap).
- **A double click in the VLAN view no longer starts a trace.** It painted the physical
  link/port/device highlight over a view that has its own logic — and since a double click
  always follows a second single click, it fired on every attempt to widen a bus. The normal
  and trace views keep the old behaviour.
- **The highlight now uses the VLAN's own colour** instead of the generic accent: a lit port
  used to glow cyan next to its green or purple bus.
- The cut stubs are longer.

## 0.69.33
- **The bus label now follows the theme:** always white on dark, always black on light. The
  rectangle already carries the VLAN colour; the label only has to be readable.
- **A second click stretches the bus across all of its ports** and joins each of them to it
  with a link. The bar's length is now the VLAN's reach — one rack or the whole room. On a
  trunk each bus spans its own ports, so two bars over one port can differ in length.
- **A third click closes it** — one port cycles: bus → whole bus → off.
- **Every port with a VLAN grows a short cut stub**, so you can see it sits on a bus without
  clicking anything. Several VLANs, several stubs. Ports already joined to an open bus get
  the full link instead.
- **The bus no longer changes size with the zoom** — always the same, the largest of the
  sizes it used to take.

## 0.69.32
- **Physical cables are gone from the VLAN view.** The only lines in this cut are the
  whiskers leading to the bus that appears. Picking a VLAN used to light up the CABLES, so
  the loudest thing on screen was the one relationship this view is not about.
- **One VLAN, one colour everywhere.** Highlighting a VLAN now uses that VLAN's own colour
  rather than the generic accent, so the port ring, the whisker and the bus rectangle match.
- **The bus block no longer resizes as you zoom.** It follows the zoom only partly and
  within a narrow band: zoomed out the bus is bigger, zoomed in slightly smaller, but the
  difference stays small. More importantly, **once it appears its size is frozen** — you can
  zoom in and look closely. It is recomputed only when opened again.
- The rectangle now has a minimum and a maximum width: a bare VLAN ID is not squeezed into a
  stub, and a long name cannot stretch the block wider than the device it hangs over.

## 0.69.31
- **The VLAN bus moved from the bottom of the canvas onto the port itself.** In 0.69.30 it
  was a permanent row under all the content — under the racks, the pocket, the power block
  and the panels — with lines climbing back across half the schematic to reach it. The
  bigger the site, the worse it read.
- Now a member port is simply **ringed in its VLAN's colour**, and the bus appears on
  demand: click a port and its buses float right above it — one rectangle per VLAN, the
  name on the rectangle, joined to the port by whiskers (solid untagged, dashed tagged).
  **A second click on the same port** lights up every port on those buses.
- On a trunk the ring takes the **untagged** VLAN — there is only one and it is the port's
  home — while the tagged ones show as extra rectangles and whiskers. Clicking a single
  rectangle leaves just that VLAN on the schematic.
- The name is always visible and does not shrink with the schematic, so it reads on a phone
  the same way site and location labels do.
- For ports on a node's bottom row the block opens below — above them is the device body.
- **Cables are back in the VLAN view**: they were only removed to make room for that row.

## 0.69.30
- **The VLAN view now has a bus.** Each VLAN is a horizontal bar in a row under the schematic,
  and every port that belongs to it drops a line down to it — untagged solid, tagged dashed.
  The view used to draw ordinary cables, which answers "what is wired to what" — a question
  the physical view answers better.
- **A bar spans only its own ports**, so its width tells you at a glance whether the VLAN
  lives in one rack or crosses the whole room. Lines drop to the bar directly beneath their
  port, so the picture stays readable as the number of ports grows.
- **Every bus has its own colour**, computed from the VLAN ID — so it is the same on every
  reload. The gold ring on a port keeps its own meaning: "this port carries a VLAN", which
  is a different question from "which one".
- Clicking a bar leaves only that VLAN on the schematic — the same as picking it in the
  «Отображение» panel. Clicking a line in edit mode opens that port's VLAN form.
- Cables are no longer drawn in the VLAN view, the same way the wireless view shows only
  radio links.

## 0.69.29
- **The «Отображение» panel now lists only the layers of the current view.** It used to offer
  all of them at once, although a layer can only highlight what the view actually draws —
  clicking a "foreign" one silently switched the view and relaid out the schema. Now the VLAN
  view offers VLANs, the physical one console links and power, the wireless one radio links and
  circuits. The view switch itself stays where it was.
- A highlight left over from the previous view is cleared automatically — otherwise the schema
  would stay dimmed with no button left to switch it off.
- **The «View / Edit» toggle is back in the centre of the schema**, on the block title's line,
  instead of the top-right corner where it crowded the floating panels. On phones and tablets
  it stays hidden, as before.

## 0.69.28
- **A port with a VLAN is now marked by its border colour, not by a fill.** The fill was already taken — it means a cable is attached. Both facts are now visible at once: the fill speaks about the cable, the border about the VLAN.
- **Assigning a VLAN requires «Правка» mode.** In view mode, clicking a port that carries a VLAN highlights every port in the same group — the same thing selecting that VLAN in the «Отображение» panel does, but reached from the port itself. Clicking again clears it. On a port with no VLAN the highlight is cleared and the status says so.
- Leaving «Правка» clears the ports picked for assignment.

## 0.69.27
- **The «Создать VLAN?» block now appears above the last picked port** instead of midway between all of them. With ports picked across different racks it could previously land on empty space or on top of a device.
- For ports on a device's bottom row the block opens below the port — above it is the device body.

## 0.69.26
- **A port with a VLAN assigned is now filled in**, where before it was only outlined. The fill means the same thing it does for a cabled port: something is attached to it.
- **The «Создать VLAN?» block now looks like every other popup on the schema** (the port's link menu) — the same panel, the same buttons, no styling of its own.
- That block no longer shrinks with the schema when you zoom out — it reads the same at any zoom level.

## 0.69.25
- **VLANs can now be assigned right on the schema, to several ports at once.** In the "VLAN" view a click picks a port — it gets a red ring. Pick as many as you like; a block appears between them saying «Создать VLAN?» (or «Изменить VLAN?» if some already carry one). It opens the same form and applies it to every picked port in one go.
- **Ports are no longer pale in the "VLAN" view.** The dimming used to mean "no VLAN yet", so a site that had never used VLANs looked entirely washed out. Now only the patch panels' transit ports are dimmed, switch ports read normally, and the ones that do carry a VLAN get a coloured ring.
- The write is a single request and all-or-nothing: either every picked port gets the VLAN, or on an error none does — no half-configured batch left behind.
- With ports on several devices the list shows only VLANs available to all of them. If the ports also span several sites, a new VLAN is created as global — otherwise some ports could not accept it.
- The form shows what will change up front: the warnings count across every picked port, not just one.

## 0.69.24
- **Fixed the wires in the "VLAN" view** — every cable leading to a hidden port shot off to the top-left corner of the schema. Introduced in 0.69.23.
- **Patch panels are visible again in the "VLAN" view.** Removing them was a mistake: a panel carries no VLAN itself, but it is what takes a switch port through to a socket and on to the device — without it the chain broke in the middle. The view now hides only power and console, and ports with no VLAN are simply dimmed.

## 0.69.23
- **VLANs can now be assigned straight from the schema.** Every interface row in the device passport got a VLAN button: port mode (access — one untagged VLAN, trunk — tagged, trunk with all VLANs, Q-in-Q), the untagged VLAN and a searchable list of tagged ones. A missing VLAN can be created without leaving the form.
- The candidate list is the one NetBox itself offers for that device — scoped by site, location and rack. A new VLAN is tied to the device's site by default; the «общий» checkbox makes it global (what a trunk spanning sites needs).
- Interface rows now show membership at a glance: a «VLAN 20» chip plus «+N тег.».
- The form warns up front when NetBox would drop VLANs on save — switching a trunk to access, for instance, clears its tagged VLANs.
- **Fixed the "Слои" panel: its VLAN section was always empty.** The schema simply never sent the ports' VLAN fields, so the list permanently read «VLAN на портах группы нет». VLANs are now listed and can be highlighted.
- Picking a VLAN no longer dims every wire — the cables leading to that VLAN's ports stay lit.
- **A third schema view — "VLAN"** (next to «Физический» and «Беспроводной»). It keeps only network interfaces on devices: patch panels, sockets, power and console take no part in that cut and no longer clutter the picture. Ports with no VLAN are faded.
- **The view switch moved into the panel, now called «Отображение».** Views and layers used to live in separate blocks, and picking a layer (Circuits, say) silently changed the view — the schema relayouted for no visible reason. The switch now sits right above the layer list and visibly moves.
- VLAN highlighting also works in the physical view — unlike the other layers it never forces a view change.

## 0.69.22
- **Importing the power sheet now reports file inconsistencies** — the block used to be permanently empty: the same inlet on two rows, one feed/outlet feeding two consumers, a row with no consumer or inlet, a device powering itself. Such rows didn't import **silently** — now you see them in the preview before committing.
- Rows with missing fields no longer vanish: they stay in the preview, flagged with what's missing.
- If a source has no port named, the first sensible one is assumed («Фидер 1» for a panel, «Розетка 1» for a device) and the warnings say so.
- Trying to import the universal device list now gives a clear message (it is export-only) instead of a server error.

## 0.69.21
- **The audit now covers power:** devices with no supply (inlets not cabled), free outlets on PDUs and UPSes, panel feeds that lead nowhere, and panels with no feeds at all.
- **Learning is translated into English** — all 11 topics. The language comes from your browser; topic names, tabs and the dialog's own captions follow it too. Plugin button names stay Russian in the text — that's how they read in the UI.
- Clarified what the audit does: it scans the selected scope, it does not compare a file against the schema.

## 0.69.20
- The "node gap" slider now spreads **off-rack** devices too (it used to affect racks only). At the default value the layout is unchanged.
- Fixed the "Слои" panel going blank when the gap changed (the "Фильтры" panel and the wires are restored as well).

## 0.69.19
- **Power in Excel — its own sheet, both ways.** Export: the "Питание" format writes one row per power cable (panel+feed or device+outlet → device+inlet, with V/A). Import creates what's missing: panels, feeds, devices, ports and cables.
- The file layout is **detected automatically** on import (the preview shows which one); you can still pick it by hand.
- Re-importing the same file duplicates nothing; an inlet that is already cabled is never silently re-wired — it shows up in conflicts with its current source.
- The universal device list no longer drops power links (links coming from panel feeds used to vanish).

## 0.69.18
- Learning: the "Schema" topic gained a nodes section (ports, stack badge, the ⋮ menu); "Device model" — a scenario for per-node actions (⋮ → Model / Ports / Edit).

## 0.69.17
- Device height is governed by the **model**: the "Height, U" field in the catalog editor (applies to every device of the model; NetBox refuses when one of them lacks room). Multi-shelf click-selection in the rack is gone — a click places the device on that shelf, and it takes as many shelves as its model's height says.
- The "NU" column is gone from the catalog list (height shows in the editor and in the model picker at creation).

## 0.69.16
- "Features" became **Learning**: a topic tree on the left, mechanics explained with worked examples on the right (on phones the list comes first, a topic opens full-screen).
- "What's new" now reads the real changelog file and follows the user's language (ready for the upcoming language setting).
- The "· U1" unit tag is gone from schema nodes — the unit is visible in device details and in the rack view.

## 0.69.15
- Power inlet and outlets sharing one node row now stand apart from each other.
- The version badge became a button: what's new and learning.

## 0.69.14
- Every port row in the catalog got a side picker: auto / top / bottom. Applies to the preview immediately, to devices after "Save to type".

## 0.69.13
- PDUs, UPSes and stabilizers now distribute power through **outlets** (one round inlet). Device power ports plug into outlets — the chain panel → stabilizer → UPS → PDU → devices closes.
- Adding a device asks only for a name — ports come from the type's model (edited in the Catalog).
- Power rows (Power → Stabilizers → Power panels) stack under their server room, inside its contour.
- "Распредщиток" renamed to "Щиток".

## 0.69.12
- Feed ports on a panel are numbered 1..N (the feed name stays in its row).
- The "models without ports" warning is a visible block in the catalog, not a hover hint.

## 0.69.10–0.69.11
- Power equipment gathers into a "Power" block under the racks (not the right-side pockets).
- ⚠ on port-less «Схематика» models — in the catalog list and on the Catalog button.

## 0.69.7–0.69.9
- Applying a model matches ports by **number**: an occupied imported `eth1` becomes the model's "1", no duplicates; occupied ports keep their type — you get a warning instead.
- Fixed port selection on touch screens: the rings of the selected port and its targets are visible again.

## 0.69.0–0.69.6
- Mobile: tap tooltips, one tap — port and cable, second tap — the whole path; selection survives pan and zoom.
- Paths trace from peripherals through patch panels to the switch (all port kinds).
- Device catalog: own models, ports by kind, apply to all devices of a type or by role.
- Port tooltip shows the destination, port type and IP address.

## Earlier
- Excel import/export (Patched/Unpatched), connection audit.
- Switch stacks (VirtualChassis), Wi-Fi links, providers (Circuits).
- IPAM canvas: networks, prefixes, interface IPs, VLAN highlighting.
- Power: panels, feeds, power tracing.
