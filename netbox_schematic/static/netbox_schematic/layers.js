"use strict";
// LayerManager: слои-оверлеи поверх physical-схемы
// Единый механизм подсветки логических сущностей, «размазанных» по уже
// нарисованным портам (VLAN, а в будущем Circuits/Wireless/Питание). Выбор
// сущности в панели «Слои» → подсветка причастных портов + затухание
// остального (тот же приём, что hover/trace) → бейдж в тултипе порта.
//
// Сущность НЕ рисуется отдельной нодой — она подсвечивает существующие порты.
// Панель живёт в оверлее схемы (#layers), не скроллится и не масштабируется.

import { $, state, portKey, termKey } from "./core.js";
import { setStatus } from "./api.js";

// Активный слой: { kind, id, portKeys:Set, badge:(port)=>string|null }.
// null — ничего не выбрано. Храним в state, чтобы пережить перерисовку схемы.
export class LayerManager {
  // Цвет подсветки под тип слоя (используется как --layer-color в CSS).
  static LAYER_COLOR = { power: "var(--power)", console: "var(--console)",
    wireless: "var(--wireless)", circuit: "var(--circuit)", vlan: "var(--accent)" };
  constructor(app) {
    this.app = app;
  }

  // VLAN: собрать список VLAN, реально присутствующих на портах
  // Возвращает Map vid → { vlan, portKeys:Set } по загруженным интерфейсам
  // (untagged_vlan + tagged_vlans + qinq_svlan). Только dcim.interface несёт
  // VLAN; остальные типы портов пропускаем.
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

  // Console-связи: порты, участвующие в кабелях console↔console
  // Возвращает Set portKey всех console/console-server-портов, у которых есть
  // кабель (т.е. реально связаны). Слой один (не список), как галочка.
  _collectConsolePorts() {
    const keys = new Set(), cables = new Set();
    const isConsole = ot => ot === "dcim.consoleport" || ot === "dcim.consoleserverport";
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      // Кабель относится к console-слою, если хоть один конец — console-порт.
      if (!terms.some(t => isConsole(t.object_type))) continue;
      cables.add(c.id);
      for (const t of terms) {
        const k = termKey(t);
        if (state.ports[k]) keys.add(k);
      }
    }
    return { keys, cables };
  }

  // Питание: порты цепи питания + провода + суммарная нагрузка
  // Цепь питания в NetBox — это power-port ↔ (кабель) ↔ power-outlet, плюс
  // ВНУТРЕННЯЯ связь outlet.power_port (розетки PDU питаются от его входного
  // порта — кабеля тут нет, ассоциация в самой розетке). Слой один (галочка),
  // как console: подсвечивает все power-порты/розетки, участвующие в питании,
  // И сами power-кабели. Заодно считает нагрузку по allocated_draw/maximum_draw
  // (Вт) — источника PowerFeed в демо-данных нет, поэтому «ёмкость Feed» пока
  // не показываем (см. .md: узел-источник Panel/Feed — следующий шаг).
  _collectPower() {
    const isPowerOt = ot => ot === "dcim.powerport" || ot === "dcim.poweroutlet";
    const keys = new Set(), cables = new Set();
    let allocated = 0, maximum = 0;
    // 1) Порты/розетки на power-кабелях.
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      if (!terms.some(t => isPowerOt(t.object_type))) continue;
      cables.add(c.id);
      for (const t of terms) {
        const k = termKey(t);
        if (state.ports[k]) keys.add(k);
      }
    }
    // 2) Внутренняя связь розетки с питающим её портом (PDU: outlet → power_port).
    //    Провода нет — но обе точки принадлежат цепи, подсвечиваем оба.
    for (const [key, p] of Object.entries(state.ports)) {
      if (p.otype !== "dcim.poweroutlet") continue;
      const pp = p.item.power_port;
      if (!pp) continue;
      const ppKey = portKey("dcim.powerport", pp.id);
      if (state.ports[ppKey]) { keys.add(ppKey); keys.add(key); }
    }
    // 3) Нагрузка: суммируем draw по вовлечённым power-портам (не розеткам —
    //    draw объявляется на потребителе, т.е. на power-port устройства).
    for (const key of keys) {
      const p = state.ports[key];
      if (!p || p.otype !== "dcim.powerport") continue;
      allocated += p.item.allocated_draw || 0;
      maximum += p.item.maximum_draw || 0;
    }
    return { keys, cables, allocated, maximum };
  }

  // Wireless: радио-линки между интерфейсами двух устройств
  // WirelessLink = interface_a ↔ interface_b (оба dcim.interface). Кабеля нет,
  // связь чисто логическая. Считаем по ДАННЫМ (оба устройства линка в текущей
  // группе), а НЕ по state.ports — тот зависит от режима отображения (в физ.
  // режиме wireless-портов нет в DOM, но связь-то существует). Рисование/
  // подсветка потом сами проверят наличие порта в DOM. Слой один (галочка).
  _collectWireless() {
    const pairs = [], keys = new Set();
    const inGroup = new Set((state.devices || []).map(d => d.id));
    for (const wl of state.wirelessLinks || []) {
      const ia = wl.interface_a, ib = wl.interface_b;
      if (!ia || !ib) continue;
      // оба конца должны принадлежать устройствам текущей группы
      const da = ia.device && ia.device.id, db = ib.device && ib.device.id;
      if (!inGroup.has(da) || !inGroup.has(db)) continue;
      const ka = portKey("dcim.interface", ia.id), kb = portKey("dcim.interface", ib.id);
      pairs.push({ id: wl.id, a: ka, b: kb, ssid: wl.ssid || wl.display || "" });
      keys.add(ka); keys.add(kb);
    }
    return { pairs, keys };
  }

  // Circuits: порты, у которых кабель уходит в circuit-терминацию
  // Circuit «уходит в WAN» через CircuitTermination, привязанную кабелем к
  // порту устройства. Возвращает Set portKey таких портов + Map portKey→circuit
  // (для бейджа/значка «в облако»). Один слой (галочка). Данные — из state.cables
  // (кабель circuittermination↔порт) + state.circuitTerms/state.circuits.
  _collectCircuits() {
    const keys = new Set();
    const byPort = new Map();     // portKey → { circuit, term }
    // индексы терминаций и каналов по id
    const termById = new Map((state.circuitTerms || []).map(t => [t.id, t]));
    const circById = new Map((state.circuits || []).map(c => [c.id, c]));
    // state.cables уже отфильтрован по стойкам группы → кабель тут = кабель
    // группы; проверка state.ports НЕ нужна (он зависит от режима отображения).
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

  // рендер панели «Слои»: секция VLAN + секция связей
  renderPanel() {
    const host = $("#layers");
    if (!host) return;
    const vlans = this._collectVlans();
    state._vlanIndex = vlans;   // для тултипа порта (бейджи)
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
    let html = "";

    // Секция VLAN.
    html += `<div class="ly-sub">VLAN (подсветка портов)</div>`;
    if (vlanList.length) {
      html += vlanList.map(({ vlan, portKeys }) =>
        `<button class="ly-item" type="button" data-layer="vlan" data-id="${vlan.id}">
           <span class="ly-dot"></span>
           <span class="ly-name">${vlan.vid != null ? "VLAN " + vlan.vid : ""} ${vlan.name || vlan.display || ""}</span>
           <span class="ly-count">${portKeys.size}</span>
         </button>`).join("");
    } else {
      html += `<div class="ly-empty">VLAN на портах группы нет</div>`;
    }

    // Секция связей (console + питание; далее circuits/wireless).
    html += `<div class="ly-sub">Связи</div>`;
    if (console_.cables.size) {
      html += `<button class="ly-item" type="button" data-layer="console" data-id="0">
           <span class="ly-dot"></span>
           <span class="ly-name">Console-связи</span>
           <span class="ly-count">${console_.cables.size}</span>
         </button>`;
    } else {
      html += `<div class="ly-empty">console-кабелей в группе нет</div>`;
    }
    // Питание: галочка + суммарная нагрузка (Вт) под именем, если объявлена.
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
    // Wireless: галочка, счётчик = число радио-линков в группе.
    if (wireless.pairs.length) {
      html += `<button class="ly-item" type="button" data-layer="wireless" data-id="0">
           <span class="ly-dot" style="border-color:var(--wireless,#b98cff)"></span>
           <span class="ly-name">Wireless (радио)</span>
           <span class="ly-count">${wireless.pairs.length}</span>
         </button>`;
    } else {
      html += `<div class="ly-empty">радио-линков в группе нет</div>`;
    }
    // Circuits: галочка, счётчик = число портов с выходом в circuit.
    if (circuits.keys.size) {
      html += `<button class="ly-item" type="button" data-layer="circuit" data-id="0">
           <span class="ly-dot" style="border-color:var(--circuit,#4fc3e8)"></span>
           <span class="ly-name">Circuits (в WAN)</span>
           <span class="ly-count">${circuits.keys.size}</span>
         </button>`;
    } else {
      html += `<div class="ly-empty">circuit-выходов в группе нет</div>`;
    }

    html += `<button class="ly-clear" type="button"><i class="mdi mdi-close"></i> снять подсветку</button>`;
    body.innerHTML = html;

    // Клик по пункту — тоггл: повторный клик по активному снимает выбор.
    body.querySelectorAll(".ly-item").forEach(btn => {
      btn.addEventListener("click", () => this._toggle(btn.dataset.layer, +btn.dataset.id));
    });
    body.querySelector(".ly-clear").addEventListener("click", () => this.clear());

    // Восстановить активный слой после перерисовки схемы.
    if (state.activeLayer) this._restoreActive();
    this._syncPanelState();
  }

  // Тоггл слоя по (kind,id): повторный клик по активному снимает.
  _toggle(kind, id) {
    if (state.activeLayer && state.activeLayer.kind === kind && state.activeLayer.id === id) {
      this.clear();
      return;
    }
    // Слой живёт в «своём» режиме отображения: wireless/circuit — в сетевом,
    // остальные (vlan/console/power) — в физическом. Клик по «чужому» слою
    // сначала переключает режим (там его порты видны), потом подсвечивает.
    const needNet = kind === "wireless" || kind === "circuit";
    const wantMode = needNet ? "net" : "phys";
    if (state.viewMode !== wantMode && this.app.schema) {
      state.viewMode = wantMode;
      this.app.schema.applyViewMode();   // перекладка узлов под нужный режим
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

  // Восстановить активный слой после перерисовки (данные могли исчезнуть).
  _restoreActive() {
    const a = state.activeLayer;
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

  // выбор VLAN → подсветка
  selectVlan(vid) {
    const entry = state._vlanIndex && state._vlanIndex.get(vid);
    if (!entry) { this.clear(); return; }
    state.activeLayer = { kind: "vlan", id: vid, portKeys: entry.portKeys };
    this._applyHighlight(entry.portKeys);
    const v = entry.vlan;
    setStatus(`VLAN ${v.vid ?? ""} ${v.name || ""}: ${entry.portKeys.size} портов`, "ok");
    this._syncPanelState();
  }

  // выбор Console-слоя → подсветка console-портов
  selectConsole() {
    const keys = state._consolePorts || new Set();
    if (!keys.size) { this.clear(); return; }
    const cables = state._consoleCables || new Set();
    state.activeLayer = { kind: "console", id: 0, portKeys: keys, cables };
    this._applyHighlight(keys, cables);
    setStatus(`Console-связи: ${cables.size} (портов: ${keys.size})`, "ok");
    this._syncPanelState();
  }

  // выбор слоя «Питание» → подсветка цепи питания
  selectPower() {
    const power = state._power;
    if (!power || !power.keys.size) { this.clear(); return; }
    state.activeLayer = { kind: "power", id: 0, portKeys: power.keys, cables: power.cables };
    this._applyHighlight(power.keys, power.cables);
    const load = power.allocated ? `, нагрузка ${power.allocated} Вт` : "";
    setStatus(`Питание: ${power.cables.size} кабелей (портов: ${power.keys.size})${load}`, "ok");
    this._syncPanelState();
  }

  // выбор слоя «Wireless» → подсветка интерфейсов + волнистые линии
  selectWireless() {
    const w = state._wireless;
    if (!w || !w.pairs.length) { this.clear(); return; }
    state.activeLayer = { kind: "wireless", id: 0, portKeys: w.keys, pairs: w.pairs };
    this._applyHighlight(w.keys);
    // радио-линии рисует схема (у линка нет кабеля → своя геометрия)
    if (this.app.schema) this.app.schema.drawRadioLinks();
    setStatus(`Wireless: ${w.pairs.length} радио-линков (интерфейсов: ${w.keys.size})`, "ok");
    this._syncPanelState();
  }

  // выбор слоя «Circuits» → подсветка портов с выходом в WAN
  selectCircuits() {
    const c = state._circuits;
    if (!c || !c.keys.size) { this.clear(); return; }
    state.activeLayer = { kind: "circuit", id: 0, portKeys: c.keys };
    this._applyHighlight(c.keys);
    // Circuits и Wireless живут в одном (сетевом) режиме — при выборе Circuits
    // радио-линии не должны пропадать. drawRadioLinks в сетевом режиме рисует
    // все радио-линки независимо от активного слоя.
    if (this.app.schema) this.app.schema.drawRadioLinks();
    setStatus(`Circuits: ${c.keys.size} выход${c.keys.size === 1 ? "" : "ов"} в WAN`, "ok");
    this._syncPanelState();
  }


  // Отметить активный пункт и показать/скрыть «снять подсветку».
  _syncPanelState() {
    const host = $("#layers");
    if (!host) return;
    const a = state.activeLayer;
    host.querySelectorAll(".ly-item").forEach(btn =>
      btn.classList.toggle("active", !!a && btn.dataset.layer === a.kind && +btn.dataset.id === a.id));
    const clear = host.querySelector(".ly-clear");
    if (clear) clear.style.display = a ? "flex" : "none";
  }

  // общий механизм подсветки портов (переиспользуемый)
  // Гасит все узлы/порты/провода, подсвечивает переданные порты и их узлы.
  // hlCables (Set id) — кабели, которые НЕ гасим, а подсвечиваем (для слоёв,
  // где смысл именно в проводах, напр. console-связи).
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
    document.body.classList.add("layer-active");
    // Подсветка узлов/портов — под цвет ТИПА слоя (питание → оранжевый и т.д.),
    // а не всегда accent. CSS читает var(--layer-color).
    document.body.style.setProperty("--layer-color", LayerManager.LAYER_COLOR[
      state.activeLayer && state.activeLayer.kind] || "var(--accent)");
  }

  // Заново наложить классы активного слоя на ПРОВОДА после того, как схема их
  // пересоздала (redrawWires чистит svg → провода теряют layer-hl/layer-dim).
  // Порты/узлы при зуме не пересоздаются и классы сохраняют, поэтому трогаем
  // только пути. Иначе при смене масштаба выделение слоя «сбрасывалось»
  // (провода переставали тускнеть). Для wireless провода рисует drawRadioLinks.
  reapplyToWires() {
    const a = state.activeLayer;
    if (!a) return;
    const hlCables = a.cables;
    document.querySelectorAll("#wires path.wire").forEach(w => {
      const keep = hlCables && hlCables.has(+w.dataset.cable);
      w.classList.toggle("layer-hl", !!keep);
      w.classList.toggle("layer-dim", !keep);
    });
  }

  clear() {
    const wasWireless = state.activeLayer && state.activeLayer.kind === "wireless";
    state.activeLayer = null;
    Object.values(state.ports).forEach(p => p.el.classList.remove("layer-hl", "layer-dim"));
    Object.values(state.nodeEls).forEach(el => el.classList.remove("layer-hl", "layer-dim"));
    document.querySelectorAll("#wires path.wire").forEach(w => w.classList.remove("layer-dim", "layer-hl"));
    document.body.classList.remove("layer-active");
    document.body.style.removeProperty("--layer-color");
    // убрать нарисованные радио-линии (drawRadioLinks сам ничего не рисует,
    // когда слой не wireless — но старые пути надо снять)
    if (wasWireless && this.app.schema) this.app.schema.drawRadioLinks();
    this._syncPanelState();
  }

  // Бейдж для тултипа порта, зависит от типа порта:
  //  · интерфейс → список VLAN, которые он несёт;
  //  · power-port/outlet → нагрузка (Вт) и питающий порт (для розетки PDU).
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
    // радио-линк на этом интерфейсе (по ключу порта)
    const key = portKey(otype, id);
    const wl = (state._wireless?.pairs || []).find(pr => pr.a === key || pr.b === key);
    if (wl) parts.push("Wireless" + (wl.ssid ? ": " + wl.ssid : ""));
    // circuit-выход в WAN на этом порту
    const circ = state._circuits?.byPort?.get(key);
    if (circ) {
      const c = circ.circuit;
      const cid = c ? (c.cid || c.display || "") : "";
      const prov = c && c.provider ? (c.provider.name || c.provider.display || "") : "";
      parts.push("Circuit → WAN" + (cid ? ": " + cid : "") + (prov ? " (" + prov + ")" : ""));
    }
    return parts.length ? parts.join(" · ") : null;
  }

  // Бейдж питания: draw для power-port, питающий порт для розетки PDU.
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
