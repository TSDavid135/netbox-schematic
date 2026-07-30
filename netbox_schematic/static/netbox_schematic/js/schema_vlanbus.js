"use strict";
// VLAN buses — mixin for the SchemaManager prototype (split from schema.js).
// Methods copied into SchemaManager.prototype via _mixin (see schema.js).
//
// A "bus" is a DRAWING, not an object: NetBox has no bus model, membership lives
// in untagged_vlan / tagged_vlans on the interface itself. So it is shown where it
// answers something, not as a permanent row every port must reach across the whole
// schema. The lines to it are not cables either — no type, no family, no cable id;
// they are visual links, which is why they never go through the cable passes.
//
// Three levels, each one click deeper:
//   · always — a member port is ringed in its VLAN's colour and grows a short cut
//     stub, so "this port is on a bus" is legible without touching anything;
//   · one click — the bus itself floats over the port, named, joined to it;
//   · a second click on the same port — the bar STRETCHES over every port on that
//     bus and each of them is joined to it.

import { $, state, mk, portKey } from "./core.js";
import { setStatus } from "./api.js";

// GAP — how far off the port the block floats. STUB — the length of the always-on
// cut whisker, FAN — the spread when one port carries several VLANs. SCALE is
// FIXED: the block used to answer the canvas zoom, but a bus that resizes while
// you zoom into it is exactly what you did not ask the zoom for.
// SLOP — how far the pointer may travel between down and up and still count as a
// click rather than a pan.
// CAP_EDGE — how far the sliding name keeps off the bar's own left/right ends;
// CAP_PAD — how far it keeps off the edge of the viewport when pinned there.
const BUSGEO = { GAP: 40, STUB: 26, FAN: 6, SCALE: 1.3, ROW_GAP: 6, PAD_X: 26, EDGE: 6, SLOP: 4,
  CAP_EDGE: 14, CAP_PAD: 14 };

class _Mixin {
  // Colour per VLAN, derived from the VID so it is STABLE across renders and
  // scopes — a palette that reshuffles on reload is worse than no palette. 47 is
  // coprime with 360, so consecutive VIDs land far apart on the wheel instead of
  // shading into each other.
  _vlanColor(vlan) {
    const n = vlan.vid != null ? vlan.vid : vlan.id;
    return `hsl(${(n * 47) % 360} 70% 58%)`;
  }

  _vlanTitle(vlan) {
    return (vlan.vid != null ? "VLAN " + vlan.vid : "VLAN") + (vlan.name ? " · " + vlan.name : "");
  }

  // Every VLAN on one interface, untagged FIRST — that is the one the ring takes,
  // because it is the port's "home" VLAN and there is at most one of it.
  _vlansOfPort(item) {
    if (!item) return [];
    const out = [];
    if (item.untagged_vlan) out.push({ vlan: item.untagged_vlan, tagged: false });
    for (const v of item.tagged_vlans || []) out.push({ vlan: v, tagged: true });
    // Q-in-Q service VLAN is an outer tag — a tag is still a tag.
    if (item.qinq_svlan) out.push({ vlan: item.qinq_svlan, tagged: true });
    return out;
  }

  // Live ports carrying a VLAN. isConnected everywhere: relayoutNodes does not
  // clear state.ports, so a port this view doesn't draw keeps its entry with a
  // detached el whose getBoundingClientRect() is all zeros — the 0.69.24 trap.
  _portsOfVlan(vlanId) {
    const out = [];
    for (const [key, p] of Object.entries(state.ports)) {
      if (!p || !p.el || !p.el.isConnected || p.otype !== "dcim.interface") continue;
      const m = this._vlansOfPort(p.item).find(x => x.vlan.id === vlanId);
      if (m) out.push({ key, port: p, tagged: m.tagged });
    }
    return out;
  }

  // Ring every member port in its VLAN's colour. Runs after each relayout, since
  // the dots are thrown away and rebuilt there. Outside the VLAN view the inline
  // colour is cleared so .port.has-vlan falls back to its --vlan gold.
  _paintVlanPorts() {
    const vlanView = state.viewMode === "vlan";
    if (!vlanView) this._hideVlanBus();
    else if (this._vlanBusPort) {
      // The block hangs off ONE port element, which the relayout just replaced —
      // re-anchor it on the new dot, keeping whichever level it was opened to.
      const p = state.ports[this._vlanBusPort];
      const vs = p && p.el && p.el.isConnected ? this._vlansOfPort(p.item) : [];
      const wasWide = this._vlanBusWide, wasHl = this._vlanBusHl;
      this._vlanBusPort = null;
      if (!vs.length) this._hideVlanBus();
      else {
        this._showVlanBus(p, vs, wasWide);
        // The dots are new objects, so the highlight classes went with the old
        // ones — repaint, or a relayout silently un-dims half the schema.
        if (wasHl) this._highlightVlans(vs);
      }
    }
    for (const p of Object.values(state.ports)) {
      if (!p || !p.el || !p.el.isConnected) continue;
      if (!vlanView) { p.el.style.borderColor = ""; continue; }
      const vs = this._vlansOfPort(p.item);
      p.el.style.borderColor = vs.length ? this._vlanColor(vs[0].vlan) : "";
    }
  }

  // ── clicks ────────────────────────────────────────────────────────────────
  _onVlanPortClick(kind, item) {
    const key = portKey(kind.otype, item.id);
    const p = state.ports[key];
    const vs = this._vlansOfPort(item);
    if (!vs.length) {
      this._hideVlanBus();
      if (this.app.layers) this.app.layers.clear();
      setStatus("на этом порту нет VLAN", "err");
      return;
    }
    // Second click on the same port — widen the bus over everyone on it.
    if (this._vlanBusPort === key && !this._vlanBusWide) {
      this._vlanBusPort = null;
      this._showVlanBus(p, vs, true);
      this._highlightVlans(vs);
      return;
    }
    // Third click closes, so one port cycles: bus → whole bus → nothing.
    // _hideVlanBus takes the highlight down with it.
    if (this._vlanBusPort === key) { this._hideVlanBus(); return; }
    if (this.app.layers) this.app.layers.clear();
    this._showVlanBus(p, vs, false);
  }

  // Light up the ports of one or several VLANs (a trunk carries several). The
  // layer manager holds one VLAN at a time, so this paints the layer classes
  // directly and sets the same body flag the layers use.
  _highlightVlans(vs) {
    const want = new Set(vs.map(m => m.vlan.id));
    if (this.app.layers) this.app.layers.clear();
    let n = 0;
    const devs = new Set();
    for (const p of Object.values(state.ports)) {
      if (!p || !p.el || !p.el.isConnected) continue;
      const mine = this._vlansOfPort(p.item).some(m => want.has(m.vlan.id));
      p.el.classList.toggle("layer-hl", mine);
      p.el.classList.toggle("layer-dim", !mine);
      if (mine) { n++; if (p.dev) devs.add(String(p.dev.id)); }
    }
    // The devices too, not just their dots: a port is an 11px circle, and on a
    // rack of switches the answer to "who is on this bus" is read off the NODES
    // long before anyone counts dots. Same classes the layer manager puts on
    // nodes, so the outline and the dimming are the existing ones.
    for (const [id, el] of Object.entries(state.nodeEls || {})) {
      if (!el || !el.isConnected) continue;
      const mine = devs.has(String(id));
      el.classList.toggle("layer-hl", mine);
      el.classList.toggle("layer-dim", !mine);
    }
    document.body.classList.add("layer-active");
    // The layer manager is not driving this one, so the colour it would normally
    // set has to be set here too — otherwise the halo falls back to accent and the
    // ports read cyan right next to their own coloured bus.
    document.body.style.setProperty("--layer-color", this._vlanColor(vs[0].vlan));
    // Remember that WE painted it: nothing else knows to take it back down, which
    // is how the dimming used to survive every attempt to dismiss it.
    this._vlanBusHl = true;
    setStatus("портов на этих VLAN: " + n, "ok");
  }

  _hideVlanBus() {
    const el = document.getElementById("vlanbus");
    if (el) el.style.display = "none";
    this._vlanBusPort = null;
    this._vlanBusWide = false;
    this._markVlanBusPort();   // no anchor → the green ring goes with it
    // Take our own highlight down with the block. It was painted by hand, outside
    // the layer manager, so nothing else would ever clear it — closing the block
    // by clicking empty canvas left the whole schema dimmed with no way back.
    if (this._vlanBusHl) {
      this._vlanBusHl = false;
      if (this.app.layers) this.app.layers.clear();
    }
    // Closing the bus does NOT take the stubs with it — those belong to the ports,
    // not to the block. Redrawing rebuilds exactly the closed-state set (and is a
    // no-op outside the VLAN view, which is the other caller of this).
    this._drawVlanBusWhiskers();
  }

  // ── the block ─────────────────────────────────────────────────────────────
  // Bars are absolutely positioned inside a ZERO-SIZE box so the same code can
  // place them either centred on the port (narrow) or stretched across their
  // members (wide). The box carries the scale, so a bar's canvas width is its css
  // width × SCALE — hence every geometry value below is divided by SCALE.
  _showVlanBus(port, vs, wide) {
    const canvas = $("#schema");
    if (!canvas || !port || !port.el || !port.el.isConnected) return;
    let box = document.getElementById("vlanbus");
    if (!box) {
      box = document.createElement("div");
      box.id = "vlanbus";
      canvas.appendChild(box);
      // A tap on empty canvas closes it — but not on a port (which re-opens it for
      // that port), the block itself, or the VLAN form it can lead to.
      // Closing on pointerDOWN threw the selection away on every PAN: dragging the
      // schema starts with a pointerdown on empty canvas too, and the widened bus
      // is exactly what you want to keep while moving around to look at it. So the
      // decision waits for pointerUP and only fires if the pointer stayed put.
      // Panning and zooming move the bar under a fixed viewport, so the caption has
      // to be repositioned on both — rAF-throttled, like the IPAM captions.
      const pane = $("#schempane");
      if (pane) pane.addEventListener("scroll", () => this._scheduleStickCaps(), { passive: true });
      window.addEventListener("resize", () => this._scheduleStickCaps());
      let downAt = null;
      document.addEventListener("pointerdown", e => {
        downAt = null;
        if (!this._vlanBusPort) return;
        if (e.target.closest("#vlanbus") || e.target.closest(".port") ||
            e.target.closest("#vlanform")) return;
        downAt = { x: e.clientX, y: e.clientY };
      }, true);
      document.addEventListener("pointerup", e => {
        const at = downAt;
        downAt = null;
        if (!at || !this._vlanBusPort) return;
        if (Math.hypot(e.clientX - at.x, e.clientY - at.y) <= BUSGEO.SLOP) this._hideVlanBus();
      }, true);
    }
    box.innerHTML = "";
    const S = BUSGEO.SCALE;
    const base = canvas.getBoundingClientRect(), z = state.zoom || 1;
    const cx = el => {
      const r = el.getBoundingClientRect();
      return (r.left - base.left + r.width / 2) / z;
    };
    const r = port.el.getBoundingClientRect();
    const px = (r.left - base.left + r.width / 2) / z;
    const py = (r.top - base.top + r.height / 2) / z;
    const up = port.side === "t";
    box.style.left = px + "px";
    box.style.top = (py + (up ? -BUSGEO.GAP : BUSGEO.GAP)) + "px";
    box.style.transform = `scale(${S})`;
    box.style.display = "block";

    // Build the bars first, then measure — a bar's natural width is only known
    // once it is in the DOM with its text in it.
    const bars = [];
    for (const m of vs) {
      const bar = mk("div", {
        className: "vbus" + (m.tagged ? " tagged" : ""),
        dataset: { vlan: String(m.vlan.id) },
      });
      // The name lives in its own span so it can SLIDE along the visible part of a
      // wide bar (see _stickVlanCaps) — the same trick the IPAM place captions use,
      // and for the same reason: a bar can be wider than the viewport, and a name
      // centred on a bar you can only see a third of is a name you cannot read.
      bar.appendChild(mk("span", { className: "vb-cap",
        text: this._vlanTitle(m.vlan) + (m.tagged ? " · тег" : "") }));
      // Custom property, so setProperty — Object.assign(style, …) in mk() drops it.
      bar.style.setProperty("--bus", this._vlanColor(m.vlan));
      // The bar has looked clickable since it was built (cursor: pointer) with
      // nothing behind it. Click → the VLAN's own detail panel: every interface on
      // it, grouped by device. The canvas answers "where" — rings and outlines —
      // and that is the one question a list answers better than a picture.
      // NO stopPropagation: on a phone the detail panel is a bottom sheet, and it is
      // raised by a delegated document-level click listener (responsive.js) that
      // matches .vbus. Swallowing the event here filled the panel and never showed
      // it — the tap did nothing at all on mobile.
      bar.addEventListener("click", () => {
        if (this.app.device) this.app.device.showVlanPanel(m.vlan, this._portsOfVlan(m.vlan.id));
      });
      box.appendChild(bar);
      bars.push({ bar, m });
    }
    const rowH = (bars[0].bar.offsetHeight || 22) + BUSGEO.ROW_GAP;
    bars.forEach(({ bar, m }, i) => {
      let left, width = null;
      if (wide) {
        // Stretch over every port on this bus, so the bar's length IS the VLAN's
        // reach across the schema — one rack or the whole room.
        const xs = this._portsOfVlan(m.vlan.id).map(x => cx(x.port.el));
        const l = Math.min(px, ...xs) - BUSGEO.PAD_X, rr = Math.max(px, ...xs) + BUSGEO.PAD_X;
        // Never shorter than the collapsed block: widening is supposed to SHOW
        // more, and a VLAN whose ports sit side by side has a span narrower than
        // its own label — the bar would visibly shrink on the click that is
        // supposed to expand it. Below that floor it keeps its size and just
        // centres on the span.
        const natural = bar.offsetWidth;
        width = (rr - l) / S;
        if (width < natural) {
          width = natural;
          left = ((l + rr) / 2 - px) / S - natural / 2;
        } else {
          left = (l - px) / S;
        }
      } else {
        left = -(bar.offsetWidth / 2);
      }
      if (width != null) { bar.style.width = width + "px"; bar.classList.add("wide"); }
      bar.style.left = left + "px";
      // Row 0 is the one nearest the port; upward rows count away from it.
      bar.style.top = (up ? -(i + 1) * rowH : i * rowH) + "px";
    });
    this._vlanBusPort = portKey(port.otype, port.item.id);
    this._vlanBusWide = !!wide;
    // Green ring on the port you actually touched — the SAME `.port.hl` the physical
    // view uses for a hovered cable end. On a phone there is no hover at all, so
    // without it a tap gave no feedback that it had landed on the right dot.
    this._markVlanBusPort();
    this._stickVlanCaps();
    this._drawVlanBusWhiskers();
  }

  // Slide each wide bar's name along the VISIBLE part of that bar, exactly like the
  // place captions on «Сети» (ipam._stickTitles) and for the same reason: a bar
  // stretched over two racks is wider than the viewport, so a name centred on it
  // sits off-screen most of the time. Pinned to the left edge of the viewport once
  // the bar's own left edge scrolls past, and stopped at the bar's right corner.
  // CSS `position: sticky` cannot do this — the canvas transform breaks it.
  _stickVlanCaps() {
    const pane = $("#schempane"), box = document.getElementById("vlanbus");
    if (!pane || !box || box.style.display === "none") return;
    const vr = pane.getBoundingClientRect();
    // Rects are already scaled by BOTH transforms (canvas zoom × the block's own
    // scale), so the screen offset converts back through their product.
    const k = (state.zoom || 1) * (this._vlanBusScale || BUSGEO.SCALE);
    const PAD = BUSGEO.CAP_PAD, EDGE = BUSGEO.CAP_EDGE * k;
    for (const bar of box.querySelectorAll(".vbus.wide")) {
      const cap = bar.querySelector(".vb-cap");
      if (!cap) continue;
      const br = bar.getBoundingClientRect();
      const capW = cap.offsetWidth * k;
      const lo = br.left + EDGE;
      const hi = br.right - capW - EDGE;
      let left = Math.max(lo, vr.left + PAD);
      left = hi >= lo ? Math.min(left, hi) : lo;   // a bar narrower than its name stays put
      cap.style.left = ((left - br.left) / k) + "px";
    }
  }
  // Exactly one port wears the "you tapped me" ring: the bus's anchor. Cleared
  // wholesale first, so a relayout (which rebuilds the dots) cannot leave a ghost.
  _markVlanBusPort() {
    const anchor = this._vlanBusPort && state.ports[this._vlanBusPort];
    // Same ring every tapped port gets (_markTappedPort) — this only re-applies it
    // to the anchor after a relayout, which throws the dots away and the class with
    // them. Closing the bus passes no anchor and so just clears.
    this._markTappedPort(anchor && anchor.el);
  }
  _scheduleStickCaps() {
    if (this._capRaf) return;
    this._capRaf = requestAnimationFrame(() => { this._capRaf = null; this._stickVlanCaps(); });
  }

  // ── the lines ─────────────────────────────────────────────────────────────
  // Visual links, not cables: no type, no family, no cable id, and drawn by their
  // own pass because redrawWires wipes the svg on every zoom/pan/filter.
  _drawVlanBusWhiskers() {
    const svg = $("#wires"), canvas = $("#schema");
    if (!svg || !canvas) return;
    svg.querySelectorAll(".vlanwhisk").forEach(w => w.remove());
    if (state.viewMode !== "vlan") return;
    const base = canvas.getBoundingClientRect(), z = state.zoom || 1;
    const box = document.getElementById("vlanbus");
    const open = box && box.style.display !== "none" && this._vlanBusPort;
    const geom = el => {
      const g = el.getBoundingClientRect();
      return { x: (g.left - base.left + g.width / 2) / z, y: (g.top - base.top + g.height / 2) / z,
        l: (g.left - base.left) / z, r: (g.right - base.left) / z,
        t: (g.top - base.top) / z, b: (g.bottom - base.top) / z };
    };
    // A line leaves the port at its EDGE, not its centre. The layer sits ABOVE the
    // nodes (0.69.36, so a link crossing a node body stays visible), which means a
    // line anchored in the centre paints over the port's own number. Lifting the
    // dots above the layer instead is not possible: `.node` is positioned with a
    // z-index, so it is a stacking context and a dot inside it can never paint
    // above an outside layer, whatever z-index the dot is given.
    // NOT schema_util's portAnchor, which offsets along the port's SIDE: a bus can
    // open on either side of its port regardless of which node edge the port sits
    // on, and a side-based anchor would then start the line on the far side of the
    // dot and draw it back across. Here the direction of travel decides.
    const line = (pg, to, color, tagged) => {
      const dir = to.y >= pg.y ? 1 : -1;
      const from = { x: pg.x, y: (dir > 0 ? pg.b : pg.t) + dir };
      const mid = (from.y + to.y) / 2;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", `M ${from.x} ${from.y} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${to.y}`);
      p.setAttribute("class", "vlanwhisk" + (tagged ? " tagged" : ""));
      p.style.stroke = color;
      svg.appendChild(p);
      return p;
    };
    // Which ports are already joined to a bar — they don't also need a cut stub.
    const joined = new Set();
    if (open) {
      const anchor = state.ports[this._vlanBusPort];
      for (const bar of box.querySelectorAll(".vbus")) {
        const vid = +bar.dataset.vlan;
        const b = geom(bar);
        const color = bar.style.getPropertyValue("--bus");
        const tagged = bar.classList.contains("tagged");
        // The face looking at the port, so the line stops AT the bar.
        const members = this._vlanBusWide
          ? this._portsOfVlan(vid)
          : (anchor ? [{ key: this._vlanBusPort, port: anchor, tagged }] : []);
        for (const m of members) {
          const pg = geom(m.port.el);
          const up = pg.y > b.y;
          const to = { x: Math.min(Math.max(pg.x, b.l + BUSGEO.EDGE), b.r - BUSGEO.EDGE),
            y: up ? b.b : b.t };
          line(pg, to, color, m.tagged);
          joined.add(m.key + "|" + vid);
        }
      }
    }
    // Cut stubs on everyone else: a short line going nowhere is the cheapest way
    // to say "this port sits on a bus" without drawing the bus for every port.
    for (const [key, p] of Object.entries(state.ports)) {
      if (!p || !p.el || !p.el.isConnected || p.otype !== "dcim.interface") continue;
      const vs = this._vlansOfPort(p.item);
      if (!vs.length) continue;
      const pg = geom(p.el);
      const dir = p.side === "t" ? -1 : 1;
      vs.forEach((m, i) => {
        if (joined.has(key + "|" + m.vlan.id)) return;
        const dx = (i - (vs.length - 1) / 2) * BUSGEO.FAN;
        line(pg, { x: pg.x + dx, y: pg.y + dir * BUSGEO.STUB },
          this._vlanColor(m.vlan), m.tagged);
      });
    }
  }

}
export const VlanBusMethods = _Mixin.prototype;
