"use strict";
// LayerManager: overlay layers on top of the physical schema.
// Unified highlighting of logical entities "smeared" across already-drawn
// ports (VLAN; later Circuits/Wireless/Power). Picking an entity in the
// "Слои" panel highlights the involved ports and dims the rest (same trick
// as hover/trace), plus a badge in the port tooltip.
//
// An entity is NOT drawn as a separate node — it highlights existing ports.
// The panel lives in the schema overlay (#layers); it neither scrolls nor zooms.

import { $, state, portKey, termKey } from "./core.js";
import { setStatus } from "./api.js";

// VLAN/SSID names are free text in NetBox and go into innerHTML below.
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The three schema views, rendered as a segment on top of the layer list.
const VIEWS = [
  // Order is by label LENGTH, not by importance: the segment is one row in a 240px
  // panel, so the longest label goes last where it has the panel edge to grow into.
  { value: "phys", label: "Физический", icon: "mdi-lan" },
  { value: "vlan", label: "VLAN", icon: "mdi-tag-multiple-outline" },
  { value: "net", label: "Беспроводной", icon: "mdi-access-point-network" },
];
// Which view a layer belongs to. Doubles as the panel's visibility rule: the list
// only offers layers the CURRENT view can actually draw, so every button in it
// highlights something instead of silently relayouting the schema first. VLAN used
// to be offered in the physical view as well — but that made the segment right
// above it a lie, since picking a VLAN there jumped the view anyway.
// The FIRST entry is the fallback for a programmatic _toggle from another view.
const LAYER_VIEWS = {
  vlan: ["vlan"], console: ["phys"], power: ["phys"],
  wireless: ["net"], circuit: ["net"],
};
const LINK_LAYERS = ["console", "power", "wireless", "circuit"];

// Active layer: { kind, id, portKeys:Set, badge:(port)=>string|null }.
// null — nothing selected. Kept in state to survive schema re-render.
export class LayerManager {
  // Highlight color per layer type (used as --layer-color in CSS).
  static LAYER_COLOR = { power: "var(--power)", console: "var(--console)",
    wireless: "var(--wireless)", circuit: "var(--circuit)", vlan: "var(--accent)" };
  constructor(app) {
    this.app = app;
  }

  // VLAN: collect VLANs actually present on ports.
  // Returns Map vid → { vlan, portKeys:Set } over the loaded interfaces
  // (untagged_vlan + tagged_vlans + qinq_svlan). Only dcim.interface carries
  // VLANs; other port types are skipped.
  _collectVlans() {
    const byVlan = new Map();
    const add = (vlan, key) => {
      if (!vlan) return;
      let e = byVlan.get(vlan.id);
      if (!e) { e = { vlan, portKeys: new Set() }; byVlan.set(vlan.id, e); }
      e.portKeys.add(key);
    };
    for (const [key, p] of Object.entries(state.ports)) {
      if (p.otype !== "dcim.interface") continue;
      const it = p.item;
      add(it.untagged_vlan, key);
      add(it.qinq_svlan, key);
      for (const v of it.tagged_vlans || []) add(v, key);
    }
    return byVlan;
  }

  // Console links: ports participating in console↔console cables.
  // Returns a Set of portKeys of all console/console-server ports that have
  // a cable (i.e. actually linked). Single layer (a checkbox, not a list).
  _collectConsolePorts() {
    const keys = new Set(), cables = new Set();
    const isConsole = ot => ot === "dcim.consoleport" || ot === "dcim.consoleserverport";
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      // A cable belongs to the console layer if at least one end is a console port.
      if (!terms.some(t => isConsole(t.object_type))) continue;
      cables.add(c.id);
      for (const t of terms) {
        const k = termKey(t);
        if (state.ports[k]) keys.add(k);
      }
    }
    return { keys, cables };
  }

  // Power: power-chain ports + wires + total load.
  // A NetBox power chain is power-port ↔ (cable) ↔ power-outlet, plus the
  // INTERNAL outlet.power_port link (PDU outlets feed from its input port —
  // no cable there, the association lives in the outlet itself). Single layer
  // (checkbox), like console: highlights all power ports/outlets in the chain
  // AND the power cables themselves. Also sums load via allocated_draw/
  // maximum_draw (W) — demo data has no PowerFeed source, so "Feed capacity"
  // is not shown yet (see .md: Panel/Feed source node is the next step).
  _collectPower() {
    const isPowerOt = ot => ot === "dcim.powerport" || ot === "dcim.poweroutlet";
    const keys = new Set(), cables = new Set();
    let allocated = 0, maximum = 0;
    // 1) Ports/outlets on power cables.
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      if (!terms.some(t => isPowerOt(t.object_type))) continue;
      cables.add(c.id);
      for (const t of terms) {
        const k = termKey(t);
        if (state.ports[k]) keys.add(k);
      }
    }
    // 2) Internal link outlet → its feeding power_port (PDU).
    //    No wire, but both points belong to the chain — highlight both.
    for (const [key, p] of Object.entries(state.ports)) {
      if (p.otype !== "dcim.poweroutlet") continue;
      const pp = p.item.power_port;
      if (!pp) continue;
      const ppKey = portKey("dcim.powerport", pp.id);
      if (state.ports[ppKey]) { keys.add(ppKey); keys.add(key); }
    }
    // 3) Load: sum draw over the involved power-ports (not outlets — draw is
    //    declared on the consumer, i.e. the device's power-port).
    for (const key of keys) {
      const p = state.ports[key];
      if (!p || p.otype !== "dcim.powerport") continue;
      allocated += p.item.allocated_draw || 0;
      maximum += p.item.maximum_draw || 0;
    }
    return { keys, cables, allocated, maximum };
  }

  // Wireless: radio links between interfaces of two devices.
  // WirelessLink = interface_a ↔ interface_b (both dcim.interface). No cable,
  // the link is purely logical. Computed from DATA (both link devices in the
  // current group), NOT from state.ports — that depends on the view mode (in
  // physical mode wireless ports are absent from the DOM, yet the link
  // exists). Drawing/highlighting checks DOM port presence later. Single layer.
  _collectWireless() {
    const pairs = [], keys = new Set();
    const inGroup = new Set((state.devices || []).map(d => d.id));
    for (const wl of state.wirelessLinks || []) {
      const ia = wl.interface_a, ib = wl.interface_b;
      if (!ia || !ib) continue;
      // both ends must belong to devices of the current group
      const da = ia.device && ia.device.id, db = ib.device && ib.device.id;
      if (!inGroup.has(da) || !inGroup.has(db)) continue;
      const ka = portKey("dcim.interface", ia.id), kb = portKey("dcim.interface", ib.id);
      pairs.push({ id: wl.id, a: ka, b: kb, ssid: wl.ssid || wl.display || "" });
      keys.add(ka); keys.add(kb);
    }
    return { pairs, keys };
  }

  // Circuits: ports whose cable goes to a circuit termination.
  // A circuit "exits to WAN" via a CircuitTermination cabled to a device
  // port. Returns a Set of such portKeys + Map portKey→circuit (for the
  // badge / "to cloud" icon). Single layer (checkbox). Data: state.cables
  // (circuittermination↔port cable) + state.circuitTerms/state.circuits.
  _collectCircuits() {
    const keys = new Set();
    const byPort = new Map();     // portKey → { circuit, term }
    // terminations and circuits indexed by id
    const termById = new Map((state.circuitTerms || []).map(t => [t.id, t]));
    const circById = new Map((state.circuits || []).map(c => [c.id, c]));
    // state.cables is already filtered by group racks → any cable here is a
    // group cable; do NOT check state.ports (it depends on the view mode).
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      const ct = terms.find(t => t.object_type === "circuits.circuittermination");
      const port = terms.find(t => t.object_type !== "circuits.circuittermination");
      if (!ct || !port) continue;
      const pKey = termKey(port);
      keys.add(pKey);
      const term = termById.get(ct.object_id);
      const circ = term && term.circuit ? (circById.get(term.circuit.id) || term.circuit) : null;
      byPort.set(pKey, { circuit: circ, term });
    }
    return { keys, byPort };
  }

  // render the "Слои" panel: VLAN section + links section
  renderPanel() {
    const host = $("#layers");
    if (!host) return;
    const vlans = this._collectVlans();
    state._vlanIndex = vlans;   // for the port tooltip (badges)
    const vlanList = [...vlans.values()].sort((a, b) => (a.vlan.vid ?? 0) - (b.vlan.vid ?? 0));

    const console_ = this._collectConsolePorts();
    state._consolePorts = console_.keys;
    state._consoleCables = console_.cables;

    const power = this._collectPower();
    state._power = power;

    const wireless = this._collectWireless();
    state._wireless = wireless;

    const circuits = this._collectCircuits();
    state._circuits = circuits;

    const body = host.querySelector(".ly-body");
    // A layer only highlights what the current view draws, so the list shows only
    // the layers of THIS view (see LAYER_VIEWS): VLAN in the VLAN cut, console and
    // power in the physical one, radio and circuits in the wireless one.
    const inView = kind => (LAYER_VIEWS[kind] || ["phys"]).includes(state.viewMode);
    let html = "";

    // View segment ON TOP of the layer list. A view swaps the node's ports and
    // relayouts (radio button — one is always on); a layer only highlights on top
    // of it (toggle — usually none). Same panel, deliberately different control.
    html += `<div id="viewswitch" title="Режим отображения схемы" data-view="${state.viewMode}">` +
      VIEWS.map(v =>
        `<button class="vs-btn${state.viewMode === v.value ? " active" : ""}" data-view="${v.value}"
           ><i class="mdi ${v.icon}"></i> ${v.label}</button>`).join("") +
      `</div>`;

    // VLAN section — the VLAN cut only.
    if (inView("vlan")) {
      html += `<div class="ly-sub">VLAN (подсветка портов)</div>`;
      if (vlanList.length) {
        // The dot carries the VLAN's OWN colour, the same the canvas gives it —
        // the list and the schema were naming the same thing two different ways.
        html += vlanList.map(({ vlan, portKeys }) =>
          `<button class="ly-item" type="button" data-layer="vlan" data-id="${vlan.id}">
             <span class="ly-dot" style="border-color:${this.app.schema._vlanColor(vlan)};background:${this.app.schema._vlanColor(vlan)}"></span>
             <span class="ly-name">${vlan.vid != null ? "VLAN " + vlan.vid : ""} ${esc(vlan.name || vlan.display || "")}</span>
             <span class="ly-count">${portKeys.size}</span>
           </button>`).join("");
      } else {
        html += `<div class="ly-empty">VLAN на портах группы нет</div>`;
      }
    }

    // Links section: console + power in the physical view, radio + circuits in the
    // wireless one. The header is skipped when the current view owns neither pair.
    if (LINK_LAYERS.some(inView)) {
      html += `<div class="ly-sub">Связи</div>`;
    }
    if (inView("console")) {
      if (console_.cables.size) {
        html += `<button class="ly-item" type="button" data-layer="console" data-id="0">
             <span class="ly-dot"></span>
             <span class="ly-name">Console-связи</span>
             <span class="ly-count">${console_.cables.size}</span>
           </button>`;
      } else {
        html += `<div class="ly-empty">console-кабелей в группе нет</div>`;
      }
    }
    // Power: checkbox + total load (W) under the name, if declared.
    if (inView("power")) {
      if (power.keys.size) {
        const load = power.allocated || power.maximum
          ? `<span class="ly-meta">${power.allocated ? power.allocated + " Вт" : "?"}${power.maximum ? " / " + power.maximum + " Вт макс" : ""}</span>`
          : "";
        html += `<button class="ly-item" type="button" data-layer="power" data-id="0">
             <span class="ly-dot" style="border-color:var(--power)"></span>
             <span class="ly-name">Питание ${load}</span>
             <span class="ly-count">${power.cables.size}</span>
           </button>`;
      } else {
        html += `<div class="ly-empty">цепей питания в группе нет</div>`;
      }
    }
    // Wireless: checkbox, counter = number of radio links in the group.
    if (inView("wireless")) {
      if (wireless.pairs.length) {
        html += `<button class="ly-item" type="button" data-layer="wireless" data-id="0">
             <span class="ly-dot" style="border-color:var(--wireless,#b98cff)"></span>
             <span class="ly-name">Wireless (радио)</span>
             <span class="ly-count">${wireless.pairs.length}</span>
           </button>`;
      } else {
        html += `<div class="ly-empty">радио-линков в группе нет</div>`;
      }
    }
    // Circuits: checkbox, counter = number of ports exiting to a circuit.
    if (inView("circuit")) {
      if (circuits.keys.size) {
        html += `<button class="ly-item" type="button" data-layer="circuit" data-id="0">
             <span class="ly-dot" style="border-color:var(--circuit,#4fc3e8)"></span>
             <span class="ly-name">Circuits (в WAN)</span>
             <span class="ly-count">${circuits.keys.size}</span>
           </button>`;
      } else {
        html += `<div class="ly-empty">circuit-выходов в группе нет</div>`;
      }
    }

    html += `<button class="ly-clear" type="button"><i class="mdi mdi-close"></i> снять подсветку</button>`;
    body.innerHTML = html;

    // Item click toggles: clicking the active one again clears the selection.
    body.querySelectorAll(".ly-item").forEach(btn => {
      btn.addEventListener("click", () => this._toggle(btn.dataset.layer, +btn.dataset.id));
    });
    body.querySelector(".ly-clear").addEventListener("click", () => this.clear());
    // View segment: unlike a layer it is never "off", so a click on the active
    // one does nothing.
    body.querySelectorAll("#viewswitch .vs-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.view;
        if (v === state.viewMode || !this.app.schema) return;
        state.viewMode = v;
        this.app.schema.applyViewMode();
      });
    });

    // Restore the active layer after a schema re-render.
    if (state.activeLayer) this._restoreActive();
    this._syncPanelState();
  }

  // Toggle a layer by (kind,id): a repeat click on the active one clears it.
  _toggle(kind, id) {
    if (state.activeLayer && state.activeLayer.kind === kind && state.activeLayer.id === id) {
      this.clear();
      return;
    }
    // A layer only highlights ports the CURRENT view actually draws, so picking a
    // "foreign" one switches the view first (see LAYER_VIEWS). This used to happen
    // invisibly, from a control in another block; now the segment sits right above
    // and visibly moves — the schema relayouting is no longer a surprise.
    const views = LAYER_VIEWS[kind] || ["phys"];
    if (!views.includes(state.viewMode) && this.app.schema) {
      state.viewMode = views[0];
      this.app.schema.applyViewMode();   // relayout nodes + re-mark the segment
    }
    if (kind === "vlan")
      this.selectVlan(id);
    else if (kind === "console")
      this.selectConsole();
    else if (kind === "power")
      this.selectPower();
    else if (kind === "wireless")
      this.selectWireless();
    else if (kind === "circuit")
      this.selectCircuits();
  }

  // Restore the active layer after a re-render (its data may have vanished).
  _restoreActive() {
    const a = state.activeLayer;
    // The panel only lists layers of the current view, so a highlight carried over
    // from the previous one would keep dimming the schema with no button left to
    // switch it off. Dropping it is also honest: the view no longer draws its ports.
    if (!(LAYER_VIEWS[a.kind] || ["phys"]).includes(state.viewMode)) { this.clear(); return; }
    if (a.kind === "vlan") {
      if (state._vlanIndex.has(a.id)) this.selectVlan(a.id); else state.activeLayer = null;
    } else if (a.kind === "console") {
      if (state._consolePorts.size) this.selectConsole(); else state.activeLayer = null;
    } else if (a.kind === "power") {
      if (state._power && state._power.keys.size) this.selectPower(); else state.activeLayer = null;
    } else if (a.kind === "wireless") {
      if (state._wireless && state._wireless.pairs.length) this.selectWireless(); else state.activeLayer = null;
    } else if (a.kind === "circuit") {
      if (state._circuits && state._circuits.keys.size) this.selectCircuits(); else state.activeLayer = null;
    }
  }

  // Cables touching any of the given ports. Passing these to _applyHighlight
  // keeps the wires that lead to the layer's ports lit; without it EVERY wire
  // is dimmed to .05 and the schema reads as switched off. Same "at least one
  // end participates" rule as the console layer.
  _cablesForPorts(portKeys) {
    const cables = new Set();
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      if (terms.some(t => portKeys.has(termKey(t)))) cables.add(c.id);
    }
    return cables;
  }

  // VLAN selection → highlight
  selectVlan(vid) {
    const entry = state._vlanIndex && state._vlanIndex.get(vid);
    if (!entry) { this.clear(); return; }
    const cables = this._cablesForPorts(entry.portKeys);
    state.activeLayer = { kind: "vlan", id: vid, portKeys: entry.portKeys, cables };
    this._applyHighlight(entry.portKeys, cables);
    const v = entry.vlan;
    setStatus(`VLAN ${v.vid ?? ""} ${v.name || ""}: ${entry.portKeys.size} портов`, "ok");
    this._syncPanelState();
  }

  // Console layer selection → highlight console ports
  selectConsole() {
    const keys = state._consolePorts || new Set();
    if (!keys.size) { this.clear(); return; }
    const cables = state._consoleCables || new Set();
    state.activeLayer = { kind: "console", id: 0, portKeys: keys, cables };
    this._applyHighlight(keys, cables);
    setStatus(`Console-связи: ${cables.size} (портов: ${keys.size})`, "ok");
    this._syncPanelState();
  }

  // Power layer selection → highlight the power chain
  selectPower() {
    const power = state._power;
    if (!power || !power.keys.size) { this.clear(); return; }
    state.activeLayer = { kind: "power", id: 0, portKeys: power.keys, cables: power.cables };
    this._applyHighlight(power.keys, power.cables);
    const load = power.allocated ? `, нагрузка ${power.allocated} Вт` : "";
    setStatus(`Питание: ${power.cables.size} кабелей (портов: ${power.keys.size})${load}`, "ok");
    this._syncPanelState();
  }

  // Wireless layer selection → highlight interfaces + wavy lines
  selectWireless() {
    const w = state._wireless;
    if (!w || !w.pairs.length) { this.clear(); return; }
    state.activeLayer = { kind: "wireless", id: 0, portKeys: w.keys, pairs: w.pairs };
    this._applyHighlight(w.keys);
    // radio lines are drawn by the schema (a link has no cable → own geometry)
    if (this.app.schema) this.app.schema.drawRadioLinks();
    setStatus(`Wireless: ${w.pairs.length} радио-линков (интерфейсов: ${w.keys.size})`, "ok");
    this._syncPanelState();
  }

  // Circuits layer selection → highlight ports exiting to WAN
  selectCircuits() {
    const c = state._circuits;
    if (!c || !c.keys.size) { this.clear(); return; }
    state.activeLayer = { kind: "circuit", id: 0, portKeys: c.keys };
    this._applyHighlight(c.keys);
    // Circuits and Wireless share the network mode — selecting Circuits must
    // not hide radio lines. In network mode drawRadioLinks draws all radio
    // links regardless of the active layer.
    if (this.app.schema) this.app.schema.drawRadioLinks();
    setStatus(`Circuits: ${c.keys.size} выход${c.keys.size === 1 ? "" : "ов"} в WAN`, "ok");
    this._syncPanelState();
  }


  // Mark the active item and show/hide the "снять подсветку" button.
  _syncPanelState() {
    const host = $("#layers");
    if (!host) return;
    const a = state.activeLayer;
    host.querySelectorAll(".ly-item").forEach(btn =>
      btn.classList.toggle("active", !!a && btn.dataset.layer === a.kind && +btn.dataset.id === a.id));
    const clear = host.querySelector(".ly-clear");
    if (clear) clear.style.display = a ? "flex" : "none";
  }

  // Shared (reusable) port-highlight mechanism.
  // Dims all nodes/ports/wires, highlights the given ports and their nodes.
  // hlCables (Set of ids) — cables to highlight instead of dimming (for
  // layers where the wires are the point, e.g. console links).
  _applyHighlight(portKeys, hlCables) {
    const devIds = new Set();
    for (const [key, p] of Object.entries(state.ports)) {
      const on = portKeys.has(key);
      p.el.classList.toggle("layer-hl", on);
      p.el.classList.toggle("layer-dim", !on);
      if (on) devIds.add(p.dev.id);
    }
    Object.entries(state.nodeEls).forEach(([id, el]) => {
      el.classList.toggle("layer-hl", devIds.has(+id));
      el.classList.toggle("layer-dim", !devIds.has(+id));
    });
    document.querySelectorAll("#wires path.wire").forEach(w => {
      const keep = hlCables && hlCables.has(+w.dataset.cable);
      w.classList.toggle("layer-hl", !!keep);
      w.classList.toggle("layer-dim", !keep);
    });
    this._applyVlanBusHighlight();
    document.body.classList.add("layer-active");
    // Node/port highlight follows the layer TYPE color (power → orange etc.),
    // not always accent. CSS reads var(--layer-color).
    const kind = state.activeLayer && state.activeLayer.kind;
    let color = LayerManager.LAYER_COLOR[kind] || "var(--accent)";
    // A VLAN layer takes THAT VLAN's own colour instead of the generic accent, so
    // ring, whisker and bus rectangle are one colour for one VLAN. Accent here was
    // the reason a highlighted port read cyan while its bus read purple.
    if (kind === "vlan" && this.app.schema) {
      const e = this._collectVlans().get(state.activeLayer.id);
      if (e) color = this.app.schema._vlanColor(e.vlan);
    }
    document.body.style.setProperty("--layer-color", color);
  }

  // Re-apply active-layer classes to WIRES after the schema recreated them
  // (redrawWires clears the svg → wires lose layer-hl/layer-dim). Ports and
  // nodes are not recreated on zoom and keep their classes, so only paths
  // are touched. Otherwise zooming "reset" the layer selection (wires
  // stopped dimming). For wireless the wires are drawn by drawRadioLinks.
  reapplyToWires() {
    // VLAN bus lines are recreated by the same redraw and are keyed by VLAN, not
    // by cable — so they are re-marked even when no layer is active (the call
    // below is a no-op then, which is exactly the "nothing dimmed" state).
    this._applyVlanBusHighlight();
    const a = state.activeLayer;
    if (!a) return;
    const hlCables = a.cables;
    document.querySelectorAll("#wires path.wire").forEach(w => {
      const keep = hlCables && hlCables.has(+w.dataset.cable);
      w.classList.toggle("layer-hl", !!keep);
      w.classList.toggle("layer-dim", !keep);
    });
  }

  // Bus bars and bus lines carry data-vlan, so one pick dims the other VLANs the
  // same way picking a cable family dims the other wires. They live outside the
  // cable pass (bars are DOM nodes on the canvas, lines have their own class),
  // hence their own sweep rather than a branch inside _applyHighlight.
  _applyVlanBusHighlight() {
    const a = state.activeLayer;
    const id = a && a.kind === "vlan" ? a.id : null;
    document.querySelectorAll(".vbus, #wires path.vlanwhisk").forEach(el => {
      const mine = id != null && +el.dataset.vlan === id;
      el.classList.toggle("layer-hl", mine);
      el.classList.toggle("layer-dim", id != null && !mine);
    });
  }

  clear() {
    const wasWireless = state.activeLayer && state.activeLayer.kind === "wireless";
    state.activeLayer = null;
    Object.values(state.ports).forEach(p => p.el.classList.remove("layer-hl", "layer-dim"));
    Object.values(state.nodeEls).forEach(el => el.classList.remove("layer-hl", "layer-dim"));
    document.querySelectorAll("#wires path.wire").forEach(w => w.classList.remove("layer-dim", "layer-hl"));
    document.querySelectorAll(".vbus, #wires path.vlanwhisk").forEach(el => el.classList.remove("layer-dim", "layer-hl"));
    document.body.classList.remove("layer-active");
    document.body.style.removeProperty("--layer-color");
    // remove drawn radio lines (drawRadioLinks draws nothing itself when the
    // layer is not wireless — but stale paths must be cleared)
    if (wasWireless && this.app.schema) this.app.schema.drawRadioLinks();
    this._syncPanelState();
  }

  // Badge for the port tooltip, depends on port type:
  //  · interface → list of VLANs it carries;
  //  · power-port/outlet → load (W) and feeding port (for a PDU outlet).
  portBadge(otype, id) {
    if (otype === "dcim.powerport" || otype === "dcim.poweroutlet")
      return this._powerBadge(otype, id);
    if (otype !== "dcim.interface") return null;
    const p = state.ports[portKey(otype, id)];
    if (!p) return null;
    const it = p.item;
    const parts = [];
    const vids = [];
    if (it.untagged_vlan) vids.push(it.untagged_vlan.vid + " (untag)");
    for (const v of it.tagged_vlans || []) vids.push(String(v.vid));
    if (it.qinq_svlan) vids.push(it.qinq_svlan.vid + " (svlan)");
    if (vids.length) parts.push("VLAN: " + vids.join(", "));
    // radio link on this interface (by port key)
    const key = portKey(otype, id);
    const wl = (state._wireless?.pairs || []).find(pr => pr.a === key || pr.b === key);
    if (wl) parts.push("Wireless" + (wl.ssid ? ": " + wl.ssid : ""));
    // circuit exit to WAN on this port
    const circ = state._circuits?.byPort?.get(key);
    if (circ) {
      const c = circ.circuit;
      const cid = c ? (c.cid || c.display || "") : "";
      const prov = c && c.provider ? (c.provider.name || c.provider.display || "") : "";
      parts.push("Circuit → WAN" + (cid ? ": " + cid : "") + (prov ? " (" + prov + ")" : ""));
    }
    return parts.length ? parts.join(" · ") : null;
  }

  // Power badge: draw for a power-port, feeding port for a PDU outlet.
  _powerBadge(otype, id) {
    const p = state.ports[portKey(otype, id)];
    if (!p) return null;
    const it = p.item;
    const parts = [];
    if (otype === "dcim.powerport") {
      if (it.allocated_draw) parts.push(it.allocated_draw + " Вт");
      if (it.maximum_draw) parts.push("макс " + it.maximum_draw + " Вт");
    } else if (otype === "dcim.poweroutlet" && it.power_port) {
      parts.push("питание от " + (it.power_port.display || it.power_port.name || "?"));
    }
    return parts.length ? "Питание: " + parts.join(", ") : null;
  }
}
