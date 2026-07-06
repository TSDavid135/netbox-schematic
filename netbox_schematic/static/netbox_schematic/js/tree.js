"use strict";
// TreeManager: дерево регион→площадка→серверная→стойка
// Строит дерево, обрабатывает выбор серверной/стойки и drag-and-drop
// (перенос запускается зажатием, кольцо-прогресс). Режим правки дерева —
// Mode.on("tree") (показывает кнопки «+ создать»).

import { $, state, mk, slugify, currentLocationName } from "./core.js";
import { api, setStatus } from "./api.js";

const RING_DELAY = 150;              // пауза перед появлением кольца
const HOLD_MS = 380;                 // время заполнения кольца до старта переноса
const RING_LEN = 2 * Math.PI * 13;   // длина окружности r=13 (см. CSS/SVG)
// Все узлы дерева (для затемнения невалидных целей при переносе).
const TREE_NODE_SEL = ".tree-region,.tree-sitegroup,.tree-site,.tree-loc,.tree-rack,.tree-panel,.tree-feed";
// «Уровень» узла для Shift-мультивыбора = его РОДИТЕЛЬСКИЙ контейнер, а НЕ тип.
// Узлы одного уровня выбираются/перемещаются/удаляются вместе: стойки и щитки
// (и будущие устройства) живут в location → один уровень «location». Так выбор
// не привязан к типу, но остаётся в пределах одного слоя иерархии.
const NODE_LEVEL = {
  region: "region", sitegroup: "sitegroup",
  site: "site",
  location: "location",
  rack: "location", panel: "location",
  feed: "panel",
};

export class TreeManager {
  constructor(app) {
    this.app = app;
    this.dropTargets = [];
    this.hold = { delay: null, timer: null, raf: null, el: null, drag: null };
    this.selection = new Set();   // Shift-мультивыбор узлов дерева (см. _toggleSelect)
    this.collapsed = new Set();   // id свёрнутых групп (переживает build/reload)
    this._wireGlobal();
  }

  // DOM-построение. Единое дерево-ПАПКИ: группы мест (вложенные) → площадки →
  // серверные → стойки/щиты. Region — НЕ уровень дерева (у SiteGroup нет региона),
  // а метка на площадке. Площадки без группы — в секции «Без группы».
  build() {
    const nav = $("#tree");
    nav.innerHTML = "";
    this.dropTargets.length = 0;   // старые узлы удалены — сбрасываем таргеты
    this.selection.clear();        // старые DOM-узлы больше не валидны
    this._buildGroupsTree(nav);
    this._buildUngrouped(nav);
  }

  // Дерево групп мест (Site Group — вложенная модель по parent). Заголовок —
  // ещё и drop-таргет «в корень» (вынести группу из вложенности).
  _buildGroupsTree(nav) {
    const head = mk("div", { className: "tree-groups-head", text: "Группы мест" });
    this._makeDropTarget(head, "sitegroup", null, "parent");
    nav.appendChild(head);
    this._addBtn(nav, "+ группа мест", "", () => this._createSiteGroup(null));
    const childrenOf = {};
    for (const g of (state.siteGroups || [])) {
      const pid = (g.parent && g.parent.id) ?? "root";
      (childrenOf[pid] = childrenOf[pid] || []).push(g);
    }
    for (const g of (childrenOf.root || [])) this._buildGroupNode(nav, g, childrenOf, 0);
  }
  // Площадки без группы (group=null) — отдельная секция; заголовок принимает
  // площадку → снять группу (group:null).
  _buildUngrouped(nav) {
    const orphans = state.sites.filter(s => !s.group);
    if (!orphans.length) return;
    const head = mk("div", { className: "tree-groups-head", text: "Без группы" });
    this._makeDropTarget(head, "site", null, "group");
    nav.appendChild(head);
    this._addBtn(nav, "+ площадка", "", () => this._createSite(null));
    for (const site of orphans) this._buildSiteNode(nav, site, 30);
  }
  // Один узел группы (📁) + её подгруппы (рекурсивно) и площадки (раскрытые).
  // depth — вложенность (отступ). Группа: клик = scope, draggable (перенос в
  // другую группу/корень), drop-таргет для площадки (→ group) и подгруппы (→ parent).
  _buildGroupNode(nav, grp, childrenOf, depth) {
    const pad = 14 + depth * 16;
    const collapsed = this.collapsed.has(grp.id);
    // Стрелка — ОТДЕЛЬНАЯ кнопка (свернуть/развернуть). Клик по самой группе —
    // построить схему (selectScope), не трогая свёрнутость. Глифы иконок не идут
    // в textContent → _nodeInfo читает имя группы корректно.
    const gEl = mk("div", { className: "tree-sitegroup" + (collapsed ? " collapsed" : ""),
      dataset: { sitegroup: grp.id }, style: { paddingLeft: pad + "px" },
      html: `<button class="tree-chevron" tabindex="-1" title="Свернуть / развернуть">` +
        `<i class="mdi mdi-chevron-${collapsed ? "right" : "down"}"></i></button>` +
        `<i class="mdi mdi-folder-outline tree-ic"></i>${grp.name}` });
    gEl.querySelector(".tree-chevron").addEventListener("click", e => {
      e.stopPropagation(); this._toggleCollapse(grp.id);
    });
    gEl.addEventListener("click", () => this.selectScope("sitegroup", grp.id, grp.name));
    this._makeDraggable(gEl, "sitegroup", grp.id, grp.name);
    this._makeDropTarget(gEl, "site", grp.id, "group");       // площадку → в эту группу
    this._makeDropTarget(gEl, "sitegroup", grp.id, "parent"); // подгруппу → в эту группу
    nav.appendChild(gEl);
    if (collapsed) return;   // свёрнута — потомков и «+» не рисуем
    this._addBtnAt(nav, "+ подгруппа", pad + 20, () => this._createSiteGroup({ id: grp.id, name: grp.name }));
    this._addBtnAt(nav, "+ площадка", pad + 20, () => this._createSiteInGroup(grp));
    // ПАПКИ (подгруппы) — сверху, затем площадки этой группы (раскрытые).
    for (const sub of (childrenOf[grp.id] || [])) this._buildGroupNode(nav, sub, childrenOf, depth + 1);
    for (const site of state.sites.filter(s => s.group && s.group.id === grp.id))
      this._buildSiteNode(nav, site, pad + 18);
  }
  // Свернуть/развернуть группу: перестроить дерево (свёрнутые не рендерят детей)
  // и восстановить подсветку текущей области (build её сбрасывает).
  _toggleCollapse(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.build();
    if (state.scope) this._highlightScope(state.scope.type, state.scope.id);
  }
  // id группы + все её подгруппы (рекурсивно) — для сбора площадок всей ветви
  // и для запрета вложить группу саму в себя/потомка.
  _descendantGroupIds(rootId) {
    const childrenOf = {};
    for (const g of (state.siteGroups || [])) {
      const pid = g.parent && g.parent.id;
      (childrenOf[pid] = childrenOf[pid] || []).push(g.id);
    }
    const out = new Set(), stack = [Number(rootId)];
    while (stack.length) {
      const gid = stack.pop();
      if (out.has(gid)) continue;
      out.add(gid);
      for (const c of (childrenOf[gid] || [])) stack.push(c);
    }
    return out;
  }

  // Узел площадки (🗺) + серверные (📍) + стойки/щиты. sitePad — левый отступ
  // площадки (под группой глубже; в «Без группы» = 30). Имя — в data-name
  // (на будущее, если рядом появятся не-текстовые элементы). Region не показываем.
  _buildSiteNode(nav, site, sitePad = 30) {
    const shift = sitePad - 30;
    // Region в дереве не показываем (не уровень иерархии). Имя — в data-name.
    const s = mk("div", { className: "tree-site", dataset: { site: site.id, name: site.name },
      style: { paddingLeft: sitePad + "px" },
      html: `<i class="mdi mdi-map-outline tree-ic"></i>${site.name}` });
    // Клик по площадке грузит все стойки её серверных (см. selectScope).
    s.addEventListener("click", () => this.selectScope("site", site.id, site.name));
    this._makeDraggable(s, "site", site.id, site.name);
    this._makeDropTarget(s, "location", site.id);
    nav.appendChild(s);
    this._addBtnAt(nav, "+ серверная", 48 + shift, () =>
      this._createLocation({ id: site.id, name: site.name }));
    const siteLocs = state.locations.filter(l => l.site && l.site.id === site.id);
    for (const loc of siteLocs) {
      const inGroup = state.racks.filter(r =>
        r.site.id === site.id && r.location && r.location.id === loc.id);
      const lb = mk("button", {
        className: "tree-loc", dataset: { loc: loc.id, site: site.id },
        style: { paddingLeft: (48 + shift) + "px" },
        html: `<i class="mdi mdi-map-marker tree-ic"></i>${loc.name}${inGroup.length ? "" : " (пусто)"}`,
      });
      // Серверная всегда кликабельна (грузит свои стойки; пустая — пустую схему).
      lb.addEventListener("click", () => this.selectScope("location", loc.id, loc.name));
      this._makeDraggable(lb, "location", loc.id, loc.name);
      this._makeDropTarget(lb, "rack", loc.id);
      this._makeDropTarget(lb, "panel", loc.id);   // сюда можно бросить щиток
      nav.appendChild(lb);
      this._addBtnAt(nav, "+ стойка", 66 + shift, () =>
        this._createRack({ id: site.id, name: site.name }, { id: loc.id, name: loc.name }));
      for (const rack of inGroup) {
        const rb = mk("button", {
          className: "tree-rack", text: rack.name,
          dataset: { rack: rack.id, loc: loc.id, site: site.id },
          style: { paddingLeft: (66 + shift) + "px" },
        });
        rb.addEventListener("click", () => this.selectScope("location", loc.id, loc.name, rack.id));
        this._makeDraggable(rb, "rack", rack.id, rack.name);
        nav.appendChild(rb);
      }
      this._buildPowerNodes(nav, site, loc, inGroup, shift);
    }
  }

  // Силовые щиты (Power Panel) серверной и их фидеры (Power Feed). Panel
  // привязан к Location, Feed — к Panel (+ опц. к стойке этой серверной).
  // Питание рисуется НЕ юнитом стойки, а отдельной ветвью дерева (сбоку).
  _buildPowerNodes(nav, site, loc, racksInLoc, shift = 0) {
    this._addBtnAt(nav, "+ силовой щит", 66 + shift, () =>
      this._createPanel({ id: site.id, name: site.name }, { id: loc.id, name: loc.name }));
    const panels = (state.powerPanels || []).filter(p => p.location && p.location.id === loc.id);
    for (const panel of panels) {
      const pEl = mk("div", {
        className: "tree-panel", text: panel.name, dataset: { panel: panel.id, loc: loc.id, site: site.id },
        style: { paddingLeft: (66 + shift) + "px" },
      });
      // Клик по щитку — его паспорт справа (не грузит схему заново). Перенос и
      // Shift-мультивыбор работают как у стоек (_makeDraggable + capture-хендлер).
      pEl.addEventListener("click", () => this.app.device.showPanel(panel));
      this._makeDraggable(pEl, "panel", panel.id, panel.name);   // щиток можно перетаскивать
      this._makeDropTarget(pEl, "feed", panel.id);               // сюда можно бросить фидер
      nav.appendChild(pEl);
      this._addBtnAt(nav, "+ фидер", 84 + shift, () => this._createFeed(panel));
      const feeds = (state.powerFeeds || []).filter(f => f.power_panel && f.power_panel.id === panel.id);
      for (const feed of feeds) {
        const fEl = mk("div", {
          className: "tree-feed", text: feed.name, dataset: { feed: feed.id, panel: panel.id },
          style: { paddingLeft: (84 + shift) + "px" },
        });
        // Клик по фидеру — паспорт его щита (там кнопки правки/удаления фидера).
        fEl.addEventListener("click", () => this.app.device.showPanel(panel));
        this._makeDraggable(fEl, "feed", feed.id, feed.name);    // фидер можно перетаскивать
        nav.appendChild(fEl);
      }
    }
  }
  _addBtn(nav, text, lvl, fn) {
    nav.appendChild(mk("button", { className: "tree-add " + lvl, text, on: { click: fn } }));
  }
  // Кнопка «+» с ПРОИЗВОЛЬНЫМ левым отступом (для вложенных групп/площадок).
  _addBtnAt(nav, text, leftPx, fn) {
    nav.appendChild(mk("button", { className: "tree-add", text,
      style: { marginLeft: leftPx + "px", width: `calc(100% - ${leftPx + 12}px)` },
      on: { click: fn } }));
  }

  // Создание сущностей (общие модалки для кнопок «+» и ПКМ-меню)
  _createRegion() {
    this.app.openModal("Новый регион", "Верхний уровень: город / страна / округ",
      [{ id: "name", label: "Название", placeholder: "Санкт-Петербург" }],
      async v => {
        await api("/dcim/regions/", "POST", { name: v.name, slug: slugify(v.name) });
        setStatus("регион создан: " + v.name, "ok");
        await this.reload();
      });
  }
  _createSite(region) {   // region: {id,name} | null
    this.app.openModal("Новая площадка", region ? "Регион: " + region.name : "Без региона",
      [{ id: "name", label: "Название", placeholder: "ЦОД Пулково" }],
      async v => {
        await api("/dcim/sites/", "POST", {
          name: v.name, slug: slugify(v.name), status: "active",
          ...(region ? { region: region.id } : {}),
        });
        setStatus("площадка создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createSiteInGroup(group) {   // площадка сразу в группе площадок
    this.app.openModal("Новая площадка", "Группа: " + group.name,
      [{ id: "name", label: "Название", placeholder: "ЦОД Пулково" }],
      async v => {
        await api("/dcim/sites/", "POST",
          { name: v.name, slug: slugify(v.name), status: "active", group: group.id });
        setStatus("площадка создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createSiteGroup(parent) {   // parent: {id,name} род. ГРУППА (вложенность) или null (корень)
    this.app.openModal("Новая группа мест", parent ? "Внутри группы: " + parent.name : "",
      [{ id: "name", label: "Название", placeholder: "Группа ЦОД" }],
      async v => {
        await api("/dcim/site-groups/", "POST",
          { name: v.name, slug: slugify(v.name), ...(parent ? { parent: parent.id } : {}) });
        setStatus("группа мест создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createLocation(site) {   // site: {id,name}
    this.app.openModal("Новая серверная", "Площадка: " + site.name,
      [{ id: "name", label: "Название", placeholder: "Серверная 2" }],
      async v => {
        await api("/dcim/locations/", "POST",
          { site: site.id, name: v.name, slug: slugify(v.name), status: "active" });
        setStatus("серверная создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createRack(site, loc) {   // site,loc: {id,name}
    this.app.openModal("Новая стойка", "Серверная: " + loc.name,
      [
        { id: "name", label: "Имя стойки", placeholder: "R03" },
        { id: "uh", label: "Высота в юнитах", placeholder: "42" },
      ],
      async v => {
        await api("/dcim/racks/", "POST", {
          site: site.id, location: loc.id, name: v.name,
          u_height: +v.uh || 42, status: "active",
        });
        setStatus("стойка создана: " + v.name, "ok");
        await this.reload();
      });
  }
  _createPanel(site, loc) {   // site,loc: {id,name}
    this.app.openModal("Новый силовой щит", "Серверная: " + loc.name,
      [{ id: "name", label: "Название щита", placeholder: "Щит A" }],
      async v => {
        await api("/dcim/power-panels/", "POST",
          { site: site.id, location: loc.id, name: v.name });
        setStatus("силовой щит создан: " + v.name, "ok");
        await this.reload();
      });
  }
  _createFeed(panel) {   // panel: объект из state.powerPanels (есть .location)
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
        await this.reload();
      });
  }
  // Изменить фидер: форма со ВСЕМИ полями (имя, стойка «куда идёт», напряжение,
  // ток, фазность), предзаполненная текущими значениями → PATCH. Пустая стойка
  // → rack:null (снять привязку, если выбрали не ту). Стойки — из той же
  // серверной, что и щит (как при создании).
  _editFeed(info) {
    const feed = (state.powerFeeds || []).find(f => f.id === info.id);
    if (!feed) { setStatus("фидер не найден — обнови", "err"); return; }
    const panel = (state.powerPanels || []).find(p => p.id === (feed.power_panel && feed.power_panel.id));
    const locId = panel && panel.location && panel.location.id;
    const racksInLoc = (state.racks || []).filter(r => r.location && r.location.id === locId);
    const rackOpts = [{ value: "", label: "— без стойки —" },
      ...racksInLoc.map(r => ({ value: String(r.id), label: r.name }))];
    const curRack = feed.rack ? String(feed.rack.id) : "";
    const curPhase = (feed.phase && feed.phase.value) || feed.phase || "single-phase";
    this.app.openModal("Изменить фидер", "Щит: " + (panel ? panel.name : "?"),
      [
        { id: "name", label: "Название фидера", value: feed.name },
        { id: "rack", label: "Стойка (куда идёт)", type: "select", options: rackOpts, value: curRack },
        { id: "voltage", label: "Напряжение, В", value: feed.voltage ?? "" },
        { id: "amperage", label: "Ток, А", value: feed.amperage ?? "" },
        { id: "phase", label: "Фазность", type: "select", value: curPhase, options: [
          { value: "single-phase", label: "Однофазный" },
          { value: "three-phase", label: "Трёхфазный" }] },
      ],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api("/dcim/power-feeds/" + feed.id + "/", "PATCH", {
          name: v.name,
          rack: v.rack ? +v.rack : null,
          voltage: v.voltage ? +v.voltage : null,
          amperage: v.amperage ? +v.amperage : null,
          phase: v.phase || "single-phase",
        });
        setStatus("фидер изменён: " + v.name, "ok");
        await this.reload();
      }, "Сохранить");
  }

  // Контекстное меню (ПКМ) по узлам дерева
  // Состав: «Добавить ▸» (подменю с тем, что можно вложить), «Переместить»,
  // «Переименовать», «Удалить». Меню и подменю строятся под тип узла.
  API_PATH = { region: "/dcim/regions/", sitegroup: "/dcim/site-groups/", site: "/dcim/sites/",
    location: "/dcim/locations/", rack: "/dcim/racks/", panel: "/dcim/power-panels/", feed: "/dcim/power-feeds/" };
  KIND_RU = { region: "регион", sitegroup: "группу площадок", site: "площадку",
    location: "серверную", rack: "стойку", panel: "щит", feed: "фидер" };

  // Разбор узла дерева → {kind,id,name,site?,loc?}. null — если это не узел
  // (напр. «— без региона —» без data-region).
  _nodeInfo(el) {
    const d = el.dataset;
    if (el.classList.contains("tree-rack")) return { kind: "rack", id: +d.rack, name: el.textContent.trim(), site: +d.site, loc: +d.loc };
    if (el.classList.contains("tree-loc")) return { kind: "location", id: +d.loc, name: el.textContent.replace(/\s*\(пусто\)\s*$/, "").trim(), site: +d.site };
    if (el.classList.contains("tree-site")) return { kind: "site", id: +d.site, name: d.name || el.textContent.trim() };
    if (el.classList.contains("tree-sitegroup")) return { kind: "sitegroup", id: +d.sitegroup, name: el.textContent.trim() };
    if (el.classList.contains("tree-region")) return d.region ? { kind: "region", id: +d.region, name: el.textContent.trim() } : null;
    if (el.classList.contains("tree-panel")) return { kind: "panel", id: +d.panel, name: el.textContent.trim() };
    if (el.classList.contains("tree-feed")) return { kind: "feed", id: +d.feed, name: el.textContent.trim() };
    return null;
  }
  _site(id) { return state.sites.find(s => s.id === id) || { id, name: "" }; }
  _loc(id) { return state.locations.find(l => l.id === id) || { id, name: "" }; }

  // Что можно «добавить» под узел → [[label, fn], …].
  _addOptions(info) {
    switch (info.kind) {
      case "root": return [
        ["Группа мест", () => this._createSiteGroup(null)],
        ["Место (без группы)", () => this._createSite(null)]];
      case "region": return [
        ["Место", () => this._createSite({ id: info.id, name: info.name })],
        // Группа мест — независимая от региона ось (parent группы = ГРУППА, не
        // регион), поэтому создаём корневую группу.
        ["Группа мест", () => this._createSiteGroup(null)]];
      case "sitegroup": {
        const grp = (state.siteGroups || []).find(g => g.id === info.id);
        return grp ? [
          ["Место", () => this._createSiteInGroup(grp)],
          ["Подгруппа мест", () => this._createSiteGroup({ id: info.id, name: info.name })],
        ] : [];
      }
      case "site": return [
        ["Локация", () => this._createLocation(this._site(info.id))]];
      case "location": return [
        ["Стойка", () => this._createRack(this._site(info.site), this._loc(info.id))],
        ["Силовой щит", () => this._createPanel(this._site(info.site), this._loc(info.id))]];
      case "panel": {
        const panel = (state.powerPanels || []).find(p => p.id === info.id);
        return panel ? [["Фидер", () => this._createFeed(panel)]] : [];
      }
      default: return [];
    }
  }
  _movable(info) {
    return ["sitegroup", "site", "location", "rack", "panel", "feed"].includes(info.kind);
  }

  _openContextMenu(info, x, y) {
    this._closeContextMenu();
    const menu = mk("div", { className: "treectx" });
    const items = [];
    const addOpts = this._addOptions(info);
    if (addOpts.length) items.push({ label: "Добавить", submenu: addOpts });
    // Корневое меню блока — только «Добавить» (переименовывать/удалять нечего).
    if (info.kind !== "root") {
      if (this._movable(info)) items.push({ label: "Переместить", fn: () => this._move(info) });
      // Фидер: «Изменить» (все поля, вкл. стойку/напряжение/ток) вместо простого
      // переименования — чтобы можно было поправить не ту стойку и параметры.
      if (info.kind === "feed") items.push({ label: "Изменить", fn: () => this._editFeed(info) });
      else items.push({ label: "Переименовать", fn: () => this._rename(info) });
      items.push({ label: "Удалить", danger: true, fn: () => this._delete(info) });
    }
    for (const it of items) {
      const row = mk("div", {
        className: "tc-item" + (it.danger ? " danger" : "") + (it.submenu ? " has-sub" : ""),
        html: `<span>${it.label}</span>` + (it.submenu ? `<span class="tc-arrow">▸</span>` : ""),
      });
      if (it.submenu) {
        const sub = mk("div", { className: "tc-sub" });
        for (const [lbl, fn] of it.submenu)
          sub.appendChild(mk("div", { className: "tc-item", text: lbl,
            on: { click: e => { e.stopPropagation(); this._closeContextMenu(); fn(); } } }));
        row.appendChild(sub);
      } else {
        row.addEventListener("click", e => { e.stopPropagation(); this._closeContextMenu(); it.fn(); });
      }
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    // Держим меню в пределах окна.
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 8)) + "px";
    this._ctxMenu = menu;
  }
  _closeContextMenu() { if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; } }

  _rename(info) {
    const hasSlug = info.kind === "region" || info.kind === "sitegroup" || info.kind === "site" || info.kind === "location";
    this.app.openModal("Переименовать", "Текущее: " + info.name,
      [{ id: "name", label: "Новое название", value: info.name, placeholder: info.name }],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api(this.API_PATH[info.kind] + info.id + "/", "PATCH",
          { name: v.name, ...(hasSlug ? { slug: slugify(v.name) } : {}) });
        setStatus("переименовано: " + v.name, "ok");
        await this.reload();
      });
  }
  _delete(info) {
    this.app.openModal("Удалить " + (this.KIND_RU[info.kind] || "элемент") + "?",
      "«" + info.name + "» и всё вложенное. Действие необратимо.", [],
      async () => {
        await api(this.API_PATH[info.kind] + info.id + "/", "DELETE");
        setStatus("удалено: " + info.name, "ok");
        // Если удалили область, из которой построена схема — сбрасываем scope.
        if (state.scope && state.scope.type === info.kind && state.scope.id === info.id)
          state.scope = null;
        await this.reload();
      }, "Удалить");
  }
  _move(info) {
    let field, opts, curr;
    if (info.kind === "sitegroup") {
      field = "parent";
      const grp = (state.siteGroups || []).find(g => g.id === info.id);
      curr = grp && grp.parent ? String(grp.parent.id) : "";
      const banned = this._descendantGroupIds(info.id);   // себя и потомков — нельзя
      opts = [{ value: "", label: "— корень (без группы) —" },
        ...(state.siteGroups || []).filter(g => !banned.has(g.id))
          .map(g => ({ value: String(g.id), label: g.name }))];
    } else if (info.kind === "site") {
      // Площадка живёт в дереве под ГРУППОЙ мест → перемещаем между группами.
      field = "group";
      const site = this._site(info.id); curr = site.group ? String(site.group.id) : "";
      opts = [{ value: "", label: "— без группы —" },
        ...(state.siteGroups || []).map(g => ({ value: String(g.id), label: g.name }))];
    } else if (info.kind === "location") {
      field = "site";
      const loc = this._loc(info.id); curr = loc.site ? String(loc.site.id) : "";
      opts = state.sites.map(s => ({ value: String(s.id), label: s.name }));
    } else if (info.kind === "rack" || info.kind === "panel") {
      field = "location";
      const cur = info.kind === "rack"
        ? (state.racks || []).find(r => r.id === info.id)
        : (state.powerPanels || []).find(p => p.id === info.id);
      curr = cur && cur.location ? String(cur.location.id) : "";
      opts = state.locations.map(l => ({ value: String(l.id),
        label: (l.site ? l.site.name + " · " : "") + l.name }));
    } else if (info.kind === "feed") {
      field = "power_panel";
      const feed = (state.powerFeeds || []).find(f => f.id === info.id);
      curr = feed && feed.power_panel ? String(feed.power_panel.id) : "";
      opts = state.powerPanels.map(p => ({ value: String(p.id), label: p.name }));
    } else { setStatus("этот элемент нельзя перемещать", "err"); return; }
    this.app.openModal("Переместить «" + info.name + "»", "Выбери нового родителя",
      [{ id: "parent", label: "Куда", type: "select", options: opts, value: curr }],
      async v => {
        if (this._cycleGuard(info.kind, info.id, v.parent ? +v.parent : null)) return;
        const body = { [field]: v.parent ? +v.parent : null };
        // Стойка/щиток меняют и площадку вслед за серверной.
        if ((info.kind === "rack" || info.kind === "panel") && v.parent) {
          const loc = this._loc(+v.parent);
          if (loc && loc.site) body.site = loc.site.id;
        }
        await api(this.API_PATH[info.kind] + info.id + "/", "PATCH", body);
        setStatus("«" + info.name + "» перемещён(а)", "ok");
        await this.reload();
      }, "Переместить");
  }

  // Shift-мультивыбор: переключить узел, снять весь выбор, групповые операции.
  // Выбирать можно объекты одного УРОВНЯ (родительский контейнер, NODE_LEVEL) —
  // напр. стойки + щитки вместе (оба в location). Первый выбранный задаёт уровень.
  // Выбранные — синяя заливка (.multi-sel); остальные того же уровня, что ЕЩЁ
  // можно добавить, — зелёная обводка (.multi-cand, см. _updateSelCandidates).
  _toggleSelect(node) {
    const info = this._nodeInfo(node);
    if (!info) return;   // не-узел (напр. «— без региона —»)
    if (this.selection.has(node)) { this.selection.delete(node); node.classList.remove("multi-sel"); }
    else {
      const level = this._selLevel();
      if (level && NODE_LEVEL[info.kind] !== level) return;   // другой уровень — не добавляем
      this.selection.add(node); node.classList.add("multi-sel");
    }
    this._updateSelCandidates();
  }
  // Уровень текущего выбора (по первому выбранному узлу).
  _selLevel() {
    for (const n of this.selection) { const i = this._nodeInfo(n); if (i) return NODE_LEVEL[i.kind]; }
    return null;
  }
  // Подсветить кандидатов: узлы того же уровня, что и выбор, ещё не выбранные —
  // зелёной обводкой (.multi-cand). Пусто → снять все подсветки.
  _updateSelCandidates() {
    const tree = $("#tree");
    if (!tree) return;
    tree.querySelectorAll(".multi-cand").forEach(n => n.classList.remove("multi-cand"));
    const level = this._selLevel();
    if (!level) return;
    for (const n of tree.querySelectorAll(TREE_NODE_SEL)) {
      if (this.selection.has(n)) continue;
      const i = this._nodeInfo(n);
      if (i && NODE_LEVEL[i.kind] === level) n.classList.add("multi-cand");
    }
  }
  _clearSelection() {
    if (!this.selection.size) return;
    this.selection.forEach(n => n.classList.remove("multi-sel"));
    this.selection.clear();
    this._updateSelCandidates();   // снимет зелёные обводки кандидатов
  }
  // Меню для группы выбранных: «Переместить (N)» (если все одного УРОВНЯ и он
  // перемещаемый — напр. стойки+щитки в location) и «Удалить (N)».
  _openGroupMenu(x, y) {
    this._closeContextMenu();
    const infos = [...this.selection].map(n => this._nodeInfo(n)).filter(Boolean);
    if (!infos.length) return;
    // Выбор всегда в пределах одного уровня (_toggleSelect), но проверим явно.
    const sameLevel = new Set(infos.map(i => NODE_LEVEL[i.kind])).size === 1;
    const items = [];
    if (sameLevel && this._movable(infos[0]))
      items.push({ label: `Переместить (${infos.length})`, fn: () => this._moveMany(infos) });
    items.push({ label: `Удалить (${infos.length})`, danger: true, fn: () => this._deleteMany(infos) });
    const menu = mk("div", { className: "treectx" });
    for (const it of items) {
      const row = mk("div", { className: "tc-item" + (it.danger ? " danger" : ""), html: `<span>${it.label}</span>` });
      row.addEventListener("click", e => { e.stopPropagation(); this._closeContextMenu(); it.fn(); });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 8)) + "px";
    this._ctxMenu = menu;
  }
  _deleteMany(infos) {
    this.app.openModal(`Удалить объектов: ${infos.length}?`,
      infos.map(i => i.name).join(", ") + " — и всё вложенное. Действие необратимо.", [],
      async () => {
        for (const info of infos) {
          try { await api(this.API_PATH[info.kind] + info.id + "/", "DELETE"); }
          catch (e) { setStatus("не удалить «" + info.name + "»: " + e.message, "err"); }
        }
        setStatus(`удалено объектов: ${infos.length}`, "ok");
        if (state.scope && infos.some(i => i.kind === state.scope.type && i.id === state.scope.id))
          state.scope = null;
        this._clearSelection();
        await this.reload();
      }, "Удалить");
  }
  _moveMany(infos) {
    const kind = infos[0].kind;
    let field, opts;
    if (kind === "sitegroup") {
      field = "parent";
      opts = [{ value: "", label: "— корень (без группы) —" },
        ...(state.siteGroups || []).map(g => ({ value: String(g.id), label: g.name }))];
    } else if (kind === "site") {
      field = "group";
      opts = [{ value: "", label: "— без группы —" },
        ...(state.siteGroups || []).map(g => ({ value: String(g.id), label: g.name }))];
    } else if (kind === "location") {
      field = "site";
      opts = state.sites.map(s => ({ value: String(s.id), label: s.name }));
    } else if (kind === "rack" || kind === "panel") {
      field = "location";
      opts = state.locations.map(l => ({ value: String(l.id),
        label: (l.site ? l.site.name + " · " : "") + l.name }));
    } else if (kind === "feed") {
      field = "power_panel";
      opts = state.powerPanels.map(p => ({ value: String(p.id), label: p.name }));
    } else { setStatus("эти элементы нельзя перемещать", "err"); return; }
    this.app.openModal(`Переместить объектов: ${infos.length}`, "Выбери нового родителя",
      [{ id: "parent", label: "Куда", type: "select", options: opts }],
      async v => {
        for (const info of infos) {
          if (this._cycleGuard(info.kind, info.id, v.parent ? +v.parent : null)) continue;
          const body = { [field]: v.parent ? +v.parent : null };
          if ((info.kind === "rack" || info.kind === "panel") && v.parent) {
            const loc = this._loc(+v.parent);
            if (loc && loc.site) body.site = loc.site.id;
          }
          try { await api(this.API_PATH[info.kind] + info.id + "/", "PATCH", body); }
          catch (e) { setStatus("не переместить «" + info.name + "»: " + e.message, "err"); }
        }
        setStatus(`перемещено объектов: ${infos.length}`, "ok");
        this._clearSelection();
        await this.reload();
      }, "Переместить");
  }

  // Выбор области / перезагрузка
  // Клик по любому уровню иерархии (регион / площадка / серверная) грузит
  // ТОЛЬКО его и потомков. state.scope = откуда загружена схема → показывается
  // в заголовках «Стойки : …» и «Схема соединений : …» (currentLocationName).
  async selectScope(type, id, name, scrollRackId, force) {
    const racks = this._racksFor(type, id);
    this._highlightScope(type, id, scrollRackId);
    const key = type + ":" + id;
    if (force || state.groupKey !== key) {
      state.groupKey = key;
      state.scope = { type, id, name };
      await this.app.renderAll(racks);
    }
    if (scrollRackId && state.rackColEls[scrollRackId])
      state.rackColEls[scrollRackId].scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Стойки, попадающие в область: серверная → свои; площадка → все стойки её
  // серверных; регион → все стойки площадок региона. Сортируем по площадка →
  // серверная → стойка, чтобы колонки одной серверной/площадки шли подряд —
  // без этого пунктирные контуры Location/Site на схеме не собрать.
  _racksFor(type, id) {
    const s = String(id);
    let racks;
    if (type === "location")
      racks = state.racks.filter(r => r.location && String(r.location.id) === s);
    else if (type === "site")
      racks = state.racks.filter(r => r.site && String(r.site.id) === s);
    else if (type === "region") {
      const siteIds = new Set(state.sites
        .filter(x => x.region && String(x.region.id) === s).map(x => x.id));
      racks = state.racks.filter(r => r.site && siteIds.has(r.site.id));
    } else if (type === "sitegroup") {
      // рекурсивно: площадки самой группы + всех её подгрупп.
      const gids = this._descendantGroupIds(id);
      const siteIds = new Set(state.sites
        .filter(x => x.group && gids.has(x.group.id)).map(x => x.id));
      racks = state.racks.filter(r => r.site && siteIds.has(r.site.id));
    } else return [];
    const key = r => [
      (r.site && r.site.name) || "", (r.location && r.location.name) || "", r.name || "",
    ];
    return racks.sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) { const c = ka[i].localeCompare(kb[i]); if (c) return c; }
      return 0;
    });
  }

  // Подсветка выбранной области в дереве. ЛОГИКА: жирную accent-полоску слева
  // получает ТОЛЬКО выбранный корень (от какого родителя строится схема); все
  // его потомки, попавшие на схему (площадки, серверные, стойки, щитки, фидеры),
  // получают «серенькую» тонкую метку .on-schema — «это есть на схеме». Всё
  // остальное — по умолчанию.
  _highlightScope(type, id, scrollRackId) {
    const all = ".tree-region,.tree-sitegroup,.tree-site,.tree-loc,.tree-rack,.tree-panel,.tree-feed";
    document.querySelectorAll(all).forEach(x =>
      x.classList.remove("scope-active", "on-schema", "current", "active"));
    const s = String(id);
    // Наборы потомков, реально попадающих на схему.
    const siteIds = new Set(), locIds = new Set();
    if (type === "location") locIds.add(s);
    else if (type === "site") {
      siteIds.add(s);
      state.locations.filter(l => l.site && String(l.site.id) === s)
        .forEach(l => locIds.add(String(l.id)));
    } else if (type === "region") {
      state.sites.filter(x => x.region && String(x.region.id) === s)
        .forEach(x => siteIds.add(String(x.id)));
      state.locations.filter(l => l.site && siteIds.has(String(l.site.id)))
        .forEach(l => locIds.add(String(l.id)));
    } else if (type === "sitegroup") {
      // рекурсивно по подгруппам (как в _racksFor).
      const gids = this._descendantGroupIds(s);
      state.sites.filter(x => x.group && gids.has(x.group.id))
        .forEach(x => siteIds.add(String(x.id)));
      state.locations.filter(l => l.site && siteIds.has(String(l.site.id)))
        .forEach(l => locIds.add(String(l.id)));
    }
    const panelIds = new Set((state.powerPanels || [])
      .filter(p => p.location && locIds.has(String(p.location.id))).map(p => String(p.id)));
    const feedIds = new Set((state.powerFeeds || [])
      .filter(f => f.power_panel && panelIds.has(String(f.power_panel.id))).map(f => String(f.id)));
    const mark = (sel, cls) => document.querySelectorAll(sel).forEach(x => x.classList.add(cls));
    siteIds.forEach(v => mark(`.tree-site[data-site="${v}"]`, "on-schema"));
    locIds.forEach(v => {
      mark(`.tree-loc[data-loc="${v}"]`, "on-schema");
      mark(`.tree-rack[data-loc="${v}"]`, "on-schema");
    });
    panelIds.forEach(v => mark(`.tree-panel[data-panel="${v}"]`, "on-schema"));
    feedIds.forEach(v => mark(`.tree-feed[data-feed="${v}"]`, "on-schema"));
    // Выбранный корень — единственная жирная полоска (снимаем с него on-schema).
    const rootSel = { region: `.tree-region[data-region="${s}"]`,
      sitegroup: `.tree-sitegroup[data-sitegroup="${s}"]`,
      site: `.tree-site[data-site="${s}"]`, location: `.tree-loc[data-loc="${s}"]` }[type];
    if (rootSel) document.querySelectorAll(rootSel).forEach(x => {
      x.classList.remove("on-schema"); x.classList.add("scope-active");
    });
    if (scrollRackId) mark(`.tree-rack[data-rack="${scrollRackId}"]`, "current");
  }

  async reload() {
    const scope = state.scope;
    await this.app.connect();
    if (scope) await this.selectScope(scope.type, scope.id, scope.name, null, true);
  }

  // Drag-and-drop (зажатие → кольцо → перенос)
  _ring() { return document.getElementById("holdring"); }
  _moveRing(x, y) { const r = this._ring(); r.style.left = x + "px"; r.style.top = y + "px"; }
  _showRing(x, y) {
    const fg = this._ring().querySelector(".fg");
    fg.style.strokeDasharray = RING_LEN;
    fg.style.strokeDashoffset = RING_LEN;
    this._moveRing(x, y);
    this._ring().style.display = "block";
    const t0 = performance.now();
    const step = now => {
      const p = Math.min((now - t0) / HOLD_MS, 1);
      fg.style.strokeDashoffset = RING_LEN * (1 - p);
      if (p < 1) this.hold.raf = requestAnimationFrame(step);
    };
    this.hold.raf = requestAnimationFrame(step);
  }
  _hideRing() {
    this._ring().style.display = "none";
    if (this.hold.raf) cancelAnimationFrame(this.hold.raf);
    this.hold.raf = null;
  }
  _cancelHold() {
    clearTimeout(this.hold.delay); this.hold.delay = null;
    clearTimeout(this.hold.timer); this.hold.timer = null;
    this._hideRing();
    this.hold.el = null;
  }
  _startDrag() {
    // Старт мог прийти и от таймера-удержания, и от смещения мыши — гасим таймеры.
    clearTimeout(this.hold.delay); this.hold.delay = null;
    clearTimeout(this.hold.timer); this.hold.timer = null;
    this._hideRing();
    if (!this.hold.el || !this.hold.el._dragInfo) return;
    this.hold.drag = this.hold.el._dragInfo;
    this.hold.dragged = true;
    // Тянущиеся узлы: при групповом переносе — ВСЕ выбранные, иначе один.
    const dragged = this.hold.groupDrag ? new Set(this.selection) : new Set([this.hold.el]);
    dragged.forEach(n => n.classList.add("dragging"));
    // Подсказка «куда можно бросить»: валидные цели (drop-таргеты под тип
    // переноса) остаются яркими и слегка подсвечены; ВСЁ остальное дерево
    // тускнеет. Напр. тянем стойку → светлые только серверные. Все выбранные
    // одного уровня → у них общий тип цели.
    const valid = new Set(this.dropTargets
      .filter(t => t.accepts === this.hold.drag.type).map(t => t.el));
    this.hold.faded = []; this.hold.targets = [];
    document.querySelectorAll(TREE_NODE_SEL).forEach(n => {
      if (dragged.has(n)) return;   // сами тянущиеся не трогаем
      if (valid.has(n)) { n.classList.add("drag-ok"); this.hold.targets.push(n); }
      else { n.classList.add("drag-fade"); this.hold.faded.push(n); }
    });
    document.body.classList.add("tree-dragging");
  }
  _endDrag() {
    document.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
    (this.hold.faded || []).forEach(n => n.classList.remove("drag-fade"));
    (this.hold.targets || []).forEach(n => n.classList.remove("drag-ok"));
    document.body.classList.remove("tree-dragging");
    document.querySelectorAll(".drop-ok").forEach(x => this._clearDropLabel(x));
    this.hold.el = null; this.hold.drag = null; this.hold.faded = null; this.hold.targets = null;
    this.hold.groupDrag = false;
  }
  _setDropLabel(el) {
    if (el.classList.contains("drop-ok")) return;
    el.classList.add("drop-ok");
    el._label0 = el.textContent;
    el.textContent = "↳ Вставить сюда";
  }
  _clearDropLabel(el) {
    el.classList.remove("drop-ok");
    if (el._label0 != null) { el.textContent = el._label0; el._label0 = null; }
  }
  _makeDraggable(el, type, id, name) {
    el._dragInfo = { type, id, name };
    el.addEventListener("mousedown", ev => {
      if (ev.button !== 0 || ev.shiftKey) return;   // Shift — мультивыбор, не перенос
      this.hold.el = el;
      const x = ev.clientX, y = ev.clientY;
      this.hold.sx = x; this.hold.sy = y;   // старт — для порога смещения (drag по движению)
      // Тянут один из ВЫБРАННЫХ (≥2) → групповой перенос: кольцо-удержание НЕ
      // показываем (мешает), старт сразу по смещению мыши. Иначе — как раньше.
      this.hold.groupDrag = this.selection.has(el) && this.selection.size > 1;
      if (!this.hold.groupDrag) {
        this.hold.delay = setTimeout(() => {
          this._showRing(x, y);
          this.hold.timer = setTimeout(() => this._startDrag(), HOLD_MS);
        }, RING_DELAY);
      }
    });
  }
  // field — необязательное поле связи для _applyMove (напр. site можно бросить
  // и на регион → region, и на группу мест → group). По умолчанию — по типу.
  _makeDropTarget(el, accepts, parentId, field) {
    this.dropTargets.push({ el, accepts, parentId, field });
    el.addEventListener("mouseenter", () => {
      if (this.hold.drag && this.hold.drag.type === accepts) this._setDropLabel(el);
    });
    el.addEventListener("mouseleave", () => this._clearDropLabel(el));
  }
  _wireGlobal() {
    document.addEventListener("mousemove", ev => {
      // Пока зажато на узле, но перенос ещё не начат: сдвиг мыши за порог сразу
      // запускает перенос (не надо ждать удержания) — так «нажал и потянул»
      // работает интуитивно. Стоя на месте — ждём кольцо-удержание, как раньше.
      if (this.hold.el && !this.hold.drag) {
        const dx = ev.clientX - this.hold.sx, dy = ev.clientY - this.hold.sy;
        if (Math.abs(dx) + Math.abs(dy) > 6) this._startDrag();
        else if (this.hold.timer || this.hold.delay) this._moveRing(ev.clientX, ev.clientY);
      }
    });
    document.addEventListener("mouseup", async ev => {
      // Перенос не начат (просто клик/удержание без движения) → снять кольцо/hold.
      if (!this.hold.drag) { this._cancelHold(); return; }
      const drag = this.hold.drag, group = this.hold.groupDrag;
      const tgt = this.dropTargets.find(t => t.accepts === drag.type && t.el.contains(ev.target));
      this._endDrag();
      if (tgt) {
        if (group) await this._applyMoveMany(tgt);   // переместить всех выбранных
        else await this._applyMove(drag, tgt.accepts, tgt.parentId, tgt.field);
      }
    });
    // click после переноса глушим (иначе drag сработает ещё и как выбор)
    document.addEventListener("click", ev => {
      if (this.hold.dragged) { ev.stopPropagation(); ev.preventDefault(); this.hold.dragged = false; }
    }, true);
    // Shift-мультивыбор: в capture-фазе перехватываем клик ДО навигационного
    // обработчика узла (selectScope). Shift+клик — переключить выбор узла;
    // обычный клик без Shift — снять мультивыбор (и дать навигации сработать).
    document.addEventListener("click", ev => {
      const node = ev.target.closest(TREE_NODE_SEL);
      if (ev.shiftKey && node && $("#tree").contains(node)) {
        ev.preventDefault(); ev.stopPropagation();
        this._toggleSelect(node);
      } else if (!ev.shiftKey) {
        this._clearSelection();
      }
    }, true);
    // ПКМ по узлу дерева → контекстное меню. Делегирование на document, чтобы
    // переживать перестройку дерева (build чистит innerHTML). ПКМ по пустому
    // месту всего блока «Инфраструктура» (#side-infra) → корневое меню создания
    // (регион / площадка) — создавать объекты не сменяя режим правки.
    document.addEventListener("contextmenu", ev => {
      const el = ev.target.closest(".tree-region,.tree-sitegroup,.tree-site,.tree-loc,.tree-rack,.tree-panel,.tree-feed");
      if (el && $("#tree").contains(el)) {
        const info = this._nodeInfo(el);
        if (!info) return;
        ev.preventDefault();
        // ПКМ по одному из выбранных (мультивыбор ≥2) → групповое меню.
        if (this.selection.size >= 2 && this.selection.has(el))
          this._openGroupMenu(ev.clientX, ev.clientY);
        else
          this._openContextMenu(info, ev.clientX, ev.clientY);
      } else if (ev.target.closest("#side-infra")) {
        ev.preventDefault();
        this._openContextMenu({ kind: "root" }, ev.clientX, ev.clientY);
      }
    });
    // Закрытие меню: клик вне, Escape, прокрутка дерева/страницы.
    document.addEventListener("mousedown", ev => {
      if (this._ctxMenu && !ev.target.closest(".treectx")) this._closeContextMenu();
    });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") this._closeContextMenu(); });
    document.addEventListener("scroll", () => this._closeContextMenu(), true);
  }
  // Путь+тело PATCH для переноса узла type/id под нового родителя parentId.
  // Общее для одиночного (_applyMove) и группового (_applyMoveMany) переноса.
  _moveBody(type, id, parentId, field) {
    if (type === "sitegroup")
      return { path: "/dcim/site-groups/" + id + "/", body: { parent: parentId },
        where: parentId ? "группу" : "корень" };
    if (type === "site")
      return field === "group"
        ? { path: "/dcim/sites/" + id + "/", body: { group: parentId }, where: "группу мест" }
        : { path: "/dcim/sites/" + id + "/", body: { region: parentId }, where: parentId ? "регион" : "без региона" };
    if (type === "location")
      return { path: "/dcim/locations/" + id + "/", body: { site: parentId }, where: "площадку" };
    if (type === "rack" || type === "panel") {
      const loc = state.locations.find(l => l.id === parentId);
      const base = type === "rack" ? "/dcim/racks/" : "/dcim/power-panels/";
      return { path: base + id + "/", body: { location: parentId, ...(loc && loc.site ? { site: loc.site.id } : {}) }, where: "серверную" };
    }
    if (type === "feed")
      return { path: "/dcim/power-feeds/" + id + "/", body: { power_panel: parentId }, where: "щит" };
    return null;
  }
  // Нельзя вложить группу в саму себя/свою подгруппу (цикл).
  _cycleGuard(type, id, parentId) {
    if (type !== "sitegroup" || parentId == null) return false;
    if (this._descendantGroupIds(id).has(Number(parentId))) {
      setStatus("нельзя вложить группу в саму себя или свою подгруппу", "err");
      return true;
    }
    return false;
  }
  async _applyMove(drag, type, parentId, field) {
    if (this._cycleGuard(type, drag.id, parentId)) return;
    const m = this._moveBody(type, drag.id, parentId, field);
    if (!m) return;
    try {
      await api(m.path, "PATCH", m.body);
      setStatus(`«${drag.name}» перемещён(а) в ${m.where}`, "ok");
      await this.reload();
    } catch (e) {
      setStatus("не удалось переместить: " + e.message, "err");
    }
  }
  // Групповой перенос (тянут один из выбранных): переместить ВСЕ выбранные узлы
  // под родителя из drop-таргета и СОХРАНИТЬ визуальное выделение после reload.
  async _applyMoveMany(tgt) {
    const infos = [...this.selection].map(n => this._nodeInfo(n)).filter(Boolean);
    if (!infos.length) return;
    let ok = 0;
    for (const info of infos) {
      if (this._cycleGuard(info.kind, info.id, tgt.parentId)) continue;
      const m = this._moveBody(info.kind, info.id, tgt.parentId, tgt.field);
      if (!m) continue;
      try { await api(m.path, "PATCH", m.body); ok++; }
      catch (e) { setStatus(`не переместить «${info.name}»: ${e.message}`, "err"); }
    }
    setStatus(`перемещено объектов: ${ok}`, "ok");
    await this.reload();
    this._restoreSelection(infos);
  }
  // Восстановить выделение (по kind+id) после перестройки дерева — чтобы после
  // группового переноса подсветка выбранных сохранялась.
  _restoreSelection(infos) {
    const tree = $("#tree");
    if (!tree) return;
    const CLS = { region: "region", sitegroup: "sitegroup", site: "site", location: "loc",
      rack: "rack", panel: "panel", feed: "feed" };
    for (const info of infos) {
      const key = CLS[info.kind];
      const n = key && tree.querySelector(`.tree-${key}[data-${key}="${info.id}"]`);
      if (n) { this.selection.add(n); n.classList.add("multi-sel"); }
    }
    this._updateSelCandidates();
  }
}
