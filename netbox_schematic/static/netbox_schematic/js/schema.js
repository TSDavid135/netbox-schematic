"use strict";
// SchemaManager: 2D connection schema
// Draws device nodes with ports, cable wires, the targeting mode and cable
// creation/removal. Schema edit mode — Mode.on("schema").

import {
  $, state, mk, px, attachTip, attachPinchZoom, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, apiAllByIds, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox } from "./schema_util.js";
import { NodeMethods } from "./schema_nodes.js";
import { ContourMethods } from "./schema_contours.js";
import { PowerMethods } from "./schema_power.js";
import { iconForDevice } from "./solutions.js";
import { WireMethods } from "./schema_wires.js";
import { InteractMethods } from "./schema_interact.js";
import { SOLUTIONS, SOLUTION_CATS, catalogGroup } from "./solutions.js";

// SchemaManager is split across modules: base methods (constructor, render,
// predicates, view/zoom/pan) live here, the rest come in as mixins. _mixin
// copies NON-enumerable prototype methods (Object.assign misses them).
function _mixin(target, ...protos) {
  for (const p of protos)
    for (const k of Object.getOwnPropertyNames(p))
      if (k !== "constructor")
        Object.defineProperty(target, k, Object.getOwnPropertyDescriptor(p, k));
}

// Geometry of off-rack device "pockets" (type contours to the RIGHT of their
// server room's racks): contour header/padding, node grid step, contour gaps,
// wrap into a sub-column (SUBCOL_GAP) and the gap between a pocket and the
// next server room (AREA_SEP — with margin for contour clamp bounds, see clampX).
const OFFGEO = { HEAD_H: 40, PAD: 14, ROW_H: 108, HGAP: 20, VGAP: 24, SUBCOL_GAP: 44, AREA_SEP: 140 };

export class SchemaManager {
  constructor(app) {
    this.app = app;
    this.LEFT_PAD = 80;
    this.TOP_PAD = 150;
    this.SLOT = COL_W;   // column slot width; grows to fit the widest node (render)
    this.linkmenu = $("#linkmenu");
    this.cablepop = $("#cablepop");
    this._wire();
    // On leaving schema mode — reset any in-progress cable run
    // and close an open type-picker popover.
    Mode.onChange("schema", active => {
      this._highlightStack(null);   // a stack highlight must not linger across a mode switch (it dims the whole canvas)
      if (!active) { this.setPending(null); if (this._closeCablePop) this._closeCablePop(); }
      // Edit-mode change without a full renderAll: re-lay nodes (in net view —
      // green assignable ports and the wireless "+"), redraw panels ("+ feeder").
      if (Object.keys(state.nodeEls).length) {
        this.relayoutNodes();   // ports/width per mode (trace view keeps node positions)
        // Panels/full redraw — normal view only; in trace view relayoutNodes
        // already redrew the wires (_drawTrace), and there are no panels there.
        if (!state.single) { this._rerenderPowerPanels(); this.redrawWires(); }
      }
    });
  }

  render(group, byRack, devPorts) {
    this._lastRender = { group, byRack, devPorts };   // for re-render (node gap slider)
    state.single = null;   // normal area render → leave single-view
    const pane = $("#schempane");
    // Keep the scroll position when re-rendering the SAME area (new node,
    // reload, gap change) — otherwise center (first render / area change).
    // The position used to jump when nodes appeared (small_fix q10).
    const sameScope = this._lastRenderKey === state.groupKey;
    const keepL = pane.scrollLeft, keepT = pane.scrollTop;
    this._lastRenderKey = state.groupKey;
    this._computePads(pane);
    const loc = currentLocationName();
    const title = loc ? `Схема соединений : ${loc}` : "Схема соединений";
    pane.innerHTML = `<p class="pane-title"><button id="rack-expand" class="pane-toggle" title="Показать блок стоек"><i class="mdi mdi-chevron-right"></i></button><span class="pt-label">${title}</span></p>
      <div id="schema"><svg id="wires" class="${state.wiresAbovePorts ? "above-ports" : ""}"></svg></div>
      <div id="zoomhint">масштаб 100% · Ctrl+колесо или колесо</div>`;
    $("#schemoverlay").innerHTML = `
      <div id="schem-topright">
        <div class="st-topbar">
          ${modeBtn("schema", "schem-topbtn")}
          <div id="viewswitch" title="Режим отображения схемы" data-view="${state.viewMode}">
            <button class="vs-btn" data-view="phys"><i class="mdi mdi-lan"></i> Физический</button>
            <button class="vs-btn" data-view="net"><i class="mdi mdi-access-point-network"></i> Беспроводной</button>
          </div>
        </div>
        <div class="st-squares">
          <div id="layers">
            <div class="ly-toggle" id="ly-toggle">
              <span class="short-name">Lr</span>
              <span class="full-name"><i class="mdi mdi-layers-outline"></i> Слои</span>
              <span class="arrow"><i class="mdi mdi-chevron-down"></i></span>
            </div>
            <div class="ly-body"></div>
          </div>
          <div id="rolefilter">
            <div class="fl-toggle" id="fl-toggle">
              <span class="short-name">Fl</span>
              <span class="full-name">Фильтры</span>
              <span class="arrow"><i class="mdi mdi-chevron-down"></i></span>
            </div>
            <div class="fl-body"></div>
          </div>
          <div id="schemtools">
            <div class="st-toggle" id="st-toggle">
              <span class="short-name">UI</span>
              <span class="full-name">Настройки</span>
              <span class="arrow"><i class="mdi mdi-chevron-down"></i></span>
            </div>
            <div class="st-body">
              <div class="st-seg" id="st-wirestyle">
                <button class="st-seg-btn ${state.wireStyle === "round" ? "active" : ""}" data-style="round"><i class="mdi mdi-vector-curve"></i> Круглые</button>
                <button class="st-seg-btn ${state.wireStyle === "angular" ? "active" : ""}" data-style="angular"><i class="mdi mdi-vector-polyline"></i> Углы</button>
              </div>
              <div class="st-seg" id="st-pathmode" title="Короткий — напрямую; Расширенный — в обход нод (для «Углов»)">
                <button class="st-seg-btn ${state.wirePath === "short" ? "active" : ""}" data-path="short"><i class="mdi mdi-ray-start-end"></i> Короткий</button>
                <button class="st-seg-btn ${state.wirePath === "extend" ? "active" : ""}" data-path="extend"><i class="mdi mdi-vector-square"></i> Расширенный</button>
              </div>
              <div class="st-row">
                <label>высота дуг <span id="st-wh-val">${(state.wireHeightK ?? 1).toFixed(1)}×</span></label>
                <input type="range" id="st-wireheight" min="0" max="3" step="0.1" value="${state.wireHeightK ?? 1}">
              </div>
              <div class="st-row">
                <label>промежуток нод <span id="st-ng-val">${state.nodeGap ?? NODE_GAP}px</span></label>
                <input type="range" id="st-nodegap" min="20" max="160" step="2" value="${state.nodeGap ?? NODE_GAP}">
              </div>
              <button id="st-liftwires" class="st-btn ${state.wiresAbovePorts ? "active" : ""}"><i class="mdi mdi-arrow-up"></i> провода поверх портов</button>
            </div>
          </div>
          <div id="palette">
            <div class="pl-toggle" id="pl-toggle" title="Перетащи устройство на схему">
              <span class="short-name">+</span>
              <span class="full-name"><i class="mdi mdi-plus-box-outline"></i> Устройства</span>
              <span class="arrow"><i class="mdi mdi-chevron-down"></i></span>
            </div>
            <div class="pl-body">
              <div class="pl-tabs"></div>
              <div class="pl-grid"></div>
              <div class="pl-hint">Перетащи устройство в локацию на схеме</div>
            </div>
          </div>
        </div>
      </div>
      <div id="legend">
        <div class="lg-head" id="lg-toggle">Легенда <span class="arrow"><i class="mdi mdi-chevron-down"></i></span></div>
        <div class="lg-body">
          <span class="lg-sub">Порты</span>
          <span><span class="dotd" style="border-color:var(--accent)"></span>интерфейс</span>
          <span><span class="dotd sq" style="border-color:var(--front)"></span>front панели</span>
          <span><span class="dotd sq" style="border-color:var(--rear)"></span>rear панели (магистраль)</span>
          <span><span class="dotd" style="border-color:var(--console)"></span>console / console-server</span>
          <span><span class="dotd" style="border-color:var(--power)"></span>питание</span>
          <span><span class="dotd" style="border-color:var(--power)"></span>фидер щита</span>
          <span><span class="lg-radio" style="background:var(--wireless)"></span>радио-линк (слой Wireless)</span>
          <span>закрашен = занят · клик по занятому = меню связи</span>
          <span class="lg-sub">Кабели (цвет = тип)</span>
          ${this._cableLegendRows()}
        </div>
      </div>`;
    const canvas = $("#schema");
    this.applyZoom();
    collapsible($("#legend"), $("#lg-toggle"), "legendCollapsed");
    collapsible($("#schemtools"), $("#st-toggle"), "toolsCollapsed");
    collapsible($("#rolefilter"), $("#fl-toggle"), "filterCollapsed");
    collapsible($("#layers"), $("#ly-toggle"), "layersCollapsed");
    this._wireViewSwitch();
    Mode.syncButtons("schema");
    // Palette: desktop drags devices from a grid; touch just taps the "+" square
    // (under "UI") to open the add-catalog for the current scope — replaces the
    // round FAB (drag is awkward on touch).
    if (matchMedia("(pointer: coarse)").matches || innerWidth <= 760) {
      const pal = $("#palette"), palT = $("#pl-toggle");
      if (pal) pal.classList.add("collapsed");   // keep it a square, no grid
      if (palT) palT.addEventListener("click", e => { e.stopPropagation(); this.app.tree._openSchemAdd(); });
    } else {
      collapsible($("#palette"), $("#pl-toggle"), "paletteCollapsed");
      this._wirePalette();
    }
    const whRange = $("#st-wireheight"), whVal = $("#st-wh-val");
    whRange.addEventListener("input", () => {
      state.wireHeightK = parseFloat(whRange.value);
      whVal.textContent = state.wireHeightK.toFixed(1) + "×";
      this.redrawWires();
    });
    // Gap between nodes in a rack. Changes the LAYOUT (node positions, box
    // heights) → needs a full schema re-render. Label updates live on input;
    // the rebuild runs on change (release) so the DOM rebuild doesn't break dragging.
    const ngRange = $("#st-nodegap"), ngVal = $("#st-ng-val");
    ngRange.addEventListener("input", () => { ngVal.textContent = ngRange.value + "px"; });
    ngRange.addEventListener("change", () => {
      state.nodeGap = parseInt(ngRange.value, 10);
      if (this._lastRender) this.render(this._lastRender.group, this._lastRender.byRack, this._lastRender.devPorts);
    });
    $("#st-liftwires").addEventListener("click", e => {
      state.wiresAbovePorts = !state.wiresAbovePorts;
      e.target.classList.toggle("active", state.wiresAbovePorts);
      $("#wires").classList.toggle("above-ports", state.wiresAbovePorts);
    });
    // Wire style: "round" (arcs) / "angular" (Manhattan + hop bridges).
    $("#st-wirestyle").querySelectorAll(".st-seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.style === state.wireStyle) return;
        state.wireStyle = btn.dataset.style;
        $("#st-wirestyle").querySelectorAll(".st-seg-btn").forEach(b =>
          b.classList.toggle("active", b.dataset.style === state.wireStyle));
        this.redrawWires();
      });
    });
    // Angular routing: "short" (direct) / "extend" (detour around nodes).
    $("#st-pathmode").querySelectorAll(".st-seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.path === state.wirePath) return;
        state.wirePath = btn.dataset.path;
        $("#st-pathmode").querySelectorAll(".st-seg-btn").forEach(b =>
          b.classList.toggle("active", b.dataset.path === state.wirePath));
        this.redrawWires();
      });
    });
    let maxBottom = 300;
    const { LEFT_PAD, TOP_PAD } = this;
    const rackMeta = {};   // rack.id → {col, bottom, rack} — for area contours

    // Pre-pass: column slot width (shared by all) = the widest node, so nodes
    // with many ports don't spill into neighboring columns/contours
    // (small_fix "Pro schema" item 1). devNodeIdx is needed by _assignSides
    // (trunkUp) → set it here, in the same order as the main pass below.
    const devsOf = rack => byRack[rack.id].filter(d => d.position != null)
      .sort((a, b) => b.position - a.position);
    // Width = MAX across both modes (phys and net+edit) — so SLOT doesn't
    // jump when switching views without a full render (relayoutNodes doesn't
    // move columns), and wide phys panels won't overflow in the net render.
    let maxNodeW = 0;
    group.forEach((rack, col) => {
      let idx = 0;
      for (const dev of devsOf(rack)) {
        state.devCol[dev.id] = col;
        state.devNodeIdx[dev.id] = idx++;
        const gp = devPorts[dev.id] || [];
        maxNodeW = Math.max(maxNodeW,
          this._nodeParts(dev, gp, false, false).width,   // physical view
          this._nodeParts(dev, gp, true, true).width);    // net + edit (+wireless "+")
      }
    });
    this.SLOT = Math.max(COL_W, Math.ceil(maxNodeW) + BOX_PAD * 2);

    // Wires overlap when neighboring nodes have ports at the same height.
    // Give "loaded" nodes (many cables) extra vertical room so their
    // horizontal wires spread across levels (small_fix: "if space is short,
    // nodes shift a bit"). Gentle, with a cap.
    const cablesOn = {};
    for (const c of state.cables)
      for (const t of [...(c.a_terminations || []), ...(c.b_terminations || [])]) {
        const d = t.object && t.object.device && t.object.device.id;
        if (d != null) cablesOn[d] = (cablesOn[d] || 0) + 1;
      }
    const spread = dev => Math.min(cablesOn[dev.id] || 0, 6) * 5;   // up to +30px

    // Area geometry pre-pass: x of each column accounting for device
    // "pockets" right of each server room's racks (the next room starts to
    // the RIGHT of the previous pocket) + pocket packing and panel bottoms.
    this._computeLocGeometry(group, devPorts, devsOf, spread);

    group.forEach((rack, col) => {
      const x0 = this._colX(col) + BOX_PAD;
      const box = mk("div", { className: "rackbox", dataset: { rack: rack.id },
        html: `<span class="rb-head"><span class="rb-label">стойка ${rack.name}</span>` +
          `<button class="rb-edit" title="Открыть эту стойку для правки"><i class="mdi mdi-pencil"></i></button></span>`,
        style: { left: (x0 - BOX_PAD) + "px", top: (TOP_PAD - 34) + "px", width: (this.SLOT + BOX_PAD) + "px" } });
      // Pencil next to the name (visible in edit mode) → open ONLY this rack.
      box.querySelector(".rb-edit").addEventListener("click", e => {
        e.stopPropagation();
        // Pencil = edit THIS rack → enable rack-pane edit mode right away
        // (mobile and desktop alike: opened via the pencil means editing).
        document.body.classList.add("rack-edit");
        document.body.classList.remove("rack-collapsed");   // show the rack pane (units)
        this.app.tree.selectScope("rack", rack.id, rack.name, null, true);   // force — open this rack
      });
      canvas.appendChild(box);
      state.rackBoxEls[rack.id] = box;

      let y = TOP_PAD + 14;   // nodes slightly below the rack's top edge (offset from the title)
      let idx = 0;
      const devs = devsOf(rack);
      for (const dev of devs) {
        state.devCol[dev.id] = col;
        state.devNodeIdx[dev.id] = idx++;
        const groupsHere = devPorts[dev.id] || [];
        const node = document.createElement("div");
        node.className = "node";
        node.dataset.dev = dev.id;
        node.dataset.role = dev.role ? dev.role.id : "0";
        node.style.top = y + "px";
        const role = state.roles[dev.role.id] || { color: "607d8b" };
        node.style.borderLeft = "3px solid #" + role.color;
        node._x0 = x0;                 // column left edge — for centering on recalc
        node._groups = groupsHere;     // device port groups — for re-layout
        canvas.appendChild(node);
        state.nodeEls[dev.id] = node;
        this._layoutNode(dev, node);   // port layout + width (per mode)
        y += 64 + (state.nodeGap ?? NODE_GAP) + spread(dev);
      }
      box.style.height = (y - TOP_PAD + 20) + "px";
      rackMeta[rack.id] = { col, bottom: y - 14, rack };   // bottom = box top + height
      maxBottom = Math.max(maxBottom, y + 40);
    });

    // Dashed contours of server rooms/sites over the rack row (when a site/
    // region is selected in the tree). A location gets no outer contours.
    this._renderScopeContours(canvas, group, rackMeta);

    // Off-rack devices — a "pocket" RIGHT of their OWN server room's racks
    // (positions from the pre-pass). Orphans (location not in scope) — right
    // of everything.
    const off = this._renderOffRack(canvas, group, devPorts);

    // Power: EACH server room's panels go BELOW all its content (racks +
    // device pocket), centered on the overall span. Label styled like racks.
    this._powerBaseBottom = maxBottom;   // rack row bottom (for panel re-render)
    maxBottom = this._renderPowerPanels(canvas, group, maxBottom);

    const rightPad = Math.max(EXTRA, LEFT_PAD), botPad = Math.max(EXTRA * 0.6, TOP_PAD);
    const lastRight = group.length ? this._colX(group.length - 1) + this.SLOT : 300;
    canvas.style.width = (Math.max(lastRight, off.right || 0) + rightPad) + "px";
    canvas.style.height = (Math.max(maxBottom, off.bottom || 0) + botPad) + "px";
    // Same area — restore the previous position (don't jerk the view when
    // nodes appear); new area / first render — center.
    if (sameScope) {
      pane.scrollLeft = keepL; pane.scrollTop = keepT;
    } else {
      // New area → scroll to content START (first racks, top-left), not the
      // geometric center: on a big schema the center is empty and disorienting.
      pane.scrollLeft = Math.max(0, (group.length ? this._colX(0) : 0) - 48);
      pane.scrollTop = 0;
    }
  }

  // ── Single-view: clicking a tree device loads ONLY it ──────────────────────
  // One node-card + short "whiskers" from busy ports (no full-area layout).
  // Back to normal view — click a tree location (selectScope→render).
  // Double-tap a port (expand the target node) is the next step.
  // Classify off-rack device (icon card; tree devices have no rack).
  _offKind(dev) {
    const rn = (dev.role && (dev.role.name + " " + (dev.role.slug || ""))) || "";
    return /provider|провайдер/i.test(rn) ? "provider" : "periph";
  }
  // Off-rack POWER equipment (PDU / UPS / stabilizer / power strip) → gathered into
  // the power ROWS below the racks (not the right pockets). PDUs/strips expose power
  // OUTLETS; outlet-less gear is caught by its role/model name. A camera (power PORT
  // only) is NOT power.
  _isPowerDev(dev, devPorts) {
    const groups = (devPorts && devPorts[dev.id]) || state._devPorts[dev.id] || [];
    if (groups.some(g => g.kind && g.kind.otype === "dcim.poweroutlet")) return true;
    const rn = (((dev.role && dev.role.name) || "") + " " + ((dev.device_type && dev.device_type.model) || "")).toLowerCase();
    return /pdu|ибп|\bups\b|бесперебой|стабилизатор|stabiliz|инвертор|inverter|power distribution|power strip/.test(rn);
  }
  // Voltage stabilizers/inverters — their own row between «Питание» and the
  // panels (electrical chain reads bottom-up: щит → стабилизатор → ИБП/PDU → стойки).
  _isStabDev(dev) {
    const rn = (((dev.role && dev.role.name) || "") + " " +
      ((dev.device_type && dev.device_type.model) || "")).toLowerCase();
    return /стабилизатор|stabiliz|инвертор|inverter/.test(rn);
  }
  // Load a device "graph": cables + IP + grouped ports. Shared by the trace
  // root (showSingleDevice) and chain growth (_growChain).
  async _fetchDeviceGraph(dev) {
    const [cables, ips, ...portLists] = await Promise.all([
      apiAll(`/dcim/cables/?device_id=${dev.id}`),
      apiAll(`/ipam/ip-addresses/?device_id=${dev.id}`),
      ...PORT_KINDS.map(k => apiAll(`/dcim/${k.ep}/?device_id=${dev.id}`)),
    ]);
    const ipsByIface = {};
    for (const ip of ips) {
      if (ip.assigned_object_type !== "dcim.interface" || !ip.assigned_object_id) continue;
      (ipsByIface[ip.assigned_object_id] = ipsByIface[ip.assigned_object_id] || []).push(ip);
    }
    const groups = [];
    PORT_KINDS.forEach((kind, ki) => { if (portLists[ki].length) groups.push({ kind, items: portLists[ki] }); });
    groups.sort((a, b) => PORT_KINDS.indexOf(a.kind) - PORT_KINDS.indexOf(b.kind));
    return { cables, ipsByIface, groups };
  }
  // Empty device node-card for a trace (off-rack look: icon + name + ports).
  _buildTraceNode(dev, groups) {
    const node = document.createElement("div");
    node.className = "node offrack off-" + dev._off + " single";
    node.dataset.dev = dev.id;
    node.dataset.role = dev.role ? dev.role.id : "0";
    const role = (dev.role && state.roles[dev.role.id]) || { color: "607d8b" };
    node.style.borderLeft = "3px solid #" + role.color;
    node._x0 = 0; node._fixedLeft = 0;
    node._groups = groups;
    // The trace root stays put; every other node gets a corner "×" (shown only
    // once the chain has grown past the root — see #schema.trace-multi in CSS).
    if (dev.id === state.single) node.classList.add("trace-root");
    const x = document.createElement("button");
    x.type = "button"; x.className = "trace-x";
    x.title = "Убрать из трассы"; x.setAttribute("aria-label", "Убрать из трассы");
    x.innerHTML = '<i class="mdi mdi-close"></i>';
    x.addEventListener("click", (e) => { e.stopPropagation(); this.removeTraceNode(dev.id); });
    node.appendChild(x);
    return node;
  }
  // Single-view = trace ROOT: load only this device (full node + whiskers on
  // busy ports), centered. Tapping a busy port grows the CHAIN (_growChain):
  // the neighbor node appears alongside, the shared cable as a real line, the
  // neighbor's other links as whiskers; nodes stay (you can walk the trace).
  async showSingleDevice(dev) {
    setStatus("получаю " + dev.name + "…");
    try {
      const g = await this._fetchDeviceGraph(dev);
      dev._off = this._offKind(dev);
      Object.assign(state, {
        group: [], devices: [dev], cables: g.cables,
        devRack: { [dev.id]: null }, devCol: {}, devNodeIdx: {},
        ports: {}, nodeEls: {}, rackDevEls: {}, rackBoxEls: {}, rackColEls: {},
        offContours: {}, single: dev.id, chain: [dev.id],
      });
      state.ipsByIface = g.ipsByIface;
      state._devPorts = { [dev.id]: g.groups };

      const pane = $("#schempane");
      pane.innerHTML = `<p class="pane-title"><span class="pt-label">${dev.name}</span></p>` +
        `<div id="schema"><svg id="wires"></svg></div>`;
      const canvas = $("#schema");
      const overlay = $("#schemoverlay"); if (overlay) overlay.innerHTML = "";   // no area controls in a trace
      const node = this._buildTraceNode(dev, g.groups);
      canvas.appendChild(node);
      state.nodeEls[dev.id] = node;
      state.zoom = 1;   // trace starts 1:1 (else inherits previous zoom)
      this._layoutNode(dev, node);   // ports + width, fills state.ports
      const nw = node.offsetWidth, nh = node.offsetHeight;
      const pw = pane.clientWidth || 800, ph = pane.clientHeight || 600;
      // Canvas ~ viewport size → root node centered, no excess emptiness.
      const cw = Math.max(pw, nw + 160), ch = Math.max(ph, nh + 160);
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      node.style.left = Math.round((cw - nw) / 2) + "px";
      node.style.top = Math.round((ch - nh) / 2) + "px";
      this.applyZoom();
      this._drawTrace();
      pane.scrollLeft = (cw - pw) / 2;
      pane.scrollTop = (ch - ph) / 2;
      setStatus("");
    } catch (e) { setStatus("не удалось загрузить устройство: " + e.message, "err"); }
  }
  // Render the TRACE (single-view/chain): a busy port whose far end is ALSO
  // loaded (in state.ports) → a real cable between them (smooth curve along
  // port normals, styled as a normal wire — color/tooltip/hover). Other busy
  // ports (far end not loaded) → "whiskers". Called from redrawWires.
  _drawTrace() {
    const svg = $("#wires"), canvas = $("#schema");
    if (!svg || !canvas) return;
    // "×" on every node appears only once more than the root is loaded.
    canvas.classList.toggle("trace-multi", (state.chain || []).length > 1);
    svg.setAttribute("width", canvas.scrollWidth);
    svg.setAttribute("height", canvas.scrollHeight);
    svg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);
    const base = canvas.getBoundingClientRect(), z = state.zoom || 1;
    const center = el => { const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z]; };
    const drawn = new Set();   // draw each cable ONCE (both ends are ports)
    let wi = 0;
    for (const key in state.ports) {
      const p = state.ports[key];
      if (!(p.item.cable || p.item.wireless_link)) continue;   // busy only
      const cbl = p.item.cable && state.cables.find(c => c.id === p.item.cable.id);
      const farKey = cbl && this._otherTermKey(cbl, p);
      const farP = farKey && state.ports[farKey];
      if (cbl && farP) {
        if (drawn.has(cbl.id)) continue;
        drawn.add(cbl.id);
        const d = this._traceCablePath(p, farP, center);
        const isPower = p.otype.includes("power") || farP.otype.includes("power");
        svg.appendChild(this._wirePathEl(cbl, p, farP, d, isPower));
      } else {
        this._whisker(svg, defs, p, center, wi++);
      }
    }
  }
  // Trace cable path between ports a and b. If the ports face each other
  // (normals opposed) — a smooth cubic curve across the gap. Otherwise (a port
  // faces AWAY from its neighbor — e.g. a panel's top front-port with the
  // neighbor below) a straight curve would hide BEHIND the node body (wires
  // under nodes) and look "dissolved" → route orthogonally AROUND that node.
  _traceCablePath(a, b, center) {
    const [ax, ay] = center(a.el), [bx, by] = center(b.el);
    const dA = a.side === "t" ? -1 : 1, dB = b.side === "t" ? -1 : 1;
    const aFacesB = (dA < 0 && by < ay) || (dA > 0 && by > ay);
    const bFacesA = (dB < 0 && ay < by) || (dB > 0 && ay > by);
    if (aFacesB && bFacesA) {
      const K = 46, ay2 = ay + dA * K, by2 = by + dB * K;
      return `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${ax.toFixed(1)} ${ay2.toFixed(1)}, ` +
        `${bx.toFixed(1)} ${by2.toFixed(1)}, ${bx.toFixed(1)} ${by.toFixed(1)}`;
    }
    // Detour: exit along both port normals and skirt the SIDE of the node whose
    // port faces outward (its body would block a straight cable).
    const STUB = 26;
    const aS = [ax, ay + dA * STUB], bS = [bx, by + dB * STUB];
    const awayIsA = !aFacesB;                                  // which port faces outward
    const nEl = state.nodeEls[awayIsA ? a.dev.id : b.dev.id];
    const otherX = awayIsA ? bx : ax;                          // reach TOWARD the far end
    let laneX;
    if (nEl) {
      const nl = parseFloat(nEl.style.left) || 0, nw = nEl.offsetWidth;
      laneX = otherX >= nl + nw / 2 ? nl + nw + 26 : nl - 26;  // lane on the far-end side
    } else laneX = Math.min(ax, bx) - 30;
    return smoothPath([[ax, ay], aS, [laneX, aS[1]], [laneX, bS[1]], bS, [bx, by]]);
  }
  // Remove a node from the trace and everything opened THROUGH it (its subtree),
  // then redraw. The removed nodes' ports vanish from state.ports, so the port
  // that fed them on the surviving parent turns back into a whisker. The root
  // (trace origin) is never removed this way.
  removeTraceNode(id) {
    if (!state.chain || state.chain.length <= 1 || id === state.single) return;
    const rem = new Set(this._traceSubtree(id));
    for (const rid of rem) {
      const el = state.nodeEls[rid];
      if (el) el.remove();
      delete state.nodeEls[rid];
      delete state._devPorts[rid];
    }
    for (const k in state.ports)
      if (state.ports[k].dev && rem.has(state.ports[k].dev.id)) delete state.ports[k];
    state.chain = state.chain.filter(x => !rem.has(x));
    state.devices = (state.devices || []).filter(d => !rem.has(d.id));
    this._drawTrace();
    setStatus(rem.size > 1 ? "убрано из трассы: " + rem.size : "убрано из трассы");
  }
  // A node id plus every node hanging off it (via dataset.parent), depth-first.
  _traceSubtree(id) {
    const out = [id];
    for (const k of Object.keys(state.nodeEls))
      if (state.nodeEls[k].dataset.parent === String(id)) out.push(...this._traceSubtree(+k));
    return out;
  }
  // Far end of cable c for port p — state.ports key (termKey of the other termination).
  _otherTermKey(c, p) {
    for (const t of [...(c.a_terminations || []), ...(c.b_terminations || [])]) {
      if (t.object_type === p.otype && t.object_id === p.item.id) continue;   // near end
      return termKey(t);
    }
    return null;
  }
  // "Whisker": short segment from a busy port outward (by side), fading to
  // transparent ("cable runs off to an unloaded node").
  _whisker(svg, defs, p, center, i) {
    const NS = "http://www.w3.org/2000/svg";
    const [cx, cy] = center(p.el);
    const dir = p.side === "t" ? -1 : 1;   // t — up, b — down
    const ey = cy + dir * 36;
    const gid = "wh" + i;
    const grad = document.createElementNS(NS, "linearGradient");
    grad.id = gid;
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", cx.toFixed(1)); grad.setAttribute("y1", cy.toFixed(1));
    grad.setAttribute("x2", cx.toFixed(1)); grad.setAttribute("y2", ey.toFixed(1));
    grad.innerHTML = `<stop offset="0" style="stop-color:var(--accent);stop-opacity:0.85"/>` +
      `<stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/>`;
    defs.appendChild(grad);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${cx.toFixed(1)} ${ey.toFixed(1)}`);
    path.setAttribute("class", "whisker");
    path.setAttribute("stroke", `url(#${gid})`);
    path.dataset.port = portKey(p.otype, p.item.id);
    svg.appendChild(path);
  }
  // Whiskers for ONE node's busy ports (model-change overlay): clears the wires and
  // shows just this node's cables as stubs — WITHOUT leaving the area view.
  _drawNodeWhiskers(devId) {
    const svg = $("#wires"), canvas = $("#schema");
    if (!svg || !canvas) return;
    svg.setAttribute("width", canvas.scrollWidth);
    svg.setAttribute("height", canvas.scrollHeight);
    svg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(NS, "defs"); svg.appendChild(defs);
    const base = canvas.getBoundingClientRect(), z = state.zoom || 1;
    const center = el => { const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z]; };
    let wi = 0;
    for (const key in state.ports) {
      const p = state.ports[key];
      if (!p.dev || p.dev.id !== devId) continue;
      if (!(p.item.cable || p.item.wireless_link)) continue;
      this._whisker(svg, defs, p, center, wi++);
    }
  }

  // Far device of this port's cable (to expand in single-view). Taken from the
  // nested object.device of the cable's far termination.
  _farDevForPort(key) {
    const p = state.ports[key];
    if (!p || !p.item.cable) return null;
    const cable = (state.cables || []).find(c => c.id === p.item.cable.id);
    if (!cable) return null;
    for (const t of [...(cable.a_terminations || []), ...(cable.b_terminations || [])]) {
      if (t.object_type === p.otype && t.object_id === p.item.id) continue;   // near end
      return { cable, dev: t.object && t.object.device, farPort: t.object };
    }
    return null;
  }
  // Tap a busy port in the trace → grow the chain along this cable.
  _revealFromPort(otype, id) {
    const tip = $("#tip"); if (tip) tip.style.display = "none";
    this._tipPort = null;
    this._growChain(portKey(otype, id));
  }
  // Grow the CHAIN from the tapped port. First try the WHOLE path via the API
  // trace: it follows front↔rear mapping THROUGH patch panels to the next real
  // device — so switch→switch through a panel is visible. No trace, or the path
  // doesn't pass through → fall back to a single cable.
  async _growChain(key) {
    const p = state.ports[key];
    if (!p || !p.item.cable) return;
    const kind = PORT_KINDS.find(k => k.otype === p.otype);
    if (kind) {
      let segs = null;
      try { segs = await api(`/dcim/${kind.ep}/${p.item.id}/trace/`); } catch (e) { segs = null; }
      if (segs && segs.length && await this._growByTrace(segs)) return;
    }
    await this._growOneCable(key, p);
  }
  // Grow the chain along API-trace segments. Each segment's far device loads as
  // a full node placed next to the port it leaves FROM (near) — so panel and
  // next node fall along the path. true if anything was added.
  async _growByTrace(segments) {
    setStatus("строю путь…");
    try {
      let added = 0, lastId = null;
      for (const seg of segments) {
        const nearT = (seg[0] || [])[0], farT = (seg[2] || [])[0];
        if (!farT || !farT.device) continue;                 // segment dead-ends
        const srcPort = state.ports[this._traceTermKey(nearT)];
        const node = await this._addChainDevice(farT.device, srcPort);
        if (node) { added++; lastId = farT.device.id; }
      }
      if (!added) { setStatus("", ""); return false; }
      this._padTraceCanvas();
      this._drawTrace();
      if (lastId) this._flashNode(lastId);
      setStatus("");
      return true;
    } catch (e) { setStatus("путь построился не полностью: " + e.message, "err"); return true; }
  }
  // Fallback: pull ONE cable of this port (no API trace / not a through path).
  async _growOneCable(key, p) {
    const far = this._farDevForPort(key);
    if (!far || !far.dev) { setStatus("не вижу, куда ведёт кабель", ""); return; }
    setStatus("получаю " + far.dev.name + "…");
    try {
      const node = await this._addChainDevice(far.dev, p);
      this._padTraceCanvas();
      this._drawTrace();
      if (node) this._flashNode(far.dev.id);
      setStatus("");
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }
  // Load the far device as a FULL node (ports + IP + cables) next to srcPort.
  // Already in the chain — just flash and return its node (its ports are needed
  // for the trace to keep slicing onward). Returns the node (null on failure).
  async _addChainDevice(devRef, srcPort) {
    if ((state.chain || []).includes(devRef.id)) { this._flashNode(devRef.id); return state.nodeEls[devRef.id] || null; }
    let full = (state.allDevices || []).find(d => d.id === devRef.id);
    if (!full || !full.device_type) full = await api("/dcim/devices/" + devRef.id + "/");
    const g = await this._fetchDeviceGraph(full);
    full._off = this._offKind(full);
    state.devices.push(full);
    (state.chain = state.chain || []).push(full.id);
    state.devRack[full.id] = null;
    state._devPorts[full.id] = g.groups;
    Object.assign(state.ipsByIface, g.ipsByIface);
    const have = new Set(state.cables.map(c => c.id));       // dedup: shared cable already present
    for (const c of g.cables) if (!have.has(c.id)) state.cables.push(c);
    const node = this._buildTraceNode(full, g.groups);
    $("#schema").appendChild(node);
    state.nodeEls[full.id] = node;
    // Remember which node this one grew from, so removing a node can also fold
    // back everything opened THROUGH it (its subtree).
    node.dataset.parent = srcPort && srcPort.dev ? String(srcPort.dev.id) : "";
    this._layoutNode(full, node);                            // ports + width, adds to state.ports
    if (srcPort) this._placeChainNode(node, full, srcPort);
    else this._placeChainFallback(node, full);               // no anchor port (e.g. circuit) → right of the outermost
    return node;
  }
  // Fallback placement when the anchor port is unknown: right of the rightmost
  // existing node (at its height) — so it doesn't land in the corner (0,0).
  _placeChainFallback(node, dev) {
    const canvas = $("#schema");
    let maxR = 0, topRef = 40;
    for (const [id, el] of Object.entries(state.nodeEls)) {
      if (+id === dev.id) continue;
      const l = (parseFloat(el.style.left) || 0) + el.offsetWidth;
      if (l > maxR) { maxR = l; topRef = parseFloat(el.style.top) || 40; }
    }
    const left = maxR ? maxR + 80 : 40;
    node.style.left = left + "px"; node.style.top = topRef + "px";
    canvas.style.width = Math.max(parseFloat(canvas.style.width) || canvas.offsetWidth, left + node.offsetWidth + 40) + "px";
  }
  // state.ports key for a termination from the API-trace reply: its url looks
  // like /api/dcim/rear-ports/5/ → kind resolved via PORT_KINDS.ep.
  _traceTermKey(t) {
    const m = (t && t.url || "").match(/\/dcim\/([a-z-]+)\/(\d+)\//);
    if (!m) return null;
    const kind = PORT_KINDS.find(k => k.ep === m[1]);
    return kind ? portKey(kind.otype, m[2]) : null;
  }
  // Place a new chain node next to the tapped port p's node (above/below — where
  // the port faces), aligning its cable port under p (straighter cable). Avoid
  // overlapping existing nodes (shift toward the tap); grow/shift the canvas.
  _placeChainNode(node, dev, p) {
    const canvas = $("#schema"), pane = $("#schempane"), z = state.zoom || 1;
    const nw2 = node.offsetWidth, nh2 = node.offsetHeight;
    const base = canvas.getBoundingClientRect(), pr = p.el.getBoundingClientRect();
    const pcx = (pr.left - base.left + pr.width / 2) / z, pcy = (pr.top - base.top + pr.height / 2) / z;
    const up = p.side === "t";   // top port → neighbor UP; bottom → RIGHT
    const GAP = 120, M = 40;     // roomier: nodes "higher"/"right", detours don't stick
    let left, top;
    if (up) {
      // align this cable's far port under p (straighter cable)
      let farOffX = nw2 / 2;
      for (const k in state.ports) {
        const q = state.ports[k];
        if (q.dev.id === dev.id && q.item.cable && p.item.cable && q.item.cable.id === p.item.cable.id) {
          farOffX = q.el.offsetLeft + q.el.offsetWidth / 2; break;
        }
      }
      left = Math.round(pcx - farOffX);
      top = Math.round(pcy - GAP - nh2);
    } else {
      // Bottom ports don't grow DOWN (tangled/overlapped) — neighbor RIGHT of the
      // parent, vertically at the tapped port; cable runs into the gap between.
      const pn = state.nodeEls[p.dev.id];
      left = Math.round((parseFloat(pn.style.left) || 0) + pn.offsetWidth + GAP);
      top = Math.round(pcy - nh2 / 2);
    }
    // don't cover placed nodes — push further toward the tap
    const rects = Object.entries(state.nodeEls).filter(([id]) => +id !== dev.id)
      .map(([, el]) => ({ l: parseFloat(el.style.left) || 0, t: parseFloat(el.style.top) || 0, w: el.offsetWidth, h: el.offsetHeight }));
    for (let guard = 0; guard < 80; guard++) {
      const hit = rects.some(r => left < r.l + r.w + M && left + nw2 > r.l - M && top < r.t + r.h + M && top + nh2 > r.t - M);
      if (!hit) break;
      if (up) top -= (nh2 + M); else left += (nw2 + M);   // push toward growth (up / right)
    }
    // coords < 0 → shift ALL nodes and scroll; else grow canvas right/down
    let cw = parseFloat(canvas.style.width) || canvas.offsetWidth;
    let ch = parseFloat(canvas.style.height) || canvas.offsetHeight;
    const shiftX = left < 0 ? -left : 0, shiftY = top < 0 ? -top : 0;
    if (shiftX || shiftY) {
      for (const el of Object.values(state.nodeEls)) {
        if (el === node) continue;
        el.style.left = ((parseFloat(el.style.left) || 0) + shiftX) + "px";
        el.style.top = ((parseFloat(el.style.top) || 0) + shiftY) + "px";
      }
      left += shiftX; top += shiftY;
      pane.scrollLeft += shiftX * z; pane.scrollTop += shiftY * z;
    }
    node.style.left = left + "px"; node.style.top = top + "px";
    canvas.style.width = Math.max(cw + shiftX, left + nw2 + 40) + "px";
    canvas.style.height = Math.max(ch + shiftY, top + nh2 + 40) + "px";
  }
  // Empty margin around the whole trace (≈ one screen per side) for free
  // panning/zooming. Shifts everything when content nears the edge, and grows
  // the canvas.
  _padTraceCanvas() {
    const canvas = $("#schema"), pane = $("#schempane");
    if (!canvas || !pane) return;
    const els = Object.values(state.nodeEls);
    if (!els.length) return;
    const PAD = Math.round(Math.min(pane.clientWidth || 800, pane.clientHeight || 600) * 0.85) || 320;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const el of els) {
      const l = parseFloat(el.style.left) || 0, t = parseFloat(el.style.top) || 0;
      minX = Math.min(minX, l); minY = Math.min(minY, t);
      maxX = Math.max(maxX, l + el.offsetWidth); maxY = Math.max(maxY, t + el.offsetHeight);
    }
    const z = state.zoom || 1;
    const shiftX = minX < PAD ? Math.round(PAD - minX) : 0, shiftY = minY < PAD ? Math.round(PAD - minY) : 0;
    if (shiftX || shiftY) {
      for (const el of els) {
        el.style.left = ((parseFloat(el.style.left) || 0) + shiftX) + "px";
        el.style.top = ((parseFloat(el.style.top) || 0) + shiftY) + "px";
      }
      pane.scrollLeft += shiftX * z; pane.scrollTop += shiftY * z;
    }
    canvas.style.width = (maxX + shiftX + PAD) + "px";
    canvas.style.height = (maxY + shiftY + PAD) + "px";
  }
  // Scroll to a node (viewport center) + briefly flash it (chain arrival).
  _flashNode(id) {
    const node = state.nodeEls[id], pane = $("#schempane");
    if (!node || !pane) return;
    const z = state.zoom || 1;
    const cx = ((parseFloat(node.style.left) || 0) + node.offsetWidth / 2) * z;
    const cy = ((parseFloat(node.style.top) || 0) + node.offsetHeight / 2) * z;
    pane.scrollLeft = Math.max(0, cx - pane.clientWidth / 2);
    pane.scrollTop = Math.max(0, cy - pane.clientHeight / 2);
    node.classList.add("trace-flash");
    setTimeout(() => node.classList.remove("trace-flash"), 900);
  }

  // Nodes for devices OUTSIDE racks (state.devices[]._off) — RIGHT of the racks,
  // grouped by TYPE ("solution") into logical contours "<group> · <loc>"
  // (small_fix: PCs kept apart from routers). Layout: a top-down column, each
  // contour its own nodes in a 2-wide grid; when a contour won't fit down to the
  // "basement" (bottom of racks/panels), the next goes to a new column right.
  // Returns {right, bottom} — the right/bottom edges (for canvas size).
  _renderOffRack(canvas, group, devPorts) {
    // Off-rack type contours by location — so the server-room contour encloses
    // them (see _fitContoursToWires). Reset BEFORE the early exit (no off-rack).
    state.offContours = {};
    const { HEAD_H, PAD, ROW_H, HGAP } = OFFGEO;
    const place = (dev, x, y) => {
      const node = document.createElement("div");
      node.className = "node offrack off-" + dev._off;
      node.dataset.dev = dev.id;
      node.dataset.role = dev.role ? dev.role.id : "0";
      node.style.top = y + "px";
      const role = state.roles[dev.role.id] || { color: "607d8b" };
      node.style.borderLeft = "3px solid #" + role.color;
      node._x0 = x;
      node._fixedLeft = x;          // fixed pos — survives relayout (relayoutNodes)
      node._groups = devPorts[dev.id] || [];
      canvas.appendChild(node);
      state.nodeEls[dev.id] = node;
      this._layoutNode(dev, node);   // sets left = _fixedLeft for off-rack itself
    };
    let right = 0, bottom = 0;
    // Materialize the pre-pass packing: type contour + nodes in a grid inside.
    // cls overrides the contour style (power rows use the orange "gb-power").
    const renderArea = (x, topY, packed, sink, cls) => {
      for (const it of packed.items) {
        const bx = x + it.dx, by = topY + it.dy;
        const box = this._contourEl(cls || "gb-type", it.grp.label,
          { left: bx, top: by, width: it.cw, height: it.ch });
        canvas.insertBefore(box, canvas.firstChild);
        if (sink) sink.push(box);
        it.grp.devs.forEach((dev, i) => {
          const c = i % it.cols, r = Math.floor(i / it.cols);
          place(dev, bx + PAD + c * (it.nw + HGAP), by + HEAD_H + r * ROW_H + 13);
        });
        right = Math.max(right, bx + it.cw);
        bottom = Math.max(bottom, by + it.ch);
      }
    };
    for (const g of this._locOrder || []) {
      const sink = state.offContours[g.locId] = [];
      if (g.items.length) renderArea(g.devX, g.devTop, g, sink);
      bottom = Math.max(bottom, this._renderPowerRows(canvas, g, renderArea, sink));
    }
    if (this._orphanArea)
      renderArea(this._orphanArea.x, this._orphanArea.top, this._orphanArea, null);
    // Fallback power block (gear with no room in this area) — below everything,
    // wrapped in a "Питание" contour placed BEHIND it (inserted last → firstChild).
    if (this._powerArea && this._powerArea.items.length) {
      const pa = this._powerArea, CP = 16, HEAD = 30;
      renderArea(pa.x, pa.top, pa, null);
      const wrap = this._contourEl("gb-power", "Питание",
        { left: pa.x - CP, top: pa.top - HEAD, width: pa.areaW + CP * 2, height: pa.areaH + HEAD + CP });
      canvas.insertBefore(wrap, canvas.firstChild);
      bottom = Math.max(bottom, pa.top + pa.areaH + CP);
    }
    return { right, bottom };
  }
  // One room's power rows (pre-pass geometry in g.pw / g.stab): «Питание» —
  // type contours in a row under an orange wrap; «Стабилизаторы» — its own
  // orange row. Boxes go into the room's offContours sink so the location
  // contour grows over them (same mechanism as the panels' powerBoxEls).
  // Returns the rows' bottom edge (for canvas height).
  _renderPowerRows(canvas, g, renderArea, sink) {
    const CP = 16, HEAD = 30;
    let b = 0;
    if (g.pw) {
      const x = Math.max(24, g.pwCenter - g.pw.areaW / 2);
      renderArea(x, g.pwTop, g.pw, sink);
      const wrap = this._contourEl("gb-power", "Питание",
        { left: x - CP, top: g.pwTop - HEAD, width: g.pw.areaW + CP * 2, height: g.pw.areaH + HEAD + CP });
      canvas.insertBefore(wrap, canvas.firstChild);
      sink.push(wrap);
      b = g.pwTop + g.pw.areaH + CP;
    }
    if (g.stab) {
      const x = Math.max(24, g.pwCenter - g.stab.areaW / 2);
      renderArea(x, g.stabTop, g.stab, sink, "gb-power");   // orange row, label = «Стабилизаторы»
      b = Math.max(b, g.stabTop + g.stab.areaH);
    }
    return b;
  }

  // ── Area geometry (pre-pass, pure math) ────────────────────────────────────
  // "Per server-room" layout: a location's racks → its off-rack pocket to the
  // RIGHT (type contours) → panels BELOW it all; the next room starts right of
  // the previous pocket. Computes: each column's x (this._colXArr — pockets
  // insert an offset), location ranges/bottoms and pocket packing
  // (this._locGeom / this._locOrder), and the "orphan" pocket for devices with
  // no location in the area (this._orphanArea). Called from render BEFORE racks.
  _computeLocGeometry(group, devPorts, devsOf, spread) {
    const { LEFT_PAD, TOP_PAD } = this;
    const step = this.SLOT + COL_GAP;
    const gap = state.nodeGap ?? NODE_GAP;
    const devTop = TOP_PAD - 34;             // pocket top = top of rack boxes
    // Rack bottom — same arithmetic as render's main loop (y += 64+gap+spread).
    const rackBottom = rack => {
      let y = TOP_PAD;
      for (const dev of devsOf(rack)) y += 64 + gap + spread(dev);
      return y - 14;
    };
    // Racks sorted site→server-room→rack → a room's columns are contiguous.
    const locGeom = {}, locOrder = [];
    let maxRB = 300;
    group.forEach((rack, col) => {
      const lid = rack.location && rack.location.id;
      const rb = rackBottom(rack);
      maxRB = Math.max(maxRB, rb);
      if (lid == null) return;
      let g = locGeom[lid];
      if (!g) { g = locGeom[lid] = { locId: lid, minCol: col, maxCol: col,
        rackBottom: 0, devTop, items: [], areaW: 0, areaH: 0 }; locOrder.push(g); }
      g.minCol = Math.min(g.minCol, col); g.maxCol = Math.max(g.maxCol, col);
      g.rackBottom = Math.max(g.rackBottom, rb);
    });
    // Off-rack devices by server-room; no location (or not in this area) → the
    // sole room if there's only one, else "orphans" to the right of everything.
    // Power gear is bucketed apart: it forms the per-room power ROWS below the
    // content (Питание → Стабилизаторы → Силовые щиты), not the right pockets.
    const byLoc = {}, orphans = [], powerByLoc = {}, powerOrphans = [];
    for (const dev of state.devices.filter(d => d._off)) {
      const power = this._isPowerDev(dev, devPorts);
      let lid = dev.location && dev.location.id;
      if ((lid == null || !locGeom[lid]) && locOrder.length === 1) lid = locOrder[0].locId;
      const bucket = power ? powerByLoc : byLoc;
      if (lid != null && locGeom[lid]) (bucket[lid] = bucket[lid] || []).push(dev);
      else (power ? powerOrphans : orphans).push(dev);
    }
    // Pocket packing: type contours in a top-down column; won't fit above the
    // rack bottom → new sub-column to the right. items — relative (dx,dy) positions.
    const { HEAD_H, PAD, ROW_H, HGAP, VGAP, SUBCOL_GAP } = OFFGEO;
    const nodeW = devs => Math.max(...devs.map(d => this._nodeParts(d, devPorts[d.id] || []).width));
    const typeList = devs => {
      const m = new Map();
      for (const dev of devs) {
        const t = catalogGroup(dev);
        let e = m.get(t.key);
        if (!e) { e = { label: t.label, order: t.order, devs: [] }; m.set(t.key, e); }
        e.devs.push(dev);
      }
      return [...m.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    };
    const pack = (devs, limitH) => {
      const items = [];
      let dx = 0, dy = 0, colW = 0, areaW = 0, areaH = 0;
      for (const grp of typeList(devs)) {
        const n = grp.devs.length, nw = nodeW(grp.devs);
        const cols = Math.min(2, n), rows = Math.ceil(n / cols);
        const cw = PAD * 2 + cols * nw + (cols - 1) * HGAP;
        const ch = HEAD_H + rows * ROW_H + PAD;
        if (dy > 0 && dy + ch > limitH) { dx += colW + SUBCOL_GAP; dy = 0; colW = 0; }
        items.push({ grp, nw, cols, dx, dy, cw, ch });
        colW = Math.max(colW, cw);
        areaW = Math.max(areaW, dx + cw); areaH = Math.max(areaH, dy + ch);
        dy += ch + VGAP;
      }
      return { items, areaW, areaH };
    };
    for (const g of locOrder)
      Object.assign(g, pack(byLoc[g.locId] || [], Math.max(300, g.rackBottom - devTop)));
    // Column x: a location's pocket inserts an offset BEFORE the next locations'
    // columns (the side wire lane lives in COL_GAP — the pocket leaves it alone).
    const colX = []; let extra = 0, prevLid = null;
    group.forEach((rack, col) => {
      const lid = rack.location && rack.location.id;
      if (prevLid != null && lid !== prevLid) {
        const pg = locGeom[prevLid];
        if (pg && pg.areaW) extra += pg.areaW + OFFGEO.AREA_SEP;
      }
      prevLid = lid;
      colX[col] = LEFT_PAD + col * step + extra;
    });
    this._colXArr = colX;
    // Each room's pocket sits just past its last column, after COL_GAP.
    for (const g of locOrder) g.devX = this._colX(g.maxCol) + this.SLOT + COL_GAP;
    this._locGeom = locGeom; this._locOrder = locOrder;
    // Orphans — a pocket right of the whole schema.
    const last = locOrder[locOrder.length - 1];
    const lastRight = group.length ? this._colX(group.length - 1) + this.SLOT : LEFT_PAD;
    const schemaRight = last && last.areaW ? Math.max(lastRight, last.devX + last.areaW) : lastRight;
    this._orphanArea = orphans.length
      ? { x: schemaRight + 60, top: devTop, ...pack(orphans, Math.max(400, maxRB - devTop)) }
      : null;
    // Power ROWS per room — stacked UNDER the room's content and centered on its
    // span, the same anchor math the «Силовые щиты» panels row uses (so all three
    // stand as rows): «Питание» (PDU/ИБП/… type contours side by side), then
    // «Стабилизаторы»; the panels row follows below via g.powerBottom
    // (_renderPowerPanels). Their boxes go into state.offContours[locId], so the
    // room contour encloses them — exactly like the panels via powerBoxEls.
    const PGAP = 46;                             // air above each row (wrap head incl.)
    for (const g of locOrder) {
      const devs = powerByLoc[g.locId] || [];
      const stabs = devs.filter(d => this._isStabDev(d));
      const rest = devs.filter(d => !this._isStabDev(d));
      g.pw = rest.length ? pack(rest, 1) : null;         // limitH=1 → one horizontal row
      g.stab = stabs.length ? pack(stabs, 1) : null;
      const spanLeft = this._colX(g.minCol);
      const spanRight = g.areaW ? g.devX + g.areaW : this._colX(g.maxCol) + this.SLOT + BOX_PAD;
      g.pwCenter = (spanLeft + spanRight) / 2;
      let y = Math.max(g.rackBottom, g.areaH ? g.devTop + g.areaH : 0);
      if (g.pw) { g.pwTop = y + PGAP; y = g.pwTop + g.pw.areaH; }
      if (g.stab) { g.stabTop = y + PGAP; y = g.stabTop + g.stab.areaH; }
      g.powerBottom = (g.pw || g.stab) ? y + 16 : 0;     // + wrap bottom pad
    }
    // Fallback: power gear with NO room in this area (multi-room, device without
    // a location) — one block below ALL content, left-aligned (old behavior).
    let contentBot = maxRB;
    for (const g of locOrder) {
      if (g.areaH) contentBot = Math.max(contentBot, g.devTop + g.areaH);
      if (g.powerBottom) contentBot = Math.max(contentBot, g.powerBottom);
    }
    if (this._orphanArea) contentBot = Math.max(contentBot, this._orphanArea.top + this._orphanArea.areaH);
    if (powerOrphans.length) {
      const packed = pack(powerOrphans, 1);
      this._powerArea = { x: LEFT_PAD, top: contentBot + 46, ...packed };
      this._powerBottom = this._powerArea.top + packed.areaH;
    } else { this._powerArea = null; this._powerBottom = 0; }
  }
  // Left edge of column col's slot (accounting for pockets). Before the pre-pass
  // (or out of range) — the old even grid.
  _colX(col) {
    const a = this._colXArr;
    return a && a[col] != null ? a[col] : this.LEFT_PAD + col * (this.SLOT + COL_GAP);
  }

  // Device palette ("+"): category tabs + device buttons. Clicking a device →
  // PLACE-MODE: a ghost at the cursor, drag into a location (contour highlights
  // dark blue with "+"), click → create-modal for that location.
  _wirePalette() {
    const pal = $("#palette");
    if (!pal) return;
    const tabsEl = pal.querySelector(".pl-tabs"), grid = pal.querySelector(".pl-grid");
    // Category tabs come from the solutions catalog (peripherals / network /
    // power / racks) — same source as the right-click "Add" menu.
    tabsEl.innerHTML = SOLUTION_CATS.map((cat, i) =>
      `<button class="pl-tab${i === 0 ? " active" : ""}" data-cat="${cat}" title="${SOLUTIONS[cat].label}"><i class="mdi ${SOLUTIONS[cat].icon}"></i></button>`).join("");
    const fill = cat => {
      const items = (SOLUTIONS[cat] || {}).items || [];
      grid.innerHTML = items.map(it =>
        `<button class="pl-item" title="${it.label}"><i class="mdi ${it.icon}"></i><span>${it.label}</span></button>`).join("");
      // mousedown → drag: hold LMB and drag (drop by releasing over a location),
      // or click and move with no button held (drop on the next click).
      grid.querySelectorAll(".pl-item").forEach((b, i) => b.addEventListener("mousedown", ev => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        this._startPlacing(items[i], ev);
      }));
    };
    tabsEl.querySelectorAll(".pl-tab").forEach(tab => tab.addEventListener("click", () => {
      tabsEl.querySelectorAll(".pl-tab").forEach(t => t.classList.toggle("active", t === tab));
      fill(tab.dataset.cat);
    }));
    fill(SOLUTION_CATS[0]);
  }
  _startPlacing(item, ev) {
    this._cancelPlacing();
    this._placing = item;
    this._placeStart = ev ? { x: ev.clientX, y: ev.clientY } : null;
    const g = mk("div", { className: "pl-ghost", html: `<i class="mdi ${item.icon}"></i><span>${item.label}</span>` });
    document.body.appendChild(g);
    if (ev) { g.style.left = ev.clientX + "px"; g.style.top = ev.clientY + "px"; }
    this._placeGhost = g;
    document.body.classList.add("placing");
    this._plMove = ev => this._placeMove(ev);
    this._plDown = ev => { if (ev.button === 2) { ev.preventDefault(); this._plPan = { x: ev.clientX, y: ev.clientY }; } };
    // Drag ONLY: release LMB over a location AFTER moving → drop; if not dragged
    // (no movement) — cancel, create nothing (as requested).
    this._plUp = ev => {
      if (ev.button === 2) { this._plPan = null; return; }
      if (ev.button !== 0) return;
      const s = this._placeStart || { x: ev.clientX, y: ev.clientY };
      if (Math.abs(ev.clientX - s.x) + Math.abs(ev.clientY - s.y) > 6) this._placeDrop(ev);
      else this._cancelPlacing();
    };
    this._plKey = ev => { if (ev.key === "Escape") this._cancelPlacing(); };
    this._plCtx = ev => ev.preventDefault();   // RMB during placement — pan, not menu
    window.addEventListener("mousemove", this._plMove);
    window.addEventListener("mousedown", this._plDown);
    window.addEventListener("mouseup", this._plUp);
    window.addEventListener("keydown", this._plKey);
    window.addEventListener("contextmenu", this._plCtx);
    setStatus(`тащи «${item.label}» в локацию · ПКМ — двигать холст · Esc — отмена`);
  }
  _placeMove(ev) {
    if (this._placeGhost) { this._placeGhost.style.left = ev.clientX + "px"; this._placeGhost.style.top = ev.clientY + "px"; }
    // RMB held → pan the canvas (scroll).
    if (this._plPan) {
      const pane = $("#schempane");
      if (pane) { pane.scrollLeft -= ev.clientX - this._plPan.x; pane.scrollTop -= ev.clientY - this._plPan.y; }
      this._plPan = { x: ev.clientX, y: ev.clientY };
      return;
    }
    this._highlightDropLoc(this._locAtPoint(ev.clientX, ev.clientY));
  }
  // Location contour under a point (client coords). Accounts for scroll/zoom.
  _locAtPoint(clientX, clientY) {
    const canvas = $("#schema"); if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(), z = state.zoom || 1;
    const x = (clientX - rect.left) / z, y = (clientY - rect.top) / z;
    const locs = (this._contours || []).filter(c => c.kind === "loc");
    for (const c of locs) {
      const b = c._box || c.base;
      if (x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height) return c;
    }
    // Single location in scope → no contours, the whole schema is it.
    if (!locs.length && state.scope && state.scope.type === "location")
      return { kind: "loc", locId: state.scope.id, locName: state.scope.name, _whole: true };
    return null;
  }
  _highlightDropLoc(loc) {
    if (this._plHi && this._plHi !== (loc && loc.el)) this._plHi.classList.remove("pl-drop");
    this._plHi = loc && loc.el ? loc.el : null;
    if (this._plHi) this._plHi.classList.add("pl-drop");
    this._plLoc = loc;
  }
  _placeDrop(ev) {
    const loc = this._locAtPoint(ev.clientX, ev.clientY);
    const item = this._placing;
    this._cancelPlacing();
    if (!loc || !item) { setStatus("вне локации — создание отменено"); return; }
    // Location's site: from loc.siteId or (whole schema) from current racks.
    let siteId = loc.siteId;
    if (!siteId && state.group && state.group[0] && state.group[0].site) siteId = state.group[0].site.id;
    const ctx = { siteId, locId: loc.locId, locName: loc.locName };
    // Route by solution type: rack → Rack, panel → Power Panel, everything
    // else → device (solution, ports by count).
    if (item.kind === "rack") this.app.device.addRack(ctx);
    else if (item.kind === "panel") this.app.device.addPanel(ctx);
    else this.app.device.addSolution(item, ctx);
  }
  _cancelPlacing() {
    if (this._placeGhost) { this._placeGhost.remove(); this._placeGhost = null; }
    if (this._plHi) { this._plHi.classList.remove("pl-drop"); this._plHi = null; }
    document.body.classList.remove("placing");
    for (const [ev, fn] of [["mousemove", this._plMove], ["mousedown", this._plDown],
      ["mouseup", this._plUp], ["keydown", this._plKey], ["contextmenu", this._plCtx]])
      if (fn) window.removeEventListener(ev, fn);
    this._placing = this._plLoc = this._plPan = null;
    this._placeArmed = false; this._placeStart = null;
  }

  // "Net" (in view terms) = radio ONLY → shown in the Wireless view. Circuit
  // ports (provider uplink) are now PHYSICAL: shown in the Physical view as a
  // cloud, not hidden (see _placeDot: isCircuit → cloud).
  _isNetPort(otype, item) {
    if (otype !== "dcim.interface") return false;
    return this._isWirelessItem(item);
  }
  // wireless interface (radio type or has wireless_link)
  _isWirelessItem(item) {
    const t = (item.type && item.type.value) || "";
    return !!item.wireless_link || t.startsWith("ieee802.11") || t.startsWith("other-wireless");
  }
  // interface with a circuit uplink (termination at the cable's far end)
  _isCircuitItem(item) {
    return item.link_peers_type === "circuits.circuittermination";
  }

  // Cable-legend rows: only families actually present among current cables
  // (+ "untyped" if any). Empty — not shown.
  _cableLegendRows() {
    const fams = new Set(state.cables.map(c => cableFamily(c.type)));
    const hasUntyped = state.cables.some(c => !c.type);
    // order as in FAMILY_LABEL; default shown as "untyped"
    const rows = [];
    // Cable legend mark — just a SEGMENT in its type color (not a dot).
    for (const fam of Object.keys(FAMILY_LABEL)) {
      if (fam === "default") continue;
      if (!fams.has(fam)) continue;
      rows.push(`<span><span class="lg-cable" style="background:var(--cbl-${fam})"></span>${FAMILY_LABEL[fam]}</span>`);
    }
    if (hasUntyped)
      rows.push(`<span><span class="lg-cable" style="background:var(--cbl-default)"></span>без типа</span>`);
    return rows.length ? rows.join("") : `<span style="color:var(--muted)">кабелей нет</span>`;
  }
  // Human-readable cable-type name from state.cableTypes; empty → "untyped".
  _cableTypeLabel(type) {
    if (!type) return "без типа";
    const found = (state.cableTypes || []).find(t => t.value === type);
    return found ? found.label : type;
  }
  // Near cable neighbour (device · port) of an occupied port — the connection's
  // destination shown in the tooltip. From the loaded cables (area + single view),
  // with a link_peers fallback (single-view items carry it). The FULL far end
  // through patch panels would need the async /trace/ (see _trace) — not done here.
  _portDest(kind, item) {
    if (!item.cable) return "";
    const cid = item.cable.id || item.cable;
    const cable = (state.cables || []).find(c => c.id === cid);
    if (cable) {
      for (const t of [...(cable.a_terminations || []), ...(cable.b_terminations || [])]) {
        if (t.object_type === kind.otype && t.object_id === item.id) continue;   // skip the near side
        const o = t.object || {};
        const dn = o.device && o.device.name, pn = o.name;
        if (dn && pn) return `${dn} · ${pn}`;
        return dn || pn || "вне области";
      }
    }
    if (item.link_peers && item.link_peers.length)   // single-view fallback
      return item.link_peers.map(p => (p.device ? p.device.name + " · " : "") + (p.name || p.display || "?")).join(", ");
    return "";
  }
  _portTip(dev, kind, item) {
    const touch = matchMedia("(pointer: coarse)").matches || innerWidth <= 760;
    const badge = this.app.layers ? this.app.layers.portBadge(kind.otype, item.id) : null;
    // Interface IPs — the SAME green pill as the passport (chip .c-ip), shown to the
    // RIGHT of the kind label.
    let ipPill = "";
    if (kind.otype === "dcim.interface") {
      const ips = (state.ipsByIface && state.ipsByIface[item.id]) || [];
      if (ips.length) ipPill = `<span class="t-ip">${ips.map(x => `<span class="chip c-ip">${x.address}</span>`).join("")}</span>`;
    }
    // Next port in the connection — right UNDER the device title (not under the IP).
    const dest = this._portDest(kind, item);
    const destLine = dest ? `<div class="t-line t-dest">→ ${dest}</div>` : "";
    const action = item.cable
      ? (Mode.on("schema") ? "клик — меню связи (удалить / перевесить)" : "клик — показать путь")
      : (state.pending ? "клик — соединить сюда"
        : (Mode.on("schema") ? "клик — начать связь" : "свободен"));
    // Port type (interface speed / console-power connector), e.g. «· 1000BASE-T».
    const typeStr = (item.type && item.type.label) ? ` · ${item.type.label}` : "";
    return `<div class="t-title">${dev.name} · ${item.name}</div>` +
      destLine +
      `<div class="t-line t-kindrow"><span>${KIND_RU[kind.otype] || kind.label}${typeStr}</span>${ipPill}</div>` +
      (badge ? `<div class="t-badge">${badge}</div>` : "") +
      // Touch: a 2nd tap on the SAME port traces the whole path (hint below).
      // Desktop: the click hint.
      (touch
        ? (item.cable ? `<div class="t-mut">ещё раз по порту — весь путь</div>` : "")
        : `<div class="t-mut">${action}</div>`);
  }

  // refresh cables without a full redraw
  async refreshCables() {
    const cables = await apiAllByIds("/dcim/cables/", "rack_id", state.group.map(r => r.id));
    const seen = new Set();
    state.cables = cables.filter(c => !seen.has(c.id) && seen.add(c.id));
    const cableByKey = new Map();
    for (const c of state.cables)
      for (const t of [...(c.a_terminations || []), ...(c.b_terminations || [])])
        cableByKey.set(termKey(t), c.id);
    for (const [key, p] of Object.entries(state.ports)) {
      const cid = cableByKey.get(key);
      p.el.classList.toggle("used", cid != null);
      p.item.cable = cid != null ? { id: cid } : null;
    }
    this.redrawWires();
    this._refreshCableLegend();
    // Rebuild the layers panel (a console-cable etc. may have appeared/vanished);
    // renderPanel also restores and re-applies the active layer.
    if (this.app.layers) this.app.layers.renderPanel();
    // Filter: a cable family may have appeared/vanished; render() also re-applies
    // the hiding (wires were rebuilt in redrawWires).
    if (this.app.filter) this.app.filter.render();
  }
  // Wireless analogue of refreshCables — after a WirelessLink delete. state.wirelessLinks
  // feeds _collectWireless → drop the removed link, free its two interface ports, then
  // let renderPanel recompute state._wireless / the radio count and re-apply the active
  // wireless layer with fresh pairs (or clear it if the last link is gone). No network
  // refetch: we already know the deleted id.
  _refreshRadio(wlinkId) {
    state.wirelessLinks = (state.wirelessLinks || []).filter(w => w.id !== wlinkId);
    for (const p of Object.values(state.ports)) {
      const wl = p.item.wireless_link;
      if (wl && (wl.id || wl) === wlinkId) { p.item.wireless_link = null; p.el.classList.remove("used"); }
    }
    if (this.app.layers) this.app.layers.renderPanel();
    this.redrawWires();   // also covers net-view with no active layer (drawRadioLinks reads fresh pairs)
  }
  // Rebuild only the cable-legend rows (after a cable mutation).
  _refreshCableLegend() {
    const body = $("#legend .lg-body");
    if (!body) return;
    const subs = body.querySelectorAll(".lg-sub");
    const cableSub = subs[subs.length - 1];   // the "Cables (color = type)" sub-header
    if (!cableSub) return;
    while (cableSub.nextSibling) cableSub.nextSibling.remove();
    cableSub.insertAdjacentHTML("afterend", this._cableLegendRows());
  }

  applyZoom() {
    const canvas = $("#schema");
    if (canvas) canvas.style.transform = "scale(" + state.zoom + ")";
    const hint = $("#zoomhint");
    if (hint) hint.textContent = "масштаб " + Math.round(state.zoom * 100) + "% · колесо = масштаб";
  }

  // physical/wireless view switch
  // The Wireless view shows radio ports ONLY, replacing the node's groups; the
  // Physical view shows physical ports (incl. circuit uplinks as a cloud). Port
  // and node-width relayout is in _layoutNode/relayoutNodes; invisible ports
  // aren't in the DOM, so cables to them just aren't drawn (redrawWires).
  _wireViewSwitch() {
    const sw = $("#viewswitch");
    if (!sw) return;
    sw.querySelectorAll(".vs-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.view;
        if (v === state.viewMode) return;
        state.viewMode = v;
        this.applyViewMode();
      });
    });
    this.applyViewMode(true);   // initial setup, no relayout (nodes still in render)
  }
  // init=true — only set classes/button (render lays out nodes itself);
  // otherwise — full node relayout for the new mode.
  applyViewMode(init) {
    const net = state.viewMode === "net";
    document.body.classList.toggle("view-net", net);
    document.body.classList.toggle("view-phys", !net);
    const sw = $("#viewswitch");
    if (sw) {
      sw.dataset.view = state.viewMode;
      sw.querySelectorAll(".vs-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.view === state.viewMode));
    }
    if (!init) this.relayoutNodes();   // relayout ports/width + redrawWires
  }
  focusDevice(dev) {
    const node = state.nodeEls[dev.id];
    const pane = $("#schempane");
    if (!node || !pane) return;
    const z = state.zoom;
    const nx = px(node.style.left) * z, ny = px(node.style.top) * z;
    pane.scrollTo({
      left: nx + node.offsetWidth * z / 2 - pane.clientWidth / 2,
      top: ny + node.offsetHeight * z / 2 - pane.clientHeight / 2,
      behavior: "smooth",
    });
    node.classList.add("hl");
    setTimeout(() => node.classList.remove("hl"), 1400);
  }

  // global listeners: pan/zoom, cancel-menu, Cancel button
  _wire() {
    window.addEventListener("resize", () => this.redrawWires());
    this.linkmenu.querySelector(".x").addEventListener("click", async () => {
      const ctx = state.linkCtx; this._closeLinkMenu();
      if (!ctx) return;
      try {
        if (ctx.wlink) {
          await api("/wireless/wireless-links/" + ctx.wlink + "/", "DELETE");
          this._refreshRadio(ctx.wlink);
          setStatus("радио-связь удалена", "ok");
        } else {
          await api("/dcim/cables/" + ctx.cableId + "/", "DELETE");
          setStatus("связь удалена", "ok");
          await this.refreshCables();
        }
      } catch (e) { setStatus("не получилось: " + e.message, "err"); }
    });
    this.linkmenu.querySelector(".up").addEventListener("click", async () => {
      const ctx = state.linkCtx; this._closeLinkMenu();
      if (!ctx) return;
      // Radio link: no cable to re-thread — drop the WirelessLink, then re-pend
      // the far radio port (pending flow re-creates a WirelessLink, see _onPortClick).
      if (ctx.wlink) {
        const pairs = (this.app.layers && this.app.layers._collectWireless().pairs) || [];
        const near = Object.values(state.ports)
          .find(p => p.item.id === ctx.item.id && p.dev.id === ctx.dev.id);
        const nearKey = near ? portKey(near.otype, near.item.id) : null;
        const pair = pairs.find(pr => pr.id === ctx.wlink);
        const farKey = pair ? (pair.a === nearKey ? pair.b : pair.a) : null;
        try {
          await api("/wireless/wireless-links/" + ctx.wlink + "/", "DELETE");
          this._refreshRadio(ctx.wlink);
          const p = farKey ? state.ports[farKey] : null;
          if (p) {
            this.setPending({ otype: p.otype, id: p.item.id, label: p.dev.name + "/" + p.item.name, el: p.el });
            setStatus("радио-связь снята — выбери новый порт для " + p.dev.name + "/" + p.item.name, "ok");
          } else setStatus("радио-связь снята", "ok");
        } catch (e) { setStatus("не получилось: " + e.message, "err"); }
        return;
      }
      const nearPort = Object.values(state.ports)
        .find(p => p.item.id === ctx.item.id && p.dev.id === ctx.dev.id);
      const farKey = nearPort ? this._farEndKey(ctx.cableId, nearPort.otype, nearPort.item.id) : null;
      try {
        await api("/dcim/cables/" + ctx.cableId + "/", "DELETE");
        await this.refreshCables();
        const p = farKey ? state.ports[farKey] : null;
        if (p) {
          this.setPending({ otype: p.otype, id: p.item.id, label: p.dev.name + "/" + p.item.name, el: p.el });
          setStatus("связь снята — выбери новый порт для " + p.dev.name + "/" + p.item.name, "ok");
        } else {
          setStatus("связь снята", "ok");
        }
      } catch (e) { setStatus("не получилось: " + e.message, "err"); }
    });
    document.addEventListener("mousedown", ev => {
      if (state.linkCtx && !ev.target.closest("#linkmenu")) this._closeLinkMenu();
    });
    // Mobile tooltip's close cross → clear cable/trace highlight.
    document.addEventListener("schematic:tipclose", () => this._clearTrace());
    // (The «показать весь путь» button is wired directly to its port in _onPortClick.)
    this._enablePanZoom();
    this._enableResize();
  }
  _enablePanZoom() {
    const pane = $("#schempane");
    let panning = false, sx = 0, sy = 0, sl = 0, st = 0;
    pane.addEventListener("mousedown", ev => {
      if (ev.button !== 0) return;
      if (ev.target.closest(".node") || ev.target.closest(".port") || ev.target.closest(".rb-edit") || ev.target.tagName === "path") return;
      panning = true;
      sx = ev.clientX; sy = ev.clientY; sl = pane.scrollLeft; st = pane.scrollTop;
      pane.classList.add("panning");
    });
    // Click a node's BODY — highlight it green and allow text selection (pan
    // doesn't select by default). Name/buttons/ports swallow click
    // (stopPropagation) → don't reach here, so a name-click opens the passport
    // while body/model enables selection. A click off nodes clears all.
    pane.addEventListener("click", ev => {
      const node = ev.target.closest(".node");
      document.querySelectorAll(".node.text-sel").forEach(n => { if (n !== node) n.classList.remove("text-sel"); });
      if (node && !ev.target.closest(".port, .nm, .node-edit, .node-addip")) node.classList.toggle("text-sel");
      // Tap on empty space clears the stack highlight/dim (touch has no hover).
      if (!node) this._highlightStack(null);
    });
    // Touch: a genuine TAP on empty space (not a port/tooltip) closes the port
    // tooltip. A PAN (finger drag) or a PINCH (2 fingers) must NOT close it — else
    // you can't move/zoom the schema while reading the tip or reaching «показать
    // путь». Tracked over pointer down→up: multi-touch or a >8px move ⇒ not a tap.
    const _tapPtrs = new Set();
    let _tapX = 0, _tapY = 0, _tapMulti = false;
    document.addEventListener("pointerdown", ev => {
      _tapPtrs.add(ev.pointerId);
      if (_tapPtrs.size > 1) _tapMulti = true;
      else { _tapX = ev.clientX; _tapY = ev.clientY; _tapMulti = false; }
    }, true);
    const _tapEnd = ev => {
      _tapPtrs.delete(ev.pointerId);
      if (_tapPtrs.size) return;                                   // fingers still down
      const isTap = !_tapMulti && Math.abs(ev.clientX - _tapX) + Math.abs(ev.clientY - _tapY) < 8;
      _tapMulti = false;
      if (!isTap) return;                                          // pan / pinch — keep the tip
      if (ev.target.closest && ev.target.closest(".port, #tip")) return;
      const tip = $("#tip");
      if (tip && tip.style.display !== "none") { tip.style.display = "none"; this._tipPort = null; }
    };
    document.addEventListener("pointerup", _tapEnd, true);
    document.addEventListener("pointercancel", _tapEnd, true);
    window.addEventListener("mousemove", ev => {
      if (!panning) return;
      pane.scrollLeft = sl - (ev.clientX - sx);
      pane.scrollTop = st - (ev.clientY - sy);
    });
    window.addEventListener("mouseup", ev => {
      if (!panning) return;
      panning = false;
      pane.classList.remove("panning");
      // TAP vs pan by down→up DISTANCE (not a `moved` flag): a touch one-finger pan
      // is native scroll and fires no mousemove, so a flag would stay false and a
      // pan would wrongly clear the trace. Distance works for mouse AND touch.
      const tap = Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5;
      if (tap && (ev.target.id === "schema" || ev.target.id === "wires" || ev.target.closest(".rackbox"))) {
        if (state.pending) { this.setPending(null); setStatus("привязка отменена"); }
        else this._clearTrace();
      }
    });
    pane.addEventListener("wheel", ev => {
      ev.preventDefault();
      const prev = state.zoom;
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      state.zoom = Math.min(2.5, Math.max(0.3, state.zoom * factor));
      const rect = pane.getBoundingClientRect();
      const cx = pane.scrollLeft + (ev.clientX - rect.left);
      const cy = pane.scrollTop + (ev.clientY - rect.top);
      const k = state.zoom / prev;
      this.applyZoom();
      pane.scrollLeft = cx * k - (ev.clientX - rect.left);
      pane.scrollTop = cy * k - (ev.clientY - rect.top);
      this.redrawWires();
    }, { passive: false });

    // Two-finger pinch-zoom — the SHARED helper (identical on every canvas; one
    // finger still pans via native #schempane scroll thanks to touch-action).
    attachPinchZoom(pane, {
      getZoom: () => state.zoom,
      setZoom: z => { state.zoom = z; },
      applyZoom: () => this.applyZoom(),
      onEnd: () => this.redrawWires(),
    });
  }
  _enableResize() {
    const rz = $("#resizer"), pane = $("#rackpane");
    let drag = false;
    rz.addEventListener("mousedown", ev => { drag = true; rz.classList.add("drag"); ev.preventDefault(); });
    window.addEventListener("mousemove", ev => {
      if (!drag) return;
      const left = pane.getBoundingClientRect().left;
      pane.style.width = Math.min(900, Math.max(260, ev.clientX - left)) + "px";
    });
    window.addEventListener("mouseup", () => { drag = false; rz.classList.remove("drag"); });
  }
}


_mixin(SchemaManager.prototype, NodeMethods, ContourMethods, PowerMethods, WireMethods, InteractMethods);
