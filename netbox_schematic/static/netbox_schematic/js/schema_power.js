"use strict";
// Силовые щитки и фидеры — примесь к прототипу SchemaManager (вынесено из schema.js).
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
  // Рисует силовые щитки (Power Panel) КАЖДОЙ серверной области — своим рядом
  // ПОД ВСЕМ её содержимым (стойки + карман off-rack устройств), по центру их
  // общего охвата. Геометрия локаций — из пре-прохода render
  // (this._locOrder / _colX, см. _computeLocGeometry). Возвращает maxBottom.
  _renderPowerPanels(canvas, group, maxBottom) {
    if (!group.length) return maxBottom;
    // Открыта ОДНА стойка (scope "rack") — щитки локации не показываем.
    if (state.scope && state.scope.type === "rack") return maxBottom;
    const GAP_Y = 40;
    state.powerBoxEls = {};
    state.feedRowEls = {};
    const edit = Mode.on("schema");
    let bottom = maxBottom;
    for (const g of this._locOrder || []) {
      const panels = (state.powerPanels || []).filter(p => p.location && p.location.id === g.locId);
      if (!panels.length) continue;
      // Низ содержимого = max(низ стоек, низ кармана устройств) → щитки под всем.
      const contentBottom = Math.max(g.rackBottom, g.areaH ? g.devTop + g.areaH : 0);
      // Центр = середина охвата «стойки + карман».
      const spanLeft = this._colX(g.minCol);
      const spanRight = g.areaW ? g.devX + g.areaW
        : this._colX(g.maxCol) + this.SLOT + BOX_PAD;
      bottom = Math.max(bottom, this._renderPanelRow(
        canvas, panels, (spanLeft + spanRight) / 2, contentBottom + GAP_Y, edit));
    }
    return bottom;
  }

  // Рисует РЯД щитков одной серверной, центрированный под её стойками (centerX),
  // начиная с top. Возвращает низ ряда (для расчёта высоты холста).
  _renderPanelRow(canvas, panels, centerX, top, edit) {
    const PANEL_W = 280, HEAD_H = 30, ROW_H = 24, GAP_X = 28;
    const panelFeeds = panels.map(p =>
      (state.powerFeeds || []).filter(f => f.power_panel && f.power_panel.id === p.id));
    // В правке добавляется строка «+ фидер» → высота щитка на 1 ряд больше.
    const rowsOf = fs => edit ? fs.length + 1 : Math.max(1, fs.length);
    const maxH = Math.max(...panelFeeds.map(fs => HEAD_H + rowsOf(fs) * ROW_H + 8));
    // Ряд щитков центрируется под своими стойками (весь ряд вокруг centerX),
    // чтобы не вылезать за охват серверной в соседнюю.
    const rowW = panels.length * PANEL_W + (panels.length - 1) * GAP_X;
    const x0 = centerX - rowW / 2;
    // Контур блока щитков «Силовые щиты» (позади карточек) — с подписью и заливкой,
    // как у контуров-типов устройств.
    const CONT_HEAD = 28, CONT_PAD = 14;
    const contour = this._contourEl("gb-power", "Силовые щиты", {
      left: x0 - CONT_PAD, top: top - CONT_HEAD,
      width: rowW + CONT_PAD * 2, height: CONT_HEAD + maxH + CONT_PAD });
    canvas.insertBefore(contour, canvas.firstChild);
    let x = x0;
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
    canvas.querySelectorAll(".powerbox, .groupbox.gb-power").forEach(el => el.remove());
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
      // Порт фидера — на ЛЕВОЙ грани щита → провод ВСЕГДА выходит перпендикулярно
      // (90°, горизонтально влево) на короткий вынос, и лишь ПОТОМ уходит в путь
      // (small_fix: «от щитков сначала под 90° от порта, а потом путь»).
      const sx = fx - 26;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      // Стиль как у обычных проводов:
      //  · «Круглые» — гориз. вынос, затем вертикальный кубик к PDU;
      //  · «Углы» + «Короткий» — вынос, скруглённая угольная трасса через середину;
      //  · «Углы» + «Расширенный» — вынос, затем коридором колонки PDU в обход нод.
      let d;
      if (state.wireStyle !== "angular") {
        // Гладкий кубик, КАК остальные «круглые» провода, но выходит из порта
        // ГОРИЗОНТАЛЬНО (первый контрол слева) → 90° от щита без ломаного стыка.
        d = `M ${fx} ${fy} C ${fx - 44} ${fy}, ${px2} ${midY}, ${px2} ${py}`;
      } else if (state.wirePath === "extend" && state.devCol[port.dev.id] != null) {
        const col = state.devCol[port.dev.id];
        const corr = this._colX(col) + this.SLOT + COL_GAP / 2 - 52;
        // Горизонтальный переход ведём НАД щитками (верхний край самого верхнего
        // щитка − отступ), чтобы линия не резала их боксы, затем коридором
        // колонки PDU вверх к его порту. state.powerBoxEls — боксы щитков.
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
