"use strict";
// ImportUI: Excel «Patchen/Unpatchen» import modal → devices + cables.
// Upload → preview (what gets created; DB untouched) → arrange racks (set size,
// move switches between units) + see the tree → pick site → «Импортировать»
// (POST commit to /plugins/schematic/import/ with the chosen placement).

import { $, state } from "./core.js";
import { apiAll } from "./api.js";

function csrf() {
  const el = document.querySelector("input[name=csrfmiddlewaretoken]");
  return el ? el.value : "";
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const URL_IMPORT = () => state.base + "/plugins/schematic/import/";

export class ImportUI {
  constructor(app) {
    this.app = app; this.model = null; this.overrides = {}; this.cfgSel = null;
    // conflict resolution for devices that already exist in the target site.
    // conflictChoices: {name: "keep"|"update"} — per-device «Без замены / Заменить».
    this.conflicts = []; this.conflictCols = []; this.conflictChoices = {};
    this.conflictsOpen = false; this.occupancy = {}; this.existingNames = new Set();
  }

  bind() {
    const btn = $("#importbtn");
    if (btn) btn.addEventListener("click", () => this.open());
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("#imp-close", "click", () => this.close());
    on("#imp-cancel", "click", () => this.close());
    on("#imp-file", "change", () => { const f = this._file(); this._dropName(f && f.name); this._preview(); });
    on("#imp-mode", "change", () => { if (this._file()) this._preview(); });
    on("#imp-commit", "click", () => this._commit());
    on("#imp-site", "change", () => {
      const n = $("#imp-site-new"); if (n) n.hidden = $("#imp-site").value !== "__new__";
      // Conflicts/occupancy depend on the target site — re-scan when it changes.
      if (this._file()) this._preview(); else this._validate();
    });
    // «Посмотреть» toggles the full-width conflicts table under the columns.
    on("#imp-preview", "click", e => {
      if (e.target.closest(".imp-conf-toggle")) { this.conflictsOpen = !this.conflictsOpen; this._syncConfPanel(); }
    });
    // Per-device «Без замены / Заменить» buttons inside that table.
    on("#imp-conf-full", "click", e => {
      const b = e.target.closest(".imp-conf-btn");
      if (b) { this.conflictChoices[b.dataset.conf] = b.dataset.mode; this._renderConflictTable(); }
    });
    on("#imp-loc", "input", () => this._validate());
    on("#imp-site-new", "input", () => this._validate());
    // rack editor (delegated — grid/tabs are re-rendered)
    on("#imp-rack-size", "input", () => this._onSize());
    on("#imp-rack-tabs", "click", e => {
      const t = e.target.closest(".imp-rtab"); if (!t) return;
      this.model.active = +t.dataset.i; this.model.sel = null; this._renderRacks();
    });
    on("#imp-rack-grid", "click", e => {
      const dv = e.target.closest(".imp-udev"); const free = e.target.closest(".imp-ufree");
      if (dv) this._pick(dv.dataset.name);
      else if (free) this._moveTo(+free.dataset.u);
    });
    const md = $("#import-modal");
    if (md) md.addEventListener("click", e => {
      const acc = e.target.closest(".imp-acc"); if (acc) this._acc(acc.dataset.sec);
    });
    // tree: select a device (shows «Настроить»), then open its config form
    on("#imp-tree", "click", e => {
      if (e.target.closest(".imp-cfg-btn")) { this._openCfg(this.cfgSel); return; }
      const tn = e.target.closest(".imp-tn[data-dev]");
      if (tn) { this.cfgSel = this.cfgSel === tn.dataset.dev ? null : tn.dataset.dev; this._closeCfg(); this._renderTree(); }
    });
    on("#imp-cfg", "click", e => {
      if (e.target.closest(".imp-cfg-save")) this._saveCfg();
      else if (e.target.closest(".imp-cfg-cancel")) this._closeCfg();
    });
    // file drag-and-drop onto the zone
    const drop = $("#imp-drop");
    if (drop) {
      ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
      ["dragleave", "dragend"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("drag")));
      drop.addEventListener("drop", e => {
        e.preventDefault(); drop.classList.remove("drag");
        const dt = e.dataTransfer, f = dt && dt.files && dt.files[0];
        if (!f) return;
        const fi = $("#imp-file");
        if (fi) { try { fi.files = dt.files; } catch (_) {} }
        this._dropName(f.name); this._preview();
      });
    }
    const bg = $("#import-bg");
    if (bg) bg.addEventListener("mousedown", e => { if (e.target === bg) this.close(); });
  }

  _dropName(name) { const t = $("#imp-dropTxt"); if (t) t.textContent = name || "Перетащи файл сюда или нажми для выбора"; }
  _file() { const f = $("#imp-file"); return f && f.files[0]; }
  _status(t) { const s = $("#imp-status"); if (s) s.textContent = t || ""; }

  async open() {
    const bg = $("#import-bg");
    if (!bg) return;
    this._reset();
    bg.classList.add("open");
    // Always reload the reference lists on open — a site/model/role created or
    // DELETED elsewhere must be reflected here at once (no stale cache).
    const sel = $("#imp-site");
    if (sel) {
      try {
        const sites = await apiAll("/dcim/sites/");
        sel.innerHTML = sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")
          + `<option value="__new__">Новая площадка…</option>`;
      } catch (e) { /* leave empty */ }
    }
    try { this.dtypes = await apiAll("/dcim/device-types/"); } catch (e) { this.dtypes = []; }
    try { this.droles = await apiAll("/dcim/device-roles/"); } catch (e) { this.droles = []; }
    // Don't inherit a stale «Новая площадка» selection (the field would be hidden):
    // always reopen on a real site with the new-site input synced.
    if (sel) sel.selectedIndex = 0;
    const sn = $("#imp-site-new"); if (sn) sn.hidden = !sel || sel.value !== "__new__";
    this._validate();
  }

  close() { const bg = $("#import-bg"); if (bg) bg.classList.remove("open"); }

  _reset() {
    const f = $("#imp-file"); if (f) f.value = "";
    const p = $("#imp-preview"); if (p) p.innerHTML = "";
    const pl = $("#imp-place"); if (pl) pl.hidden = true;
    const accPl = $('#import-modal .imp-acc[data-sec="place"]'); if (accPl) accPl.hidden = true;
    const md = $("#import-modal"); if (md) md.classList.remove("wide", "acc-place");
    this.model = null; this._committing = false; this._total = 0;
    this.overrides = {}; this.cfgSel = null;
    this.conflicts = []; this.conflictCols = []; this.conflictChoices = {};
    this.conflictsOpen = false; this.occupancy = {}; this.existingNames = new Set();
    const cf = $("#imp-conf-full"); if (cf) { cf.hidden = true; cf.innerHTML = ""; }
    const cfg = $("#imp-cfg"); if (cfg) { cfg.hidden = true; cfg.innerHTML = ""; }
    const c = $("#imp-commit"); if (c) c.disabled = true;
    const sp = $("#imp-spin"); if (sp) sp.hidden = true;
    this._dropName("");
    const mode = $("#imp-mode"); if (mode) mode.selectedIndex = 0;
    const sn = $("#imp-site-new"); if (sn) { sn.hidden = true; sn.value = ""; }
    const lo = $("#imp-loc"); if (lo) lo.value = "";
    this._syncAcc();
    this._status("");
  }

  // Mobile/tablet accordion: the top (file + preview) and the placement editor
  // collapse each other. Desktop shows both (CSS ignores the class).
  _acc(sec) {
    const md = $("#import-modal"); if (!md) return;
    md.classList.toggle("acc-place", sec === "place");
    this._syncAcc();
  }
  _syncAcc() {
    const md = $("#import-modal"); if (!md) return;
    const place = md.classList.contains("acc-place");
    const set = (sec, open) => {
      const b = md.querySelector(`.imp-acc[data-sec="${sec}"]`);
      if (!b) return;
      b.setAttribute("aria-expanded", String(open));
      const i = b.querySelector(".mdi");
      if (i) i.className = "mdi mdi-chevron-" + (open ? "up" : "down");
    };
    set("top", !place); set("place", place);
  }

  async _post(action) {
    const fd = new FormData();
    fd.append("file", this._file());
    fd.append("action", action);
    fd.append("sw_mode", ($("#imp-mode") || {}).value || "neu_else_alt");
    // Site goes with BOTH actions: preview needs it to scan existing devices
    // (conflicts + rack occupancy) in that site; commit needs it to create.
    const siteSel = ($("#imp-site") || {}).value || "";
    const isNew = siteSel === "__new__";
    fd.append("site_id", isNew ? "" : siteSel);
    fd.append("site_new", isNew ? (($("#imp-site-new") || {}).value || "").trim() : "");
    if (action === "commit") {
      fd.append("loc_name", (($("#imp-loc") || {}).value || "").trim());
      fd.append("placements", JSON.stringify(this._placements()));
      fd.append("rack_sizes", JSON.stringify(this._rackSizes()));
      fd.append("overrides", JSON.stringify(this.overrides));
      fd.append("conflict_modes", JSON.stringify(this.conflictChoices));
    }
    const r = await fetch(URL_IMPORT(), {
      method: "POST", credentials: "same-origin",
      headers: { "X-CSRFToken": csrf() }, body: fd,
    });
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (!r.ok || d.error) throw new Error(d.error || ("HTTP " + r.status));
    return d;
  }

  async _preview() {
    if (!this._file()) { this._status("выбери файл .xlsx"); return; }
    this._status("разбираю файл…");
    const c = $("#imp-commit"); if (c) c.disabled = true;
    try {
      this._renderPreview(await this._post("preview"));
    } catch (e) { this._status("ошибка: " + e.message); }
  }

  _renderPreview(d) {
    this._total = d.total || 0;
    const s = d.summary || {};
    // Existing-device state for this site (empty until a site is picked).
    this.occupancy = d.occupancy || {};
    this.conflicts = d.conflicts || [];
    this.conflictCols = d.conflict_cols || [];
    this.existingNames = new Set(this.conflicts.map(c => c.name));
    this.conflictChoices = {};        // fresh scan → every device «Без замены» by default
    this.conflictsOpen = false;
    const warns = d.warnings || [];
    const warnHtml = warns.length
      ? `<div class="imp-warns"><div class="imp-warn-h"><i class="mdi mdi-alert-outline"></i> Несостыковки (${warns.length}) — импорт не блокируют:</div>` +
        warns.map(w => `<div class="imp-warn">строка ${esc(w.row)}: ${esc(w.msg)}</div>`).join("") + `</div>`
      : "";
    // «Будет создано» first, then a collapsed conflicts bar; the full table opens
    // below the columns (#imp-conf-full). Per-row detail lives in the tree beside.
    const pv = $("#imp-preview");
    if (pv) pv.innerHTML = warnHtml +
      `<div class="imp-sum">Будет создано <span class="imp-mut">(существующее не дублируется)</span>:</div>` +
      `<div class="imp-chips">` +
      `<span>связей <b>${this._total}</b></span><span>локаций <b>${s.locations || 0}</b></span>` +
      `<span>стоек <b>${s.racks || 0}</b></span><span>розеток <b>${s.sockets || 0}</b></span>` +
      `<span>панелей <b>${s.panels || 0}</b></span><span>свичей <b>${s.switches || 0}</b></span>` +
      `<span>кабелей <b>${s.cables || 0}</b></span></div>` +
      this._conflictBar();
    this._renderConflictTable();
    this._syncConfPanel();

    this._buildModel(d.placement || { racks: [], standalone: [] });
    const has = this.model.racks.length > 0;
    const pl = $("#imp-place"); if (pl) pl.hidden = !has;
    const accPl = $('#import-modal .imp-acc[data-sec="place"]'); if (accPl) accPl.hidden = !has;
    const md = $("#import-modal");
    if (md) { md.classList.toggle("wide", has); md.classList.remove("acc-place"); }   // reopen on the top section
    this._syncAcc();
    if (has) this._renderRacks();
    this._renderTree();
    this._validate();
  }

  // ── conflicts (devices already in the site) ─────────────────────────────────
  _iconFor(kind) {
    return kind === "switch" ? "mdi-switch" : kind === "socket" ? "mdi-power-socket-eu" : "mdi-ethernet";
  }
  // Collapsed signal in the top panel: «есть конфликты» + a «Посмотреть» button.
  _conflictBar() {
    if (!this.conflicts.length) return "";
    return `<div class="imp-conf-bar"><span class="imp-conf-badge">` +
      `<i class="mdi mdi-alert-circle-outline"></i> Конфликты (${this.conflicts.length})</span>` +
      `<button type="button" class="imp-conf-toggle">${this.conflictsOpen ? "Скрыть" : "Посмотреть"}</button></div>`;
  }
  // Full-width table under the columns: per device, «сейчас» rows (traced from the
  // DB) then «из файла» rows (the plan), in the Excel columns, with per-device
  // «Без замены / Заменить». Rendered into #imp-conf-full, shown on «Посмотреть».
  _renderConflictTable() {
    const host = $("#imp-conf-full"); if (!host) return;
    host.innerHTML = this.conflicts.length ? this._conflictTable() : "";
  }
  _conflictTable() {
    const cols = this.conflictCols.length ? this.conflictCols
      : [["socket", "Розетка"], ["rack", "Шкаф"], ["panel", "Панель"], ["port", "Порт"], ["switch", "Свич"]];
    const span = cols.length + 2;                          // label + data cols + action
    // diff — column keys that changed vs the matching «сейчас» link → outlined.
    const dataCells = (r, diff) => cols.map(([k]) =>
      `<td class="${diff && diff.indexOf(k) >= 0 ? "imp-conf-cd" : ""}">${r && r[k] ? esc(r[k]) : "<span class='imp-mut'>—</span>"}</td>`).join("");
    const thead = `<tr><th></th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join("")}<th></th></tr>`;
    const btn = (name, mode, label, on) =>
      `<button type="button" class="imp-conf-btn${on ? " on" : ""}" data-conf="${esc(name)}" data-mode="${mode}">${label}</button>`;
    const groups = this.conflicts.map(c => {
      const pairs = c.pairs || [];                          // only the runs that CHANGED
      const n = pairs.length || 1;
      const choice = this.conflictChoices[c.name] || "keep";
      let h = `<tr class="imp-conf-dev"><td colspan="${span}"><i class="mdi ${this._iconFor(c.kind)}"></i> ${esc(c.name)}</td></tr>`;
      pairs.forEach((p, i) => {
        h += `<tr class="imp-conf-cur"><td class="imp-conf-lbl">сейчас</td>${dataCells(p.cur, null)}`;
        if (i === 0) h += `<td rowspan="${n}" class="imp-conf-act">${btn(c.name, "keep", "Без замены", choice === "keep")}</td>`;
        h += `</tr>`;
      });
      pairs.forEach((p, i) => {
        h += `<tr class="imp-conf-new"><td class="imp-conf-lbl">из файла</td>${dataCells(p.new, p.diff)}`;
        if (i === 0) h += `<td rowspan="${n}" class="imp-conf-act">${btn(c.name, "update", "Заменить", choice === "update")}</td>`;
        h += `</tr>`;
      });
      // Additions / untouched links aren't conflicts — just note their count.
      const notes = [];
      if (c.added) notes.push(`${c.added} нов${c.added === 1 ? "ая связь" : "ых связ" + (c.added < 5 ? "и" : "ей")} добав${c.added === 1 ? "ится" : "ятся"}`);
      if (c.untouched) notes.push(`${c.untouched} без изменений`);
      if (notes.length) h += `<tr class="imp-conf-note"><td></td><td colspan="${span - 1}">файл также: ${notes.join(" · ")} — не конфликтуют</td></tr>`;
      return h;
    }).join(`<tr class="imp-conf-sep"><td colspan="${span}"></td></tr>`);
    return `<div class="imp-conf-panel"><div class="imp-conf-h">` +
      `<i class="mdi mdi-alert-circle-outline"></i> Конфликты (${this.conflicts.length}) — связь изменится; ` +
      `<span class="imp-mut">обведённое — что именно; выбери «Без замены» или «Заменить»</span></div>` +
      `<div class="imp-conf-scroll"><table class="imp-conf-tbl"><thead>${thead}</thead><tbody>${groups}</tbody></table></div></div>`;
  }
  // Show/hide the full-width table and sync the «Посмотреть/Скрыть» label.
  _syncConfPanel() {
    const host = $("#imp-conf-full");
    if (host) host.hidden = !(this.conflicts.length && this.conflictsOpen);
    const t = $("#imp-preview .imp-conf-toggle");
    if (t) t.textContent = this.conflictsOpen ? "Скрыть" : "Посмотреть";
  }

  // ── placement model ─────────────────────────────────────────────────────
  _buildModel(place) {
    const racks = (place.racks || []).map(r => {
      const existing = (this.occupancy[r.rack] || []).slice();
      // Devices already in the site show LOCKED (existing) or in the conflicts
      // block — never as fresh placeables. Keep only genuinely-new gear here.
      const order = (r.devices || []).filter(d => !this.existingNames.has(d.name));
      return { name: r.rack, location: r.location,
               size: this._rackHeight(existing), order, existing, slots: {} };
    });
    racks.forEach(r => this._autoPlace(r));
    this.model = { racks, standalone: place.standalone || [], active: 0, sel: null };
  }
  // Highest unit an existing device reaches (0 if none) — the shrink floor.
  _topExisting(existing) {
    let t = 0;
    for (const e of (existing || [])) t = Math.max(t, (e.unit || 0) + Math.max(1, e.height || 1) - 1);
    return t;
  }
  // Initial editor height: default 42U, grown if existing gear sits higher.
  _rackHeight(existing) { return Math.max(42, this._topExisting(existing)); }
  // Units held by existing (locked) devices — not available for new gear.
  _existingUnits(rack) {
    const s = new Set();
    for (const e of (rack.existing || [])) {
      const ht = Math.max(1, e.height || 1);
      for (let i = 0; i < ht; i++) s.add((e.unit || 0) + i);
    }
    return s;
  }
  // unit → existing device covering it (its top unit carries the label).
  _existingAt(rack) {
    const m = {};
    for (const e of (rack.existing || [])) {
      const ht = Math.max(1, e.height || 1);
      for (let i = 0; i < ht; i++) m[(e.unit || 0) + i] = e;
    }
    return m;
  }
  // Fill new gear from the top into FREE units (skipping existing-occupied ones).
  _autoPlace(rack) {
    rack.slots = {};
    const taken = this._existingUnits(rack);
    let u = rack.size;
    for (const d of rack.order) {
      while (u >= 1 && taken.has(u)) u--;
      if (u < 1) break;
      rack.slots[u] = d.name; u--;
    }
  }
  _unitOf(rack, name) { return Object.keys(rack.slots).find(u => rack.slots[u] === name); }
  // New gear must fit into the units NOT held by existing devices.
  _fits(rack) { return rack.order.length <= (rack.size - this._existingUnits(rack).size); }

  _pick(name) {
    this.model.sel = this.model.sel === name ? null : name;
    this._renderRacks();
  }
  _moveTo(u) {
    const rack = this.model.racks[this.model.active];
    const name = this.model.sel;
    // nothing selected / unit busy (new gear or a locked existing device)
    if (!name || rack.slots[u] || this._existingUnits(rack).has(u)) return;
    const old = this._unitOf(rack, name);
    if (old != null) delete rack.slots[old];
    rack.slots[u] = name;
    this.model.sel = null;
    this._renderRacks(); this._renderTree();
  }
  _onSize() {
    const rack = this.model.racks[this.model.active];
    if (!rack) return;
    let v = parseInt($("#imp-rack-size").value, 10);
    if (!(v >= 1)) v = 1;
    v = Math.max(v, 1, this._topExisting(rack.existing));   // never shrink below existing gear
    rack.size = v;
    this._autoPlace(rack);                          // re-fit from the top for the new height
    this.model.sel = null;
    this._renderRacks(); this._renderTree();
  }

  // ── render ──────────────────────────────────────────────────────────────
  _renderRacks() {
    const m = this.model; if (!m || !m.racks.length) return;
    const rack = m.racks[m.active];
    const tabs = $("#imp-rack-tabs");
    if (tabs) tabs.innerHTML = m.racks.map((r, i) =>
      `<button type="button" class="imp-rtab${i === m.active ? " on" : ""}${this._fits(r) ? "" : " bad"}" data-i="${i}">${esc(r.name)}</button>`).join("");
    const size = $("#imp-rack-size"); if (size) size.value = rack.size;

    const sel = m.sel;
    const exAt = this._existingAt(rack);
    const rows = [];
    for (let u = rack.size; u >= 1; u--) {
      const ex = exAt[u];
      const dev = rack.slots[u];
      if (ex) {
        // existing device — locked & greyed (label on its top unit, span below)
        rows.push(`<div class="imp-urow"><span class="imp-unum">${u}</span>` +
          (ex.unit === u
            ? `<span class="imp-udev imp-uexist k-${ex.kind || "dev"}"><i class="mdi ${this._iconFor(ex.kind)}"></i> ${esc(ex.name)} <span class="imp-mut">(есть)</span></span>`
            : `<span class="imp-uexist imp-ucont"></span>`) + `</div>`);
      } else if (dev) {
        const d = rack.order.find(x => x.name === dev) || {};
        rows.push(`<div class="imp-urow"><span class="imp-unum">${u}</span>` +
          `<button type="button" class="imp-udev k-${d.kind || "dev"}${dev === sel ? " sel" : ""}" data-name="${esc(dev)}">` +
          `<i class="mdi ${this._iconFor(d.kind)}"></i> ${esc(dev)}</button></div>`);
      } else {
        rows.push(`<div class="imp-urow"><span class="imp-unum">${u}</span>` +
          `<span class="imp-ufree${sel ? " pick" : ""}" data-u="${u}">${sel ? "поставить сюда" : ""}</span></div>`);
      }
    }
    const grid = $("#imp-rack-grid");
    if (grid) grid.innerHTML =
      (this._fits(rack) ? "" : `<div class="imp-warn">не помещается: ${rack.order.length} устройств в ${rack.size} U — увеличь размер</div>`) +
      `<div class="imp-rack">${rows.join("")}</div>`;
    this._validate();
  }

  _tn(name, kind, tail) {
    const sel = this.cfgSel === name;
    const icon = kind === "switch" ? "mdi-switch" : kind === "socket" ? "mdi-power-socket-eu" : "mdi-ethernet";
    return `<div class="imp-tn k-${kind}${sel ? " sel" : ""}" data-dev="${esc(name)}">` +
      `<i class="mdi ${icon}"></i> ${esc(name)} ${tail}` +
      (this.overrides[name] ? ` <i class="mdi mdi-cog imp-cfg-mark" title="настроено"></i>` : "") +
      (sel ? ` <button type="button" class="imp-cfg-btn">Настроить</button>` : "") + `</div>`;
  }
  _renderTree() {
    const host = $("#imp-tree"); if (!host || !this.model) return;
    const site = this._siteLabel();
    const byLoc = new Map();
    const push = (loc, html) => { if (!byLoc.has(loc)) byLoc.set(loc, []); byLoc.get(loc).push(html); };
    for (const r of this.model.racks) {
      const exAt = this._existingAt(r);
      const units = [];
      for (let u = r.size; u >= 1; u--) {
        const ex = exAt[u];
        if (ex && ex.unit === u) {
          // existing gear — shown, but not configurable (no data-dev)
          units.push(`<div class="imp-tn imp-tn-exist k-${ex.kind || "dev"}"><i class="mdi ${this._iconFor(ex.kind)}"></i> ` +
            `${esc(ex.name)} <span class="imp-mut">U${u} · есть</span></div>`);
        } else if (r.slots[u]) {
          const d = r.order.find(x => x.name === r.slots[u]) || {};
          units.push(this._tn(r.slots[u], d.kind || "dev", `<span class="imp-mut">U${u}</span>`));
        }
      }
      push(r.location, `<div class="imp-track"><i class="mdi mdi-server"></i> ${esc(r.name)}</div>${units.join("")}`);
    }
    for (const d of this.model.standalone)
      push(d.location, this._tn(d.name, d.kind, `<span class="imp-mut">вне стоек</span>`));

    let html = `<div class="imp-tsite"><i class="mdi mdi-office-building"></i> ${esc(site)}</div>`;
    for (const [loc, items] of byLoc)
      html += `<div class="imp-tloc"><i class="mdi mdi-folder"></i> ${esc(loc || "—")}</div>${items.join("")}`;
    host.innerHTML = html;
  }

  // ── per-device config (model / role), applied only on «Импортировать» ──────
  _kindOf(name) {
    if (this.model) {
      for (const r of this.model.racks) { const d = r.order.find(x => x.name === name); if (d) return d.kind; }
      const s = this.model.standalone.find(x => x.name === name); if (s) return s.kind;
    }
    return "dev";
  }
  _defaultRole(kind) { return kind === "switch" ? "Коммутатор" : kind === "socket" ? "Розетки" : "Патч-панель"; }
  _openCfg(name) {
    const box = $("#imp-cfg"); if (!box || !name) return;
    const ov = this.overrides[name] || {};
    const def = this._defaultRole(this._kindOf(name));
    const opt = (val, label, on) => `<option value="${esc(val)}"${on ? " selected" : ""}>${esc(label)}</option>`;
    const models = [opt("", "— по умолчанию (" + def + ") —", !ov.model)]
      .concat((this.dtypes || []).map(t => opt(t.model, t.model, ov.model === t.model))).join("");
    const roles = [opt("", "— по умолчанию (" + def + ") —", !ov.role)]
      .concat((this.droles || []).map(r => opt(r.name, r.name, ov.role === r.name))).join("");
    box.dataset.dev = name;
    box.innerHTML =
      `<div class="imp-cfg-h">Настройка: <b>${esc(name)}</b></div>` +
      `<label class="imp-lab">Модель</label><select id="imp-cfg-model">${models}</select>` +
      `<label class="imp-lab">Роль</label><select id="imp-cfg-role">${roles}</select>` +
      `<div class="imp-cfg-btns"><button type="button" class="imp-cfg-save primary">Готово</button>` +
      `<button type="button" class="imp-cfg-cancel">Отмена</button></div>`;
    box.hidden = false;
  }
  _saveCfg() {
    const box = $("#imp-cfg"); if (!box) return;
    const name = box.dataset.dev;
    const model = (($("#imp-cfg-model") || {}).value || "").trim();
    const role = (($("#imp-cfg-role") || {}).value || "").trim();
    if (model || role) this.overrides[name] = { model, role };
    else delete this.overrides[name];
    this._closeCfg(); this.cfgSel = null; this._renderTree();
  }
  _closeCfg() { const box = $("#imp-cfg"); if (box) { box.hidden = true; box.innerHTML = ""; } }

  _siteLabel() {
    const sel = $("#imp-site"); if (!sel) return "площадка";
    if (sel.value === "__new__") return (($("#imp-site-new") || {}).value || "").trim() || "новая площадка";
    const o = sel.selectedOptions && sel.selectedOptions[0];
    return o ? o.textContent : "площадка";
  }

  // ── commit ──────────────────────────────────────────────────────────────
  _placements() {
    const out = {};
    if (this.model) for (const r of this.model.racks)
      for (const u in r.slots) out[r.slots[u]] = +u;
    return out;
  }
  _rackSizes() {
    const out = {};
    if (this.model) for (const r of this.model.racks) out[r.name] = r.size;
    return out;
  }
  _siteReady() {
    const sel = $("#imp-site"); if (!sel || !sel.value) return false;
    if (sel.value === "__new__") return !!(($("#imp-site-new") || {}).value || "").trim();
    return true;
  }
  _validate() {
    const c = $("#imp-commit"); if (!c) return;
    const racksOk = !this.model || this.model.racks.every(r => this._fits(r));
    const ok = this._total > 0 && this._siteReady() && racksOk;
    c.disabled = !ok;
    if (this._total > 0 && !ok)
      this._status(!this._siteReady() ? "укажи площадку" : (!racksOk ? "стойка не вмещает — увеличь размер" : ""));
    else if (this._total > 0) this._status(`готово к импорту: ${this._total} связей`);
  }

  async _commit() {
    if (this._committing) return;                       // one click only — no double submit
    if (!this._file() || !this._siteReady()) { this._validate(); return; }
    this._committing = true;
    const c = $("#imp-commit"); if (c) c.disabled = true;
    const sp = $("#imp-spin"); if (sp) sp.hidden = false;
    this._status("создаю в NetBox…");
    try {
      const d = await this._post("commit");
      const cr = d.created || {};
      this._status(`готово: устройств ${cr.dev}, кабелей ${cr.cable}, локаций ${cr.loc}, стоек ${cr.rack}. Обновляю…`);
      setTimeout(() => location.reload(), 1600);        // reload clears the spinner/flags
    } catch (e) {
      this._status("ошибка: " + e.message);
      this._committing = false;
      if (sp) sp.hidden = true;
      if (c) c.disabled = false;
    }
  }
}
