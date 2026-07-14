"use strict";
// CatalogUI — device-type catalog. Pick a Device Type; see how it lands as a node
// on the schema in TWO static views at once (Физический / Беспроводной). For OUR
// custom types (manufacturer «Схематика») it edits the stock ports: rows of
// kind+type+count → written as component templates on the type (safe — templates
// are not devices, no cables/IP touched). Create/delete own models too.
// The preview follows the editor rows LIVE. Propagation to existing devices is a
// separate step (see catalog.md).

import { state, PORT_KINDS, DOT, STEP, attachTip } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { shortPortName } from "./schema_util.js";
import { SOLUTIONS, SOLUTION_CATS } from "./solutions.js";

const OWN_MFR = "Схематика";

// PORT_KINDS.ep → device-type template endpoint (NetBox: singular + "-templates").
const TEMPLATE_EP = {
  "interfaces": "interface-templates",
  "front-ports": "front-port-templates",
  "rear-ports": "rear-port-templates",
  "console-ports": "console-port-templates",
  "console-server-ports": "console-server-port-templates",
  "power-ports": "power-port-templates",
  "power-outlets": "power-outlet-templates",
};
const TEP_TO_EP = Object.fromEntries(Object.entries(TEMPLATE_EP).map(([ep, tep]) => [tep, ep]));

// Editor palette — physical gnёзда a user can add + curated port types. `tep` =
// template endpoint. «wireless» writes interface templates with a radio type (so it
// shows in the Беспроводной view); «frontrear» creates rear+front pairs.
const PORT_PALETTE = [
  { kind: "interface", label: "Интерфейс", tep: "interface-templates", types: [
    ["virtual", "Виртуальный"], ["1000base-t", "1G медь (RJ45)"], ["2.5gbase-t", "2.5G медь"],
    ["10gbase-t", "10G медь"], ["1000base-x-sfp", "SFP 1G"], ["10gbase-x-sfpp", "SFP+ 10G"],
    ["25gbase-x-sfp28", "SFP28 25G"], ["40gbase-x-qsfpp", "QSFP+ 40G"] ] },
  { kind: "wireless", label: "Беспроводной (Wi-Fi)", tep: "interface-templates", types: [
    ["ieee802.11ac", "Wi-Fi (802.11ac)"], ["ieee802.11ax", "Wi-Fi 6 (802.11ax)"],
    ["ieee802.11n", "Wi-Fi (802.11n)"], ["other-wireless", "Другое радио"] ] },
  { kind: "frontrear", label: "Front/Rear (пара)", types: [ ["8p8c", "RJ45 (8P8C)"], ["lc", "LC"], ["sc", "SC"] ] },
  { kind: "console", label: "Console", tep: "console-port-templates", types: [ ["rj-45", "RJ45"], ["usb-a", "USB-A"], ["de-9", "DB-9"] ] },
  { kind: "console-server", label: "Console-server", tep: "console-server-port-templates", types: [ ["rj-45", "RJ45"], ["usb-a", "USB-A"], ["de-9", "DB-9"] ] },
  { kind: "power", label: "Power (ввод)", tep: "power-port-templates", types: [ ["iec-60320-c14", "IEC C14"], ["iec-60320-c20", "IEC C20"], ["nema-5-15p", "Schuko/NEMA"] ] },
  { kind: "outlet", label: "Розетка", tep: "power-outlet-templates", types: [ ["iec-60320-c13", "IEC C13"], ["iec-60320-c19", "IEC C19"] ] },
];
const PAL = Object.fromEntries(PORT_PALETTE.map(p => [p.kind, p]));
const isWlType = t => /^(ieee802\.11|other-wireless)/.test(t || "");

// Editor rows → desired templates per endpoint, names numbered sequentially per
// endpoint (so a later grow-propagation matches device ports by number). Pure.
export function buildDesired(rows) {
  const desired = { "interface-templates": [], "console-port-templates": [],
    "console-server-port-templates": [], "power-port-templates": [],
    "power-outlet-templates": [], "rear-port-templates": [], "front-port-templates": [] };
  const cnt = {}; const nextNum = kind => (cnt[kind] = (cnt[kind] || 0) + 1);
  // Numbering restarts at 1 PER KIND (interface / wireless / power / …). Wireless
  // shares the interface-templates endpoint, so it gets a «wlan» name to avoid a
  // name clash while still counting from 1 within its own view.
  for (const r of rows || []) {
    const n = Math.max(0, parseInt(r.count) || 0);
    if (r.kind === "frontrear") {
      for (let k = 0; k < n; k++) {
        const num = String(nextNum("frontrear"));
        desired["rear-port-templates"].push({ name: num, type: r.type });
        desired["front-port-templates"].push({ name: num, type: r.type, rearName: num });
      }
    } else if (r.kind === "wireless") {
      for (let k = 0; k < n; k++) desired["interface-templates"].push({ name: "wlan" + nextNum("wireless"), type: r.type });
    } else {
      const pal = PAL[r.kind]; if (!pal || !pal.tep) continue;
      for (let k = 0; k < n; k++) desired[pal.tep].push({ name: String(nextNum(r.kind)), type: r.type });
    }
  }
  return desired;
}

// Editor rows → {kind, items} groups (like a live device-type) for the preview.
// Reuses buildDesired, then wraps each endpoint's list in its PORT_KINDS group.
export function rowsToGroups(rows) {
  const desired = buildDesired(rows);
  const groups = [];
  for (const kind of PORT_KINDS) {
    const tep = TEMPLATE_EP[kind.ep];
    const items = (desired[tep] || []).map(t => ({
      id: "row:" + kind.ep + ":" + t.name, name: t.name,
      type: t.type ? { value: t.type, label: t.type } : null,
      cable: null, wireless_link: null, link_peers_type: null,
    }));
    if (items.length) groups.push({ kind, items });
  }
  groups.sort((a, b) => PORT_KINDS.indexOf(a.kind) - PORT_KINDS.indexOf(b.kind));
  return groups;
}

export class CatalogUI {
  constructor(app) {
    this.app = app;
    this.types = null;
    this.groupsCache = {};
    this.curId = null;
    this.q = "";
  }

  bind() {
    const btn = document.getElementById("catalogbtn");
    if (btn) btn.addEventListener("click", () => this.open());
  }

  async open() {
    this._ensureDom();
    this.el.classList.add("open");
    this.el.classList.remove("detail");   // mobile: start on the list, not a stale detail
    if (!this.types) { this._listHtml(`<div class="cat-hint">загружаю типы…</div>`); await this._loadTypes(); }
    this._renderList();
  }
  close() { if (this.el) this.el.classList.remove("open"); }
  // Mobile: slide back from the preview to the type list (desktop shows both, no-op look).
  _backToList() { if (this.el) this.el.classList.remove("detail"); }

  // ---- data ---------------------------------------------------------------
  async _loadTypes() {
    try {
      const t = await apiAll("/dcim/device-types/");
      const key = x => ((x.manufacturer && x.manufacturer.name) || "") + " " + (x.model || "");
      t.sort((a, b) => key(a).localeCompare(key(b)));
      this.types = t;
    } catch (e) { this.types = []; this._listHtml(`<div class="cat-hint cat-err">не загрузить типы: ${e.message}</div>`); }
  }

  // Device-type templates → {kind, items} groups. NB: filter is device_type_id
  // (with underscore) — devicetype_id is silently ignored by NetBox and returns ALL.
  async typeToGroups(dtId) {
    if (this.groupsCache[dtId]) return this.groupsCache[dtId];
    const kinds = PORT_KINDS.filter(k => TEMPLATE_EP[k.ep]);
    const lists = await Promise.all(kinds.map(k =>          // 7 template endpoints in parallel
      apiAll(`/dcim/${TEMPLATE_EP[k.ep]}/?device_type_id=${dtId}`).catch(() => [])));
    const groups = [];
    kinds.forEach((kind, i) => {
      const tmpls = lists[i];
      if (tmpls.length) groups.push({ kind, items: tmpls.map(t => ({
        id: "tpl:" + kind.ep + ":" + t.id, name: t.name, type: t.type || null,
        cable: null, wireless_link: null, link_peers_type: null,
      })) });
    });
    groups.sort((a, b) => PORT_KINDS.indexOf(a.kind) - PORT_KINDS.indexOf(b.kind));
    this.groupsCache[dtId] = groups;
    return groups;
  }

  _isEditable(type) { return !!(type && type.manufacturer && type.manufacturer.name === OWN_MFR); }
  _type(dtId) { return (this.types || []).find(t => t.id === dtId) || {}; }

  // ---- select / preview ---------------------------------------------------
  async _select(dtId) {
    this.curId = dtId;
    this.el.classList.add("detail");   // mobile: slide the list away, show the preview
    this._renderList();
    // Templates + device count in parallel (was a slow chain of sequential fetches).
    const [groups, countRes] = await Promise.all([
      this.typeToGroups(dtId).catch(() => []),
      api(`/dcim/devices/?device_type_id=${dtId}&limit=1`).catch(() => null),
    ]);
    if (this.curId !== dtId) return;
    this.usedCount = countRes ? (countRes.count ?? 0) : null;
    const applyBtn = this.el.querySelector(".ced-apply");
    if (applyBtn) applyBtn.textContent = "Применить ко всем" + (this.usedCount ? ` (${this.usedCount})` : "");
    const type = this._type(dtId);
    const editable = this._isEditable(type);
    this._toggleEdit(editable);
    if (editable) {
      let rows = this._typeToRows(groups);
      if (!rows.length) rows = this._solutionRows(type.model);   // seed unsaved custom types
      const box = this.el.querySelector(".ced-rows"); box.innerHTML = "";
      for (const r of rows) box.appendChild(this._rowEl(r));
      const st = this.el.querySelector(".ced-status"); st.textContent = ""; st.className = "ced-status";
      this._refresh();                       // preview from editor rows (live)
    } else {
      this._renderViews(type, groups);       // real type — straight from templates
      this._setMeta(groups);
    }
  }

  // Show/hide the editor, its footer (save) and the delete-trash for editable types.
  _toggleEdit(on) {
    for (const sel of [".cat-editor", ".cat-footer"]) {   // trash lives inside the footer
      const e = this.el.querySelector(sel); if (e) e.hidden = !on;
    }
  }

  // Re-render both views from the CURRENT editor rows (called on every edit).
  _refresh() {
    const groups = rowsToGroups(this._collectRows());
    this._renderViews(this._type(this.curId), groups);
    this._setMeta(groups);
  }

  _renderViews(type, groups) {
    this._renderNode(this.el.querySelector(".cat-stage.phys"), type, groups, false);
    this._renderNode(this.el.querySelector(".cat-stage.wl"), type, groups, true);
  }

  _setMeta(groups) {
    const meta = this.el.querySelector(".cat-meta");
    if (!meta) return;
    const ports = groups.length ? groups.map(g => `${g.kind.label}: ${g.items.length}`).join("  ·  ") : "портов нет";
    const used = this.usedCount == null ? "" :
      `<span class="cat-used" title="Сколько устройств используют эту модель">устройств с моделью: <b${this.usedCount ? ' class="cat-nz"' : ""}>${this.usedCount}</b></span>`;
    meta.innerHTML = `<span class="cat-ports">${ports}</span>${used}`;
  }

  // Status → modal footer AND the bright #reqspin loader (setStatus mirrors there),
  // so long operations stay readable even when the background is dimmed.
  _stat(msg, kind) {
    const s = this.el && this.el.querySelector(".ced-status");
    if (s) { s.textContent = msg; s.className = "ced-status" + (kind ? " ced-" + kind : ""); }
    setStatus(msg, kind === "err" ? "err" : kind === "ok" ? "ok" : "");
  }

  // One static node into a stage. net=false → physical view, net=true → wireless.
  _renderNode(stage, type, groups, net) {
    const dev = {
      id: -1, name: type.model || "—", _off: false, position: null, virtual_chassis: null,
      role: null, device_type: { id: type.id || -1, model: type.model || "", u_height: type.u_height || 1 },
    };
    state.cables = state.cables || []; state.devNodeIdx = state.devNodeIdx || {};
    state.devRack = state.devRack || {}; state.ipsByIface = state.ipsByIface || {};

    const P = this.app.schema._nodeParts(dev, groups, net, false);
    const { EDGE, top, topV, botLeftV, botRightV, nBotR, width } = P;
    stage.innerHTML = "";
    if (!(topV.length || botLeftV.length || botRightV.length)) {
      stage.innerHTML = `<div class="cat-hint">${net ? "нет беспроводных портов" : "нет портов"}</div>`;
      return;
    }
    const node = document.createElement("div");
    node.className = "node";
    node.style.width = width + "px";
    node.innerHTML = `<span class="nm">${type.model || "—"}</span>` +
      `<span class="mdl">${(type.manufacturer && type.manufacturer.name) || ""}${type.u_height ? " · " + type.u_height + "U" : ""}</span>`;
    if (net) {
      if (botLeftV.length) node.insertAdjacentHTML("beforeend", `<span class="edge-label b">Wireless</span>`);
    } else {
      if (topV.length) node.insertAdjacentHTML("beforeend", `<span class="edge-label t">${top.map(g => g.kind.label).join(" · ")}</span>`);
      if (botLeftV.length) node.insertAdjacentHTML("beforeend", `<span class="edge-label b">${botLeftV.map(x => x.g.kind.label).join(" · ")}</span>`);
      if (botRightV.length) node.insertAdjacentHTML("beforeend", `<span class="edge-label b r">${botRightV.map(x => x.g.kind.label).join(" · ")}</span>`);
    }
    for (const s of P.slots) this._dot(node, s.g, s.item, s.ordinal, s.isTop, s.leftPx);
    stage.appendChild(node);
    node.style.left = Math.max(6, (stage.clientWidth - width) / 2) + "px";
    node.style.top = Math.max(18, (stage.clientHeight - 64) / 2) + "px";
  }

  _dot(node, g, item, ordinal, isTop, leftPx) {
    const sch = this.app.schema;
    const isNet = sch._isNetPort(g.kind.otype, item);
    const isWl = g.kind.otype === "dcim.interface" && sch._isWirelessItem(item);
    const dot = document.createElement("div");
    dot.className = "port " + g.kind.cls + (isNet ? " p-net" : " p-phys") + (isWl ? " p-wl" : "");
    dot.textContent = shortPortName(item.name, ordinal);
    dot.style.left = leftPx + "px";
    dot.style[isTop ? "top" : "bottom"] = "-13px";
    attachTip(dot, () => `<div class="t-title">${item.name}</div>` +
      `<div class="t-line">${g.kind.label}${item.type && item.type.label ? " · " + item.type.label : ""}</div>`);
    node.appendChild(dot);
  }

  // ---- rows ---------------------------------------------------------------
  // Current templates → editor rows. Interfaces split into interface vs wireless.
  _typeToRows(groups) {
    const KIND = { "dcim.consoleport": "console", "dcim.consoleserverport": "console-server",
      "dcim.powerport": "power", "dcim.poweroutlet": "outlet" };
    const rows = [];
    for (const g of groups) {
      const o = g.kind.otype;
      if (o === "dcim.frontport") continue;              // counted via rear (pairs)
      if (o === "dcim.interface") {
        const ph = {}, wl = {};
        for (const it of g.items) { const t = (it.type && it.type.value) || "";
          const m = isWlType(t) ? wl : ph; m[t] = (m[t] || 0) + 1; }
        for (const [type, count] of Object.entries(ph)) rows.push({ kind: "interface", type, count });
        for (const [type, count] of Object.entries(wl)) rows.push({ kind: "wireless", type, count });
        continue;
      }
      const kind = o === "dcim.rearport" ? "frontrear" : KIND[o];
      if (!kind) continue;
      const by = {};
      for (const it of g.items) { const t = (it.type && it.type.value) || ""; by[t] = (by[t] || 0) + 1; }
      for (const [type, count] of Object.entries(by)) rows.push({ kind, type, count });
    }
    return rows;
  }

  // Seed for an unsaved custom type — the ports the model IS meant to have, from
  // solutions.js (matches how a device gets its ports on creation).
  _solutionRows(model) {
    if (!model) return [];
    let sol = null;
    for (const cat of SOLUTION_CATS)
      for (const it of (SOLUTIONS[cat].items || []))
        if (it.model && it.model.toLowerCase() === model.toLowerCase()) sol = it;
    if (!sol) return [];
    const KMAP = { poweroutlet: "outlet" };
    const rows = [];
    if (Array.isArray(sol.ports)) {
      for (const g of sol.ports) rows.push({ kind: KMAP[g.kind] || g.kind || "interface", type: g.type || "", count: g.count ?? 1 });
    } else if (sol.net) {
      rows.push({ kind: "interface", type: "1000base-t", count: sol.net });
    }
    if (sol.power) rows.push({ kind: "power", type: "iec-60320-c14", count: sol.power });
    return rows.filter(r => (r.count || 0) > 0);
  }

  _rowEl(row) {
    const el = document.createElement("div");
    el.className = "ced-row";
    const kindSel = document.createElement("select");
    kindSel.className = "ced-kind";
    for (const p of PORT_PALETTE) {
      const o = document.createElement("option"); o.value = p.kind; o.textContent = p.label;
      if (p.kind === row.kind) o.selected = true; kindSel.appendChild(o);
    }
    const typeSel = document.createElement("select"); typeSel.className = "ced-type";
    const fill = (kind, cur) => {
      typeSel.innerHTML = "";
      const pal = PAL[kind] || PORT_PALETTE[0];
      const types = pal.types.slice();
      if (cur && !types.some(([v]) => v === cur)) types.push([cur, cur]);
      for (const [v, lbl] of types) {
        const o = document.createElement("option"); o.value = v; o.textContent = lbl;
        if (v === cur) o.selected = true; typeSel.appendChild(o);
      }
    };
    fill(row.kind, row.type);
    kindSel.addEventListener("change", () => fill(kindSel.value, null));
    const cnt = document.createElement("input");
    cnt.className = "ced-count"; cnt.type = "number"; cnt.min = "0"; cnt.value = String(row.count ?? 1);
    const del = document.createElement("button"); del.className = "ced-del-row"; del.textContent = "✕"; del.title = "Убрать ряд";
    del.addEventListener("click", () => { el.remove(); this._refresh(); });
    el.append(kindSel, typeSel, cnt, del);
    return el;
  }

  _collectRows() {
    return [...this.el.querySelectorAll(".ced-row")].map(el => ({
      kind: el.querySelector(".ced-kind").value,
      type: el.querySelector(".ced-type").value,
      count: Math.max(0, parseInt(el.querySelector(".ced-count").value) || 0),
    })).filter(r => r.count > 0);
  }

  // Reconcile the type's templates to the editor rows. Safe: templates carry no
  // cables/IP. Dependents (front/outlet) deleted first; rear created before front.
  // Reconcile the type's templates to `desired`. Safe: templates carry no cables/IP.
  // Dependents (front/outlet) deleted first; rear created before front (FK).
  async _writeTemplates(dtId, desired) {
    const delOrder = ["front-port-templates", "power-outlet-templates", "interface-templates",
      "console-port-templates", "console-server-port-templates", "rear-port-templates", "power-port-templates"];
    for (const ep of delOrder)
      for (const t of await apiAll(`/dcim/${ep}/?device_type_id=${dtId}`)) await api(`/dcim/${ep}/${t.id}/`, "DELETE");
    const rearId = {};
    for (const t of desired["rear-port-templates"]) {
      const c = await api("/dcim/rear-port-templates/", "POST", { device_type: dtId, name: t.name, type: t.type, positions: 1 });
      rearId[t.name] = c.id;
    }
    for (const ep of ["interface-templates", "console-port-templates",
      "console-server-port-templates", "power-port-templates", "power-outlet-templates"])
      for (const t of desired[ep]) await api(`/dcim/${ep}/`, "POST", { device_type: dtId, name: t.name, type: t.type });
    // NetBox 4.6: FrontPortTemplate maps to its rear via a writable `rear_ports` array
    // (PortMapping), NOT a `rear_port` FK — otherwise the front template isn't created.
    for (const t of desired["front-port-templates"])
      await api("/dcim/front-port-templates/", "POST",
        { device_type: dtId, name: t.name, type: t.type,
          rear_ports: [{ position: 1, rear_port: rearId[t.rearName], rear_port_position: 1 }] });
    delete this.groupsCache[dtId];
  }

  async _saveToType(dtId) {
    if (dtId == null) return;
    const type = this._type(dtId);
    if (!this._isEditable(type)) return;
    const saveBtn = this.el.querySelector(".ced-save");
    saveBtn.disabled = true; this._stat("сохраняю порты в тип…");
    try {
      await this._writeTemplates(dtId, buildDesired(this._collectRows()));
      this._stat("сохранено в тип (устройства не тронуты). «Применить ко всем» — дозавести порты на устройствах.", "ok");
    } catch (e) {
      this._stat("ошибка сохранения: " + e.message, "err");
    } finally { saveBtn.disabled = false; }
  }

  // Step 2: write the type's ports, then GROW every device of the type to that set —
  // add only MISSING ports (existing/cabled ones untouched). Fills sparse imported
  // devices so their free ports show up on the schema.
  _applyToAll(dtId) {
    if (dtId == null) return;
    const type = this._type(dtId);
    if (!this._isEditable(type)) return;
    const n = this.usedCount || 0;
    this.app.openModal("Применить ко всем устройствам?",
      `Порты модели «${type.model}» запишутся в тип и добавятся на ВСЕ устройства этого типа (${n}). Добавляются только НЕДОСТАЮЩИЕ порты — существующие, их кабели и IP не трогаются.`,
      [], async () => {
        const applyBtn = this.el.querySelector(".ced-apply"), saveBtn = this.el.querySelector(".ced-save");
        applyBtn.disabled = saveBtn.disabled = true;
        this._stat("сохраняю тип…");
        try {
          await this._writeTemplates(dtId, buildDesired(this._collectRows()));
          const res = await this.app.device.growDevicesToType(dtId,
            (i, tot) => this._stat(`добавляю порты: устройство ${i}/${tot}…`));
          this._stat(`готово: устройств ${res.devices}, добавлено портов ${res.created}. Обнови схему.`, "ok");
          try { await this.app.tree.reload(); } catch (_) {}
        } catch (e) {
          this._stat("ошибка: " + e.message, "err");
        } finally { applyBtn.disabled = saveBtn.disabled = false; }
      }, "Применить");
  }

  async _mfrId() {
    const found = await apiAll(`/dcim/manufacturers/?name=${encodeURIComponent(OWN_MFR)}`);
    if (found.length) return found[0].id;
    return (await api("/dcim/manufacturers/", "POST", { name: OWN_MFR, slug: "schematic" })).id;
  }

  // Global «↦ По роли»: pick a role + a model → set that model on EVERY device of the
  // role and grow its ports (add-only). For a hardware swap where cabling stayed.
  async _applyByRole() {
    let roles = [];
    try { roles = await apiAll("/dcim/device-roles/"); } catch (_) {}
    if (!this.types) await this._loadTypes();
    const types = this.types || [];
    if (!roles.length || !types.length) { setStatus("нет ролей или типов устройств", "err"); return; }
    this.app.openModal("Применить модель по роли",
      "Всем устройствам роли назначится эта модель, а порты приведутся к ней: недостающие добавятся, а СВОБОДНЫЕ лишние (которых нет в модели) удалятся. Занятые порты (с кабелем/линком) не трогаются — отвяжите их сначала, если нужно убрать.",
      [
        { id: "role", label: "Роль устройств", type: "select", options: roles.map(r => ({ value: r.id, label: r.name })) },
        { id: "model", label: "Модель (тип)", type: "select",
          options: types.map(t => ({ value: t.id, label: ((t.manufacturer && t.manufacturer.name) ? t.manufacturer.name + " · " : "") + (t.display || t.model) })) },
      ],
      async v => {
        const roleId = +v.role, dtId = +v.model;
        if (!roleId || !dtId) throw new Error("выбери роль и модель");
        setStatus("применяю модель по роли…");
        const devs = await apiAll(`/dcim/devices/?role_id=${roleId}`);
        let added = 0, removed = 0, changed = 0;
        for (const d of devs) {
          if (!d.device_type || d.device_type.id !== dtId) {
            await api("/dcim/devices/" + d.id + "/", "PATCH", { device_type: dtId }); changed++;
          }
          // Reconcile (not grow-only): add missing + delete FREE ports not in the
          // model. So returning a device to its own model actually fixes wrong ports
          // (e.g. a camera left with a patch panel's 24 rear ports).
          const r = await this.app.device.applyModel(d.id, dtId);
          added += r.added; removed += r.removed;
        }
        this.groupsCache = {};
        setStatus(`по роли применено: устройств ${devs.length}, сменили тип ${changed}, +${added} / −${removed} портов`, "ok");
        await this.app.tree.reload();
      }, "Применить");
  }

  _createModel() {
    this.app.openModal("Новая модель устройства",
      "Тип под производителем «Схематика». Порты добавишь ниже, в окне превью.",
      [ { id: "model", label: "Название модели", value: "" }, { id: "u", label: "Высота, U", value: "1" } ],
      async v => {
        const model = (v.model || "").trim();
        if (!model) throw new Error("укажи название модели");
        const mfrId = await this._mfrId();
        const slug = model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || ("model-" + Date.now());
        const dt = await api("/dcim/device-types/", "POST", { manufacturer: mfrId, model, slug, u_height: parseInt(v.u) || 1 });
        this.types = null; await this._loadTypes();
        this.curId = dt.id; this._renderList(); await this._select(dt.id);
        setStatus("создана модель: " + model, "ok");
      }, "Создать");
  }

  _deleteModel(dtId) {
    if (dtId == null) return;
    const type = this._type(dtId);
    if (!this._isEditable(type)) return;
    this.app.openModal("Удалить модель?",
      `«${type.model}» будет удалена. Если ей уже пользуются устройства — NetBox не даст удалить (сначала убери устройства).`,
      [], async () => {
        try { await api(`/dcim/device-types/${dtId}/`, "DELETE"); }
        catch (e) { throw new Error("не удалить (возможно, есть устройства этого типа): " + e.message); }
        delete this.groupsCache[dtId];
        this.types = null; await this._loadTypes(); this.curId = null; this._renderList();
        this._backToList();   // mobile: return to the list (the deleted detail is gone)
        this.el.querySelector(".cat-stage.phys").innerHTML = `<div class="cat-hint">модель удалена</div>`;
        this.el.querySelector(".cat-stage.wl").innerHTML = "";
        this._toggleEdit(false);
        this.el.querySelector(".cat-meta").textContent = "";
        setStatus("модель удалена", "ok");
      }, "Удалить");
  }

  // ---- list ---------------------------------------------------------------
  _listHtml(html) { const l = this.el && this.el.querySelector(".cat-list"); if (l) l.innerHTML = html; }

  _renderList() {
    const list = this.el.querySelector(".cat-list");
    if (!list) return;
    const q = this.q.trim().toLowerCase();
    const match = (this.types || []).filter(t => {
      if (!q) return true;
      const mfr = (t.manufacturer && t.manufacturer.name) || "";
      return (t.model + " " + mfr).toLowerCase().includes(q);
    });
    const byMfr = {};
    for (const t of match) { const m = (t.manufacturer && t.manufacturer.name) || "—"; (byMfr[m] = byMfr[m] || []).push(t); }
    const H = [];
    for (const mfr of Object.keys(byMfr).sort((a, b) => a.localeCompare(b))) {
      const own = mfr === OWN_MFR;
      H.push(`<div class="cat-mfr">${mfr}${own ? ' <span class="cat-own">правится</span>' : ""}</div>`);
      for (const t of byMfr[mfr])
        H.push(`<button class="cat-row${t.id === this.curId ? " active" : ""}" data-id="${t.id}">` +
          `<span class="cat-model">${t.display || t.model}</span>` +
          `<span class="cat-u">${t.u_height ? t.u_height + "U" : ""}</span></button>`);
    }
    list.innerHTML = H.join("") ||
      `<div class="cat-hint">${(this.types && this.types.length) ? "ничего не найдено" : "типов пока нет — создай «+ Модель»"}</div>`;
    list.querySelectorAll(".cat-row").forEach(b => b.addEventListener("click", () => this._select(+b.dataset.id)));
  }

  // ---- DOM scaffold -------------------------------------------------------
  _ensureDom() {
    if (this.el) return;
    const el = document.createElement("div");
    el.id = "catalog-bg";
    el.className = "cat-bg";
    el.innerHTML = `
      <div class="cat-modal">
        <div class="cat-head">
          <button class="cat-back" title="Назад к списку" aria-label="Назад к списку"><i class="mdi mdi-arrow-left"></i></button>
          <span class="cat-title"><i class="mdi mdi-view-grid-outline"></i> Каталог устройств</span>
          <button class="cat-add" title="Создать свою модель" aria-label="Создать свою модель"><i class="mdi mdi-plus"></i></button>
          <button class="cat-byrole" title="Применить модель всем устройствам выбранной роли">↦ По роли</button>
          <button class="cat-close" title="Закрыть (Esc)">✕</button>
        </div>
        <div class="cat-body">
          <div class="cat-side">
            <input class="cat-search" type="text" placeholder="поиск: модель или производитель…">
            <div class="cat-list"></div>
          </div>
          <div class="cat-preview">
            <div class="cat-views">
              <div class="cat-view"><div class="cat-view-lbl">Физический</div><div class="cat-stage phys"><div class="cat-hint">← выбери тип или «+ Модель»</div></div></div>
              <div class="cat-view"><div class="cat-view-lbl">Беспроводной</div><div class="cat-stage wl"></div></div>
            </div>
            <div class="cat-meta"></div>
            <div class="cat-editor" hidden>
              <div class="ced-head">Порты модели <span class="ced-hint">— количество на вид/тип; «Сохранить в тип» пишет шаблоны (устройства не трогаются)</span></div>
              <div class="ced-rows"></div>
              <button class="ced-addrow">+ ряд</button>
            </div>
            <div class="cat-footer" hidden>
              <button class="ced-del" title="Удалить модель"><i class="mdi mdi-trash-can-outline"></i></button>
              <div class="ced-status"></div>
              <button class="ced-apply">Применить ко всем</button>
              <button class="ced-save">Сохранить в тип</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector(".cat-close").addEventListener("click", () => this.close());
    el.querySelector(".cat-back").addEventListener("click", () => this._backToList());
    el.addEventListener("mousedown", e => { if (e.target === el) this.close(); });
    el.querySelector(".cat-search").addEventListener("input", e => { this.q = e.target.value; this._renderList(); });
    el.querySelector(".cat-add").addEventListener("click", () => this._createModel());
    el.querySelector(".cat-byrole").addEventListener("click", () => this._applyByRole());
    const rows = el.querySelector(".ced-rows");
    rows.addEventListener("input", () => this._refresh());
    rows.addEventListener("change", () => this._refresh());
    el.querySelector(".ced-addrow").addEventListener("click", () => {
      rows.appendChild(this._rowEl({ kind: "interface", type: "1000base-t", count: 1 })); this._refresh();
    });
    el.querySelector(".ced-save").addEventListener("click", () => this._saveToType(this.curId));
    el.querySelector(".ced-apply").addEventListener("click", () => this._applyToAll(this.curId));
    el.querySelector(".ced-del").addEventListener("click", () => this._deleteModel(this.curId));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && this.el.classList.contains("open")) this.close(); });
  }
}
