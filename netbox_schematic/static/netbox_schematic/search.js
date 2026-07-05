"use strict";
// Поиск устройства по имени
// Быстрая самодостаточная фича (не слой): фильтрует УЖЕ загруженные
// устройства текущей группы (state.devices) по подстроке имени и по клику
// центрирует найденный узел на схеме (app.schema.focusDevice).
//
// Поле живёт в шапке, но прибито к ПРАВОЙ границе блока «Схема»: geometry
// #schempwrap → inline right/width (positionSearch), чтобы «висеть» ровно
// над схемой, а не над паспортом устройства (#detail).

import { $, state } from "./core.js";

const MAX_RESULTS = 12;

export class SearchManager {
  constructor(app) {
    this.app = app;
    this.box = $("#devsearch");
    this.inp = $("#devsearch-inp");
    this.results = $("#devsearch-results");
    this.clearBtn = $("#devsearch-clear");
    if (!this.box) return;
    this.items = [];   // текущие отрисованные результаты [{dev, el}]
    this.active = -1;  // индекс подсвеченного пункта (для стрелок клавиатуры)
    this._wire();
    this.position();
  }

  // выравнивание по правой границе схемы
  // #schempwrap занимает пространство между ресайзером и паспортом; его правый
  // край = где заканчивается схема. Ставим поле так, чтобы его правый край
  // совпадал с правым краем схемы, а левый не заезжал за середину топбара.
  position() {
    if (!this.box) return;
    const bar = $("#topbar"), wrap = $("#schempwrap");
    if (!bar || !wrap) return;
    const barRect = bar.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    // если схема скрыта (холст в разработке) — прячем поиск
    if (wrapRect.width === 0) { this.box.style.display = "none"; return; }
    this.box.style.display = "";
    const right = Math.max(8, barRect.right - wrapRect.right);
    // ширина поля: до ~340px, но не шире правой части топбара
    const avail = wrapRect.width - 12;
    const width = Math.max(150, Math.min(320, avail));
    this.box.style.right = right + "px";
    this.box.style.width = width + "px";
  }

  _wire() {
    this.inp.addEventListener("input", () => this._onInput());
    this.inp.addEventListener("focus", () => { if (this.inp.value.trim()) this._open(); });
    this.inp.addEventListener("keydown", e => this._onKey(e));
    this.clearBtn.addEventListener("click", () => this._reset(true));
    // клик вне — закрыть список
    document.addEventListener("mousedown", e => {
      if (!this.box.contains(e.target)) this._close();
    });
    window.addEventListener("resize", () => this.position());
    // ресайзер стоек двигает правую границу схемы — репозиционируем
    const rz = $("#resizer");
    if (rz) window.addEventListener("mousemove", () => { if (rz.classList.contains("drag")) this.position(); });
  }

  _onInput() {
    const q = this.inp.value.trim();
    this.box.classList.toggle("has-text", q.length > 0);
    if (!q) { this._close(); return; }
    this._render(this._match(q));
    this._open();
  }

  // подстрочный поиск (без регистра) по устройствам текущей группы
  _match(q) {
    const ql = q.toLowerCase();
    const out = [];
    for (const dev of (state.devices || [])) {
      const name = dev.name || dev.display || ("#" + dev.id);
      const idx = name.toLowerCase().indexOf(ql);
      if (idx !== -1) out.push({ dev, name, idx, qlen: ql.length });
    }
    // сначала совпадения с начала имени, затем по алфавиту
    out.sort((a, b) => (a.idx - b.idx) || a.name.localeCompare(b.name));
    return out.slice(0, MAX_RESULTS);
  }

  _render(matches) {
    this.results.innerHTML = "";
    this.items = [];
    this.active = -1;
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "ds-empty";
      empty.textContent = state.devices?.length
        ? "Ничего не найдено в этой группе"
        : "Выбери серверную — появятся устройства";
      this.results.appendChild(empty);
      return;
    }
    for (const m of matches) {
      const dev = m.dev;
      const role = (dev.role && state.roles[dev.role.id]) || { color: "607d8b", name: "" };
      const el = document.createElement("div");
      el.className = "ds-item";
      const dot = document.createElement("span");
      dot.className = "ds-dot";
      dot.style.background = "#" + role.color;
      const nameEl = document.createElement("span");
      nameEl.className = "ds-name";
      nameEl.append(...highlight(m.name, m.idx, m.qlen));
      const meta = document.createElement("span");
      meta.className = "ds-meta";
      meta.textContent = role.name || "";
      el.append(dot, nameEl, meta);
      const entry = { dev, el };
      el.addEventListener("mouseenter", () => this._setActive(this.items.indexOf(entry)));
      el.addEventListener("click", () => this._pick(dev));
      this.results.appendChild(el);
      this.items.push(entry);
    }
  }

  _onKey(e) {
    if (e.key === "Escape") { this._reset(false); this.inp.blur(); return; }
    if (!this.items.length) {
      if (e.key === "Enter") { const m = this._match(this.inp.value.trim()); if (m[0]) this._pick(m[0].dev); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); this._setActive((this.active + 1) % this.items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); this._setActive((this.active - 1 + this.items.length) % this.items.length); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const pick = this.active >= 0 ? this.items[this.active] : this.items[0];
      if (pick) this._pick(pick.dev);
    }
  }

  _setActive(i) {
    this.items.forEach((it, k) => it.el.classList.toggle("active", k === i));
    this.active = i;
    if (this.items[i]) this.items[i].el.scrollIntoView({ block: "nearest" });
  }

  _pick(dev) {
    this._close();
    this.inp.value = dev.name || dev.display || ("#" + dev.id);
    this.box.classList.add("has-text");
    // центрируем узел на схеме и коротко подсвечиваем (focusDevice уже делает hl)
    if (this.app.schema && state.nodeEls?.[dev.id]) {
      this.app.schema.focusDevice(dev);
    }
    // и открываем паспорт устройства справа
    if (this.app.device) this.app.device.show(dev);
  }

  _open() { this.box.classList.add("open"); }
  _close() { this.box.classList.remove("open"); }
  _reset(focus) {
    this.inp.value = "";
    this.box.classList.remove("has-text");
    this.results.innerHTML = "";
    this.items = []; this.active = -1;
    this._close();
    if (focus) this.inp.focus();
  }
}

// разбивает имя на [до] <b>совпадение</b> [после] как текстовые/жирные узлы
function highlight(name, idx, len) {
  if (idx < 0) return [document.createTextNode(name)];
  const before = name.slice(0, idx);
  const hit = name.slice(idx, idx + len);
  const after = name.slice(idx + len);
  const b = document.createElement("b");
  b.textContent = hit;
  const nodes = [];
  if (before) nodes.push(document.createTextNode(before));
  nodes.push(b);
  if (after) nodes.push(document.createTextNode(after));
  return nodes;
}
