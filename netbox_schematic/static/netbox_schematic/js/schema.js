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
import { NodeMethods } from "./schema_nodes.js";
import { ContourMethods } from "./schema_contours.js";
import { PowerMethods } from "./schema_power.js";
import { WireMethods } from "./schema_wires.js";
import { InteractMethods } from "./schema_interact.js";

// Класс SchemaManager разнесён по модулям: базовые методы (constructor, render,
// предикаты, вид/зум/пан) — здесь, остальные — примесями. _mixin копирует
// НЕперечислимые методы прототипа (Object.assign их не берёт).
function _mixin(target, ...protos) {
  for (const p of protos)
    for (const k of Object.getOwnPropertyNames(p))
      if (k !== "constructor")
        Object.defineProperty(target, k, Object.getOwnPropertyDescriptor(p, k));
}


export class SchemaManager {
  constructor(app) {
    this.app = app;
    this.LEFT_PAD = 80;
    this.TOP_PAD = 150;
    this.SLOT = COL_W;   // ширина слота колонки; растёт под самый широкий узел (render)
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
            <button class="vs-btn" data-view="net"><i class="mdi mdi-access-point-network"></i> Беспроводной</button>
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

    // Пре-проход: ширина слота колонки (единая для всех) = самый широкий узел,
    // чтобы ноды с большим числом портов не вылезали в соседние колонки/контуры
    // (small_fix «Про схема» п.1). devNodeIdx нужен _assignSides (trunkUp) →
    // проставляем здесь же, в том же порядке, что и основной проход ниже.
    const devsOf = rack => byRack[rack.id].filter(d => d.position != null)
      .sort((a, b) => b.position - a.position);
    // Ширину берём как МАКСИМУМ по обоим режимам (физ. и сетевой+правка) — тогда
    // SLOT не «прыгает» при переключении вида без полного рендера (relayoutNodes
    // не двигает колонки), и широкие физ-панели не вылезут в сетевом рендере.
    let maxNodeW = 0;
    group.forEach((rack, col) => {
      let idx = 0;
      for (const dev of devsOf(rack)) {
        state.devCol[dev.id] = col;
        state.devNodeIdx[dev.id] = idx++;
        const gp = devPorts[dev.id] || [];
        maxNodeW = Math.max(maxNodeW,
          this._nodeParts(dev, gp, false, false).width,   // физический вид
          this._nodeParts(dev, gp, true, true).width);    // сетевой + правка (+wireless-«+»)
      }
    });
    this.SLOT = Math.max(COL_W, Math.ceil(maxNodeW) + BOX_PAD * 2);

    group.forEach((rack, col) => {
      const x0 = LEFT_PAD + col * (this.SLOT + COL_GAP) + BOX_PAD;
      const box = mk("div", { className: "rackbox", html: `<span class="rb-label">стойка ${rack.name}</span>`,
        style: { left: (x0 - BOX_PAD) + "px", top: (TOP_PAD - 34) + "px", width: (this.SLOT + BOX_PAD) + "px" } });
      canvas.appendChild(box);
      state.rackBoxEls[rack.id] = box;

      let y = TOP_PAD;
      let idx = 0;
      const devs = devsOf(rack);
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
    canvas.style.width = (LEFT_PAD + group.length * (this.SLOT + COL_GAP) + rightPad) + "px";
    canvas.style.height = (maxBottom + botPad) + "px";
    // Первая отрисовка — скроллбары посередине.
    pane.scrollLeft = (canvas.offsetWidth - pane.clientWidth) / 2;
    pane.scrollTop = (canvas.offsetHeight - pane.clientHeight) / 2;
  }

  // «Сетевой» (в терминах вида) = ТОЛЬКО радио → показывается на «Беспроводном»
  // виде. Circuit-порты (выход к провайдеру) теперь ФИЗИЧЕСКИЕ: видны на
  // «Физическом» виде облачком, а не скрыты (см. _placeDot: isCircuit → cloud).
  _isNetPort(otype, item) {
    if (otype !== "dcim.interface") return false;
    return this._isWirelessItem(item);
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

  applyZoom() {
    const canvas = $("#schema");
    if (canvas) canvas.style.transform = "scale(" + state.zoom + ")";
    const hint = $("#zoomhint");
    if (hint) hint.textContent = "масштаб " + Math.round(state.zoom * 100) + "% · колесо = масштаб";
  }

  // переключатель вида физика/беспроводной
  // «Беспроводной» вид показывает ТОЛЬКО радио-порты, заменяя ими группы узла;
  // «Физический» — физические (включая circuit-выходы облачком). Перекладка
  // портов и ширины узла — в _layoutNode/relayoutNodes; невидимые порты не
  // создаются в DOM, поэтому кабели к ним просто не рисуются (redrawWires).
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


_mixin(SchemaManager.prototype, NodeMethods, ContourMethods, PowerMethods, WireMethods, InteractMethods);
