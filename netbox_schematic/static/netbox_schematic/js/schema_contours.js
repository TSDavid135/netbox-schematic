"use strict";
// Server-room/site contours (scope) — mixin for the SchemaManager prototype (split from schema.js).
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
  // Dashed wrapper contours over the rack row by hierarchy level of the chosen
  // scope (state.scope): site → each of its server rooms boxed; region → also
  // each site (server rooms inside). A location (one server room) draws without
  // outer contours. Racks are pre-sorted site→room→rack (see
  // TreeManager._racksFor) → group columns are contiguous, contour = rectangle
  // from minCol to maxCol.
  _renderScopeContours(canvas, group, rackMeta) {
    this._contours = [];   // reset refs (survive redrawWires for fit)
    const scope = state.scope;
    if (!scope || scope.type === "location" || scope.type === "rack" || !group.length) return;
    const { LEFT_PAD, TOP_PAD } = this;
    const top0 = TOP_PAD - 34;   // top of rack box
    const boxOf = (racks, padX, padTop, padBot) => {
      const cols = racks.map(r => rackMeta[r.id].col);
      const minCol = Math.min(...cols), maxCol = Math.max(...cols);
      const left = this._colX(minCol);
      const right = this._colX(maxCol) + this.SLOT + BOX_PAD;
      const bottom = Math.max(...racks.map(r => rackMeta[r.id].bottom));
      return { left: left - padX, top: top0 - padTop,
        width: (right - left) + padX * 2, height: (bottom - top0) + padTop + padBot };
    };
    // Location contours (server rooms) — base geometry. Their growth to fit
    // inner wires is computed in _fitContoursToWires (phase 1).
    const locs = [];
    for (const [lid, racks] of groupByKey(group, r => r.location && r.location.id)) {
      if (lid == null) continue;
      const loc = racks[0].location;
      const base = boxOf(racks, 13, 22, 12);
      // Server-room column range — for horizontal clamp so the frame doesn't
      // spill into a neighbor room's columns (see _fitContoursToWires).
      const cols = racks.map(r => rackMeta[r.id].col);
      const el = this._contourEl("gb-loc", "серверная " + (loc ? loc.name : "?"), base);
      locs.push({ el, base, kind: "loc", locId: lid, locName: loc ? loc.name : "",
        minCol: Math.min(...cols), maxCol: Math.max(...cols),
        rackIds: new Set(racks.map(r => r.id)),
        siteId: racks[0].site && racks[0].site.id });
    }
    // Site contours — for region AND site-group (both may span several sites).
    // Geometry is NOT from racks but the UNION of already-grown location
    // contours (phase 2) so a site always encloses its server rooms without
    // overlapping them (small_fix item 2).
    const sites = [];
    if (scope.type === "region" || scope.type === "sitegroup") {
      for (const [, racks] of groupByKey(group, r => r.site && r.site.id)) {
        const site = racks[0].site;
        const base = boxOf(racks, 28, 48, 26);
        const el = this._contourEl("gb-site", "площадка " + (site ? site.name : "?"), base);
        sites.push({ el, base, kind: "site", rackIds: new Set(racks.map(r => r.id)),
          children: locs.filter(c => c.siteId === (site && site.id)) });
      }
    }
    this._contours = [...sites, ...locs];
    // z-order: sites into DOM first (behind), then server rooms (above), all
    // BEFORE racks (behind nodes) so frames/labels don't cover nodes.
    const frag = document.createDocumentFragment();
    for (const ct of [...sites, ...locs]) frag.appendChild(ct.el);
    canvas.insertBefore(frag, canvas.firstChild);
    this._fitContoursToWires();   // in case wires are already drawn
  }
  _contourEl(cls, label, g) {
    return mk("div", { className: "groupbox " + cls,
      html: `<span class="gb-label">${label}</span>`,
      style: { left: g.left + "px", top: g.top + "px", width: g.width + "px", height: g.height + "px" } });
  }

  // Lays out contours in TWO phases so levels don't overlap (small_fix item 2)
  // and inter-site wires don't pull the frame inward (item 3). All in schema
  // coords (getBBox = userspace, CSS-zoom independent). Idempotent.
  //  Phase 1 — server rooms: frame grows to fit its INNER wires (both ends in
  //    this room). Wires to another room/site exit outward.
  //  Phase 2 — sites: frame = UNION of grown server rooms inside it (+ pad) →
  //    site always encloses its rooms; plus intra-site wires (both ends in this
  //    site). Wires between different sites don't move the frame (item 3: the
  //    "inner" mechanism doesn't apply to them).
  _fitContoursToWires() {
    const list = this._contours;
    if (!list || !list.length) return;
    const svg = $("#wires");
    const paths = svg ? svg.querySelectorAll("path.wire") : [];
    // Cable → rack pair of its ends (to test "is it an inner wire").
    const cableRacks = {};
    for (const c of state.cables) {
      const aT = (c.a_terminations || [])[0], bT = (c.b_terminations || [])[0];
      if (!aT || !bT) continue;
      const a = state.ports[termKey(aT)], b = state.ports[termKey(bT)];
      if (a && b) cableRacks[c.id] = [state.devRack[a.dev.id], state.devRack[b.dev.id]];
    }
    // Grow box by all wires INNER to the rackIds set.
    const growByInnerWires = (box, rackIds, pad) => {
      let x0 = box.left, y0 = box.top, x1 = box.left + box.width, y1 = box.top + box.height;
      for (const p of paths) {
        const rr = cableRacks[+p.dataset.cable];
        if (!rr || !rackIds.has(rr[0]) || !rackIds.has(rr[1])) continue;
        let bb; try { bb = p.getBBox(); } catch { continue; }
        x0 = Math.min(x0, bb.x - pad); y0 = Math.min(y0, bb.y - pad);
        x1 = Math.max(x1, bb.x + bb.width + pad); y1 = Math.max(y1, bb.y + bb.height + pad);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    };
    // Grow box to the REAL node geometry of rackIds. A node is centered in its
    // column and with many ports gets wider than COL_W → spills past the
    // column-based contour (small_fix "Pro schema" item 1). Use actual node
    // left/width/top/height (unscaled — like box).
    const growByNodes = (box, rackIds, pad) => {
      let x0 = box.left, y0 = box.top, x1 = box.left + box.width, y1 = box.top + box.height;
      for (const [id, node] of Object.entries(state.nodeEls)) {
        if (!rackIds.has(state.devRack[+id])) continue;
        const nl = parseFloat(node.style.left) || 0, nt = parseFloat(node.style.top) || 0;
        const nw = parseFloat(node.style.width) || 0, nh = node.offsetHeight || 56;
        // +13 top/bottom — port rows stick out past the node box (top/bottom:-13px).
        x0 = Math.min(x0, nl - pad); y0 = Math.min(y0, nt - 13 - pad);
        x1 = Math.max(x1, nl + nw + pad); y1 = Math.max(y1, nt + nh + 13 + pad);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    };
    // Off-rack devices (consumers) now sit BELOW the racks of THEIR server room
    // (see _renderOffRack), grouped into type contours. The room frame grows
    // DOWN over these contours (state.offContours[locId]) — devices end up
    // INSIDE their room. Key — location id (numeric ct.locId → string key).
    const offByLoc = state.offContours || {};
    // Location power panels (boxes below racks) — the room contour must ENCLOSE
    // them (small_fix: with Site selected, panels inside the contour). Boxes —
    // state.powerBoxEls[panel.id], bound to location via panel.location.id.
    const panelsByLoc = {};
    for (const p of (state.powerPanels || [])) {
      const box = (state.powerBoxEls || {})[p.id];
      const lid = p.location && p.location.id;
      if (box && lid != null) (panelsByLoc[lid] = panelsByLoc[lid] || []).push(box);
    }
    // Grow box to arbitrary node geometry (off-rack) — like growByNodes but
    // over an explicit element list, not rackIds.
    const growByEls = (box, els, pad) => {
      let x0 = box.left, y0 = box.top, x1 = box.left + box.width, y1 = box.top + box.height;
      for (const node of els) {
        const nl = parseFloat(node.style.left) || 0, nt = parseFloat(node.style.top) || 0;
        const nw = parseFloat(node.style.width) || 0, nh = node.offsetHeight || 56;
        x0 = Math.min(x0, nl - pad); y0 = Math.min(y0, nt - 13 - pad);
        x1 = Math.max(x1, nl + nw + pad); y1 = Math.max(y1, nt + nh + 13 + pad);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    };
    const apply = ct => {
      ct.el.style.left = ct._box.left + "px"; ct.el.style.top = ct._box.top + "px";
      ct.el.style.width = ct._box.width + "px"; ct.el.style.height = ct._box.height + "px";
    };
    // With MULTIPLE server rooms, clamp each frame horizontally to ITS location
    // band (racks + off-rack pocket); otherwise growth for wires/panels could
    // push the frame into a neighbor room's band and it would look INSIDE it
    // (bug "location inside location"). Neighbor bands are spread by a pre-pass
    // (_computeLocGeometry, AREA_SEP).
    const multiLoc = list.filter(c => c.kind === "loc").length > 1;
    const clampX = ct => {
      if (!multiLoc) return;
      const g = (this._locGeom || {})[ct.locId];
      if (!g) return;
      const bandLeft = this._colX(g.minCol) - COL_GAP / 2;
      const bandRight = g.areaW ? g.devX + g.areaW + 24
        : this._colX(g.maxCol) + this.SLOT + COL_GAP / 2;
      const left = Math.max(ct._box.left, bandLeft);
      const right = Math.min(ct._box.left + ct._box.width, bandRight);
      ct._box = { ...ct._box, left, width: Math.max(0, right - left) };
    };
    // Phase 1 — server rooms: frame grows to fit inner wires, its rack nodes
    // (wide nodes must not spill — small_fix item 1), AND off-rack devices of
    // this location (consumers right / provider top — inside the contour).
    for (const ct of list) {
      if (ct.kind !== "loc") continue;
      ct._box = growByNodes(growByInnerWires(ct.base, ct.rackIds, 8), ct.rackIds, 6);
      const offEls = offByLoc[ct.locId];
      if (offEls && offEls.length) ct._box = growByEls(ct._box, offEls, 16);
      // Location panels — pad 22 to also cover their "Power panels" label on top.
      const panelEls = panelsByLoc[ct.locId];
      if (panelEls && panelEls.length) ct._box = growByEls(ct._box, panelEls, 22);
      clampX(ct);
      apply(ct);
    }
    // Phase 2 — sites: union of grown server rooms + inner wires + nodes
    // (safety for room-less racks not caught by a loc contour).
    for (const ct of list) {
      if (ct.kind !== "site") continue;
      const childBoxes = ct.children.map(c => c._box).filter(Boolean);
      // padTop 40 — so the dashed top and "site …" label sit above the server
      // room's top edge and label (no overlap).
      const base = unionBox(childBoxes, 15, 40, 15) || ct.base;
      ct._box = growByNodes(growByInnerWires(base, ct.rackIds, 10), ct.rackIds, 6);
      apply(ct);
    }
  }

}
export const ContourMethods = _Mixin.prototype;
