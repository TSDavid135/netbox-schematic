"use strict";
// SchemaManager: 2D-схема соединений
// Рисует узлы-устройства с портами, кабели-провода, режим прицеливания и
// прокладку/удаление кабелей. Режим правки схемы — Mode.on("schema").

import {
  $, state, mk, px, attachTip, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox } from "./schema_util.js";

const EP_TO_OTYPE = { "interfaces": "dcim.interface", "front-ports": "dcim.frontport",
  "rear-ports": "dcim.rearport", "power-ports": "dcim.powerport", "power-outlets": "dcim.poweroutlet" };

export class SchemaManager {
  constructor(app) {
    this.app = app;
    this.LEFT_PAD = 80;
    this.TOP_PAD = 150;
    this.linkmenu = $("#linkmenu");
    this.cablepop = $("#cablepop");
    this._wire();
    // При выключении режима схемы — сбрасываем начатую прокладку кабеля
    // и закрываем открытый поповер выбора типа.
    Mode.onChange("schema", active => {
      if (!active) { this.setPending(null); if (this._closeCablePop) this._closeCablePop(); }
      // Смена режима стройки без полного renderAll: перекладка узлов (в net —
      // зелёные назначаемые порты и wireless-«+»), перерисовка щитков («+ фидер»).
      if (Object.keys(state.nodeEls).length) {
        this.relayoutNodes();
        this._rerenderPowerPanels();
        this.redrawWires();
      }
    });
  }

  // стороны портов
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
    const top = [], bottom = [];
    for (const g of groups) {
      const o = g.kind.otype;
      let up;
      if (o === "dcim.frontport" || o === "dcim.rearport") up = cross.has(o) ? trunkUp : !trunkUp;
      else if (o === "dcim.interface") up = true;
      else if (o === "dcim.poweroutlet") up = true;
      else up = false;   // питание (power-port) и console — вниз
      (up ? top : bottom).push(g);
    }
    return { top, bottom };
  }

  _computePads(pane) {
    this.LEFT_PAD = Math.max(80, Math.round(pane.clientWidth * 0.45));
    this.TOP_PAD = Math.max(150, Math.round(pane.clientHeight * 0.4));
  }

  // раскладка ОДНОГО узла: порты + ширина по текущему режиму
  // Порты «привязаны к углу» подписи: левые группы (front/interfaces/console) —
  // от левого края вправо, питание — от правого края влево. Rear повторяет
  // левый якорь верха → порт N снизу ровно под портом N сверху. Ширина — по
  // видимым портам (мин. размер). Сетевой вид: верх = проводные (Circuits),
  // низ = радио (Wireless). Метод переиспользуется при смене режима/edit
  // (перерисовка без полного renderAll — см. relayoutNodes).
  _layoutNode(dev, node) {
    const MIN_W = 170, EDGE = (STEP - DOT) / 2 + 4;
    const net = state.viewMode === "net";
    const edit = Mode.on("schema");
    const { top, bottom } = this._assignSides(dev, node._groups || []);
    // Правый якорь нижнего ряда — только CONSOLE (console/console-server). Всё
    // остальное внизу (ПИТАНИЕ слева снизу + front/rear-магистраль) — ЛЕВЫЙ
    // якорь, чтобы rear встал под front (порт N под портом N). Магистраль в
    // левом кластере идёт ПЕРВОЙ (сохраняет выравнивание), питание — следом.
    const isPowerKind = k => k.otype === "dcim.powerport" || k.otype === "dcim.poweroutlet";
    const isConsoleKind = k => k.otype === "dcim.consoleport" || k.otype === "dcim.consoleserverport";

    // Видимость порта в текущем режиме: net → только сетевые, phys → только физ.
    const visItems = g => g.items.filter(it => this._isNetPort(g.kind.otype, it) === net);
    const visGroups = rows => rows.map(g => ({ g, items: visItems(g) })).filter(x => x.items.length);

    let topV, botLeftV, botRightV;
    if (net) {
      // СЕТЕВОЙ режим (порты — состояния, не создаём/не скрываем):
      //  · верх «Circuits» = ВСЕ проводные (не-радио) интерфейсы — кандидаты в
      //    circuit; с circuit → облако, свободные в edit → зелёные, прочие блёкло;
      //  · низ «Wireless» = только радио-интерфейсы (ieee802.11*).
      const ifaceGroups = (node._groups || []).filter(g => g.kind.otype === "dcim.interface");
      const pick = pred => ifaceGroups
        .map(g => ({ g, items: g.items.filter(pred) }))
        .filter(x => x.items.length);
      topV = pick(it => !this._isWirelessItem(it));   // все проводные → верх
      botLeftV = pick(it => this._isWirelessItem(it)); // радио → низ
      botRightV = [];
    } else {
      topV = visGroups(top);
      // Слева снизу: магистраль (front/rear) ПЕРВОЙ — под front, затем ПИТАНИЕ.
      // Справа снизу: CONSOLE. (раньше было наоборот — питание справа.)
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

    // Ширина: max(мин, верхний ряд, нижние кластеры с зазором). В сетевом виде +
    // правка резервируем слот под зелёный «+» (создать wireless-интерфейс).
    const addWl = net && edit ? 1 : 0;
    const GAP_MID = (nBotL + addWl) && nBotR ? STEP : 0;
    const topNeed = nTop ? EDGE * 2 + nTop * STEP : 0;
    const botNeed = (nBotL + addWl + nBotR) ? EDGE * 2 + (nBotL + addWl + nBotR) * STEP + GAP_MID : 0;
    const width = Math.max(MIN_W, topNeed, botNeed);

    node.style.width = width + "px";
    node.style.left = (node._x0 + (COL_W - BOX_PAD - width) / 2) + "px";

    // Пересобрать содержимое: имя/модель + подписи + порты.
    node.innerHTML = `<span class="nm">${dev.name}</span><span class="mdl">${dev.device_type.model} · U${dev.position}</span>`;
    node.querySelector(".nm").addEventListener("click", () => this.app.device.show(dev));

    // Подписи групп. В СЕТЕВОМ режиме: верх — Circuits (все проводные), низ —
    // Wireless (радио). В ФИЗИЧЕСКОМ: верх — типы портов, низ — console/питание.
    if (net) {
      if (topV.length) node.insertAdjacentHTML("beforeend",
        `<span class="edge-label t">Circuits</span>`);
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

    // Верхний ряд + нижний-левый: от ЛЕВОГО края вправо (порт N под портом N).
    let i = 0;
    for (const { g, items } of topV)
      for (const item of items)
        this._placeDot(node, dev, g, item, i + 1, true, EDGE + (i++) * STEP);
    let l = 0;
    for (const { g, items } of botLeftV)
      for (const item of items)
        this._placeDot(node, dev, g, item, l + 1, false, EDGE + (l++) * STEP);
    // Нижний-правый (питание): от ПРАВОГО края влево.
    let j = 0;
    for (const { g, items } of botRightV)
      for (const item of items) {
        const fromRight = nBotR - j;
        this._placeDot(node, dev, g, item, j + 1, false, width - EDGE - DOT - (fromRight - 1) * STEP);
        j++;
      }
    // Зелёный «+» в ряду Wireless (сетевой вид + правка): создать НАСТОЯЩИЙ
    // wireless-интерфейс. Это логический порт (радио), добавляется свободно —
    // в отличие от физических гнёзд (см. обсуждение). Есть у КАЖДОГО узла.
    if (net && edit) this._placeAddWireless(node, dev, EDGE + nBotL * STEP);
  }

  // Зелёный «+» для создания wireless-интерфейса. Ставится в ряду Wireless
  // после последнего радио-порта (или в начале, если их нет).
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

  // Разместить один порт-кружок в узле. leftPx — левая координата ячейки.
  _placeDot(node, dev, g, item, ordinal, isTop, leftPx) {
    const dot = document.createElement("div");
    const net = state.viewMode === "net";
    const edit = Mode.on("schema");
    const isNet = this._isNetPort(g.kind.otype, item);
    const isCircuit = g.kind.otype === "dcim.interface" && this._isCircuitItem(item);
    const isWl = g.kind.otype === "dcim.interface" && this._isWirelessItem(item);
    // «Занят» = есть кабель ИЛИ радио-линк ИЛИ circuit-выход. У wireless кабеля
    // нет (радио), но порт занят линком → закрашиваем как все занятые.
    const used = !!item.cable || !!item.wireless_link || isCircuit;
    // Подача в СЕТЕВОМ виде: circuit/wireless — ярко; свободный в edit —
    // зелёный (назначаемый); прочие (занятые физически, не сетевые) — блёкло.
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
    // Значок «в облако» у circuit-порта (выход в WAN) — иконка над кружком.
    if (isCircuit) {
      const cloud = mk("i", { className: "mdi mdi-cloud-outline port-cloud",
        title: "Выход в WAN (Circuit)" });
      dot.appendChild(cloud);
    }
    attachTip(dot, () => this._portTip(dev, g.kind, item));
    dot.addEventListener("mouseenter", () => this._portHover(state.ports[portKey(g.kind.otype, item.id)], true));
    dot.addEventListener("mouseleave", () => this._portHover(state.ports[portKey(g.kind.otype, item.id)], false));
    dot.addEventListener("click", ev => { ev.stopPropagation(); this._onPortClick(g.kind, item, dev, dot, ev); });
    dot.addEventListener("dblclick", ev => { ev.stopPropagation(); ev.preventDefault(); this._onPortDblClick(g.kind, item); });
    node.appendChild(dot);
    state.ports[portKey(g.kind.otype, item.id)] =
      { el: dot, item, dev, otype: g.kind.otype, ep: g.kind.ep, side: isTop ? "t" : "b" };
  }

  // Перераскладка ВСЕХ узлов (смена режима отображения / режима стройки).
  // Порты пересоздаются → state.ports и провода надо обновить.
  relayoutNodes() {
    for (const [id, node] of Object.entries(state.nodeEls)) {
      const dev = state.devices.find(d => d.id === +id);
      if (dev && node._groups) this._layoutNode(dev, node);
    }
    this.redrawWires();
  }

  render(group, byRack, devPorts) {
    this._lastRender = { group, byRack, devPorts };   // для перерисовки (промежуток нод)
    const pane = $("#schempane");
    this._computePads(pane);
    const loc = currentLocationName();
    const title = loc ? `Схема соединений : ${loc}` : "Схема соединений";
    pane.innerHTML = `<p class="pane-title"><button id="rack-expand" class="pane-toggle" title="Показать блок стоек"><i class="mdi mdi-chevron-right"></i></button><span class="pt-label">${title}</span></p>
      <div id="schema"><svg id="wires" class="${state.wiresAbovePorts ? "above-ports" : ""}"></svg></div>
      <div id="zoomhint">масштаб 100% · Ctrl+колесо или колесо</div>`;
    $("#schemoverlay").innerHTML = `
      ${modeBtn("schema", "schem-mid")}
      <div id="schem-topright">
        <div class="st-topbar">
          <div id="viewswitch" title="Режим отображения схемы" data-view="${state.viewMode}">
            <button class="vs-btn" data-view="phys"><i class="mdi mdi-lan"></i> Физический</button>
            <button class="vs-btn" data-view="net"><i class="mdi mdi-access-point-network"></i> Сетевой</button>
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
          <span><span class="dotd" style="border-color:var(--circuit)"></span>☁ выход в WAN (Circuit)</span>
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
    const whRange = $("#st-wireheight"), whVal = $("#st-wh-val");
    whRange.addEventListener("input", () => {
      state.wireHeightK = parseFloat(whRange.value);
      whVal.textContent = state.wireHeightK.toFixed(1) + "×";
      this.redrawWires();
    });
    // Промежуток между нодами в стойке. Меняет РАСКЛАДКУ (позиции узлов, высоту
    // боксов) → нужна полная перерисовка схемы. Live-подпись по input, сам
    // пересбор — по change (release), чтобы перестройка DOM не рвала перетаскивание.
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
    // Стиль проводов: «Круглые» (дуги) / «Углы» (Manhattan + мостики).
    $("#st-wirestyle").querySelectorAll(".st-seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.style === state.wireStyle) return;
        state.wireStyle = btn.dataset.style;
        $("#st-wirestyle").querySelectorAll(".st-seg-btn").forEach(b =>
          b.classList.toggle("active", b.dataset.style === state.wireStyle));
        this.redrawWires();
      });
    });
    // Трасса углов: «Короткий» (напрямую) / «Расширенный» (в обход нод).
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
    const rackMeta = {};   // rack.id → {col, bottom, rack} — для контуров области

    group.forEach((rack, col) => {
      const x0 = LEFT_PAD + col * (COL_W + COL_GAP) + BOX_PAD;
      const box = mk("div", { className: "rackbox", html: `<span class="rb-label">стойка ${rack.name}</span>`,
        style: { left: (x0 - BOX_PAD) + "px", top: (TOP_PAD - 34) + "px", width: (COL_W + BOX_PAD) + "px" } });
      canvas.appendChild(box);
      state.rackBoxEls[rack.id] = box;

      let y = TOP_PAD;
      let idx = 0;
      const devs = byRack[rack.id].filter(d => d.position != null).sort((a, b) => b.position - a.position);
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
        node._x0 = x0;                 // левый край колонки — для центровки при пересчёте
        node._groups = groupsHere;     // порт-группы устройства — для перераскладки
        canvas.appendChild(node);
        state.nodeEls[dev.id] = node;
        this._layoutNode(dev, node);   // раскладка портов + ширина (по режиму)
        y += 64 + (state.nodeGap ?? NODE_GAP);
      }
      box.style.height = (y - TOP_PAD + 20) + "px";
      rackMeta[rack.id] = { col, bottom: y - 14, rack };   // низ = верх бокса + высота
      maxBottom = Math.max(maxBottom, y + 40);
    });

    // Пунктирные контуры серверных/площадок поверх ряда стоек (при выборе
    // площадки/региона в дереве). Локация без внешних контуров.
    this._renderScopeContours(canvas, group, rackMeta);

    // Электропитание: щитки под стойками, по центру всей ширины
    // Power Panel рисуется НЕ юнитом стойки, а отдельным пунктирным блоком
    // ПОД стойками, по центру (среднее арифметическое по горизонтали всего
    // ряда стоек). Название «Щиток …» — в левом верхнем углу, как у стоек.
    this._powerBaseBottom = maxBottom;   // низ ряда стоек — откуда рисуются щитки
    maxBottom = this._renderPowerPanels(canvas, group, maxBottom);

    const rightPad = Math.max(EXTRA, LEFT_PAD), botPad = Math.max(EXTRA * 0.6, TOP_PAD);
    canvas.style.width = (LEFT_PAD + group.length * (COL_W + COL_GAP) + rightPad) + "px";
    canvas.style.height = (maxBottom + botPad) + "px";
    // Первая отрисовка — скроллбары посередине.
    pane.scrollLeft = (canvas.offsetWidth - pane.clientWidth) / 2;
    pane.scrollTop = (canvas.offsetHeight - pane.clientHeight) / 2;
  }

  // Пунктирные контуры-обёртки над рядом стоек по уровням иерархии выбранной
  // области (state.scope): выбор площадки → каждая её серверная в контуре;
  // выбор региона → ещё и каждая площадка (внутри — её серверные). Локация
  // (одна серверная) рисуется без внешних контуров. Стойки уже отсортированы
  // площадка→серверная→стойка (см. TreeManager._racksFor) → колонки группы
  // идут подряд, контур = прямоугольник от minCol до maxCol.
  _renderScopeContours(canvas, group, rackMeta) {
    this._contours = [];   // сбрасываем ссылки (переживают redrawWires для fit)
    const scope = state.scope;
    if (!scope || scope.type === "location" || !group.length) return;
    const { LEFT_PAD, TOP_PAD } = this;
    const top0 = TOP_PAD - 34;   // верх бокса стойки
    const boxOf = (racks, padX, padTop, padBot) => {
      const cols = racks.map(r => rackMeta[r.id].col);
      const minCol = Math.min(...cols), maxCol = Math.max(...cols);
      const left = LEFT_PAD + minCol * (COL_W + COL_GAP);
      const right = LEFT_PAD + maxCol * (COL_W + COL_GAP) + COL_W + BOX_PAD;
      const bottom = Math.max(...racks.map(r => rackMeta[r.id].bottom));
      return { left: left - padX, top: top0 - padTop,
        width: (right - left) + padX * 2, height: (bottom - top0) + padTop + padBot };
    };
    // Location-контуры (серверные) — базовая геометрия. Их «подрастание» под
    // свои внутренние провода считается в _fitContoursToWires (phase 1).
    const locs = [];
    for (const [lid, racks] of groupByKey(group, r => r.location && r.location.id)) {
      if (lid == null) continue;
      const loc = racks[0].location;
      const base = boxOf(racks, 13, 22, 12);
      const el = this._contourEl("gb-loc", "серверная " + (loc ? loc.name : "?"), base);
      locs.push({ el, base, kind: "loc", rackIds: new Set(racks.map(r => r.id)),
        siteId: racks[0].site && racks[0].site.id });
    }
    // Site-контуры (площадки) — для региона И группы мест (обе могут охватывать
    // несколько площадок). Геометрия НЕ от стоек, а ОБЪЕДИНЕНИЕ уже подросших
    // location-контуров (phase 2), чтобы площадка всегда охватывала свои
    // серверные и не пересекалась с ними (small_fix п.2).
    const sites = [];
    if (scope.type === "region" || scope.type === "sitegroup") {
      for (const [, racks] of groupByKey(group, r => r.site && r.site.id)) {
        const site = racks[0].site;
        const base = boxOf(racks, 28, 48, 26);
        const el = this._contourEl("gb-site", "площадка " + (site ? site.name : "?"), base);
        sites.push({ el, base, kind: "site", rackIds: new Set(racks.map(r => r.id)),
          children: locs.filter(c => c.siteId === (site && site.id)) });
      }
    }
    this._contours = [...sites, ...locs];
    // z-порядок: сначала в DOM площадки (позади), потом серверные (поверх), и
    // все — ПЕРЕД стойками (позади узлов). Так рамки/подписи не перекрывают ноды.
    const frag = document.createDocumentFragment();
    for (const ct of [...sites, ...locs]) frag.appendChild(ct.el);
    canvas.insertBefore(frag, canvas.firstChild);
    this._fitContoursToWires();   // на случай, если провода уже нарисованы
  }
  _contourEl(cls, label, g) {
    return mk("div", { className: "groupbox " + cls,
      html: `<span class="gb-label">${label}</span>`,
      style: { left: g.left + "px", top: g.top + "px", width: g.width + "px", height: g.height + "px" } });
  }

  // Раскладывает контуры в ДВЕ фазы, чтобы уровни не накладывались (small_fix
  // п.2), а межплощадочные провода не «затягивали» рамку внутрь (п.3). Всё в
  // координатах схемы (getBBox = userspace, не зависит от CSS-зума). Идемпотентно.
  //  Phase 1 — серверные: рамка растёт под свои ВНУТРЕННИЕ провода (оба конца в
  //    этой серверной). Провода в другую серверную/площадку выходят наружу.
  //  Phase 2 — площадки: рамка = ОБЪЕДИНЕНИЕ подросших серверных внутри неё
  //    (+ отступ) → площадка гарантированно охватывает свои серверные; плюс
  //    внутриплощадочные провода (оба конца в этой площадке). Провода между
  //    разными Site рамку не двигают (п.3: механизм «внутри» к ним не применим).
  _fitContoursToWires() {
    const list = this._contours;
    if (!list || !list.length) return;
    const svg = $("#wires");
    const paths = svg ? svg.querySelectorAll("path.wire") : [];
    // Кабель → пара стоек его концов (для проверки «внутренний ли провод»).
    const cableRacks = {};
    for (const c of state.cables) {
      const aT = (c.a_terminations || [])[0], bT = (c.b_terminations || [])[0];
      if (!aT || !bT) continue;
      const a = state.ports[termKey(aT)], b = state.ports[termKey(bT)];
      if (a && b) cableRacks[c.id] = [state.devRack[a.dev.id], state.devRack[b.dev.id]];
    }
    // Расширить box границами всех проводов, ВНУТРЕННИХ для набора стоек rackIds.
    const growByInnerWires = (box, rackIds, pad) => {
      let x0 = box.left, y0 = box.top, x1 = box.left + box.width, y1 = box.top + box.height;
      for (const p of paths) {
        const rr = cableRacks[+p.dataset.cable];
        if (!rr || !rackIds.has(rr[0]) || !rackIds.has(rr[1])) continue;
        let bb; try { bb = p.getBBox(); } catch { continue; }
        x0 = Math.min(x0, bb.x - pad); y0 = Math.min(y0, bb.y - pad);
        x1 = Math.max(x1, bb.x + bb.width + pad); y1 = Math.max(y1, bb.y + bb.height + pad);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    };
    const apply = ct => {
      ct.el.style.left = ct._box.left + "px"; ct.el.style.top = ct._box.top + "px";
      ct.el.style.width = ct._box.width + "px"; ct.el.style.height = ct._box.height + "px";
    };
    // Phase 1 — серверные.
    for (const ct of list) {
      if (ct.kind !== "loc") continue;
      ct._box = growByInnerWires(ct.base, ct.rackIds, 8);
      apply(ct);
    }
    // Phase 2 — площадки: объединение подросших серверных + внутренние провода.
    for (const ct of list) {
      if (ct.kind !== "site") continue;
      const childBoxes = ct.children.map(c => c._box).filter(Boolean);
      // padTop 40 — чтобы пунктирный верх и подпись «площадка …» шли выше
      // верхнего края и подписи серверной (не сливались).
      const base = unionBox(childBoxes, 15, 40, 15) || ct.base;
      ct._box = growByInnerWires(base, ct.rackIds, 10);
      apply(ct);
    }
  }

  // Рисует силовые щитки (Power Panel) текущей серверной под стойками, по
  // центру всего ряда стоек. Возвращает обновлённый maxBottom (низ схемы).
  _renderPowerPanels(canvas, group, maxBottom) {
    if (!group.length) return maxBottom;
    // Локация группы — общая у всех стоек; берём из первой стойки.
    const locId = group[0].location && group[0].location.id;
    const panels = (state.powerPanels || []).filter(p => p.location && p.location.id === locId);
    if (!panels.length) return maxBottom;

    const { LEFT_PAD } = this;
    // Горизонтальный охват ряда стоек: от левого края первой до правого
    // края последней. Центр щитка — среднее арифметическое (середина охвата).
    const spanLeft = LEFT_PAD;
    const spanRight = LEFT_PAD + (group.length - 1) * (COL_W + COL_GAP) + BOX_PAD + COL_W;
    const centerX = (spanLeft + spanRight) / 2;
    const PANEL_W = 280, HEAD_H = 30, ROW_H = 24, GAP_Y = 40, GAP_X = 28;
    const top = maxBottom + GAP_Y;
    state.powerBoxEls = state.powerBoxEls || {};
    state.feedRowEls = {};
    const edit = Mode.on("schema");
    const panelFeeds = panels.map(p =>
      (state.powerFeeds || []).filter(f => f.power_panel && f.power_panel.id === p.id));
    // В правке добавляется строка «+ фидер» → высота щитка на 1 ряд больше.
    const rowsOf = fs => edit ? fs.length + 1 : Math.max(1, fs.length);
    const maxH = Math.max(...panelFeeds.map(fs => HEAD_H + rowsOf(fs) * ROW_H + 8));
    // Несколько щитков — в ряд по горизонтали, центрируем весь ряд.
    const rowW = panels.length * PANEL_W + (panels.length - 1) * GAP_X;
    let x = centerX - rowW / 2;
    panels.forEach((panel, pi) => {
      const feeds = panelFeeds[pi];
      // Карточка щитка — тот же вид, что у нод в стойке (.node), плюс маркер
      // .powerbox. Акцент слева — цвет питания.
      const box = mk("div", {
        className: "node powerbox",
        style: { left: x + "px", top: top + "px", width: PANEL_W + "px", height: maxH + "px",
          borderLeft: "3px solid var(--power)" },
      });
      box.insertAdjacentHTML("beforeend",
        `<span class="nm">${panel.name}</span><span class="mdl">силовой щит · ${feeds.length} фид.</span>`);
      // Клик по названию щитка → его «паспорт» справа (как у устройств).
      box.querySelector(".nm").addEventListener("click", e => {
        e.stopPropagation();
        this.app.device.showPanel(panel);
      });
      // Фидеры списком; у каждого — порт на ЛЕВОЙ границе карточки (кружок,
      // как у портов устройств). Наведение на порт даёт маршрут/тултип.
      const list = mk("div", { className: "pb-feeds" });
      feeds.forEach((f, fi) => {
        const va = f.amperage ? `${f.voltage || "?"}В/${f.amperage}А` : "";
        const row = mk("div", { className: "pb-feed",
          html: `<span class="pf-name">${f.name}</span><span class="pf-va">${va}</span>` });
        list.appendChild(row);
        state.feedRowEls[f.id] = row;
        // Порт фидера на левом краю, по вертикали — центр его строки.
        const portY = HEAD_H + fi * ROW_H + ROW_H / 2;
        this._placeFeedPort(box, panel, f, portY);
      });
      // В правке — строка «+ фидер» с зелёным кружком-плюсиком слева (как у
      // фидера), чтобы добавлять фидер прямо со схемы, не лазая по дереву.
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

  // Пересобрать только щитки (при смене режима правки — появляется/исчезает
  // строка «+ фидер»). Позиция берётся из сохранённого низа ряда стоек.
  _rerenderPowerPanels() {
    const canvas = $("#schema");
    if (!canvas || this._powerBaseBottom == null) return;
    canvas.querySelectorAll(".powerbox").forEach(el => el.remove());
    this._renderPowerPanels(canvas, state.group, this._powerBaseBottom);
  }

  // Порт фидера (Power Feed) на левой границе щитка. Регистрируется в
  // state.ports как dcim.powerfeed:<id> — так работают hover/маршрут и к нему
  // привязывается линия к PDU (_drawFeedWires). dev — синтетический (щит).
  _placeFeedPort(box, panel, feed, portY) {
    const dot = mk("div", {
      className: "port p-feed" + (feed.cable ? " used" : ""),
      text: shortPortName(feed.name, null),
      style: { left: "-8px", top: portY + "px" },
    });
    const kind = { otype: "dcim.powerfeed", ep: "power-feeds", label: "фидер", cls: "p-feed" };
    const dev = { id: "panel-" + panel.id, name: panel.name };
    attachTip(dot, () => this._feedTip(panel, feed));
    const port = { el: dot, item: feed, dev, otype: kind.otype, ep: kind.ep, side: "l" };
    dot.addEventListener("mouseenter", () => this._portHover(port, true));
    dot.addEventListener("mouseleave", () => this._portHover(port, false));
    // Соединение как у обычных портов: клик — выбрать/привязать (фидер ↔ power-
    // port PDU), двойной — трасса. COMPAT разрешает powerfeed↔powerport.
    dot.addEventListener("click", ev => { ev.stopPropagation(); this._onPortClick(kind, feed, dev, dot, ev); });
    dot.addEventListener("dblclick", ev => { ev.stopPropagation(); ev.preventDefault(); this._onPortDblClick(kind, feed); });
    box.appendChild(dot);
    state.ports[portKey(kind.otype, feed.id)] = port;
  }

  // Зелёный «+»-кружок слева у строки «+ фидер» (как порт фидера, но добавляет).
  _placeAddFeedDot(box, panel, portY) {
    const dot = mk("div", { className: "port p-feed addport", text: "+",
      title: "Добавить фидер", style: { left: "-8px", top: portY + "px" } });
    dot.addEventListener("click", ev => { ev.stopPropagation(); this._addFeed(panel); });
    box.appendChild(dot);
  }
  // Модалка создания фидера (та же, что «+ фидер» в дереве) — прямо со схемы.
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

  // Линии от фидеров щитков к Input-портам PDU (замыкают цепь питания).
  // Рисуются в #wires после портов; вызывается из redrawWires (там уже
  // посчитана геометрия портов). Кабель feed↔power-port — источник связи.
  _drawFeedWires(svg, center) {
    for (const c of state.cables) {
      const terms = [...(c.a_terminations || []), ...(c.b_terminations || [])];
      const feedT = terms.find(t => t.object_type === "dcim.powerfeed");
      const portT = terms.find(t => t.object_type === "dcim.powerport");
      if (!feedT || !portT) continue;
      const feedP = state.ports[portKey("dcim.powerfeed", feedT.object_id)];
      const port = state.ports[portKey("dcim.powerport", portT.object_id)];
      if (!feedP || !port) continue;
      const [fx, fy] = center(feedP.el), [px2, py] = center(port.el);
      const midY = (fy + py) / 2;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      // Стиль как у обычных проводов:
      //  · «Круглые» — вертикальный кубик;
      //  · «Углы» + «Короткий» — скруглённая угольная трасса через середину;
      //  · «Углы» + «Расширенный» — у фидера своей колонки нет, но у PDU (его
      //    power-порт) есть → ведём боковым коридором ЕГО колонки, в обход нод.
      let d;
      if (state.wireStyle !== "angular") {
        d = cubicPath(px2, py, fx, fy, midY, midY);
      } else if (state.wirePath === "extend" && state.devCol[port.dev.id] != null) {
        const col = state.devCol[port.dev.id];
        const corr = this.LEFT_PAD + (col + 1) * (COL_W + COL_GAP) - COL_GAP / 2 - 52;
        // Горизонтальный переход ведём НАД щитками (верхний край самого верхнего
        // щитка − отступ), чтобы линия не резала их боксы, затем коридором
        // колонки PDU вверх к его порту. state.powerBoxEls — боксы щитков.
        const tops = Object.values(state.powerBoxEls || {}).map(el => el.offsetTop);
        const overPanels = (tops.length ? Math.min(...tops) : fy) - 24;
        const pOut = py + 16;
        d = smoothPath([[fx, fy], [fx, overPanels], [corr, overPanels], [corr, pOut], [px2, pOut], [px2, py]], 10);
      } else {
        d = smoothPath([[px2, py], [px2, midY], [fx, midY], [fx, fy]], 10);
      }
      p.setAttribute("d", d);
      p.setAttribute("class", "wire cbl-power feedwire");
      p.dataset.cable = c.id;
      svg.appendChild(p);
    }
  }

  // радио-линки (слой Wireless / сетевой режим)
  // Волнистая линия между двумя wireless-интерфейсами (у радио-линка нет
  // кабеля → своя геометрия). Рисуется, когда: активен wireless-слой ИЛИ
  // включён сетевой режим отображения (там радио-связи видны всегда). Зовётся
  // из redrawWires (пережить зум) и при выборе/снятии слоя/режима.
  drawRadioLinks() {
    const svg = $("#wires");
    if (!svg) return;
    svg.querySelectorAll(".radiowire").forEach(el => el.remove());
    // источник пар: активный wireless-слой, иначе — все радио-линки группы
    // (в сетевом режиме); в физическом режиме без слоя — не рисуем. Пары
    // пересобираем СВЕЖИМИ по текущему state.ports (режим мог перезаписать
    // порты), чтобы не зависеть от того, в каком режиме был renderPanel.
    const a = state.activeLayer;
    let pairs = null;
    if (a && a.kind === "wireless" && a.pairs) pairs = a.pairs;
    else if (state.viewMode === "net" && this.app.layers)
      pairs = this.app.layers._collectWireless().pairs;
    if (!pairs || !pairs.length) return;
    const rect = $("#schema").getBoundingClientRect();
    const z = state.zoom, base = { left: rect.left, top: rect.top };
    const center = el => {
      const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z];
    };
    // Радио-линки идут по ТОЙ ЖЕ трассе, что и кабели (short/extend, высота
    // магистрали, коридоры, дорожки) — только мостики им не нужны. В режиме
    // «Углы» ведём волну вдоль угольной ломаной, в «Круглых» — прямая волна.
    const angular = state.wireStyle === "angular";
    const extend = state.wirePath === "extend";
    const ctx = this._routeCtx();
    for (const pair of pairs) {
      const pa = state.ports[pair.a], pb = state.ports[pair.b];
      if (!pa || !pb) continue;
      const [ax, ay] = center(pa.el), [bx, by] = center(pb.el);
      const w = { a: pa, b: pb, ax, ay, bx, by,
        crossRack: state.devRack[pa.dev.id] !== state.devRack[pb.dev.id] };
      // Провод в обход нод нужен, когда «Расширенный» и между нодами одной
      // стойки есть другие (разница индексов ≥ 2) — тогда ведём по трассе.
      const around = extend && !w.crossRack
        && Math.abs(state.devNodeIdx[pa.dev.id] - state.devNodeIdx[pb.dev.id]) >= 2;
      let d;
      if (angular) {
        d = wavyAlong(this._routePolyline(w, ctx));            // волна вдоль углов
      } else if (around) {
        d = wavyAlong(this._routePolyline(w, ctx));            // «Круглый»+обход → по трассе
      } else {
        d = wavyCurve(ax, ay, bx, by);                        // «Круглый» → закруглённая кривая
      }
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("class", "radiowire");
      p.dataset.wlink = pair.id;
      svg.appendChild(p);
    }
  }

  // «Сетевой» ли порт (для режима отображения физика/сеть). Сетевые:
  //  · wireless-интерфейс (тип ieee802.11*/other-wireless или есть wireless_link);
  //  · порт, соединённый с circuit-терминацией (link_peers_type = circuit).
  // Всё остальное — физическое. Только dcim.interface может быть сетевым;
  // front/rear/power/console — всегда физические.
  _isNetPort(otype, item) {
    if (otype !== "dcim.interface") return false;
    return this._isWirelessItem(item) || this._isCircuitItem(item);
  }
  // wireless-интерфейс (радио-тип или есть wireless_link)
  _isWirelessItem(item) {
    const t = (item.type && item.type.value) || "";
    return !!item.wireless_link || t.startsWith("ieee802.11") || t.startsWith("other-wireless");
  }
  // интерфейс с выходом в circuit (терминация на другом конце кабеля)
  _isCircuitItem(item) {
    return item.link_peers_type === "circuits.circuittermination";
  }

  // Строки легенды кабелей: только семейства, реально присутствующие среди
  // текущих кабелей (+ «без типа», если такие есть). Пусто — не показываем.
  _cableLegendRows() {
    const fams = new Set(state.cables.map(c => cableFamily(c.type)));
    const hasUntyped = state.cables.some(c => !c.type);
    // порядок как в FAMILY_LABEL, default показываем как «без типа»
    const rows = [];
    // Условное обозначение кабеля — просто ОТРЕЗОК цвета его типа (не кружок).
    for (const fam of Object.keys(FAMILY_LABEL)) {
      if (fam === "default") continue;
      if (!fams.has(fam)) continue;
      rows.push(`<span><span class="lg-cable" style="background:var(--cbl-${fam})"></span>${FAMILY_LABEL[fam]}</span>`);
    }
    if (hasUntyped)
      rows.push(`<span><span class="lg-cable" style="background:var(--cbl-default)"></span>без типа</span>`);
    return rows.length ? rows.join("") : `<span style="color:var(--muted)">кабелей нет</span>`;
  }
  // Человекочитаемое имя типа кабеля из state.cableTypes; пусто → «без типа».
  _cableTypeLabel(type) {
    if (!type) return "без типа";
    const found = (state.cableTypes || []).find(t => t.value === type);
    return found ? found.label : type;
  }
  _portTip(dev, kind, item) {
    let peers = "";
    if (item.link_peers && item.link_peers.length) {
      peers = item.link_peers.map(p =>
        (p.device ? p.device.name + " · " : "") + (p.name || p.display || "?")).join(", ");
    }
    const action = item.cable ? "клик — меню связи (удалить / перевесить)"
      : (state.pending ? "клик — соединить сюда"
        : (Mode.on("schema") ? "клик — начать связь" : "свободен"));
    const badge = this.app.layers ? this.app.layers.portBadge(kind.otype, item.id) : null;
    // IP-адреса интерфейса (wireless/circuit/обычный — всё dcim.interface).
    let ipLine = "";
    if (kind.otype === "dcim.interface") {
      const ips = (state.ipsByIface && state.ipsByIface[item.id]) || [];
      if (ips.length) ipLine = `<div class="t-line">IP: ${ips.map(x => x.address).join(", ")}</div>`;
    }
    return `<div class="t-title">${dev.name} · ${item.name}</div>
      <div class="t-line">${KIND_RU[kind.otype] || kind.label}</div>` +
      (badge ? `<div class="t-badge">${badge}</div>` : "") +
      ipLine +
      (peers ? `<div class="t-line">соединён с: ${peers}</div>` : "") +
      `<div class="t-mut">${action}</div>`;
  }

  // обновление кабелей без полной перерисовки
  async refreshCables() {
    const rackQ = state.group.map(r => "rack_id=" + r.id).join("&");
    const cables = await apiAll("/dcim/cables/?" + rackQ);
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
    // Пересобрать панель слоёв (мог появиться/исчезнуть console-кабель и др.);
    // renderPanel заодно восстанавливает и заново накладывает активный слой.
    if (this.app.layers) this.app.layers.renderPanel();
    // Фильтр: могло появиться/исчезнуть семейство кабелей; render() заодно
    // заново накладывает скрытие (провода пересозданы в redrawWires).
    if (this.app.filter) this.app.filter.render();
  }
  // Перестроить только строки кабельной легенды (после мутации кабелей).
  _refreshCableLegend() {
    const body = $("#legend .lg-body");
    if (!body) return;
    const subs = body.querySelectorAll(".lg-sub");
    const cableSub = subs[subs.length - 1];   // «Кабели (цвет = тип)»
    if (!cableSub) return;
    while (cableSub.nextSibling) cableSub.nextSibling.remove();
    cableSub.insertAdjacentHTML("afterend", this._cableLegendRows());
  }

  // провода
  redrawWires() {
    const svg = $("#wires");
    if (!svg) return;
    const canvas = $("#schema");
    svg.setAttribute("width", canvas.scrollWidth);
    svg.setAttribute("height", canvas.scrollHeight);
    svg.innerHTML = "";
    const base = canvas.getBoundingClientRect();
    const z = state.zoom;
    const center = el => {
      const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z];
    };
    // В сетевом виде физические кабели/питание не рисуем — там только радио-
    // линии (circuit показан облаком у порта). Иначе провода к блёклым портам
    // ломают позиционирование.
    if (state.viewMode === "net") { this.drawRadioLinks(); this._fitContoursToWires(); return; }
    // Стиль проводов: "round" — прежние дуги; "angular" — угольная (Manhattan)
    // разводка с «мостиками»-полуокружностями на пересечениях (см. UI-кнопки).
    if (state.wireStyle === "angular") this._drawAngularWires(svg, center);
    else this._drawRoundWires(svg, center);
    // Линии питания щитков (фидер → PDU Input) — отдельным проходом, т.к.
    // у фидера нет записи в state.ports (он не «порт устройства»).
    this._drawFeedWires(svg, center);
    // Провода пересозданы — заново наложить скрытие фильтра по семействам.
    if (this.app.filter) this.app.filter.apply();
    // …и подсветку активного слоя (иначе при зуме выделение слоя сбрасывалось).
    if (this.app.layers) this.app.layers.reapplyToWires();
    // Радио-линии под текущий режим/слой (drawRadioLinks сам решает рисовать/
    // нет). НЕ зовём applyViewMode отсюда — иначе рекурсия через relayoutNodes.
    this.drawRadioLinks();
    // Вписать контуры серверных/площадок в их внутренние провода (не вылезать).
    this._fitContoursToWires();
  }

  // Один <path> провода со всей обвязкой (цвет по семейству, тултип, ховер,
  // клик-меню). Общий для round/angular разводки, чтобы не дублировать.
  _wirePathEl(c, a, b, d, isPower) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    // Цвет провода — по семейству типа кабеля (c.type). Если тип не задан,
    // fallback на прежнее поведение: питание — power, данные — data.
    const fam = cableFamily(c.type);
    const colorCls = c.type ? "cbl-" + fam : (isPower ? "power" : "data");
    p.setAttribute("class", "wire " + colorCls);
    p.id = "w" + c.id;
    p.dataset.cable = c.id;
    // семейство для фильтра: с типом — по типу, без типа — power/без-типа
    p.dataset.fam = c.type ? fam : (isPower ? "power" : "default");
    attachTip(p, () => `<div class="t-title t-cabletitle"><span>Кабель #${c.id}${c.label ? " «" + c.label + "»" : ""}</span><span class="t-type"><span class="t-sw" style="background:var(--cbl-${cableFamily(c.type)})"></span>Тип: ${this._cableTypeLabel(c.type)}</span></div>
      <div class="t-line">${a.dev.name} · ${a.item.name}</div>
      <div class="mid" style="color:var(--accent)">⇅</div>
      <div class="t-line">${b.dev.name} · ${b.item.name}</div>`);
    p.addEventListener("mouseenter", () => this._hoverWire(c.id, a, b, true));
    p.addEventListener("mouseleave", () => this._hoverWire(c.id, a, b, false));
    p.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!Mode.on("schema")) { this._hoverWire(c.id, a, b, true); return; }
      this._openLinkMenu(a.item, a.dev, a.el, ev, c.id);
    });
    return p;
  }

  // Каждый кабель → пара портов {a,b} + флаги, если оба конца в DOM. Общий
  // разбор для round/angular. Возвращает [{c,a,b,ax,ay,bx,by,isPower,crossRack}].
  _wireEnds(center) {
    const out = [];
    for (const c of state.cables) {
      const aT = (c.a_terminations || [])[0], bT = (c.b_terminations || [])[0];
      if (!aT || !bT) continue;
      // Линии фидер↔PDU рисует отдельный проход (_drawFeedWires): у щитка нет
      // геометрии узла (колонки/индекса) для общего роутера углов → иначе NaN
      // в трассе. Здесь пропускаем.
      if (aT.object_type === "dcim.powerfeed" || bT.object_type === "dcim.powerfeed") continue;
      const a = state.ports[termKey(aT)], b = state.ports[termKey(bT)];
      if (!a || !b) continue;
      const [ax, ay] = center(a.el), [bx, by] = center(b.el);
      out.push({ c, a, b, ax, ay, bx, by,
        isPower: aT.object_type.includes("power") || bT.object_type.includes("power"),
        crossRack: state.devRack[a.dev.id] !== state.devRack[b.dev.id] });
    }
    return out;
  }

  // Высота горизонтальной шины магистралей (верхние провода между пач-панелями).
  // РАНЬШЕ уводила почти к верху холста (слишком далеко). Теперь — чуть выше
  // верхних портов, «лесенкой» по каналам, чтобы провода жались к панелям.
  _trunkBusY(ay, by, chan, hi) {
    return Math.max(6, Math.min(ay, by) - (26 + chan * 16) - (hi - 1) * 40);
  }

  // «Круглые» провода: дуги/изгибы
  _drawRoundWires(svg, center) {
    const { LEFT_PAD } = this;
    const hi = state.wireHeightK ?? 1;
    const extend = state.wirePath === "extend";
    const ctx = this._routeCtx();   // для обхода нод в «Расширенном»
    let chan = 0, lane = 0;
    for (const w of this._wireEnds(center)) {
      const { c, a, b, ax, ay, bx, by, isPower, crossRack } = w;
      let d;
      if (crossRack && state.devNodeIdx[a.dev.id] === 0 && state.devNodeIdx[b.dev.id] === 0) {
        const lift = this._trunkBusY(ay, by, chan++, hi);
        d = cubicPath(ax, ay, bx, by, lift, lift);
      } else if (crossRack) {
        const leftCol = Math.min(state.devCol[a.dev.id], state.devCol[b.dev.id]);
        const gapX = LEFT_PAD + (leftCol + 1) * (COL_W + COL_GAP) - COL_GAP / 2 + (lane++ % 8) * 12 - 40;
        const aOut = a.side === "t" ? ay - (18 + (lane % 3) * 6) * hi : ay + (18 + (lane % 3) * 6) * hi;
        const bOut = b.side === "t" ? by - (18 + (lane % 3) * 6) * hi : by + (18 + (lane % 3) * 6) * hi;
        d = orthoPath(ax, ay, bx, by, gapX, aOut, bOut);
      } else if (extend && Math.abs(state.devNodeIdx[a.dev.id] - state.devNodeIdx[b.dev.id]) >= 2) {
        // «Расширенный» и в «Круглых»: обход нод боковым коридором, но со
        // СКРУГЛЁННЫМИ углами (гладкая кривая, а не прямые углы).
        d = smoothPath(this._routePolyline(w, ctx));
      } else {
        const midBend = (ay < by ? 1 : -1) * (40 + (c.id % 4) * 8) * hi;
        d = cubicPath(ax, ay, bx, by, ay + midBend, by - midBend);
      }
      svg.appendChild(this._wirePathEl(c, a, b, d, isPower));
    }
  }

  // Ломаные (массивы точек) всех кабелей под текущую трассу (short/extend).
  //  · магистраль — верхняя шина (см. _trunkBusY);
  //  · межстоечные — через боковой вертикальный коридор gapX (нод там нет);
  //  · внутри стойки:
  //      short  — прямая перемычка на средней высоте (может пройти по ноде);
  //      extend — в ОБХОД нод: выход за край → боковой коридор колонки → вход.
  //    Коридорные вертикали разнесены по «дорожкам» (lane) — так параллельные
  //    соединения идут рядом, а не друг в друге (small_fix: провода п.2).
  _wirePolylines(center) {
    const ctx = this._routeCtx();
    return this._wireEnds(center).map(w => ({ ...w, pts: this._routePolyline(w, ctx) }));
  }

  // Контекст маршрутизации: множители/счётчики «дорожек» (lane) для разнесения
  // параллельных проводов. Свой на каждый проход (кабели / радио).
  _routeCtx() {
    return { LEFT_PAD: this.LEFT_PAD, hi: state.wireHeightK ?? 1,
      extend: state.wirePath === "extend", chan: 0, lane: 0, slane: 0, idx: 0 };
  }

  // Ломаная ОДНОГО соединения под текущую трассу. Общая для кабелей и радио —
  // так «все преобразования» (short/extend, высота магистрали, коридоры,
  // дорожки) применяются и к Wireless. Мостики к результату не относятся —
  // их накладывает только отрисовщик кабелей (у радио их нет).
  _routePolyline(w, ctx) {
    const { a, b, ax, ay, bx, by, crossRack } = w;
    const { LEFT_PAD, hi, extend } = ctx;
    const vary = w.c ? w.c.id : ctx.idx++;   // у радио нет c.id — берём индекс
    if (crossRack && state.devNodeIdx[a.dev.id] === 0 && state.devNodeIdx[b.dev.id] === 0) {
      const busY = this._trunkBusY(ay, by, ctx.chan++, hi);
      return [[ax, ay], [ax, busY], [bx, busY], [bx, by]];
    }
    if (crossRack) {
      const leftCol = Math.min(state.devCol[a.dev.id], state.devCol[b.dev.id]);
      const gapX = LEFT_PAD + (leftCol + 1) * (COL_W + COL_GAP) - COL_GAP / 2 + (ctx.lane++ % 8) * 12 - 40;
      const aOut = a.side === "t" ? ay - (18 + (ctx.lane % 3) * 6) * hi : ay + (18 + (ctx.lane % 3) * 6) * hi;
      const bOut = b.side === "t" ? by - (18 + (ctx.lane % 3) * 6) * hi : by + (18 + (ctx.lane % 3) * 6) * hi;
      return [[ax, ay], [ax, aOut], [gapX, aOut], [gapX, bOut], [bx, bOut], [bx, by]];
    }
    if (extend && Math.abs(state.devNodeIdx[a.dev.id] - state.devNodeIdx[b.dev.id]) >= 2) {
      // «Расширенный»: провод НИКОГДА не идёт по ноде — уходит за её край и
      // спускается/поднимается в боковом коридоре колонки (там нод нет). НО
      // только когда между нодами ЕСТЬ другая нода (разница индексов ≥ 2);
      // соседние ноды соединяем напрямую (в бок уводить незачем).
      const col = state.devCol[a.dev.id];
      const k = ctx.slane++;
      const corr = LEFT_PAD + (col + 1) * (COL_W + COL_GAP) - COL_GAP / 2 - 52 + (k % 6) * 12;
      const aOut = a.side === "t" ? ay - (16 + (k % 3) * 6) : ay + (16 + (k % 3) * 6);
      const bOut = b.side === "t" ? by - (16 + (k % 3) * 6) : by + (16 + (k % 3) * 6);
      return [[ax, ay], [ax, aOut], [corr, aOut], [corr, bOut], [bx, bOut], [bx, by]];
    }
    // «Короткий»: прямая перемычка на средней высоте.
    const aOut = a.side === "t" ? ay - (14 + (vary % 3) * 6) * hi : ay + (14 + (vary % 3) * 6) * hi;
    const bOut = b.side === "t" ? by - (14 + (vary % 3) * 6) * hi : by + (14 + (vary % 3) * 6) * hi;
    const busY = (aOut + bOut) / 2;
    return [[ax, ay], [ax, busY], [bx, busY], [bx, by]];
  }

  // «Углы» провода: угольная (Manhattan) разводка + мостики
  // Горизонтальные участки, пересекая ЧУЖИЕ вертикали, обходят их мостиком-
  // полуокружностью (hopSegment) — так провода не «сливаются». Близкие
  // пересечения объединяются в один широкий мост (см. hopSegment).
  _drawAngularWires(svg, center) {
    const polys = this._wirePolylines(center);
    // Вертикальные сегменты всех ломаных — препятствия для мостиков.
    const verts = [];
    for (const pl of polys)
      for (let i = 1; i < pl.pts.length; i++) {
        const [x1, y1] = pl.pts[i - 1], [x2, y2] = pl.pts[i];
        if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) > 0.5)
          verts.push({ x: x1, y1: Math.min(y1, y2), y2: Math.max(y1, y2), id: pl.c.id });
      }
    // Строим d: вертикали прямые, горизонтали с мостиками над чужими.
    for (const pl of polys) {
      const p0 = pl.pts[0];
      let d = `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`;
      for (let i = 1; i < pl.pts.length; i++) {
        const [x1, y1] = pl.pts[i - 1], [x2, y2] = pl.pts[i];
        if (Math.abs(y1 - y2) < 0.5 && Math.abs(x1 - x2) > 0.5) {
          const xs = verts.filter(v => v.id !== pl.c.id
            && v.x > Math.min(x1, x2) + 1 && v.x < Math.max(x1, x2) - 1
            && y1 > v.y1 - 0.5 && y1 < v.y2 + 0.5).map(v => v.x);
          d += hopSegment(x1, y1, x2, xs);
        } else {
          d += ` L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        }
      }
      svg.appendChild(this._wirePathEl(pl.c, pl.a, pl.b, d, pl.isPower));
    }
  }

  _hoverWire(cableId, a, b, on) {
    if (state.pending) return;
    document.querySelectorAll("#wires path.wire").forEach(p => {
      const mine = +p.dataset.cable === cableId;
      p.classList.toggle("dim", on && !mine);
      if (mine) p.classList.toggle("hl", on);
    });
    a.el.classList.toggle("hl", on);
    b.el.classList.toggle("hl", on);
    const keep = new Set([a.dev.id, b.dev.id]);
    // Узлы-концы связи — не просто «не гасим», а ЯРКО подсвечиваем (обводка),
    // как порты и провод; остальные — тускнеют. Иначе провод горит, а порты и
    // сами ноды по краям — нет.
    Object.entries(state.nodeEls).forEach(([id, el]) => {
      const mine = keep.has(+id);
      el.classList.toggle("dim2", on && !mine);
      el.classList.toggle("conn-hl", on && mine);
    });
  }
  _portHover(port, on) {
    if (state.pending) return;
    // Радио-порт: кабеля нет, подсвечиваем радио-линию и дальний конец.
    if (!port.item.cable && port.item.wireless_link) { this._hoverRadio(port, on); return; }
    if (!port.item.cable) return;
    const cable = state.cables.find(c => c.id === port.item.cable.id);
    if (!cable) return;
    const aT = (cable.a_terminations || [])[0], bT = (cable.b_terminations || [])[0];
    const a = aT && state.ports[termKey(aT)], b = bT && state.ports[termKey(bT)];
    if (a && b) this._hoverWire(cable.id, a, b, on);
  }

  // Ховер по wireless-порту: подсветить его радио-линию + оба конца (как
  // _hoverWire для кабеля). Пара берётся из _collectWireless (по данным).
  _hoverRadio(port, on) {
    const pairs = (this.app.layers && this.app.layers._collectWireless().pairs) || [];
    const key = portKey(port.otype, port.item.id);
    const pair = pairs.find(pr => pr.a === key || pr.b === key);
    if (!pair) return;
    const a = state.ports[pair.a], b = state.ports[pair.b];
    document.querySelectorAll("#wires path.radiowire").forEach(w =>
      w.classList.toggle("hl", on && +w.dataset.wlink === pair.id));
    if (a) a.el.classList.toggle("hl", on);
    if (b) b.el.classList.toggle("hl", on);
    const keep = new Set([a && a.dev.id, b && b.dev.id]);
    Object.entries(state.nodeEls).forEach(([id, el]) => {
      const mine = keep.has(+id);
      el.classList.toggle("dim2", on && !mine);
      el.classList.toggle("conn-hl", on && mine);
    });
  }

  // прицеливание / выбор порта
  _enterAim(fromOtype) {
    const okTypes = new Set(COMPAT[fromOtype] || []);
    Object.values(state.ports).forEach(p => {
      const isSelf = state.pending && p.otype === state.pending.otype && p.item.id === state.pending.id;
      const compatible = okTypes.has(p.otype) && !p.item.cable && !isSelf;
      p.el.classList.toggle("aim-dim", !compatible && !isSelf);
      p.el.classList.toggle("aim-ok", compatible);
    });
    document.querySelectorAll("#wires path.wire").forEach(w => w.classList.add("dim"));
    Object.values(state.rackBoxEls).forEach(el => el.classList.add("dim"));
  }
  _exitAim() {
    Object.values(state.ports).forEach(p => p.el.classList.remove("aim-dim", "aim-ok"));
    document.querySelectorAll("#wires path.wire").forEach(w => w.classList.remove("dim", "hl"));
    Object.values(state.rackBoxEls).forEach(el => el.classList.remove("dim"));
    Object.values(state.nodeEls).forEach(el => el.classList.remove("dim2", "conn-hl"));
  }
  setPending(port) {
    if (state.pending) state.pending.el.classList.remove("pending");
    state.pending = port;
    $("#cancelconn").classList.toggle("show", !!port);
    if (port) {
      port.el.classList.add("pending");
      this._enterAim(port.otype);
    } else {
      this._exitAim();
    }
  }

  async _onPortClick(kind, item, dev, dot, ev) {
    const edit = Mode.on("schema");
    const net = state.viewMode === "net";
    // СЕТЕВОЙ режим + edit: клик по СВОБОДНОМУ порту зависит от ряда:
    //  · проводной (не радио) свободный → назначить circuit (выход в WAN);
    //  · радио свободный → обычный pending (второй клик создаст WirelessLink).
    if (net && edit && kind.otype === "dcim.interface"
        && !item.cable && !item.wireless_link && !state.pending) {
      if (!this._isWirelessItem(item)) {
        await this._assignCircuit(dev, item, ev);
        return;
      }
      // радио: продолжаем в общий pending-поток ниже
    }
    if (item.cable && !state.pending) {
      if (edit) { this._openLinkMenu(item, dev, dot, ev); return; }
      // Просмотр: ОДИНОЧНОЕ нажатие — подсветить ТОЛЬКО связь (кабель между
      // двумя портами). Продолжение (трасса через пач-панель) — по ДВОЙНОМУ
      // (см. _onPortDblClick). Так одинаково работает на тач-устройствах.
      this._traceLocal(item);
      return;
    }
    if (!edit) {
      setStatus(dev.name + "/" + item.name + " — порт свободен (включи режим стройки)", "");
      return;
    }
    if (!state.pending) {
      this.setPending({ otype: kind.otype, id: item.id, label: dev.name + "/" + item.name, el: dot });
      setStatus("выбран " + state.pending.label + " — кликни совместимый порт или «Отмена»", "ok");
      return;
    }
    if (state.pending.id === item.id && state.pending.otype === kind.otype) {
      this.setPending(null);
      setStatus("выбор отменён");
      return;
    }
    if (!(COMPAT[state.pending.otype] || []).includes(kind.otype) || item.cable) {
      setStatus("несовместимый или занятый порт", "err");
      return;
    }
    const a = state.pending;
    const bLabel = dev.name + "/" + item.name;
    // Радио-связь: если ОБА конца — wireless-интерфейсы, создаём WirelessLink
    // (не Cable — у радио нет провода). Тип кабеля не спрашиваем.
    if (this._isWirelessTerm(a) && this._isWirelessTerm({ otype: kind.otype, id: item.id })) {
      this.setPending(null);
      await this._createWirelessLink(a, item.id, bLabel);
      return;
    }
    this.setPending(null);
    this._openCablePopover(a, { otype: kind.otype, id: item.id }, bLabel, ev);
  }

  // Назначить circuit-выход на свободный проводной порт: мини-форма (провайдер +
  // cid), затем цепочка POST — circuit → termination(A, site) → cable(term↔порт).
  // Второй конец circuit «в облаке» (у провайдера), физически его нет.
  async _assignCircuit(dev, item, ev) {
    const providers = state.circuitProviders || [];
    const types = state.circuitTypes || [];
    if (!providers.length) {
      setStatus("нет провайдеров — создай Provider в NetBox (Circuits → Providers)", "err");
      return;
    }
    const siteId = dev.site && dev.site.id;
    this.app.openModal("Выход в WAN (Circuit)", dev.name + " · " + item.name, [
      { id: "provider", label: "Провайдер", type: "select",
        options: providers.map(p => ({ value: p.id, label: p.name })) },
      { id: "type", label: "Тип канала", type: "select",
        options: types.map(t => ({ value: t.id, label: t.name })) },
      { id: "cid", label: "Идентификатор канала (CID)", placeholder: "напр. INET-042" },
    ], async v => {
      if (!v.cid) { setStatus("укажи CID канала", "err"); throw new Error("no cid"); }
      // 1) circuit
      const circ = await api("/circuits/circuits/", "POST",
        { cid: v.cid, provider: +v.provider, type: +v.type, status: "active" });
      // 2) термination A на сайте устройства
      const term = await api("/circuits/circuit-terminations/", "POST",
        { circuit: circ.id, term_side: "A", termination_type: "dcim.site", termination_id: siteId });
      // 3) кабель термination ↔ порт
      await api("/dcim/cables/", "POST", {
        a_terminations: [{ object_type: "circuits.circuittermination", object_id: term.id }],
        b_terminations: [{ object_type: "dcim.interface", object_id: item.id }],
        status: "connected",
      });
      setStatus("circuit " + v.cid + " подключён к " + dev.name + "/" + item.name, "ok");
      await this.app.tree.reload();   // circuits грузятся в connect() → полный reconnect
    });
  }

  // Является ли терминация {otype,id} wireless-интерфейсом (радио-тип).
  _isWirelessTerm(term) {
    if (term.otype !== "dcim.interface") return false;
    const p = state.ports[portKey(term.otype, term.id)];
    if (!p) return false;
    const t = (p.item.type && p.item.type.value) || "";
    return !!p.item.wireless_link || t.startsWith("ieee802.11") || t.startsWith("other-wireless");
  }

  // Создать WirelessLink между двумя интерфейсами (a.id ↔ bId).
  async _createWirelessLink(a, bId, bLabel) {
    try {
      await api("/wireless/wireless-links/", "POST",
        { interface_a: a.id, interface_b: bId, status: "connected" });
      setStatus("радио-линк создан: " + a.label + " ⇄ " + bLabel, "ok");
      // wireless-links грузятся в connect() → полный reconnect обновит state
      await this.app.tree.reload();
    } catch (e) {
      setStatus("не удалось создать радио-линк: " + e.message, "err");
    }
  }

  // поповер выбора типа кабеля (рядом с портом, не модалка)
  _openCablePopover(a, b, bLabel, ev) {
    const pop = this.cablepop;
    // Список типов, ограниченный видом соединения (питание → только power,
    // данные → всё, кроме power). «без типа» — всегда первым.
    const allow = cableFamiliesFor(a.otype, b.otype);
    const groups = [{ group: "—", opts: [["", "без типа"]] }, ...cableTypeGroups(allow)];
    const isPower = allow.has("power") && allow.size === 1;
    const sel = pop.querySelector(".cp-type");
    sel.innerHTML = groups.map(g =>
      `<optgroup label="${g.group}">` +
      g.opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("") +
      `</optgroup>`).join("");
    sel.value = isPower ? "power" : "";
    pop.querySelector(".cp-where").textContent = a.label + " ⇄ " + bLabel;

    // Позиционируем рядом с портом (по курсору), в пределах окна.
    pop.style.display = "block";
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = ev.clientX + 12, y = ev.clientY + 12;
    if (x + w > innerWidth - 8) x = innerWidth - 8 - w;
    if (y + h > innerHeight - 8) y = ev.clientY - 12 - h;
    pop.style.left = Math.max(8, x) + "px";
    pop.style.top = Math.max(8, y) + "px";
    sel.focus();

    const close = () => {
      pop.style.display = "none";
      pop.querySelector(".cp-ok").onclick = null;
      pop.querySelector(".cp-cancel").onclick = null;
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      this._closeCablePop = null;
    };
    this._closeCablePop = close;
    const onOutside = e => { if (!e.target.closest("#cablepop")) close(); };
    const onKey = e => { if (e.key === "Escape") { close(); setStatus("прокладка отменена"); } };
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    pop.querySelector(".cp-cancel").onclick = () => { close(); setStatus("прокладка отменена"); };
    pop.querySelector(".cp-ok").onclick = async () => {
      const type = sel.value;
      close();
      try {
        const body = {
          a_terminations: [{ object_type: a.otype, object_id: a.id }],
          b_terminations: [{ object_type: b.otype, object_id: b.id }],
          status: "connected",
        };
        if (type) body.type = type;   // пусто = без типа (нейтральный цвет)
        await api("/dcim/cables/", "POST", body);
        setStatus("кабель проложен: " + a.label + " ⇄ " + bLabel, "ok");
        await this.refreshCables();
      } catch (e) {
        setStatus("не получилось: " + e.message, "err");
      }
    };
  }

  // мини-меню связи
  _openLinkMenu(item, dev, dot, ev, cableId) {
    state.linkCtx = { cableId: cableId || (item.cable && item.cable.id), item, dev };
    this.linkmenu.style.display = "flex";
    this.linkmenu.style.left = (ev.clientX - 10) + "px";
    this.linkmenu.style.top = (ev.clientY - 42) + "px";
  }
  _closeLinkMenu() { this.linkmenu.style.display = "none"; state.linkCtx = null; }
  _farEndKey(cableId, nearOtype, nearId) {
    const cable = state.cables.find(c => c.id === cableId);
    if (!cable) return null;
    const all = [...(cable.a_terminations || []), ...(cable.b_terminations || [])];
    for (const t of all) {
      if (t.object_type !== nearOtype || t.object_id !== nearId) return termKey(t);
    }
    return null;
  }

  // трасса
  // ОДИНОЧНОЕ нажатие по занятому порту — подсветить ТОЛЬКО его связь.
  _traceLocal(item) {
    this._clearTrace();                                     // сброс прежней подсветки
    const cable = state.cables.find(c => c.id === (item.cable && item.cable.id));
    if (!cable) return;
    const aT = (cable.a_terminations || [])[0], bT = (cable.b_terminations || [])[0];
    const a = aT && state.ports[termKey(aT)], b = bT && state.ports[termKey(bT)];
    if (a && b) {
      this._hoverWire(cable.id, a, b, true);
      setStatus(`кабель: ${a.dev.name}/${a.item.name} ⇄ ${b.dev.name}/${b.item.name} — клик по фону снимет`, "ok");
    }
  }
  // ДВОЙНОЕ нажатие по занятому порту — продолжение (полная трасса через
  // пач-панели). Только для interface/power (у них есть API-трасса); у
  // front/rear/console продолжения нет → показываем просто связь.
  _onPortDblClick(kind, item) {
    if (Mode.on("schema") || state.pending || !item.cable) return;
    if (kind.ep === "interfaces" || kind.ep === "power-ports" || kind.ep === "power-outlets")
      this._trace(kind.ep, item);
    else
      this._traceLocal(item);
  }
  async _trace(ep, item) {
    this._clearTrace();                                     // сброс прежней подсветки/затемнения
    try {
      const segments = await api(`/dcim/${ep}/${item.id}/trace/`);
      const cableIds = new Set(segments.map(s => s[1] && s[1].id).filter(Boolean));
      const portKeys = new Set(), devIds = new Set();
      for (const seg of segments)
        for (const side of [seg[0], seg[2]])
          for (const t of (side || [])) {
            if (t.device) devIds.add(t.device.id);
            const m = (t.url || "").match(/\/dcim\/([a-z-]+)\/(\d+)\//);
            if (m && EP_TO_OTYPE[m[1]]) portKeys.add(EP_TO_OTYPE[m[1]] + ":" + m[2]);
          }
      document.querySelectorAll("#wires path.wire").forEach(p => {
        p.classList.remove("hl", "dim");
        p.classList.add(cableIds.has(+p.dataset.cable) ? "hl" : "dim");
      });
      Object.entries(state.ports).forEach(([k, p]) => p.el.classList.toggle("hl", portKeys.has(k)));
      // Ноды трассы — ярко (hl), ОСТАЛЬНЫЕ тускнеют (dim2). Чистим conn-hl от
      // прежнего ховера/одиночного клика, чтобы затемнение не «залипало» под
      // продолжением (была именно эта загвоздка).
      Object.entries(state.nodeEls).forEach(([id, el]) => {
        const inTrace = devIds.has(+id);
        el.classList.toggle("hl", inTrace);
        el.classList.toggle("dim2", !inTrace);
        el.classList.remove("conn-hl");
      });
      Object.entries(state.rackDevEls).forEach(([id, el]) => el.classList.toggle("hl", devIds.has(+id)));
      const last = segments[segments.length - 1];
      const endT = last && last[2] && last[2][0];
      const endTxt = endT ? (endT.device ? endT.device.name + "/" : "") + (endT.name || "?") : "?";
      setStatus(`путь: ${item.name} → ${endTxt} (${segments.length} кабел${segments.length === 1 ? "ь" : "я/ей"}) — клик по фону снимет`, "ok");
    } catch (e) {
      setStatus("трасса не построилась: " + e.message, "err");
    }
  }
  _clearTrace() {
    document.querySelectorAll("#wires path.wire").forEach(p => p.classList.remove("hl", "dim"));
    document.querySelectorAll(".port.hl").forEach(p => p.classList.remove("hl"));
    document.querySelectorAll(".node.hl, .dev.hl, .node.conn-hl, .node.dim2").forEach(el => el.classList.remove("hl", "conn-hl", "dim2"));
  }

  // зум / центровка
  applyZoom() {
    const canvas = $("#schema");
    if (canvas) canvas.style.transform = "scale(" + state.zoom + ")";
    const hint = $("#zoomhint");
    if (hint) hint.textContent = "масштаб " + Math.round(state.zoom * 100) + "% · колесо = масштаб";
  }

  // переключатель вида физика/сеть
  // Сетевой режим показывает ТОЛЬКО сетевые порты (wireless+circuit), заменяя
  // ими группы узла; физический — только физические. Перекладка портов и
  // ширины узла — в _layoutNode/relayoutNodes; невидимые порты не создаются в
  // DOM, поэтому кабели к ним просто не рисуются (redrawWires их пропускает).
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
    this.applyViewMode(true);   // первичная установка без relayout (узлы ещё в render)
  }
  // init=true — только выставить классы/кнопку (узлы разложит render сам);
  // иначе — полная перекладка узлов под новый режим.
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
    if (!init) this.relayoutNodes();   // перекладка портов/ширины + redrawWires
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

  // глобальные слушатели: pan/zoom, cancel-меню, кнопка Отмена
  _wire() {
    window.addEventListener("resize", () => this.redrawWires());
    $("#cancelconn").addEventListener("click", () => {
      this.setPending(null);
      setStatus("привязка отменена");
    });
    this.linkmenu.querySelector(".x").addEventListener("click", async () => {
      const ctx = state.linkCtx; this._closeLinkMenu();
      if (!ctx) return;
      try {
        await api("/dcim/cables/" + ctx.cableId + "/", "DELETE");
        setStatus("связь удалена", "ok");
        await this.refreshCables();
      } catch (e) { setStatus("не получилось: " + e.message, "err"); }
    });
    this.linkmenu.querySelector(".up").addEventListener("click", async () => {
      const ctx = state.linkCtx; this._closeLinkMenu();
      if (!ctx) return;
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
    this._enablePanZoom();
    this._enableResize();
  }
  _enablePanZoom() {
    const pane = $("#schempane");
    let panning = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0;
    pane.addEventListener("mousedown", ev => {
      if (ev.button !== 0) return;
      if (ev.target.closest(".node") || ev.target.closest(".port") || ev.target.tagName === "path") return;
      panning = true; moved = false;
      sx = ev.clientX; sy = ev.clientY; sl = pane.scrollLeft; st = pane.scrollTop;
      pane.classList.add("panning");
    });
    window.addEventListener("mousemove", ev => {
      if (!panning) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      pane.scrollLeft = sl - dx;
      pane.scrollTop = st - dy;
    });
    window.addEventListener("mouseup", ev => {
      if (!panning) return;
      panning = false;
      pane.classList.remove("panning");
      if (!moved && (ev.target.id === "schema" || ev.target.id === "wires" || ev.target.closest(".rackbox"))) {
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
