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
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox, parseTypeSides } from "./schema_util.js";
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
    // Badge shows the stack SIZE (member count) — same number on every node of the
    // stack — counted from all loaded devices sharing this virtual chassis.
    const size = (state.allDevices || state.devices || [])
      .filter(d => d.virtual_chassis && d.virtual_chassis.id === vc.id).length || 1;
    const badge = mk("div", { className: "stack-badge",
      title: `Стек «${vc.name}» · участников: ${size} · позиция ${dev.vc_position ?? "?"}${master}`,
      html: `<i class="mdi mdi-layers-triple"></i><b>${size}</b>` });
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
    // Per-type side overrides (catalog «Сторона» per port row): dev._sides —
    // live editor preview; else the type's comments marker. Front/rear keep
    // their paired panel logic (an override would break "port N under port N").
    const sides = this._typeSides(dev);
    const ovr = (key, def) =>
      sides[key] === "top" ? true : sides[key] === "bottom" ? false : def;
    const top = [], bottom = [];
    for (const g of groups) {
      const o = g.kind.otype;
      let up;
      if (o === "dcim.frontport" || o === "dcim.rearport")
        up = panelDown ? (o === "dcim.rearport") : ((o === trunkType) === trunkUp);
      else if (o === "dcim.interface") up = ovr("interface", true);
      else if (o === "dcim.poweroutlet") up = ovr("outlet", true);
      else if (o === "dcim.powerport") up = ovr("power", false);
      else if (o === "dcim.consoleport") up = ovr("console", false);
      else if (o === "dcim.consoleserverport") up = ovr("console-server", false);
      else up = false;
      (up ? top : bottom).push(g);
    }
    return { top, bottom };
  }
  // Side-override map for a device: preview override (dev._sides, set by the
  // catalog editor) or the DeviceType's comments marker (cached per type).
  _typeSides(dev) {
    if (dev._sides) return dev._sides;
    const dtId = dev.device_type && dev.device_type.id;
    const t = dtId != null ? (state.dtypes || {})[dtId] : null;
    if (!t) return {};
    if (!t._sides) t._sides = parseTypeSides(t.comments);
    return t._sides;
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
    const addWl = net && edit ? 1 : 0;   // green "+" slot (create wireless) in net+edit

    // Port placement → `slots` {g,item,ordinal,isTop,leftPx}, so schema and catalog
    // place ports identically. Default (no front/rear pair): top & bottom-left from
    // the LEFT edge, console from the RIGHT — the long-standing layout, unchanged.
    // When a front/rear TRUNK coexists with interfaces/power, the trunk anchors LEFT
    // and interfaces (top) + power (bottom) are CENTERED in the middle, console stays
    // bottom-right (user request; purely visual — data untouched).
    const isFR = o => o === "dcim.frontport" || o === "dcim.rearport";
    const cnt = arr => arr.reduce((n, x) => n + x.items.length, 0);
    const trunkTop = topV.filter(x => isFR(x.g.kind.otype)), midTop = topV.filter(x => !isFR(x.g.kind.otype));
    const trunkBot = botLeftV.filter(x => isFR(x.g.kind.otype)), midBot = botLeftV.filter(x => !isFR(x.g.kind.otype));
    const nTrunk = Math.max(cnt(trunkTop), cnt(trunkBot)), nMidTop = cnt(midTop), nMidBot = cnt(midBot);
    const centered = !net && nTrunk > 0 && (nMidTop + nMidBot) > 0;

    const slots = [];
    const push = (g, item, ordinal, isTop, leftPx) => slots.push({ g, item, ordinal, isTop, leftPx });
    // ВВОДЫ (power-port) and РОЗЕТКИ (power-outlet) standing in ONE row get an
    // extra STEP between the clusters, so a PDU's input doesn't blend into its
    // outlet strip. runPx — strip width incl. those gaps; runL — left→right
    // pusher inserting them (ordinal stays continuous per run, as before).
    const pwBoundary = (a, b) => (a === "dcim.powerport" && b === "dcim.poweroutlet") ||
      (a === "dcim.poweroutlet" && b === "dcim.powerport");
    const runPx = arr => {
      let w = 0, prev = null;
      for (const { g, items } of arr) {
        if (!items.length) continue;
        if (prev && pwBoundary(prev, g.kind.otype)) w += STEP;
        w += items.length * STEP; prev = g.kind.otype;
      }
      return w;
    };
    const runL = (arr, isTop, x0) => {
      let x = x0, ord = 0, prev = null;
      for (const { g, items } of arr) {
        if (!items.length) continue;
        if (prev && pwBoundary(prev, g.kind.otype)) x += STEP;
        for (const it of items) { push(g, it, ++ord, isTop, x); x += STEP; }
        prev = g.kind.otype;
      }
    };
    let width;
    if (centered) {
      const GAP = STEP, midPx = Math.max(runPx(midTop), runPx(midBot));
      // Width fits: trunk (left) + mid + console (right) with gaps; mid is CENTRED
      // between the trunk and the console, console sits at the bottom-RIGHT edge.
      width = Math.max(MIN_W, EDGE * 2 + nTrunk * STEP + (nTrunk && (midPx || nBotR) ? GAP : 0)
        + midPx + (midPx && nBotR ? GAP : 0) + nBotR * STEP);
      let i = 0; for (const { g, items } of trunkTop) for (const it of items) push(g, it, i + 1, true, EDGE + (i++) * STEP);
      let f = 0; for (const { g, items } of trunkBot) for (const it of items) push(g, it, f + 1, false, EDGE + (f++) * STEP);
      let c = 0; for (const { g, items } of botRightV) for (const it of items) { push(g, it, c + 1, false, width - EDGE - DOT - (nBotR - c - 1) * STEP); c++; }
      const trunkEnd = EDGE + nTrunk * STEP + (nTrunk ? GAP : 0);
      const consoleLeft = nBotR ? width - EDGE - DOT - (nBotR - 1) * STEP - GAP : width - EDGE;
      const midMid = (trunkEnd + consoleLeft) / 2;
      runL(midTop, true, midMid - runPx(midTop) / 2);
      runL(midBot, false, midMid - runPx(midBot) / 2);
    } else {
      const GAP_MID = (nBotL + addWl) && nBotR ? STEP : 0;
      const topNeed = nTop ? EDGE * 2 + runPx(topV) : 0;
      const botNeed = (nBotL + addWl + nBotR)
        ? EDGE * 2 + runPx(botLeftV) + addWl * STEP + nBotR * STEP + GAP_MID : 0;
      width = Math.max(MIN_W, topNeed, botNeed);
      runL(topV, true, EDGE);
      runL(botLeftV, false, EDGE);
      let j = 0; for (const { g, items } of botRightV) for (const it of items) { push(g, it, j + 1, false, width - EDGE - DOT - (nBotR - j - 1) * STEP); j++; }
    }
    return { net, edit, EDGE, top, topV, botLeftV, botRightV, nBotL, nBotR, width, slots };
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
      // No unit tag on the node (the unit lives in the details panel / rack view).
      node.innerHTML = `<span class="nm">${this._stackName(dev)}</span><span class="mdl">${dev.device_type.model}</span>`;
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

    // Ports — positions precomputed in _nodeParts (shared by schema & catalog, so a
    // front/rear node centres its interfaces/power identically in both places).
    for (const s of P.slots) this._placeDot(node, dev, s.g, s.item, s.ordinal, s.isTop, s.leftPx);
    // Green "+" in the Wireless row (net view + edit): create a REAL wireless
    // interface. A logical (radio) port, added freely — unlike physical sockets
    // (see discussion). Present on EVERY node.
    if (net && edit) this._placeAddWireless(node, dev, EDGE + nBotL * STEP);
    // In edit mode — a pencil centered on the node's RIGHT edge: the full device
    // edit modal (all default NetBox fields).
    if (edit) {
      const kebab = mk("div", { className: "node-edit", title: "Действия с устройством",
        html: `<i class="mdi mdi-dots-vertical"></i>` });
      kebab.addEventListener("click", ev => { ev.stopPropagation(); this._openNodeMenu(dev, kebab); });
      node.appendChild(kebab);
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

  // Kebab (⋮) on a node in edit mode → dropdown of actions. «Изменить» opens the full
  // edit modal; «Модель»/«Порты» will enter on-canvas modes (WIP — see node_model_edit.md).
  _openNodeMenu(dev, anchor) {
    this._closeNodeMenu();
    const menu = mk("div", { className: "node-menu" });
    const item = (icon, label, fn) => {
      const el = mk("div", { className: "nm-item", html: `<i class="mdi ${icon}"></i><span>${label}</span>` });
      el.addEventListener("click", e => { e.stopPropagation(); this._closeNodeMenu(); fn(); });
      menu.appendChild(el);
    };
    item("mdi-swap-horizontal", "Порты", () => this._startPortShift(dev));
    item("mdi-pencil-outline", "Модель", () => this._startModelChange(dev));
    item("mdi-pencil", "Изменить", () => this.app.device.editDevice(dev));
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
    // Open UP when the button sits below the screen's vertical middle, else DOWN —
    // so the dropdown never runs off the bottom edge.
    const openUp = r.top + r.height / 2 > innerHeight / 2;
    menu.style.top = (openUp ? r.top - menu.offsetHeight - 4 : r.bottom + 4) + "px";
    this._nodeMenu = menu;
    this._closeNodeMenuBound = e => { if (!menu.contains(e.target)) this._closeNodeMenu(); };
    setTimeout(() => document.addEventListener("mousedown", this._closeNodeMenuBound), 0);
  }
  _closeNodeMenu() {
    if (this._nodeMenu) { this._nodeMenu.remove(); this._nodeMenu = null; }
    if (this._closeNodeMenuBound) { document.removeEventListener("mousedown", this._closeNodeMenuBound); this._closeNodeMenuBound = null; }
  }
  // «Модель» — смена device_type устройства на схеме (Фаза B v1). Открываем
  // одиночный вид (нода + усики, затемнение — переиспускаем showSingleDevice),
  // сверху панель: ✗ / выбор модели / ✓. ✓ → PATCH device_type + grow портов новой
  // модели (только добавление); ✗/✓ возвращают в область. Живое превью — следующим.
  async _startModelChange(dev) {
    if (this._modelMode) return;
    const node = state.nodeEls[dev.id];
    if (!node) { setStatus("нода не на схеме", "err"); return; }
    setStatus("загружаю модели…");
    let types = [];
    try { types = await apiAll("/dcim/device-types/"); } catch (_) {}
    types.sort((a, b) => (((a.manufacturer || {}).name || "") + (a.model || ""))
      .localeCompare(((b.manufacturer || {}).name || "") + (b.model || "")));
    setStatus("");
    // Overlay on the CURRENT view (NO navigation): dim everything, this node's cables
    // → whiskers, model window on top. Exit only via ✓/✗ (restores the view).
    const schema = document.getElementById("schema");
    if (schema) schema.classList.add("node-focus");
    node.classList.add("focus-node");
    this._drawNodeWhiskers(dev.id);
    const curId = dev.device_type && dev.device_type.id;
    const bar = mk("div", { className: "model-bar" });
    const cancel = mk("button", { className: "mb-btn mb-cancel", title: "Отмена (Esc)", html: `<i class="mdi mdi-close"></i>` });
    const lbl = mk("span", { className: "mb-lbl", html: `<i class="mdi mdi-pencil-outline"></i> Модель` });
    const sel = mk("select", { className: "mb-sel" });
    for (const t of types) {
      const o = document.createElement("option"); o.value = t.id;
      o.textContent = ((t.manufacturer || {}).name ? t.manufacturer.name + " · " : "") + (t.display || t.model);
      if (t.id === curId) o.selected = true; sel.appendChild(o);
    }
    const ok = mk("button", { className: "mb-btn mb-ok", title: "Применить", html: `<i class="mdi mdi-check"></i>` });
    bar.append(cancel, lbl, sel, ok);
    document.body.appendChild(bar);
    this._modelMode = { dev, node, chosen: curId, bar, origGroups: node._groups };
    this._positionModelBar();
    this._modelScroll = () => this._positionModelBar();
    const pane = $("#schempane"); if (pane) pane.addEventListener("scroll", this._modelScroll);
    window.addEventListener("resize", this._modelScroll);
    sel.addEventListener("change", () => this._previewModel(+sel.value));
    cancel.addEventListener("click", () => this._exitModelChange(false));
    ok.addEventListener("click", () => this._exitModelChange(true));
    this._modelEsc = e => { if (e.key === "Escape") this._exitModelChange(false); };
    document.addEventListener("keydown", this._modelEsc);
  }
  async _exitModelChange(apply) {
    const m = this._modelMode; if (!m) return;
    this._modelMode = null;
    if (m.bar) m.bar.remove();
    if (this._modelEsc) { document.removeEventListener("keydown", this._modelEsc); this._modelEsc = null; }
    if (this._modelScroll) { const pane = $("#schempane"); if (pane) pane.removeEventListener("scroll", this._modelScroll); window.removeEventListener("resize", this._modelScroll); this._modelScroll = null; }
    const schema = document.getElementById("schema");
    if (schema) schema.classList.remove("node-focus");
    if (m.node) m.node.classList.remove("focus-node");
    const curId = m.dev.device_type && m.dev.device_type.id;
    if (apply && m.chosen && m.chosen !== curId) {
      try {
        setStatus("меняю модель…");
        await api("/dcim/devices/" + m.dev.id + "/", "PATCH", { device_type: m.chosen });
        const r = await this.app.device.applyModel(m.dev.id, m.chosen);
        const w = r.warnings || [];
        const wtail = w.length ? ` · ⚠ тип не менял (порт занят): ${w.map(x => `${x.port} ${x.from || "?"}→${x.to}`).join(", ")}` : "";
        setStatus(`модель изменена: +${r.added} / −${r.removed} портов${wtail}`, w.length ? "err" : "ok");
      } catch (e) { setStatus("не удалось сменить модель: " + e.message, "err"); }
      await this.app.tree.reload();   // ports changed → re-render the area
      return;
    }
    if (m.node && m.origGroups) { m.node._groups = m.origGroups; this._layoutNode(m.dev, m.node); }
    this.redrawWires();   // cancel → restore node + wires, keep the area view
  }
  // Where the model / port-shift action bar floats. On a phone/tablet it sits around
  // the MIDDLE of the screen (a floating panel, not over the schema — the node is
  // dimmed behind it). On desktop it sits just ABOVE the node (below if there's no
  // room up top), following the node as usual.
  _positionBarAboveNode(bar, node) {
    if (!bar) return;
    const bw = bar.offsetWidth || 300, bh = bar.offsetHeight || 40;
    const touch = matchMedia("(pointer: coarse)").matches || innerWidth <= 1024;
    if (touch || !node) {
      bar.style.left = Math.max(8, (innerWidth - bw) / 2) + "px";
      bar.style.top = Math.max(8, innerHeight * 0.5 - bh / 2) + "px";
      return;
    }
    const nb = node.getBoundingClientRect();
    const left = Math.min(Math.max(8, nb.left + nb.width / 2 - bw / 2), innerWidth - bw - 8);
    let top = nb.top - bh - 52;                       // above the node…
    if (top < 8) top = Math.min(nb.bottom + 52, innerHeight - bh - 8);   // …or below if no room
    bar.style.left = left + "px"; bar.style.top = top + "px";
  }
  _positionModelBar() { const m = this._modelMode; if (m) this._positionBarAboveNode(m.bar, m.node); }
  _positionPortShiftBar() { const m = this._portShift; if (m) this._positionBarAboveNode(m.bar, m.node); }
  // Live preview: re-render the node with the picked model's ports, keeping OCCUPIED
  // ports in their slot BY NUMBER (extras beyond the model stay visible). No DB writes.
  async _previewModel(dtId) {
    const m = this._modelMode; if (!m) return;
    m.chosen = dtId;
    let modelGroups = [];
    try { modelGroups = await this.app.catalog.typeToGroups(dtId); } catch (_) {}
    if (this._modelMode !== m) return;
    const cur = state._devPorts[m.dev.id] || m.node._groups || [];
    m.node._groups = this._mergeModelGroups(modelGroups, cur);
    const type = (m.types || []).find(t => t.id === dtId) || m.dev.device_type;
    this._layoutNode({ ...m.dev, device_type: type }, m.node);
    this._drawNodeWhiskers(m.dev.id);
    this._positionModelBar();
  }
  // model templates + device OCCUPIED ports → merged groups (occupied wins its number;
  // occupied ports numbered beyond the model are appended so they stay visible).
  _mergeModelGroups(modelGroups, curGroups) {
    const _pn = name => { const x = String(name || "").match(/(\d+)(?!.*\d)/); return x ? x[1] : null; };
    const busy = it => !!(it.cable || it.wireless_link);
    const occ = {};
    for (const g of curGroups) for (const it of g.items) if (busy(it)) (occ[g.kind.otype] = occ[g.kind.otype] || []).push(it);
    const used = new Set(), out = [];
    for (const g of modelGroups) {
      const byNum = {};
      for (const it of (occ[g.kind.otype] || [])) { const nn = _pn(it.name); if (nn != null && !(nn in byNum)) byNum[nn] = it; }
      out.push({ kind: g.kind, items: g.items.map(it => {
        const nn = _pn(it.name);
        if (nn != null && byNum[nn]) { used.add(byNum[nn]); return byNum[nn]; }
        return it;
      }) });
    }
    const outBy = {}; for (const g of out) outBy[g.kind.otype] = g;
    for (const [otype, items] of Object.entries(occ)) {
      const extra = items.filter(it => !used.has(it));
      if (!extra.length) continue;
      if (outBy[otype]) outBy[otype].items = outBy[otype].items.concat(extra);
      else { const orig = curGroups.find(x => x.kind.otype === otype); if (orig) out.push({ kind: orig.kind, items: extra }); }
    }
    out.sort((a, b) => PORT_KINDS.indexOf(a.kind) - PORT_KINDS.indexOf(b.kind));
    return out;
  }
  // «Порты» (Фаза D) — сдвиг номеров СВОБОДНЫХ портов по категориям. Тот же оверлей
  // (затемнение + усики), панель над нодой: ✗ + ⟨N⟩ на категорию. ⟩ = +N, ⟨ = −N к
  // свободным (N = число портов категории в модели); занятые остаются, свободный-дубль
  // занятого отбрасывается. Каждый клик применяется сразу (у свободных нет кабелей).
  async _startPortShift(dev) {
    if (this._portShift || this._modelMode) return;
    const node = state.nodeEls[dev.id];
    if (!node) { setStatus("нода не на схеме", "err"); return; }
    let modelGroups = [];
    try { modelGroups = await this.app.catalog.typeToGroups((dev.device_type || {}).id); } catch (_) {}
    const CATS = [
      { key: "interface", label: "Интерфейсы", otypes: ["dcim.interface"] },
      { key: "frontrear", label: "Front/Rear", otypes: ["dcim.rearport", "dcim.frontport"] },
      { key: "power", label: "Питание", otypes: ["dcim.powerport", "dcim.poweroutlet"] },
      { key: "console", label: "Console", otypes: ["dcim.consoleport", "dcim.consoleserverport"] },
    ];
    const nOf = otypes => modelGroups.filter(g => otypes.includes(g.kind.otype)).reduce((mx, g) => Math.max(mx, g.items.length), 0);
    const cur = state._devPorts[dev.id] || node._groups || [];
    const cats = CATS.filter(c => cur.some(g => c.otypes.includes(g.kind.otype) && g.items.length)).map(c => ({ ...c, n: nOf(c.otypes) }));
    const schema = document.getElementById("schema");
    if (schema) schema.classList.add("node-focus");
    node.classList.add("focus-node");
    this._drawNodeWhiskers(dev.id);
    const bar = mk("div", { className: "model-bar portshift-bar" });
    const cancel = mk("button", { className: "mb-btn mb-cancel", title: "Готово (Esc)", html: `<i class="mdi mdi-close"></i>` });
    bar.appendChild(cancel);
    for (const c of cats) {
      const grp = mk("span", { className: "ps-cat" });
      const lb = mk("button", { className: "ps-arrow", title: `−${c.n} к свободным`, html: `<i class="mdi mdi-chevron-left"></i>` });
      const nm = mk("span", { className: "ps-lbl", html: `${c.label} ·${c.n}` });
      const rb = mk("button", { className: "ps-arrow", title: `+${c.n} к свободным`, html: `<i class="mdi mdi-chevron-right"></i>` });
      lb.addEventListener("click", () => this._shiftCategory(dev, c, -1));
      rb.addEventListener("click", () => this._shiftCategory(dev, c, +1));
      grp.append(lb, nm, rb); bar.appendChild(grp);
    }
    document.body.appendChild(bar);
    this._portShift = { dev, node, bar };
    this._positionPortShiftBar();
    this._psScroll = () => this._positionPortShiftBar();
    const pane = $("#schempane"); if (pane) pane.addEventListener("scroll", this._psScroll);
    window.addEventListener("resize", this._psScroll);
    cancel.addEventListener("click", () => this._exitPortShift());
    this._psEsc = e => { if (e.key === "Escape") this._exitPortShift(); };
    document.addEventListener("keydown", this._psEsc);
  }
  async _exitPortShift() {
    const m = this._portShift; if (!m) return;
    this._portShift = null;
    if (m.bar) m.bar.remove();
    if (this._psEsc) { document.removeEventListener("keydown", this._psEsc); this._psEsc = null; }
    if (this._psScroll) { const pane = $("#schempane"); if (pane) pane.removeEventListener("scroll", this._psScroll); window.removeEventListener("resize", this._psScroll); this._psScroll = null; }
    const schema = document.getElementById("schema");
    if (schema) schema.classList.remove("node-focus");
    if (m.node) m.node.classList.remove("focus-node");
    await this.app.tree.reload();
  }
  async _shiftCategory(dev, cat, dir) {
    if (!cat.n) { setStatus("у модели нет портов этой категории", "err"); return; }
    const EP = { "dcim.interface": "interfaces", "dcim.rearport": "rear-ports", "dcim.frontport": "front-ports",
      "dcim.powerport": "power-ports", "dcim.poweroutlet": "power-outlets",
      "dcim.consoleport": "console-ports", "dcim.consoleserverport": "console-server-ports" };
    setStatus("сдвигаю порты…");
    try {
      for (const otype of cat.otypes) {
        const ep = EP[otype]; if (!ep) continue;
        const ports = await apiAll(`/dcim/${ep}/?device_id=${dev.id}`);
        const plan = this._shiftPlan(ports, cat.n, dir);
        for (const id of plan.deletes) { try { await api(`/dcim/${ep}/${id}/`, "DELETE"); } catch (_) {} }
        for (const r of plan.renames) { try { await api(`/dcim/${ep}/${r.id}/`, "PATCH", { name: r.name }); } catch (_) {} }
      }
      await this._reloadPortShiftNode(dev);
      setStatus("порты сдвинуты", "ok");
    } catch (e) { setStatus("не удалось сдвинуть: " + e.message, "err"); }
  }
  // Shift FREE ports' numbers by dir*N; occupied stay; a free colliding with an occupied
  // number is dropped. Renames ordered to avoid transient name clashes. Pure.
  _shiftPlan(ports, N, dir) {
    const _pn = name => { const mm = String(name || "").match(/(\d+)(?!.*\d)/); return mm ? mm[1] : null; };
    const busy = p => !!(p.cable || p.wireless_link);
    const occ = new Set(ports.filter(busy).map(p => _pn(p.name)).filter(x => x != null));
    const renames = [], deletes = [];
    for (const p of ports) {
      if (busy(p)) continue;
      const num = _pn(p.name); if (num == null) continue;
      const nn = +num + dir * N;
      if (nn < 1) continue;
      if (occ.has(String(nn))) { deletes.push(p.id); continue; }
      renames.push({ id: p.id, from: +num, name: String(p.name).replace(/(\d+)(?!.*\d)/, String(nn)) });
    }
    renames.sort((a, b) => dir > 0 ? b.from - a.from : a.from - b.from);
    return { renames, deletes };
  }
  async _reloadPortShiftNode(dev) {
    const node = state.nodeEls[dev.id]; if (!node) return;
    let g = null;
    try { g = await this._fetchDeviceGraph(dev); } catch (_) {}
    if (g) { state._devPorts[dev.id] = g.groups; node._groups = g.groups; }
    this._layoutNode(dev, node);
    this._drawNodeWhiskers(dev.id);
    this._positionPortShiftBar();
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
