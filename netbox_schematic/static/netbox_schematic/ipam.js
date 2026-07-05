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

import { $, state, mk } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";

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
  }

  edit() { return document.body.classList.contains("ipam-edit"); }

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
      setStatus(`${prefixes.length} сетей · ${locations.length} локаций · ${sites.length} площадок`, "ok");
    } catch (e) {
      setStatus("ошибка IPAM: " + e.message, "err");
    }
  }

  // Построить дерево МЕСТ и разложить сети по scope.
  _build() {
    // индексы занятых IP по префиксу считаем позже; сперва — узлы-места
    const mkPlace = (kind, obj) => ({ kind, obj, id: kind + obj.id, name: obj.name, children: [], nets: [] });
    const regions = state.ipamRegions.map(r => mkPlace("region", r));
    const groups = state.ipamGroups.map(g => mkPlace("sitegroup", g));
    const sites = state.ipamSites.map(s => mkPlace("site", s));
    const locations = state.ipamLocations.map(l => mkPlace("location", l));

    const byKey = new Map();
    [...regions, ...groups, ...sites, ...locations].forEach(n => byKey.set(n.kind + ":" + n.obj.id, n));

    const roots = [];
    // регионы: вложенность region.parent
    for (const r of regions) {
      const pid = r.obj.parent && r.obj.parent.id;
      const parent = pid && byKey.get("region:" + pid);
      if (parent) parent.children.push(r); else roots.push(r);
    }
    // site-groups — верхнеуровневые (их иерархию не усложняем)
    for (const g of groups) roots.push(g);
    // сайты: в регион, иначе в группу, иначе корень
    for (const s of sites) {
      const rp = s.obj.region && byKey.get("region:" + s.obj.region.id);
      const gp = s.obj.group && byKey.get("sitegroup:" + s.obj.group.id);
      (rp || gp || { children: roots }).children.push(s);
    }
    // локации: в сайт (parent-локации не усложняем — плоско в сайт)
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

    // сортировки
    const sortPlace = n => { n.children.sort((a, b) => a.name.localeCompare(b.name));
      n.nets.sort((a, b) => a.cidr.base - b.cidr.base); n.children.forEach(sortPlace); };
    roots.sort((a, b) => a.name.localeCompare(b.name));
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
    const icon = { region: "map-marker-radius", sitegroup: "folder-network", site: "office-building", location: "server" }[node.kind] || "";
    const row = mk("div", { className: "it-node k-" + node.kind, style: { paddingLeft: (8 + depth * 14) + "px" },
      html: `<i class="mdi mdi-${icon}"></i><span class="it-name">${node.name}</span>`,
      on: { click: () => this._focusPlace(node), contextmenu: e => this._menu(e, node) } });
    const wrap = mk("div", {}, row);
    for (const n of node.nets)
      wrap.appendChild(mk("div", { className: "it-net", style: { paddingLeft: (8 + (depth + 1) * 14) + "px" },
        text: n.p.prefix, on: { click: () => this._showNet(n, node) } }));
    for (const ch of node.children) wrap.appendChild(this._treeNode(ch, depth + 1));
    return wrap;
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
    const el = mk("div", { className: "place k-" + node.kind, dataset: { place: node.id } });
    const kindRu = { region: "регион", sitegroup: "группа", site: "площадка", location: "локация" }[node.kind];
    el.appendChild(mk("div", { className: "place-cap" },
      mk("span", { className: "pc-kind", text: kindRu }),
      mk("span", { className: "pc-name", text: node.name })));
    const body = mk("div", { className: "place-body" });
    for (const ch of node.children) body.appendChild(this._place(ch));
    for (const n of node.nets) body.appendChild(this._netBlock(n, node));
    if (this.edit()) {
      const addBtn = mk("button", { className: "place-add", html: `<i class="mdi mdi-plus"></i> сеть`,
        on: { click: e => { e.stopPropagation(); this._createNet(node); } } });
      body.appendChild(addBtn);
    }
    el.appendChild(body);
    // drop-таргет: сеть привязывается к этому месту
    this._makeDrop(el, node);
    return el;
  }

  // Блок сети (пунктир синий) внутри места. Внутри — занятые адреса + счётчик.
  _netBlock(n, place) {
    const el = mk("div", { className: "net-block", dataset: { net: n.p.id } });
    const cap = mk("div", { className: "nb-cap" },
      mk("span", { className: "nb-cidr", text: n.p.prefix }),
      mk("span", { className: "nb-count", text: `${n.used} занято · ${n.freeCount} свободно` }));
    this._makeNetDraggable(cap, n, place);
    el.appendChild(cap);
    const addrs = mk("div", { className: "nb-addrs" });
    for (const ip of n.occupied.slice(0, 24))
      addrs.appendChild(mk("span", { className: "addr used", text: ip.address.split("/")[0], title: ip.address }));
    if (n.occupied.length > 24)
      addrs.appendChild(mk("span", { className: "addr more", text: `+${n.occupied.length - 24}` }));
    if (n.freeCount) addrs.appendChild(mk("span", { className: "addr free-note", text: `${n.freeCount} свободно` }));
    el.appendChild(addrs);
    el.addEventListener("click", e => { e.stopPropagation(); this._showNet(n, place); });
    return el;
  }

  // Компактный чип сети (в дереве / зоне «вне мест»).
  _netChip(n, place, inTree) {
    const chip = mk("div", { className: "net-chip" + (inTree ? " in-tree" : ""), dataset: { net: n.p.id },
      html: `<i class="mdi mdi-ip-network"></i><span>${n.p.prefix}</span>` });
    this._makeNetDraggable(chip, n, place);
    return chip;
  }

  // drag: сеть → место (PATCH prefix.scope)
  _makeNetDraggable(handle, n, fromPlace) {
    handle.addEventListener("mousedown", e => {
      if (e.button !== 0 || !this.edit()) return;
      e.preventDefault();
      this.drag = { n, fromPlace, handle };
      handle.classList.add("dragging");
      document.body.classList.add("ipam-dragging");
      const onUp = () => {
        setTimeout(() => {
          handle.classList.remove("dragging");
          document.body.classList.remove("ipam-dragging");
          document.querySelectorAll(".place.drop-ok").forEach(c => c.classList.remove("drop-ok"));
          this.drag = null;
        }, 0);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mouseup", onUp);
    });
  }

  _makeDrop(placeEl, node) {
    placeEl.addEventListener("mouseenter", () => { if (this.drag) placeEl.classList.add("drop-ok"); });
    placeEl.addEventListener("mouseleave", () => placeEl.classList.remove("drop-ok"));
    placeEl.addEventListener("mouseup", async e => {
      if (!this.drag) return;
      e.stopPropagation();
      await this._assignNet(this.drag.n, node);
    });
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

  // контекст-меню места: создать сеть
  _menu(e, node) {
    e.preventDefault();
    if (!this.edit()) return;
    document.querySelectorAll(".ipam-menu").forEach(m => m.remove());
    const menu = mk("div", { className: "ipam-menu", style: { left: e.clientX + "px", top: e.clientY + "px" } });
    menu.appendChild(mk("button", { text: "Добавить сеть сюда", on: { click: () => { menu.remove(); this._createNet(node); } } }));
    document.body.appendChild(menu);
    const close = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("mousedown", close, true); } };
    setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  }

  // Создать сеть и сразу привязать к месту (scope).
  async _createNet(place) {
    const cidr = prompt(`Новая сеть в «${place.name}» (CIDR):`, "");
    if (!cidr) return;
    const scopeType = { region: "dcim.region", sitegroup: "dcim.sitegroup", site: "dcim.site", location: "dcim.location" }[place.kind];
    try {
      await api("/ipam/prefixes/", "POST",
        { prefix: cidr.trim(), status: "active", scope_type: scopeType, scope_id: place.obj.id });
      setStatus(`сеть ${cidr} создана в «${place.name}»`, "ok");
      await this.load();
    } catch (e) { setStatus("не удалось создать: " + e.message, "err"); }
  }

  _focusPlace(node) {
    const el = $(`.place[data-place="${node.id}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); }
  }

  // детали сети справа
  async _showNet(n, place) {
    const panel = $("#ipam-detail");
    if (!panel) return;
    const p = n.p;
    panel.innerHTML = `<h2>${p.prefix}</h2>
      <div class="sub">Сеть${p.status ? " · " + (p.status.label || p.status.value) : ""}${place ? " · " + place.name : ""}</div>
      <div class="id-row"><span>Размер</span><b>${n.cidr.size.toLocaleString("ru")} адр.</b></div>
      <div class="id-row"><span>Занято</span><b>${n.used}</b></div>
      <div class="id-row"><span>Свободно</span><b>${n.freeCount.toLocaleString("ru")}</b></div>`;
    if (place && this.edit())
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
