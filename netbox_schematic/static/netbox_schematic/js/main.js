"use strict";
// Entry point: wires managers together through a shared app context
// app = { tree, rack, schema, device, openModal, renderAll, connect }.
// Managers call each other via app (e.g. tree.selectScope → app.renderAll →
// rack.render + schema.render). Shared state lives in core.state.

import { $, state, PORT_KINDS } from "./core.js";
import { apiAll, apiAllByIds, apiPlugin, setStatus, loadCableTypes } from "./api.js";
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
import { ImportUI } from "./importui.js";
import { ExportUI } from "./exportui.js";
import { AuditUI } from "./auditui.js";

const app = {};
app.device = new DeviceManager(app);
app.schema = new SchemaManager(app);
app.layers = new LayerManager(app);
app.ipform = new IpForm(app);
app.rack = new RackManager(app);
app.tree = new TreeManager(app);
app.search = new SearchManager(app);
app.filter = new RoleFilter(app);
// Proxy methods that managers call through app
app.openModal = (...a) => app.device.openModal(...a);
app.connect = () => connect();
app.renderAll = group => renderAll(group);

// Header «Обновить» button — manual full reconnect (reference lists + tree +
// current group). No auto-polling: NetBox has no WS or client push, and we
// chose not to add polling (see UPDATES.md).
{
  const sync = $("#syncbtn");
  if (sync) sync.addEventListener("click", async () => {
    setStatus("обновляю данные из NetBox…");
    await app.tree.reload();
    setStatus("данные обновлены", "ok");
  });
}

// Excel import / export — modals (ImportUI / ExportUI).
{
  app.importui = new ImportUI(app);
  app.importui.bind();
  app.exportui = new ExportUI(app);
  app.exportui.bind();
  app.auditui = new AuditUI(app);
  app.auditui.bind();
}

// Header user menu (click the name → dropdown; click outside → close).
{
  const box = $("#userbox"), btn = $("#userbtn");
  if (box && btn) {
    btn.addEventListener("click", e => { e.stopPropagation(); box.classList.toggle("open"); });
    document.addEventListener("click", e => { if (!box.contains(e.target)) box.classList.remove("open"); });
  }
}

app.device.wireModal();
initTheme();

// Connect: load reference lists, build the tree
async function connect() {
  state.base = "";
  setStatus("подключаюсь…");
  try {
    const [regions, siteGroups, sites, locations, racks, roles, dtypes, prefixes, , panels, feeds, wlinks, circuits, cterms, cprov, ctypes, allDevices] = await Promise.all([
      apiAll("/dcim/regions/"), apiAll("/dcim/site-groups/"),
      apiAll("/dcim/sites/"), apiAll("/dcim/locations/"), apiAll("/dcim/racks/"),
      apiAll("/dcim/device-roles/"), apiAll("/dcim/device-types/"), apiAll("/ipam/prefixes/"),
      loadCableTypes(),   // cable types from OPTIONS → state.cableTypes (writes itself; result skipped)
      apiAll("/dcim/power-panels/"), apiAll("/dcim/power-feeds/"),
      apiAll("/wireless/wireless-links/"),   // «Wireless» layer (radio links between interfaces)
      apiAll("/circuits/circuits/"), apiAll("/circuits/circuit-terminations/"),  // «Circuits» layer
      apiAll("/circuits/providers/"), apiAll("/circuits/circuit-types/"),  // for circuit assignment
      apiAll("/dcim/devices/"),   // ALL devices — to show in the tree under locations
    ]);
    state.regions = regions;
    state.siteGroups = siteGroups;
    state.sites = sites;
    state.locations = locations;
    state.prefixes = prefixes;
    state.roles = {}; roles.forEach(r => state.roles[r.id] = r);
    state.dtypes = {}; dtypes.forEach(t => state.dtypes[t.id] = t);
    state.racks = racks;
    state.allDevices = allDevices;   // for the tree (devices under locations)
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

// Full re-render of racks + schema for the selected group
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
  setStatus("получаю схему из NetBox…");
  // Kill the old schema at once (its dots are «dead» — state.ports reset above)
  // and show the loading indicator: otherwise switching folders leaves the stale
  // «dead» schema up, and hovering its ports threw errors (see _portHover-guard).
  const _pane = $("#schempane");
  // Blank the old schema while loading (placeholder text). Progress is now
  // SINGLE — a bar on the status block (body.busy → #status::after); the second bar is gone.
  if (_pane) _pane.innerHTML = `<div class="pane-loading"><div class="pl-txt">загружаю схему…</div></div>`;

  const rackIds = group.map(r => r.id);
  const byRack = {};
  group.forEach(r => byRack[r.id] = []);
  const siteIds = [...new Set(group.map(r => r.site && r.site.id).filter(Boolean))];
  const singleRack = !!(state.scope && state.scope.type === "rack");

  // ONE request — the whole scope graph (SchematicGraphView backend): devices +
  // ports + cables + IP, compact and N+1-free. Was ~40 generic NetBox REST calls
  // (pagination, heavy serializers) — minutes on a weak server; now one optimized
  // request. rack_id — racks; site_id — sites (for off-rack); scope=rack — a single
  // rack (off-rack not fetched).
  const q = rackIds.map(id => "rack_id=" + id)
    .concat(singleRack ? ["scope=rack"] : siteIds.map(id => "site_id=" + id))
    .join("&");
  let graph;
  try {
    graph = await apiPlugin("graph/?" + q);
  } catch (e) {
    if (_pane) _pane.innerHTML = `<div class="pane-loading"><div class="pl-txt pl-err">не удалось загрузить схему: ${e.message}</div></div>`;
    setStatus("ошибка загрузки схемы: " + e.message, "err");
    return;
  }

  // Devices. Off-rack ones (rack=null) get _off = provider|periph by role — as
  // before (provider drawn above the racks, the rest in a grid on the right).
  for (const d of (graph.devices || [])) {
    state.devRack[d.id] = d.rack ? d.rack.id : null;
    if (d.rack) { if (byRack[d.rack.id]) byRack[d.rack.id].push(d); }
    else {
      const r = (d.role && (d.role.name + " " + (d.role.slug || ""))) || "";
      d._off = /provider|провайдер/i.test(r) ? "provider" : "periph";
    }
    state.devices.push(d);
  }
  state.cables = graph.cables || [];

  // IP by interface: assigned_object_type=dcim.interface, assigned_object_id.
  state.ipsByIface = {};
  for (const ip of (graph.ips || [])) {
    if (ip.assigned_object_type !== "dcim.interface" || !ip.assigned_object_id) continue;
    (state.ipsByIface[ip.assigned_object_id] = state.ipsByIface[ip.assigned_object_id] || []).push(ip);
  }

  // Ports by device. graph.ports is grouped by KIND (key = otype without «dcim.»:
  // interface/frontport/rearport/…) → spread into devPorts[devId] = [{kind, items}].
  const devPorts = {};
  PORT_KINDS.forEach((kind) => {
    const list = (graph.ports && graph.ports[kind.otype.replace(/^dcim\./, "")]) || [];
    const byDev = {};
    for (const item of list) {
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
  // renderPanel collects state._wireless (radio-link pairs) — BEFORE redrawWires,
  // else drawRadioLinks finds no pairs on the first draw in network mode.
  app.layers.renderPanel();
  app.schema.redrawWires();
  app.filter.render();
  app.search.position();
  setStatus(`${state.devices.length} устройств, ${state.cables.length} кабелей`, "ok");
}

// start: pick the canvas
const CANVAS = document.body.dataset.canvas || "infra";
if (CANVAS === "infra") {
  connect();
} else if (CANVAS === "network") {
  // «Сеть / IPAM» canvas: usage treemap. Own container (#ipam), physical panels
  // hidden by the body.ipam-mode class.
  import("./ipam.js").then(({ IpamCanvas }) => {
    document.body.classList.add("ipam-mode");
    app.ipam = new IpamCanvas(app);
    app.ipam.load();
    const sync = $("#syncbtn");
    if (sync) sync.addEventListener("click", () => app.ipam.load());
    // View/edit toggle of the «Сети» canvas (.modebtn[data-mode=ipam] in the
    // canvas header). The shared ModeManager flips body.ipam-edit + aria
    // (.modebtn delegation in modes.js) — we only subscribe to the change and
    // re-render (+network buttons and draggable handles show in edit).
    Mode.onChange("ipam", () => app.ipam.render());
  });
} else {
  const wip = $("#wip");
  if (wip) wip.style.display = "flex";
  document.body.classList.add("wip-mode");
  setStatus("холст «" + CANVAS + "» в разработке");
}
