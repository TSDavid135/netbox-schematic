"use strict";
// Фильтр по ролям / кабелям
// Кнопка «Fl» над «UI» в оверлее схемы. Раскрывает ДИНАМИЧЕСКИЙ список того,
// что реально есть на текущей схеме: узлы (сгруппированы по роли устройства)
// и отдельно провода (по семейству кабеля). Галочки скрывают/показывают —
// это чистый CSS поверх уже нарисованного (data-role / data-fam), без
// перезагрузки данных и без пересборки схемы.
//
// Что скрыто, помним в state.hiddenRoles / state.hiddenFams, чтобы фильтр
// пережил перерисовку (renderAll пересоздаёт узлы/провода → reapply).

import { $, state, cableFamily, FAMILY_LABEL, FAMILY_ORDER, termKey } from "./core.js";

export class RoleFilter {
  constructor(app) {
    this.app = app;
  }

  // Перерисовать панель по текущим данным + применить скрытие к DOM.
  // Зовётся из renderAll (после отрисовки схемы) и refreshCables (кабели могли
  // появиться/исчезнуть). Панель могла ещё не существовать — тогда выходим.
  render() {
    const body = $(".fl-body");
    if (!body) return;
    const roles = this._presentRoles();
    const fams = this._presentFamilies();
    body.innerHTML = "";

    if (!roles.length && !fams.length) {
      body.innerHTML = `<div class="fl-empty">Нет объектов на схеме</div>`;
      return;
    }

    if (roles.length) {
      body.appendChild(this._section("Узлы (роли)", roles.map(r => ({
        key: "role:" + r.id,
        color: "#" + r.color,
        shape: "box",
        label: r.name,
        count: r.count,
        hidden: !!state.hiddenRoles[r.id],
        toggle: on => this._toggleRole(r.id, on),
      }))));
    }
    if (fams.length) {
      body.appendChild(this._section("Провода (тип)", fams.map(f => ({
        key: "fam:" + f.fam,
        color: `var(--cbl-${f.fam})`,
        shape: "line",
        label: f.label,
        count: f.count,
        hidden: !!state.hiddenFams[f.fam],
        toggle: on => this._toggleFam(f.fam, on),
      }))));
    }
    this.apply();
  }

  // что есть на схеме
  _presentRoles() {
    const by = new Map();
    for (const dev of (state.devices || [])) {
      const id = dev.role ? dev.role.id : 0;
      const role = (dev.role && state.roles[id]) || { name: "без роли", color: "607d8b" };
      const cur = by.get(id) || { id, name: role.name, color: role.color, count: 0 };
      cur.count++;
      by.set(id, cur);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  _presentFamilies() {
    const by = new Map();
    for (const c of (state.cables || [])) {
      const isPower = (c.a_terminations || []).concat(c.b_terminations || [])
        .some(t => t.object_type && t.object_type.includes("power"));
      const fam = c.type ? cableFamily(c.type) : (isPower ? "power" : "default");
      by.set(fam, (by.get(fam) || 0) + 1);
    }
    return FAMILY_ORDER.filter(f => by.has(f))
      .map(fam => ({ fam, label: fam === "default" ? "без типа" : FAMILY_LABEL[fam], count: by.get(fam) }));
  }

  // отрисовка секции
  _section(title, rows) {
    const sec = document.createElement("div");
    sec.className = "fl-sec";
    const h = document.createElement("div");
    h.className = "fl-sub";
    h.textContent = title;
    sec.appendChild(h);
    for (const r of rows) sec.appendChild(this._row(r));
    return sec;
  }

  _row(r) {
    const row = document.createElement("label");
    row.className = "fl-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !r.hidden;   // отмечена = видима
    cb.addEventListener("change", () => r.toggle(!cb.checked));
    const sw = document.createElement("span");
    sw.className = "fl-sw " + (r.shape === "line" ? "fl-line" : "fl-box");
    if (r.shape === "line") sw.style.background = r.color;
    else sw.style.borderColor = r.color;
    const name = document.createElement("span");
    name.className = "fl-name";
    name.textContent = r.label;
    const cnt = document.createElement("span");
    cnt.className = "fl-cnt";
    cnt.textContent = r.count;
    row.append(cb, sw, name, cnt);
    return row;
  }

  // скрытие / показ
  _toggleRole(id, hidden) {
    if (hidden) state.hiddenRoles[id] = true; else delete state.hiddenRoles[id];
    this.apply();
  }
  _toggleFam(fam, hidden) {
    if (hidden) state.hiddenFams[fam] = true; else delete state.hiddenFams[fam];
    this.apply();
  }

  // Применить текущее состояние скрытия к DOM. Узлы — по data-role.
  // Провод скрыт, если: (а) его семейство отключено, ИЛИ (б) хотя бы один его
  // конец висит на узле скрытой роли (иначе провод «повис» бы в углу, т.к.
  // геометрия берётся из bounding-rect портов скрытого узла).
  apply() {
    // множество id устройств, чья роль скрыта
    const hiddenDev = new Set();
    for (const dev of (state.devices || [])) {
      const rid = dev.role ? dev.role.id : 0;
      if (state.hiddenRoles[rid]) hiddenDev.add(dev.id);
    }
    document.querySelectorAll("#schema .node[data-role]").forEach(el => {
      el.classList.toggle("flt-hidden", !!state.hiddenRoles[el.dataset.role]);
    });
    // кабель → id устройств на его концах (через state.cables + state.ports)
    document.querySelectorAll("#wires .wire[data-fam]").forEach(el => {
      const famHidden = !!state.hiddenFams[el.dataset.fam];
      const cid = +el.dataset.cable;
      let devHidden = false;
      if (cid) devHidden = this._cableTouchesHidden(cid, hiddenDev);
      el.classList.toggle("flt-hidden", famHidden || devHidden);
    });
  }

  _cableTouchesHidden(cableId, hiddenDev) {
    if (!hiddenDev.size) return false;
    const c = (state.cables || []).find(x => x.id === cableId);
    if (!c) return false;
    // конец кабеля → порт в state.ports → устройство (.dev). Терминации
    // адресуются по object_type+object_id (termKey), как везде в плагине.
    for (const t of [...(c.a_terminations || []), ...(c.b_terminations || [])]) {
      const port = state.ports[termKey(t)];
      if (port?.dev && hiddenDev.has(port.dev.id)) return true;
    }
    return false;
  }
}
