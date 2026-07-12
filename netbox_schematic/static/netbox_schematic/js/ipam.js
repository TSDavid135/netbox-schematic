"use strict";
// IpamCanvas: the "Network / IPAM" canvas.
// Inverted model: blocks are PLACES (Region ⊃ Site/SiteGroup ⊃ Location,
// dashed, like on Infrastructure); inside a place — NETWORKS (blue dashed),
// bound via the native NetBox field `prefix.scope` (region/site/location).
// Inside a network — occupied addresses + a free-address counter.
//
// Network↔place link is `prefix.scope` (scope_type + scope_id). Dragging a
// network into a place = PATCH scope → a REAL DB record, not coordinates.
// A network in two places is drawn in both (normal). Left tree — same place
// hierarchy + networks. Edit/view modes — body.ipam-edit class (view: look;
// edit: drag + create).

import { $, state, mk, modeBtn, slugify, attachPinchZoom } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";

// CIDR utilities (uint32)
function parseCidr(cidr) {
  const [addr, nStr] = cidr.split("/");
  const bits = Number.parseInt(nStr, 10);
  const parts = addr.split(".").map(Number);
  if (parts.length === 4 && parts.every(x => x >= 0 && x <= 255)) {
    const base = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
    return { base, bits, size: 2 ** (32 - bits), v4: true };
  }
  return { base: 0, bits, size: 2 ** Math.max(0, 64 - bits), v4: false };
}
const maskOf = bits => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);
const inNet = (net, addrBase) => (net.base & maskOf(net.bits)) === (addrBase & maskOf(net.bits));

// NetBox scope_type → internal place key
const SCOPE_KEY = { "dcim.region": "region", "dcim.site": "site", "dcim.sitegroup": "sitegroup", "dcim.location": "location" };

export class IpamCanvas {
  constructor(app) {
    this.app = app;
    this.drag = null;
    this.dragged = false;   // a drag happened → suppress the click after mouseup
    this._lastNet = null;   // open details {n, place} — for re-render
    this.focusedId = null;  // selected place id (kind+id) — canvas builds the schema ONLY for it (lazy render, as on Infrastructure)
    this.zoom = 1;          // canvas scale (wheel); pan via #ipam-scroll scrolling
    this.collapsed = new Set();   // collapsed group-folder ids in the tree (survives renderTree)
    this.selectMode = false;      // "Выбрать" — multi-select of tree networks
    this.selNets = new Map();     // selected prefix id → network object
    this.moveMode = false;        // "Перенести" — pick a target place for the selected nets
    this._armedTarget = null;     // armed move-target element; ._armedPlace = its place (null → вне мест)
    this._armedPlace = null;
    // "Сюда" (drop here) ghost while dragging a network: mouseover bubbles →
    // closest(".place") gives the DEEPEST place under cursor (region ⊃ site ⊃ location).
    this._dragOver = e => {
      if (!this.drag && !this._placeDrag) return;   // "Сюда" ghost for both networks and places
      this._setDropTarget(e.target.closest ? e.target.closest(".place, .it-node") : null);
    };
    // DETAILS mode (its own column) → re-render open details (edit buttons).
    Mode.onChange("ipamdetail", () => {
      if (this._lastNet) this._showNet(this._lastNet.n, this._lastNet.place);
    });
    this._enablePanZoom();
    // Right-click on an EMPTY spot of the "Places and networks" tree → create
    // menu (group/site). Nodes/networks have their own menu — bail via closest.
    const side = $("#side-ipam");
    if (side) side.addEventListener("contextmenu", e => {
      if (e.target.closest(".it-node, .it-net, .net-chip, .modebtn")) return;
      this._emptyMenu(e);
    });
    const selBtn = document.getElementById("ipam-select-btn");
    if (selBtn) selBtn.addEventListener("click", () => this._toggleSelectMode());
    // In "Выбрать" mode a single capture-phase guard cancels EVERY element handler
    // in the tree (place focus, network details, drag, context menu) — a click only
    // toggles a network's selection; the folder chevron still collapses (navigation).
    const treeHost = document.getElementById("ipam-tree-side");
    if (treeHost) {
      treeHost.addEventListener("click", ev => {
        if (!this.selectMode) return;
        if (this.moveMode) {                 // move mode: tap a target to arm it, swallow the rest
          ev.stopPropagation();
          const tgt = ev.target.closest(".move-target");
          if (tgt) this._armMoveTarget(tgt);
          return;
        }
        if (ev.target.closest(".it-chevron")) return;
        ev.stopPropagation();
        const el = ev.target.closest(".it-net, .net-chip");
        if (el && el._net) this._toggleNetSel(el, el._net);
      }, true);
      treeHost.addEventListener("contextmenu", ev => {
        if (this.selectMode) { ev.stopPropagation(); ev.preventDefault(); }
      }, true);
    }
  }

  // Zoom/pan of the "Networks" canvas, as on Infrastructure. Wheel — zoom to
  // the cursor; dragging the BACKGROUND (not a network) — pan (scrollLeft/Top).
  // Network drags start on .net-block/.net-chip themselves → no pan there.
  _enablePanZoom() {
    const scroll = $("#ipam-scroll");
    if (!scroll) return;
    let panning = false, sx = 0, sy = 0, sl = 0, st = 0;
    scroll.addEventListener("mousedown", ev => {
      if (ev.button !== 0) return;
      // No pan on network drag HANDLES (plain net-block, chip, contour corner).
      // The contour body and nested locations may start a pan.
      if (ev.target.closest(".net-block:not(.net-contour), .net-chip, .nc-corner")) return;
      panning = true; sx = ev.clientX; sy = ev.clientY;
      sl = scroll.scrollLeft; st = scroll.scrollTop;
      scroll.classList.add("panning");
    });
    window.addEventListener("mousemove", ev => {
      if (!panning) return;
      scroll.scrollLeft = sl - (ev.clientX - sx);
      scroll.scrollTop = st - (ev.clientY - sy);
    });
    window.addEventListener("mouseup", () => {
      if (panning) { panning = false; scroll.classList.remove("panning"); }
    });
    // Keep contour titles visible while panning/zooming — slide each along its own
    // top border (CSS `position: sticky` can't: the #ipam-clouds transform breaks it).
    scroll.addEventListener("scroll", () => this._scheduleStick());
    window.addEventListener("resize", () => this._scheduleStick());
    scroll.addEventListener("wheel", ev => {
      ev.preventDefault();
      const prev = this.zoom;
      this.zoom = Math.min(2.5, Math.max(0.3, this.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const rect = scroll.getBoundingClientRect();
      const cx = scroll.scrollLeft + (ev.clientX - rect.left);
      const cy = scroll.scrollTop + (ev.clientY - rect.top);
      const k = this.zoom / prev;
      this._applyZoom();
      scroll.scrollLeft = cx * k - (ev.clientX - rect.left);
      scroll.scrollTop = cy * k - (ev.clientY - rect.top);
    }, { passive: false });
    // Two-finger pinch-zoom — the SHARED helper (identical to Инфраструктура),
    // so touch works the same everywhere. Needs #ipam-scroll touch-action:pan-*.
    attachPinchZoom(scroll, {
      getZoom: () => this.zoom,
      setZoom: z => { this.zoom = z; },
      applyZoom: () => this._applyZoom(),
      onEnd: () => this._scheduleStick(),
    });
    this._applyZoom();
  }
  _applyZoom() {
    const c = $("#ipam-clouds");
    if (c) c.style.transform = "scale(" + this.zoom + ")";
    this._scheduleStick();
  }
  // rAF-throttled reposition of the contour titles.
  _scheduleStick() {
    if (this._stickRaf) return;
    this._stickRaf = requestAnimationFrame(() => { this._stickRaf = null; this._stickTitles(); });
  }
  // Slide each contour title along the VISIBLE part of its top border: pinned to
  // the left of the viewport once the contour's left edge scrolls off, and stopped
  // at the right corner when the contour scrolls further. Coordinates are read via
  // getBoundingClientRect (already scaled by the zoom transform) and converted back
  // to the title's local (unscaled) left.
  _stickTitles() {
    const scroll = $("#ipam-scroll");
    if (!scroll) return;
    const vr = scroll.getBoundingClientRect();
    const z = this.zoom || 1;
    const PAD = 8, EDGE = 14 * z;              // keep clear of the rounded corners
    for (const cap of scroll.querySelectorAll(".place-cap")) {
      const place = cap.parentElement;
      if (!place) continue;
      const pr = place.getBoundingClientRect();
      const capW = cap.offsetWidth * z;        // offsetWidth ignores the transform → scale it
      const lo = pr.left + EDGE;               // title at the left corner (default)
      const hi = pr.right - capW - EDGE;       // title pinned at the right corner
      let screenLeft = Math.max(lo, vr.left + PAD);
      screenLeft = hi >= lo ? Math.min(screenLeft, hi) : lo;   // don't overrun a narrow contour
      cap.style.left = ((screenLeft - pr.left) / z) + "px";
    }
  }

  // Drop-target highlight while dragging a network (one active at a time):
  //  · place (.place on canvas) — .drop-ok frame + gray "Сюда" ghost in its body;
  //  · tree node (.it-node) — accent stripe .drop-hl.
  // As on Infrastructure: shows where the object will land on release.
  _setDropTarget(el) {
    if (this._dropEl === el) return;
    document.querySelectorAll(".place.drop-ok, .it-node.drop-hl")
      .forEach(x => x.classList.remove("drop-ok", "drop-hl"));
    if (this._ghost) { this._ghost.remove(); this._ghost = null; }
    this._dropEl = el || null;
    if (!el) return;
    if (el.classList.contains("it-node")) {
      el.classList.add("drop-hl");
    } else {
      el.classList.add("drop-ok");
      const body = el.querySelector(":scope > .place-body");
      if (body) { this._ghost = mk("div", { className: "net-ghost", text: "Сюда" }); body.appendChild(this._ghost); }
    }
  }

  // Each column has its OWN edit mode (as on Infrastructure): canvas (ipam),
  // "Places and networks" tree (ipamtree), network details (ipamdetail).
  _editCanvas() { return Mode.on("ipam"); }
  // The tree has no mode toggle (removed) — editing (drag networks, right-click
  // create) is always available, like the Infrastructure tree; a plain click
  // still opens details (drag only starts past the move threshold).
  _editTree() { return true; }
  _editDetail() { return Mode.on("ipamdetail"); }

  async load() {
    setStatus("загружаю адресное пространство…");
    try {
      const [regions, groups, sites, locations, prefixes, ips] = await Promise.all([
        apiAll("/dcim/regions/"), apiAll("/dcim/site-groups/"), apiAll("/dcim/sites/"),
        apiAll("/dcim/locations/"), apiAll("/ipam/prefixes/"), apiAll("/ipam/ip-addresses/"),
      ]);
      Object.assign(state, { ipamRegions: regions, ipamGroups: groups, ipamSites: sites,
        ipamLocations: locations, ipamPrefixes: prefixes, ipamIps: ips });
      this._build();
      this.renderTree();
      this.render();
      if (this._lastNet) this._refreshDetail();   // network data may have changed
      setStatus(`${prefixes.length} сетей · ${locations.length} локаций · ${sites.length} площадок`, "ok");
    } catch (e) {
      setStatus("ошибка IPAM: " + e.message, "err");
    }
  }

  // Build the PLACES tree and distribute networks by scope.
  _build() {
    // occupied-IP indexes per prefix come later; place nodes first
    const mkPlace = (kind, obj) => ({ kind, obj, id: kind + obj.id, name: obj.name, children: [], nets: [] });
    // Region is NOT a hierarchy level (folders = nested site groups; groups have
    // a parent). Networks scoped to a region end up "outside places".
    const groups = state.ipamGroups.map(g => mkPlace("sitegroup", g));
    const sites = state.ipamSites.map(s => mkPlace("site", s));
    const locations = state.ipamLocations.map(l => mkPlace("location", l));

    const byKey = new Map();
    [...groups, ...sites, ...locations].forEach(n => byKey.set(n.kind + ":" + n.obj.id, n));

    const roots = [];
    // site groups: nested by parent (folder in folder), root ones → roots
    for (const g of groups) {
      const pid = g.obj.parent && g.obj.parent.id;
      const parent = pid && byKey.get("sitegroup:" + pid);
      if (parent) parent.children.push(g); else roots.push(g);
    }
    // sites: into their group, else to root
    for (const s of sites) {
      const gp = s.obj.group && byKey.get("sitegroup:" + s.obj.group.id);
      (gp || { children: roots }).children.push(s);
    }
    // locations (server rooms): into their site, else to root
    for (const l of locations) {
      const sp = l.obj.site && byKey.get("site:" + l.obj.site.id);
      (sp || { children: roots }).children.push(l);
    }

    // networks by scope → into their place
    const netList = state.ipamPrefixes.map(p => ({ p, cidr: parseCidr(p.prefix) }));
    for (const { p, cidr } of netList) {
      if (!p.scope_type || !p.scope_id) continue;
      const key = SCOPE_KEY[p.scope_type];
      if (!key) continue;
      const place = byKey.get(key + ":" + p.scope_id);
      if (place) place.nets.push({ p, cidr, ...this._netUsage(p, cidr) });
    }
    // unscoped networks — "outside places"
    this.freeNets = netList
      .filter(({ p }) => !p.scope_type || !p.scope_id || !SCOPE_KEY[p.scope_type]
        || !byKey.get(SCOPE_KEY[p.scope_type] + ":" + p.scope_id))
      .map(({ p, cidr }) => ({ p, cidr, ...this._netUsage(p, cidr) }));

    // Sorting. As on Infrastructure: within a node sites/locations come first,
    // SUBGROUPS (folders) go LAST. A folder in the middle is confusing — the
    // parent's following items look like they belong inside it.
    const kindRank = { location: 0, site: 1, sitegroup: 2 };
    const byKindThenName = (a, b) =>
      (kindRank[a.kind] - kindRank[b.kind]) || a.name.localeCompare(b.name);
    const sortPlace = n => { n.children.sort(byKindThenName);
      n.nets.sort((a, b) => a.cidr.base - b.cidr.base); n.children.forEach(sortPlace); };
    roots.sort(byKindThenName);
    roots.forEach(sortPlace);
    this.roots = roots;
  }

  // Network's occupied IPs + free count (by direct CIDR membership).
  _netUsage(p, cidr) {
    const occupied = state.ipamIps
      .map(ip => ({ ip, c: parseCidr(ip.address) }))
      .filter(x => x.c.v4 && inNet(cidr, x.c.base));
    const used = occupied.length;
    // size minus network/broadcast for /<31
    const usable = cidr.bits <= 30 ? Math.max(0, cidr.size - 2) : cidr.size;
    return { occupied: occupied.map(x => x.ip), used, freeCount: Math.max(0, usable - used) };
  }

  // left tree: places with their networks inside
  renderTree() {
    const host = $("#ipam-tree-side");
    if (!host) return;
    host.innerHTML = "";
    const list = mk("div", { className: "it-list" });
    for (const r of this.roots) list.appendChild(this._treeNode(r, 0));
    host.appendChild(list);
    if (this.freeNets.length) {
      host.appendChild(mk("div", { className: "it-sub", text: "Сети вне мест" }));
      const free = mk("div", { className: "it-free" });
      for (const n of this.freeNets) free.appendChild(this._netChip(n, null, true));
      host.appendChild(free);
    }
    this._markLoadedTree();   // highlight the loaded place (survives tree rebuild)
  }

  _treeNode(node, depth) {
    // Same icons as the Infrastructure tree (tree.js): 📁 site group,
    // 🗺 site, 📍 location. Colors come from CSS (.it-node.k-* .mdi).
    const icon = { region: "map-marker-radius", sitegroup: "folder-outline", site: "map-outline", location: "map-marker" }[node.kind] || "";
    // Folders (site groups) are collapsible, as on Infrastructure: a separate
    // chevron button (clicking it collapses without touching focus).
    const isFolder = node.kind === "sitegroup";
    const collapsed = isFolder && this.collapsed.has(node.id);
    const chevron = isFolder
      ? `<button class="it-chevron" tabindex="-1" title="Свернуть / развернуть"><i class="mdi mdi-chevron-${collapsed ? "right" : "down"}"></i></button>`
      : "";
    // Place node: click — focus; while dragging a network — a drop target
    // (.drop-hl highlight; release LMB on the node → network binds to this place).
    const row = mk("div", { className: "it-node k-" + node.kind + (collapsed ? " collapsed" : ""),
      dataset: { place: node.id },   // to highlight the loaded schema (_markLoadedTree)
      style: { paddingLeft: (8 + depth * 14) + "px" },
      html: `${chevron}<i class="mdi mdi-${icon}"></i><span class="it-name">${node.name}</span>`,
      on: {
        click: () => { if (!this.dragged) this._focusPlace(node); },
        contextmenu: e => this._menu(e, node),
      } });
    if (isFolder) {
      const chev = row.querySelector(".it-chevron");
      if (chev) chev.addEventListener("click", e => { e.stopPropagation(); this._toggleCollapse(node.id); });
    }
    row._placeNode = node;   // network drop target (highlight/drop — _setDropTarget/onUp)
    const wrap = mk("div", {}, row);
    if (collapsed) return wrap;   // collapsed — skip networks and nested places
    for (const n of node.nets) {
      // Network in the tree: click — details; in edit mode draggable onto place
      // nodes (same mechanics as rooms on Infrastructure).
      const netEl = mk("div", { className: "it-net" + (this.selNets.has(n.p.id) ? " sel" : ""), dataset: { place: node.id },   // for muted-highlight of the loaded place
        style: { paddingLeft: (8 + (depth + 1) * 14) + "px" },
        html: `<i class="mdi mdi-ip-network"></i><span>${n.p.prefix}</span>`, on: {
          click: () => { if (!this.dragged) this._showNet(n, node); },
          contextmenu: e => this._netMenu(e, n, node),   // item 3: edit/unassign/delete
        } });
      netEl._net = n;   // for the select-mode capture guard
      this._makeNetDraggable(netEl, n, node, true);   // network in the tree
      wrap.appendChild(netEl);
    }
    // If the place HAS networks, indent nested places one level DEEPER than the
    // networks so they read as "under the network" (like locations inside a
    // site's network on the canvas). No networks — normal indent.
    const childDepth = node.nets.length ? depth + 2 : depth + 1;
    for (const ch of node.children) wrap.appendChild(this._treeNode(ch, childDepth));
    return wrap;
  }
  // Collapse/expand a group folder and re-render the tree.
  _toggleCollapse(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.renderTree();
  }

  // ── "Выбрать": multi-select of tree networks → batch unassign / delete ──────
  _toggleSelectMode() {
    this.selectMode = !this.selectMode;
    document.body.classList.toggle("ipam-selecting", this.selectMode);
    if (!this.selectMode) { this.selNets.clear(); this._exitMoveMode(); }
    this._updateSelBtn();
    this.renderTree();          // rebuild rows with select behavior + .sel state
    this._syncNetActions();
  }
  _updateSelBtn() {
    const b = document.getElementById("ipam-select-btn");
    if (b) b.textContent = this.selectMode ? "Отмена" : "Выбрать";
  }
  _toggleNetSel(el, n) {
    const id = n.p.id;
    if (this.selNets.has(id)) { this.selNets.delete(id); el.classList.remove("sel"); }
    else { this.selNets.set(id, n); el.classList.add("sel"); }
    this._syncNetActions();
  }
  // Floating action bar — reuses the Infrastructure #tree-actions look. States:
  // select (Перенести / Удалить / Готово) → move (pick a place → Применить / Отмена).
  _syncNetActions() {
    let bar = document.getElementById("ipam-actions");
    if (!this.selectMode) { if (bar) bar.remove(); return; }
    if (!bar) { bar = mk("div", { id: "ipam-actions" }); document.body.appendChild(bar); }
    const n = this.selNets.size;
    if (this.moveMode) {
      if (this._armedTarget) {
        const name = this._armedPlace ? this._armedPlace.name : "вне мест";
        bar.innerHTML = `<span class="ta-hint">Сюда: ${name}</span>` +
          `<button class="ta-apply">Применить</button><button class="ta-cancel">Отмена</button>`;
        bar.querySelector(".ta-apply").addEventListener("click", () => this._applyMove());
      } else {
        bar.innerHTML = `<span class="ta-hint">Выбери место (${n})</span><button class="ta-cancel">Отмена</button>`;
      }
      bar.querySelector(".ta-cancel").addEventListener("click", () => { this._exitMoveMode(); this._syncNetActions(); });
      return;
    }
    if (!n) {
      bar.innerHTML = `<span class="ta-hint">Отметь сети в дереве</span><button class="ta-cancel">Готово</button>`;
    } else {
      bar.innerHTML = `<button class="ta-move">Перенести (${n})</button>` +
        `<button class="ta-del">Удалить (${n})</button><button class="ta-cancel">Готово</button>`;
      bar.querySelector(".ta-move").addEventListener("click", () => this._startMoveMode());
      bar.querySelector(".ta-del").addEventListener("click", () => this._batchDelete());
    }
    bar.querySelector(".ta-cancel").addEventListener("click", () => this._toggleSelectMode());
  }
  // Move: mark every place as a target + a "Вне мест" target at the bottom; a tap
  // arms one (← сюда?), «Применить» moves. Same mechanism as the Infra tree.
  _startMoveMode() {
    if (!this.selNets.size) return;
    this.moveMode = true;
    document.body.classList.add("ipam-moving");
    const host = document.getElementById("ipam-tree-side");
    host.querySelectorAll(".it-node").forEach(el => el.classList.add("move-target"));
    const out = mk("div", { id: "ipam-out-target", className: "it-node move-target",
      html: `<i class="mdi mdi-tray-arrow-up"></i><span class="it-name">Вне мест</span>` });
    out._placeNode = null;      // sentinel → scope null (unassign)
    host.appendChild(out);
    this._armedTarget = null; this._armedPlace = null;
    this._syncNetActions();
  }
  _armMoveTarget(tgt) {
    if (this._armedTarget) this._armedTarget.classList.remove("move-armed");
    this._armedTarget = tgt; tgt.classList.add("move-armed");
    this._armedPlace = tgt._placeNode || null;   // null = вне мест
    this._syncNetActions();
  }
  _exitMoveMode() {
    this.moveMode = false;
    document.body.classList.remove("ipam-moving");
    const host = document.getElementById("ipam-tree-side");
    if (host) host.querySelectorAll(".move-target, .move-armed")
      .forEach(el => el.classList.remove("move-target", "move-armed"));
    const out = document.getElementById("ipam-out-target"); if (out) out.remove();
    this._armedTarget = null; this._armedPlace = null;
  }
  async _applyMove() {
    if (!this._armedTarget) { setStatus("сначала выбери место", ""); return; }
    const nets = [...this.selNets.values()];
    const place = this._armedPlace;
    const scopeType = place ? { region: "dcim.region", sitegroup: "dcim.sitegroup",
      site: "dcim.site", location: "dcim.location" }[place.kind] : null;
    const body = place ? { scope_type: scopeType, scope_id: place.obj.id } : { scope_type: null, scope_id: null };
    setStatus(`переношу ${nets.length} сет(ей)…`);
    let ok = 0, fail = 0;
    for (const nn of nets) {
      try { await api("/ipam/prefixes/" + nn.p.id + "/", "PATCH", body); ok++; }
      catch (e) { fail++; console.warn("не перенесена сеть " + nn.p.prefix + ":", e); }
    }
    const where = place ? `перенесено в «${place.name}»: ${ok}` : `убрано из мест: ${ok}`;
    setStatus(where + (fail ? `, не удалось: ${fail}` : ""), fail ? "err" : "ok");
    this.selNets.clear();
    this._exitMoveMode();
    this.selectMode = false; document.body.classList.remove("ipam-selecting");
    this._updateSelBtn();
    await this.load();
    this._syncNetActions();
  }
  _batchDelete() {
    const nets = [...this.selNets.values()];
    if (!nets.length) return;
    this.app.openModal(`Удалить сетей: ${nets.length}?`,
      "Выбранные сети будут удалены. Действие необратимо.", [],
      async () => {
        setStatus(`удаляю ${nets.length} сет(ей)…`);
        let ok = 0, fail = 0;
        for (const nn of nets) {
          try { await api("/ipam/prefixes/" + nn.p.id + "/", "DELETE"); ok++; }
          catch (e) { fail++; console.warn("не удалена сеть " + nn.p.prefix + ":", e); }
        }
        setStatus("удалено: " + ok + (fail ? `, не удалось: ${fail}` : ""), fail ? "err" : "ok");
        this.selNets.clear();
        await this.load();
        this._syncNetActions();
      }, "Удалить");
  }

  // Canvas: place blocks, networks inside, addresses within. Lazy render (as on
  // Infrastructure): build the schema ONLY for the place selected in the tree
  // (this.focusedId). Before selection — a hint. Left tree shows the full hierarchy.
  render() {
    const host = $("#ipam-clouds");
    if (!host) return;
    host.innerHTML = "";
    if (!this.roots.length) {
      host.appendChild(mk("div", { className: "placeholder", text: "Нет мест — создай площадки/локации на Инфраструктуре" }));
      return;
    }
    const focused = this._findNodeById(this.focusedId);
    if (focused) host.appendChild(this._place(focused));
    else host.appendChild(mk("div", { className: "placeholder",
      text: "Выбери место в дереве слева — построю схему его адресного пространства" }));
    // networks outside places — separate zone (drag into a place), always visible
    if (this.freeNets.length) {
      const zone = mk("div", { className: "free-zone", html: `<div class="fz-head">Сети вне мест</div>` });
      const body = mk("div", { className: "fz-body" });
      for (const n of this.freeNets) body.appendChild(this._netChip(n, null, false));
      zone.appendChild(body);
      host.appendChild(zone);
    }
    this._scheduleStick();   // position the contour titles along their top borders
  }

  // Place block (dashed). Contains nested places + networks.
  _place(node) {
    // Empty place (no networks or children) — site/location/group → name
    // centered in the contour (CSS .empty-place).
    const empty = !node.nets.length && !node.children.length;
    const el = mk("div", { className: "place k-" + node.kind + (empty ? " empty-place" : ""), dataset: { place: node.id } });
    const kindRu = { sitegroup: "группа", site: "площадка", location: "локация" }[node.kind] || "";
    const cap = mk("div", { className: "place-cap" },
      mk("span", { className: "pc-kind", text: kindRu }),
      mk("span", { className: "pc-name", text: node.name }));
    el.appendChild(cap);
    this._makePlaceDraggable(cap, node);   // drag a place "by its name" → change parent
    // Edit mode: tap the floating title → add a network to this place (the Сети
    // canvas has no "+" palette). A drag still moves the place (dragged guard).
    cap.addEventListener("click", () => {
      if (this._editCanvas() && !this.dragged) this._createNet(node);
    });
    if (!node.nets.length && !node.children.length) cap.classList.add("cap-add");   // hint on empty places
    const body = mk("div", { className: "place-body" });
    // Networks and nested places are EQUAL sibling blocks (peers): a site's
    // network does NOT wrap locations (small_fix "Networks" item 1 — "network as
    // location"). Nested places first, then the place's networks. Nesting a
    // location inside a network is a separate task (Location has no prefix
    // parent; semantics TBD).
    for (const ch of node.children) body.appendChild(this._place(ch));
    for (const n of node.nets) body.appendChild(this._netBlock(n, node));
    // No "+ network" buttons on the canvas: editing = dragging networks; creation
    // — via right-click in the "Places and networks" tree (see _menu).
    el.appendChild(body);
    // drop target: a network binds to this place
    this._makeDrop(el, node);
    return el;
  }

  // Network counter: used in red, free in green (no address list).
  _countHtml(n) {
    return `<span class="nb-used">${n.used} занято</span> · <span class="nb-free">${n.freeCount} свободно</span>`;
  }
  // Network block (blue dashed) inside a place. CIDR badge + counter (no address list).
  _netBlock(n, place) {
    const el = mk("div", { className: "net-block", dataset: { net: n.p.id } });
    el.appendChild(mk("div", { className: "nb-cap",
      html: `<span class="nb-cidr">${n.p.prefix}</span><span class="nb-count">${this._countHtml(n)}</span>` }));
    // In edit mode the whole block is a drag handle (hold LMB and drag).
    this._makeNetDraggable(el, n, place, false);
    // In edit mode the network block is NOT clickable (clicks hindered dragging);
    // details — from the tree or in view mode. Click is suppressed after a drag.
    el.addEventListener("click", e => {
      e.stopPropagation();
      if (this.dragged || this._editCanvas()) return;
      this._showNet(n, place);
    });
    el.addEventListener("contextmenu", e => this._netMenu(e, n, place));   // item 3
    return el;
  }

  // Compact network chip (in the tree / "outside places" zone).
  _netChip(n, place, inTree) {
    const chip = mk("div", { className: "net-chip" + (inTree ? " in-tree" : "") + (this.selNets.has(n.p.id) ? " sel" : ""), dataset: { net: n.p.id },
      html: `<i class="mdi mdi-ip-network"></i><span>${n.p.prefix}</span>` });
    chip.addEventListener("contextmenu", e => this._netMenu(e, n, place));   // item 3
    chip._net = n;   // for the select-mode capture guard
    this._makeNetDraggable(chip, n, place, inTree);
    return chip;
  }

  // Drag: network → place (PATCH prefix.scope). Starts only after the mouse
  // MOVES >6px (as in the Infrastructure tree) — a plain click stays a click,
  // not a "drag to the same place". mousemove/mouseup are always removed on
  // release, state fully cleaned — the node never "sticks" to the cursor.
  _makeNetDraggable(handle, n, fromPlace, inTree) {
    handle.addEventListener("mousedown", e => {
      // Tree networks drag in TREE mode, canvas ones in CANVAS mode. No drag while
      // multi-selecting (a tap toggles the selection instead).
      if (e.button !== 0 || this.selectMode || !(inTree ? this._editTree() : this._editCanvas())) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let started = false;
      const onMove = ev => {
        if (started || Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) <= 6) return;
        started = true;
        this.drag = { n, fromPlace, handle };
        this.dragged = true;   // suppress the click that follows mouseup
        handle.classList.add("dragging");
        document.body.classList.add("ipam-dragging");
        document.addEventListener("mouseover", this._dragOver);
      };
      const onUp = ev => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Drop is resolved HERE from the element under cursor (place/tree node) —
        // a single handler, so mouseup always arrives (no stopPropagation on
        // places, which used to make the node "stick").
        if (started && this.drag) {
          const tgt = ev.target.closest && ev.target.closest(".place, .it-node");
          const node = tgt && tgt._placeNode;
          if (node) this._assignNet(this.drag.n, node);   // async — not awaited; cleanup below
        }
        // cleanup in setTimeout: the click on this same element dispatches
        // synchronously before the timer → this.dragged is still true and suppresses it.
        setTimeout(() => {
          handle.classList.remove("dragging");
          document.body.classList.remove("ipam-dragging");
          this._setDropTarget(null);
          document.removeEventListener("mouseover", this._dragOver);
          this.drag = null;
          this.dragged = false;
        }, 0);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // A place is a potential drop target. Highlight/ghost and the drop itself go
  // through one route (_setDropTarget / onUp) by element under cursor; here we
  // only bind the node to the DOM element.
  _makeDrop(placeEl, node) {
    placeEl._placeNode = node;
  }

  // Drag a PLACE by its name (edit mode): location → onto a site, site → into a
  // group (or empty = no group), group → into a group (or empty = root). Same
  // mechanics as network drags: start after >6px, drop on .place under cursor.
  // Changes the PARENT in the DB (PATCH), not coordinates.
  _makePlaceDraggable(cap, node) {
    if (!["location", "site", "sitegroup"].includes(node.kind)) return;
    cap.addEventListener("mousedown", e => {
      if (e.button !== 0 || !this._editCanvas()) return;   // place drag — canvas mode
      e.preventDefault(); e.stopPropagation();   // don't let the canvas pan start
      const sx = e.clientX, sy = e.clientY;
      let started = false;
      const onMove = ev => {
        if (started || Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) <= 6) return;
        started = true; this.dragged = true; this._placeDrag = node;
        cap.classList.add("dragging");
        document.body.classList.add("ipam-dragging");
        document.addEventListener("mouseover", this._dragOver);   // "Сюда" highlight
      };
      const onUp = ev => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (started && this._placeDrag) {
          const tgt = ev.target.closest && ev.target.closest(".place, .it-node");
          const targetNode = tgt && tgt._placeNode;
          this._movePlace(this._placeDrag, (targetNode && targetNode !== node) ? targetNode : null);
        }
        setTimeout(() => {
          cap.classList.remove("dragging");
          document.body.classList.remove("ipam-dragging");
          this._setDropTarget(null);
          document.removeEventListener("mouseover", this._dragOver);
          this._placeDrag = null; this.dragged = false;
        }, 0);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
  // Change a place's parent (PATCH). target=null → "to root / no group".
  async _movePlace(node, target) {
    let path, body, where;
    if (node.kind === "location") {
      if (!target || target.kind !== "site") { setStatus("серверную можно перенести только на площадку", "err"); return; }
      path = "/dcim/locations/" + node.obj.id + "/"; body = { site: target.obj.id }; where = target.name;
    } else if (node.kind === "site") {
      if (target && target.kind !== "sitegroup") { setStatus("площадку — на группу мест (или в пусто = без группы)", "err"); return; }
      path = "/dcim/sites/" + node.obj.id + "/"; body = { group: target ? target.obj.id : null };
      where = target ? target.name : "без группы";
    } else if (node.kind === "sitegroup") {
      if (target && target.kind !== "sitegroup") { setStatus("группу — в другую группу (или в пусто = корень)", "err"); return; }
      if (target && this._isDescendantGroup(node, target)) { setStatus("нельзя вложить группу в саму себя/потомка", "err"); return; }
      path = "/dcim/site-groups/" + node.obj.id + "/"; body = { parent: target ? target.obj.id : null };
      where = target ? target.name : "корень";
    } else return;
    try {
      setStatus("переношу «" + node.name + "»…");
      await api(path, "PATCH", body);
      setStatus("«" + node.name + "» → " + where, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }
  // Is target inside node's subtree (or node itself)? — cycle guard for groups.
  _isDescendantGroup(node, target) {
    let found = node === target;
    const walk = n => { if (n === target) found = true; n.children.forEach(walk); };
    node.children.forEach(walk);
    return found;
  }

  // Bind a network to a place (PATCH scope by place kind).
  async _assignNet(n, place) {
    const scopeType = { region: "dcim.region", sitegroup: "dcim.sitegroup", site: "dcim.site", location: "dcim.location" }[place.kind];
    try {
      setStatus(`привязываю ${n.p.prefix} к «${place.name}»…`);
      await api(`/ipam/prefixes/${n.p.id}/`, "PATCH", { scope_type: scopeType, scope_id: place.obj.id });
      setStatus(`${n.p.prefix} → «${place.name}»`, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }

  async _unassignNet(n) {
    try {
      await api(`/ipam/prefixes/${n.p.id}/`, "PATCH", { scope_type: null, scope_id: null });
      setStatus(`${n.p.prefix} убрана из места`, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }

  // Right-click a place node in the tree — Infrastructure-style menu (.treectx),
  // works in any mode. Only NETWORKS are created here (places themselves —
  // on the Infrastructure canvas).
  // Shared context-menu builder (.treectx as on Infrastructure): items —
  // [{label, fn, danger?}]. Positioned within the window + closes on outside click.
  _showCtx(x, y, items) {
    this._closeMenu();
    const menu = mk("div", { className: "treectx" });
    for (const it of items) menu.appendChild(this._ctxRow(it));
    document.body.appendChild(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 8)) + "px";
    this._ctxMenu = menu;
    const close = ev => {
      if (!menu.contains(ev.target)) { this._closeMenu(); document.removeEventListener("mousedown", close, true); }
    };
    setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  }
  // Recursive menu row {label, fn?, submenu?, danger?} — with a nested
  // "Add ▸ …" submenu (as on Infrastructure; CSS .tc-sub from schematic.css).
  _ctxRow(spec) {
    const hasSub = Array.isArray(spec.submenu) && spec.submenu.length;
    const row = mk("div", { className: "tc-item" + (spec.danger ? " danger" : "") + (hasSub ? " has-sub" : ""),
      html: `<span>${spec.label}</span>` + (hasSub ? `<span class="tc-arrow">▸</span>` : "") });
    if (hasSub) {
      const sub = mk("div", { className: "tc-sub" });
      for (const child of spec.submenu) sub.appendChild(this._ctxRow(child));
      row.appendChild(sub);
    } else if (spec.fn) {
      row.addEventListener("click", ev => { ev.stopPropagation(); this._closeMenu(); spec.fn(); });
    }
    return row;
  }
  // Right-click a PLACE — full set as on Infrastructure: Add ▸ (child/network),
  // Rename, Delete.
  _menu(e, node) {
    e.preventDefault();
    const add = [];
    if (node.kind === "sitegroup") {
      add.push({ label: "Подгруппа мест", fn: () => this._createGroup(node) });
      add.push({ label: "Площадка", fn: () => this._createSite(node) });
      add.push({ label: "Сеть", fn: () => this._createNet(node) });
    } else if (node.kind === "site") {
      add.push({ label: "Серверная", fn: () => this._createLocation(node) });
      add.push({ label: "Сеть", fn: () => this._createNet(node) });
    } else if (node.kind === "location") {
      add.push({ label: "Сеть", fn: () => this._createNet(node) });
    }
    const items = [];
    if (add.length) items.push({ label: "Добавить", submenu: add });
    items.push({ label: "Переименовать", fn: () => this._renamePlace(node) });
    items.push({ label: "Удалить", danger: true, fn: () => this._deletePlace(node) });
    this._showCtx(e.clientX, e.clientY, items);
  }
  // Right-click on an EMPTY hierarchy spot — create a top-level place.
  _emptyMenu(e) {
    e.preventDefault();
    this._showCtx(e.clientX, e.clientY, [
      { label: "Добавить", submenu: [
        { label: "Группа мест", fn: () => this._createGroup(null) },
        { label: "Площадка (без группы)", fn: () => this._createSite(null) },
      ] },
    ]);
  }
  // Create/rename/delete PLACES (ported from Infrastructure; reload = IPAM).
  _createGroup(parent) {
    this.app.openModal("Новая группа мест", parent ? "Внутри: " + parent.name : "",
      [{ id: "name", label: "Название", placeholder: "Группа ЦОД" }],
      async v => {
        if (!v.name) throw new Error("укажи название");
        await api("/dcim/site-groups/", "POST",
          { name: v.name, slug: slugify(v.name), ...(parent ? { parent: parent.obj.id } : {}) });
        setStatus("группа создана: " + v.name, "ok");
        await this.load();
      });
  }
  _createSite(group) {
    this.app.openModal("Новая площадка", group ? "Группа: " + group.name : "без группы",
      [{ id: "name", label: "Название", placeholder: "ЦОД Пулково" }],
      async v => {
        if (!v.name) throw new Error("укажи название");
        await api("/dcim/sites/", "POST",
          { name: v.name, slug: slugify(v.name), status: "active", ...(group ? { group: group.obj.id } : {}) });
        setStatus("площадка создана: " + v.name, "ok");
        await this.load();
      });
  }
  _createLocation(site) {
    this.app.openModal("Новая серверная", "Площадка: " + site.name,
      [{ id: "name", label: "Название", placeholder: "Серверная 2" }],
      async v => {
        if (!v.name) throw new Error("укажи название");
        await api("/dcim/locations/", "POST",
          { site: site.obj.id, name: v.name, slug: slugify(v.name), status: "active" });
        setStatus("серверная создана: " + v.name, "ok");
        await this.load();
      });
  }
  _renamePlace(node) {
    const path = { sitegroup: "/dcim/site-groups/", site: "/dcim/sites/", location: "/dcim/locations/" }[node.kind];
    if (!path) return;
    this.app.openModal("Переименовать", "Текущее: " + node.name,
      [{ id: "name", label: "Новое название", value: node.name }],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api(path + node.obj.id + "/", "PATCH", { name: v.name, slug: slugify(v.name) });
        setStatus("переименовано: " + v.name, "ok");
        await this.load();
      });
  }
  _deletePlace(node) {
    const path = { sitegroup: "/dcim/site-groups/", site: "/dcim/sites/", location: "/dcim/locations/" }[node.kind];
    const kindRu = { sitegroup: "группу", site: "площадку", location: "серверную" }[node.kind];
    if (!path) return;
    this.app.openModal("Удалить " + kindRu + "?", "«" + node.name + "» и всё вложенное. Действие необратимо.", [],
      async () => {
        await api(path + node.obj.id + "/", "DELETE");
        setStatus("удалено: " + node.name, "ok");
        await this.load();
      }, "Удалить");
  }
  // Right-click a NETWORK in the tree (item 3): edit CIDR / unassign / delete.
  _netMenu(e, n, place) {
    e.preventDefault();
    const items = [{ label: "Изменить сеть", fn: () => this._editNet(n) }];
    items.push({ label: "Дублировать в…", fn: () => this._startDuplicatePlacement(n) });
    if (place) items.push({ label: "Убрать из места", fn: () => this._unassignNet(n) });
    items.push({ label: "Удалить сеть", danger: true, fn: () => this._deleteNet(n) });
    this._showCtx(e.clientX, e.clientY, items);
  }
  // Duplicate a network into another place: a COPY of the prefix with the same
  // CIDR but the chosen place's scope. Solves "same networks in different
  // locations" — in NetBox those are separate Prefixes (one record can't live
  // in two places). Pick-and-place UX: a chip with the CIDR follows the cursor;
  // click a place (.place on canvas or .it-node in tree) = duplicate there.
  // Esc/click elsewhere — cancel. Targets lit by shared _setDropTarget (drop-ok).
  _startDuplicatePlacement(n) {
    this._closeMenu();
    if (this._dupGhost) return;   // already in placement mode
    const ghost = mk("div", { className: "net-chip dup-ghost", style: { visibility: "hidden" },
      html: `<i class="mdi mdi-ip-network"></i><span>${n.p.prefix}</span>` });
    document.body.appendChild(ghost);
    this._dupGhost = ghost;
    document.body.classList.add("ipam-dragging");
    setStatus(`выбери место для копии ${n.p.prefix} · Esc — отмена`);
    const move = e => {
      ghost.style.left = (e.clientX + 12) + "px";
      ghost.style.top = (e.clientY + 14) + "px";
      ghost.style.visibility = "visible";
      this._setDropTarget(e.target.closest ? e.target.closest(".place, .it-node") : null);
    };
    const drop = e => {
      if (e.button != null && e.button !== 0) return;   // not LMB — ignore
      e.preventDefault(); e.stopPropagation();
      this.dragged = true;   // suppress the follow-up click on the place/node
      const tgt = e.target.closest && e.target.closest(".place, .it-node");
      const node = tgt && tgt._placeNode;
      cleanup();
      if (node) this._assignDuplicate(n, node);
      else setStatus("дублирование отменено");
      setTimeout(() => { this.dragged = false; }, 0);
    };
    const onKey = e => { if (e.key === "Escape") { cleanup(); setStatus("дублирование отменено"); } };
    const cleanup = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mousedown", drop, true);
      document.removeEventListener("keydown", onKey);
      this._setDropTarget(null);
      if (this._dupGhost) { this._dupGhost.remove(); this._dupGhost = null; }
      document.body.classList.remove("ipam-dragging");
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("keydown", onKey);
    // defer so the click that opened the menu item doesn't count as a drop
    setTimeout(() => document.addEventListener("mousedown", drop, true), 0);
  }
  // Create a copy of the network (prefix) in the chosen place (scope by kind).
  async _assignDuplicate(n, place) {
    const scopeType = { region: "dcim.region", sitegroup: "dcim.sitegroup", site: "dcim.site", location: "dcim.location" }[place.kind];
    if (!scopeType) { setStatus("сюда нельзя дублировать", "err"); return; }
    try {
      setStatus(`дублирую ${n.p.prefix} в «${place.name}»…`);
      await api("/ipam/prefixes/", "POST",
        { prefix: n.p.prefix, status: (n.p.status && n.p.status.value) || "active",
          scope_type: scopeType, scope_id: place.obj.id });
      setStatus(`${n.p.prefix} продублирована в «${place.name}»`, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }
  _editNet(n) {
    this.app.openModal("Изменить сеть", "Сеть: " + n.p.prefix,
      [{ id: "cidr", label: "Сеть (CIDR)", value: n.p.prefix }],
      async v => {
        if (!v.cidr) throw new Error("укажи CIDR");
        await api("/ipam/prefixes/" + n.p.id + "/", "PATCH", { prefix: v.cidr.trim() });
        setStatus("сеть изменена: " + v.cidr, "ok");
        await this.load();
      }, "Сохранить");
  }
  _deleteNet(n) {
    this.app.openModal("Удалить сеть?", "«" + n.p.prefix + "» будет удалена. Действие необратимо.", [],
      async () => {
        await api("/ipam/prefixes/" + n.p.id + "/", "DELETE");
        setStatus("сеть удалена: " + n.p.prefix, "ok");
        if (this._lastNet && this._lastNet.n.p.id === n.p.id) this._lastNet = null;
        await this.load();
      }, "Удалить");
  }
  _closeMenu() { if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; } }

  // Create a network and immediately scope it to a place. Modal — as on
  // Infrastructure (shared app.openModal), not prompt().
  _createNet(place) {
    const scopeType = { region: "dcim.region", sitegroup: "dcim.sitegroup", site: "dcim.site", location: "dcim.location" }[place.kind];
    this.app.openModal("Новая сеть", "Место: " + place.name,
      [{ id: "cidr", label: "Сеть (CIDR)", placeholder: "10.10.0.0/24" }],
      async v => {
        if (!v.cidr) throw new Error("укажи CIDR");
        await api("/ipam/prefixes/", "POST",
          { prefix: v.cidr.trim(), status: "active", scope_type: scopeType, scope_id: place.obj.id });
        setStatus(`сеть ${v.cidr} создана в «${place.name}»`, "ok");
        await this.load();
      });
  }

  // Re-render open details with a FRESH network object (after load() the old
  // references are dead — look up by prefix id in the new roots/freeNets).
  _refreshDetail() {
    const id = this._lastNet.n.p.id;
    let found = null, foundPlace = null;
    const walk = node => {
      for (const nn of node.nets) if (nn.p.id === id) { found = nn; foundPlace = node; }
      node.children.forEach(walk);
    };
    this.roots.forEach(walk);
    if (!found) { found = this.freeNets.find(x => x.p.id === id) || null; foundPlace = null; }
    if (found) this._showNet(found, foundPlace);
  }

  _focusPlace(node) {
    // Canvas title shows which area is selected (Region/Site/group/Location) —
    // like "Racks : …" / "Connection schema : …" on Infrastructure.
    // Clicking a tree node = build the schema for ONLY that place (lazy
    // render): remember the id and redraw the canvas.
    this._setScopeTitle(node.name);
    this.focusedId = node.id;
    this.render();
    this._markLoadedTree();
    const el = $(`.place[data-place="${node.id}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); }
  }
  // Find a place node by id (kind+id) in roots — for lazy render (render builds
  // only that place's schema) and to survive reload (objects are rebuilt in
  // _build; the id is stable).
  _findNodeById(id) {
    if (!id) return null;
    let found = null;
    const walk = n => { if (found) return; if (n.id === id) { found = n; return; } n.children.forEach(walk); };
    this.roots.forEach(walk);
    return found;
  }
  // Highlight in the tree the place whose schema is loaded (focusedId) and its
  // descendants — like "on schema" on Infrastructure: root accented, descendants
  // gray var(--muted). Called after renderTree (survives rebuild) and from
  // _focusPlace. Nodes are found by data-place (kind+id).
  _markLoadedTree() {
    const host = $("#ipam-tree-side");
    if (!host) return;
    host.querySelectorAll(".on-schema, .loaded-root")
      .forEach(x => x.classList.remove("on-schema", "loaded-root"));
    const focused = this._findNodeById(this.focusedId);
    if (!focused) return;
    const ids = new Set();
    const collect = n => { ids.add(n.id); n.children.forEach(collect); };
    collect(focused);
    ids.forEach(id => {
      const row = host.querySelector(`.it-node[data-place="${id}"]`);
      if (row) row.classList.add(id === this.focusedId ? "loaded-root" : "on-schema");
      // the loaded place's network rows — also gray (var(--muted)), like places
      host.querySelectorAll(`.it-net[data-place="${id}"]`).forEach(nr => nr.classList.add("on-schema"));
    });
  }

  _setScopeTitle(name) {
    const lbl = $("#ipam-main .pt-label");
    if (lbl) lbl.textContent = "Схема адресного пространства" + (name ? " : " + name : "");
  }

  // network details on the right
  async _showNet(n, place) {
    this._lastNet = { n, place };
    const panel = $("#ipam-detail");
    if (!panel) return;
    const p = n.p;
    // Mode button of the DETAILS block (its own column) — .modebtn[data-mode=ipamdetail].
    panel.innerHTML = `${modeBtn("ipamdetail", "compact ms-corner")}<h2>${p.prefix}</h2>
      <div class="sub">Сеть${p.status ? " · " + (p.status.label || p.status.value) : ""}${place ? " · " + place.name : ""}</div>
      <div class="id-row"><span>Размер</span><b>${n.cidr.size.toLocaleString("ru")} адр.</b></div>
      <div class="id-row"><span>Занято</span><b>${n.used}</b></div>
      <div class="id-row"><span>Свободно</span><b>${n.freeCount.toLocaleString("ru")}</b></div>`;
    Mode.syncButtons("ipamdetail");
    if (place && this._editDetail())
      panel.appendChild(mk("button", { className: "id-btn danger", html: `<i class="mdi mdi-close"></i> убрать из «${place.name}»`,
        on: { click: () => this._unassignNet(n) } }));
    if (n.occupied.length) {
      panel.insertAdjacentHTML("beforeend", `<h4>Занятые адреса (${n.occupied.length})</h4>`);
      const box = mk("div", { className: "id-free" });
      for (const ip of n.occupied)
        box.appendChild(mk("span", { className: "id-ip", text: ip.address.split("/")[0], title: ip.address }));
      panel.appendChild(box);
    }
  }
}
