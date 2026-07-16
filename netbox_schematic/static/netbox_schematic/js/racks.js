"use strict";
// RackManager: racks (placement)
// Draws racks with units and devices. In view mode, empty unit runs collapse
// ("↕ N"); rack edit mode (Mode.on("rack")) expands them and allows creating
// a device by clicking a free unit.

import {
  $, state, mk, px, softColor, attachTip, modeBtn, currentLocationName,
  UNIT_H, GAP_MIN, GAP_H,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";

export class RackManager {
  constructor(app) {
    this.app = app;
    Mode.onChange("rack", () => this._rerender());   // expand/collapse on mode change
    // Collapsing the racks pane: ◄ in its header hides it (body.rack-collapsed),
    // ► left of the schema header brings it back. State SURVIVES reloads
    // (localStorage). Delegated to document — the buttons are recreated on
    // every header redraw.
    // The racks pane is COLLAPSED by default (opened on demand — via a rack's
    // pencil). If it was explicitly expanded before, honor that ("0").
    if (localStorage.getItem("schematic-rackCollapsed") !== "0")
      document.body.classList.add("rack-collapsed");
    const setCollapsed = on => {
      document.body.classList.toggle("rack-collapsed", on);
      localStorage.setItem("schematic-rackCollapsed", on ? "1" : "0");
    };
    document.addEventListener("click", ev => {
      if (ev.target.closest("#rack-collapse")) setCollapsed(true);
      else if (ev.target.closest("#rack-expand")) setCollapsed(false);
    });
  }

  _rerender() {
    if (!state.group || !state.group.length) return;
    const byRack = {};
    for (const r of state.group) byRack[r.id] = state.devices.filter(d => d.rack && d.rack.id === r.id);
    this.render(state.group, byRack);
  }

  // Unit layout: unit → yTop map. In view mode, ≥GAP_MIN consecutive empty
  // units collapse into a strip; in rack edit mode the rack is fully expanded.
  layout(rack, occ) {
    const collapse = !Mode.on("rack");
    const unitY = {};
    const gaps = [];
    let y = 0;
    for (let u = rack.u_height; u >= 1;) {
      if (collapse && !occ.has(u)) {
        let v = u;
        while (v >= 1 && !occ.has(v)) v--;
        const from = v + 1, to = u, count = to - from + 1;
        if (count >= GAP_MIN) {
          gaps.push({ from, to, y, h: GAP_H, count });
          for (let k = from; k <= to; k++) unitY[k] = y;
          y += GAP_H;
          u = from - 1;
          continue;
        }
      }
      unitY[u] = y;
      y += UNIT_H;
      u--;
    }
    return { unitY, totalH: y, gaps };
  }

  render(group, byRack) {
    this._occClear();   // reset the unit selection + "Занять место?" dialog on redraw
    const pane = $("#rackpane");
    // Auto-collapse the racks pane ONLY when the SCOPE actually changes to a
    // non-rack one (keeps it out of the way). NOT on every re-render: a rack-mode
    // toggle re-renders too, and must NOT re-collapse a pane the user has opened —
    // that was the "mode button closes the «Стойки» block" bug.
    const scopeKey = state.scope ? state.scope.type + ":" + state.scope.id : "";
    if (scopeKey !== this._lastScopeKey) {
      this._lastScopeKey = scopeKey;
      if (!(state.scope && state.scope.type === "rack")) document.body.classList.add("rack-collapsed");
    }
    const loc = currentLocationName();
    const title = loc ? `Стойки : ${loc}` : "Стойки";
    pane.innerHTML = `<p class="pane-title"><span class="pt-label">${title}</span><span class="pt-actions">${modeBtn("rack", "compact pt-inline")}<button id="rack-collapse" class="pane-toggle" title="Свернуть блок стоек"><i class="mdi mdi-chevron-left"></i></button></span></p><div id="racks"></div>`;
    Mode.syncButtons("rack");
    const wrap = $("#racks");
    // Separator between locations (when the column holds racks from several
    // rooms): a horizontal line with the location name before its racks.
    const multiLoc = new Set(group.map(r => r.location && r.location.id)).size > 1;
    let prevLoc = null;
    for (const rack of group) {
      const locId = rack.location && rack.location.id;
      if (multiLoc && locId !== prevLoc)
        wrap.appendChild(mk("div", { className: "rack-loc-sep",
          html: `<i class="mdi mdi-map-marker"></i> ${(rack.location && rack.location.name) || "—"}` }));
      prevLoc = locId;
      const occ = state.rackOcc[rack.id] = new Set();
      for (const dev of byRack[rack.id]) {
        if (dev.position == null) continue;
        const dt = state.dtypes[dev.device_type.id] || { u_height: 1 };
        const uh = Math.max(dt.u_height, 0.5);
        for (let u = dev.position; u < dev.position + uh; u++) occ.add(Math.floor(u));
      }
      const lay = this.layout(rack, occ);
      state.rackLay[rack.id] = lay;

      const col = document.createElement("div");
      col.className = "rack";
      col.innerHTML = `<h3>${rack.name} <span style="color:var(--muted);font-size:12px">· ${rack.u_height}U</span></h3>
        <div class="rack-frame" style="height:${lay.totalH}px"><div class="unit-labels"></div></div>`;
      const frame = col.querySelector(".rack-frame");
      const labels = col.querySelector(".unit-labels");
      const shown = new Set();
      lay.gaps.forEach(g => { for (let k = g.from; k <= g.to; k++) shown.add(k); });
      for (let u = 1; u <= rack.u_height; u++) {
        if (shown.has(u)) continue;
        labels.appendChild(mk("div", { dataset: { u }, text: u, style: { top: lay.unitY[u] + "px" } }));
      }
      for (const g of lay.gaps) {
        const gapEl = mk("div", {
          className: "unit-gap", style: { top: g.y + "px", height: g.h + "px" },
          html: `<i class="mdi mdi-arrow-up-down"></i> ${g.count}`,
        });
        attachTip(gapEl, () => `<div class="t-title">${g.count} пустых юнитов</div>
          <div class="t-line">U${g.from}–U${g.to}</div>
          <div class="t-mut">включи режим редактирования, чтобы раскрыть</div>`);
        frame.appendChild(gapEl);
      }
      frame.addEventListener("click", ev => this._onFrameClick(ev, rack));
      this._attachUnitHover(frame, rack);
      for (const dev of byRack[rack.id]) {
        if (dev.position == null) continue;
        const dt = state.dtypes[dev.device_type.id] || { u_height: 1 };
        const role = state.roles[dev.role.id] || { color: "607d8b" };
        const uh = Math.max(dt.u_height, 0.5);
        const topU = dev.position + Math.ceil(uh) - 1;
        const yTop = lay.unitY[topU] ?? lay.unitY[dev.position] ?? 0;
        const el = mk("div", {
          className: "dev",
          dataset: { dev: dev.id },
          style: {
            top: (yTop + 1) + "px",
            height: (Math.ceil(uh) * UNIT_H - 3) + "px",
            borderColor: "#" + role.color,
          },
          html: `<span class="nmw">${dev.name}</span><span class="m">${dev.device_type.model}</span>`,
          on: {
            click: ev => { ev.stopPropagation(); this.app.schema.focusDevice(dev); this.app.device.show(dev); },
            mouseenter: () => this.highlightDevice(dev.id, true),
            mouseleave: () => this.highlightDevice(dev.id, false),
          },
        });
        el.style.setProperty("--dev-fill", softColor(role.color));
        el.style.setProperty("--dev-edge", "#" + role.color);
        attachTip(el, () => `<div class="t-title">${dev.name}</div>
          <div class="t-line">${dev.device_type.model}</div>
          <div class="t-mut">роль: ${dev.role.name} · юнит U${dev.position}</div>`);
        frame.appendChild(el);
        state.rackDevEls[dev.id] = el;
      }
      wrap.appendChild(col);
      state.rackColEls[rack.id] = col;
    }
  }

  unitAtY(rack, y) {
    const lay = state.rackLay[rack.id];
    if (!lay) return rack.u_height - Math.floor(y / UNIT_H);
    for (let u = 1; u <= rack.u_height; u++) {
      const top = lay.unitY[u];
      if (top == null) continue;
      if (y >= top && y < top + UNIT_H) return u;
    }
    return -1;
  }

  _attachUnitHover(frame, rack) {
    const labels = frame.parentElement.querySelector(".unit-labels");
    let ov = null;
    const clear = () => {
      if (ov) { ov.remove(); ov = null; }
      if (labels) labels.querySelectorAll(".circled").forEach(d => d.classList.remove("circled", "busy"));
    };
    frame.addEventListener("mouseleave", clear);
    frame.addEventListener("mousemove", ev => {
      if (!Mode.on("rack") || ev.target.closest(".dev")) { clear(); return; }
      const y = ev.clientY - frame.getBoundingClientRect().top;
      const unit = this.unitAtY(rack, y);
      if (unit < 1 || unit > rack.u_height) { clear(); return; }
      const lay = state.rackLay[rack.id];
      const busy = state.rackOcc[rack.id] && state.rackOcc[rack.id].has(unit);
      if (!ov) { ov = document.createElement("div"); ov.className = "unit-hover"; frame.appendChild(ov); }
      ov.classList.toggle("busy", !!busy);
      ov.style.top = ((lay ? lay.unitY[unit] : (rack.u_height - unit) * UNIT_H) + 1) + "px";
      ov.style.height = (UNIT_H - 3) + "px";
      if (labels) {
        labels.querySelectorAll(".circled").forEach(d => d.classList.remove("circled", "busy"));
        const lab = labels.querySelector(`[data-u="${unit}"]`);
        if (lab) { lab.classList.add("circled"); lab.classList.toggle("busy", !!busy); }
      }
    });
  }

  highlightDevice(devId, on) {
    const node = state.nodeEls[devId];
    if (node) node.classList.toggle("hl", on);
    const rd = state.rackDevEls[devId];
    if (rd) rd.classList.toggle("hl", on);
  }

  // Rack edit mode: clicking a free unit selects THAT unit (green) and shows the
  // "Занять место?" dialog beside the rack; "Да" opens the create modal. How many
  // shelves the device takes is decided by its MODEL's height (u_height is a type
  // property — one model, one height), so there is no multi-unit range selection.
  _onFrameClick(ev, rack) {
    if (!Mode.on("rack")) return;
    if (ev.target.closest(".dev")) return;
    const frame = ev.currentTarget;
    const y = ev.clientY - frame.getBoundingClientRect().top;
    const unit = this.unitAtY(rack, y);
    if (unit < 1 || unit > rack.u_height) return;
    if (state.rackOcc[rack.id] && state.rackOcc[rack.id].has(unit)) {
      setStatus("юнит U" + unit + " занят", "err");
      return;
    }
    this._occToggle(rack, frame, unit);
  }
  // Select the clicked unit (click the selected one again → cancel).
  _occToggle(rack, frame, unit) {
    const s = this._occSel;
    if (s && s.rackId === rack.id && s.lo === unit) { this._occClear(); return; }
    this._occSel = { rackId: rack.id, lo: unit, hi: unit, frame, rack };
    this._occRender();
  }
  // Green overlays over the selected units + the "Занять место?" dialog (fixed on
  // <body> so #racks overflow can't clip it; a CSS pointer aims at the rack).
  _occRender() {
    this._occClearEls();
    const s = this._occSel;
    if (!s) return;
    const lay = state.rackLay[s.rackId];
    const yOf = u => lay ? lay.unitY[u] : (s.rack.u_height - u) * UNIT_H;
    this._occEls = [];
    for (let u = s.lo; u <= s.hi; u++) {
      const ov = mk("div", { className: "unit-hover armed occ-sel",
        style: { top: (yOf(u) + 1) + "px", height: (UNIT_H - 3) + "px" } });
      s.frame.appendChild(ov);
      this._occEls.push(ov);
    }
    const fr = s.frame.getBoundingClientRect();
    const midY = fr.top + (yOf(s.hi) + yOf(s.lo) + UNIT_H) / 2;
    const W = 140;
    let left = fr.right + 14, side = "left";     // dialog right of rack, pointer aims left
    if (left + W > innerWidth - 8) { left = fr.left - W - 14; side = "right"; }
    const dlg = mk("div", { className: "occ-dialog pt-" + side,
      html: `<div class="occ-q">Занять место?<div class="occ-u">U${s.lo}</div></div>` +
        `<div class="occ-btns"><button type="button" class="occ-no">Нет</button>` +
        `<button type="button" class="occ-yes">Да</button></div>` });
    dlg.style.left = Math.max(8, left) + "px";
    dlg.style.top = midY + "px";
    document.body.appendChild(dlg);
    this._occDlg = dlg;
    dlg.querySelector(".occ-no").addEventListener("click", () => this._occClear());
    dlg.querySelector(".occ-yes").addEventListener("click", () => {
      const rack = s.rack, lo = s.lo;
      this._occClear();
      this._openAddDevice(rack, lo);
    });
  }
  _occClearEls() {
    (this._occEls || []).forEach(e => e.remove());
    this._occEls = [];
    if (this._occDlg) { this._occDlg.remove(); this._occDlg = null; }
  }
  _occClear() { this._occClearEls(); this._occSel = null; }
  _openAddDevice(rack, unit) {
    // Chosen stack from the side list (below). Empty → the device isn't stacked.
    const sel = { vcId: null, pos: null, name: null };
    // The device's FOOTPRINT comes from its model: a 2U model fills U<unit> and
    // the shelf above (NetBox validates the space). Height is edited in the
    // catalog («Высота, U») — the type labels here show it.
    const typeOpts = Object.values(state.dtypes).map(t => ({ value: String(t.id), label: `${t.model} (${t.u_height}U)` }));
    const where = `Стойка ${rack.name}, юнит U${unit}`;
    this.app.openModal("Новое устройство", where,
      [
        { id: "name", label: "Имя", placeholder: "srv-web-01" },
        { id: "type", label: "Тип (модель)", type: "select", options: typeOpts },
        { id: "role", label: "Роль", type: "select",
          options: Object.values(state.roles).map(r => ({ value: r.id, label: r.name })) },
      ],
      async v => {
        if (!v.name) throw new Error("имя обязательно");
        const dev = await api("/dcim/devices/", "POST", {
          name: v.name, device_type: +v.type, role: +v.role,
          site: rack.site.id, rack: rack.id, position: unit,
          face: "front", status: "active",
        });
        // If a stack was picked in the side list, join it. Position = the "/N"
        // trailing the name (kept in sync when the stack was clicked), else sel.pos.
        if (sel.vcId) {
          const m = String(v.name).match(/\/(\d+)\s*$/);
          const pos = m ? +m[1] : (sel.pos || 1);
          try {
            await api("/dcim/devices/" + dev.id + "/", "PATCH",
              { virtual_chassis: sel.vcId, vc_position: pos });
          } catch (e) { setStatus("устройство создано, но в стек не добавилось: " + e.message, "err"); }
        }
        setStatus("создано: " + v.name + " в " + rack.name + " U" + unit, "ok");
        await this.app.tree.reload();   // refresh the tree too (new device appears)
      },
      "Создать",
      { side: el => this._stackSide(el, sel) });
  }

  // Right column of the create-device modal: the VirtualChassis (stack) list.
  // Click a stack → assign it and rewrite the "Имя" field to "<base>/<pos>"
  // (pos = next free vc_position). "Создать сейчас" makes a new stack inline.
  _stackSide(sideEl, sel) {
    this._closeStackPopover();   // fresh modal — drop any stale names popover
    sideEl.innerHTML =
      `<div class="ms-head"><span>Список стеков</span>` +
      `<button type="button" class="ms-newvc">Создать сейчас</button></div>` +
      `<div class="ms-list"><div class="placeholder">загрузка…</div></div>`;
    const listEl = sideEl.querySelector(".ms-list");
    const nameEl = () => $("#mf-name");
    const setName = (pos, fallbackBase) => {
      const el = nameEl();
      if (!el) return;
      const base = el.value.replace(/\/\d+\s*$/, "").trim();
      el.value = (base || fallbackBase || "sw") + "/" + pos;
    };
    const pick = async (vc, item) => {
      let members = [];
      try { members = await apiAll("/dcim/devices/?virtual_chassis_id=" + vc.id); } catch (_) {}
      const pos = members.reduce((mx, m) => Math.max(mx, m.vc_position || 0), 0) + 1;
      sel.vcId = vc.id; sel.pos = pos; sel.name = vc.name;
      setName(pos, vc.name);
      listEl.querySelectorAll(".ms-item").forEach(x => x.classList.remove("sel"));
      if (item) item.classList.add("sel");
    };
    const renderList = vcs => {
      listEl.innerHTML = "";
      if (!vcs.length) { listEl.innerHTML = `<div class="placeholder">стеков ещё нет</div>`; return; }
      for (const vc of vcs) {
        const item = mk("div", { className: "ms-item" + (sel.vcId === vc.id ? " sel" : ""),
          html: `<i class="mdi mdi-layers-triple"></i><span class="ms-nm">${vc.name}</span>` });
        // Members button — independent of selecting the stack (stopPropagation);
        // opens a popover of the member switch NAMES outside the modal box.
        const namesBtn = mk("button", { type: "button", className: "ms-names",
          title: "Показать участников стека",
          html: `${vc.member_count ?? "?"} <i class="mdi mdi-chevron-down"></i>` });
        namesBtn.addEventListener("click", e => { e.stopPropagation(); this._stackNamesPopover(namesBtn, vc); });
        item.appendChild(namesBtn);
        item.addEventListener("click", () => pick(vc, item));
        listEl.appendChild(item);
      }
    };
    apiAll("/dcim/virtual-chassis/").then(renderList)
      .catch(() => { listEl.innerHTML = `<div class="placeholder">не удалось загрузить</div>`; });
    // "Создать сейчас" → inline name input → POST a new VC → select it.
    sideEl.querySelector(".ms-newvc").addEventListener("click", () => {
      if (sideEl.querySelector(".ms-newrow")) return;
      const base = (nameEl() ? nameEl().value : "").replace(/\/\d+\s*$/, "").trim();
      const row = mk("div", { className: "ms-newrow",
        html: `<input class="ms-newinp" placeholder="Имя стека" value="${base}"><button type="button" class="ms-newok">✓</button>` });
      sideEl.querySelector(".ms-head").after(row);
      const inp = row.querySelector(".ms-newinp");
      inp.focus();
      const submit = async () => {
        const nm = inp.value.trim();
        if (!nm) return;
        try {
          const vc = await api("/dcim/virtual-chassis/", "POST", { name: nm });
          row.remove();
          const vcs = await apiAll("/dcim/virtual-chassis/");
          sel.vcId = vc.id;          // preselect the new one when the list re-renders
          renderList(vcs);
          sel.pos = 1; sel.name = nm; setName(1, nm);
        } catch (e) { setStatus("не создать стек: " + e.message, "err"); }
      };
      row.querySelector(".ms-newok").addEventListener("click", submit);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    });
  }

  // Popover (outside the modal box, on <body> so overflow:hidden doesn't clip it)
  // listing the member switch NAMES of a stack — the "which names are taken"
  // view. Anchored to the members button; closes on outside click / Escape.
  _stackNamesPopover(anchor, vc) {
    if (this._stackPop && this._stackPopVc === vc.id) { this._closeStackPopover(); return; }  // toggle
    this._closeStackPopover();
    const pop = mk("div", { className: "ms-pop",
      html: `<div class="ms-pop-h">Стек «${vc.name}»</div><div class="ms-pop-b"><div class="placeholder">загрузка…</div></div>` });
    document.body.appendChild(pop);
    this._stackPop = pop; this._stackPopVc = vc.id;
    const r = anchor.getBoundingClientRect();
    const pw = 210;
    let left = r.right + 8;
    if (left + pw > innerWidth - 8) left = r.left - pw - 8;   // flip to the left if no room
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = Math.max(8, Math.min(r.top, innerHeight - 240)) + "px";
    apiAll("/dcim/devices/?virtual_chassis_id=" + vc.id).then(members => {
      const body = pop.querySelector(".ms-pop-b");
      if (!members.length) { body.innerHTML = `<div class="placeholder">пусто</div>`; return; }
      body.innerHTML = "";
      members.slice().sort((a, b) => (a.vc_position ?? 1e9) - (b.vc_position ?? 1e9)).forEach(m => {
        body.appendChild(mk("div", { className: "ms-pop-row",
          html: `<span class="ms-pop-pos">${m.vc_position ?? "—"}</span><span class="ms-pop-nm">${m.name}</span>` }));
      });
    }).catch(() => { pop.querySelector(".ms-pop-b").innerHTML = `<div class="placeholder">не загрузить</div>`; });
    // Defer wiring so this very click doesn't immediately close it.
    setTimeout(() => {
      this._stackPopDoc = ev => {
        if (!ev.target.closest(".ms-pop") && !ev.target.closest(".ms-names")) this._closeStackPopover();
      };
      this._stackPopKey = ev => { if (ev.key === "Escape") this._closeStackPopover(); };
      document.addEventListener("mousedown", this._stackPopDoc);
      document.addEventListener("keydown", this._stackPopKey);
    }, 0);
  }
  _closeStackPopover() {
    if (this._stackPop) { this._stackPop.remove(); this._stackPop = null; this._stackPopVc = null; }
    if (this._stackPopDoc) { document.removeEventListener("mousedown", this._stackPopDoc); this._stackPopDoc = null; }
    if (this._stackPopKey) { document.removeEventListener("keydown", this._stackPopKey); this._stackPopKey = null; }
  }
}
