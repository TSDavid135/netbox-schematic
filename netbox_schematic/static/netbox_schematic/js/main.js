"use strict";
// Точка входа: связывает менеджеры через общий app-контекст
// app = { tree, rack, schema, device, openModal, renderAll, connect }.
// Менеджеры зовут друг друга через app (напр. tree.selectScope → app.renderAll
// → rack.render + schema.render). Общее состояние — в core.state.

import { $, state, PORT_KINDS } from "./core.js";
import { apiAll, setStatus, loadCableTypes } from "./api.js";
import { Mode } from "./modes.js";
import { TreeManager } from "./tree.js";
import { RackManager } from "./racks.js";
import { SchemaManager } from "./schema.js";
import { DeviceManager } from "./device.js";
import { LayerManager } from "./layers.js";
import { IpForm } from "./ipform.js";
import { SearchManager } from "./search.js";
import { RoleFilter } from "./filter.js";
import { initTheme } from "./theme.js";

const app = {};
app.device = new DeviceManager(app);
app.schema = new SchemaManager(app);
app.layers = new LayerManager(app);
app.ipform = new IpForm(app);
app.rack = new RackManager(app);
app.tree = new TreeManager(app);
app.search = new SearchManager(app);
app.filter = new RoleFilter(app);
// Прокси-методы, которые менеджеры зовут через app
app.openModal = (...a) => app.device.openModal(...a);
app.connect = () => connect();
app.renderAll = group => renderAll(group);

// Кнопка «Обновить» в шапке — ручной полный reconnect (справочники + дерево +
// текущая группа). Авто-опроса изменений НЕ делаем: у NetBox нет ни WS, ни
// push-уведомлений на клиент, а поллинг решили не тянуть (см. UPDATES.md).
{
  const sync = $("#syncbtn");
  if (sync) sync.addEventListener("click", async () => {
    setStatus("обновляю данные из NetBox…");
    await app.tree.reload();
    setStatus("данные обновлены", "ok");
  });
}

// Экспорт / Импорт — пока заглушки (семантику уточним). Кнопки на месте, слева
// от поиска; действие сообщает, что функция в разработке.
for (const id of ["exportbtn", "importbtn"]) {
  const b = $("#" + id);
  if (b) b.addEventListener("click", () =>
    setStatus((id === "exportbtn" ? "Экспорт" : "Импорт") + " — в разработке"));
}

// Меню пользователя в шапке (клик по имени → выпадашка; клик вне — закрыть).
{
  const box = $("#userbox"), btn = $("#userbtn");
  if (box && btn) {
    btn.addEventListener("click", e => { e.stopPropagation(); box.classList.toggle("open"); });
    document.addEventListener("click", e => { if (!box.contains(e.target)) box.classList.remove("open"); });
  }
}

app.device.wireModal();
initTheme();

// Подключение: грузим справочники, строим дерево
async function connect() {
  state.base = "";
  setStatus("подключаюсь…");
  try {
    const [regions, siteGroups, sites, locations, racks, roles, dtypes, prefixes, , panels, feeds, wlinks, circuits, cterms, cprov, ctypes, allDevices] = await Promise.all([
      apiAll("/dcim/regions/"), apiAll("/dcim/site-groups/"),
      apiAll("/dcim/sites/"), apiAll("/dcim/locations/"), apiAll("/dcim/racks/"),
      apiAll("/dcim/device-roles/"), apiAll("/dcim/device-types/"), apiAll("/ipam/prefixes/"),
      loadCableTypes(),   // список типов кабеля из OPTIONS → state.cableTypes (пишет сам, результат пропускаем)
      apiAll("/dcim/power-panels/"), apiAll("/dcim/power-feeds/"),
      apiAll("/wireless/wireless-links/"),   // слой «Wireless» (радио-линки между интерфейсами)
      apiAll("/circuits/circuits/"), apiAll("/circuits/circuit-terminations/"),  // слой «Circuits»
      apiAll("/circuits/providers/"), apiAll("/circuits/circuit-types/"),  // для назначения circuit
      apiAll("/dcim/devices/"),   // ВСЕ устройства — для показа в дереве под локациями
    ]);
    state.regions = regions;
    state.siteGroups = siteGroups;
    state.sites = sites;
    state.locations = locations;
    state.prefixes = prefixes;
    state.roles = {}; roles.forEach(r => state.roles[r.id] = r);
    state.dtypes = {}; dtypes.forEach(t => state.dtypes[t.id] = t);
    state.racks = racks;
    state.allDevices = allDevices;   // для дерева (устройства под локациями)
    state.powerPanels = panels;
    state.powerFeeds = feeds;
    state.wirelessLinks = wlinks;
    state.circuits = circuits;
    state.circuitTerms = cterms;
    state.circuitProviders = cprov;
    state.circuitTypes = ctypes;
    app.tree.build();
    setStatus(`подключено: ${racks.length} стоек, ${prefixes.length} сетей`, "ok");
  } catch (e) {
    setStatus("ошибка: " + e.message + " — проверь, что ты залогинен в NetBox", "err");
  }
}

// Полная перерисовка стоек + схемы для выбранной группы
async function renderAll(group) {
  state.group = group;
  state.devices = [];
  state.devRack = {};
  state.devCol = {};
  state.devNodeIdx = {};
  state.ports = {};
  state.nodeEls = {};
  state.rackDevEls = {};
  state.rackBoxEls = {};
  state.rackColEls = {};
  state.rackOcc = {};
  setStatus("получаю устройства и кабели из NetBox…");

  const rackQ = group.map(r => "rack_id=" + r.id).join("&");
  const byRack = {};
  group.forEach(r => byRack[r.id] = []);
  const [devices, cables, ips, ...portLists] = await Promise.all([
    apiAll("/dcim/devices/?" + rackQ),
    apiAll("/dcim/cables/?" + rackQ),
    apiAll("/ipam/ip-addresses/?" + rackQ),   // IP группы → тултип/паспорт (в т.ч. wireless/circuit)
    ...PORT_KINDS.map(k => apiAll(`/dcim/${k.ep}/?${rackQ}`)),
  ]);
  for (const d of devices) {
    state.devRack[d.id] = d.rack ? d.rack.id : null;
    if (d.rack && byRack[d.rack.id]) byRack[d.rack.id].push(d);
    state.devices.push(d);
  }
  const seen = new Set();
  state.cables = cables.filter(c => !seen.has(c.id) && seen.add(c.id));

  // Устройства ВНЕ стоек (конечные потребители / провайдер) в площадках области.
  // Основной запрос берёт только по rack_id — этих он не видит. Грузим отдельно
  // их самих + порты + кабели; помечаем _off = "provider" (над стойками) либо
  // "periph" (сеткой справа). Классификация по роли (см. схему рендера).
  const siteIds = [...new Set(group.map(r => r.site && r.site.id).filter(Boolean))];
  if (siteIds.length) {
    const siteQ = siteIds.map(id => "site_id=" + id).join("&");
    const loaded = new Set(state.devices.map(d => d.id));
    const offDevs = (await apiAll("/dcim/devices/?" + siteQ)).filter(d => !d.rack && !loaded.has(d.id));
    if (offDevs.length) {
      const offQ = offDevs.map(d => "device_id=" + d.id).join("&");
      const [offCables, ...offPorts] = await Promise.all([
        apiAll("/dcim/cables/?" + offQ),
        ...PORT_KINDS.map(k => apiAll(`/dcim/${k.ep}/?${offQ}`)),
      ]);
      for (const d of offDevs) {
        state.devRack[d.id] = null;
        const r = (d.role && (d.role.name + " " + (d.role.slug || ""))) || "";
        d._off = /provider|провайдер|провайдер/i.test(r) ? "provider" : "periph";
        state.devices.push(d);
      }
      PORT_KINDS.forEach((k, ki) => portLists[ki].push(...offPorts[ki]));
      for (const c of offCables) if (!seen.has(c.id) && seen.add(c.id)) state.cables.push(c);
    }
  }
  // IP по интерфейсу: assigned_object_type=dcim.interface, assigned_object_id.
  state.ipsByIface = {};
  for (const ip of ips) {
    if (ip.assigned_object_type !== "dcim.interface" || !ip.assigned_object_id) continue;
    (state.ipsByIface[ip.assigned_object_id] = state.ipsByIface[ip.assigned_object_id] || []).push(ip);
  }

  const devPorts = {};
  PORT_KINDS.forEach((kind, ki) => {
    const byDev = {};
    for (const item of portLists[ki]) {
      const did = item.device ? item.device.id : null;
      if (did == null) continue;
      (byDev[did] = byDev[did] || []).push(item);
    }
    for (const [did, items] of Object.entries(byDev)) {
      if (!devPorts[did]) devPorts[did] = [];
      devPorts[did].push({ kind, items });
    }
  });
  for (const did in devPorts)
    devPorts[did].sort((a, b) => PORT_KINDS.indexOf(a.kind) - PORT_KINDS.indexOf(b.kind));

  state._devPorts = devPorts;
  setStatus("рисую схему…");
  app.rack.render(group, byRack);
  app.schema.render(group, byRack, devPorts);
  // renderPanel собирает state._wireless (пары радио-линков) — ДО redrawWires,
  // иначе drawRadioLinks не найдёт пары при первой отрисовке в сетевом режиме.
  app.layers.renderPanel();
  app.schema.redrawWires();
  app.filter.render();
  app.search.position();
  setStatus(`${state.devices.length} устройств, ${state.cables.length} кабелей`, "ok");
}

// старт: выбор холста
const CANVAS = document.body.dataset.canvas || "infra";
if (CANVAS === "infra") {
  connect();
} else if (CANVAS === "network") {
  // Холст «Сеть / IPAM»: treemap занятости. Свой контейнер (#ipam), physical-
  // панели скрыты классом body.ipam-mode.
  import("./ipam.js").then(({ IpamCanvas }) => {
    document.body.classList.add("ipam-mode");
    app.ipam = new IpamCanvas(app);
    app.ipam.load();
    const sync = $("#syncbtn");
    if (sync) sync.addEventListener("click", () => app.ipam.load());
    // Переключатель view/edit холста «Сети» (кнопка .modebtn[data-mode=ipam]
    // в заголовке холста). Тогл body.ipam-edit + aria делает общий ModeManager
    // (делегирование по .modebtn в modes.js) — мы лишь подписываемся на смену
    // режима и перерисовываем (кнопки +сеть, draggable-ручки видны в edit).
    Mode.onChange("ipam", () => app.ipam.render());
  });
} else {
  const wip = $("#wip");
  if (wip) wip.style.display = "flex";
  document.body.classList.add("wip-mode");
  setStatus("холст «" + CANVAS + "» в разработке");
}
