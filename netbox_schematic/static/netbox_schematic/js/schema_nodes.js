"use strict";
// Раскладка узлов и портов — примесь к прототипу SchemaManager (вынесено из schema.js).
// Методы копируются в SchemaManager.prototype через _mixin (см. schema.js).
import {
  $, state, mk, px, attachTip, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox } from "./schema_util.js";

class _Mixin {
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
    // Front и rear — две стороны ОДНОЙ панели: всегда на противоположных краях
    // узла (порт N под портом N). «Магистральная» сторона (к общей шине) — та,
    // что реально уходит в другую стойку; если ни одна не уходит (панель без
    // связей) — по умолчанию магистраль = rear. Без этого при пустом cross и
    // front, и rear получали одну сторону и ложились в один ряд (баг: без
    // подключений front/rear выстроились на одной стороне).
    const trunkType = cross.has("dcim.frontport") && !cross.has("dcim.rearport")
      ? "dcim.frontport" : "dcim.rearport";
    const top = [], bottom = [];
    for (const g of groups) {
      const o = g.kind.otype;
      let up;
      if (o === "dcim.frontport" || o === "dcim.rearport") up = (o === trunkType) === trunkUp;
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
  // Чистый расчёт раскладки узла (стороны, видимые группы, ширина) без DOM.
  // Нужен ДВАЖДЫ: в пре-проходе render() — чтобы посчитать ширину слота колонки
  // (SLOT) под самый широкий узел, и в _layoutNode — чтобы разместить порты.
  _nodeParts(dev, groups, netArg, editArg) {
    const MIN_W = 170, EDGE = (STEP - DOT) / 2 + 4;
    // netArg/editArg — оверрайды режима (для пре-прохода SLOT, чтобы ширина
    // слота не зависела от текущего режима отображения); иначе берём глобальные.
    const net = netArg !== undefined ? netArg : state.viewMode === "net";
    const edit = editArg !== undefined ? editArg : Mode.on("schema");
    const { top, bottom } = this._assignSides(dev, groups);
    const isPowerKind = k => k.otype === "dcim.powerport" || k.otype === "dcim.poweroutlet";
    const isConsoleKind = k => k.otype === "dcim.consoleport" || k.otype === "dcim.consoleserverport";
    // Видимость порта в текущем режиме: net → только сетевые, phys → только физ.
    const visItems = g => g.items.filter(it => this._isNetPort(g.kind.otype, it) === net);
    const visGroups = rows => rows.map(g => ({ g, items: visItems(g) })).filter(x => x.items.length);

    let topV, botLeftV, botRightV;
    if (net) {
      // «БЕСПРОВОДНОЙ» вид — ТОЛЬКО радио-интерфейсы (ieee802.11* / other-wireless
      // / с wireless_link) в нижнем ряду + зелёный «+» для создания. Проводные
      // circuit-выходы (облачко) переехали на «Физический» вид (см. _isNetPort).
      const ifaceGroups = groups.filter(g => g.kind.otype === "dcim.interface");
      const pick = pred => ifaceGroups
        .map(g => ({ g, items: g.items.filter(pred) }))
        .filter(x => x.items.length);
      topV = [];
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
    return { net, edit, EDGE, top, topV, botLeftV, botRightV, nBotL, nBotR, width };
  }

  // раскладка ОДНОГО узла: порты + ширина по текущему режиму
  _layoutNode(dev, node) {
    const P = this._nodeParts(dev, node._groups || []);
    const { net, edit, EDGE, top, topV, botLeftV, botRightV, nBotL, nBotR, width } = P;
    node.style.width = width + "px";
    // Центрируем в слоте колонки (SLOT = ширина самой широкой ноды, единая для
    // всех колонок), чтобы широкие ноды не вылезали в соседние (small_fix п.1).
    node.style.left = (node._x0 + (this.SLOT - BOX_PAD - width) / 2) + "px";

    // Пересобрать содержимое: имя/модель + подписи + порты.
    node.innerHTML = `<span class="nm">${dev.name}</span><span class="mdl">${dev.device_type.model} · U${dev.position}</span>`;
    node.querySelector(".nm").addEventListener("click", () => this.app.device.show(dev));

    // Подписи групп. В «БЕСПРОВОДНОМ» виде — только низ «Wireless» (радио).
    // В «ФИЗИЧЕСКОМ»: верх — типы портов, низ — console/питание.
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

}
export const NodeMethods = _Mixin.prototype;
