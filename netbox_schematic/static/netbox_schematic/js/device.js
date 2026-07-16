"use strict";
// DeviceManager: device passport + create modal

import { $, state, mk, modeBtn, slugify, hideTip } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { MANUFACTURER, solutionRows } from "./solutions.js";
import { buildDesired } from "./catalog.js";

const chip = (text, cls) => `<span class="chip ${cls || ""}">${text}</span>`;

// Port-dot class by termination type — color and SHAPE match the schema (front/
// rear/console-server/outlet — square; else circle). See .c-portdot.p-*.
const DOT_KIND = {
  "dcim.interface": "p-iface", "dcim.frontport": "p-front", "dcim.rearport": "p-rear",
  "dcim.consoleport": "p-con", "dcim.consoleserverport": "p-consrv",
  "dcim.powerport": "p-pin", "dcim.poweroutlet": "p-pout",
  "dcim.powerfeed": "p-feed", "circuits.circuittermination": "p-circuit",
};

// Compact port/iface name: rounded badge {type + number port-dot}. Dot sits
// INSIDE the badge (not clipped), colored by port type (otype). Stack/slot go
// in the native tooltip (title). otype optional (default iface). used=true →
// dot FILLED with the type color (like an occupied port on the schema).
export function portNameHtml(name, otype, used) {
  const pn = parseIfaceName(name);
  const num = ifacePortNum(name);
  // Tooltip: «Стек 1 · Слот 0 · Порт 3» (only present parts).
  const title = pn.parts.map(p => `${p.label} ${p.value}`).join(" · ") || name;
  const kindCls = DOT_KIND[otype] || "p-iface";
  return `<span class="port-badge" title="${title}">` +
    `<span class="c-iface">${pn.type || name}</span>` +
    (num ? `<span class="c-portdot ${kindCls}${used ? " used" : ""}">${num}</span>` : "") +
    `</span>`;
}

// Parse iface name into «type + position». Cisco notation: alpha type +
// X/Y/Z (stack member / slot / port). Returns {type, parts:[{label,value}]}.
// Non-X/Y/Z format → parts = [{label:"Номер", value:<rest>}] or empty.
export function parseIfaceName(name) {
  const m = String(name).match(/^([A-Za-z][A-Za-z .-]*?)\s*(\d+(?:\/\d+)*)?$/);
  if (!m) return { type: name, parts: [] };
  const type = m[1].trim();
  const nums = m[2] ? m[2].split("/") : [];
  if (nums.length === 3)
    return { type, parts: [
      { label: "Стек", value: nums[0] }, { label: "Слот", value: nums[1] }, { label: "Порт", value: nums[2] } ] };
  if (nums.length === 2)
    return { type, parts: [{ label: "Слот", value: nums[0] }, { label: "Порт", value: nums[1] }] };
  if (nums.length === 1)
    return { type, parts: [{ label: "Порт", value: nums[0] }] };
  return { type, parts: [] };
}
// Trailing port number of the name — for the chip's port-dot (last digit).
export function ifacePortNum(name) {
  const m = String(name).match(/(\d+)(?!.*\d)/);
  return m ? m[1] : "";
}

export class DeviceManager {
  constructor(app) {
    this.app = app;
    this.current = null;        // last shown device (for re-render)
    this.currentPanel = null;   // …or the shown power panel
    this.currentStack = null;   // …or the shown VirtualChassis (stack) passport
    // Mode change (schema OR the detail-block's own mode) re-renders the open
    // passport so edit buttons appear/disappear (+IP, feeder ✎, panel pencil).
    // "detail" mode — toggle right inside the detail block.
    const rerender = () => {
      if (this.current) this.show(this.current);
      else if (this.currentPanel) this.showPanel(this.currentPanel);
      else if (this.currentStack) this.showStack(this.currentStack);
    };
    Mode.onChange("schema", rerender);
    Mode.onChange("detail", rerender);
  }
  // Editing in the detail block is available if schema mode OR the block's own
  // mode is on (toggle in its header).
  _editable() { return Mode.on("detail") || Mode.on("schema"); }

  // Generic modal: title, where caption, fields, onSubmit handler.
  // opts.side(sideEl) — optional renderer for a right-hand column (e.g. the
  // stack list on device creation); absent → the column stays hidden.
  openModal(title, where, fields, onSubmit, okLabel = "Создать", opts = {}) {
    $("#modal-title").textContent = title;
    $("#modal-where").textContent = where || "";
    $("#m-create").textContent = okLabel;
    $("#m-create").disabled = false;   // fresh modal — ensure the confirm is clickable
    // Right-hand side panel (two-column modal) — only when a renderer is given.
    const side = $("#modal-side");
    if (side) {
      side.innerHTML = "";
      if (opts.side) { side.style.display = ""; opts.side(side); }
      else side.style.display = "none";
    }
    const wrap = $("#modal-fields");
    wrap.innerHTML = "";
    for (const f of fields) {
      wrap.insertAdjacentHTML("beforeend", `<label for="mf-${f.id}">${f.label}</label>`);
      if (f.type === "select") {
        const sel = mk("select", { id: "mf-" + f.id,
          html: f.options.map(o => `<option value="${o.value}">${o.label}</option>`).join("") });
        if (f.value != null) sel.value = String(f.value);
        wrap.appendChild(sel);
      } else {
        wrap.appendChild(mk("input", { id: "mf-" + f.id, placeholder: f.placeholder || "",
          ...(f.value != null ? { value: f.value } : {}) }));
      }
    }
    state.modalSubmit = async () => {
      const values = {};
      for (const f of fields) values[f.id] = $("#mf-" + f.id).value.trim();
      await onSubmit(values);
    };
    $("#modal-bg").style.display = "flex";
    const first = wrap.querySelector("input, select");
    if (first) first.focus();
  }

  wireModal() {
    $("#m-cancel").addEventListener("click", () => $("#modal-bg").style.display = "none");
    $("#m-create").addEventListener("click", async () => {
      const btn = $("#m-create");
      if (btn.disabled) return;              // one click only — no double submit/delete
      btn.disabled = true;                   // blocked visually + physically during the op
      try {
        await state.modalSubmit();
        $("#modal-bg").style.display = "none";
      } catch (e) {
        setStatus("не получилось: " + e.message, "err");
      } finally {
        btn.disabled = false;                // re-enable (modal is already hidden on success)
      }
    });
  }

  // Passport header with the detail-block mode toggle (data-mode=detail).
  _detailHead(title, sub, over) {
    return `<div class="detail-head">${modeBtn("detail", "compact ms-corner")}` +
      (over ? `<div class="crumb-over">${over}</div>` : "") +
      `<h2>${title}</h2><div class="sub">${sub}</div></div>`;
  }
  async show(dev) {
    hideTip();                                   // close any lingering port tooltip
    const panel = $("#detail");
    // Re-render of the SAME device (e.g. after adding an IP) keeps the scroll
    // position — a full re-render otherwise jumps back to the top. A DIFFERENT
    // device starts at the top; closing the sheet resets it (see responsive.js).
    const keepScroll = (this.current && this.current.id === dev.id) ? panel.scrollTop : 0;
    this.currentPanel = null;
    this.currentStack = null;
    if (this.app.schema && this.app.schema._highlightStack) this.app.schema._highlightStack(null);
    panel.innerHTML = `<div class="placeholder">загружаю…</div>`;   // instant click feedback
    // Graph node is a «light» object (no status/platform/serial/location); for
    // the passport we fetch the FULL device from NetBox (all default fields).
    try { dev = await api("/dcim/devices/" + dev.id + "/"); } catch (e) { /* offline — render what we have */ }
    this.current = dev;
    const sub = `${dev.device_type.model} · ${dev.role.name} · U${dev.position ?? "—"}`;
    // Location name ABOVE the device name (crumb → click opens the location).
    const loc = dev.location;
    const over = loc ? `<a class="crumb-loc">${loc.name}</a>` : "";
    panel.innerHTML = this._detailHead(dev.name, sub, over) + `<div class="placeholder">загружаю…</div>`;
    const ips = await apiAll("/ipam/ip-addresses/?device_id=" + dev.id);
    const ipByIface = {};
    ips.forEach(ip => {
      const k = ip.assigned_object_id;
      if (!ipByIface[k]) ipByIface[k] = [];
      ipByIface[k].push(ip.address);
    });
    panel.innerHTML = this._detailHead(dev.name, sub, over);
    const crumb = panel.querySelector(".crumb-loc");
    if (crumb && loc) crumb.addEventListener("click", () => this.app.tree.selectScope("location", loc.id, loc.name));
    Mode.syncButtons("detail");
    const edit = this._editable();
    // (The manual «Синхронизировать порты с типом» button was removed — ports are
    // reconciled to the model by the catalog «Применить»/«По роли» and the on-node
    // «Модель» change; the manual sync was error-prone.)

    // Device DB info — as the FIRST section (core NetBox fields).
    const val = x => (x && (x.label || x.name || x.display || x.model)) || (typeof x === "string" ? x : "");
    const info = [
      ["Статус", dev.status && (dev.status.label || dev.status.value)],
      ["Роль", val(dev.role)], ["Тип", val(dev.device_type)],
      ["Платформа", val(dev.platform)],
      ["Площадка", val(dev.site)], ["Серверная", val(dev.location)],
      ["Стойка", val(dev.rack)], ["Юнит", dev.position != null ? "U" + dev.position : ""],
      ["Серийный №", dev.serial], ["Инв. №", dev.asset_tag],
      ["Описание", dev.description],
    ].filter(([, v]) => v);
    if (info.length) {
      panel.appendChild(mk("h4", { text: "Сведения" }));
      const box = mk("div", { className: "dev-info" });
      for (const [k, v] of info)
        box.appendChild(mk("div", { className: "di-row", html: `<span class="di-k">${k}</span><span class="di-v">${v}</span>` }));
      panel.appendChild(box);
    }

    // Stack (VirtualChassis) — above "Интерфейсы и IP". A switch stack is a
    // self-contained grouping (no cables between members), so it lives in the
    // passport, not on the canvas.
    this._renderStackBlock(panel, dev, edit);

    const ifacePorts = Object.values(state.ports)
      .filter(p => p.dev.id === dev.id && p.otype === "dcim.interface");
    if (ifacePorts.length) {
      panel.appendChild(mk("h4", { text: "Интерфейсы и IP" }));
      for (const p of ifacePorts) {
        const addrs = (ipByIface[p.item.id] || []).map(a => chip(a, "c-ip")).join("");
        // Iface linked (cable or radio-link) → port filled, and row hover
        // highlights it on the schema (detail item 3).
        const linked = !!(p.item.cable || p.item.wireless_link);
        const row = mk("div", { className: "iface-row" + (linked ? " linked" : ""),
          html: portNameHtml(p.item.name, p.otype, linked) + (addrs || '<span style="color:var(--muted);font-size:11px">без адреса</span>') });
        if (linked) row.addEventListener("mouseenter", () => this.app.schema._portHover(p, true));
        if (linked) row.addEventListener("mouseleave", () => this.app.schema._portHover(p, false));
        // Touch: tap a linked-port row → highlight it on the schema (single view
        // — reveal neighbor) and lower the detail sheet. Previously highlight ran
        // via mouseenter, and closing details (mouseleave) reset it immediately.
        if (linked) row.addEventListener("click", e => {
          if (e.target.closest("button")) return;                 // +IP etc. — leave alone
          if (!(matchMedia("(pointer: coarse)").matches || innerWidth <= 760)) return;
          const s = this.app.schema;
          if (state.single) s._revealFromPort(p.otype, p.item.id);
          else if (s._traceLocal) s._traceLocal(p.item);
          document.body.classList.remove("sheet-open");
        });
        if (edit) {
          const ab = mk("button", { text: "+IP", on: { click: ev =>
            this.app.ipform.open(dev, p.item, ev) } });
          row.appendChild(ab);
          if (!linked) {   // free port can be deleted (occupied — remove cable first)
            const db = mk("button", { className: "iface-del", title: "Удалить порт",
              html: `<i class="mdi mdi-close"></i>`, on: { click: async ev => {
                ev.stopPropagation();
                try {
                  await api("/dcim/interfaces/" + p.item.id + "/", "DELETE");
                  setStatus("порт удалён", "ok"); await this.app.tree.reload();
                } catch (e) { setStatus("не удалить порт: " + e.message, "err"); }
              } } });
            row.appendChild(db);
          }
        }
        panel.appendChild(row);
      }
    }
    // Add a port (any type) right on the device — build mode.
    if (edit) {
      panel.appendChild(mk("button", { className: "addport-btn",
        html: `<i class="mdi mdi-plus"></i> Добавить порт`,
        on: { click: () => this._addPort(dev) } }));
    }

    const conns = state.cables.filter(c =>
      [...(c.a_terminations || []), ...(c.b_terminations || [])]
        .some(t => t.object && t.object.device && t.object.device.id === dev.id));
    panel.appendChild(mk("h4", { text: "Соединения (" + conns.length + ")" }));
    if (!conns.length) {
      panel.appendChild(mk("div", { className: "placeholder",
        text: "кабелей нет — включи режим стройки и кликай по точкам портов" }));
    }
    for (const c of conns) {
      const sideHtml = t => {
        if (!t || !t.object) return chip("?", "");
        const o = t.object;
        return (o.device ? chip(o.device.name, "c-dev") : "") + portNameHtml(o.name, t.object_type);
      };
      panel.appendChild(mk("div", { className: "conn",
        html: `<div class="side">${sideHtml((c.a_terminations || [])[0])}</div>
          <div class="mid">⇄</div>
          <div class="side">${sideHtml((c.b_terminations || [])[0])}</div>` }));
    }
    panel.scrollTop = keepScroll;   // keep position across a same-device re-render
  }

  // Power Panel passport — click the panel name on the schema. Not a device,
  // so we clear this.current (else onChange("schema") would try to re-render
  // it as a device via show()).
  showPanel(panel) {
    this.current = null;
    this.currentStack = null;
    if (this.app.schema && this.app.schema._highlightStack) this.app.schema._highlightStack(null);
    this.currentPanel = panel;
    const el = $("#detail");
    const feeds = (state.powerFeeds || []).filter(f => f.power_panel && f.power_panel.id === panel.id);
    const loc = panel.location ? panel.location.name : "—";
    const edit = this._editable();
    el.innerHTML = this._detailHead(panel.name, `силовой щит · ${loc} · ${feeds.length} фид.`);
    Mode.syncButtons("detail");
    // Pencil by the panel name (in edit) — rename the panel itself.
    if (edit) {
      const pen = mk("button", { className: "head-edit", title: "Изменить щит",
        html: `<i class="mdi mdi-pencil"></i>`,
        on: { click: () => this._editPanel(panel) } });
      el.querySelector(".detail-head h2").appendChild(pen);
    }
    el.appendChild(mk("h4", { text: "Фидеры (" + feeds.length + ")" }));
    if (!feeds.length) {
      el.appendChild(mk("div", { className: "placeholder", text: "фидеров нет — добавь в режиме стройки" }));
      return;
    }
    for (const f of feeds) {
      const va = f.amperage ? `${f.voltage || "?"} В / ${f.amperage} А` : "";
      const rack = f.rack ? (f.rack.display || f.rack.name) : "—";
      const st = f.cable ? "подключён" : "не подключён";
      const row = mk("div", { className: "conn",
        html: `<div class="side">${chip(f.name, "c-dev")}${va ? `<span style="color:var(--muted);font-size:11px">${va}</span>` : ""}</div>
          <div class="mid">→</div>
          <div class="side">${chip(rack, "")}<span style="color:var(--muted);font-size:11px">${st}</span></div>` });
      // In edit mode — «edit» (incl. destination rack) and «delete» the feeder
      // right from the panel passport (easier than finding it in the tree).
      if (edit) {
        const info = { kind: "feed", id: f.id, name: f.name };
        const acts = mk("div", { className: "feed-acts" });
        acts.appendChild(mk("button", { title: "Изменить фидер", html: `<i class="mdi mdi-pencil"></i>`,
          on: { click: e => { e.stopPropagation(); this.app.tree._editFeed(info); } } }));
        acts.appendChild(mk("button", { className: "danger", title: "Удалить фидер", html: `<i class="mdi mdi-delete"></i>`,
          on: { click: e => { e.stopPropagation(); this.app.tree._delete(info); } } }));
        row.appendChild(acts);
      }
      el.appendChild(row);
    }
  }
  // Rename power panel (pencil in passport). After reload, take the fresh
  // panel object and re-show the passport.
  _editPanel(panel) {
    this.app.openModal("Изменить щит", "Текущее: " + panel.name,
      [{ id: "name", label: "Название щита", value: panel.name }],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api("/dcim/power-panels/" + panel.id + "/", "PATCH", { name: v.name });
        setStatus("щит переименован: " + v.name, "ok");
        await this.app.tree.reload();
        this.showPanel((state.powerPanels || []).find(p => p.id === panel.id) || panel);
      }, "Сохранить");
  }

  // Add a «ready solution» from the palette/«Add» menu (kind="device"). Device
  // type NOT asked (it IS the solution) and port counts NOT asked either: ports
  // come from the DeviceType TEMPLATES (NetBox instantiates them on device
  // creation). A brand-new type is seeded with the solution's port spec; edits
  // go through the catalog («Сохранить в тип»), so the model is the single
  // source of truth — no per-device counters fighting it with duplicate ports.
  async addSolution(item, ctx = {}) {
    const sites = state.group
      ? [...new Map(state.group.filter(r => r.site).map(r => [r.site.id, r.site])).values()] : [];
    const siteId = ctx.siteId != null ? ctx.siteId : (sites[0] && sites[0].id);
    if (siteId == null) { setStatus("выбери в дереве область с площадкой", "err"); return; }
    const typeExists = Object.values(state.dtypes)
      .some(t => (t.model || "").toLowerCase() === String(item.model || "").toLowerCase());
    const where = (ctx.locName ? "локация: " + ctx.locName : "вне стойки")
      + (typeExists ? " · порты возьмутся из модели типа (правятся в Каталоге)"
                    : ` · тип «${item.model}» добавится в справочник с портами решения`);
    this.openModal("Добавить: " + item.label, where,
      [{ id: "name", label: "Имя", value: item.label, placeholder: item.label }],
      async v => {
        if (!v.name) throw new Error("укажи имя");
        const dt = await this._ensureDeviceType(item);
        const role = await this._ensureRole(item.role || item.label, item.roleColor || "607d8b");
        const body = { name: v.name, role: role.id, device_type: dt.id, site: +siteId, status: "active" };
        if (ctx.locId) body.location = +ctx.locId;   // place into the drop's location
        // NetBox creates the components from the type's templates automatically.
        const dev = await api("/dcim/devices/", "POST", body);
        const cnt = ["interface", "power_port", "power_outlet", "console_port",
          "console_server_port", "front_port", "rear_port"]
          .reduce((s, k) => s + (+dev[k + "_count"] || 0), 0);
        setStatus(cnt ? `создано: ${v.name} (портов из модели: ${cnt})`
          : `создано: ${v.name} · порты — из модели: если их нет, открой Каталог (⚠) и «Применить ко всем»`, "ok");
        await this.app.tree.reload();
      }, "Создать");
  }
  // «Add port» modal: name + port type (+ iface type). Creates one port.
  _addPort(dev) {
    this.openModal("Добавить порт: " + dev.name, "",
      [
        { id: "name", label: "Имя", placeholder: "eth1" },
        { id: "kind", label: "Тип порта", type: "select", options: [
          { value: "interface", label: "Сетевой (интерфейс)" },
          { value: "frontrear", label: "Патч-пара (front+rear)" },
          { value: "power", label: "Ввод питания" },
          { value: "poweroutlet", label: "Розетка питания" },
          { value: "console", label: "Консоль" },
        ] },
        { id: "iftype", label: "Тип интерфейса (для сетевого)", type: "select", options: [
          { value: "1000base-t", label: "1G медь (RJ45)" },
          { value: "1000base-x-sfp", label: "1G оптика (SFP)" },
          { value: "10gbase-t", label: "10G медь" },
          { value: "10gbase-x-sfpp", label: "10G оптика (SFP+)" },
          { value: "other", label: "Другой" },
        ] },
        { id: "conntype", label: "Коннектор (для патч-пары)", type: "select", options: [
          { value: "8p8c", label: "RJ45 (медь, 8P8C)" },
          { value: "lc", label: "LC (оптика)" },
          { value: "sc", label: "SC (оптика)" },
          { value: "mpo", label: "MPO (оптика)" },
        ] },
      ],
      async v => {
        if (!v.name) throw new Error("укажи имя");
        // Patch pair: rear + front with 1:1 mapping → device becomes «through».
        if (v.kind === "frontrear") {
          const ct = v.conntype || "8p8c";
          const rp = await api("/dcim/rear-ports/", "POST", { device: dev.id, name: v.name + " (тыл)", type: ct, positions: 1 });
          await api("/dcim/front-ports/", "POST", { device: dev.id, name: v.name, type: ct, positions: 1,
            rear_ports: [{ position: 1, rear_port: rp.id, rear_port_position: 1 }] });
          setStatus("патч-пара добавлена: " + v.name, "ok");
          await this.app.tree.reload();
          return;
        }
        const EP = { interface: "interfaces", power: "power-ports", poweroutlet: "power-outlets", console: "console-ports" };
        const ep = EP[v.kind] || "interfaces";
        const b = { device: dev.id, name: v.name };
        if (v.kind === "interface") b.type = v.iftype || "1000base-t";
        await api("/dcim/" + ep + "/", "POST", b);
        setStatus("порт добавлен: " + v.name, "ok");
        await this.app.tree.reload();
      }, "Добавить");
  }
  // Rack from palette/menu — reuse the tree modal, site/location from the
  // drop spot.
  addRack(ctx = {}) {
    const site = (state.sites || []).find(s => s.id === +ctx.siteId) || { id: +ctx.siteId, name: "" };
    this.app.tree._createRack({ id: site.id, name: site.name }, { id: +ctx.locId, name: ctx.locName || "" });
  }
  // Power Panel from the palette/menu.
  addPanel(ctx = {}) {
    const site = (state.sites || []).find(s => s.id === +ctx.siteId) || { id: +ctx.siteId, name: "" };
    this.app.tree._createPanel({ id: site.id, name: site.name }, { id: +ctx.locId, name: ctx.locName || "" });
  }
  // Catalog: find manufacturer by name or create.
  async _ensureManufacturer(name) {
    const list = await apiAll("/dcim/manufacturers/?name=" + encodeURIComponent(name));
    if (list.length) return list[0];
    return await api("/dcim/manufacturers/", "POST", { name, slug: slugify(name) });
  }
  // Catalog: find DeviceType by model (case-insensitive) or create it under the
  // shared manufacturer (ready solution), seeding its component TEMPLATES from
  // the solution's port spec — so devices of the type are born WITH ports.
  // Accepts a solution item ({model, ports/net/power}) or a bare model string.
  // Cached in state.dtypes.
  async _ensureDeviceType(sol) {
    const model = typeof sol === "string" ? sol : sol.model;
    let dt = Object.values(state.dtypes)
      .find(t => (t.model || "").toLowerCase() === String(model).toLowerCase());
    if (dt) return dt;
    const mfr = await this._ensureManufacturer(MANUFACTURER);
    dt = await api("/dcim/device-types/", "POST",
      { manufacturer: mfr.id, model, slug: slugify(model) });
    state.dtypes[dt.id] = dt;
    if (typeof sol === "object") {
      try { await this._seedTypeTemplates(dt.id, sol); }
      catch (e) { setStatus(`тип создан, но порты модели не записались: ${e.message}`, "err"); }
    }
    return dt;
  }
  // Fresh type ← solution port spec: rows → buildDesired (numeric names, same
  // convention as the catalog editor) → POST templates. rear before front (FK);
  // NetBox 4.6 maps a front template to its rear via writable `rear_ports`.
  async _seedTypeTemplates(dtId, sol) {
    const desired = buildDesired(solutionRows(sol));
    const rearId = {};
    for (const t of desired["rear-port-templates"]) {
      const c = await api("/dcim/rear-port-templates/", "POST",
        { device_type: dtId, name: t.name, type: t.type, positions: 1 });
      rearId[t.name] = c.id;
    }
    for (const ep of ["interface-templates", "console-port-templates",
      "console-server-port-templates", "power-port-templates", "power-outlet-templates"])
      for (const t of desired[ep])
        await api(`/dcim/${ep}/`, "POST",
          { device_type: dtId, name: t.name, ...(t.type ? { type: t.type } : {}) });
    for (const t of desired["front-port-templates"])
      await api("/dcim/front-port-templates/", "POST",
        { device_type: dtId, name: t.name, type: t.type,
          rear_ports: [{ position: 1, rear_port: rearId[t.rearName], rear_port_position: 1 }] });
  }
  // Catalog: find role by name or create (solution color).
  async _ensureRole(name, color) {
    let r = Object.values(state.roles)
      .find(x => (x.name || "").toLowerCase() === String(name).toLowerCase());
    if (r) return r;
    r = await api("/dcim/device-roles/", "POST", { name, slug: slugify(name), color });
    state.roles[r.id] = r;
    return r;
  }

  // Full device edit modal (pencil on the node's right edge in edit mode) —
  // core fields of NetBox's default form: name, status, role, type, platform,
  // site/location/rack/unit/face, serial, asset tag, description. Platforms
  // loaded once. Unit/face only make sense with a rack → without one send null
  // (else NetBox rejects).
  async editDevice(dev) {
    const roles = Object.values(state.roles), types = Object.values(state.dtypes);
    const sites = state.sites || [], locs = state.locations || [], racks = state.racks || [];
    let platforms = [];
    try { platforms = await apiAll("/dcim/platforms/"); } catch (_) {}
    const STATUS = [["active", "Active"], ["offline", "Offline"], ["planned", "Planned"],
      ["staged", "Staged"], ["failed", "Failed"], ["inventory", "Inventory"],
      ["decommissioning", "Decommissioning"]];
    const FACE = [["", "— не задана —"], ["front", "Front"], ["rear", "Rear"]];
    const opt = (arr, empty) => [...(empty ? [{ value: "", label: empty }] : []), ...arr];
    const idOf = x => (x && x.id != null) ? String(x.id) : "";
    // Face may arrive as {value,label} (detail) or a bare string — normalise so
    // the prefill keeps the real side (else save would silently reset it).
    const faceVal = (dev.face && (dev.face.value ?? dev.face)) || "";
    this.openModal("Изменить устройство", dev.name,
      [
        { id: "name", label: "Имя", value: dev.name },
        { id: "status", label: "Статус", type: "select", value: (dev.status && dev.status.value) || "active",
          options: STATUS.map(([v, l]) => ({ value: v, label: l })) },
        { id: "role", label: "Роль", type: "select", value: idOf(dev.role),
          options: roles.map(r => ({ value: r.id, label: r.name })) },
        { id: "device_type", label: "Тип устройства", type: "select", value: idOf(dev.device_type),
          options: types.map(t => ({ value: t.id, label: t.display || t.model })) },
        { id: "platform", label: "Платформа", type: "select", value: idOf(dev.platform),
          options: opt(platforms.map(p => ({ value: p.id, label: p.name })), "— не задана —") },
        { id: "site", label: "Площадка", type: "select", value: idOf(dev.site),
          options: sites.map(s => ({ value: s.id, label: s.name })) },
        { id: "location", label: "Серверная", type: "select", value: idOf(dev.location),
          options: opt(locs.map(l => ({ value: l.id, label: (l.site ? l.site.name + " · " : "") + l.name })), "— вне серверной —") },
        { id: "rack", label: "Стойка", type: "select", value: idOf(dev.rack),
          options: opt(racks.map(r => ({ value: r.id, label: r.name })), "— вне стойки —") },
        { id: "position", label: "Юнит (позиция)", value: dev.position ?? "" },
        { id: "face", label: "Сторона", type: "select", value: faceVal,
          options: FACE.map(([v, l]) => ({ value: v, label: l })) },
        { id: "serial", label: "Серийный номер", value: dev.serial || "" },
        { id: "asset_tag", label: "Инвентарный номер", value: dev.asset_tag || "" },
        { id: "description", label: "Описание", value: dev.description || "" },
      ],
      async v => {
        if (!v.name) throw new Error("укажи имя");
        const rack = v.rack ? +v.rack : null;
        const position = rack && v.position !== "" ? +v.position : null;
        const body = {
          name: v.name, status: v.status,
          role: +v.role, device_type: +v.device_type,
          platform: v.platform ? +v.platform : null,
          site: +v.site,
          location: v.location ? +v.location : null,
          rack,
          // Unit/face only make sense in a rack. NetBox rejects a position without
          // a face ("Must specify rack face…"), so default to "front" when the user
          // left it empty (matches the importer's placement); no position → both null.
          position,
          face: position != null ? (v.face || "front") : null,
          serial: v.serial || "",
          asset_tag: v.asset_tag ? v.asset_tag : null,
          description: v.description || "",
        };
        await api("/dcim/devices/" + dev.id + "/", "PATCH", body);
        setStatus("устройство обновлено: " + v.name, "ok");
        await this.app.tree.reload();
      }, "Сохранить");
  }

  // LOCATION passport (click a location in the tree): its devices — by rack +
  // «Вне стоек» (consumers). Each clickable → its passport. Data from the
  // already loaded state.devices (scope=location → its devices).
  showLocation(loc) {
    this.current = null; this.currentPanel = null; this.currentStack = null;
    const el = $("#detail");
    const rackDevs = state.devices.filter(d => d.rack);
    const offDevs = state.devices.filter(d => d._off && d.location && d.location.id === loc.id);
    const total = rackDevs.length + offDevs.length;
    // Site name ABOVE the location name (what the location belongs to).
    const site = ((state.locations || []).find(l => l.id === loc.id) || loc).site;
    const over = site ? `<a class="crumb-site">${site.name}</a>` : "";
    el.innerHTML = this._detailHead(loc.name, "серверная · " + total + " устройств", over);
    Mode.syncButtons("detail");
    const sc = el.querySelector(".crumb-site");
    if (sc && site) sc.addEventListener("click", () => this.app.tree.selectScope("site", site.id, site.name));
    const row = d => {
      const color = (state.roles[d.role && d.role.id] || {}).color || "607d8b";
      const r = mk("div", { className: "loc-dev",
        html: `<span class="ld-dot" style="background:#${color}"></span>` +
          `<span class="ld-name">${d.name}</span>` +
          `<span class="ld-mut">${(d.device_type && d.device_type.model) || ""}</span>` });
      r.addEventListener("click", () => this.show(d));
      return r;
    };
    // By rack (top-down by position).
    const byRack = {};
    for (const d of rackDevs) { const k = (d.rack.name || d.rack.display || "?"); (byRack[k] = byRack[k] || []).push(d); }
    for (const rk of Object.keys(byRack).sort()) {
      el.appendChild(mk("h4", { text: "Стойка " + rk }));
      byRack[rk].sort((a, b) => (b.position || 0) - (a.position || 0)).forEach(d => el.appendChild(row(d)));
    }
    if (offDevs.length) {
      el.appendChild(mk("h4", { text: "Вне стоек" }));
      offDevs.forEach(d => el.appendChild(row(d)));
    }
    if (!total) el.appendChild(mk("div", { className: "placeholder", text: "устройств нет" }));
  }

  // SITE passport (click a site in the tree): its locations. Click a location →
  // load its scope (selectScope) and show its passport.
  showSite(site) {
    this.current = null; this.currentPanel = null; this.currentStack = null;
    const el = $("#detail");
    const locs = (state.locations || []).filter(l => l.site && l.site.id === site.id);
    // Site group ABOVE the site name (what the site belongs to).
    const group = ((state.sites || []).find(s => s.id === site.id) || site).group;
    const over = group ? `<a class="crumb-site">${group.name}</a>` : "";
    el.innerHTML = this._detailHead(site.name, "площадка · " + locs.length + " серверных", over);
    Mode.syncButtons("detail");
    const gc = el.querySelector(".crumb-site");
    if (gc && group) gc.addEventListener("click", () => this.app.tree.selectScope("sitegroup", group.id, group.name));
    if (!locs.length) { el.appendChild(mk("div", { className: "placeholder", text: "серверных нет" })); return; }
    el.appendChild(mk("h4", { text: "Серверные" }));
    for (const loc of locs) {
      const nRacks = (state.racks || []).filter(r => r.location && r.location.id === loc.id).length;
      const r = mk("div", { className: "loc-dev",
        html: `<span class="ld-dot" style="background:var(--accent)"></span>` +
          `<span class="ld-name">${loc.name}</span><span class="ld-mut">${nRacks} стоек</span>` });
      r.addEventListener("click", () => this.app.tree.selectScope("location", loc.id, loc.name));
      el.appendChild(r);
    }
  }
  // SITE-GROUP passport: subgroups + sites. Click → go into them (selectScope).
  showGroup(group) {
    this.current = null; this.currentPanel = null; this.currentStack = null;
    const el = $("#detail");
    const subs = (state.siteGroups || []).filter(g => g.parent && g.parent.id === group.id);
    const sites = (state.sites || []).filter(s => s.group && s.group.id === group.id);
    el.innerHTML = this._detailHead(group.name, "группа мест · " + sites.length + " площ. · " + subs.length + " подгр.");
    Mode.syncButtons("detail");
    if (subs.length) {
      el.appendChild(mk("h4", { text: "Подгруппы" }));
      for (const g of subs) {
        const r = mk("div", { className: "loc-dev",
          html: `<span class="ld-dot" style="background:var(--power)"></span><span class="ld-name">${g.name}</span>` });
        r.addEventListener("click", () => this.app.tree.selectScope("sitegroup", g.id, g.name));
        el.appendChild(r);
      }
    }
    if (sites.length) {
      el.appendChild(mk("h4", { text: "Площадки" }));
      for (const s of sites) {
        const nLoc = (state.locations || []).filter(l => l.site && l.site.id === s.id).length;
        const r = mk("div", { className: "loc-dev",
          html: `<span class="ld-dot" style="background:var(--accent)"></span>` +
            `<span class="ld-name">${s.name}</span><span class="ld-mut">${nLoc} серверных</span>` });
        r.addEventListener("click", () => this.app.tree.selectScope("site", s.id, s.name));
        el.appendChild(r);
      }
    }
    if (!subs.length && !sites.length) el.appendChild(mk("div", { className: "placeholder", text: "пусто" }));
  }

  // Simple components (no refs to other ports): create missing by name.
  async _syncKind(dev, dtId, tmplEp, compEp) {
    const [tmpls, existing] = await Promise.all([
      apiAll(`/dcim/${tmplEp}/?device_type_id=${dtId}`),
      apiAll(`/dcim/${compEp}/?device_id=${dev.id}`),
    ]);
    const have = new Set(existing.map(c => c.name));
    let n = 0;
    for (const t of tmpls) {
      if (have.has(t.name)) continue;
      const body = { device: dev.id, name: t.name };
      if (t.type) body.type = t.type.value;
      if (compEp === "power-ports") {
        if (t.maximum_draw != null) body.maximum_draw = t.maximum_draw;
        if (t.allocated_draw != null) body.allocated_draw = t.allocated_draw;
      }
      if (compEp === "rear-ports" && t.positions != null) body.positions = t.positions;
      await api(`/dcim/${compEp}/`, "POST", body);
      n++;
    }
    return n;
  }
  // Front-ports reference a rear-port (by name in the template) — resolve to id.
  async _syncFrontPorts(dev, dtId) {
    const [tmpls, existing, rears] = await Promise.all([
      apiAll(`/dcim/front-port-templates/?device_type_id=${dtId}`),
      apiAll(`/dcim/front-ports/?device_id=${dev.id}`),
      apiAll(`/dcim/rear-ports/?device_id=${dev.id}`),
    ]);
    const have = new Set(existing.map(c => c.name));
    const rearByName = {}; rears.forEach(r => rearByName[r.name] = r.id);
    let n = 0;
    for (const t of tmpls) {
      if (have.has(t.name)) continue;
      // Front pairs with the same-named rear (our types number front/rear alike).
      // NetBox 4.6: map via the writable `rear_ports` array (PortMapping), not `rear_port`.
      const rearId = rearByName[t.name];
      if (!rearId) continue;   // no matching rear-port → can't create the front
      await api("/dcim/front-ports/", "POST", {
        device: dev.id, name: t.name, ...(t.type ? { type: t.type.value } : {}),
        rear_ports: [{ position: 1, rear_port: rearId, rear_port_position: 1 }],
      });
      n++;
    }
    return n;
  }
  // Power outlets may reference a power-port (by name) — resolve optionally.
  async _syncPowerOutlets(dev, dtId) {
    const [tmpls, existing, pports] = await Promise.all([
      apiAll(`/dcim/power-outlet-templates/?device_type_id=${dtId}`),
      apiAll(`/dcim/power-outlets/?device_id=${dev.id}`),
      apiAll(`/dcim/power-ports/?device_id=${dev.id}`),
    ]);
    const have = new Set(existing.map(c => c.name));
    const ppByName = {}; pports.forEach(p => ppByName[p.name] = p.id);
    let n = 0;
    for (const t of tmpls) {
      if (have.has(t.name)) continue;
      const body = { device: dev.id, name: t.name };
      if (t.type) body.type = t.type.value;
      const ppName = t.power_port && t.power_port.name;
      if (ppName && ppByName[ppName]) body.power_port = ppByName[ppName];
      if (t.feed_leg) body.feed_leg = t.feed_leg.value || t.feed_leg;
      await api("/dcim/power-outlets/", "POST", body);
      n++;
    }
    return n;
  }

  // Step-2 propagation: ADD the type's template ports to EVERY device of the type.
  // Grow-only — reuses the create-missing helpers WITHOUT the delete pass, so cabled
  // imported ports (and their IPs) are never touched. Matching by name == by number
  // for our numeric port names, so it just fills the gaps up to the model's set.
  // rear/power before front/outlets (FK). Returns {devices, created}.
  // Grow ONE device to a type's ports (create missing, never delete). Reused by
  // growDevicesToType and the on-node «Модель» change.
  async growOneToType(devId, dtId) {
    const dev = { id: devId };
    let c = 0;
    c += await this._syncKind(dev, dtId, "interface-templates", "interfaces");
    c += await this._syncKind(dev, dtId, "console-port-templates", "console-ports");
    c += await this._syncKind(dev, dtId, "console-server-port-templates", "console-server-ports");
    c += await this._syncKind(dev, dtId, "power-port-templates", "power-ports");
    c += await this._syncKind(dev, dtId, "rear-port-templates", "rear-ports");
    c += await this._syncFrontPorts(dev, dtId);
    c += await this._syncPowerOutlets(dev, dtId);
    return c;
  }
  async growDevicesToType(dtId, onProgress) {
    const devs = await apiAll(`/dcim/devices/?device_type_id=${dtId}`);
    let created = 0;
    for (let i = 0; i < devs.length; i++) {
      if (onProgress) onProgress(i + 1, devs.length);
      created += await this.growOneToType(devs[i].id, dtId);
    }
    return { devices: devs.length, created };
  }
  // Reconcile a device's existing ports to the model's names/types BY NUMBER, so an
  // imported port (e.g. a cabled `eth1`) BECOMES the model's `1` — keeping its cable —
  // instead of a duplicate `1` being grown beside it. Prefers the OCCUPIED port for a
  // number and drops FREE same-number duplicates (also cleans up devices already left
  // with `eth1` + `1`). Standalone kinds only (front/outlet reference others). Used by
  // applyModel; NOT by the add-only grow («Применить ко всем» must not rename ports).
  async _reconcileToModel(devId, dtId) {
    const KINDS = [
      ["interface-templates", "interfaces"],
      ["console-port-templates", "console-ports"],
      ["console-server-port-templates", "console-server-ports"],
      ["power-port-templates", "power-ports"],
      ["rear-port-templates", "rear-ports"],
    ];
    const _pn = name => { const m = String(name || "").match(/(\d+)(?!.*\d)/); return m ? m[1] : null; };
    const busy = c => !!(c.cable || c.wireless_link);
    const warnings = [];
    for (const [tmplEp, compEp] of KINDS) {
      const [tmpls, existing] = await Promise.all([
        apiAll(`/dcim/${tmplEp}/?device_type_id=${dtId}`),
        apiAll(`/dcim/${compEp}/?device_id=${devId}`),
      ]);
      if (!tmpls.length) continue;
      const byNum = {};
      for (const c of existing) { const nn = _pn(c.name); if (nn != null) (byNum[nn] = byNum[nn] || []).push(c); }
      for (const t of tmpls) {
        const num = _pn(t.name);
        let cands = num != null && byNum[num] ? byNum[num].slice() : [];
        if (!cands.length) { const ex = existing.find(c => c.name === t.name); if (ex) cands = [ex]; }
        if (!cands.length) continue;                       // nothing with this number → grow creates it
        const keep = cands.find(busy) || cands.find(c => c.name === t.name) || cands[0];
        // drop FREE same-number duplicates (incl. a free port already holding t.name),
        // BEFORE renaming `keep` into that name — so there's no unique-name clash.
        for (const other of cands) {
          if (other.id === keep.id || busy(other)) continue;
          try { await api(`/dcim/${compEp}/${other.id}/`, "DELETE"); } catch (_) {}
        }
        // Rename `keep` to the model name (cable stays — it's by id). The TYPE: change
        // it only when the port is FREE. If the port is OCCUPIED and its type differs
        // from the model's, DON'T touch the type — a cable of the old type hangs on it —
        // just WARN, so the user decides whether to re-cable.
        const tv = t.type && (t.type.value || t.type);
        const kv = keep.type && (keep.type.value || keep.type);
        const patch = {};
        if (keep.name !== t.name) patch.name = t.name;
        if (tv && tv !== kv) {
          if (busy(keep)) warnings.push({ port: keep.name, from: (keep.type && keep.type.label) || kv, to: (t.type && t.type.label) || tv });
          else patch.type = tv;
        }
        if (Object.keys(patch).length) { try { await api(`/dcim/${compEp}/${keep.id}/`, "PATCH", patch); } catch (_) {} }
      }
    }
    return warnings;
  }
  // Per-node model CHANGE: reconcile occupied ports to the model (by number), grow the
  // truly-missing ones, then delete the device's FREE ports that aren't in the model
  // (occupied ports — with a cable — are always kept).
  async applyModel(devId, dtId) {
    const warnings = await this._reconcileToModel(devId, dtId);
    const added = await this.growOneToType(devId, dtId);
    const _pn = name => { const mm = String(name || "").match(/(\d+)(?!.*\d)/); return mm ? mm[1] : null; };
    // dependents (front-ports / outlets) first so a rear/power isn't PROTECTed.
    const del = [
      ["front-ports", "front-port-templates"], ["power-outlets", "power-outlet-templates"],
      ["interfaces", "interface-templates"], ["console-ports", "console-port-templates"],
      ["console-server-ports", "console-server-port-templates"],
      ["rear-ports", "rear-port-templates"], ["power-ports", "power-port-templates"],
    ];
    let removed = 0;
    for (const [comp, tmplEp] of del) {
      const [tmpls, existing] = await Promise.all([
        apiAll(`/dcim/${tmplEp}/?device_type_id=${dtId}`),
        apiAll(`/dcim/${comp}/?device_id=${devId}`),
      ]);
      const names = new Set(tmpls.map(t => t.name));
      const nums = new Set(tmpls.map(t => _pn(t.name)).filter(x => x != null));
      for (const c of existing) {
        if (c.cable || c.wireless_link) continue;                  // keep occupied
        if (names.has(c.name) || nums.has(_pn(c.name))) continue;  // in the model → keep
        try { await api(`/dcim/${comp}/${c.id}/`, "DELETE"); removed++; } catch (_) {}
      }
    }
    return { added, removed, warnings };
  }

  // ── Stack (VirtualChassis) ────────────────────────────────────────────────
  // A switch stack is modelled as a NetBox VirtualChassis: separate physical
  // switches grouped, each at a vc_position, one the master. It pulls no cables,
  // so the whole UI lives in the passport (this block) + a stack passport
  // (showStack), not on the canvas. Members are picked from lists — no wires.

  // Next free vc_position among the given members (1-based).
  _nextPos(members) {
    return (members || []).reduce((mx, m) => Math.max(mx, m.vc_position || 0), 0) + 1;
  }
  // Base name without the "-N"/"/N" member suffix — the default stack name.
  _stackBase(name) {
    return String(name).replace(/[-/]\s*\d+\s*$/, "").trim() || String(name);
  }
  // Switches in the loaded scope that may be added to a stack: drop members
  // already in THIS stack and obvious non-switches (panels/sockets/PDU/power).
  // state.devices carries virtual_chassis from the graph endpoint.
  _scopeSwitches(excludeVcId) {
    const skip = /пач|panel|розет|socket|pdu|щит|power|ибп|ups|провайдер|provider/i;
    return (state.devices || [])
      .filter(d => !(d.virtual_chassis && d.virtual_chassis.id === excludeVcId))
      .filter(d => !skip.test((d.role && d.role.name) || ""))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  // "Стек" block in the device passport (before "Соединения").
  _renderStackBlock(panel, dev, edit) {
    const vc = dev.virtual_chassis;   // REST brief {id,name,master} or null
    panel.appendChild(mk("h4", { text: "Стек" }));
    if (!vc) {
      panel.appendChild(mk("div", { className: "placeholder",
        text: edit ? "не в стеке — создай новый или добавь в существующий" : "не входит в стек" }));
      if (edit) {
        const row = mk("div", { className: "stack-acts" });
        row.appendChild(mk("button", { className: "stack-btn",
          html: `<i class="mdi mdi-layers-plus"></i> Создать стек`,
          on: { click: () => this._stackCreate(dev) } }));
        row.appendChild(mk("button", { className: "stack-btn",
          html: `<i class="mdi mdi-layers-triple"></i> В существующий`,
          on: { click: () => this._stackJoinExisting(dev) } }));
        panel.appendChild(row);
      }
      return;
    }
    const masterId = vc.master && (vc.master.id || vc.master);
    const line = mk("div", { className: "stack-cur",
      html: `<span class="ld-dot" style="background:var(--stack)"></span>` +
        `<span class="ld-name">${vc.name}</span>` +
        `<span class="ld-mut">поз. ${dev.vc_position ?? "—"}${masterId === dev.id ? " · ★ мастер" : ""}</span>` });
    line.addEventListener("click", () => { this.app.schema._highlightStack(vc.id); this.showStack(vc, dev); });
    panel.appendChild(line);
    // The line above already opens the stack; in edit mode just offer detach.
    if (edit) {
      const row = mk("div", { className: "stack-acts" });
      row.appendChild(mk("button", { className: "stack-btn danger",
        html: `<i class="mdi mdi-close"></i> Убрать из стека`,
        on: { click: () => this._stackDetachOne(dev) } }));
      panel.appendChild(row);
    }
  }

  // Stack passport: members by position (master ★), each clickable → its device.
  // Opened from the node badge or the passport block. Highlights members on the
  // canvas. Fetches the VC + its members fresh (accurate after edits/reload).
  async showStack(vc, fromDev) {
    this.current = null; this.currentPanel = null; this.currentStack = vc;
    const el = $("#detail");
    el.innerHTML = this._detailHead(`Стек «${vc.name || ""}»`, "загружаю…");
    const [vcFull, members] = await Promise.all([
      api("/dcim/virtual-chassis/" + vc.id + "/").catch(() => null),
      apiAll("/dcim/devices/?virtual_chassis_id=" + vc.id).catch(() => []),
    ]);
    const name = (vcFull && vcFull.name) || vc.name || "";
    const masterId = vcFull && vcFull.master && (vcFull.master.id || vcFull.master);
    vc = { id: vc.id, name, master: masterId };
    this.currentStack = vc;
    if (this.app.schema && this.app.schema._highlightStack) this.app.schema._highlightStack(vc.id);
    const edit = this._editable();
    el.innerHTML = this._detailHead(`Стек «${name}»`, `${members.length} свич(ей)`);
    Mode.syncButtons("detail");
    if (edit) {
      const pen = mk("button", { className: "head-edit", title: "Переименовать стек",
        html: `<i class="mdi mdi-pencil"></i>`, on: { click: () => this._stackRename(vc) } });
      el.querySelector(".detail-head h2").appendChild(pen);
    }
    el.appendChild(mk("h4", { text: "Участники (" + members.length + ")" }));
    if (!members.length)
      el.appendChild(mk("div", { className: "placeholder", text: "в стеке нет свичей" }));
    const sorted = members.slice().sort((a, b) => (a.vc_position ?? 1e9) - (b.vc_position ?? 1e9));
    for (const m of sorted) {
      const color = (state.roles[m.role && m.role.id] || {}).color || "607d8b";
      const isMaster = m.id === masterId;
      const r = mk("div", { className: "loc-dev",
        html: `<span class="stack-pos">${m.vc_position ?? "—"}</span>` +
          `<span class="ld-dot" style="background:#${color}"></span>` +
          `<span class="ld-name">${m.name}</span>` +
          `<span class="ld-mut">${isMaster ? "★ мастер" : ""}</span>` });
      r.addEventListener("click", () => this.show(m));
      if (edit) {
        const acts = mk("div", { className: "stack-mem-acts" });
        if (!isMaster) acts.appendChild(mk("button", { title: "Сделать мастером",
          html: `<i class="mdi mdi-star"></i>`, on: { click: async e => {
            e.stopPropagation();
            try {
              await api("/dcim/virtual-chassis/" + vc.id + "/", "PATCH", { master: m.id });
              setStatus("мастер стека: " + m.name, "ok");
              await this.app.tree.reload(); this.showStack(vc);
            } catch (err) { setStatus("не удалось назначить мастера: " + err.message, "err"); } } } }));
        acts.appendChild(mk("button", { className: "danger", title: "Убрать из стека",
          html: `<i class="mdi mdi-close"></i>`, on: { click: e => {
            e.stopPropagation(); this._stackRemoveMember(vc, m); } } }));
        r.appendChild(acts);
      }
      el.appendChild(r);
    }
    if (edit) {
      const row = mk("div", { className: "stack-acts" });
      row.appendChild(mk("button", { className: "stack-btn",
        html: `<i class="mdi mdi-link"></i> Добавить существующий`,
        on: { click: () => this._stackAddMember(vc) } }));
      row.appendChild(mk("button", { className: "stack-btn danger",
        html: `<i class="mdi mdi-delete"></i> Расформировать`,
        on: { click: () => this._stackDisband(vc, members) } }));
      el.appendChild(row);
    }
  }

  // Create a new stack with this switch as the master at position 1.
  _stackCreate(dev) {
    this.openModal("Создать стек", "Мастер: " + dev.name,
      [{ id: "name", label: "Название стека", value: this._stackBase(dev.name) },
       { id: "pos", label: "Позиция этого свича", value: "1" }],
      async v => {
        if (!v.name) throw new Error("укажи название стека");
        const vc = await api("/dcim/virtual-chassis/", "POST", { name: v.name });
        await api("/dcim/devices/" + dev.id + "/", "PATCH",
          { virtual_chassis: vc.id, vc_position: v.pos ? +v.pos : 1 });
        await api("/dcim/virtual-chassis/" + vc.id + "/", "PATCH", { master: dev.id });
        setStatus("создан стек «" + v.name + "»", "ok");
        await this.app.tree.reload();
        this.showStack({ id: vc.id, name: v.name, master: dev.id });
      }, "Создать");
  }

  // Add this switch to an already-existing stack (picked from a list).
  async _stackJoinExisting(dev) {
    let vcs = [];
    try { vcs = await apiAll("/dcim/virtual-chassis/"); } catch (_) {}
    if (!vcs.length) { setStatus("готовых стеков нет — создай новый", "err"); return; }
    this.openModal("Добавить в стек", dev.name,
      [{ id: "vc", label: "Стек", type: "select",
         options: vcs.map(v => ({ value: v.id, label: v.name + " · " + (v.member_count ?? "?") + " свич." })) },
       { id: "pos", label: "Позиция (пусто — авто)", placeholder: "авто" }],
      async v => {
        const vcId = +v.vc;
        let pos = v.pos ? +v.pos : null;
        if (pos == null) pos = this._nextPos(await apiAll("/dcim/devices/?virtual_chassis_id=" + vcId));
        await api("/dcim/devices/" + dev.id + "/", "PATCH", { virtual_chassis: vcId, vc_position: pos });
        setStatus("свич добавлен в стек", "ok");
        await this.app.tree.reload();
        const vc = vcs.find(x => x.id === vcId) || { id: vcId, name: "" };
        this.showStack({ id: vcId, name: vc.name });
      }, "Добавить");
  }

  // Add another scope switch into an open stack, at a chosen/next position.
  async _stackAddMember(vc) {
    const cands = this._scopeSwitches(vc.id);
    if (!cands.length) { setStatus("нет подходящих свичей в текущей области", "err"); return; }
    const members = await apiAll("/dcim/devices/?virtual_chassis_id=" + vc.id).catch(() => []);
    const nextPos = this._nextPos(members);
    this.openModal("Добавить свич в стек «" + vc.name + "»", "",
      [{ id: "dev", label: "Свич", type: "select",
         options: cands.map(d => ({ value: d.id,
           label: d.name + (d.role && d.role.name ? " · " + d.role.name : "")
             + (d.virtual_chassis ? " · (в др. стеке)" : "") })) },
       { id: "pos", label: "Позиция", value: String(nextPos) }],
      async v => {
        await api("/dcim/devices/" + (+v.dev) + "/", "PATCH",
          { virtual_chassis: vc.id, vc_position: v.pos ? +v.pos : nextPos });
        setStatus("свич добавлен в стек", "ok");
        await this.app.tree.reload();
        this.showStack(vc);
      }, "Добавить");
  }

  // Detach this switch from its stack (passport button) → re-show it stackless.
  async _stackDetachOne(dev) {
    const vc = dev.virtual_chassis;
    if (!vc) return;
    try {
      await this._detach(vc.id, dev.id);
      setStatus("свич убран из стека", "ok");
      await this.app.tree.reload();
      this.show({ id: dev.id });
    } catch (e) { setStatus("не удалось убрать из стека: " + e.message, "err"); }
  }

  // Detach a member from the open stack panel → re-show the stack (or clear it
  // if that was the last switch).
  async _stackRemoveMember(vc, member) {
    try {
      await this._detach(vc.id, member.id);
      setStatus("свич убран из стека: " + member.name, "ok");
      await this.app.tree.reload();
      const left = await apiAll("/dcim/devices/?virtual_chassis_id=" + vc.id).catch(() => []);
      if (left.length) this.showStack(vc); else this._stackGone();
    } catch (e) { setStatus("не удалось убрать: " + e.message, "err"); }
  }

  // Core detach: hand off master to the lowest-position peer (VC.master is
  // PROTECT), clear the device's membership, delete the VC if it becomes empty.
  async _detach(vcId, devId) {
    const [vc, members] = await Promise.all([
      api("/dcim/virtual-chassis/" + vcId + "/").catch(() => null),
      apiAll("/dcim/devices/?virtual_chassis_id=" + vcId).catch(() => []),
    ]);
    const others = members.filter(m => m.id !== devId);
    const masterId = vc && vc.master && (vc.master.id || vc.master);
    if (masterId === devId) {
      if (others.length) {
        const next = others.slice().sort((a, b) => (a.vc_position ?? 1e9) - (b.vc_position ?? 1e9))[0];
        await api("/dcim/virtual-chassis/" + vcId + "/", "PATCH", { master: next.id });
      } else {
        await api("/dcim/virtual-chassis/" + vcId + "/", "PATCH", { master: null });
      }
    }
    await api("/dcim/devices/" + devId + "/", "PATCH", { virtual_chassis: null, vc_position: null });
    if (!others.length) { try { await api("/dcim/virtual-chassis/" + vcId + "/", "DELETE"); } catch (_) {} }
  }

  // Disband: detach every member (clearing master first) and delete the VC.
  _stackDisband(vc, members) {
    this.openModal("Расформировать стек?",
      `Стек «${vc.name}» будет удалён, ${members.length} свич(ей) станут отдельными устройствами. Кабели не затрагиваются.`,
      [], async () => {
        try { await api("/dcim/virtual-chassis/" + vc.id + "/", "PATCH", { master: null }); } catch (_) {}
        for (const m of members) {
          try {
            await api("/dcim/devices/" + m.id + "/", "PATCH", { virtual_chassis: null, vc_position: null });
          } catch (_) {}
        }
        try { await api("/dcim/virtual-chassis/" + vc.id + "/", "DELETE"); } catch (_) {}
        setStatus("стек расформирован", "ok");
        await this.app.tree.reload();
        this._stackGone();
      }, "Расформировать");
  }

  // Rename the stack (pencil in the stack passport head).
  _stackRename(vc) {
    this.openModal("Переименовать стек", vc.name,
      [{ id: "name", label: "Название", value: vc.name }],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api("/dcim/virtual-chassis/" + vc.id + "/", "PATCH", { name: v.name });
        setStatus("стек переименован: " + v.name, "ok");
        await this.app.tree.reload();
        this.showStack({ ...vc, name: v.name });
      }, "Сохранить");
  }

  // The open stack no longer exists (disbanded / last member removed): clear the
  // passport + canvas highlight.
  _stackGone() {
    this.currentStack = null;
    if (this.app.schema && this.app.schema._highlightStack) this.app.schema._highlightStack(null);
    $("#detail").innerHTML = `<div class="placeholder">стек расформирован</div>`;
  }
}
