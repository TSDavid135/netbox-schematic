"use strict";
// Wires, radio-links, routing — mixin for the SchemaManager prototype (split from schema.js).
// Methods copied into SchemaManager.prototype via _mixin (see schema.js).
import {
  $, state, mk, px, attachTip, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox } from "./schema_util.js";

class _Mixin {
  // radio-links (Wireless layer / net mode)
  // Wavy line between two wireless interfaces (radio-link has no cable → own
  // geometry). Drawn when the wireless layer is active OR net view mode is on
  // (radio links always visible there). Called from redrawWires (survive zoom)
  // and on layer/mode toggle.
  drawRadioLinks() {
    const svg = $("#wires");
    if (!svg) return;
    svg.querySelectorAll(".radiowire").forEach(el => el.remove());
    // pair source: active wireless layer, else all group radio-links (net
    // mode); physical mode without a layer draws nothing. Rebuild pairs FRESH
    // from current state.ports (mode may have overwritten ports) so we don't
    // depend on which mode renderPanel ran in.
    const a = state.activeLayer;
    let pairs = null;
    if (a && a.kind === "wireless" && a.pairs) pairs = a.pairs;
    else if (state.viewMode === "net" && this.app.layers)
      pairs = this.app.layers._collectWireless().pairs;
    if (!pairs || !pairs.length) return;
    const rect = $("#schema").getBoundingClientRect();
    const z = state.zoom, base = { left: rect.left, top: rect.top };
    const center = el => {
      const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z];
    };
    // Radio-links follow the SAME route as cables (short/extend, trunk height,
    // corridors, lanes) — just no bridges. Angular mode runs the wave along the
    // Manhattan polyline; round mode a straight wave.
    const angular = state.wireStyle === "angular";
    const extend = state.wirePath === "extend";
    const ctx = this._routeCtx();
    for (const pair of pairs) {
      const pa = state.ports[pair.a], pb = state.ports[pair.b];
      if (!pa || !pb) continue;
      const [ax, ay] = center(pa.el), [bx, by] = center(pb.el);
      const w = { a: pa, b: pb, ax, ay, bx, by,
        crossRack: this._crossRack(pa.dev.id, pb.dev.id) };
      // Detour around nodes when extend, same rack, and a straight jumper would
      // cut the node body (see _needsDetour) — then follow the route.
      const around = extend && !w.crossRack && this._needsDetour(pa, pb);
      let d;
      if (angular) {
        d = wavyAlong(this._routePolyline(w, ctx));            // wave along corners
      } else if (around) {
        d = wavyAlong(this._routePolyline(w, ctx));            // round + detour → follow route
      } else {
        d = wavyCurve(ax, ay, bx, by);                        // round → smooth curve
      }
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("class", "radiowire");
      p.dataset.wlink = pair.id;
      // Click the radio wire → same removal menu as a cable (edit only). In view
      // mode just highlight it (like a cable). pa is a live port for the link's A end.
      p.addEventListener("click", ev => {
        ev.stopPropagation();
        if (!Mode.on("schema")) { this._hoverRadio(pa, true); return; }
        this._openLinkMenu(pa.item, pa.dev, pa.el, ev, null, pair.id);
      });
      svg.appendChild(p);
    }
  }

  // wires
  redrawWires() {
    const svg = $("#wires");
    if (!svg) return;
    // Trace (single-view/chain): own render — shared cables + hairs (survives
    // zoom/redraw); the rack router doesn't apply here.
    if (state.single) { this._drawTrace(); return; }
    const canvas = $("#schema");
    svg.setAttribute("width", canvas.scrollWidth);
    svg.setAttribute("height", canvas.scrollHeight);
    svg.innerHTML = "";
    const base = canvas.getBoundingClientRect();
    const z = state.zoom;
    const center = el => {
      const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z];
    };
    // Wireless view: skip physical cables/power — only radio-links (nodes show
    // radio ports only). Don't refit contours: nodes shrink (fewer ports) →
    // contour would jump to their size. Keep physical-view geometry so the
    // contour reflects device sizes, not shrunk nodes (small_fix: contour
    // drifted when switching to wireless).
    if (state.viewMode === "net") { this.drawRadioLinks(); return; }
    // Wire style: "round" — arcs; "angular" — Manhattan routing with semicircle
    // bridges at crossings (see UI buttons).
    if (state.wireStyle === "angular") this._drawAngularWires(svg, center);
    else this._drawRoundWires(svg, center);
    // Panel power lines (feed → PDU Input) — separate pass, since a feed has no
    // state.ports entry (not a device port).
    this._drawFeedWires(svg, center);
    // Wires recreated — reapply family-filter hiding.
    if (this.app.filter) this.app.filter.apply();
    // …and active-layer highlight (else zoom cleared the layer selection).
    if (this.app.layers) this.app.layers.reapplyToWires();
    // …and pinned-trace highlight: recreated wires lost hl/dim (nodes/ports kept
    // them) → restore classes on new paths. Bug: zoom cleared wire highlight
    // while ports stayed lit.
    if (this._traceActive && this._hlCables) {
      svg.querySelectorAll("path.wire").forEach(p => {
        const mine = this._hlCables.has(+p.dataset.cable);
        p.classList.toggle("hl", mine); p.classList.toggle("dim", !mine);
      });
    }
    // Radio-links for the current mode/layer (drawRadioLinks decides whether to
    // draw). Don't call applyViewMode here — recursion via relayoutNodes.
    this.drawRadioLinks();
    // Fit server-room/site contours to their inner wires (no overflow).
    this._fitContoursToWires();
  }

  // One wire <path> with all trimmings (family color, tooltip, hover, click
  // menu). Shared by round/angular routing to avoid duplication.
  _wirePathEl(c, a, b, d, isPower) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    // Wire color by cable-type family (c.type). No type → fallback: power for
    // power, data otherwise.
    const fam = cableFamily(c.type);
    const colorCls = c.type ? "cbl-" + fam : (isPower ? "power" : "data");
    p.setAttribute("class", "wire " + colorCls);
    p.id = "w" + c.id;
    p.dataset.cable = c.id;
    // filter family: typed → by type, untyped → power/default
    p.dataset.fam = c.type ? fam : (isPower ? "power" : "default");
    attachTip(p, () => `<div class="t-title t-cabletitle"><span>Кабель #${c.id}${c.label ? " «" + c.label + "»" : ""}</span><span class="t-type"><span class="t-sw" style="background:var(--cbl-${cableFamily(c.type)})"></span>Тип: ${this._cableTypeLabel(c.type)}</span></div>
      <div class="t-line">${a.dev.name} · ${a.item.name}</div>
      <div class="mid" style="color:var(--accent)">⇅</div>
      <div class="t-line">${b.dev.name} · ${b.item.name}</div>`);
    p.addEventListener("mouseenter", () => this._hoverWire(c.id, a, b, true));
    p.addEventListener("mouseleave", () => this._hoverWire(c.id, a, b, false));
    p.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!Mode.on("schema")) { this._hoverWire(c.id, a, b, true); return; }
      this._openLinkMenu(a.item, a.dev, a.el, ev, c.id);
    });
    return p;
  }

  // Each cable → port pair {a,b} + flags, if both ends are in the DOM. Shared
  // parse for round/angular. Returns [{c,a,b,ax,ay,bx,by,isPower,crossRack}].
  _wireEnds(center) {
    const out = [];
    for (const c of state.cables) {
      const aT = (c.a_terminations || [])[0], bT = (c.b_terminations || [])[0];
      if (!aT || !bT) continue;
      // Feed↔PDU lines drawn by a separate pass (_drawFeedWires): a panel has
      // no node geometry (column/index) for the angular router → NaN in the
      // route. Skip here.
      if (aT.object_type === "dcim.powerfeed" || bT.object_type === "dcim.powerfeed") continue;
      const a = state.ports[termKey(aT)], b = state.ports[termKey(bT)];
      if (!a || !b) continue;
      const [ax, ay] = center(a.el), [bx, by] = center(b.el);
      out.push({ c, a, b, ax, ay, bx, by,
        isPower: aT.object_type.includes("power") || bT.object_type.includes("power"),
        crossRack: this._crossRack(a.dev.id, b.dev.id),
        // At least one end off-rack (consumer/provider on the right) — special
        // route (perpendicular exit with slack), see _offRackRoute.
        offRack: state.devRack[a.dev.id] == null || state.devRack[b.dev.id] == null });
    }
    return out;
  }
  // Route to an off-rack device (consumer/provider on the right). Run the
  // horizontal at the RACK end's level (its perpendicular exit lands in the gap
  // between rack nodes — clean there), covering the height difference via a
  // VERTICAL channel beside the off-rack node (empty gap between contours). So
  // the wire doesn't cut other nodes (e.g. pp-r02) or stick to their ports.
  // k — lane index (spread of parallels). small_fix.
  _offRackRoute(w, k) {
    const { a, b, ax, ay, bx, by } = w;
    const CL = 22 + (k % 5) * 11;
    const aRack = state.devRack[a.dev.id] != null;
    // rk — rack end (or a if both off-rack); of — off-rack end.
    const rk = aRack ? { x: ax, y: ay, side: a.side }
      : { x: bx, y: by, side: b.side };
    const of = aRack ? { x: bx, y: by, side: b.side, dev: b.dev }
      : { x: ax, y: ay, side: a.side, dev: a.dev };
    const rOut = rk.side === "t" ? rk.y - CL : rk.y + CL;   // horizontal level
    const oOut = of.side === "t" ? of.y - CL : of.y + CL;   // approach to off-rack port
    // Channel just LEFT of the off-rack node (in the clean gap between contours).
    const offNode = state.nodeEls[of.dev.id];
    const nodeLeft = offNode ? (parseFloat(offNode.style.left) || of.x - 40) : of.x - 40;
    const channelX = nodeLeft - 28 + (k % 4) * 9;   // slight channel spread
    return [[rk.x, rk.y], [rk.x, rOut], [channelX, rOut], [channelX, oOut], [of.x, oOut], [of.x, of.y]];
  }
  // Cross-rack ONLY if both ends are in racks. An off-rack end (devRack==null —
  // consumer/provider) → crossRack false → wire drawn as a simple curve (no
  // corridors/bus, which need devCol/devNodeIdx that off-rack nodes lack).
  _crossRack(aId, bId) {
    const ra = state.devRack[aId], rb = state.devRack[bId];
    return ra != null && rb != null && ra !== rb;
  }

  // In extend, does intra-rack wire a↔b need a side detour? Yes if another node
  // sits between them (index diff ≥ 2) OR ports don't FACE the shared gap. A
  // clean straight jumper works ONLY for adjacent nodes where the upper exits
  // from the BOTTOM and the lower enters from the TOP (both facing the gap).
  // Otherwise a straight jumper cuts the node body ("wire under node") → route
  // to the side corridor. (small_fix: detour used to fire only at index diff ≥
  // 2 — adjacent nodes with ports on the same side got cut.)
  _needsDetour(a, b) {
    const ia = state.devNodeIdx[a.dev.id], ib = state.devNodeIdx[b.dev.id];
    if (ia == null || ib == null) return false;
    if (Math.abs(ia - ib) >= 2) return true;
    const upper = ia < ib ? a : b, lower = ia < ib ? b : a;
    return !(upper.side === "b" && lower.side === "t");   // not facing the gap → detour
  }

  // Height of the trunk bus (top wires between patch panels). USED to reach
  // nearly the canvas top (too far). Now just above the top ports, stepped by
  // channel so wires hug the panels.
  _trunkBusY(ay, by, chan, hi) {
    return Math.max(6, Math.min(ay, by) - (26 + chan * 22) - (hi - 1) * 40);
  }

  // round wires: arcs/bends
  _drawRoundWires(svg, center) {
    const { LEFT_PAD } = this;
    const hi = state.wireHeightK ?? 1;
    const extend = state.wirePath === "extend";
    const ctx = this._routeCtx();   // for node detours in extend
    let chan = 0, lane = 0;
    for (const w of this._wireEnds(center)) {
      const { c, a, b, ax, ay, bx, by, isPower, crossRack, offRack } = w;
      let d;
      if (offRack) {
        // Off-rack device: horizontal at rack-port level (in the gap between
        // nodes) + vertical channel at the off-rack node — doesn't cut other
        // nodes or stick to their ports.
        d = smoothPath(this._offRackRoute(w, lane++), 16);
      } else if (crossRack && state.devNodeIdx[a.dev.id] === 0 && state.devNodeIdx[b.dev.id] === 0) {
        const lift = this._trunkBusY(ay, by, chan++, hi);
        d = cubicPath(ax, ay, bx, by, lift, lift);
      } else if (crossRack) {
        const leftCol = Math.min(state.devCol[a.dev.id], state.devCol[b.dev.id]);
        // More corridor lanes (9 vs 8) and MORE exit-height levels (6 vs 3),
        // with source and sink exits DE-correlated ((k+3)%6) so horizontal runs
        // of adjacent wires don't land at the same height (small_fix: wires
        // still overlapped).
        const k = lane++;
        const gapX = this._colX(leftCol) + this.SLOT + COL_GAP / 2 + (k % 9) * 15 - 60;
        const aOut = a.side === "t" ? ay - (18 + (k % 6) * 10) * hi : ay + (18 + (k % 6) * 10) * hi;
        const bOut = b.side === "t" ? by - (18 + ((k + 3) % 6) * 10) * hi : by + (18 + ((k + 3) % 6) * 10) * hi;
        d = orthoPath(ax, ay, bx, by, gapX, aOut, bOut);
      } else if (extend && this._needsDetour(a, b)) {
        // Extend in round mode: side-corridor node detour but with ROUNDED
        // corners (smooth curve, not right angles).
        d = smoothPath(this._routePolyline(w, ctx));
      } else {
        const midBend = (ay < by ? 1 : -1) * (40 + (c.id % 4) * 8) * hi;
        d = cubicPath(ax, ay, bx, by, ay + midBend, by - midBend);
      }
      svg.appendChild(this._wirePathEl(c, a, b, d, isPower));
    }
  }

  // Polylines (point arrays) of all cables for the current route (short/extend).
  //  · trunk — top bus (see _trunkBusY);
  //  · cross-rack — via side vertical corridor gapX (no nodes there);
  //  · intra-rack:
  //      short  — straight jumper at mid height (may cross a node);
  //      extend — DETOUR around nodes: exit past edge → column side corridor → enter.
  //    Corridor verticals spread across lanes so parallel links run side by
  //    side, not inside each other (small_fix: wires item 2).
  _wirePolylines(center) {
    const ctx = this._routeCtx();
    return this._wireEnds(center).map(w => ({ ...w, pts: this._routePolyline(w, ctx) }));
  }

  // Routing context: lane multipliers/counters for spreading parallel wires.
  // One per pass (cables / radio).
  _routeCtx() {
    // Right edge of nodes per column (real DOM geometry) so the extend side
    // corridor runs RIGHT of even a wide node (many ports) and the wire doesn't
    // pass UNDER it (small_fix: wire under node in extend). Key — column number
    // (state.devCol), value — max(left+width) of its nodes.
    const colRight = {};
    for (const id in state.nodeEls) {
      const col = state.devCol[id];
      if (col == null) continue;
      const el = state.nodeEls[id];
      const right = (parseFloat(el.style.left) || 0) + (parseFloat(el.style.width) || 0);
      if (right > (colRight[col] ?? -Infinity)) colRight[col] = right;
    }
    return { LEFT_PAD: this.LEFT_PAD, hi: state.wireHeightK ?? 1,
      extend: state.wirePath === "extend", chan: 0, lane: 0, slane: 0, idx: 0, colRight };
  }

  // Polyline of ONE link for the current route. Shared by cables and radio so
  // all transforms (short/extend, trunk height, corridors, lanes) apply to
  // Wireless too. Bridges aren't part of the result — only the cable drawer
  // adds them (radio has none).
  _routePolyline(w, ctx) {
    const { a, b, ax, ay, bx, by, crossRack, offRack } = w;
    const { LEFT_PAD, hi, extend } = ctx;
    const vary = w.c ? w.c.id : ctx.idx++;   // radio has no c.id — use index
    // Off-rack device — horizontal at rack-port level + channel at the off-rack
    // node (see _offRackRoute) to avoid cutting other nodes.
    if (offRack) return this._offRackRoute(w, ctx.lane++);
    if (crossRack && state.devNodeIdx[a.dev.id] === 0 && state.devNodeIdx[b.dev.id] === 0) {
      const busY = this._trunkBusY(ay, by, ctx.chan++, hi);
      return [[ax, ay], [ax, busY], [bx, busY], [bx, by]];
    }
    if (crossRack) {
      const leftCol = Math.min(state.devCol[a.dev.id], state.devCol[b.dev.id]);
      const k = ctx.lane++;
      const gapX = this._colX(leftCol) + this.SLOT + COL_GAP / 2 + (k % 9) * 15 - 60;
      const aOut = a.side === "t" ? ay - (18 + (k % 6) * 10) * hi : ay + (18 + (k % 6) * 10) * hi;
      const bOut = b.side === "t" ? by - (18 + ((k + 3) % 6) * 10) * hi : by + (18 + ((k + 3) % 6) * 10) * hi;
      return [[ax, ay], [ax, aOut], [gapX, aOut], [gapX, bOut], [bx, bOut], [bx, by]];
    }
    if (extend && this._needsDetour(a, b)) {
      // Extend: the wire NEVER runs over a node — it exits past the edge and
      // rises/descends in the column side corridor (no nodes there). Detour if
      // another node sits between them OR ports don't face the shared gap (else
      // a straight jumper cuts the node body — "wire under node"); see _needsDetour.
      const col = state.devCol[a.dev.id];
      const k = ctx.slane++;
      // Corridor RIGHT of the real right edge of all column nodes (not the
      // column grid): a wide node (many ports) no longer covers the wire.
      // Fallback to the grid if node geometry is missing.
      const colEdge = (ctx.colRight && ctx.colRight[col] != null)
        ? ctx.colRight[col] : this._colX(col) + this.SLOT;
      const corr = colEdge + 16 + (k % 6) * 12;
      const aOut = a.side === "t" ? ay - (16 + (k % 3) * 6) : ay + (16 + (k % 3) * 6);
      const bOut = b.side === "t" ? by - (16 + (k % 3) * 6) : by + (16 + (k % 3) * 6);
      return [[ax, ay], [ax, aOut], [corr, aOut], [corr, bOut], [bx, bOut], [bx, by]];
    }
    // short: straight jumper at mid height.
    const aOut = a.side === "t" ? ay - (14 + (vary % 3) * 6) * hi : ay + (14 + (vary % 3) * 6) * hi;
    const bOut = b.side === "t" ? by - (14 + (vary % 3) * 6) * hi : by + (14 + (vary % 3) * 6) * hi;
    const busY = (aOut + bOut) / 2;
    return [[ax, ay], [ax, busY], [bx, busY], [bx, by]];
  }

  // angular wires: Manhattan routing + bridges
  // Horizontal runs crossing OTHER verticals hop them with a semicircle bridge
  // (hopSegment) so wires don't merge. Nearby crossings combine into one wide
  // bridge (see hopSegment).
  _drawAngularWires(svg, center) {
    const polys = this._wirePolylines(center);
    // Vertical segments of all polylines — obstacles for bridges.
    const verts = [];
    for (const pl of polys)
      for (let i = 1; i < pl.pts.length; i++) {
        const [x1, y1] = pl.pts[i - 1], [x2, y2] = pl.pts[i];
        if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) > 0.5)
          verts.push({ x: x1, y1: Math.min(y1, y2), y2: Math.max(y1, y2), id: pl.c.id });
      }
    // Build d: verticals straight, horizontals bridge over foreign ones.
    for (const pl of polys) {
      const p0 = pl.pts[0];
      let d = `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`;
      for (let i = 1; i < pl.pts.length; i++) {
        const [x1, y1] = pl.pts[i - 1], [x2, y2] = pl.pts[i];
        if (Math.abs(y1 - y2) < 0.5 && Math.abs(x1 - x2) > 0.5) {
          const xs = verts.filter(v => v.id !== pl.c.id
            && v.x > Math.min(x1, x2) + 1 && v.x < Math.max(x1, x2) - 1
            && y1 > v.y1 - 0.5 && y1 < v.y2 + 0.5).map(v => v.x);
          d += hopSegment(x1, y1, x2, xs);
        } else {
          d += ` L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        }
      }
      svg.appendChild(this._wirePathEl(pl.c, pl.a, pl.b, d, pl.isPower));
    }
  }

}
export const WireMethods = _Mixin.prototype;
