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

## 0.69.49
- **The ⋮ kebab menu is back to Порты / Модель / Изменить.** 0.69.44 added a trace-view menu
  and called its opener `_openNodeMenu` — a name `schema_nodes.js` had already been using for
  the kebab since long before. Both files are mixed into ONE prototype and `InteractMethods`
  is applied LAST, so the new method silently replaced the old one and every kebab opened a
  menu with a single «Скрыть». Renamed to `_openTraceNodeMenu` / `_closeTraceNodeMenu` /
  `_traceMenuDev`.
  Worth remembering: these six mixin files share a single namespace, and nothing — not the
  linter, not `node --check` — says a word when two of them claim the same method name. The
  harness now builds its stub manager with the same mixin ORDER as `schema.js` for exactly
  this reason; with the files applied in any other order the collision would not reproduce.
- **A tapped node is outlined green**, the way a tapped port is ringed — so which node the
  «Скрыть» menu is about is a fact on screen, not an inference from where you last touched.
  Same `--ok`, no scale: a node is a card, and resizing it would drag its ports, wires and the
  menu anchored to it along with it.
- **The VLAN pick block matches the link menu**: ✕ (dismiss) · «Изменить/Создать VLAN?» ·
  trash. Two popups on one canvas should not read in opposite directions.
- **The trash strips every VLAN off the picked ports** — `vlanform.clearBulk`. It asks first
  (this is the only VLAN write with no dialog in front of it), skips ports that carry nothing,
  and shows up only when the selection has something to remove. The payload still sends
  `mode: null` explicitly and clears `qinq_svlan`, for the reasons in the vlanform header.
- Save and clear now share one `_write(targets, rowFor, doneWord)`: single PATCH for one port,
  the bulk list endpoint for several, mirror the answer back, repaint. Two paths that refresh
  the canvas differently is a bug waiting for a quiet afternoon.
- Verified in a DOM harness: the kebab opening with its three items and the trace menu living
  under separate names; the node outline moving between nodes, clearing on close, and
  computing to a 2px `--ok` outline; the pick block's buttons in `[x, go, rm]` with the trash
  gated on `anyVlan` and wired to `clearBulk`; and `clearBulk` confirming, filtering, sending
  the null payload and going through the shared `_write`.

## 0.69.48
- **The user-facing changelog collapses 0.69.42–0.69.48 into one entry.** Six versions in a
  row each said a variant of "the tap on a phone is fixed now", which is an accurate history
  and a terrible thing to read: it tells the user the same bug six times and never says what
  the behaviour finally IS. The in-app entry now leads with the outcome, lists the three
  causes underneath as one story, and keeps the genuinely separate items as bullets.
- The developer log below is deliberately NOT collapsed: each of those versions records why a
  fix that looked right did not work, and that is exactly what this file exists for.

## 0.69.47
- **Static files are versioned: `?v=<plugin version>` on every CSS and entry-point JS.** The
  plugin has no build step and ships raw files under stable names, so after a deploy a
  browser could keep serving the previous stylesheet — and did. That is almost certainly what
  the last report was: the 0.69.46 CSS fix is provably in place (see below), so a phone still
  showing the old behaviour was still running the old CSS.
- Caveat, stated rather than papered over: this fully covers the CSS (all five files are
  linked directly) but only the JS ENTRY points. `main.js` imports its modules by relative
  path, and those requests carry no query — busting the whole module graph needs a build step
  the project deliberately does not have. JS has been updating correctly in practice, so this
  is a known edge, not a live problem.
- Re-verified the 0.69.46 fix by computing the CASCADE rather than eyeballing selectors: for a
  `.port.tap-hl` element in the `:hover` state, every rule in every loaded stylesheet that
  could set `box-shadow` or `transform` was collected, ordered by specificity and source, and
  the winner examined — desktop and with the mobile media queries forced on. In both cases
  exactly one rule applies, `.port.tap-hl`, and it wins. Nothing left can blank the ring.

## 0.69.46
- **The green ring was being applied and then blanked by the hover rule.** 0.69.45 got the
  class onto the port at the right moment; what nobody had told the stylesheet is that
  `.tap-hl` is a STATE. `.port:not(.hl):not(.pending):not(.aim-ok):hover` exists precisely to
  strip the plain hover ring from ports that have a ring of their own — its own comment lists
  them — and `.tap-hl` was simply never added to that list. On touch a tap leaves the port in
  a STICKY `:hover`, and the mobile variant of that rule sets `box-shadow: none`, so the ring
  was erased for exactly as long as the finger's hover stayed on the dot. Press somewhere
  else, the hover moves, the ring appears — which is the behaviour reported, to the letter.
- One `:not(.tap-hl)` added to both copies of the rule (`schematic.css` and the
  `@media (hover: none)` override in `responsive.css`). Nothing else changed.
- Verified in a DOM harness reading the RULES back out of the live stylesheets: both
  hover-suppressing rules now carry `:not(.tap-hl)`; a plain port still matches them (that
  suppression is still wanted), while a tapped and a traced port no longer do; and at rest
  `.tap-hl` and `.hl` compute to the same shadow.
- Harness note, for the next person who reads CSS through the CSSOM: in current Chrome a
  plain `CSSStyleRule` also has a (empty) `.cssRules`, because of CSS nesting. A walker that
  tests `if (r.cssRules) recurse()` before reading `selectorText` therefore descends into
  every style rule and finds nothing — which is how the first run of this harness "confirmed"
  a fix it had not looked at.

## 0.69.45
- **The extra tap on touch, root cause found.** A touchscreen browser treats the first tap on
  an element that reacts to hover as the HOVER, and swallows the click behind it — the
  "tap twice to activate" rule. A port qualifies twice over: `.port:hover` scales it
  (`schematic.css:1137`) and its `mouseenter` draws the tooltip. So tap one showed the tip and
  nothing else, because everything real hung off `click` — the ring, the bus, the whole
  gesture. Every "it needs one more tap than it should" report in the last several versions
  was this, and each time I fixed a symptom one layer up.
- **Touch is now driven from `pointerup`**, which is delivered regardless, and the click that
  may or may not follow is dropped if it lands within 900ms of a tap already served — so the
  bus cannot advance two steps on one tap. Mouse is untouched: a `pointerup` with
  `pointerType: "mouse"` does nothing, `click` still does the work.
- The three things a tap does — ring, tooltip, port action — moved into one `act(ev)` so both
  entry points cannot drift apart.
- Verified in a DOM harness driving the REAL `_placeDot`: a touch `pointerup` performing the
  action once and lighting the ring immediately; a synthesized `click` right after it changing
  nothing; a mouse `pointerup` doing nothing while `click` works; a genuine second tap a
  second later still going through; and the `:hover` rule that causes the swallow quoted back
  out of the stylesheet.

## 0.69.44
- **Tapping ANY port lights it green** — free ports included, in every view. The only green
  ring that existed was `_portHover`'s, and that one lights the two ends of a CABLE: a port
  with nothing plugged in answered a tap with nothing at all, and on touch there is no hover
  to fall back on, so a missed tap and an empty port looked identical. New `.port.tap-hl`,
  one at a time, cleared by tapping elsewhere or on empty canvas.
- It is its OWN class, not `.hl`: the hover/trace highlight adds and removes `.hl` in pairs
  (both ends of a link), so sharing one class had the two erasing each other. They share the
  CSS rule — it means the same thing to the eye — but not the ownership. `_markVlanBusPort`
  now delegates to the same marker instead of driving `.hl` itself.
- **A trace node can be hidden from a menu on the node itself.** Tap a node's body in the
  single-device view and a `.portmenu` popup offers «скрыть» → the same `removeTraceNode`
  the corner ✕ calls (node plus everything opened through it). Not on the root, and not
  until the chain has actually grown. Closes on a pan or a click elsewhere, like the link menu.
- **Found one reason the corner ✕ can be invisible:** it sat at `z-index: 7`, and the VLAN cut
  lifts the wire layer to 25 (it has to — a link to a bus below its port crosses the node
  body), so the button was painted UNDER the lines. Still clickable, since they are
  `pointer-events: none`, but not findable, which amounts to the same thing. Now 27. Whether
  that was the whole story I could not confirm without the live app — the menu above does not
  depend on it either way.
- **The bus caption is always light.** It inherited the page's text colour, so it came out
  black on one bus and white on the next: the bar is a different hue per VLAN and a different
  lightness per theme. Now `#fff` with a shadow that carries it over the pale ones, and the
  tagged bar's tint went 30% → 55% so it can hold white text — the dashed border still marks
  it as tagged.
- Verified in a DOM harness: a cable-less port ringing on tap, exactly one ring at a time,
  cleared on an empty tap, sharing the rule `.port.hl, .port.tap-hl` and called from the dot's
  click with no cable condition anywhere near it; the node menu opening, remembering its
  device, closing, wired to `removeTraceNode`, gated on non-root plus a grown chain, and
  dismissed on pan; the ✕ at 27 over wires at 25; and all three bar kinds reporting
  `rgb(255,255,255)` with a text shadow.

## 0.69.43
- **The third tap in the single-device view, found properly this time.** 0.69.42 fixed the
  handlers (they read `state.viewMode` live, so they were fine) but not the TOOLTIP: it was
  bound or skipped at dot-CREATION time, and the trace view does not rebuild its dots the way
  the area view does — so the binding made in the physical view survived the switch to VLAN
  and kept eating the first tap. `attachTip` now takes an optional `skip` predicate evaluated
  at SHOW time, and the port passes `() => state.viewMode === "vlan"`. A decision that can go
  stale should not be made at bind time; this one now cannot.
- **The link menu closes when the canvas moves.** It is `position: fixed` at the cursor, so
  any pan leaves it aimed at whatever slid underneath — and on touch, panning is how you get
  anywhere. Any scroll of the pane dismisses it. Losing the menu costs a tap; keeping it
  pointed at the wrong cable costs a cable.
- **The bottom sheet has a real header now.** The grip was a sticky `::before` INSIDE the
  scrolling panel: content still passed behind it and showed through the rounded corners.
  `responsive.js` now wraps each panel once at startup into `.sheet-wrap > .sheet-grip +
  #detail` — the wrapper is the sheet (fixed frame, `overflow: hidden`), the grip is a real
  row in it, and the panel scrolls inside, strictly below. Once at startup because every
  panel writer replaces `#detail.innerHTML` wholesale. On desktop the wrapper is
  `display: contents`, so it disappears from layout and `#detail` stays the 330px flex
  column it always was; the tablet side-sheet turns the same frame into a row with the grip
  as its left column. The swipe-to-close now moves the wrapper, with the panel as its
  scroller.
- **The stack badge opens the sheet on a phone.** Adding `.stack-badge` to the delegated
  selector in 0.69.42 could not work: the badge's own handler calls `stopPropagation`, so the
  click never reaches that listener. Panels that are opened from such a handler now raise the
  sheet themselves (`_raiseSheet`), which is inert on desktop.
- Verified in a DOM harness: one tooltip binding showing in the physical view, staying silent
  in the VLAN view and speaking again on the way back — the same element throughout, never
  rebuilt; the pane-scroll close; the wrapper/grip/panel order with `display: contents` and a
  330px `#detail` on desktop, `overflow: hidden` on the frame and `auto` on the panel, and no
  `::before` left anywhere; and all three `_raiseSheet` call sites.

## 0.69.42
- **The VLAN cut was inert in the single-device view** — which is the view a phone lives in.
  `_onPortClick`, `_portHover` and `_onPortDblClick` all guarded their VLAN branches with
  `&& !state.single` ("there a port click grows the chain"), so on one device a tap gave a
  tooltip and a new neighbour node and never a bus, never a ring, and needed a third tap to
  get anywhere. That is the "still three taps on mobile" report: not a regression in the fix,
  a screen the fix never reached. All three guards now key on the view alone; growing the
  chain stays the physical view's job.
- **«Правка» is dropped on the way into a single device.** Edit mode belongs to the AREA you
  were building and it survived the switch, where the same click means something else (a port
  PICKS a VLAN instead of opening its bus) with nothing on screen saying why.
- **The ✕ in the link menu no longer deletes the link.** A destructive action with no undo
  sat behind the one glyph every other panel on this canvas uses to dismiss itself. ✕ now
  closes; deleting moved to its own trash button right of «перевесить», and the red hover
  moved with it.
- **Port dots hang further out** — `PORT_OUT` -13 → -16px. With DOT at 19 (0.69.41) six
  pixels of circle sat on top of the «ИНТЕРФЕЙСЫ» / «ПИТАНИЕ» captions; the row labels also
  stepped 2px inward. ~4px of dot still overlaps the body, enough to read as attached.
- **`.stack-badge` opens the bottom sheet on a phone.** It fills `#detail` through
  `device.showStack`, but was missing from the delegated selector in `responsive.js` that
  raises the sheet — so the panel filled behind a closed sheet and the tap looked dead.
- **The sheet's grab handle is its own bar**: opaque fill, a rule under it and 6px of margin,
  so what scrolls reads as a separate block below rather than content sliding beneath a strip.
- **Chrome is no longer selectable** — «Vw», panel captions, row labels, port numbers, menu
  buttons, the bus bar. Text that IS text keeps its selection: the detail panel, tooltips,
  inputs, and a node's body (which has a deliberate click-to-select).
- Verified in a DOM harness: the dot clearing the caption by 2px while still touching the
  node; all three VLAN guards keyed on the view with zero `&& !state.single` left; the forced
  mode drop; the menu's three buttons in order with delete on `.rm` and ✕ wired only to
  `_closeLinkMenu`; `user-select: none` on four chrome probes and `auto` on the detail panel;
  and the handle's four properties.

## 0.69.41
- **The tapped port wears the green ring again** — the SAME `.port.hl` the physical view
  puts on a hovered cable end, no new style. 0.69.39 removed hover highlighting from this cut
  (it lit a cable's far end, which the cut does not draw); what it took with it was the only
  confirmation that a tap had landed on the dot you aimed at, and on a phone there is no
  hover to fall back on. Now exactly one port wears it: the bus's anchor. Cleared on close
  and re-applied after a relayout, so a rebuilt dot cannot leave a ghost behind.
- **Two taps, not three.** On touch the port tooltip is pinned and needs its own dismissal,
  so it ate the first tap of a two-tap gesture. The VLAN cut now has no port tooltip at all:
  it answers on click, and the block that opens already names the VLAN and its mode.
- **Bigger port dots** — `DOT` 16 → 19, `STEP` 21 → 24 (kept in step so the gap between dots
  grows too, 5px instead of 5px at the old size), font 9.5 → 10.5px. The dot carries the port
  NUMBER, and at 16px a two-digit number sat wall to wall. The CSS width and `core.js` DOT
  must stay equal — the row pitch is computed from the constant, the circle is drawn from the
  stylesheet, and the harness now asserts they match.
- **The sliding bus caption keeps a real margin** from the bar's ends and from the viewport
  edge: 9px → 14px (`CAP_EDGE` / `CAP_PAD`, measured 18px on screen at 1.3× block scale).
- **Device cards are centred** — icon, name, model. The off-rack card was left-aligned, and
  the single-device (trace) view draws EVERY device as that card, so the same switch looked
  one way inside a rack and another way opened on its own.
- **«Отображение» now exists in the single-device view.** The trace wiped the whole overlay
  as "area controls", but the physical/VLAN/wireless switch is the only way to look at that
  device's L2 — and on a phone the trace view IS the schema. The scope-wide controls (role
  filter, palette, legend) stay out; the panel renders after `_layoutNode`, so it lists what
  the device actually carries instead of rendering empty.
- Verified in a DOM harness: the ring moving between ports and never doubling, and clearing
  on close; both tooltip guards present; DOT/STEP/CSS agreeing with a two-digit number
  fitting; an 18px caption margin; the card's content symmetric to the pixel (96/96); and the
  single-view overlay carrying `#layers` with `collapsible` bound, `renderPanel` after the
  layout, and no role filter or palette. The ring's PAINT is not machine-checked here — the
  preview pane does not composite, so a CSS transition never advances; the rule itself is the
  physical view's, untouched.

## 0.69.40
- **A wide bar's name now SLIDES along the visible part of the bar**, the same trick the
  place captions use on «Сети» (`ipam._stickTitles`) and for the same reason: a bar stretched
  across two racks is wider than the viewport, so a name centred on it sits off-screen most
  of the time. The name moved into its own `.vb-cap` span; `_stickVlanCaps()` pins it to the
  left edge of the viewport once the bar's own left edge scrolls past, and stops it at the
  bar's right corner — it never leaves the bar. When the visible remainder is narrower than
  the name itself, the corner is where it stays; nothing can do better than that.
  rAF-throttled off the pane's `scroll`, `resize` and `applyZoom`. CSS `position: sticky`
  cannot do this: the canvas transform breaks it, which is the note `ipam.js:118` already
  carries.
- Collapsed bars keep the name in the flex centre (with its ellipsis); only `.wide` takes it
  out of flow — the wide bar's width comes from the ports it spans, not from its text.
- **Tapping a bus on a phone opened nothing.** The bar's click handler called
  `stopPropagation`, and the bottom sheet is raised by a DELEGATED document-level listener in
  `responsive.js` matching `.vbus` — so the panel was filled and never shown. The handler no
  longer swallows the event; the outside-close listener already ignores clicks inside
  `#vlanbus`, and the only other listener in the path (`pane` click, schema.js) just clears a
  stack highlight when the target is not a node.
- **The racks pane always starts collapsed.** It was collapsed by default already, but the
  state was remembered in `localStorage` — so a single visit to a rack left the pane taking a
  third of the schema on every load afterwards, with nothing to point at as the cause. The
  toggle still works for the session; only the memory is gone, and the stale key is removed
  so an old `"0"` cannot bring the behaviour back.
- Verified in a DOM harness with a 1262px bar in a 420px viewport: the caption fully visible
  at four scroll positions and pinned to the bar's right corner at the fifth (where only
  119px of bar remained against a 282px name), never leaving the bar, and actually moving;
  a click reaching `document` AND opening the panel; and the racks constructor reading no
  `localStorage`, collapsing unconditionally, and clearing the old key.

## 0.69.39
- **The green hover ring was never about tags — it was about CABLES.** `_portHover` lights
  the two ends of the hovered port's cable (`.port.hl`, `--ok` green). The VLAN view draws no
  cables, so it rang a far-off port with nothing visibly joining it, and only on ports that
  happen to be cabled — which reads as "some VLAN ports react, others don't" with no rule
  behind it. It correlated with untagged because access ports are the cabled ones. Hover in
  this cut is now the plain CSS one; L2 questions are answered on click.
- **Clicking a bus bar opens the VLAN's own detail panel** — every interface on it, grouped
  by device, each marked «без тега» / «тег.», with a chip summary on top. The bar has carried
  `cursor: pointer` since it was built with nothing behind it. The canvas answers *where* (a
  ring on a dot, an outline on a node); *who* is a list, and hunting rings one by one is the
  worst way to read it. A device heading opens that device's own passport.
- **A wide bar no longer clips its own name.** `.vbus.wide` dropped `max-width` in 0.69.37
  but kept `overflow: hidden` + `text-overflow: ellipsis`, so a long VLAN name still ended in
  «…» on a bar 600px wide. The clip comes off with the cap.
- **«VLAN» moved next to «Физический», «Беспроводной» went last** in «Отображение». The
  segment is one row in a 240px panel, so the longest label belongs at the end where it has
  the panel edge to grow into.
- **«Отображение» now exists on phones.** It was in the blanket "floating controls not needed
  on mobile" hide, together with the role filter and the legend — but it is the only way to
  reach the VLAN and wireless views at all, and a phone is exactly where you cannot fall back
  to a second monitor. Narrower (208px), taller body, and 7px row padding for fingertips; the
  role filter and legend stay hidden.
- Verified in a DOM harness: the view order; a wide bar computing `max-width: none` /
  `overflow: visible` / `text-overflow: clip` with `scrollWidth <= clientWidth` while the
  collapsed one keeps its ellipsis; `showVlanPanel` on 3 members across 2 devices producing
  the right heading, subtitle, alphabetical device order, 3 rows, 1 tagged + 2 untagged chips
  and a summary chip carrying `hsl(342 …)` — VLAN 666's own hue; and the responsive rules,
  with `#layers` out of the hide list while `#rolefilter` and `#legend` stay in it.

## 0.69.38
- **Every link now meets a port at its RIM, not its centre** — cables, radio links, panel
  feed lines, trace curves and trace whiskers, not just the VLAN bus. New shared
  `portAnchor(port, cx, cy)` in `schema_util.js`, applied at the five places coordinates are
  taken from a port element: `_wireEnds` (the whole cable path), `drawRadioLinks`,
  `_drawFeedWires`, `_traceCablePath` and `_whisker`.
- **Nothing re-routes.** A port already knows which way it faces — `side` is the node edge it
  sits on, and every route leaves perpendicular to that edge (the router's own convention:
  `p.side === "t" ? -1 : 1` appears verbatim in `_traceCablePath` and `_whisker`). Moving an
  endpoint out along that same normal shortens the line without bending it. In
  `_traceCablePath` the facing tests, the control points and the lane x stay measured from
  the CENTRES and only the two drawn endpoints move; same for `_whisker`, whose fade
  gradient still spans the original length.
- **Where this is visible:** with the wire layer BELOW the ports — the default — the dot
  already covered the last few pixels, so nothing changes. It shows in the two places the
  layer is lifted: the «провода поверх портов» toggle (`#wires.above-ports`), where every
  cable used to be drawn across its port's number, and the VLAN view, which has to lift the
  layer so a link crossing a node body stays visible.
- The VLAN bus keeps its OWN anchor (by direction of travel, not by side) and now says why:
  a bus can open on either side of its port regardless of which node edge that port sits on,
  so a side-based anchor would start the line on the far side of the dot and draw it back
  across.
- Verified in a DOM harness driving the real mixins: `portAnchor` on all five side values
  plus the missing-element fallback; `_wireEnds` moving a `t` port's end 9px up and a `b`
  port's 9px down (the real 16px dot) with x untouched and the end clear of the dot;
  `_drawFeedWires` moving a left-face feed 9px left with y untouched; and the 0.69.24
  detached-port guard still dropping a cable whose end left the DOM.

## 0.69.37
- **Lines leave the port at its EDGE, so they stop covering its number.** Since 0.69.36 the
  wire layer sits above the nodes (it has to — a link to a bus below its port crosses its own
  device), which put every line's anchor point squarely on top of the digit. The requested
  fix — ports above the wires, nodes below — cannot be built: `.node` is positioned WITH a
  z-index, so it is a stacking context, and a dot inside it can never paint above a layer
  outside it whatever z-index the dot is given. Anchoring at the rim instead gets the same
  picture with no layering at all: the line starts 1px clear of the ring, on the side it is
  travelling towards.
- **Widening no longer SHRINKS the bar.** The wide bar spans its member ports — and for a
  VLAN whose ports sit side by side (three adjacent ports on one switch) that span is
  narrower than the VLAN's own label, so the click that means "show me more" visibly made the
  block smaller. The span is now a floor, not a width: below the collapsed size the bar keeps
  its size and just centres on the span.
- **Panning keeps the selection.** The close-on-outside-tap listener fired on pointerDOWN, and
  dragging the schema starts with a pointerdown on empty canvas — so every pan threw away a
  widened bus, which is exactly what you want to keep while moving around to look at it. The
  decision now waits for pointerUP and only closes if the pointer travelled ≤4px.
- Verified in a DOM harness: the stub starting 1px above a dot whose top/centre/bottom are
  315/320.5/326; a three-adjacent-port VLAN staying 139px through the widening click with all
  three links still landing on the bar, while a two-node VLAN still stretches 135→622px; and
  the three gestures — a still click closing, a 41px drag keeping the block open with the
  highlight intact, a 3.6px jitter still counting as a click.

## 0.69.36
- **A link running DOWN from a port used to disappear into the node.** `#wires` sits at
  z-index 1, nodes at 3 — fine for cables, which run between ports and never cross a body,
  but a port whose bus is below it draws straight through its own device. `body.view-vlan
  #wires { z-index: 25 }` lifts the layer in this cut only (which draws no cables at all, so
  there is nothing to reorder against), reusing the value `.above-ports` already uses. The
  bus block at 30 still wins, and the paths are `pointer-events: none`, so nothing under
  them becomes unclickable.
- **One VLAN, one colour, everywhere it is NAMED.** The canvas gave each VLAN a VID-derived
  hue while the «Отображение» list drew every VLAN with the same accent dot and the passport
  chip did the same — the same object described two ways in two places. The list dot and the
  untagged passport chip now take the VLAN's own colour.
- The "+N тег." chip deliberately stays muted: it stands for several VLANs at once, and any
  single colour on it would be a claim that isn't true.
- `device.js` repeats the hue formula instead of importing it — it must not depend on the
  schema mixin, and the formula IS the definition of the colour, so it lives in both places
  or in neither. The harness asserts the two agree.
- Verified in a DOM harness: layer order 25 > 3 with the block still at 30 and the svg still
  click-through; two links from a bottom-row port running down past the node body; ring, bar
  and both copies of the formula agreeing on VLAN 534 (`hsl(258 70% 58%)`); the chip taking
  that colour and the tagged chip staying muted; and the layer dropping back to z-index 1
  outside the VLAN view.

## 0.69.35
- **The second click now marks the DEVICES on the bus, not just their ports.** A port is an
  11px circle; on a rack of 48-port switches the answer to "who is on this VLAN" is read off
  the nodes long before anyone counts dots. Every device with a member port gets the outline
  (`.node.layer-hl`, so it takes `--layer-color` — which since 0.69.34 is the VLAN's own
  colour), everything else dims. Same classes the layer manager already puts on nodes, so
  `layers.clear()` takes them back down for free and no new CSS was needed.
- Device ids are collected during the port sweep that was already running, and matched as
  STRINGS against `state.nodeEls` keys — power panels register a synthetic `"panel-<id>"`
  dev, so a numeric comparison would be a silent type mismatch waiting for the first bus
  that reaches one.
- Verified in a DOM harness with four nodes: untouched after the first click; after the
  second on a trunk, the source node and both far nodes outlined with the fourth dimmed;
  after a second click on a single-VLAN port, only the two nodes actually on that VLAN;
  cleared on close; restored after a simulated relayout that stripped every class; and clean
  again on leaving the view. The resolved outline colour was the VLAN's hue, not accent.

## 0.69.34
- **The VLAN highlight could not be dismissed.** `_highlightVlans` paints `layer-hl` /
  `layer-dim` by hand, outside the layer manager — the manager holds one VLAN at a time and
  a trunk needs several — but nothing else knew it had. Clicking empty canvas closed the
  block and left the whole schema dimmed with no way back; only re-opening and cycling to
  the third click cleared it. `_hideVlanBus` now takes its own highlight down, so every
  route out (empty canvas, third click, view switch) ends the same way.
- **A relayout used to drop that highlight silently.** The dots are rebuilt as new elements,
  so the classes went with the old ones while the bus stayed open and wide. `_paintVlanPorts`
  now repaints it along with re-anchoring the block.
- **A double click no longer traces in the VLAN view.** `_onPortDblClick` fired the physical
  path highlight — links, ports, node outlines — on top of a cut that has its own click
  language. And since a double click always arrives right behind the second single click,
  the trace landed on *every* attempt to widen a bus, which is where the stuck cyan halos in
  the report came from. Guarded off for the VLAN view (trace/single view keeps it: there a
  double tap is how you walk the topology).
- **The highlight takes the VLAN's colour.** `_highlightVlans` sets `--layer-color` itself
  now; without it the halo fell back to accent, so a lit port read cyan standing next to its
  own green or purple bus. That was the other half of the same screenshot.
- Cut stubs are longer — 26px instead of 14, with a slightly wider fan for a trunk.
- Verified in a DOM harness against a stand-in layer manager: 26px stubs; `--layer-color`
  equal to the VLAN's own hue after the second click; closing the block clearing 4 lit + 1
  dimmed port, the body flag and the colour, with `layers.clear()` actually called; the
  third click doing the same; a simulated relayout (every dot replaced) keeping the block
  open, wide, and re-lighting the same 4 ports; and the view switch clearing everything.

## 0.69.33
- **The bus label is the THEME's colour, not the bus's** — `--vbus-fg`, white on dark and
  black on light. It used to be a fixed near-black chosen to sit on a saturated rectangle,
  which is a rule that only holds while every bus is bright; the rectangle already carries
  the VLAN colour, so the text only has to be readable. Tagged bars now take it too (they
  were painting the label in the bus hue, on a tinted background of the same hue).
- **A second click stretches the bar across everyone on the bus and joins them all to it.**
  Before, the second click only lit the ports up — which told you WHO but left the bus
  hanging over one port as if it belonged to it alone. Now the bar spans from the leftmost
  member to the rightmost, so its length is the VLAN's reach across the schema, and each
  member draws its own link. A third click closes: one port cycles bus → whole bus → off.
- Each VLAN of a trunk stretches over ITS OWN members, so two bars over one port can have
  different lengths — that difference is the point (VLAN 20 reaching a third rack while
  VLAN 10 stops at the second is visible without reading a single label).
- **Cut stubs on every member port, always.** A short line going nowhere says "this port is
  on a bus" without drawing a bus for every port; a port on several VLANs fans one stub per
  membership, so a trunk reads as a trunk before it is opened. Ports already joined to an
  open bar don't also get a stub — `_drawVlanBusWhiskers` builds the joined set first and
  the stub pass skips it. Closing the bus redraws them, since the stubs belong to the ports
  and not to the block.
- **The block no longer answers the zoom at all** — fixed at 1.3, the top of the band it
  used to move through. The damped-and-frozen scheme of 0.69.32 was still a rule you had to
  learn; one constant size is one less thing happening on the canvas.
- Bars are now absolutely positioned inside a zero-size scaled anchor, so the same code
  places them centred on a port or stretched across a span; `max-width` lifts in the wide
  state, where the width IS the message.
- Verified in a DOM harness: theme colours in both themes and on a tagged bar, one constant
  scale across zoom 0.3/1/2.5, five stubs closed (a trunk contributing two, a VLAN-less port
  none) at 14px each, narrow bars on the first click, and on the second — VLAN 10 spanning
  41…483px over its three ports, VLAN 20 spanning 41…862px over its two, all five links
  landing on their own bar, 4 ports lit and 1 dimmed, then a third click closing and
  restoring exactly the five stubs.

## 0.69.32
- **Physical cables are out of the VLAN view.** 0.69.31 put them back on the argument that
  the row was gone so the reason was gone — wrong reason. On a real site the highlight made
  the case: picking a VLAN lit the CABLES in accent cyan, three glowing lines shooting past
  a purple bus block, and the loudest thing on screen was the one relationship this cut is
  not about. The only lines here now are the ones leading to an open bus.
- **One VLAN, one colour, everywhere.** `--layer-color` for a VLAN layer is now that VLAN's
  own hue instead of the generic accent (`layers.js`, resolved through `_collectVlans` →
  `schema._vlanColor`), so the port ring, the whisker and the bus rectangle finally agree.
  That mismatch — cyan ring over a purple bus — was the other half of the screenshot.
- **The bus block no longer resizes under the zoom.** A straight `1/z` counter-scale pins it
  to a constant SCREEN size, which sounds right and isn't: zooming in to look closer shrinks
  it against the schema, so the gesture that should show you more shows you the same. Now
  the response is DAMPED (`scale = (1/z)^0.4`) and clamped to 0.9…1.3 — zoomed out the block
  is big enough to find, zoomed in it steps back a little, and the label never changes size
  enough to look like a different element.
- **And it is frozen once shown.** Whatever scale it opened at, it keeps until it is closed:
  the point of zooming into an open block is to inspect THAT block, and one that rescales
  mid-gesture defeats it. Recomputed only on a fresh open, or when a different port is
  clicked. Relayouts (which re-anchor the block on the rebuilt dot) preserve it.
- **The rectangle is bounded both ways** — `min-width: 104px` so a bare VID is not a stub,
  `max-width: 240px` with ellipsis so a long VLAN name cannot grow wider than the node it
  hangs over.
- Verified in a DOM harness: scale across six zoom levels (1.3 at 0.25× down to 0.9 at 3×,
  a 1.44× total spread, on-screen size still growing with zoom-in), frozen across a zoom
  from 1 to 3 and back to 0.3 and recomputed on reopen, width clamped at both ends, and ring
  = bus = whisker colour for the untagged VLAN with a second hue for the tagged one.

## 0.69.31
- **The VLAN bus moved off the bottom of the canvas and onto the port.** 0.69.30 drew it as
  a permanent row under everything — and under everything means under the racks, the pocket,
  the power block and the panels, with lines climbing back up across the whole schema to
  reach it. The bigger the site the worse it read, which is the opposite of what a bus is
  for. Reported from a real site, and the screenshot made the case on its own.
- The deciding argument is what a bus actually IS here: **nothing**. NetBox has no bus model
  — membership lives in `untagged_vlan` / `tagged_vlans` on the interface. The bar was pure
  drawing, and a permanent fixture that costs every port a cross-canvas line has to earn its
  place with more than that. `virtualization.md` §7 does say the Virtualization canvas
  reuses the bus, but what it reuses is the IDEA; that canvas lays out clusters, not racks,
  so the row itself was never going to survive the trip.
- **Now: a member port is ringed in its VLAN's own colour** (`_paintVlanPorts`), and the bus
  appears only when asked — click a port and its buses float above it, one named rectangle
  per VLAN, joined to the port by whiskers (`_drawVlanBusWhiskers`). Solid untagged, dashed
  tagged. A second click on the same port lights up every port on those buses.
- **Trunk ports:** the ring takes the UNTAGGED VLAN — there is at most one of it and it is
  the port's home — while the tags show up as extra rectangles and extra whiskers, so a
  trunk reads as "several" the moment it is opened. On a second click a trunk highlights
  every port sharing ANY of its VLANs (`_highlightVlans`, painting the layer classes
  directly, since the layer manager holds one VLAN at a time); clicking a single rectangle
  narrows it back to that one VLAN through `layers._toggle`.
- **The name sits ON the rectangle** — not a tooltip, not hover-gated — and the block is
  counter-scaled against the canvas zoom, so it reads the same on a phone (where the schema
  is always zoomed out) as on a desktop. That is the rule site and location labels follow.
- The block flips BELOW the port on a node's bottom row, where "above" is the node body —
  the same rule `_showExpandBtn` and the VLAN pick block already follow.
- **Cables are back in the VLAN view.** They were removed in 0.69.30 only to make room for
  the bus row; with the row gone the reason went with it, and 0.69.24 had restored patch
  panels to this cut precisely so the chain from switch port to socket stays visible.
- Whiskers are redrawn from `redrawWires` (which wipes the svg on every zoom/pan/filter) and
  the block is re-anchored from `_paintVlanPorts` after a relayout replaces the dot it hangs
  off. Both resolve the port from `state.ports` by KEY and check `isConnected` — the 0.69.24
  trap, where a kept element reference measures as 0,0 and reads as a real coordinate.
- Verified in a DOM harness on the real module: per-VLAN rings with an unpainted VLAN-less
  port, 3 rectangles + 3 whiskers (2 dashed) for a trunk of untagged 10 / tagged 20 / q-in-q
  30, the block above a top port and below a bottom-row one, whiskers landing on their bars,
  second click highlighting 5 ports and dimming 1, a single-VLAN port routing through
  `layers._toggle`, and a full teardown (block, whiskers, rings) on leaving the view.

## 0.69.30
- **The VLAN bus lands** (`schema_vlanbus.js`, new mixin) — the last item of the VLAN axis
  and the thing `virtualization.md` §7 gates the Virtualization canvas on. Each VLAN is a
  horizontal bar in a row under all canvas content; every member port drops a line to it,
  **untagged solid, tagged dashed** (Q-in-Q's service VLAN counts as tagged — an outer tag
  is still a tag). Until now the VLAN view drew ordinary cables between L2 ports, which
  answers "what is wired to what" — a question the physical view already answers better.
- **A bar spans only its own members**, not the canvas. That makes its width a readable
  fact: whether the VLAN sits in one rack or crosses the room. Lines land on the bar
  directly under their port (clamped 6px inside the rounded ends), so the drops stay
  near-vertical and the picture stays legible as membership grows.
- **Colour per bus, derived from the VID** (`hsl(vid * 47 % 360 …)` — 47 is coprime with
  360, so consecutive VIDs land far apart instead of shading into each other). Stable
  across reloads, which a hash of the name or an allocation order would not be. `--vlan`
  (gold) keeps its own job on the port dot: "carries some VLAN" is a different question
  from "which one", and one token cannot answer both.
- **Cables are gone from the VLAN cut** — `redrawWires` now branches to `_drawVlanWires`
  and returns, exactly as the wireless view branches to `drawRadioLinks`. Both cuts make
  the same trade: draw the relationship the view exists for, and leave the physical one
  to the physical view.
- **Geometry is measured from the DOM, not from the render pre-pass.** Power panels can
  read `this._locOrder` / `_colX` / `g.rackBottom` because they only ever run inside
  `render()`. The bus row also runs from `relayoutNodes()` (view switch, node-gap slider,
  filters), where the pre-pass has NOT re-run and those fields are stale — so it walks
  `canvas.children` for the content bottom instead.
- **The row owns the height it adds.** It renders AFTER `canvas.style.height` is set, so
  it grows the canvas itself and remembers the previous value; switching away from the
  VLAN view gives it back, instead of leaving the physical view scrolling into blank space.
- Members are collected with an `el.isConnected` filter — `relayoutNodes()` does not clear
  `state.ports`, so a port this view doesn't draw is still indexed with a detached element
  that measures as 0,0. That is the 0.69.24 wire explosion; here it would have hung a line
  off the canvas corner. Verified against a deliberately detached entry in the harness.
- Interaction, both directions of the spec's "drag a line to another bus": click a **bar**
  to isolate that VLAN (routed through `layers._toggle("vlan", id)`, so it is the same
  highlight the «Отображение» list produces), click a **line** in edit mode to open the
  port's own VLAN form. The drag itself is not implemented — the form is the same outcome
  with the existing, tested write path.
- `layers._applyVlanBusHighlight()` dims the other buses on a pick: bars are canvas DOM and
  lines carry their own class, so neither is reached by the cable sweep in `_applyHighlight`.
- Verified in a DOM harness on the real module (3 VLANs, 7 memberships across 3 nodes):
  3 bars, 4 solid + 3 dashed lines, every line landing inside its own bar, the detached
  port producing none, canvas 520→556px and back to exactly its old value on teardown.

## 0.69.29
- **«Отображение» now lists only the layers the CURRENT view can draw.** The panel
  offered all five at once, so most of them were dead buttons: a layer highlights ports,
  and a port the view doesn't draw can't be highlighted. Clicking a "foreign" one relied
  on `_toggle` silently switching the view first — the schema relayouted under the user as
  a side effect of asking a question about it. Now `LAYER_VIEWS` is the panel's visibility
  rule, not just a fallback: VLAN in the VLAN cut, console + power in the physical one,
  radio + circuits in the wireless one. The «Связи» header follows its rows, so no view
  shows an empty section, and the view segment itself stays put — it is what you navigate WITH.
- **VLAN dropped out of the physical view** (`LAYER_VIEWS.vlan` is `["vlan"]` now). The old
  comment argued the highlight is meaningful there too, but the pick jumped the view anyway,
  which made the segment sitting directly above the list say one thing and do another.
- `applyViewMode` rebuilds the panel — AFTER `relayoutNodes()`, since the counts read
  `state.ports`. Without it the list would keep the previous view's rows until the next
  cable mutation.
- `_restoreActive` drops a highlight whose layer the new view no longer offers: it would
  otherwise keep the schema dimmed with no button left to switch it off.
- **The mode toggle is back in the centre of the canvas** (`.modeswitch.schem-mid`, a direct
  child of `#schemoverlay` so `left:50%` is the pane's centre). It had been parked in the
  top-right bar next to the view switch; the view switch has since moved into «Отображение»,
  leaving `.st-topbar` as a one-button strip crowding the panel stack. `top:16px` matches
  `.pane-title`'s padding, so it sits on the title's line — the title is left-aligned, so
  they don't collide. Measured on the real CSS: centre 510 of 1020, no overlap with the
  title text (16–286) or with `#schem-topright` (766–1006).
- `.st-topbar` and `.modeswitch.schem-topbtn` are gone with it; `responsive.css` hides
  `.schem-mid` instead, so the toggle stays hidden on mobile exactly as before.

## 0.69.28
- **VLAN membership is a BORDER colour, not a fill.** 0.69.26 painted the dot — but the fill is
  already spoken for: `.port.used.p-iface/.p-front/.p-pin/.p-con/.p-wl` all use it to mean "a
  cable is attached". Two meanings on one mark. New `--vlan` token (gold — reads as a tag, and
  power, the other warm colour, is never drawn in this cut) on the border only, so the two
  compose: a cabled port in a VLAN now shows both facts at once instead of one hiding the other.
- **Assigning moved behind «Правка», and view mode got the read half.** Writing on the canvas
  goes through edit mode everywhere else in the plugin; the VLAN pick was the one exception.
  Now in view mode a click on a port that carries a VLAN lights up the whole group — routed
  through `layers._toggle("vlan", id)`, so it is the exact same highlight the «Отображение» list
  produces, including click-again-to-clear and the list marking itself active. A port with no
  VLAN clears the highlight and says so.
- Leaving edit mode drops the pick: its block offered an action that view mode can't perform.

## 0.69.27
- **The VLAN block now hangs over the LAST picked port** instead of the group's centroid. The
  average was a nice idea that got worse the more you picked: it drifts away from every port as
  the selection spreads, and with ports on two racks it lands on empty canvas or across a node.
  The last-clicked port is where the eye already is. `state.vlanPick` is a Map, so insertion
  order is click order — no extra bookkeeping.
- It opens ABOVE the port, except on a node's bottom row where "above" is the node body itself —
  flipped below there, the rule `_showExpandBtn` already follows for the trace button.

## 0.69.26
- **The VLAN block is no longer a bespoke widget.** 0.69.25 invented its own floating panel
  with its own border, its own button colours and its own class names — a second dialect for
  something the canvas already says one way. The link menu's look is now a shared `.portmenu`
  class worn by both, so every "what do you want to do here?" popup on the schema is literally
  the same component; only positioning differs (the link menu is fixed at the cursor, the VLAN
  one absolute inside the canvas, glued to its ports). Buttons reuse the existing `.x` / `.go`
  conventions instead of private `vb-*` ones.
- The block is now **counter-scaled** against the canvas zoom, so it reads at the same size as
  the link menu however far you zoom out (it lives inside the zoomed canvas to follow pan/zoom
  for free — that free ride cost legibility until now).
- **A port carrying a VLAN is painted, not ringed.** The accent halo was a third visual language
  on the same dot; the fill reuses what `used` already means for a cabled port — something is
  attached. Inside the VLAN cut it wins over `used`, because the VLAN is what the view is about.

## 0.69.25
- **Assign VLANs straight on the canvas, several ports at once.** In the VLAN view a click
  PICKS a port (red ring) instead of tracing or wiring — the view exists to edit L2, so it
  owns the click and no mode toggle sits in between. Pick as many as you like; a floating
  block appears at their AVERAGE position (so it reads as belonging to the group, not to one
  port) offering «Создать VLAN?» — or «Изменить VLAN?» when something in the pick already
  carries one. It opens the same `vlanform`, now in bulk mode.
- **Ports are no longer greyed out in the VLAN view.** The fade was by CONTENT (no VLAN yet →
  dim), which meant a site that has never used VLANs rendered entirely pale — exactly the ports
  you came to assign. It is now by CAPABILITY: only panel transit ports fade, every switch port
  stays fully readable, and membership shows as an accent ring (`.port.has-vlan`).
- **Bulk write is ONE request:** NetBox's list endpoint takes `PATCH [{id, …}]` and runs the
  same per-object serializer inside one transaction (`BulkUpdateModelMixin.perform_bulk_update`),
  so the batch is all-or-nothing — no half-assigned selection to clean up after a 400.
- Bulk correctness details: candidates are INTERSECTED across the picked devices (a VLAN offered
  for only some would 400 the whole batch); prefill only shows what every port agrees on, since
  showing the first port's VLAN as everyone's would be a lie you'd then save onto the rest; the
  warning block counts across the whole pick; and a new VLAN falls back to global when the pick
  spans several sites, because a site-scoped one could not be assigned to all of them.
- The pick is held by PORT KEY, never by element — a relayout throws the dots away, and a kept
  reference would be the same detached-node trap that produced the 0.69.23 wire explosion.
  Switching away from the VLAN view drops the pick.

## 0.69.24
- **Fixes the wire explosion 0.69.23 shipped.** In the VLAN view every cable to a hidden
  port shot to the canvas corner. Root cause: `relayoutNodes()` relayouts the nodes but
  does NOT clear `state.ports`, so a port the current view doesn't draw keeps its entry
  with a **detached** `el` — and `getBoundingClientRect()` on a detached element is all
  zeros, which reads as a real coordinate, not as "missing". The `if (!a || !b) continue`
  checks never fired because the entries were there. The wireless view was immune purely
  by luck: it returns at `redrawWires`'s `viewMode === "net"` branch and never runs the
  physical pass. Guarded all four drawing paths that measure a port element: `_wireEnds`,
  `drawRadioLinks`, `_drawFeedWires` and `_drawNodeWhiskers`.
- **Patch panels stay in the VLAN view.** Dropping them was wrong: a panel carries no L2
  itself, but it is what takes a switch port through to a socket and on to the end device
  — without it the chain broke in half and half the wires had no visible far end. The cut
  now removes only POWER and CONSOLE; ports holding no VLAN are dimmed, never removed.
- Note for later: the guards treat the symptom. The real oddity is that `state.ports`
  outlives the DOM it points at, so it describes the last full render rather than what is
  on screen. Clearing it per relayout would also make the layer counts follow the view —
  a bigger behavioural change, deliberately not taken here.

## 0.69.23
- **The VLAN layer never worked — the graph payload had no VLAN fields.** `layers.js`
  `_collectVlans()` reads `untagged_vlan`/`tagged_vlans`/`qinq_svlan` off `state.ports[…].item`,
  but `SchematicGraphView` serialized a port as `{id, name, device, cable, type, wireless_link}`.
  So on the group canvas the panel always said «VLAN на портах группы нет» (VLANs were visible
  only in trace/single-device view, which loads real REST interfaces — and there the panel is
  wiped with the overlay). Dead since the layer shipped. `views.py` now emits `mode` +
  the three VLAN fields in NetBox REST shapes, with `select_related`/`prefetch_related`
  (3 extra queries PER PORT otherwise). The same fix un-deadens `ipform.js:94-96`, whose
  "prefixes of this port's VLAN" branch could never fire.
- Selecting a VLAN layer dimmed **every** wire (`selectVlan` passed no `hlCables`) — invisible
  before, since the list was always empty. New `_cablesForPorts()` lights the cables touching
  the layer's ports, same "at least one end participates" rule as the console layer.
- **«VLAN на порту» — assign L2 membership from the passport** (`vlanform.js`, popover built
  like `IpForm`): mode (access/tagged/tagged-all/q-in-q), untagged VLAN, tagged VLANs with
  search, and create-a-VLAN inline. Candidates come from `/ipam/vlans/?available_on_device=`
  — NetBox's own scope logic (VLANGroups on region/site-group/site/location/rack + site +
  global), not a reimplementation. A new VLAN is site-scoped by default, «общий» makes it
  global (needed for a trunk spanning sites). Interface rows now show a `VLAN 20` chip and
  `+N тег.`; the write mirrors the response into `state.ports` and rebuilds the layer panel
  instead of a full `tree.reload()`.
- **Write semantics that cost a bug** (`InterfaceSerializer.validate` → `BaseInterface.save`):
  on PATCH the serializer fills fields you did NOT send **from the instance**, so `mode` must
  travel in the same body as the VLANs, and leaving `q-in-q` must send `qinq_svlan: null` —
  otherwise the stored S-VLAN 400s an otherwise valid save. Found by reading the serializer
  after the first version was already written. The one genuinely silent drop left
  (`mode != tagged` clears `tagged_vlans`, unchecked for q-in-q) is surfaced as a warning
  in the form before saving.
- VLAN names are free text and went into `innerHTML` unescaped — escaped in the new form and
  in the layer panel (reachable for the first time thanks to the payload fix).
- Harness `test_vlan_write.py` — candidates, every mode body, the no-mode rejection, both
  q-in-q exits and the graph fields, through the real API serializer in a rolled-back tx.
- **Third view: VLAN.** `state.viewMode` was a boolean in disguise (`=== "net"` in four
  places) and is now a real three-way. The VLAN view draws **wired interfaces only** —
  patch panels, sockets, power and console carry no L2 and were pure noise in that cut —
  keeping the physical view's sides so a switch's ports stay where the eye expects them.
  Ports with no membership are faded (`.vlan-dim`), power boxes and feeders step back
  like they do in the wireless view. It is a strict subset of the physical view, so the
  SLOT pre-pass measuring max(phys, net) still bounds node width — untouched.
- **The view switch moved into the layer panel, renamed «Отображение».** Views and layers
  answer the same question — «что я вижу» — and sat in two different blocks, where picking
  the Circuits layer *silently* flipped `viewMode` and relayouted the schema with no visible
  cause (`layers.js` did it from the other block). The segment now sits directly above the
  list and visibly moves instead. Kept as a segment, NOT a list row: a view is a radio
  (always exactly one, costs a full relayout), a layer is a toggle (usually none, costs a
  CSS class) — same panel, deliberately different control.
- Layer→view binding is now a table (`LAYER_VIEWS`) instead of a boolean: VLAN highlight is
  valid in the physical view too («какие проводные порты в VLAN 20»), so unlike every other
  layer it never forces a switch. First entry is where a click sends you.
- Contour drift, caught while wiring the third view: `_fitContoursToWires()` runs in the
  non-wireless branch, and the wireless view only escapes it by returning early (there is a
  comment explaining the drift it once caused). The VLAN view falls through that branch and
  also shrinks nodes, so it would have re-introduced the same bug — the refit is now bound
  to the physical view, the geometry contours are meant to reflect.
- Not yet: the VLAN bus. The VLAN view still draws physical cables between the L2 ports —
  honest and useful on its own, but the «шина» from `virtualization.md §5` is the next step.
  Note that the panel is collapsible, so the view segment collapses with it; if that bites,
  hoisting it into the panel header is a few lines.

## 0.69.22
- **Preview warnings are per-FORM now — the power sheet had none at all.** `views.py` called
  `importer.plan_warnings(plan)` outright; that's the patch sheet's checker (it reads
  `socket`/`panel`/`switch`), so a power plan always produced `[]` and rows that `apply_plan`
  silently skips were invisible before commit — the worst kind of quiet. `ExcelForm.warnings(plan)`
  is now a hook (base → `[]`, patchen → the old checker, power → `power.plan_warnings`), plus base
  `conflicts()` and an `importable()` classmethod.
- **`power.plan_warnings`**: duplicate inlet, duplicate source port, self-powered device, guessed
  source port, and rows that won't import. Wording states the FACT («ввод указан ещё в строке N —
  порт принимает один кабель») rather than promising which row loses: a harness case proved the
  prediction wrong — row 5's source stayed free because row 4 had already been skipped for a
  different reason.
- **Incomplete rows are no longer dropped in `build_plan`.** They're kept with an `incomplete`
  reason, skipped by `apply_plan` and named in the warnings; `summary` counts only usable links.
  A source with no port named gets the right KIND of default («Фидер 1» for a panel, «Розетка 1»
  for a device — it used to guess a feed for both) and is flagged.
- **Export-only forms rejected cleanly on import**: `form=universal` returned a 500 from an
  uncaught `NotImplementedError`; now a 400 explaining the form is export-only.
- READMEs (ru + en) refreshed: they still described Excel as the single Patchen sheet — now the
  power sheet, universal list, preview warnings, scope audit and built-in learning are listed, and
  the file tree includes `excel.py`, `forms/`, `power.py`, `audit.py`.
- Harness `test_power_warnings.py` — 22 checks on the dev DB (warnings, apply-skips, form hooks,
  the 400, and a power warning surfacing through the real import view).

## 0.69.21
- **Power findings in the audit** (`audit.py`). Per device: `unpowered` (warn — has inlets, none
  cabled) and `free_outlets` (info — spare capacity on a PDU/UPS). Per power panel — panels are
  NOT Devices, so they get their own scope query mirroring the device filters: `feed_unused`
  (warn — feeds that lead nowhere, first three named) and `panel_empty` (info). `add()` was split
  into a generic `add_at(site, loc, name, …)` so panels land in the same site→location tree; the
  audit UI renders by severity, so no frontend change was needed. Also fixed `isolated` firing on
  devices with zero data ports at all. Harness `test_audit_power.py` — 14 checks on the dev DB.
- **English learning docs** — all 11 topics under `docs/en/learn/` (translated by parallel
  subagents against a fixed glossary; UI labels deliberately kept in Russian, because the plugin's
  UI is Russian — an English page tells you to click «Сохранить в тип», which is what you actually
  see). `TOPICS` gained `title_en` + `topicTitle()`, and the modal's own chrome (tabs, badge title,
  close/back/loading/empty strings) now follows `resolveLang()` — Russian tabs over an English page
  was a half-state. Cross-topic references in the English docs rewritten to the English tree names.
- `resolveLang()` made total (String-coerced, try/catch) so an odd/missing `lang` can't throw at
  page load now that `bind()` calls it.
- **Docs correction:** the «Импорт / Экспорт» topic claimed the audit compares a FILE against the
  schema. It never did — it scans the selected scope. Rewritten in both languages, now also listing
  the power findings.

## 0.69.20
- **«Промежуток нод» applies to OFF-RACK devices as well.** The slider only fed the in-rack row
  pitch (`64 + gap`); pocket rows used the fixed `OFFGEO.ROW_H = 108`. New `offRowH()` shifts that
  pitch by the same delta as a rack row (`ROW_H + (gap - NODE_GAP)`, floor 84 = the tightest
  in-rack pitch), so the DEFAULT gap reproduces today's layout exactly — used by both
  `_renderOffRack` (node placement) and `_computeLocGeometry` (contour packing), which must agree.
- **Fixed «Слои» going blank on a gap change.** The slider's `change` handler called `render()`
  directly; `render()` rebuilds the whole overlay markup (including the layers/filter shells), and
  only `renderAll` follows up with `layers.renderPanel()` / `redrawWires()` / `filter.render()`.
  The handler now does the same three, so the panel is repopulated and the wires match the new
  geometry. Harness `test_nodegap_v20.mjs` (11 checks on the real `_computeLocGeometry` +
  handler wiring).

## 0.69.19
- **Power round-trips through Excel as its OWN sheet** (`forms/power.py` + `power.py`).
  One row per power cable: source (panel FEED or device OUTLET) → consumer INLET, plus
  site/location/rack and the feed's V/A. Export walks power PORTS only, so each cable yields
  exactly one row. Import CREATES what's missing (panels, feeds, devices, ports, cables) like
  the patch import does, is idempotent (existing objects reused; an already-cabled inlet is
  skipped, never silently re-wired) and reports busy inlets through the normal conflicts UI.
- **Import auto-detects the sheet layout** (`excel.detect_form`): every importable form is
  probed against the header and the best match wins (export-only forms — no `build_plan` of
  their own — are never picked). The import dialog gains a «Формат файла» select defaulting to
  «определить автоматически», and the preview states which layout was used + power-specific
  chips (щитов / источников / потребителей).
- **Universal export no longer drops power links.** `_far_ref` renders a cable's far end as
  `владелец/порт` and knows a PowerFeed hangs off a PowerPanel, not a Device — the old
  `far.device.name` access silently skipped every feed-fed link. Power ports/outlets joined the
  universal sheet's «Соединения» column.
- Gotcha worth remembering: form aliases are matched against EVERY cell and the LAST row with
  ≥2 matches becomes the header — aliases that also occur as VALUES («щит», «розетка», «фидер»,
  «устройство») made data rows masquerade as the header and the file parsed as empty. The power
  form's captions are deliberately multi-word, with ≤1 fuzzy value match per row.
- Verified on the real dev DB (docker) with rollback harnesses: `test_power_roundtrip.py`
  (21 checks — export → xlsx → parse → plan → apply into an empty site → re-export equality →
  idempotency → conflicts), `test_power_detect.py` (14 — detection + the actual import VIEW
  preview/commit), `test_export_power_db.py` (8). Docs: «Импорт / Экспорт» topic rewritten.

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
