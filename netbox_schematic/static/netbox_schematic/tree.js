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

export class TreeManager {
  constructor(app) {
    this.app = app;
    this.dropTargets = [];
    this.hold = { delay: null, timer: null, raf: null, el: null, drag: null };
    this.selection = new Set();   // Shift-мультивыбор узлов дерева (см. _toggleSelect)
    this._wireGlobal();
  }

  // DOM-построение
  build() {
    const nav = $("#tree");
    nav.innerHTML = "";
    this.dropTargets.length = 0;   // старые узлы удалены — сбрасываем таргеты
    this.selection.clear();        // старые DOM-узлы больше не валидны
    this._addBtn(nav, "+ регион (город)", "", () => this._createRegion());

    const groups = [
      ...state.regions.map(r => ({ region: r, sites: state.sites.filter(s => s.region && s.region.id === r.id) })),
      { region: null, sites: state.sites.filter(s => !s.region) },
    ];
    for (const g of groups) {
      if (g.region === null && !g.sites.length) continue;
      const rh = mk("div", {
        className: "tree-region" + (g.region ? " clickable" : ""),
        text: g.region ? g.region.name : "— без региона —",
        dataset: g.region ? { region: g.region.id } : {},
      });
      // Клик по региону грузит ВСЕ стойки его площадок (см. selectScope).
      if (g.region) rh.addEventListener("click", () => this.selectScope("region", g.region.id, g.region.name));
      this._makeDropTarget(rh, "site", g.region ? g.region.id : null);
      nav.appendChild(rh);
      this._addBtn(nav, "+ площадка", "lvl1", () =>
        this._createSite(g.region ? { id: g.region.id, name: g.region.name } : null));
      for (const site of g.sites) this._buildSiteNode(nav, site);
    }
    this._buildSiteGroups(nav);
  }

  // Группы площадок (Site Group) — независимая от регионов ось
  // Отдельная секция внизу дерева: группа → входящие в неё площадки. Клик по
  // группе грузит все стойки её площадок (selectScope "sitegroup"); клик по
  // площадке — саму площадку. Площадка может быть и в регионе, и в группе —
  // как в самом NetBox (две независимые классификации).
  _buildSiteGroups(nav) {
    const groups = state.siteGroups || [];
    if (!groups.length) return;
    nav.appendChild(mk("div", { className: "tree-groups-head", text: "Группы мест" }));
    for (const grp of groups) {
      const gEl = mk("div", { className: "tree-sitegroup", text: grp.name, dataset: { sitegroup: grp.id } });
      gEl.addEventListener("click", () => this.selectScope("sitegroup", grp.id, grp.name));
      this._makeDropTarget(gEl, "site", grp.id, "group");   // перетащить площадку в группу
      nav.appendChild(gEl);
      this._addBtn(nav, "+ площадка", "lvl2", () => this._createSiteInGroup(grp));
      const grpSites = state.sites.filter(s => s.group && s.group.id === grp.id);
      for (const site of grpSites) {
        const sEl = mk("div", { className: "tree-site sg-member",
          text: site.name, dataset: { site: site.id, sitegroup: grp.id } });
        sEl.addEventListener("click", () => this.selectScope("site", site.id, site.name));
        this._makeDraggable(sEl, "site", site.id, site.name);
        nav.appendChild(sEl);
      }
      if (!grpSites.length)
        nav.appendChild(mk("div", { className: "tree-empty", text: "нет площадок" }));
    }
  }

  _buildSiteNode(nav, site) {
    const s = mk("div", { className: "tree-site", text: site.name, dataset: { site: site.id } });
    // Клик по площадке грузит все стойки её серверных (см. selectScope).
    s.addEventListener("click", () => this.selectScope("site", site.id, site.name));
    this._makeDraggable(s, "site", site.id, site.name);
    this._makeDropTarget(s, "location", site.id);
    nav.appendChild(s);
    this._addBtn(nav, "+ серверная", "lvl2", () =>
      this._createLocation({ id: site.id, name: site.name }));
    const siteLocs = state.locations.filter(l => l.site && l.site.id === site.id);
    for (const loc of siteLocs) {
      const inGroup = state.racks.filter(r =>
        r.site.id === site.id && r.location && r.location.id === loc.id);
      const lb = mk("button", {
        className: "tree-loc",
        text: loc.name + (inGroup.length ? "" : " (пусто)"),
        dataset: { loc: loc.id, site: site.id },
      });
      // Серверная всегда кликабельна (грузит свои стойки; пустая — пустую схему).
      lb.addEventListener("click", () => this.selectScope("location", loc.id, loc.name));
      this._makeDraggable(lb, "location", loc.id, loc.name);
      this._makeDropTarget(lb, "rack", loc.id);
      this._makeDropTarget(lb, "panel", loc.id);   // сюда можно бросить щиток
      nav.appendChild(lb);
      this._addBtn(nav, "+ стойка", "lvl3", () =>
        this._createRack({ id: site.id, name: site.name }, { id: loc.id, name: loc.name }));
      for (const rack of inGroup) {
        const rb = mk("button", {
          className: "tree-rack", text: rack.name,
          dataset: { rack: rack.id, loc: loc.id, site: site.id },
        });
        rb.addEventListener("click", () => this.selectScope("location", loc.id, loc.name, rack.id));
        this._makeDraggable(rb, "rack", rack.id, rack.name);
        nav.appendChild(rb);
      }
      this._buildPowerNodes(nav, site, loc, inGroup);
    }
  }

  // Силовые щиты (Power Panel) серверной и их фидеры (Power Feed). Panel
  // привязан к Location, Feed — к Panel (+ опц. к стойке этой серверной).
  // Питание рисуется НЕ юнитом стойки, а отдельной ветвью дерева (сбоку).
  _buildPowerNodes(nav, site, loc, racksInLoc) {
    this._addBtn(nav, "+ силовой щит", "lvl3", () =>
      this._createPanel({ id: site.id, name: site.name }, { id: loc.id, name: loc.name }));
    const panels = (state.powerPanels || []).filter(p => p.location && p.location.id === loc.id);
    for (const panel of panels) {
      const pEl = mk("div", {
        className: "tree-panel", text: panel.name, dataset: { panel: panel.id, loc: loc.id, site: site.id },
      });
      this._makeDraggable(pEl, "panel", panel.id, panel.name);   // щиток можно перетаскивать
      this._makeDropTarget(pEl, "feed", panel.id);               // сюда можно бросить фидер
      nav.appendChild(pEl);
      this._addBtn(nav, "+ фидер", "lvl4", () => this._createFeed(panel));
      const feeds = (state.powerFeeds || []).filter(f => f.power_panel && f.power_panel.id === panel.id);
      for (const feed of feeds) {
        const fEl = mk("div", {
          className: "tree-feed", text: feed.name, dataset: { feed: feed.id, panel: panel.id },
        });
        this._makeDraggable(fEl, "feed", feed.id, feed.name);    // фидер можно перетаскивать
        nav.appendChild(fEl);
      }
    }
  }
  _addBtn(nav, text, lvl, fn) {
    nav.appendChild(mk("button", { className: "tree-add " + lvl, text, on: { click: fn } }));
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
  _createSiteGroup(region) {   // группа площадок — отдельная иерархия (Site Group)
    this.app.openModal("Новая группа площадок", region ? "В регионе: " + region.name : "",
      [{ id: "name", label: "Название", placeholder: "Группа ЦОД" }],
      async v => {
        await api("/dcim/site-groups/", "POST", { name: v.name, slug: slugify(v.name) });
        setStatus("группа площадок создана: " + v.name, "ok");
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
    if (el.classList.contains("tree-site")) return { kind: "site", id: +d.site, name: el.textContent.trim() };
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
        ["Регион", () => this._createRegion()],
        ["Группа мест", () => this._createSiteGroup(null)],
        ["Место", () => this._createSite(null)]];
      case "region": return [
        ["Место", () => this._createSite({ id: info.id, name: info.name })],
        ["Группа мест", () => this._createSiteGroup({ id: info.id, name: info.name })]];
      case "sitegroup": {
        const grp = (state.siteGroups || []).find(g => g.id === info.id);
        return grp ? [["Место", () => this._createSiteInGroup(grp)]] : [];
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
    return ["site", "location", "rack", "panel", "feed"].includes(info.kind);
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
      items.push({ label: "Переименовать", fn: () => this._rename(info) });
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
    if (info.kind === "site") {
      field = "region"; curr = "";
      const site = this._site(info.id); curr = site.region ? String(site.region.id) : "";
      opts = [{ value: "", label: "— без региона —" },
        ...state.regions.map(r => ({ value: String(r.id), label: r.name }))];
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
  _toggleSelect(node) {
    if (!this._nodeInfo(node)) return;   // не-узел (напр. «— без региона —»)
    if (this.selection.has(node)) { this.selection.delete(node); node.classList.remove("multi-sel"); }
    else { this.selection.add(node); node.classList.add("multi-sel"); }
  }
  _clearSelection() {
    if (!this.selection.size) return;
    this.selection.forEach(n => n.classList.remove("multi-sel"));
    this.selection.clear();
  }
  // Меню для группы выбранных: «Переместить (N)» (только если все одного
  // перемещаемого типа) и «Удалить (N)».
  _openGroupMenu(x, y) {
    this._closeContextMenu();
    const infos = [...this.selection].map(n => this._nodeInfo(n)).filter(Boolean);
    if (!infos.length) return;
    const sameKind = new Set(infos.map(i => i.kind)).size === 1;
    const items = [];
    if (sameKind && this._movable(infos[0]))
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
    if (kind === "site") {
      field = "region";
      opts = [{ value: "", label: "— без региона —" },
        ...state.regions.map(r => ({ value: String(r.id), label: r.name }))];
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
      const siteIds = new Set(state.sites
        .filter(x => x.group && String(x.group.id) === s).map(x => x.id));
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
    } else if (type === "region" || type === "sitegroup") {
      const parent = type === "region" ? "region" : "group";
      state.sites.filter(x => x[parent] && String(x[parent].id) === s)
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
    this.hold.el.classList.add("dragging");
    // Подсказка «куда можно бросить»: валидные цели (drop-таргеты под тип
    // переноса) остаются яркими и слегка подсвечены; ВСЁ остальное дерево
    // тускнеет. Напр. тянем стойку → светлые только серверные.
    const valid = new Set(this.dropTargets
      .filter(t => t.accepts === this.hold.drag.type).map(t => t.el));
    this.hold.faded = []; this.hold.targets = [];
    document.querySelectorAll(TREE_NODE_SEL).forEach(n => {
      if (n === this.hold.el) return;
      if (valid.has(n)) { n.classList.add("drag-ok"); this.hold.targets.push(n); }
      else { n.classList.add("drag-fade"); this.hold.faded.push(n); }
    });
    document.body.classList.add("tree-dragging");
  }
  _endDrag() {
    if (this.hold.el) this.hold.el.classList.remove("dragging");
    (this.hold.faded || []).forEach(n => n.classList.remove("drag-fade"));
    (this.hold.targets || []).forEach(n => n.classList.remove("drag-ok"));
    document.body.classList.remove("tree-dragging");
    document.querySelectorAll(".drop-ok").forEach(x => this._clearDropLabel(x));
    this.hold.el = null; this.hold.drag = null; this.hold.faded = null; this.hold.targets = null;
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
      this.hold.delay = setTimeout(() => {
        this._showRing(x, y);
        this.hold.timer = setTimeout(() => this._startDrag(), HOLD_MS);
      }, RING_DELAY);
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
      if ((this.hold.delay || this.hold.timer) && !this.hold.drag) { this._cancelHold(); return; }
      if (!this.hold.drag) return;
      const drag = this.hold.drag;
      const tgt = this.dropTargets.find(t => t.accepts === drag.type && t.el.contains(ev.target));
      this._endDrag();
      if (tgt) await this._applyMove(drag, tgt.accepts, tgt.parentId, tgt.field);
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
  async _applyMove(drag, type, parentId, field) {
    let path, body, where;
    if (type === "site") {
      path = "/dcim/sites/" + drag.id + "/";
      // бросок на группу мест → поле group; на регион → region.
      if (field === "group") { body = { group: parentId }; where = "группу мест"; }
      else { body = { region: parentId }; where = parentId ? "регион" : "без региона"; }
    } else if (type === "location") {
      path = "/dcim/locations/" + drag.id + "/";
      body = { site: parentId };
      where = "площадку";
    } else if (type === "rack") {
      const loc = state.locations.find(l => l.id === parentId);
      path = "/dcim/racks/" + drag.id + "/";
      body = { location: parentId, ...(loc && loc.site ? { site: loc.site.id } : {}) };
      where = "серверную";
    } else if (type === "panel") {
      const loc = state.locations.find(l => l.id === parentId);
      path = "/dcim/power-panels/" + drag.id + "/";
      body = { location: parentId, ...(loc && loc.site ? { site: loc.site.id } : {}) };
      where = "серверную";
    } else if (type === "feed") {
      path = "/dcim/power-feeds/" + drag.id + "/";
      body = { power_panel: parentId };
      where = "щит";
    } else return;
    try {
      await api(path, "PATCH", body);
      setStatus(`«${drag.name}» перемещён(а) в ${where}`, "ok");
      await this.reload();
    } catch (e) {
      setStatus("не удалось переместить: " + e.message, "err");
    }
  }
}
