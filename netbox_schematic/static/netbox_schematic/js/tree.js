"use strict";
// TreeManager: region→site→server room→rack tree.
// Builds the tree, handles server room/rack selection and drag-and-drop
// (move starts on press-and-hold with a progress ring). Tree edit mode —
// Mode.on("tree") (shows the «+ создать» buttons).

import { $, state, mk, slugify, currentLocationName } from "./core.js";
import { api, apiAll, apiAllByIds, setStatus } from "./api.js";
import { SOLUTIONS } from "./solutions.js";

const RING_DELAY = 150;              // pause before the ring appears
const HOLD_MS = 380;                 // ring fill time before the move starts
const RING_LEN = 2 * Math.PI * 13;   // circumference for r=13 (see CSS/SVG)
// All tree nodes (for dimming invalid drop targets during a move).
const TREE_NODE_SEL = ".tree-region,.tree-sitegroup,.tree-site,.tree-loc,.tree-rack,.tree-panel,.tree-feed,.tree-dev";
// A node's "level" for Shift multi-select = its PARENT container, NOT its type.
// Same-level nodes are selected/moved/deleted together: racks and panels
// (and future devices) live in a location → one "location" level. Selection is
// not tied to type but stays within one hierarchy layer.
const NODE_LEVEL = {
  region: "region", sitegroup: "sitegroup",
  site: "site",
  location: "location",
  rack: "rackpanel", panel: "rackpanel",   // racks+panels: own level (NOT = locations)
  feed: "panel",
  device: "device",
};

export class TreeManager {
  constructor(app) {
    this.app = app;
    this.dropTargets = [];
    this.hold = { delay: null, timer: null, raf: null, el: null, drag: null };
    this.selection = new Set();   // Shift multi-select of tree nodes (see _toggleSelect)
    this.collapsed = new Set();   // ids of collapsed groups (survives build/reload)
    this._wireGlobal();
  }

  // DOM build. Single FOLDER tree: site groups (nested) → sites →
  // server rooms → racks/panels. Region is NOT a tree level (SiteGroup has no
  // region), just a label on a site. Ungrouped sites go into their own section.
  build() {
    const nav = $("#tree");
    nav.innerHTML = "";
    this.dropTargets.length = 0;   // old nodes are gone — reset targets
    this.selection.clear();        // old DOM nodes are no longer valid
    this._buildGroupsTree(nav);
    this._buildUngrouped(nav);
    this._buildRootTarget(nav);
    this._exitMoveMode();   // old drop targets/mode are invalid after a rebuild
    this._updateSelBtn();
    this._syncMoveBar();    // selection cleared at start of build → refresh the bar
  }

  // Site group tree (Site Group — nested model via parent). Section header
  // removed (as in «Сети»); moving a group to the root — via right-click
  // «Переместить» → root (the header drag target is gone).
  _buildGroupsTree(nav) {
    const childrenOf = {};
    for (const g of (state.siteGroups || [])) {
      const pid = (g.parent && g.parent.id) ?? "root";
      (childrenOf[pid] = childrenOf[pid] || []).push(g);
    }
    for (const g of (childrenOf.root || [])) this._buildGroupNode(nav, g, childrenOf, 0);
  }
  // Ungrouped sites (group=null) — no section header (removed). To ungroup —
  // right-click «Переместить → без группы».
  _buildUngrouped(nav) {
    const orphans = state.sites.filter(s => !s.group);
    if (!orphans.length) return;
    for (const site of orphans) this._buildSiteNode(nav, site, 30);
  }
  // «Всё дерево» — a root drop/move target at the very bottom: drop a site here
  // to pull it OUT of its group, or a site group to move it to the top level.
  _buildRootTarget(nav) {
    const el = mk("div", { className: "tree-root-target",
      html: `<i class="mdi mdi-arrow-collapse-up tree-ic"></i>Всё дерево` +
        `<span class="trt-hint">вынести из группы</span>` });
    this._makeDropTarget(el, "sitegroup", null, "parent");   // group → top level
    this._makeDropTarget(el, "site", null, "group");         // site → no group
    nav.appendChild(el);
  }
  // One group node (📁) + its subgroups (recursive) and sites (expanded).
  // depth — nesting (indent). Group: click = scope, draggable (move to another
  // group/root), drop target for a site (→ group) and a subgroup (→ parent).
  _buildGroupNode(nav, grp, childrenOf, depth) {
    const pad = 14 + depth * 16;
    const collapsed = this.collapsed.has(grp.id);
    // The chevron is a SEPARATE button (collapse/expand). Clicking the group
    // itself builds the schema (selectScope) without touching collapse state.
    // Icon glyphs don't reach textContent → _nodeInfo reads the group name correctly.
    const gEl = mk("div", { className: "tree-sitegroup" + (collapsed ? " collapsed" : ""),
      dataset: { sitegroup: grp.id }, style: { paddingLeft: pad + "px" },
      html: `<button class="tree-chevron" tabindex="-1" title="Свернуть / развернуть">` +
        `<i class="mdi mdi-chevron-${collapsed ? "right" : "down"}"></i></button>` +
        `<i class="mdi mdi-folder-outline tree-ic"></i>${grp.name}` });
    gEl.querySelector(".tree-chevron").addEventListener("click", e => {
      e.stopPropagation(); this._toggleCollapse(grp.id);
    });
    gEl.addEventListener("click", () => this.selectScope("sitegroup", grp.id, grp.name));
    this._makeDraggable(gEl, "sitegroup", grp.id, grp.name);
    this._makeDropTarget(gEl, "site", grp.id, "group");       // drop a site → into this group
    this._makeDropTarget(gEl, "sitegroup", grp.id, "parent"); // drop a subgroup → into this group
    nav.appendChild(gEl);
    if (collapsed) return;   // collapsed — don't render children
    // Group's sites first (expanded); SUBGROUPS (folders) go at the BOTTOM:
    // otherwise an empty folder with a down chevron confuses — the sites that
    // follow look like they are inside it.
    for (const site of state.sites.filter(s => s.group && s.group.id === grp.id))
      this._buildSiteNode(nav, site, pad + 18);
    for (const sub of (childrenOf[grp.id] || [])) this._buildGroupNode(nav, sub, childrenOf, depth + 1);
  }
  // Collapse/expand a group: rebuild the tree (collapsed groups skip children)
  // and restore the current scope highlight (build resets it).
  _toggleCollapse(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.build();
    if (state.scope) this._highlightScope(state.scope.type, state.scope.id);
  }
  // Group id + all its subgroups (recursive) — to collect the whole branch's
  // sites and to forbid nesting a group into itself/a descendant.
  _descendantGroupIds(rootId) {
    const childrenOf = {};
    for (const g of (state.siteGroups || [])) {
      const pid = g.parent && g.parent.id;
      (childrenOf[pid] = childrenOf[pid] || []).push(g.id);
    }
    const out = new Set(), stack = [Number(rootId)];
    while (stack.length) {
      const gid = stack.pop();
      if (out.has(gid)) continue;
      out.add(gid);
      for (const c of (childrenOf[gid] || [])) stack.push(c);
    }
    return out;
  }

  // Site node (🗺) + server rooms (📍) + racks/panels. sitePad — the site's left
  // indent (deeper under a group; 30 when ungrouped). Name goes to data-name
  // (future-proofing for non-text siblings). Region is not shown.
  _buildSiteNode(nav, site, sitePad = 30) {
    const shift = sitePad - 30;
    // Region is not shown in the tree (not a hierarchy level). Name — in data-name.
    const s = mk("div", { className: "tree-site", dataset: { site: site.id, name: site.name },
      style: { paddingLeft: sitePad + "px" },
      html: `<i class="mdi mdi-map-outline tree-ic"></i>${site.name}` });
    // Clicking a site loads all racks of its server rooms (see selectScope).
    s.addEventListener("click", () => this.selectScope("site", site.id, site.name));
    this._makeDraggable(s, "site", site.id, site.name);
    this._makeDropTarget(s, "location", site.id);
    nav.appendChild(s);
    const siteLocs = state.locations.filter(l => l.site && l.site.id === site.id);
    for (const loc of siteLocs) {
      const inGroup = state.racks.filter(r =>
        r.site.id === site.id && r.location && r.location.id === loc.id);
      const lb = mk("button", {
        className: "tree-loc", dataset: { loc: loc.id, site: site.id },
        style: { paddingLeft: (48 + shift) + "px" },
        html: `<i class="mdi mdi-map-marker tree-ic"></i>${loc.name}${inGroup.length ? "" : " (пусто)"}`,
      });
      // A server room is always clickable (loads its racks; empty → empty schema).
      lb.addEventListener("click", () => this.selectScope("location", loc.id, loc.name));
      this._makeDraggable(lb, "location", loc.id, loc.name);
      this._makeDropTarget(lb, "rack", loc.id);
      this._makeDropTarget(lb, "panel", loc.id);    // a power panel can be dropped here
      this._makeDropTarget(lb, "device", loc.id);   // …and a device (move into this room)
      nav.appendChild(lb);
      for (const rack of inGroup) {
        const rb = mk("button", {
          className: "tree-rack", dataset: { rack: rack.id, loc: loc.id, site: site.id },
          style: { paddingLeft: (66 + shift) + "px" },
          html: `<i class="mdi mdi-server tree-ic"></i>${rack.name}`,
        });
        // Clicking a rack loads ONLY it (outline + its own devices).
        rb.addEventListener("click", () => this.selectScope("rack", rack.id, rack.name));
        this._makeDraggable(rb, "rack", rack.id, rack.name);
        nav.appendChild(rb);
        // Devices INSIDE the rack — indented nodes (rack visibly the parent);
        // clicking one → single-view of that device.
        const rackDevs = (state.allDevices || [])
          .filter(d => d.rack && d.rack.id === rack.id)
          .sort((a, b) => {
            const ra = (a.role && a.role.name) || "￿", rb2 = (b.role && b.role.name) || "￿";
            return ra.localeCompare(rb2) || (a.name || "").localeCompare(b.name || "");
          });
        for (const dev of rackDevs) nav.appendChild(this._devNode(dev, loc, 84 + shift));
      }
      this._buildPowerNodes(nav, site, loc, inGroup, shift);
      // Off-rack devices of this location (consumers) go in the tree. Racked ones
      // are NOT listed here — they're already in the «Стойки» column (which would
      // otherwise lose its point). Sorted by ROLE, then name; role-less last.
      const locDevs = (state.allDevices || [])
        .filter(d => !d.rack && d.location && d.location.id === loc.id)
        .sort((a, b) => {
          const ra = (a.role && a.role.name) || "￿", rb = (b.role && b.role.name) || "￿";
          return ra.localeCompare(rb) || (a.name || "").localeCompare(b.name || "");
        });
      for (const dev of locDevs)
        nav.appendChild(this._devNode(dev, loc, 66 + shift));
    }
  }
  // Device node in the tree (under a rack / off-rack). Click → loads its
  // location and opens the device card. Icon — by role/name. Muted by default
  // (var(--muted), like racks/feeds); when the parent location is loaded it
  // gets .on-schema ("present on schema" highlight) like other descendants.
  _devNode(dev, loc, padPx) {
    const el = mk("button", { className: "tree-dev", dataset: { dev: dev.id, loc: loc.id },
      style: { paddingLeft: padPx + "px" },
      html: `<i class="mdi ${this._devIcon(dev)} tree-ic"></i>${dev.name}` });
    el.addEventListener("click", () => this._openDevice(dev, loc));
    return el;
  }
  _devIcon(dev) {
    const s = ((dev.role && dev.role.name) || "") + " " + (dev.name || "") + " " + ((dev.device_type && dev.device_type.model) || "");
    if (/provider|провайдер/i.test(s)) return "mdi-web";
    if (/camera|камер/i.test(s)) return "mdi-cctv";
    if (/router|роутер/i.test(s)) return "mdi-router";
    if (/switch|коммут|свич/i.test(s)) return "mdi-switch";
    if (/\bpc\b|пк|компьютер|десктоп/i.test(s)) return "mdi-desktop-classic";
    if (/laptop|ноут/i.test(s)) return "mdi-laptop";
    if (/print|принтер/i.test(s)) return "mdi-printer";
    if (/\btv\b|телевизор|тв/i.test(s)) return "mdi-television";
    if (/phone|телефон/i.test(s)) return "mdi-deskphone";
    if (/pdu|щит|power/i.test(s)) return "mdi-power-plug";
    if (/patch|пач|панель/i.test(s)) return "mdi-format-align-justify";
    if (/panel|access\s*point|точк/i.test(s)) return "mdi-access-point";
    return "mdi-server";
  }
  async _openDevice(dev, loc) {
    await this.app.schema.showSingleDevice(dev);   // single-view: only this device + link "whiskers"
    this.app.device.show(dev);                      // device card (right pane / bottom sheet)
  }

  // Power Panels of a server room and their Power Feeds. A Panel is bound to a
  // Location, a Feed — to a Panel (+ optionally a rack in that room).
  // Power is drawn NOT as a rack unit but as a separate tree branch (aside).
  _buildPowerNodes(nav, site, loc, racksInLoc, shift = 0) {
    const panels = (state.powerPanels || []).filter(p => p.location && p.location.id === loc.id);
    for (const panel of panels) {
      const pEl = mk("div", {
        className: "tree-panel", dataset: { panel: panel.id, loc: loc.id, site: site.id },
        style: { paddingLeft: (66 + shift) + "px" },
        html: `<i class="mdi mdi-flash tree-ic"></i>${panel.name}`,
      });
      // Clicking a panel shows its card on the right (no schema reload). Move and
      // Shift multi-select work like racks (_makeDraggable + capture handler).
      pEl.addEventListener("click", () => this.app.device.showPanel(panel));
      this._makeDraggable(pEl, "panel", panel.id, panel.name);   // panels are draggable
      this._makeDropTarget(pEl, "feed", panel.id);               // feeds can be dropped here
      nav.appendChild(pEl);
      // Feeds themselves are NOT shown in the tree (by request) — they are
      // visible/editable in the panel card (click the panel) and on the schema.
    }
  }
  // Entity creation (shared modals for the right-click «Добавить» menu)
  _createRegion() {
    this.app.openModal("Новый регион", "Верхний уровень: город / страна / округ",
      [{ id: "name", label: "Название", placeholder: "Санкт-Петербург" }],
      async v => {
        await api("/dcim/regions/", "POST", { name: v.name, slug: slugify(v.name) });
        setStatus("регион создан: " + v.name, "ok");
        await this.reload();
      });
  }
  _createSite(region) {   // region: {id,name} | null
    this.app.openModal("Новая площадка", region ? "Регион: " + region.name : "Без региона",
      [{ id: "name", label: "Название", placeholder: "ЦОД Пулково" }],
      async v => {
        await api("/dcim/sites/", "POST", {
          name: v.name, slug: slugify(v.name), status: "active",
          ...(region ? { region: region.id } : {}),
        });
        setStatus("площадка создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createSiteInGroup(group) {   // site created directly inside a site group
    this.app.openModal("Новая площадка", "Группа: " + group.name,
      [{ id: "name", label: "Название", placeholder: "ЦОД Пулково" }],
      async v => {
        await api("/dcim/sites/", "POST",
          { name: v.name, slug: slugify(v.name), status: "active", group: group.id });
        setStatus("площадка создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createSiteGroup(parent) {   // parent: {id,name} parent GROUP (nesting) or null (root)
    this.app.openModal("Новая группа мест", parent ? "Внутри группы: " + parent.name : "",
      [{ id: "name", label: "Название", placeholder: "Группа ЦОД" }],
      async v => {
        await api("/dcim/site-groups/", "POST",
          { name: v.name, slug: slugify(v.name), ...(parent ? { parent: parent.id } : {}) });
        setStatus("группа мест создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createLocation(site) {   // site: {id,name}
    this.app.openModal("Новая серверная", "Площадка: " + site.name,
      [{ id: "name", label: "Название", placeholder: "Серверная 2" }],
      async v => {
        await api("/dcim/locations/", "POST",
          { site: site.id, name: v.name, slug: slugify(v.name), status: "active" });
        setStatus("серверная создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createRack(site, loc) {   // site,loc: {id,name}
    this.app.openModal("Новая стойка", "Серверная: " + loc.name,
      [
        { id: "name", label: "Имя стойки", placeholder: "R03" },
        { id: "uh", label: "Высота в юнитах", placeholder: "42" },
      ],
      async v => {
        await api("/dcim/racks/", "POST", {
          site: site.id, location: loc.id, name: v.name,
          u_height: +v.uh || 42, status: "active",
        });
        setStatus("стойка создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createPanel(site, loc) {   // site,loc: {id,name}
    this.app.openModal("Новый силовой щит", "Серверная: " + loc.name,
      [{ id: "name", label: "Название щита", placeholder: "Щит A" }],
      async v => {
        await api("/dcim/power-panels/", "POST",
          { site: site.id, location: loc.id, name: v.name });
        setStatus("силовой щит создан: " + v.name, "ok");
        await this.reload();
      });
  }
  _createFeed(panel) {   // panel: object from state.powerPanels (has .location)
    const locId = panel.location && panel.location.id;
    const racksInLoc = (state.racks || []).filter(r => r.location && r.location.id === locId);
    const rackOpts = [{ value: "", label: "— без стойки —" },
      ...racksInLoc.map(r => ({ value: String(r.id), label: r.name }))];
    this.app.openModal("Новый фидер", "Щит: " + panel.name,
      [
        { id: "name", label: "Название фидера", placeholder: "Фидер A1" },
        { id: "rack", label: "Стойка (куда идёт)", type: "select", options: rackOpts },
        { id: "voltage", label: "Напряжение, В", placeholder: "230" },
        { id: "amperage", label: "Ток, А", placeholder: "32" },
        { id: "phase", label: "Фазность", type: "select", options: [
          { value: "single-phase", label: "Однофазный" },
          { value: "three-phase", label: "Трёхфазный" }] },
      ],
      async v => {
        await api("/dcim/power-feeds/", "POST", {
          power_panel: panel.id, name: v.name,
          ...(v.rack ? { rack: +v.rack } : {}),
          ...(v.voltage ? { voltage: +v.voltage } : {}),
          ...(v.amperage ? { amperage: +v.amperage } : {}),
          phase: v.phase || "single-phase", supply: "ac", status: "active",
        });
        setStatus("фидер создан: " + v.name, "ok");
        await this.reload();
      });
  }
  // Edit a feed: form with ALL fields (name, destination rack, voltage,
  // amperage, phase) prefilled with current values → PATCH. Empty rack →
  // rack:null (unbind a wrong pick). Racks come from the same server room as
  // the panel (as on create).
  _editFeed(info) {
    const feed = (state.powerFeeds || []).find(f => f.id === info.id);
    if (!feed) { setStatus("фидер не найден — обнови", "err"); return; }
    const panel = (state.powerPanels || []).find(p => p.id === (feed.power_panel && feed.power_panel.id));
    const locId = panel && panel.location && panel.location.id;
    const racksInLoc = (state.racks || []).filter(r => r.location && r.location.id === locId);
    const rackOpts = [{ value: "", label: "— без стойки —" },
      ...racksInLoc.map(r => ({ value: String(r.id), label: r.name }))];
    const curRack = feed.rack ? String(feed.rack.id) : "";
    const curPhase = (feed.phase && feed.phase.value) || feed.phase || "single-phase";
    this.app.openModal("Изменить фидер", "Щит: " + (panel ? panel.name : "?"),
      [
        { id: "name", label: "Название фидера", value: feed.name },
        { id: "rack", label: "Стойка (куда идёт)", type: "select", options: rackOpts, value: curRack },
        { id: "voltage", label: "Напряжение, В", value: feed.voltage ?? "" },
        { id: "amperage", label: "Ток, А", value: feed.amperage ?? "" },
        { id: "phase", label: "Фазность", type: "select", value: curPhase, options: [
          { value: "single-phase", label: "Однофазный" },
          { value: "three-phase", label: "Трёхфазный" }] },
      ],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api("/dcim/power-feeds/" + feed.id + "/", "PATCH", {
          name: v.name,
          rack: v.rack ? +v.rack : null,
          voltage: v.voltage ? +v.voltage : null,
          amperage: v.amperage ? +v.amperage : null,
          phase: v.phase || "single-phase",
        });
        setStatus("фидер изменён: " + v.name, "ok");
        await this.reload();
      }, "Сохранить");
  }

  // Right-click context menu on tree nodes.
  // Items: «Добавить ▸» (submenu of what can be nested), «Переместить»,
  // «Переименовать», «Удалить». Menu and submenus are built per node type.
  API_PATH = { region: "/dcim/regions/", sitegroup: "/dcim/site-groups/", site: "/dcim/sites/",
    location: "/dcim/locations/", rack: "/dcim/racks/", panel: "/dcim/power-panels/", feed: "/dcim/power-feeds/",
    device: "/dcim/devices/" };
  KIND_RU = { region: "регион", sitegroup: "группу площадок", site: "площадку",
    location: "серверную", rack: "стойку", panel: "щит", feed: "фидер", device: "устройство" };

  // Parse a tree node → {kind,id,name,site?,loc?}. null — not a node
  // (e.g. «— без региона —» with no data-region).
  _nodeInfo(el) {
    const d = el.dataset;
    if (el.classList.contains("tree-rack")) return { kind: "rack", id: +d.rack, name: el.textContent.trim(), site: +d.site, loc: +d.loc };
    if (el.classList.contains("tree-loc")) return { kind: "location", id: +d.loc, name: el.textContent.replace(/\s*\(пусто\)\s*$/, "").trim(), site: +d.site };
    if (el.classList.contains("tree-site")) return { kind: "site", id: +d.site, name: d.name || el.textContent.trim() };
    if (el.classList.contains("tree-sitegroup")) return { kind: "sitegroup", id: +d.sitegroup, name: el.textContent.trim() };
    if (el.classList.contains("tree-region")) return d.region ? { kind: "region", id: +d.region, name: el.textContent.trim() } : null;
    if (el.classList.contains("tree-panel")) return { kind: "panel", id: +d.panel, name: el.textContent.trim() };
    if (el.classList.contains("tree-feed")) return { kind: "feed", id: +d.feed, name: el.textContent.trim() };
    if (el.classList.contains("tree-dev")) return { kind: "device", id: +d.dev, name: el.textContent.trim(), loc: +d.loc };
    return null;
  }
  _site(id) { return state.sites.find(s => s.id === id) || { id, name: "" }; }
  _loc(id) { return state.locations.find(l => l.id === id) || { id, name: "" }; }

  // What can be "added" under a node → array of specs {label, fn?, submenu?}.
  // A server room (location) also gets equipment categories besides rack/panel,
  // each expanding as a nested hover submenu (Blender-style). An item creates a
  // device/rack/panel in that room the same way the «+» palette does
  // (device.addSolution/addRack/addPanel).
  _addOptions(info) {
    switch (info.kind) {
      case "root": return [
        { label: "Группа мест", fn: () => this._createSiteGroup(null) },
        { label: "Место (без группы)", fn: () => this._createSite(null) }];
      case "region": return [
        { label: "Место", fn: () => this._createSite({ id: info.id, name: info.name }) },
        // Site groups are an axis independent of regions (a group's parent is a
        // GROUP, not a region), so we create a root group.
        { label: "Группа мест", fn: () => this._createSiteGroup(null) }];
      case "sitegroup": {
        const grp = (state.siteGroups || []).find(g => g.id === info.id);
        return grp ? [
          { label: "Место", fn: () => this._createSiteInGroup(grp) },
          { label: "Подгруппа мест", fn: () => this._createSiteGroup({ id: info.id, name: info.name }) },
        ] : [];
      }
      case "site": return [
        { label: "Локация", fn: () => this._createLocation(this._site(info.id)) }];
      case "location": {
        const ctx = { siteId: info.site, locId: info.id, locName: info.name };
        return [
          { label: "Стойка", fn: () => this._createRack(this._site(info.site), this._loc(info.id)) },
          { label: "Силовой щит", fn: () => this._createPanel(this._site(info.site), this._loc(info.id)) },
          { label: "Потребитель", submenu: this._solutionSpecs("periph", ctx) },
          { label: "Сетевое оборудование", submenu: this._solutionSpecs("switch", ctx) },
          { label: "Контроллеры", submenu: this._solutionSpecs("controller", ctx) },
          { label: "Силовое оборудование", submenu: this._solutionSpecs("power", ctx) },
        ];
      }
      case "panel": {
        const panel = (state.powerPanels || []).find(p => p.id === info.id);
        return panel ? [{ label: "Фидер", fn: () => this._createFeed(panel) }] : [];
      }
      default: return [];
    }
  }
  // Solution-category submenu items (for the «Добавить» menu on a server room):
  // each catalog item → a row that creates it in room ctx the same way a
  // palette drop does (rack/panel/device by kind).
  _solutionSpecs(cat, ctx) {
    const c = SOLUTIONS[cat];
    if (!c) return [];
    return c.items.map(item => ({
      label: item.label,
      fn: () => {
        if (item.kind === "rack") this.app.device.addRack(ctx);
        else if (item.kind === "panel") this.app.device.addPanel(ctx);
        else this.app.device.addSolution(item, ctx);
      },
    }));
  }
  _movable(info) {
    return ["sitegroup", "site", "location", "rack", "panel", "feed", "device"].includes(info.kind);
  }

  _openContextMenu(info, x, y) {
    this._closeContextMenu();
    const menu = mk("div", { className: "treectx" });
    const items = [];
    const addOpts = this._addOptions(info);
    if (addOpts.length) items.push({ label: "Добавить", submenu: addOpts });
    // Root menu of the block — only «Добавить» (nothing to rename/delete).
    if (info.kind !== "root") {
      // The tree move modal handles containers only; a device is moved from its
      // passport (editDevice — rack/unit/location), so don't offer a dead item here.
      if (this._movable(info) && info.kind !== "device") items.push({ label: "Переместить", fn: () => this._move(info) });
      // Feed: «Изменить» (all fields incl. rack/voltage/amperage) instead of a
      // plain rename — lets you fix a wrong rack and the parameters.
      if (info.kind === "feed") items.push({ label: "Изменить", fn: () => this._editFeed(info) });
      else items.push({ label: "Переименовать", fn: () => this._rename(info) });
      items.push({ label: "Удалить", danger: true, fn: () => this._delete(info) });
    }
    for (const it of items) menu.appendChild(this._ctxRow(it));
    document.body.appendChild(menu);
    // Keep the menu within the viewport.
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 8)) + "px";
    this._ctxMenu = menu;
  }
  // Recursive context menu row: {label, fn?, submenu?, danger?}.
  // submenu — array of the same specs; any nesting depth («Добавить» →
  // equipment category → specific solution), submenus open on hover.
  _ctxRow(spec) {
    const hasSub = Array.isArray(spec.submenu) && spec.submenu.length;
    const row = mk("div", {
      className: "tc-item" + (spec.danger ? " danger" : "") + (hasSub ? " has-sub" : ""),
      html: `<span>${spec.label}</span>` + (hasSub ? `<span class="tc-arrow">▸</span>` : ""),
    });
    if (hasSub) {
      const sub = mk("div", { className: "tc-sub" });
      for (const child of spec.submenu) sub.appendChild(this._ctxRow(child));
      row.appendChild(sub);
    } else if (spec.fn) {
      row.addEventListener("click", e => { e.stopPropagation(); this._closeContextMenu(); spec.fn(); });
    }
    return row;
  }
  _closeContextMenu() { if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; } }

  _rename(info) {
    const hasSlug = info.kind === "region" || info.kind === "sitegroup" || info.kind === "site" || info.kind === "location";
    this.app.openModal("Переименовать", "Текущее: " + info.name,
      [{ id: "name", label: "Новое название", value: info.name, placeholder: info.name }],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api(this.API_PATH[info.kind] + info.id + "/", "PATCH",
          { name: v.name, ...(hasSlug ? { slug: slugify(v.name) } : {}) });
        setStatus("переименовано: " + v.name, "ok");
        await this.reload();
      });
  }
  // Cascade delete: NetBox refuses to delete a site/location/rack while it holds
  // contents (PROTECT → HTTP 409), so nested objects go FIRST, bottom-up.
  //
  // TWO TRAPS this guards against:
  //  1. NetBox SILENTLY IGNORES an unknown query filter. `power-feeds` has no
  //     `location_id` filter, so `?location_id=5` returned EVERY feed in the DB
  //     and the old code deleted them all. Never trust the server filter —
  //     re-check ownership client-side and drop anything outside the scope.
  //  2. `cable_terminations` is a GenericRelation: deleting a port/feed drops its
  //     terminations but leaves the Cable behind as an orphan. Delete cables
  //     explicitly before their endpoints.
  async _cascadeDelete(kind, id) {
    const del = (ep, oid) => api(`/dcim/${ep}/${oid}/`, "DELETE");
    // A cable can hang off two objects we delete (e.g. feed ↔ PDU power port), so
    // the second DELETE hits 404. Swallow "already gone", rethrow anything else.
    const delCable = async cid => {
      try { await del("cables", cid); }
      catch (e) { if (!/\b404\b/.test(e.message)) throw e; }
    };

    // Fetch + keep only objects that really belong to the scope.
    const owned = async (ep, query, belongs) =>
      (await apiAll(`/dcim/${ep}/?${query}`)).filter(belongs);

    // Cables of the given devices, deleted before the devices themselves.
    const delDeviceCables = async devIds => {
      if (!devIds.length) return;
      const cables = await apiAllByIds("/dcim/cables/", "device_id", devIds, "", 100);
      const seen = new Set();
      for (const c of cables) if (!seen.has(c.id)) { seen.add(c.id); await delCable(c.id); }
    };
    // Wireless links hang off the devices' interfaces (PROTECT), so a device with a
    // radio link 409s ("N dependent objects"). Drop the links BEFORE the devices.
    const delDeviceWireless = async devIds => {
      if (!devIds.length) return;
      const ifaces = await apiAllByIds("/dcim/interfaces/", "device_id", devIds, "", 100);
      const linkIds = new Set();
      for (const i of ifaces) { const wl = i.wireless_link; if (wl) linkIds.add(wl.id || wl); }
      for (const lid of linkIds) {
        try { await api(`/wireless/wireless-links/${lid}/`, "DELETE"); }
        catch (e) { if (!/\b404\b/.test(e.message)) throw e; }   // already gone — fine
      }
    };
    // A stacked switch may be its VirtualChassis master, and `master` is a PROTECT
    // fk — deleting it 409s. Detach the master, drop the devices, then remove the
    // chassis if it ended up empty.
    const delDevices = async devs => {
      const ids = devs.map(d => d.id);
      await delDeviceWireless(ids);
      await delDeviceCables(ids);

      const chassis = new Set(devs.filter(d => d.virtual_chassis).map(d => d.virtual_chassis.id));
      for (const vcId of chassis) {
        const vc = await api(`/dcim/virtual-chassis/${vcId}/`);
        if (vc.master && ids.includes(vc.master.id))
          await api(`/dcim/virtual-chassis/${vcId}/`, "PATCH", { master: null });
      }
      for (const d of devs) await del("devices", d.id);
      for (const vcId of chassis) {
        const left = (await apiAll(`/dcim/devices/?virtual_chassis_id=${vcId}`))
          .filter(d => d.virtual_chassis && d.virtual_chassis.id === vcId);
        if (!left.length) await del("virtual-chassis", vcId);
      }
    };
    // Feeds live under a panel; the only real filter is power_panel_id.
    const delPanelFeeds = async panelId => {
      const feeds = await owned("power-feeds", `power_panel_id=${panelId}`,
        f => f.power_panel && f.power_panel.id === panelId);
      for (const f of feeds) {
        if (f.cable) await delCable(f.cable.id);   // else the cable is orphaned
        await del("power-feeds", f.id);
      }
    };
    const delPanels = async panels => {
      for (const p of panels) { await delPanelFeeds(p.id); await del("power-panels", p.id); }
    };

    if (kind === "site" || kind === "location") {
      const isSite = kind === "site";
      const by = isSite ? "site_id" : "location_id";
      const owns = o => { const f = isSite ? o.site : o.location; return !!f && f.id === id; };

      await delDevices(await owned("devices", `${by}=${id}`, owns));
      await delPanels(await owned("power-panels", `${by}=${id}`, owns));
      for (const r of await owned("racks", `${by}=${id}`, owns)) await del("racks", r.id);

      if (isSite) {
        // Locations may nest — delete leaves first, repeat until nothing moves.
        for (let guard = 0; guard < 30; guard++) {
          const locs = await owned("locations", `site_id=${id}`, l => l.site && l.site.id === id);
          if (!locs.length) break;
          let progressed = false;
          for (const l of locs) { try { await del("locations", l.id); progressed = true; } catch (e) { /* parent busy */ } }
          if (!progressed) break;
        }
        await del("sites", id);
      } else {
        for (const l of await owned("locations", `parent_id=${id}`, l => l.parent && l.parent.id === id))
          await this._cascadeDelete("location", l.id);
        await del("locations", id);
      }
    } else if (kind === "rack") {
      await delDevices(await owned("devices", `rack_id=${id}`, d => d.rack && d.rack.id === id));
      await del("racks", id);
    } else if (kind === "panel") {
      await delPanelFeeds(id);
      await del("power-panels", id);
    } else if (kind === "device") {
      await delDevices([await api(`/dcim/devices/${id}/`)]);   // need virtual_chassis
    } else if (kind === "feed") {
      const f = await api(`/dcim/power-feeds/${id}/`);
      if (f && f.cable) await delCable(f.cable.id);
      await del("power-feeds", id);
    } else {
      await api(this.API_PATH[kind] + id + "/", "DELETE");
    }
  }
  _delete(info) {
    // A site group / region isn't a real container in NetBox — deleting it only
    // detaches its sites (they stay). Say so; the deep delete is done per location.
    const bare = info.kind === "sitegroup" || info.kind === "region";
    const where = bare
      ? `«${info.name}» будет удалён(а). Вложенные площадки и локации ОСТАНУТСЯ (станут без группы) — чтобы удалить содержимое, удаляй локации.`
      : "«" + info.name + "» и всё вложенное. Действие необратимо.";
    this.app.openModal("Удалить " + (this.KIND_RU[info.kind] || "элемент") + "?", where, [],
      async () => {
        setStatus("удаляю «" + info.name + "»…");
        await this._cascadeDelete(info.kind, info.id);
        setStatus("удалено: " + info.name, "ok");
        // If the deleted object was the schema's scope — reset the scope.
        if (state.scope && state.scope.type === info.kind && state.scope.id === info.id)
          state.scope = null;
        await this.reload();
      }, "Удалить");
  }
  _move(info) {
    let field, opts, curr;
    if (info.kind === "sitegroup") {
      field = "parent";
      const grp = (state.siteGroups || []).find(g => g.id === info.id);
      curr = grp && grp.parent ? String(grp.parent.id) : "";
      const banned = this._descendantGroupIds(info.id);   // self and descendants are forbidden
      opts = [{ value: "", label: "— корень (без группы) —" },
        ...(state.siteGroups || []).filter(g => !banned.has(g.id))
          .map(g => ({ value: String(g.id), label: g.name }))];
    } else if (info.kind === "site") {
      // A site lives under a site GROUP in the tree → move between groups.
      field = "group";
      const site = this._site(info.id); curr = site.group ? String(site.group.id) : "";
      opts = [{ value: "", label: "— без группы —" },
        ...(state.siteGroups || []).map(g => ({ value: String(g.id), label: g.name }))];
    } else if (info.kind === "location") {
      field = "site";
      const loc = this._loc(info.id); curr = loc.site ? String(loc.site.id) : "";
      opts = state.sites.map(s => ({ value: String(s.id), label: s.name }));
    } else if (info.kind === "rack" || info.kind === "panel") {
      field = "location";
      const cur = info.kind === "rack"
        ? (state.racks || []).find(r => r.id === info.id)
        : (state.powerPanels || []).find(p => p.id === info.id);
      curr = cur && cur.location ? String(cur.location.id) : "";
      opts = state.locations.map(l => ({ value: String(l.id),
        label: (l.site ? l.site.name + " · " : "") + l.name }));
    } else if (info.kind === "feed") {
      field = "power_panel";
      const feed = (state.powerFeeds || []).find(f => f.id === info.id);
      curr = feed && feed.power_panel ? String(feed.power_panel.id) : "";
      opts = state.powerPanels.map(p => ({ value: String(p.id), label: p.name }));
    } else { setStatus("этот элемент нельзя перемещать", "err"); return; }
    this.app.openModal("Переместить «" + info.name + "»", "Выбери нового родителя",
      [{ id: "parent", label: "Куда", type: "select", options: opts, value: curr }],
      async v => {
        if (this._cycleGuard(info.kind, info.id, v.parent ? +v.parent : null)) return;
        const body = { [field]: v.parent ? +v.parent : null };
        // Rack/panel also switch site along with the server room.
        if ((info.kind === "rack" || info.kind === "panel") && v.parent) {
          const loc = this._loc(+v.parent);
          if (loc && loc.site) body.site = loc.site.id;
        }
        await api(this.API_PATH[info.kind] + info.id + "/", "PATCH", body);
        setStatus("«" + info.name + "» перемещён(а)", "ok");
        await this.reload();
      }, "Переместить");
  }

  // Shift multi-select: toggle a node, clear the selection, group operations.
  // Only same-LEVEL objects can be selected (parent container, NODE_LEVEL) —
  // e.g. racks + panels together (both in a location). The first pick sets the
  // level. Selected — blue fill (.multi-sel); other same-level nodes still
  // addable — green outline (.multi-cand, see _updateSelCandidates).
  _toggleSelect(node) {
    const info = this._nodeInfo(node);
    if (!info) return;   // not a node (e.g. «— без региона —»)
    if (this.selection.has(node)) { this.selection.delete(node); node.classList.remove("multi-sel"); }
    else {
      const level = this._selLevel();
      if (level && NODE_LEVEL[info.kind] !== level) return;   // different level — skip
      this.selection.add(node); node.classList.add("multi-sel");
    }
    this._updateSelCandidates();
  }
  // Level of the current selection (from the first selected node).
  _selLevel() {
    for (const n of this.selection) { const i = this._nodeInfo(n); if (i) return NODE_LEVEL[i.kind]; }
    return null;
  }
  // Highlight candidates: same-level nodes not yet selected get a green
  // outline (.multi-cand). Empty selection → clear all highlights.
  _updateSelCandidates() {
    const tree = $("#tree");
    if (!tree) return;
    tree.querySelectorAll(".multi-cand").forEach(n => n.classList.remove("multi-cand"));
    // With a selection, mobile dims other-level checkboxes (levels can't mix).
    document.body.classList.toggle("tree-sel-active", this.selection.size > 0);
    const level = this._selLevel();
    if (!level) return;
    for (const n of tree.querySelectorAll(TREE_NODE_SEL)) {
      if (this.selection.has(n)) continue;
      const i = this._nodeInfo(n);
      if (i && NODE_LEVEL[i.kind] === level) n.classList.add("multi-cand");
    }
  }
  _clearSelection() {
    if (!this.selection.size) return;
    this.selection.forEach(n => n.classList.remove("multi-sel"));
    this.selection.clear();
    this._updateSelCandidates();   // clears the green candidate outlines
    this._syncMoveBar();           // remove the mobile action bar
  }
  // Menu for the selected group: «Переместить (N)» (if all share one movable
  // LEVEL — e.g. racks+panels in a location) and «Удалить (N)».
  _openGroupMenu(x, y) {
    this._closeContextMenu();
    const infos = [...this.selection].map(n => this._nodeInfo(n)).filter(Boolean);
    if (!infos.length) return;
    // Selection is always one level (_toggleSelect), but check explicitly.
    const sameLevel = new Set(infos.map(i => NODE_LEVEL[i.kind])).size === 1;
    const items = [];
    if (sameLevel && this._movable(infos[0]))
      items.push({ label: `Переместить (${infos.length})`, fn: () => this._moveMany(infos) });
    items.push({ label: `Удалить (${infos.length})`, danger: true, fn: () => this._deleteMany(infos) });
    const menu = mk("div", { className: "treectx" });
    for (const it of items) {
      const row = mk("div", { className: "tc-item" + (it.danger ? " danger" : ""), html: `<span>${it.label}</span>` });
      row.addEventListener("click", e => { e.stopPropagation(); this._closeContextMenu(); it.fn(); });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 8)) + "px";
    this._ctxMenu = menu;
  }
  _deleteMany(infos) {
    this.app.openModal(`Удалить объектов: ${infos.length}?`,
      infos.map(i => i.name).join(", ") + " — и всё вложенное. Действие необратимо.", [],
      async () => {
        for (const info of infos) {
          try { await this._cascadeDelete(info.kind, info.id); }
          catch (e) { setStatus("не удалить «" + info.name + "»: " + e.message, "err"); }
        }
        setStatus(`удалено объектов: ${infos.length}`, "ok");
        if (state.scope && infos.some(i => i.kind === state.scope.type && i.id === state.scope.id))
          state.scope = null;
        this._clearSelection();
        await this.reload();
      }, "Удалить");
  }
  _moveMany(infos) {
    const kind = infos[0].kind;
    let field, opts;
    if (kind === "sitegroup") {
      field = "parent";
      opts = [{ value: "", label: "— корень (без группы) —" },
        ...(state.siteGroups || []).map(g => ({ value: String(g.id), label: g.name }))];
    } else if (kind === "site") {
      field = "group";
      opts = [{ value: "", label: "— без группы —" },
        ...(state.siteGroups || []).map(g => ({ value: String(g.id), label: g.name }))];
    } else if (kind === "location") {
      field = "site";
      opts = state.sites.map(s => ({ value: String(s.id), label: s.name }));
    } else if (kind === "rack" || kind === "panel") {
      field = "location";
      opts = state.locations.map(l => ({ value: String(l.id),
        label: (l.site ? l.site.name + " · " : "") + l.name }));
    } else if (kind === "feed") {
      field = "power_panel";
      opts = state.powerPanels.map(p => ({ value: String(p.id), label: p.name }));
    } else { setStatus("эти элементы нельзя перемещать", "err"); return; }
    this.app.openModal(`Переместить объектов: ${infos.length}`, "Выбери нового родителя",
      [{ id: "parent", label: "Куда", type: "select", options: opts }],
      async v => {
        for (const info of infos) {
          if (this._cycleGuard(info.kind, info.id, v.parent ? +v.parent : null)) continue;
          const body = { [field]: v.parent ? +v.parent : null };
          if ((info.kind === "rack" || info.kind === "panel") && v.parent) {
            const loc = this._loc(+v.parent);
            if (loc && loc.site) body.site = loc.site.id;
          }
          try { await api(this.API_PATH[info.kind] + info.id + "/", "PATCH", body); }
          catch (e) { setStatus("не переместить «" + info.name + "»: " + e.message, "err"); }
        }
        setStatus(`перемещено объектов: ${infos.length}`, "ok");
        this._clearSelection();
        await this.reload();
      }, "Переместить");
  }

  // Scope selection / reload.
  // Clicking any hierarchy level (region / site / server room) loads ONLY it
  // and its descendants. state.scope = where the schema was loaded from →
  // shown in the «Стойки : …» and «Схема соединений : …» headers (currentLocationName).
  async selectScope(type, id, name, scrollRackId, force) {
    const racks = this._racksFor(type, id);
    this._highlightScope(type, id, scrollRackId);
    const key = type + ":" + id;
    if (force || state.groupKey !== key) {
      state.groupKey = key;
      state.scope = { type, id, name };
      await this.app.renderAll(racks);
    }
    if (scrollRackId && state.rackColEls[scrollRackId])
      state.rackColEls[scrollRackId].scrollIntoView({ behavior: "smooth", block: "start" });
    // Clicking a hierarchy node → its card in the details block (structure list).
    if (type === "location") this.app.device.showLocation({ id, name });
    else if (type === "site") this.app.device.showSite({ id, name });
    else if (type === "sitegroup") this.app.device.showGroup({ id, name });
  }

  // Racks in scope: server room → its own; site → all racks of its rooms;
  // region → all racks of the region's sites. Sort by site → room → rack so
  // one room's/site's columns stay contiguous — otherwise the dashed
  // Location/Site outlines on the schema can't be assembled.
  _racksFor(type, id) {
    const s = String(id);
    let racks;
    if (type === "rack")
      racks = state.racks.filter(r => String(r.id) === s);   // a single rack
    else if (type === "location")
      racks = state.racks.filter(r => r.location && String(r.location.id) === s);
    else if (type === "site")
      racks = state.racks.filter(r => r.site && String(r.site.id) === s);
    else if (type === "region") {
      const siteIds = new Set(state.sites
        .filter(x => x.region && String(x.region.id) === s).map(x => x.id));
      racks = state.racks.filter(r => r.site && siteIds.has(r.site.id));
    } else if (type === "sitegroup") {
      // recursive: sites of the group itself + all its subgroups.
      const gids = this._descendantGroupIds(id);
      const siteIds = new Set(state.sites
        .filter(x => x.group && gids.has(x.group.id)).map(x => x.id));
      racks = state.racks.filter(r => r.site && siteIds.has(r.site.id));
    } else return [];
    const key = r => [
      (r.site && r.site.name) || "", (r.location && r.location.name) || "", r.name || "",
    ];
    return racks.sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) { const c = ka[i].localeCompare(kb[i]); if (c) return c; }
      return 0;
    });
  }

  // Highlight the selected scope in the tree. LOGIC: only the selected root
  // (the parent the schema is built from) gets the bold accent bar on the left;
  // all its descendants present on the schema (sites, rooms, racks, panels,
  // feeds) get the thin grey .on-schema mark ("this is on the schema").
  // Everything else — default.
  _highlightScope(type, id, scrollRackId) {
    const all = ".tree-region,.tree-sitegroup,.tree-site,.tree-loc,.tree-rack,.tree-panel,.tree-feed,.tree-dev";
    document.querySelectorAll(all).forEach(x =>
      x.classList.remove("scope-active", "on-schema", "current", "active"));
    const s = String(id);
    // Sets of descendants actually present on the schema.
    const siteIds = new Set(), locIds = new Set(), subGroupIds = new Set();
    if (type === "location") locIds.add(s);
    else if (type === "site") {
      siteIds.add(s);
      state.locations.filter(l => l.site && String(l.site.id) === s)
        .forEach(l => locIds.add(String(l.id)));
    } else if (type === "region") {
      state.sites.filter(x => x.region && String(x.region.id) === s)
        .forEach(x => siteIds.add(String(x.id)));
      state.locations.filter(l => l.site && siteIds.has(String(l.site.id)))
        .forEach(l => locIds.add(String(l.id)));
    } else if (type === "sitegroup") {
      // recursive over subgroups (as in _racksFor).
      const gids = this._descendantGroupIds(s);
      // Nested subgroups (except the root itself) are also "on schema": the
      // whole branch loads → mark them grey .on-schema like sites/rooms
      // (small_fix «Инфраструктура» item 1). Root keeps the .scope-active accent bar.
      gids.forEach(gid => { if (String(gid) !== s) subGroupIds.add(String(gid)); });
      state.sites.filter(x => x.group && gids.has(x.group.id))
        .forEach(x => siteIds.add(String(x.id)));
      state.locations.filter(l => l.site && siteIds.has(String(l.site.id)))
        .forEach(l => locIds.add(String(l.id)));
    }
    const panelIds = new Set((state.powerPanels || [])
      .filter(p => p.location && locIds.has(String(p.location.id))).map(p => String(p.id)));
    const feedIds = new Set((state.powerFeeds || [])
      .filter(f => f.power_panel && panelIds.has(String(f.power_panel.id))).map(f => String(f.id)));
    const mark = (sel, cls) => document.querySelectorAll(sel).forEach(x => x.classList.add(cls));
    subGroupIds.forEach(v => mark(`.tree-sitegroup[data-sitegroup="${v}"]`, "on-schema"));
    siteIds.forEach(v => mark(`.tree-site[data-site="${v}"]`, "on-schema"));
    locIds.forEach(v => {
      mark(`.tree-loc[data-loc="${v}"]`, "on-schema");
      mark(`.tree-rack[data-loc="${v}"]`, "on-schema");
      mark(`.tree-dev[data-loc="${v}"]`, "on-schema");   // location devices are "on schema"
    });
    panelIds.forEach(v => mark(`.tree-panel[data-panel="${v}"]`, "on-schema"));
    feedIds.forEach(v => mark(`.tree-feed[data-feed="${v}"]`, "on-schema"));
    // Selected root gets the only bold bar (strip its on-schema).
    const rootSel = { region: `.tree-region[data-region="${s}"]`,
      sitegroup: `.tree-sitegroup[data-sitegroup="${s}"]`,
      site: `.tree-site[data-site="${s}"]`, location: `.tree-loc[data-loc="${s}"]`,
      rack: `.tree-rack[data-rack="${s}"]` }[type];
    if (rootSel) document.querySelectorAll(rootSel).forEach(x => {
      x.classList.remove("on-schema"); x.classList.add("scope-active");
    });
    if (scrollRackId) mark(`.tree-rack[data-rack="${scrollRackId}"]`, "current");
  }

  async reload() {
    const scope = state.scope;
    // Preserve the view (zoom + canvas scroll): adding/editing a device goes
    // through reload (connect+selectScope), so sameScope didn't kick in and the
    // canvas jumped to center. Restore the position after reloading.
    const pane = $("#schempane");
    const view = pane ? { z: state.zoom, l: pane.scrollLeft, t: pane.scrollTop } : null;
    await this.app.connect();
    if (scope) await this.selectScope(scope.type, scope.id, scope.name, null, true);
    // Scope gone (its object was just deleted) → wipe the canvas, else the schema
    // of the deleted objects lingers on screen.
    else if (pane) pane.innerHTML = `<div class="placeholder">Выбери серверную или стойку слева</div>`;
    if (view && pane) {
      state.zoom = view.z;
      if (this.app.schema && this.app.schema.applyZoom) this.app.schema.applyZoom();
      pane.scrollLeft = view.l; pane.scrollTop = view.t;
    }
  }

  // Drag-and-drop (hold → ring → move)
  _ring() { return document.getElementById("holdring"); }
  _moveRing(x, y) { const r = this._ring(); r.style.left = x + "px"; r.style.top = y + "px"; }
  _showRing(x, y) {
    const fg = this._ring().querySelector(".fg");
    fg.style.strokeDasharray = RING_LEN;
    fg.style.strokeDashoffset = RING_LEN;
    this._moveRing(x, y);
    this._ring().style.display = "block";
    const t0 = performance.now();
    const step = now => {
      const p = Math.min((now - t0) / HOLD_MS, 1);
      fg.style.strokeDashoffset = RING_LEN * (1 - p);
      if (p < 1) this.hold.raf = requestAnimationFrame(step);
    };
    this.hold.raf = requestAnimationFrame(step);
  }
  _hideRing() {
    this._ring().style.display = "none";
    if (this.hold.raf) cancelAnimationFrame(this.hold.raf);
    this.hold.raf = null;
  }
  _cancelHold() {
    clearTimeout(this.hold.delay); this.hold.delay = null;
    clearTimeout(this.hold.timer); this.hold.timer = null;
    this._hideRing();
    this.hold.el = null;
  }
  _startDrag() {
    // Start may come from the hold timer or from mouse movement — kill the timers.
    clearTimeout(this.hold.delay); this.hold.delay = null;
    clearTimeout(this.hold.timer); this.hold.timer = null;
    this._hideRing();
    if (!this.hold.el || !this.hold.el._dragInfo) return;
    this.hold.drag = this.hold.el._dragInfo;
    this.hold.dragged = true;
    // Dragged nodes: on a group move — ALL selected, otherwise just one.
    const dragged = this.hold.groupDrag ? new Set(this.selection) : new Set([this.hold.el]);
    dragged.forEach(n => n.classList.add("dragging"));
    // "Where can I drop" hint: valid targets (drop targets matching the drag
    // type) stay bright and slightly highlighted; the REST of the tree dims.
    // E.g. dragging a rack → only server rooms stay lit. All selected nodes
    // share one level → one target type.
    const valid = new Set(this.dropTargets
      .filter(t => t.accepts === this.hold.drag.type).map(t => t.el));
    this.hold.faded = []; this.hold.targets = [];
    document.querySelectorAll(TREE_NODE_SEL).forEach(n => {
      if (dragged.has(n)) return;   // leave the dragged nodes alone
      if (valid.has(n)) { n.classList.add("drag-ok"); this.hold.targets.push(n); }
      else { n.classList.add("drag-fade"); this.hold.faded.push(n); }
    });
    document.body.classList.add("tree-dragging");
  }
  _endDrag() {
    document.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
    (this.hold.faded || []).forEach(n => n.classList.remove("drag-fade"));
    (this.hold.targets || []).forEach(n => n.classList.remove("drag-ok"));
    document.body.classList.remove("tree-dragging");
    document.querySelectorAll(".drop-ok").forEach(x => this._clearDropLabel(x));
    this.hold.el = null; this.hold.drag = null; this.hold.faded = null; this.hold.targets = null;
    this.hold.groupDrag = false;
  }
  _setDropLabel(el) {
    if (el.classList.contains("drop-ok")) return;
    el.classList.add("drop-ok");
    el._label0 = el.innerHTML;   // innerHTML, not textContent — keep the icon
    el.textContent = "↳ Вставить сюда";
  }
  _clearDropLabel(el) {
    el.classList.remove("drop-ok");
    if (el._label0 != null) { el.innerHTML = el._label0; el._label0 = null; }
  }
  _makeDraggable(el, type, id, name) {
    el._dragInfo = { type, id, name };
    el.addEventListener("mousedown", ev => {
      if (ev.button !== 0 || ev.shiftKey) return;   // Shift means multi-select, not a move
      this.hold.el = el;
      const x = ev.clientX, y = ev.clientY;
      this.hold.sx = x; this.hold.sy = y;   // start point for the movement threshold (drag on move)
      // Dragging one of the SELECTED (≥2) → group move: no hold ring (it gets
      // in the way), start right on mouse movement. Otherwise as before.
      this.hold.groupDrag = this.selection.has(el) && this.selection.size > 1;
      if (!this.hold.groupDrag) {
        this.hold.delay = setTimeout(() => {
          this._showRing(x, y);
          this.hold.timer = setTimeout(() => this._startDrag(), HOLD_MS);
        }, RING_DELAY);
      }
    });
  }
  // field — optional relation field for _applyMove (e.g. a site can be dropped
  // on a region → region, or on a site group → group). Defaults by type.
  _makeDropTarget(el, accepts, parentId, field) {
    this.dropTargets.push({ el, accepts, parentId, field });
    el.addEventListener("mouseenter", () => {
      if (this.hold.drag && this.hold.drag.type === accepts) this._setDropLabel(el);
    });
    el.addEventListener("mouseleave", () => this._clearDropLabel(el));
  }
  _wireGlobal() {
    // Mobile buttons: «Выбрать» (select mode) in the tree header and «+» on the
    // schema (creation catalog for the current scope). Static in the template → bound once.
    const selBtn = document.getElementById("tree-select-btn");
    if (selBtn) selBtn.addEventListener("click", e => { e.stopPropagation(); this._toggleSelectMode(); });
    const addBtn = document.getElementById("schem-add");
    if (addBtn) addBtn.addEventListener("click", e => { e.stopPropagation(); this._openSchemAdd(); });

    document.addEventListener("mousemove", ev => {
      // Held on a node but move not started: crossing the movement threshold
      // starts the move immediately (no hold wait) — "press and drag" feels
      // natural. Standing still — wait for the hold ring as before.
      if (this.hold.el && !this.hold.drag) {
        const dx = ev.clientX - this.hold.sx, dy = ev.clientY - this.hold.sy;
        if (Math.abs(dx) + Math.abs(dy) > 6) this._startDrag();
        else if (this.hold.timer || this.hold.delay) this._moveRing(ev.clientX, ev.clientY);
      }
    });
    document.addEventListener("mouseup", async ev => {
      // Move never started (plain click/hold without motion) → clear ring/hold.
      if (!this.hold.drag) { this._cancelHold(); return; }
      const drag = this.hold.drag, group = this.hold.groupDrag;
      const tgt = this.dropTargets.find(t => t.accepts === drag.type && t.el.contains(ev.target));
      this._endDrag();
      if (tgt) {
        if (group) await this._applyMoveMany(tgt);   // move all selected nodes
        else await this._applyMove(drag, tgt.accepts, tgt.parentId, tgt.field);
      }
    });
    // suppress the click after a drag (else it would also act as a selection)
    document.addEventListener("click", ev => {
      if (this.hold.dragged) { ev.stopPropagation(); ev.preventDefault(); this.hold.dragged = false; }
    }, true);
    // Shift multi-select: intercept the click in capture phase BEFORE the node's
    // navigation handler (selectScope). Shift+click toggles the node's selection;
    // a plain click clears multi-select (and lets navigation run).
    document.addEventListener("click", ev => {
      // Click right AFTER a swipe (touch gesture) — suppress: no navigation, no
      // duplicate selection toggle.
      if (this._swiped) { this._swiped = false; ev.stopPropagation(); ev.preventDefault(); return; }
      const node = ev.target.closest(TREE_NODE_SEL);
      // Mobile select mode: tapping a node toggles selection (no navigation).
      if (document.body.classList.contains("tree-selecting") && !this.moveMode
          && node && $("#tree").contains(node)) {
        ev.preventDefault(); ev.stopPropagation();
        this._toggleSelect(node); this._syncMoveBar(); return;
      }
      if (ev.shiftKey && node && $("#tree").contains(node)) {
        ev.preventDefault(); ev.stopPropagation();
        this._toggleSelect(node);
      } else if (!ev.shiftKey && !this.moveMode && !document.body.classList.contains("tree-selecting")) {
        // In «Выбрать» mode a tap outside a node (e.g. on an action-bar button)
        // does NOT clear selection — «Переместить» used to lose it before its handler.
        this._clearSelection();
      }
    }, true);
    // Right-click on a tree node → context menu. Delegated to document to
    // survive tree rebuilds (build wipes innerHTML). Right-click on empty space
    // of the «Инфраструктура» block (#side-infra) → root creation menu
    // (region / site) — create objects without switching edit mode.
    document.addEventListener("contextmenu", ev => {
      const el = ev.target.closest(TREE_NODE_SEL);   // includes .tree-dev → devices get the menu (rename/delete)
      if (el && $("#tree").contains(el)) {
        const info = this._nodeInfo(el);
        if (!info) return;
        ev.preventDefault();
        // Right-click on one of the selected (multi-select ≥2) → group menu.
        if (this.selection.size >= 2 && this.selection.has(el))
          this._openGroupMenu(ev.clientX, ev.clientY);
        else
          this._openContextMenu(info, ev.clientX, ev.clientY);
      } else if (ev.target.closest("#side-infra")) {
        ev.preventDefault();
        this._openContextMenu({ kind: "root" }, ev.clientX, ev.clientY);
      }
    });
    // Close the menu: outside click, Escape, tree/page scroll.
    document.addEventListener("mousedown", ev => {
      if (this._ctxMenu && !ev.target.closest(".treectx")) this._closeContextMenu();
    });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") this._closeContextMenu(); });
    document.addEventListener("scroll", () => this._closeContextMenu(), true);
  }
  // PATCH path+body for moving node type/id under a new parent parentId.
  // Shared by single (_applyMove) and group (_applyMoveMany) moves.
  _moveBody(type, id, parentId, field) {
    if (type === "sitegroup")
      return { path: "/dcim/site-groups/" + id + "/", body: { parent: parentId },
        where: parentId ? "группу" : "корень" };
    if (type === "site")
      return field === "group"
        ? { path: "/dcim/sites/" + id + "/", body: { group: parentId }, where: "группу мест" }
        : { path: "/dcim/sites/" + id + "/", body: { region: parentId }, where: parentId ? "регион" : "без региона" };
    if (type === "location")
      return { path: "/dcim/locations/" + id + "/", body: { site: parentId }, where: "площадку" };
    if (type === "rack" || type === "panel") {
      const loc = state.locations.find(l => l.id === parentId);
      const base = type === "rack" ? "/dcim/racks/" : "/dcim/power-panels/";
      return { path: base + id + "/", body: { location: parentId, ...(loc && loc.site ? { site: loc.site.id } : {}) }, where: "серверную" };
    }
    if (type === "feed")
      return { path: "/dcim/power-feeds/" + id + "/", body: { power_panel: parentId }, where: "щит" };
    if (type === "device") {
      const loc = state.locations.find(l => l.id === parentId);
      return { path: "/dcim/devices/" + id + "/", body: { location: parentId, ...(loc && loc.site ? { site: loc.site.id } : {}) }, where: "серверную" };
    }
    return null;
  }
  // A group can't be nested into itself/its own subgroup (cycle).
  _cycleGuard(type, id, parentId) {
    if (type !== "sitegroup" || parentId == null) return false;
    if (this._descendantGroupIds(id).has(Number(parentId))) {
      setStatus("нельзя вложить группу в саму себя или свою подгруппу", "err");
      return true;
    }
    return false;
  }
  async _applyMove(drag, type, parentId, field) {
    if (this._cycleGuard(type, drag.id, parentId)) return;
    const m = this._moveBody(type, drag.id, parentId, field);
    if (!m) return;
    try {
      await api(m.path, "PATCH", m.body);
      setStatus(`«${drag.name}» перемещён(а) в ${m.where}`, "ok");
      await this.reload();
    } catch (e) {
      setStatus("не удалось переместить: " + e.message, "err");
    }
  }
  // Group move (dragging one of the selected): move ALL selected nodes under
  // the drop target's parent and KEEP the visual selection after reload.
  async _applyMoveMany(tgt) {
    const infos = [...this.selection].map(n => this._nodeInfo(n)).filter(Boolean);
    if (!infos.length) return;
    let ok = 0;
    for (const info of infos) {
      if (this._cycleGuard(info.kind, info.id, tgt.parentId)) continue;
      const m = this._moveBody(info.kind, info.id, tgt.parentId, tgt.field);
      if (!m) continue;
      try { await api(m.path, "PATCH", m.body); ok++; }
      catch (e) { setStatus(`не переместить «${info.name}»: ${e.message}`, "err"); }
    }
    setStatus(`перемещено объектов: ${ok}`, "ok");
    await this.reload();
    this._restoreSelection(infos);
  }
  // Restore the selection (by kind+id) after a tree rebuild — keeps the
  // selected highlight after a group move.
  _restoreSelection(infos) {
    const tree = $("#tree");
    if (!tree) return;
    const CLS = { region: "region", sitegroup: "sitegroup", site: "site", location: "loc",
      rack: "rack", panel: "panel", feed: "feed", device: "dev" };
    for (const info of infos) {
      const key = CLS[info.kind];
      const n = key && tree.querySelector(`.tree-${key}[data-${key}="${info.id}"]`);
      if (n) { this.selection.add(n); n.classList.add("multi-sel"); }
    }
    this._updateSelCandidates();
    this._syncMoveBar();
  }

  // ── Mobile select/move/create (no swipes — unreliable on iOS) ────────
  // Select mode is toggled by the «Выбрать» button in the tree header: every row
  // gets a checkbox, tap toggles selection (handler in _wireGlobal, capture).
  // Multi-select is one level only (_toggleSelect). Bottom action bar:
  // «Переместить/Удалить/Готово».
  _toggleSelectMode() {
    if (document.body.classList.contains("tree-selecting")) { this._exitSelectMode(); return; }
    document.body.classList.add("tree-selecting");
    this._updateSelBtn();
    this._syncMoveBar();
  }
  _exitSelectMode() {
    this._exitMoveMode();
    this._clearSelection();
    document.body.classList.remove("tree-selecting");
    this._updateSelBtn();
    this._syncMoveBar();
  }
  _updateSelBtn() {
    const b = document.getElementById("tree-select-btn");
    if (b) b.textContent = document.body.classList.contains("tree-selecting") ? "Отмена" : "Выбрать";
  }
  // «+» on the schema → creation catalog for the CURRENT scope (state.scope).
  _scopeAddInfo() {
    const s = state.scope;
    if (!s) return null;
    if (s.type === "location") { const loc = this._loc(s.id); return { kind: "location", id: s.id, name: s.name, site: loc && loc.site && loc.site.id }; }
    if (s.type === "site") return { kind: "site", id: s.id, name: s.name };
    if (s.type === "sitegroup") return { kind: "sitegroup", id: s.id, name: s.name };
    return null;
  }
  _openSchemAdd() {
    const info = this._scopeAddInfo();
    // Contextual to the loaded scope (device in a location, location in a site,
    // site in a group) PLUS a "Верхний уровень" section so a group / ungrouped
    // site is always creatable — even with nothing loaded yet.
    const root = { label: "Верхний уровень", submenu: this._addOptions({ kind: "root" }) };
    const opts = info ? [...this._addOptions(info), root] : [root];
    this._openAddCatalog(info || { kind: "root", name: "верхний уровень" }, opts);
  }
  // Floating action bar (touch): in select mode — Переместить/Удалить/Готово;
  // in move mode — a "pick a destination" hint + Отмена.
  _syncMoveBar() {
    const touch = matchMedia("(pointer: coarse)").matches || innerWidth <= 760;
    const selecting = document.body.classList.contains("tree-selecting");
    let bar = document.getElementById("tree-actions");
    if (!touch || (!selecting && !this.moveMode)) { if (bar) bar.remove(); return; }
    if (!bar) { bar = mk("div", { id: "tree-actions" }); document.body.appendChild(bar); }
    const n = this.selection.size;
    if (this.moveMode) {
      if (this._armedTarget) {                             // destination picked → show «Применить»
        const info = this._nodeInfo(this._armedTarget);
        bar.innerHTML = `<span class="ta-hint">Сюда: ${info ? info.name : "…"}</span>` +
          `<button class="ta-apply">Применить</button><button class="ta-cancel">Отмена</button>`;
        bar.querySelector(".ta-apply").addEventListener("click", e => { e.stopPropagation(); this._confirmMove(); });
      } else {
        bar.innerHTML = `<span class="ta-hint">Выбери, куда переместить (${n})</span><button class="ta-cancel">Отмена</button>`;
      }
      bar.querySelector(".ta-cancel").addEventListener("click", e => { e.stopPropagation(); this._exitMoveMode(); });
    } else if (n) {
      bar.innerHTML = `<button class="ta-move">Переместить (${n})</button>` +
        `<button class="ta-del">Удалить (${n})</button><button class="ta-cancel">Отмена</button>`;
      bar.querySelector(".ta-move").addEventListener("click", e => { e.stopPropagation(); this._startMoveMode(); });
      bar.querySelector(".ta-del").addEventListener("click", e => { e.stopPropagation();
        this._deleteMany([...this.selection].map(x => this._nodeInfo(x)).filter(Boolean)); });
      bar.querySelector(".ta-cancel").addEventListener("click", e => { e.stopPropagation(); this._exitSelectMode(); });
    } else {
      bar.innerHTML = `<span class="ta-hint">Тапни элементы одного уровня</span><button class="ta-cancel">Отмена</button>`;
      bar.querySelector(".ta-cancel").addEventListener("click", e => { e.stopPropagation(); this._exitSelectMode(); });
    }
  }
  // Enter move mode: mark valid targets «← сюда?»; tapping a target arms it
  // (highlight), the move runs via the «Применить» button below (same API as drag-drop).
  _startMoveMode() {
    const infos = [...this.selection].map(n => this._nodeInfo(n)).filter(Boolean);
    if (!infos.length || !this._movable(infos[0])) { setStatus("эти элементы нельзя перемещать", "err"); return; }
    const kind = infos[0].kind;
    this._moveTargets = this.dropTargets.filter(t => t.accepts === kind);
    if (!this._moveTargets.length) { setStatus("нет подходящих мест для переноса", ""); return; }
    this.moveMode = { kind }; this._armedTarget = null;
    document.body.classList.add("tree-moving");
    for (const t of this._moveTargets) t.el.classList.add("move-target");
    // Keep ONLY valid targets and their navigator containers in the tree; hide
    // the rest: devices/racks/panels → rooms; rooms → sites + site groups.
    const SHOW = {
      device: ["tree-loc"], rack: ["tree-loc"], panel: ["tree-loc"],
      location: ["tree-site", "tree-sitegroup"],
      site: ["tree-sitegroup"], sitegroup: ["tree-sitegroup"],
      feed: ["tree-panel", "tree-loc"],
    };
    const show = SHOW[kind] || [];
    for (const el of $("#tree").children) {
      if (el.classList.contains("placeholder")) continue;
      // A drop target (incl. the «Всё дерево» root) always stays visible.
      el.classList.toggle("move-hidden",
        !el.classList.contains("move-target") && !show.some(c => el.classList.contains(c)));
    }
    this._onMoveClick = ev => {
      const tEl = ev.target.closest(".move-target");
      if (tEl && $("#tree").contains(tEl)) {
        ev.preventDefault(); ev.stopPropagation();
        if (this._armedTarget) this._armedTarget.classList.remove("move-armed");
        this._armedTarget = tEl; tEl.classList.add("move-armed");
        this._syncMoveBar();                             // shows «Применить»
        return;
      }
      // Tap in the tree missing a target — swallow it (no navigation/loading/
      // collapsing: a collapse would rebuild the tree and break the mode).
      // Exit only via the «Отмена» button.
      if (ev.target.closest("#tree")) { ev.preventDefault(); ev.stopPropagation(); }
    };
    document.addEventListener("click", this._onMoveClick, true);
    this._syncMoveBar();
  }
  _exitMoveMode() {
    if (this._onMoveClick) { document.removeEventListener("click", this._onMoveClick, true); this._onMoveClick = null; }
    if (!this.moveMode) return;
    document.body.classList.remove("tree-moving");
    (this._moveTargets || []).forEach(t => t.el.classList.remove("move-target", "move-armed"));
    const tree = $("#tree");
    if (tree) tree.querySelectorAll(".move-hidden").forEach(el => el.classList.remove("move-hidden"));
    this._moveTargets = null; this._armedTarget = null; this.moveMode = null;
    this._syncMoveBar();
  }
  // «Применить»: move the selected into the armed target and EXIT select mode.
  async _confirmMove() {
    const t = this._moveTargets && this._moveTargets.find(x => x.el === this._armedTarget);
    if (!t) { setStatus("сначала выбери место", ""); return; }
    const tgt = { parentId: t.parentId, field: t.field };   // capture before the tree rebuild
    setStatus("перемещаю…");
    // Do NOT exit the mode early: wait for the move + reload (reload rebuilds
    // the tree and drops move mode), and only AFTER loading exit «Выбрать».
    await this._applyMoveMany(tgt);
    this._exitMoveMode();          // safety net (in case reload didn't rebuild)
    this._exitSelectMode();
  }
  // Creation catalog for nested items (the «+» button): _addOptions entries,
  // solution submenus flattened into a list. Tap an item → its fn
  // (e.g. addSolution → data form).
  _openAddCatalog(info, opts) {
    this._closeContextMenu();
    const old = document.getElementById("add-catalog"); if (old) old.remove();
    const sheet = mk("div", { id: "add-catalog" });
    const close = () => sheet.remove();
    const head = mk("div", { className: "ac-head", html: `<span>Добавить в «${info.name}»</span>` });
    const xb = mk("button", { className: "ac-x", html: `<i class="mdi mdi-close"></i>` });
    xb.addEventListener("click", e => { e.stopPropagation(); close(); });
    head.appendChild(xb); sheet.appendChild(head);
    const body = mk("div", { className: "ac-body" });
    for (const o of opts) {
      if (o.submenu && o.submenu.length) {
        body.appendChild(mk("div", { className: "ac-cat", text: o.label }));
        for (const s of o.submenu) body.appendChild(this._acItem(s, close));
      } else if (o.fn) body.appendChild(this._acItem(o, close));
    }
    // No device options (only containers listed — location / site / group) →
    // hint + «Добавить в…» (pick a server room and add the device right into it).
    if (!opts.some(o => o.submenu)) {
      const into = mk("button", { className: "ac-into", text: "Добавить в…" });
      into.addEventListener("click", e => { e.stopPropagation(); this._pickLocationForAdd(body); });
      body.appendChild(into);
    }
    sheet.appendChild(body);
    sheet.addEventListener("click", e => { if (e.target === sheet) close(); });
    document.body.appendChild(sheet);
  }
  // «Добавить в…»: list of server rooms (within the current site if one is
  // selected) → picking one opens the creation catalog for that room (with devices).
  _pickLocationForAdd(body) {
    const s = state.scope;
    let list = state.locations || [];
    if (s && s.type === "site") list = list.filter(l => l.site && l.site.id === s.id);
    body.innerHTML = "";
    body.appendChild(mk("div", { className: "ac-cat", text: "Куда добавить устройство" }));
    if (!list.length) { body.appendChild(mk("div", { className: "ac-note", text: "Серверных нет — сначала создай локацию." })); return; }
    for (const l of list) {
      const row = mk("button", { className: "ac-item",
        html: `<span>${(l.site ? l.site.name + " · " : "") + l.name}</span>` });
      row.addEventListener("click", e => {
        e.stopPropagation();
        const doc = document.getElementById("add-catalog"); if (doc) doc.remove();
        const info = { kind: "location", id: l.id, name: l.name, site: l.site && l.site.id };
        this._openAddCatalog(info, this._addOptions(info));
      });
      body.appendChild(row);
    }
  }
  _acItem(o, close) {
    const row = mk("button", { className: "ac-item", html: `<span>${o.label}</span>` });
    row.addEventListener("click", e => { e.stopPropagation(); close(); if (o.fn) o.fn(); });
    return row;
  }
}
