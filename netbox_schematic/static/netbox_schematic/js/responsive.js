"use strict";
// Mobile adaptation — behavior of the sliding blocks. All LAYOUT lives in
// css/responsive.css (media queries); here only body-class toggles:
//   body.nav-open   — sidebar drawer open;
//   body.sheet-open — bottom detail sheet open.
// On desktop these classes do nothing (rules are inside media queries) and
// #navtoggle is display:none → not clickable. So the module is safe anywhere,
// loaded as its own <script> (not via main.js), works on all canvases.

const body = document.body;

// The bottom sheet needs a real HEADER, not a strip drawn over the content: with a
// sticky ::before the content still scrolls behind it and shows through the rounded
// corners. So each detail panel is wrapped ONCE, at startup, into
//   .sheet-wrap > .sheet-grip + #detail
// and the panel itself becomes the scrolling body inside a non-scrolling frame.
// Once, at startup, because every panel writer replaces #detail.innerHTML wholesale
// — a grip inside it would not survive the first render. On desktop the wrapper is
// `display: contents`, so it vanishes from layout and #detail stays the flex column
// it has always been.
for (const id of ["detail", "ipam-detail"]) {
  const el = document.getElementById(id);
  if (!el || !el.parentElement || el.parentElement.classList.contains("sheet-wrap")) continue;
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.id = id + "-sheet";
  el.parentElement.insertBefore(wrap, el);
  const grip = document.createElement("div");
  grip.className = "sheet-grip";
  wrap.append(grip, el);
}
// Closing the detail sheet resets its scroll — so the NEXT open starts at the top
// (an in-place edit keeps the position; see device.show / keepScroll).
const resetDetailScroll = () => {
  for (const id of ["detail", "ipam-detail"]) { const el = document.getElementById(id); if (el) el.scrollTop = 0; }
};
const dropSheet = () => { body.classList.remove("sheet-open"); resetDetailScroll(); };
const close = () => { body.classList.remove("nav-open", "sheet-open"); resetDetailScroll(); };

// iOS Safari IGNORES viewport `user-scalable=no` (re-enabled for a11y), so its
// pinch-zoom would still zoom the whole page (topbar hides) and zoom the tree.
// Kill the Safari gesture events globally — the canvases keep their OWN pinch
// (attachPinchZoom, touch events), which is unaffected. Harmless elsewhere.
["gesturestart", "gesturechange", "gestureend"].forEach(g =>
  document.addEventListener(g, e => e.preventDefault(), { passive: false }));

// ☰ → open/close the drawer (and drop the sheet so two aren't open at once).
const nav = document.getElementById("navtoggle");
if (nav) nav.addEventListener("click", e => {
  e.stopPropagation();
  // In «Выбрать» mode the tree can't be closed (needs «Отмена» first).
  if (body.classList.contains("nav-open") && body.classList.contains("tree-selecting")) return;
  dropSheet();
  body.classList.toggle("nav-open");
});

// Header schema switcher (native <select> → on iOS the system liquid-glass
// picker). Changing the value navigates to the schema. Sidebar list removed.
const cswitch = document.getElementById("canvas-switch");
if (cswitch) cswitch.addEventListener("change", e => { if (e.target.value) location.href = e.target.value; });
// A native <select> sizes to its WIDEST option, so its arrow drifts far from a
// short current value ("Сети"). Shrink the width to fit the SELECTED text.
function fitCanvasSwitch() {
  if (!cswitch) return;
  const opt = cswitch.options[cswitch.selectedIndex];
  if (!opt) return;
  const cs = getComputedStyle(cswitch);
  const meas = document.createElement("span");
  meas.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
  meas.style.fontFamily = cs.fontFamily; meas.style.fontSize = cs.fontSize;
  meas.style.fontWeight = cs.fontWeight; meas.style.letterSpacing = cs.letterSpacing;
  meas.textContent = opt.textContent;
  document.body.appendChild(meas);
  const w = meas.getBoundingClientRect().width;
  meas.remove();
  cswitch.style.width = Math.ceil(w + 26) + "px";   // + room for the native arrow
}
if (cswitch) { fitCanvasSwitch(); window.addEventListener("resize", fitCanvasSwitch); }

// Header "more" arrow (mobile) → expand/collapse the second row of extra controls.
const more = document.getElementById("topbar-more");
if (more) more.addEventListener("click", e => { e.stopPropagation(); body.classList.toggle("topbar-expanded"); });

// Scrim — closes the drawer, the detail sheet and the racks sheet (collapse +
// exit rack editing).
const scrim = document.getElementById("mobile-scrim");
if (scrim) scrim.addEventListener("click", () => {
  if (body.classList.contains("tree-selecting")) return;   // in «Выбрать» mode don't close the tree
  close();
  body.classList.add("rack-collapsed");
  body.classList.remove("rack-edit");
});

// Tap a tree node / canvas switcher in the drawer → build the schema and close
// the drawer (result shown at once). The node's own handler runs as usual.
const sidebar = document.getElementById("sidebar");
if (sidebar) sidebar.addEventListener("click", e => {
  if (body.classList.contains("tree-selecting")) return;   // in select mode don't close the drawer
  if (e.target.closest(".tree-loc, .tree-rack, .tree-site, .tree-sitegroup, .tree-dev, .it-node, .cnav"))
    body.classList.remove("nav-open");
});

// Tap a "card-opening" element → show the detail sheet. Its own handlers fill
// the detail (device.show / _showNet); we only raise the sheet after their
// microtask. On desktop the class is a no-op (sheet only in a media query).
document.addEventListener("click", e => {
  if (e.target.closest(".node .nm, .it-net, .net-block, .nb-cap, .nc-corner, .net-chip, .vbus, .stack-badge"))
    setTimeout(() => body.classList.add("sheet-open"), 0);
});

// Touch: drag the sheet DOWN with the finger (details / racks block). While the
// finger is down the sheet follows it and does NOT close (drag up/down freely);
// it closes ONLY on release below the threshold, else it eases back. Dragging
// works only from the top of the content scroll (otherwise it's a normal scroll).
// scrollerSel — inner scrollable element (#rackpane itself doesn't scroll,
// #racks does); null → the sheet itself scrolls (#detail/#ipam-detail).
// Landscape tablet shows the detail as a RIGHT sheet (see responsive.css) — there
// it's dragged off to the RIGHT to close, not down. `sideAware` sheets pick the
// axis per gesture; the rack sheet is always a bottom sheet (drag down).
const sideSheetMQ = window.matchMedia("(min-width:761px) and (max-width:1024px) and (orientation:landscape)");
const swipeClose = (id, scrollerSel, onClose, sideAware) => {
  const el = document.getElementById(id);
  if (!el) return;
  let sx = 0, sy = 0, d = 0, arm = false, dragging = false, horiz = false;
  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) { arm = false; return; }
    horiz = !!(sideAware && sideSheetMQ.matches);
    // Vertical sheet: drag only from the top of its scroll. Horizontal sheet:
    // any point (it scrolls vertically, so a rightward drag never conflicts).
    const scroller = scrollerSel ? el.querySelector(scrollerSel) : el;
    arm = horiz || (scroller ? scroller.scrollTop : 0) <= 2;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; d = 0; dragging = false;
  }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (!arm) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (horiz && !dragging && Math.abs(dy) > Math.abs(dx)) { arm = false; return; }  // vertical scroll wins
    d = horiz ? dx : dy;
    if (d > 0) {                            // dragging outward — move the sheet, don't scroll content
      if (!dragging) { dragging = true; el.style.transition = "none"; }
      e.preventDefault();
      el.style.transform = (horiz ? "translateX(" : "translateY(") + d + "px)";
    } else if (dragging) {                  // back past the origin — hold at the open position
      el.style.transform = horiz ? "translateX(0)" : "translateY(0)";
    }
  }, { passive: false });
  const end = () => {
    if (!dragging) { arm = false; return; }
    dragging = false;
    const box = el.getBoundingClientRect();
    const extent = horiz ? (box.width || 360) : (box.height || 400);
    const shouldClose = d > Math.min(150, extent * 0.3);   // released past threshold → close
    el.style.transition = "";               // restore the CSS animation (0.24s)
    if (shouldClose) onClose();             // class removed → CSS slides the sheet away (smoothly)
    el.style.transform = "";                // clear inline → move to the CSS target (open/closed)
    d = 0; arm = false;
  };
  el.addEventListener("touchend", end, { passive: true });
  el.addEventListener("touchcancel", end, { passive: true });
};
// The swipe now moves the WRAPPER (it is the sheet); the scroll it must not fight
// belongs to #detail inside it, passed as the scroller.
swipeClose("detail-sheet", "#detail", dropSheet, true);
swipeClose("ipam-detail-sheet", "#ipam-detail", dropSheet, true);
swipeClose("rackpane", "#racks", () => { body.classList.add("rack-collapsed"); body.classList.remove("rack-edit"); }, false);

// Esc — close overlays.
document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
