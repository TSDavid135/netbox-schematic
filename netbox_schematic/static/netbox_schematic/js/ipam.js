"use strict";
// IpamCanvas: холст «Сеть / IPAM»
// Инвертированная модель: блоки — МЕСТА (Region ⊃ Site/SiteGroup ⊃ Location,
// пунктирные, как на Инфраструктуре), внутри места — СЕТИ (пунктир синий),
// привязанные штатным полем NetBox `prefix.scope` (region/site/location).
// Внутри сети — занятые адреса + счётчик свободных.
//
// Связь сеть↔место — `prefix.scope` (scope_type + scope_id). Перетаскивание
// сети в место = PATCH scope → НАСТОЯЩАЯ запись БД, не координаты. Сеть в двух
// местах → рисуется в обоих (норма). Дерево слева — та же иерархия мест + сети.
// Режимы edit/view — класс body.ipam-edit (view: смотреть; edit: драг+создание).

import { $, state, mk, modeBtn, slugify } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";

// CIDR-утилиты (uint32)
function parseCidr(cidr) {
  const [addr, nStr] = cidr.split("/");
  const bits = Number.parseInt(nStr, 10);
  const parts = addr.split(".").map(Number);
  if (parts.length === 4 && parts.every(x => x >= 0 && x <= 255)) {
    const base = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
    return { base, bits, size: 2 ** (32 - bits), v4: true };
  }
  return { base: 0, bits, size: 2 ** Math.max(0, 64 - bits), v4: false };
}
const maskOf = bits => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);
const inNet = (net, addrBase) => (net.base & maskOf(net.bits)) === (addrBase & maskOf(net.bits));

// scope_type NetBox → внутренний ключ места
const SCOPE_KEY = { "dcim.region": "region", "dcim.site": "site", "dcim.sitegroup": "sitegroup", "dcim.location": "location" };

export class IpamCanvas {
  constructor(app) {
    this.app = app;
    this.drag = null;
    this.dragged = false;   // был перенос → подавить click после mouseup
    this._lastNet = null;   // открытые детали {n, place} — для перерисовки
    this.zoom = 1;          // масштаб полотна (колесо), пан — скроллом #ipam-scroll
    this.collapsed = new Set();   // id свёрнутых папок-групп в дереве (переживает renderTree)
    // Призрак «Сюда» при переносе сети: mouseover всплывает → closest(".place")
    // даёт самое ВЛОЖЕННОЕ место под курсором (регион ⊃ площадка ⊃ локация).
    this._dragOver = e => {
      if (!this.drag && !this._placeDrag) return;   // ghost «Сюда» и для сетей, и для мест
      this._setDropTarget(e.target.closest ? e.target.closest(".place, .it-node") : null);
    };
    // Режим ДЕТАЛЕЙ (свой столбец) → перерисовать открытые детали (кнопки правки).
    Mode.onChange("ipamdetail", () => {
      if (this._lastNet) this._showNet(this._lastNet.n, this._lastNet.place);
    });
    this._enablePanZoom();
    // ПКМ в ПУСТОМ месте дерева «Места и сети» → меню создания (группа/площадка).
    // На узле/сети срабатывает своё меню — тут выходим (закрываем по closest).
    const side = $("#side-ipam");
    if (side) side.addEventListener("contextmenu", e => {
      if (e.target.closest(".it-node, .it-net, .net-chip, .modebtn")) return;
      this._emptyMenu(e);
    });
  }

  // Зум/пан полотна «Сети», как на Инфраструктуре. Колесо — масштаб к курсору;
  // перетаскивание ФОНА (не сети) — панорама (scrollLeft/scrollTop). Перенос
  // сетей стартует на самих .net-block/.net-chip → там пан НЕ начинаем.
  _enablePanZoom() {
    const scroll = $("#ipam-scroll");
    if (!scroll) return;
    let panning = false, sx = 0, sy = 0, sl = 0, st = 0;
    scroll.addEventListener("mousedown", ev => {
      if (ev.button !== 0) return;
      // Пан не начинаем на РУЧКАХ переноса сетей (обычный net-block, чип, угол
      // контура). Тело контура и вложенные локации — можно панорамировать.
      if (ev.target.closest(".net-block:not(.net-contour), .net-chip, .nc-corner")) return;
      panning = true; sx = ev.clientX; sy = ev.clientY;
      sl = scroll.scrollLeft; st = scroll.scrollTop;
      scroll.classList.add("panning");
    });
    window.addEventListener("mousemove", ev => {
      if (!panning) return;
      scroll.scrollLeft = sl - (ev.clientX - sx);
      scroll.scrollTop = st - (ev.clientY - sy);
    });
    window.addEventListener("mouseup", () => {
      if (panning) { panning = false; scroll.classList.remove("panning"); }
    });
    scroll.addEventListener("wheel", ev => {
      ev.preventDefault();
      const prev = this.zoom;
      this.zoom = Math.min(2.5, Math.max(0.3, this.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const rect = scroll.getBoundingClientRect();
      const cx = scroll.scrollLeft + (ev.clientX - rect.left);
      const cy = scroll.scrollTop + (ev.clientY - rect.top);
      const k = this.zoom / prev;
      this._applyZoom();
      scroll.scrollLeft = cx * k - (ev.clientX - rect.left);
      scroll.scrollTop = cy * k - (ev.clientY - rect.top);
    }, { passive: false });
    this._applyZoom();
  }
  _applyZoom() {
    const c = $("#ipam-clouds");
    if (c) c.style.transform = "scale(" + this.zoom + ")";
  }

  // Подсветка цели дропа при переносе сети (одна активная за раз):
  //  · место (.place на холсте) — рамка .drop-ok + серый призрак «Сюда» в теле;
  //  · узел дерева (.it-node) — акцентная полоска .drop-hl.
  // Как на «Инфраструктуре»: видно, куда ляжет объект при отпускании.
  _setDropTarget(el) {
    if (this._dropEl === el) return;
    document.querySelectorAll(".place.drop-ok, .it-node.drop-hl")
      .forEach(x => x.classList.remove("drop-ok", "drop-hl"));
    if (this._ghost) { this._ghost.remove(); this._ghost = null; }
    this._dropEl = el || null;
    if (!el) return;
    if (el.classList.contains("it-node")) {
      el.classList.add("drop-hl");
    } else {
      el.classList.add("drop-ok");
      const body = el.querySelector(":scope > .place-body");
      if (body) { this._ghost = mk("div", { className: "net-ghost", text: "Сюда" }); body.appendChild(this._ghost); }
    }
  }

  // Режимы правки — СВОИ у каждого столбца (как на Инфраструктуре): полотно
  // (ipam), дерево «Места и сети» (ipamtree), детали сети (ipamdetail).
  _editCanvas() { return Mode.on("ipam"); }
  _editTree() { return Mode.on("ipamtree"); }
  _editDetail() { return Mode.on("ipamdetail"); }

  async load() {
    setStatus("загружаю адресное пространство…");
    try {
      const [regions, groups, sites, locations, prefixes, ips] = await Promise.all([
        apiAll("/dcim/regions/"), apiAll("/dcim/site-groups/"), apiAll("/dcim/sites/"),
        apiAll("/dcim/locations/"), apiAll("/ipam/prefixes/"), apiAll("/ipam/ip-addresses/"),
      ]);
      Object.assign(state, { ipamRegions: regions, ipamGroups: groups, ipamSites: sites,
        ipamLocations: locations, ipamPrefixes: prefixes, ipamIps: ips });
      this._build();
      this.renderTree();
      this.render();
      if (this._lastNet) this._refreshDetail();   // данные сети могли измениться
      setStatus(`${prefixes.length} сетей · ${locations.length} локаций · ${sites.length} площадок`, "ok");
    } catch (e) {
      setStatus("ошибка IPAM: " + e.message, "err");
    }
  }

  // Построить дерево МЕСТ и разложить сети по scope.
  _build() {
    // индексы занятых IP по префиксу считаем позже; сперва — узлы-места
    const mkPlace = (kind, obj) => ({ kind, obj, id: kind + obj.id, name: obj.name, children: [], nets: [] });
    // Регион — НЕ уровень иерархии (папки = вложенные site-группы, у групп есть
    // parent). Сети, привязанные к региону, окажутся «вне мест».
    const groups = state.ipamGroups.map(g => mkPlace("sitegroup", g));
    const sites = state.ipamSites.map(s => mkPlace("site", s));
    const locations = state.ipamLocations.map(l => mkPlace("location", l));

    const byKey = new Map();
    [...groups, ...sites, ...locations].forEach(n => byKey.set(n.kind + ":" + n.obj.id, n));

    const roots = [];
    // site-группы: вложенность по parent (папка в папке), корневые → в roots
    for (const g of groups) {
      const pid = g.obj.parent && g.obj.parent.id;
      const parent = pid && byKey.get("sitegroup:" + pid);
      if (parent) parent.children.push(g); else roots.push(g);
    }
    // площадки: в свою группу, иначе в корень
    for (const s of sites) {
      const gp = s.obj.group && byKey.get("sitegroup:" + s.obj.group.id);
      (gp || { children: roots }).children.push(s);
    }
    // серверные: в свою площадку, иначе в корень
    for (const l of locations) {
      const sp = l.obj.site && byKey.get("site:" + l.obj.site.id);
      (sp || { children: roots }).children.push(l);
    }

    // сети по scope → в место
    const netList = state.ipamPrefixes.map(p => ({ p, cidr: parseCidr(p.prefix) }));
    for (const { p, cidr } of netList) {
      if (!p.scope_type || !p.scope_id) continue;
      const key = SCOPE_KEY[p.scope_type];
      if (!key) continue;
      const place = byKey.get(key + ":" + p.scope_id);
      if (place) place.nets.push({ p, cidr, ...this._netUsage(p, cidr) });
    }
    // сети без привязки — «вне мест»
    this.freeNets = netList
      .filter(({ p }) => !p.scope_type || !p.scope_id || !SCOPE_KEY[p.scope_type]
        || !byKey.get(SCOPE_KEY[p.scope_type] + ":" + p.scope_id))
      .map(({ p, cidr }) => ({ p, cidr, ...this._netUsage(p, cidr) }));

    // сортировки. Как на «Инфраструктуре»: внутри узла сперва идут площадки/
    // серверные, а ПОДГРУППЫ (папки) — ВНИЗУ. Иначе папка в середине путает —
    // кажется, что следующие элементы родителя лежат внутри неё.
    const kindRank = { location: 0, site: 1, sitegroup: 2 };
    const byKindThenName = (a, b) =>
      (kindRank[a.kind] - kindRank[b.kind]) || a.name.localeCompare(b.name);
    const sortPlace = n => { n.children.sort(byKindThenName);
      n.nets.sort((a, b) => a.cidr.base - b.cidr.base); n.children.forEach(sortPlace); };
    roots.sort(byKindThenName);
    roots.forEach(sortPlace);
    this.roots = roots;
  }

  // Занятые IP сети + число свободных (по прямой принадлежности CIDR).
  _netUsage(p, cidr) {
    const occupied = state.ipamIps
      .map(ip => ({ ip, c: parseCidr(ip.address) }))
      .filter(x => x.c.v4 && inNet(cidr, x.c.base));
    const used = occupied.length;
    // размер за вычетом сети/бродкаста для /<31
    const usable = cidr.bits <= 30 ? Math.max(0, cidr.size - 2) : cidr.size;
    return { occupied: occupied.map(x => x.ip), used, freeCount: Math.max(0, usable - used) };
  }

  // дерево слева: места + сети внутри
  renderTree() {
    const host = $("#ipam-tree-side");
    if (!host) return;
    host.innerHTML = "";
    const list = mk("div", { className: "it-list" });
    for (const r of this.roots) list.appendChild(this._treeNode(r, 0));
    host.appendChild(list);
    if (this.freeNets.length) {
      host.appendChild(mk("div", { className: "it-sub", text: "Сети вне мест" }));
      const free = mk("div", { className: "it-free" });
      for (const n of this.freeNets) free.appendChild(this._netChip(n, null, true));
      host.appendChild(free);
    }
  }

  _treeNode(node, depth) {
    // Иконки — те же, что в дереве «Инфраструктуры» (tree.js): 📁 группа мест,
    // 🗺 площадка, 📍 серверная. Цвета задаёт CSS (.it-node.k-* .mdi).
    const icon = { region: "map-marker-radius", sitegroup: "folder-outline", site: "map-outline", location: "map-marker" }[node.kind] || "";
    // Папки (группы мест) — сворачиваемы, как на «Инфраструктуре»: отдельная
    // кнопка-стрелка (клик по ней сворачивает, не трогая фокус).
    const isFolder = node.kind === "sitegroup";
    const collapsed = isFolder && this.collapsed.has(node.id);
    const chevron = isFolder
      ? `<button class="it-chevron" tabindex="-1" title="Свернуть / развернуть"><i class="mdi mdi-chevron-${collapsed ? "right" : "down"}"></i></button>`
      : "";
    // Узел-место: клик — фокус; при переносе сети — drop-таргет (подсветка
    // .drop-hl, отпустил ЛКМ на узле → сеть привязывается к этому месту).
    const row = mk("div", { className: "it-node k-" + node.kind + (collapsed ? " collapsed" : ""),
      style: { paddingLeft: (8 + depth * 14) + "px" },
      html: `${chevron}<i class="mdi mdi-${icon}"></i><span class="it-name">${node.name}</span>`,
      on: {
        click: () => { if (!this.dragged) this._focusPlace(node); },
        contextmenu: e => this._menu(e, node),
      } });
    if (isFolder) {
      const chev = row.querySelector(".it-chevron");
      if (chev) chev.addEventListener("click", e => { e.stopPropagation(); this._toggleCollapse(node.id); });
    }
    row._placeNode = node;   // цель дропа сети (подсветка/дроп — _setDropTarget/onUp)
    const wrap = mk("div", {}, row);
    if (collapsed) return wrap;   // свёрнута — сети и вложенные места не рисуем
    for (const n of node.nets) {
      // Сеть в дереве: клик — детали; в правке перетаскивается на узлы-места
      // (та же механика, что помещения на «Инфраструктуре»).
      const netEl = mk("div", { className: "it-net", style: { paddingLeft: (8 + (depth + 1) * 14) + "px" },
        text: n.p.prefix, on: {
          click: () => { if (!this.dragged) this._showNet(n, node); },
          contextmenu: e => this._netMenu(e, n, node),   // п.3: изменить/убрать/удалить
        } });
      this._makeNetDraggable(netEl, n, node, true);   // сеть в дереве
      wrap.appendChild(netEl);
    }
    // Если у места ЕСТЬ сети — вложенные места сдвигаем на уровень ГЛУБЖE сетей,
    // чтобы они визуально были «под сетью» (как локации внутри сети площадки на
    // холсте). Без сетей — обычный отступ.
    const childDepth = node.nets.length ? depth + 2 : depth + 1;
    for (const ch of node.children) wrap.appendChild(this._treeNode(ch, childDepth));
    return wrap;
  }
  // Свернуть/развернуть папку-группу в дереве и перерисовать дерево.
  _toggleCollapse(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.renderTree();
  }

  // холст: блоки-места, внутри сети, внутри адреса
  render() {
    const host = $("#ipam-clouds");
    if (!host) return;
    host.innerHTML = "";
    if (!this.roots.length) {
      host.appendChild(mk("div", { className: "placeholder", text: "Нет мест — создай площадки/локации на Инфраструктуре" }));
      return;
    }
    for (const r of this.roots) host.appendChild(this._place(r));
    // сети вне мест — отдельная зона (перетащить в место)
    if (this.freeNets.length) {
      const zone = mk("div", { className: "free-zone", html: `<div class="fz-head">Сети вне мест</div>` });
      const body = mk("div", { className: "fz-body" });
      for (const n of this.freeNets) body.appendChild(this._netChip(n, null, false));
      zone.appendChild(body);
      host.appendChild(zone);
    }
  }

  // Блок-место (пунктир). Внутри — вложенные места + сети.
  _place(node) {
    // Пустое место (нет сетей и вложенных) — площадка/серверная/группа → название
    // по центру контура (CSS .empty-place).
    const empty = !node.nets.length && !node.children.length;
    const el = mk("div", { className: "place k-" + node.kind + (empty ? " empty-place" : ""), dataset: { place: node.id } });
    const kindRu = { sitegroup: "группа", site: "площадка", location: "локация" }[node.kind] || "";
    const cap = mk("div", { className: "place-cap" },
      mk("span", { className: "pc-kind", text: kindRu }),
      mk("span", { className: "pc-name", text: node.name }));
    el.appendChild(cap);
    this._makePlaceDraggable(cap, node);   // перенос места «за название» → смена родителя
    const body = mk("div", { className: "place-body" });
    // item 7: у ПЛОЩАДКИ есть сеть site-уровня И локации → первая site-сеть
    // становится КОНТУРОМ (CIDR кликабельный в углу), локации рисуются ВНУТРИ
    // неё (адресное пространство площадки содержит её серверные). Прочие сети
    // площадки — обычными блоками. Иначе — как раньше (место ⊃ вложенные + сети).
    if (node.kind === "site" && node.nets.length && node.children.length) {
      const [host, ...rest] = node.nets;
      body.appendChild(this._netContour(host, node, node.children));
      for (const n of rest) body.appendChild(this._netBlock(n, node));
    } else {
      for (const ch of node.children) body.appendChild(this._place(ch));
      for (const n of node.nets) body.appendChild(this._netBlock(n, node));
    }
    // Кнопок «+ сеть» на холсте нет: правка = перетаскивание сетей, создание —
    // по ПКМ в дереве «Места и сети» (см. _menu).
    el.appendChild(body);
    // drop-таргет: сеть привязывается к этому месту
    this._makeDrop(el, node);
    return el;
  }

  // Сеть site-уровня как КОНТУР с локациями внутри (item 7): CIDR + счётчик в
  // углу (клик → детали), локации — вложенными place-блоками. Перенос сети — за
  // угол (как обычный net-block). Само тело контура — не ручка (чтобы можно было
  // взаимодействовать с локациями и панорамировать).
  _netContour(n, place, locNodes) {
    const el = mk("div", { className: "net-block net-contour", dataset: { net: n.p.id } });
    const corner = mk("div", { className: "nc-corner",
      html: `<span class="nc-cidr">${n.p.prefix}</span><span class="nc-cnt">${this._countHtml(n)}</span>` });
    corner.addEventListener("click", e => {
      e.stopPropagation();
      if (!this.dragged && !this._editCanvas()) this._showNet(n, place);
    });
    this._makeNetDraggable(corner, n, place, false);   // перенос сети — за угол (полотно)
    corner.addEventListener("contextmenu", e => this._netMenu(e, n, place));   // п.3
    el.appendChild(corner);
    const inner = mk("div", { className: "nc-body" });
    for (const loc of locNodes) inner.appendChild(this._place(loc));
    el.appendChild(inner);
    return el;
  }

  // Счётчик сети: занято — красным, свободно — зелёным (без списка адресов).
  _countHtml(n) {
    return `<span class="nb-used">${n.used} занято</span> · <span class="nb-free">${n.freeCount} свободно</span>`;
  }
  // Блок сети (пунктир синий) внутри места. CIDR-бейдж + счётчик (без списка адресов).
  _netBlock(n, place) {
    const el = mk("div", { className: "net-block", dataset: { net: n.p.id } });
    el.appendChild(mk("div", { className: "nb-cap",
      html: `<span class="nb-cidr">${n.p.prefix}</span><span class="nb-count">${this._countHtml(n)}</span>` }));
    // В правке весь блок — ручка переноса (зажал ЛКМ и потянул).
    this._makeNetDraggable(el, n, place, false);
    // В правке блок сети НЕ кликабелен (клик мешал переносу); детали — из
    // дерева или в режиме просмотра. После переноса click подавляется.
    el.addEventListener("click", e => {
      e.stopPropagation();
      if (this.dragged || this._editCanvas()) return;
      this._showNet(n, place);
    });
    el.addEventListener("contextmenu", e => this._netMenu(e, n, place));   // п.3
    return el;
  }

  // Компактный чип сети (в дереве / зоне «вне мест»).
  _netChip(n, place, inTree) {
    const chip = mk("div", { className: "net-chip" + (inTree ? " in-tree" : ""), dataset: { net: n.p.id },
      html: `<i class="mdi mdi-ip-network"></i><span>${n.p.prefix}</span>` });
    chip.addEventListener("contextmenu", e => this._netMenu(e, n, place));   // п.3
    this._makeNetDraggable(chip, n, place, inTree);
    return chip;
  }

  // drag: сеть → место (PATCH prefix.scope). Перенос стартует по СМЕЩЕНИЮ
  // мыши >6px (как в дереве Инфраструктуры) — простой клик остаётся кликом,
  // а не «переносом в то же место». mousemove/mouseup всегда снимаются на
  // отпускании, состояние чистится целиком — нода не «прилипает» к курсору.
  _makeNetDraggable(handle, n, fromPlace, inTree) {
    handle.addEventListener("mousedown", e => {
      // Сеть в дереве тащим в режиме ДЕРЕВА, на полотне — в режиме ПОЛОТНА.
      if (e.button !== 0 || !(inTree ? this._editTree() : this._editCanvas())) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let started = false;
      const onMove = ev => {
        if (started || Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) <= 6) return;
        started = true;
        this.drag = { n, fromPlace, handle };
        this.dragged = true;   // подавить click, который придёт после mouseup
        handle.classList.add("dragging");
        document.body.classList.add("ipam-dragging");
        document.addEventListener("mouseover", this._dragOver);
      };
      const onUp = ev => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Дроп определяем ЗДЕСЬ по элементу под курсором (место/узел дерева) —
        // единый обработчик, поэтому mouseup всегда доходит (никаких
        // stopPropagation на местах, из-за которых нода «залипала»).
        if (started && this.drag) {
          const tgt = ev.target.closest && ev.target.closest(".place, .it-node");
          const node = tgt && tgt._placeNode;
          if (node) this._assignNet(this.drag.n, node);   // async — не ждём, cleanup ниже
        }
        // cleanup в setTimeout: click по этому же элементу диспатчится синхронно
        // до таймера → this.dragged ещё true и подавит его.
        setTimeout(() => {
          handle.classList.remove("dragging");
          document.body.classList.remove("ipam-dragging");
          this._setDropTarget(null);
          document.removeEventListener("mouseover", this._dragOver);
          this.drag = null;
          this.dragged = false;
        }, 0);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // Место — потенциальная цель дропа. Подсветку/призрак и сам дроп ведёт единый
  // маршрут (_setDropTarget / onUp) по элементу под курсором; здесь лишь
  // привязываем узел к DOM-элементу.
  _makeDrop(placeEl, node) {
    placeEl._placeNode = node;
  }

  // Перенос МЕСТА за его название (в правке): серверная → на площадку,
  // площадка → в группу (или в пусто = без группы), группа → в группу (или в
  // пусто = корень). Механика как у переноса сетей: старт по смещению >6px,
  // дроп по .place под курсором. Меняет РОДИТЕЛЯ в БД (PATCH), не координаты.
  _makePlaceDraggable(cap, node) {
    if (!["location", "site", "sitegroup"].includes(node.kind)) return;
    cap.addEventListener("mousedown", e => {
      if (e.button !== 0 || !this._editCanvas()) return;   // перенос места — режим полотна
      e.preventDefault(); e.stopPropagation();   // не даём начать пан полотна
      const sx = e.clientX, sy = e.clientY;
      let started = false;
      const onMove = ev => {
        if (started || Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) <= 6) return;
        started = true; this.dragged = true; this._placeDrag = node;
        cap.classList.add("dragging");
        document.body.classList.add("ipam-dragging");
        document.addEventListener("mouseover", this._dragOver);   // подсветка «Сюда»
      };
      const onUp = ev => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (started && this._placeDrag) {
          const tgt = ev.target.closest && ev.target.closest(".place, .it-node");
          const targetNode = tgt && tgt._placeNode;
          this._movePlace(this._placeDrag, (targetNode && targetNode !== node) ? targetNode : null);
        }
        setTimeout(() => {
          cap.classList.remove("dragging");
          document.body.classList.remove("ipam-dragging");
          this._setDropTarget(null);
          document.removeEventListener("mouseover", this._dragOver);
          this._placeDrag = null; this.dragged = false;
        }, 0);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
  // Сменить родителя места (PATCH). target=null → «в корень / без группы».
  async _movePlace(node, target) {
    let path, body, where;
    if (node.kind === "location") {
      if (!target || target.kind !== "site") { setStatus("серверную можно перенести только на площадку", "err"); return; }
      path = "/dcim/locations/" + node.obj.id + "/"; body = { site: target.obj.id }; where = target.name;
    } else if (node.kind === "site") {
      if (target && target.kind !== "sitegroup") { setStatus("площадку — на группу мест (или в пусто = без группы)", "err"); return; }
      path = "/dcim/sites/" + node.obj.id + "/"; body = { group: target ? target.obj.id : null };
      where = target ? target.name : "без группы";
    } else if (node.kind === "sitegroup") {
      if (target && target.kind !== "sitegroup") { setStatus("группу — в другую группу (или в пусто = корень)", "err"); return; }
      if (target && this._isDescendantGroup(node, target)) { setStatus("нельзя вложить группу в саму себя/потомка", "err"); return; }
      path = "/dcim/site-groups/" + node.obj.id + "/"; body = { parent: target ? target.obj.id : null };
      where = target ? target.name : "корень";
    } else return;
    try {
      setStatus("переношу «" + node.name + "»…");
      await api(path, "PATCH", body);
      setStatus("«" + node.name + "» → " + where, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }
  // target внутри поддерева node (или сам node)? — запрет цикла для групп.
  _isDescendantGroup(node, target) {
    let found = node === target;
    const walk = n => { if (n === target) found = true; n.children.forEach(walk); };
    node.children.forEach(walk);
    return found;
  }

  // Привязать сеть к месту (PATCH scope по типу места).
  async _assignNet(n, place) {
    const scopeType = { region: "dcim.region", sitegroup: "dcim.sitegroup", site: "dcim.site", location: "dcim.location" }[place.kind];
    try {
      setStatus(`привязываю ${n.p.prefix} к «${place.name}»…`);
      await api(`/ipam/prefixes/${n.p.id}/`, "PATCH", { scope_type: scopeType, scope_id: place.obj.id });
      setStatus(`${n.p.prefix} → «${place.name}»`, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }

  async _unassignNet(n) {
    try {
      await api(`/ipam/prefixes/${n.p.id}/`, "PATCH", { scope_type: null, scope_id: null });
      setStatus(`${n.p.prefix} убрана из места`, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось: " + e.message, "err"); }
  }

  // ПКМ по узлу-месту в дереве — меню в стиле Инфраструктуры (.treectx),
  // работает в любом режиме. Здесь создаём ТОЛЬКО сети (сами места —
  // на холсте «Инфраструктура»).
  // Общий конструктор контекст-меню (.treectx как на Инфраструктуре): items —
  // [{label, fn, danger?}]. Позиционирование в пределах окна + закрытие по клику вне.
  _showCtx(x, y, items) {
    this._closeMenu();
    const menu = mk("div", { className: "treectx" });
    for (const it of items) menu.appendChild(this._ctxRow(it));
    document.body.appendChild(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 8)) + "px";
    this._ctxMenu = menu;
    const close = ev => {
      if (!menu.contains(ev.target)) { this._closeMenu(); document.removeEventListener("mousedown", close, true); }
    };
    setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  }
  // Рекурсивная строка меню {label, fn?, submenu?, danger?} — с вложенным подменю
  // «Добавить ▸ …» (как на Инфраструктуре; CSS .tc-sub из schematic.css).
  _ctxRow(spec) {
    const hasSub = Array.isArray(spec.submenu) && spec.submenu.length;
    const row = mk("div", { className: "tc-item" + (spec.danger ? " danger" : "") + (hasSub ? " has-sub" : ""),
      html: `<span>${spec.label}</span>` + (hasSub ? `<span class="tc-arrow">▸</span>` : "") });
    if (hasSub) {
      const sub = mk("div", { className: "tc-sub" });
      for (const child of spec.submenu) sub.appendChild(this._ctxRow(child));
      row.appendChild(sub);
    } else if (spec.fn) {
      row.addEventListener("click", ev => { ev.stopPropagation(); this._closeMenu(); spec.fn(); });
    }
    return row;
  }
  // ПКМ по МЕСТУ — полный набор как на Инфраструктуре: Добавить ▸ (вложенное/сеть),
  // Переименовать, Удалить.
  _menu(e, node) {
    e.preventDefault();
    const add = [];
    if (node.kind === "sitegroup") {
      add.push({ label: "Подгруппа мест", fn: () => this._createGroup(node) });
      add.push({ label: "Площадка", fn: () => this._createSite(node) });
      add.push({ label: "Сеть", fn: () => this._createNet(node) });
    } else if (node.kind === "site") {
      add.push({ label: "Серверная", fn: () => this._createLocation(node) });
      add.push({ label: "Сеть", fn: () => this._createNet(node) });
    } else if (node.kind === "location") {
      add.push({ label: "Сеть", fn: () => this._createNet(node) });
    }
    const items = [];
    if (add.length) items.push({ label: "Добавить", submenu: add });
    items.push({ label: "Переименовать", fn: () => this._renamePlace(node) });
    items.push({ label: "Удалить", danger: true, fn: () => this._deletePlace(node) });
    this._showCtx(e.clientX, e.clientY, items);
  }
  // ПКМ в ПУСТОМ месте иерархии — создать верхнеуровневое место.
  _emptyMenu(e) {
    e.preventDefault();
    this._showCtx(e.clientX, e.clientY, [
      { label: "Добавить", submenu: [
        { label: "Группа мест", fn: () => this._createGroup(null) },
        { label: "Площадка (без группы)", fn: () => this._createSite(null) },
      ] },
    ]);
  }
  // Создание/переименование/удаление МЕСТ (порт с Инфраструктуры; reload = IPAM).
  _createGroup(parent) {
    this.app.openModal("Новая группа мест", parent ? "Внутри: " + parent.name : "",
      [{ id: "name", label: "Название", placeholder: "Группа ЦОД" }],
      async v => {
        if (!v.name) throw new Error("укажи название");
        await api("/dcim/site-groups/", "POST",
          { name: v.name, slug: slugify(v.name), ...(parent ? { parent: parent.obj.id } : {}) });
        setStatus("группа создана: " + v.name, "ok");
        await this.load();
      });
  }
  _createSite(group) {
    this.app.openModal("Новая площадка", group ? "Группа: " + group.name : "без группы",
      [{ id: "name", label: "Название", placeholder: "ЦОД Пулково" }],
      async v => {
        if (!v.name) throw new Error("укажи название");
        await api("/dcim/sites/", "POST",
          { name: v.name, slug: slugify(v.name), status: "active", ...(group ? { group: group.obj.id } : {}) });
        setStatus("площадка создана: " + v.name, "ok");
        await this.load();
      });
  }
  _createLocation(site) {
    this.app.openModal("Новая серверная", "Площадка: " + site.name,
      [{ id: "name", label: "Название", placeholder: "Серверная 2" }],
      async v => {
        if (!v.name) throw new Error("укажи название");
        await api("/dcim/locations/", "POST",
          { site: site.obj.id, name: v.name, slug: slugify(v.name), status: "active" });
        setStatus("серверная создана: " + v.name, "ok");
        await this.load();
      });
  }
  _renamePlace(node) {
    const path = { sitegroup: "/dcim/site-groups/", site: "/dcim/sites/", location: "/dcim/locations/" }[node.kind];
    if (!path) return;
    this.app.openModal("Переименовать", "Текущее: " + node.name,
      [{ id: "name", label: "Новое название", value: node.name }],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api(path + node.obj.id + "/", "PATCH", { name: v.name, slug: slugify(v.name) });
        setStatus("переименовано: " + v.name, "ok");
        await this.load();
      });
  }
  _deletePlace(node) {
    const path = { sitegroup: "/dcim/site-groups/", site: "/dcim/sites/", location: "/dcim/locations/" }[node.kind];
    const kindRu = { sitegroup: "группу", site: "площадку", location: "серверную" }[node.kind];
    if (!path) return;
    this.app.openModal("Удалить " + kindRu + "?", "«" + node.name + "» и всё вложенное. Действие необратимо.", [],
      async () => {
        await api(path + node.obj.id + "/", "DELETE");
        setStatus("удалено: " + node.name, "ok");
        await this.load();
      }, "Удалить");
  }
  // ПКМ по СЕТИ в дереве (п.3): изменить CIDR / убрать из места / удалить.
  _netMenu(e, n, place) {
    e.preventDefault();
    const items = [{ label: "Изменить сеть", fn: () => this._editNet(n) }];
    if (place) items.push({ label: "Убрать из места", fn: () => this._unassignNet(n) });
    items.push({ label: "Удалить сеть", danger: true, fn: () => this._deleteNet(n) });
    this._showCtx(e.clientX, e.clientY, items);
  }
  _editNet(n) {
    this.app.openModal("Изменить сеть", "Сеть: " + n.p.prefix,
      [{ id: "cidr", label: "Сеть (CIDR)", value: n.p.prefix }],
      async v => {
        if (!v.cidr) throw new Error("укажи CIDR");
        await api("/ipam/prefixes/" + n.p.id + "/", "PATCH", { prefix: v.cidr.trim() });
        setStatus("сеть изменена: " + v.cidr, "ok");
        await this.load();
      }, "Сохранить");
  }
  _deleteNet(n) {
    this.app.openModal("Удалить сеть?", "«" + n.p.prefix + "» будет удалена. Действие необратимо.", [],
      async () => {
        await api("/ipam/prefixes/" + n.p.id + "/", "DELETE");
        setStatus("сеть удалена: " + n.p.prefix, "ok");
        if (this._lastNet && this._lastNet.n.p.id === n.p.id) this._lastNet = null;
        await this.load();
      }, "Удалить");
  }
  _closeMenu() { if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; } }

  // Создать сеть и сразу привязать к месту (scope). Модалка — как на
  // Инфраструктуре (общий app.openModal), а не prompt().
  _createNet(place) {
    const scopeType = { region: "dcim.region", sitegroup: "dcim.sitegroup", site: "dcim.site", location: "dcim.location" }[place.kind];
    this.app.openModal("Новая сеть", "Место: " + place.name,
      [{ id: "cidr", label: "Сеть (CIDR)", placeholder: "10.10.0.0/24" }],
      async v => {
        if (!v.cidr) throw new Error("укажи CIDR");
        await api("/ipam/prefixes/", "POST",
          { prefix: v.cidr.trim(), status: "active", scope_type: scopeType, scope_id: place.obj.id });
        setStatus(`сеть ${v.cidr} создана в «${place.name}»`, "ok");
        await this.load();
      });
  }

  // Перерисовать открытые детали СВЕЖИМ объектом сети (после load() старые
  // ссылки мертвы — ищем по id префикса в новых roots/freeNets).
  _refreshDetail() {
    const id = this._lastNet.n.p.id;
    let found = null, foundPlace = null;
    const walk = node => {
      for (const nn of node.nets) if (nn.p.id === id) { found = nn; foundPlace = node; }
      node.children.forEach(walk);
    };
    this.roots.forEach(walk);
    if (!found) { found = this.freeNets.find(x => x.p.id === id) || null; foundPlace = null; }
    if (found) this._showNet(found, foundPlace);
  }

  _focusPlace(node) {
    // Заголовок холста показывает, какая область выбрана (Region/Site/группа/
    // Location) — как «Стойки : …» / «Схема соединений : …» на Инфраструктуре.
    this._setScopeTitle(node.name);
    const el = $(`.place[data-place="${node.id}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); }
  }

  _setScopeTitle(name) {
    const lbl = $("#ipam-main .pt-label");
    if (lbl) lbl.textContent = "Схема адресного пространства" + (name ? " : " + name : "");
  }

  // детали сети справа
  async _showNet(n, place) {
    this._lastNet = { n, place };
    const panel = $("#ipam-detail");
    if (!panel) return;
    const p = n.p;
    // Кнопка режима блока ДЕТАЛЕЙ (свой столбец) — .modebtn[data-mode=ipamdetail].
    panel.innerHTML = `${modeBtn("ipamdetail", "compact ms-corner")}<h2>${p.prefix}</h2>
      <div class="sub">Сеть${p.status ? " · " + (p.status.label || p.status.value) : ""}${place ? " · " + place.name : ""}</div>
      <div class="id-row"><span>Размер</span><b>${n.cidr.size.toLocaleString("ru")} адр.</b></div>
      <div class="id-row"><span>Занято</span><b>${n.used}</b></div>
      <div class="id-row"><span>Свободно</span><b>${n.freeCount.toLocaleString("ru")}</b></div>`;
    Mode.syncButtons("ipamdetail");
    if (place && this._editDetail())
      panel.appendChild(mk("button", { className: "id-btn danger", html: `<i class="mdi mdi-close"></i> убрать из «${place.name}»`,
        on: { click: () => this._unassignNet(n) } }));
    if (n.occupied.length) {
      panel.insertAdjacentHTML("beforeend", `<h4>Занятые адреса (${n.occupied.length})</h4>`);
      const box = mk("div", { className: "id-free" });
      for (const ip of n.occupied)
        box.appendChild(mk("span", { className: "id-ip", text: ip.address.split("/")[0], title: ip.address }));
      panel.appendChild(box);
    }
  }
}
