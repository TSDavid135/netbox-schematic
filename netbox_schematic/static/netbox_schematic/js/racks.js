"use strict";
// RackManager: стойки (размещение)
// Рисует стойки с юнитами и устройствами. В режиме просмотра пустые прогоны
// юнитов сворачиваются («↕ N»); режим правки стоек (Mode.on("rack")) их
// раскрывает и разрешает создание устройства кликом по свободному юниту.

import {
  $, state, mk, px, softColor, attachTip, modeBtn, currentLocationName,
  UNIT_H, GAP_MIN, GAP_H,
} from "./core.js";
import { api, setStatus } from "./api.js";
import { Mode } from "./modes.js";

export class RackManager {
  constructor(app) {
    this.app = app;
    Mode.onChange("rack", () => this._rerender());   // раскрытие/свёртка при смене режима
    // Сворачивание блока «Стойки»: ◄ в его заголовке прячет блок (body.rack-
    // collapsed), ► слева от «Схема соединений» возвращает. Делегируем на
    // document — кнопки пересоздаются при каждой перерисовке заголовков.
    document.addEventListener("click", ev => {
      if (ev.target.closest("#rack-collapse")) document.body.classList.add("rack-collapsed");
      else if (ev.target.closest("#rack-expand")) document.body.classList.remove("rack-collapsed");
    });
  }

  _rerender() {
    if (!state.group || !state.group.length) return;
    const byRack = {};
    for (const r of state.group) byRack[r.id] = state.devices.filter(d => d.rack && d.rack.id === r.id);
    this.render(state.group, byRack);
  }

  // Раскладка юнитов: карта unit → yTop. В просмотре ≥GAP_MIN пустых подряд
  // сворачиваются в полосу; в правке стоек — стойка раскрыта целиком.
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
    const pane = $("#rackpane");
    const loc = currentLocationName();
    const title = loc ? `Стойки : ${loc}` : "Стойки";
    pane.innerHTML = `<p class="pane-title"><span class="pt-label">${title}</span>${modeBtn("rack", "compact ms-intitle")}<button id="rack-collapse" class="pane-toggle" title="Свернуть блок стоек"><i class="mdi mdi-chevron-left"></i></button></p><div id="racks"></div>`;
    Mode.syncButtons("rack");
    const wrap = $("#racks");
    // Разделитель между локациями (когда в колонке стойки нескольких серверных):
    // горизонтальная линия с именем локации перед её стойками.
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
    this.app.openModal("Новое устройство", `Стойка ${rack.name}, юнит U${unit}`,
      [
        { id: "name", label: "Имя", placeholder: "srv-web-01" },
        { id: "type", label: "Тип (модель)", type: "select",
          options: Object.values(state.dtypes).map(t => ({ value: t.id, label: `${t.model} (${t.u_height}U)` })) },
        { id: "role", label: "Роль", type: "select",
          options: Object.values(state.roles).map(r => ({ value: r.id, label: r.name })) },
      ],
      async v => {
        if (!v.name) throw new Error("имя обязательно");
        await api("/dcim/devices/", "POST", {
          name: v.name, device_type: +v.type, role: +v.role,
          site: rack.site.id, rack: rack.id, position: unit,
          face: "front", status: "active",
        });
        setStatus("создано: " + v.name + " в " + rack.name + " U" + unit, "ok");
        await this.app.renderAll(state.group);
      });
  }
}
