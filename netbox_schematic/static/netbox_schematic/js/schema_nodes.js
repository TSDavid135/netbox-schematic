"use strict";
// Node and port layout — mixin for the SchemaManager prototype (split from schema.js).
// Methods copied into SchemaManager.prototype via _mixin (see schema.js).
import {
  $, state, mk, px, attachTip, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox } from "./schema_util.js";
import { iconForDevice } from "./solutions.js";

class _Mixin {
  // Node name with the stack-member suffix visually separated: "SW 6002-4" →
  // "SW 6002" + a muted "-4" (the part that differs between members of one
  // stack). Only for stacked devices; the trailing "-N" / "/N" is the member.
  _stackName(dev) {
    if (!dev.virtual_chassis) return dev.name;
    const m = String(dev.name).match(/^(.*\S)\s*([-/]\s*\d+)\s*$/);
    if (!m) return dev.name;
    return `${m[1]}<span class="nm-vc">${m[2].replace(/\s+/g, "")}</span>`;
  }
  // Stack badge in the node's LEFT-center (mirror of the edit pencil): the
  // member's vc_position + a stack icon, in the --stack color. Click ≠ a port:
  // it highlights all stack members and opens the stack passport (showStack).
  _placeStackBadge(node, dev) {
    const vc = dev.virtual_chassis;
    const master = vc.master === dev.id ? " · мастер" : "";
    const badge = mk("div", { className: "stack-badge",
      title: `Стек «${vc.name}» · позиция ${dev.vc_position ?? "?"}${master}`,
      html: `<i class="mdi mdi-layers-triple"></i><b>${dev.vc_position ?? "•"}</b>` });
    badge.addEventListener("click", ev => {
      ev.stopPropagation();
      this._highlightStack(vc.id);
      this.app.device.showStack(vc, dev);
    });
    node.appendChild(badge);
  }
  // Outline every on-screen node of the given stack (null clears) and dim the
  // rest of the canvas (#schema.stack-focus) so the stack stands out.
  _highlightStack(vcId) {
    const schema = document.getElementById("schema");
    if (schema) schema.classList.toggle("stack-focus", !!vcId);
    for (const [id, node] of Object.entries(state.nodeEls)) {
      const dev = state.devices.find(d => d.id === +id);
      const on = !!(vcId && dev && dev.virtual_chassis && dev.virtual_chassis.id === vcId);
      node.classList.toggle("stack-hl", on);
    }
  }

  // port sides
  _crossRackKinds(dev) {
    const kinds = new Set();
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      const mine = terms.filter(t => t.object && t.object.device && t.object.device.id === dev.id);
      const other = terms.filter(t => t.object && t.object.device && t.object.device.id !== dev.id);
      if (!mine.length || !other.length) continue;
      const otherRack = state.devRack[other[0].object.device.id];
      if (otherRack !== undefined && otherRack !== state.devRack[dev.id])
        mine.forEach(t => kinds.add(t.object_type));
    }
    return kinds;
  }
  _assignSides(dev, groups) {
    const cross = this._crossRackKinds(dev);
    const trunkUp = state.devNodeIdx[dev.id] === 0;
    // Front and rear are two sides of ONE panel: always on opposite node edges
    // (port N under port N). The "trunk" side (to the shared bus) is the one
    // that actually leaves to another rack; if neither does (unconnected panel)
    // trunk defaults to rear. Without this, an empty cross put both front and
    // rear on the same side, in one row (bug: unconnected front/rear lined up
    // on one side).
    const trunkType = cross.has("dcim.frontport") && !cross.has("dcim.rearport")
      ? "dcim.frontport" : "dcim.rearport";
    // A racked patch panel is fixed: REAR up (toward the sockets / the wall),
    // FRONT down (toward the switches below it in the rack) — the trunk heuristic
    // otherwise flips it per node index, so two panels faced opposite ways.
    const kinds = new Set(groups.map(g => g.kind.otype));
    const panelDown = !dev._off && kinds.has("dcim.frontport") && kinds.has("dcim.rearport");
    const top = [], bottom = [];
    for (const g of groups) {
      const o = g.kind.otype;
      let up;
      if (o === "dcim.frontport" || o === "dcim.rearport")
        up = panelDown ? (o === "dcim.rearport") : ((o === trunkType) === trunkUp);
      else if (o === "dcim.interface") up = true;
      else if (o === "dcim.poweroutlet") up = true;
      else up = false;   // power (power-port) and console — down
      (up ? top : bottom).push(g);
    }
    return { top, bottom };
  }

  _computePads(pane) {
    this.LEFT_PAD = Math.max(80, Math.round(pane.clientWidth * 0.45));
    this.TOP_PAD = Math.max(150, Math.round(pane.clientHeight * 0.4));
  }

  // Layout of ONE node: ports + width for the current mode.
  // Ports anchor to the label corner: left groups (front/interfaces/console)
  // run left→right, power right→left. Rear reuses the top's left anchor → bottom
  // port N sits under top port N. Width follows visible ports (min size). Net
  // view: top = wired (Circuits), bottom = radio (Wireless). Reused on mode/edit
  // change (redraw without full renderAll — see relayoutNodes).
  // Pure calc (sides, visible groups, width), no DOM. Needed TWICE: render()'s
  // pre-pass sizes the column slot (SLOT) for the widest node; _layoutNode places ports.
  _nodeParts(dev, groups, netArg, editArg) {
    // Off-rack — wider (icon + name + IP/"+ address" don't collide); in-rack —
    // the old min width.
    const MIN_W = dev._off ? 220 : 170, EDGE = (STEP - DOT) / 2 + 4;
    // netArg/editArg — mode overrides (for the SLOT pre-pass, so slot width
    // doesn't depend on the current view mode); else use the globals.
    const net = netArg !== undefined ? netArg : state.viewMode === "net";
    const edit = editArg !== undefined ? editArg : Mode.on("schema");
    const { top, bottom } = this._assignSides(dev, groups);
    const isPowerKind = k => k.otype === "dcim.powerport" || k.otype === "dcim.poweroutlet";
    const isConsoleKind = k => k.otype === "dcim.consoleport" || k.otype === "dcim.consoleserverport";
    // Port visibility in the current mode: net → net ports only, phys → physical only.
    const visItems = g => g.items.filter(it => this._isNetPort(g.kind.otype, it) === net);
    const visGroups = rows => rows.map(g => ({ g, items: visItems(g) })).filter(x => x.items.length);

    let topV, botLeftV, botRightV;
    if (net) {
      // Wireless view — radio interfaces ONLY (ieee802.11* / other-wireless /
      // with wireless_link) in the bottom row + a green "+" to create. Wired
      // circuit uplinks (cloud) moved to the Physical view (see _isNetPort).
      const ifaceGroups = groups.filter(g => g.kind.otype === "dcim.interface");
      const pick = pred => ifaceGroups
        .map(g => ({ g, items: g.items.filter(pred) }))
        .filter(x => x.items.length);
      topV = [];
      botLeftV = pick(it => this._isWirelessItem(it)); // radio → bottom
      botRightV = [];
    } else {
      topV = visGroups(top);
      // Bottom-left: trunk (front/rear) FIRST — under front, then POWER.
      // Bottom-right: CONSOLE. (was the reverse before — power on the right.)
      const bottomLeft = [
        ...bottom.filter(g => !isPowerKind(g.kind) && !isConsoleKind(g.kind)),
        ...bottom.filter(g => isPowerKind(g.kind)),
      ];
      botLeftV = visGroups(bottomLeft);
      botRightV = visGroups(bottom.filter(g => isConsoleKind(g.kind)));
    }
    const nTop = topV.reduce((n, x) => n + x.items.length, 0);
    const nBotL = botLeftV.reduce((n, x) => n + x.items.length, 0);
    const nBotR = botRightV.reduce((n, x) => n + x.items.length, 0);
    // Width: max(min, top row, bottom clusters with gap). In net view + edit,
    // reserve a slot for the green "+" (create wireless interface).
    const addWl = net && edit ? 1 : 0;
    const GAP_MID = (nBotL + addWl) && nBotR ? STEP : 0;
    const topNeed = nTop ? EDGE * 2 + nTop * STEP : 0;
    const botNeed = (nBotL + addWl + nBotR) ? EDGE * 2 + (nBotL + addWl + nBotR) * STEP + GAP_MID : 0;
    const width = Math.max(MIN_W, topNeed, botNeed);
    return { net, edit, EDGE, top, topV, botLeftV, botRightV, nBotL, nBotR, width };
  }

  // Layout of ONE node: ports + width for the current mode.
  _layoutNode(dev, node) {
    const P = this._nodeParts(dev, node._groups || []);
    const { net, edit, EDGE, top, topV, botLeftV, botRightV, nBotL, nBotR, width } = P;
    node.style.width = width + "px";
    // Off-rack — fixed position (set during contour packing); NOT centered in
    // the slot, else a relayout (mode change) would drift the node out of its
    // contour. In-rack — centered in the column slot (SLOT = widest node's width,
    // shared by all columns), so wide nodes don't spill into neighbors.
    // In a trace (single) DON'T touch position — showSingleDevice/_placeChainNode
    // set it; else an edit-mode relayout would snap nodes to _fixedLeft (=0).
    if (!state.single) {
      if (dev._off)
        node.style.left = (node._fixedLeft != null ? node._fixedLeft : node._x0) + "px";
      else
        node.style.left = (node._x0 + (this.SLOT - BOX_PAD - width) / 2) + "px";
    }

    // Rebuild contents: name/model + labels + ports. Off-rack — a compact card
    // with the solution ICON on the left, no "· U…" (no unit), and the first
    // interface's IP by the name; no IP → a "+ address" button (q1).
    if (dev._off) {
      let firstIface = null, firstIp = null;
      for (const g of (node._groups || [])) {
        if (g.kind.otype !== "dcim.interface") continue;
        for (const it of g.items) {
          if (!firstIface) firstIface = it;
          const ips = (state.ipsByIface && state.ipsByIface[it.id]) || [];
          if (ips.length) { firstIp = ips[0].address; break; }
        }
        if (firstIp) break;
      }
      const addr = firstIp ? `<span class="node-ip">${firstIp}</span>`
        : (firstIface && edit ? `<button class="node-addip" title="Назначить IP">+ адрес</button>` : "");
      node.innerHTML = `<i class="mdi ${iconForDevice(dev)} node-ic"></i>` +
        `<span class="node-tt"><span class="node-nmrow"><span class="nm">${this._stackName(dev)}</span>${addr}</span>` +
        `<span class="mdl">${dev.device_type.model}</span></span>`;
      const addBtn = node.querySelector(".node-addip");
      if (addBtn && this.app.ipform && firstIface)
        addBtn.addEventListener("click", ev => { ev.stopPropagation(); this.app.ipform.open(dev, firstIface, ev); });
    } else {
      node.innerHTML = `<span class="nm">${this._stackName(dev)}</span><span class="mdl">${dev.device_type.model} · U${dev.position}</span>`;
    }
    node.querySelector(".nm").addEventListener("click", () => this.app.device.show(dev));
    // Stack badge (VirtualChassis member) — click highlights members + opens the
    // stack passport. Placed on every stacked node, off-rack or in-rack.
    if (dev.virtual_chassis) this._placeStackBadge(node, dev);

    // Group labels. Wireless view — only the bottom "Wireless" (radio).
    // Physical view: top — port types, bottom — console/power.
    if (net) {
      if (botLeftV.length || edit) node.insertAdjacentHTML("beforeend",
        `<span class="edge-label b">Wireless</span>`);
    } else {
      if (topV.length) node.insertAdjacentHTML("beforeend",
        `<span class="edge-label t">${top.map(g => g.kind.label).join(" · ")}</span>`);
      if (botLeftV.length) node.insertAdjacentHTML("beforeend",
        `<span class="edge-label b">${botLeftV.map(x => x.g.kind.label).join(" · ")}</span>`);
      if (botRightV.length) node.insertAdjacentHTML("beforeend",
        `<span class="edge-label b r">${botRightV.map(x => x.g.kind.label).join(" · ")}</span>`);
    }

    // Top row + bottom-left: from the LEFT edge rightward (port N under port N).
    let i = 0;
    for (const { g, items } of topV)
      for (const item of items)
        this._placeDot(node, dev, g, item, i + 1, true, EDGE + (i++) * STEP);
    let l = 0;
    for (const { g, items } of botLeftV)
      for (const item of items)
        this._placeDot(node, dev, g, item, l + 1, false, EDGE + (l++) * STEP);
    // Bottom-right (power): from the RIGHT edge leftward.
    let j = 0;
    for (const { g, items } of botRightV)
      for (const item of items) {
        const fromRight = nBotR - j;
        this._placeDot(node, dev, g, item, j + 1, false, width - EDGE - DOT - (fromRight - 1) * STEP);
        j++;
      }
    // Green "+" in the Wireless row (net view + edit): create a REAL wireless
    // interface. A logical (radio) port, added freely — unlike physical sockets
    // (see discussion). Present on EVERY node.
    if (net && edit) this._placeAddWireless(node, dev, EDGE + nBotL * STEP);
    // In edit mode — a pencil centered on the node's RIGHT edge: the full device
    // edit modal (all default NetBox fields).
    if (edit) {
      const pen = mk("div", { className: "node-edit", title: "Изменить устройство",
        html: `<i class="mdi mdi-pencil"></i>` });
      pen.addEventListener("click", ev => { ev.stopPropagation(); this.app.device.editDevice(dev); });
      node.appendChild(pen);
    }
  }

  // Green "+" to create a wireless interface. Placed in the Wireless row after
  // the last radio port (or at the start if there are none).
  _placeAddWireless(node, dev, leftPx) {
    const dot = mk("div", { className: "port addport", text: "+",
      title: "Добавить wireless-интерфейс",
      style: { left: leftPx + "px", bottom: "-13px" } });
    dot.addEventListener("click", ev => { ev.stopPropagation(); this._addWireless(dev); });
    node.appendChild(dot);
  }
  async _addWireless(dev) {
    try {
      const g = (state._devPorts[dev.id] || []).find(x => x.kind.otype === "dcim.interface");
      const wl = g ? g.items.filter(it => this._isWirelessItem(it)) : [];
      let max = 0;
      for (const it of wl) { const m = (it.name || "").match(/(\d+)\s*$/); if (m) max = Math.max(max, +m[1]); }
      const name = "wlan" + (wl.length ? max + 1 : 0);   // wlan0, wlan1, …
      await api("/dcim/interfaces/", "POST", { device: dev.id, name, type: "ieee802.11ac" });
      setStatus("создан wireless-интерфейс " + name + " на " + dev.name, "ok");
      await this.app.renderAll(state.group);
    } catch (e) { setStatus("не удалось создать wireless: " + e.message, "err"); }
  }

  // Place one port-dot in the node. leftPx — left coordinate of the cell.
  _placeDot(node, dev, g, item, ordinal, isTop, leftPx) {
    const dot = document.createElement("div");
    const net = state.viewMode === "net";
    const edit = Mode.on("schema");
    const isNet = this._isNetPort(g.kind.otype, item);
    const isCircuit = g.kind.otype === "dcim.interface" && this._isCircuitItem(item);
    const isWl = g.kind.otype === "dcim.interface" && this._isWirelessItem(item);
    // "Busy" = has a cable OR radio-link OR circuit uplink. Wireless has no
    // cable (radio) but the port is busy via the link → filled like any busy one.
    const used = !!item.cable || !!item.wireless_link || isCircuit;
    // Rendering in NET view: circuit/wireless — bright; free in edit — green
    // (assignable); the rest (physically busy, non-net) — dimmed.
    const assignable = net && edit && !used;
    const netDim = net && !isNet && !assignable;
    dot.className = "port " + g.kind.cls + (used ? " used" : "")
      + (isNet ? " p-net" : " p-phys")
      + (isCircuit ? " has-circuit" : "") + (isWl ? " p-wl" : "")
      + (assignable ? " assignable" : "") + (netDim ? " net-dim" : "");
    dot.dataset.net = isNet ? "1" : "0";
    dot.textContent = shortPortName(item.name, ordinal);
    dot.style.left = leftPx + "px";
    dot.style[isTop ? "top" : "bottom"] = "-13px";
    // "WAN uplink" cloud over the circuit port removed: a provider can now be
    // added to the schema as its own device, so the cloud label is gone.
    const showTip = attachTip(dot, () => this._portTip(dev, g.kind, item));
    dot.addEventListener("mouseenter", () => this._portHover(state.ports[portKey(g.kind.otype, item.id)], true));
    dot.addEventListener("mouseleave", () => this._portHover(state.ports[portKey(g.kind.otype, item.id)], false));
    dot.addEventListener("click", ev => {
      ev.stopPropagation();
      // Touch: a repeat tap on the port re-opens the tooltip (mouseenter won't
      // re-fire on the same element after it was dismissed).
      if (matchMedia("(pointer: coarse)").matches || innerWidth <= 760) showTip(ev);
      this._onPortClick(g.kind, item, dev, dot, ev);
    });
    dot.addEventListener("dblclick", ev => { ev.stopPropagation(); ev.preventDefault(); this._onPortDblClick(g.kind, item); });
    node.appendChild(dot);
    state.ports[portKey(g.kind.otype, item.id)] =
      { el: dot, item, dev, otype: g.kind.otype, ep: g.kind.ep, side: isTop ? "t" : "b" };
  }

  // Relayout of ALL nodes (view-mode / build-mode change). Ports are recreated
  // → state.ports and wires must be refreshed.
  relayoutNodes() {
    for (const [id, node] of Object.entries(state.nodeEls)) {
      const dev = state.devices.find(d => d.id === +id);
      if (dev && node._groups) this._layoutNode(dev, node);
    }
    this.redrawWires();
  }

}
export const NodeMethods = _Mixin.prototype;
