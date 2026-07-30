"use strict";
// Power panels and feeds — mixin for the SchemaManager prototype (split from schema.js).
// Methods copied into SchemaManager.prototype via _mixin (see schema.js).
import {
  $, state, mk, px, attachTip, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox, portAnchor } from "./schema_util.js";

class _Mixin {
  // Draws each server room's power panels in their own row BELOW all its
  // content (racks + off-rack pocket), centered on their combined span.
  // Location geometry comes from the render pre-pass (this._locOrder / _colX,
  // see _computeLocGeometry). Returns maxBottom.
  _renderPowerPanels(canvas, group, maxBottom) {
    if (!group.length) return maxBottom;
    // A single rack is open (scope "rack") — don't show location panels.
    if (state.scope && state.scope.type === "rack") return maxBottom;
    const GAP_Y = 40;
    state.powerBoxEls = {};
    state.feedRowEls = {};
    const edit = Mode.on("schema");
    let bottom = maxBottom;
    for (const g of this._locOrder || []) {
      const panels = (state.powerPanels || []).filter(p => p.location && p.location.id === g.locId);
      if (!panels.length) continue;
      // Content bottom = max(rack bottom, pocket bottom, THIS room's power rows
      // bottom, global fallback power block) → panels are the LAST row of the
      // room stack: racks → Питание → Стабилизаторы → Силовые щиты.
      const contentBottom = Math.max(g.rackBottom, g.areaH ? g.devTop + g.areaH : 0,
        g.powerBottom || 0, this._powerBottom || 0);
      // Center = middle of the "racks + pocket" span.
      const spanLeft = this._colX(g.minCol);
      const spanRight = g.areaW ? g.devX + g.areaW
        : this._colX(g.maxCol) + this.SLOT + BOX_PAD;
      bottom = Math.max(bottom, this._renderPanelRow(
        canvas, panels, (spanLeft + spanRight) / 2, contentBottom + GAP_Y, edit));
    }
    return bottom;
  }

  // Draws one room's panel ROW, centered under its racks (centerX), starting at
  // top. Returns the row bottom (for canvas-height calc).
  _renderPanelRow(canvas, panels, centerX, top, edit) {
    const PANEL_W = 280, HEAD_H = 30, ROW_H = 24, GAP_X = 28;
    const panelFeeds = panels.map(p =>
      (state.powerFeeds || []).filter(f => f.power_panel && f.power_panel.id === p.id));
    // Edit mode adds a "+ feed" row → panel is 1 row taller.
    const rowsOf = fs => edit ? fs.length + 1 : Math.max(1, fs.length);
    const maxH = Math.max(...panelFeeds.map(fs => HEAD_H + rowsOf(fs) * ROW_H + 8));
    // Panel row centered under its racks (whole row around centerX) so it
    // doesn't spill past the room's span into a neighbor.
    const rowW = panels.length * PANEL_W + (panels.length - 1) * GAP_X;
    const x0 = centerX - rowW / 2;
    // "Power panels" block contour (behind cards) — with label and fill, like
    // device-type contours.
    const CONT_HEAD = 28, CONT_PAD = 14;
    const contour = this._contourEl("gb-power", "Силовые щиты", {
      left: x0 - CONT_PAD, top: top - CONT_HEAD,
      width: rowW + CONT_PAD * 2, height: CONT_HEAD + maxH + CONT_PAD });
    canvas.insertBefore(contour, canvas.firstChild);
    let x = x0;
    panels.forEach((panel, pi) => {
      const feeds = panelFeeds[pi];
      // Panel card — same look as rack nodes (.node) plus .powerbox marker.
      // Left accent — power color.
      const box = mk("div", {
        className: "node powerbox",
        style: { left: x + "px", top: top + "px", width: PANEL_W + "px", height: maxH + "px",
          borderLeft: "3px solid var(--power)" },
      });
      box.insertAdjacentHTML("beforeend",
        `<span class="nm">${panel.name}</span><span class="mdl">силовой щит · ${feeds.length} фид.</span>`);
      // Click the panel name → its detail panel on the right (like devices).
      box.querySelector(".nm").addEventListener("click", e => {
        e.stopPropagation();
        this.app.device.showPanel(panel);
      });
      // Feeds listed; each has a port on the card's LEFT edge (a dot, like
      // device ports). Hovering a port shows route/tooltip.
      const list = mk("div", { className: "pb-feeds" });
      feeds.forEach((f, fi) => {
        const va = f.amperage ? `${f.voltage || "?"}В/${f.amperage}А` : "";
        const row = mk("div", { className: "pb-feed",
          html: `<span class="pf-name">${f.name}</span><span class="pf-va">${va}</span>` });
        list.appendChild(row);
        state.feedRowEls[f.id] = row;
        // Feed port on the left edge, vertically at the center of its row.
        const portY = HEAD_H + fi * ROW_H + ROW_H / 2;
        this._placeFeedPort(box, panel, f, portY, fi + 1);
      });
      // Edit mode: a "+ feed" row with a green plus-dot on the left (like a
      // feed) to add feeds straight from the schematic, no tree digging.
      if (edit) {
        const addRow = mk("div", { className: "pb-feed addfeed",
          html: `<span class="pf-name">+ добавить фидер</span>` });
        addRow.addEventListener("click", () => this._addFeed(panel));
        list.appendChild(addRow);
        this._placeAddFeedDot(box, panel, HEAD_H + feeds.length * ROW_H + ROW_H / 2);
      } else if (!feeds.length) {
        list.appendChild(mk("div", { className: "pb-feed empty", html: `<span class="pf-name">нет фидеров</span>` }));
      }
      box.appendChild(list);
      canvas.appendChild(box);
      state.powerBoxEls[panel.id] = box;
      x += PANEL_W + GAP_X;
    });
    return top + maxH + 20;
  }

  // Rebuild only the panels (on edit-mode toggle the "+ feed" row appears/
  // disappears). Position taken from the saved rack-row bottom.
  _rerenderPowerPanels() {
    const canvas = $("#schema");
    if (!canvas || this._powerBaseBottom == null) return;
    canvas.querySelectorAll(".powerbox, .groupbox.gb-power").forEach(el => el.remove());
    this._renderPowerPanels(canvas, state.group, this._powerBaseBottom);
  }

  // Power Feed port on the panel's left edge. Registered in state.ports as
  // dcim.powerfeed:<id> so hover/route work and the PDU line attaches to it
  // (_drawFeedWires). dev — synthetic (the panel).
  _placeFeedPort(box, panel, feed, portY, ord) {
    const dot = mk("div", {
      className: "port p-feed" + (feed.cable ? " used" : ""),
      text: String(ord),                 // feed PORT is numbered 1..N (the name shows in the row)
      style: { left: "-8px", top: portY + "px" },
    });
    const kind = { otype: "dcim.powerfeed", ep: "power-feeds", label: "фидер", cls: "p-feed" };
    const dev = { id: "panel-" + panel.id, name: panel.name };
    attachTip(dot, () => this._feedTip(panel, feed));
    const port = { el: dot, item: feed, dev, otype: kind.otype, ep: kind.ep, side: "l" };
    dot.addEventListener("mouseenter", () => this._portHover(port, true));
    dot.addEventListener("mouseleave", () => this._portHover(port, false));
    // Connect like normal ports: click — select/link (feed ↔ PDU power-port),
    // double — trace. COMPAT allows powerfeed↔powerport.
    dot.addEventListener("click", ev => { ev.stopPropagation(); this._onPortClick(kind, feed, dev, dot, ev); });
    dot.addEventListener("dblclick", ev => { ev.stopPropagation(); ev.preventDefault(); this._onPortDblClick(kind, feed); });
    box.appendChild(dot);
    state.ports[portKey(kind.otype, feed.id)] = port;
  }

  // Green "+" dot on the left of the "+ feed" row (like a feed port, but adds).
  _placeAddFeedDot(box, panel, portY) {
    const dot = mk("div", { className: "port p-feed addport", text: "+",
      title: "Добавить фидер", style: { left: "-8px", top: portY + "px" } });
    dot.addEventListener("click", ev => { ev.stopPropagation(); this._addFeed(panel); });
    box.appendChild(dot);
  }
  // Feed-creation modal (same as tree's "+ feed") — straight from the schematic.
  _addFeed(panel) {
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
        await this.app.tree.reload();
      });
  }

  _feedTip(panel, feed) {
    const va = feed.amperage ? `${feed.voltage || "?"} В / ${feed.amperage} А` : "—";
    const phase = feed.phase ? feed.phase.label : "";
    const st = feed.status ? feed.status.label : "";
    const rack = feed.rack ? feed.rack.display : "—";
    return `<div class="t-title">${panel.name} · ${feed.name}</div>
      <div class="t-line">фидер питания · ${st}</div>
      <div class="t-line">${va}${phase ? " · " + phase : ""}</div>
      <div class="t-line">в стойку: ${rack}</div>
      <div class="t-mut">${feed.cable ? "наведи — маршрут питания" : "не подключён"}</div>`;
  }

  // Lines from panel feeds to PDU Input ports (close the power circuit). Drawn
  // in #wires after ports; called from redrawWires (port geometry already
  // computed). The feed↔power-port cable is the link source.
  _drawFeedWires(svg, center) {
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      const feedT = terms.find(t => t.object_type === "dcim.powerfeed");
      const portT = terms.find(t => t.object_type === "dcim.powerport");
      if (!feedT || !portT) continue;
      const feedP = state.ports[portKey("dcim.powerfeed", feedT.object_id)];
      const port = state.ports[portKey("dcim.powerport", portT.object_id)];
      if (!feedP || !port) continue;
      // Same detached-element guard as _wireEnds: the VLAN view hides power ports
      // but keeps their state.ports entry, and a detached el measures as 0,0.
      if (!feedP.el.isConnected || !port.el.isConnected) continue;
      const [fx, fy] = portAnchor(feedP, ...center(feedP.el));
      const [px2, py] = portAnchor(port, ...center(port.el));
      const midY = (fy + py) / 2;
      // Feed port is on the panel's LEFT face → the wire ALWAYS exits
      // perpendicular (90°, horizontally left) for a short stub, THEN enters the
      // path (small_fix: "from panels first 90° off the port, then path").
      const sx = fx - 26;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      // Style like normal wires:
      //  · round — horizontal stub, then vertical cubic to PDU;
      //  · angular + short — stub, rounded Manhattan route through the middle;
      //  · angular + extend — stub, then PDU column corridor around nodes.
      let d;
      if (state.wireStyle !== "angular") {
        // Smooth cubic, LIKE other round wires, but exits the port HORIZONTALLY
        // (first control on the left) → 90° off the panel with no kinked joint.
        d = `M ${fx} ${fy} C ${fx - 44} ${fy}, ${px2} ${midY}, ${px2} ${py}`;
      } else if (state.wirePath === "extend" && state.devCol[port.dev.id] != null) {
        const col = state.devCol[port.dev.id];
        const corr = this._colX(col) + this.SLOT + COL_GAP / 2 - 52;
        // Run the horizontal transition ABOVE the panels (top edge of the
        // topmost panel − pad) so the line doesn't cut their boxes, then up the
        // PDU column corridor to its port. state.powerBoxEls — panel boxes.
        const tops = Object.values(state.powerBoxEls || {}).map(el => el.offsetTop);
        const overPanels = (tops.length ? Math.min(...tops) : fy) - 24;
        const pOut = py + 16;
        d = smoothPath([[fx, fy], [sx, fy], [sx, overPanels], [corr, overPanels], [corr, pOut], [px2, pOut], [px2, py]], 10);
      } else {
        d = smoothPath([[fx, fy], [sx, fy], [sx, midY], [px2, midY], [px2, py]], 10);
      }
      p.setAttribute("d", d);
      p.setAttribute("class", "wire cbl-power feedwire");
      p.dataset.cable = c.id;
      svg.appendChild(p);
    }
  }

}
export const PowerMethods = _Mixin.prototype;
