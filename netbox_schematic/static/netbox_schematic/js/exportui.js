"use strict";
// ExportUI: export modal — tree picker (sites → locations → racks) →
// export the selection to the Patchen/Unpatchen xlsx template (/export/ backend).

import { $, state } from "./core.js";
import { apiAll } from "./api.js";
import { iconForDevice } from "./solutions.js";

function csrf() {
  const el = document.querySelector("input[name=csrfmiddlewaretoken]");
  return el ? el.value : "";
}
const LVL = node => +([...node.classList].find(c => c.startsWith("exp-l")) || "exp-l0").slice(5);

export class ExportUI {
  constructor(app) { this.app = app; }

  bind() {
    const btn = $("#exportbtn");
    if (btn) btn.addEventListener("click", () => this.open());
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("#exp-close", "click", () => this.close());
    on("#exp-cancel", "click", () => this.close());
    on("#exp-run", "click", () => this._run());
    on("#exp-all", "click", () => this._checkAll(true));
    on("#exp-none", "click", () => this._checkAll(false));
    const bg = $("#export-bg");
    if (bg) bg.addEventListener("mousedown", e => { if (e.target === bg) this.close(); });
  }

  async open() {
    const bg = $("#export-bg"); if (bg) bg.classList.add("open");
    this._status("");
    await this._buildTree();
  }
  close() { const bg = $("#export-bg"); if (bg) bg.classList.remove("open"); }

  async _buildTree() {
    const box = $("#exp-tree");
    if (!box) return;
    box.innerHTML = `<div class="exp-loading">загружаю иерархию…</div>`;
    let groups, sites, locs, racks, devs;
    try {
      // Full hierarchy like the main tree: site groups, sites, nested
      // locations, racks AND devices (in racks / off-rack).
      [groups, sites, locs, racks, devs] = await Promise.all([
        apiAll("/dcim/site-groups/"), apiAll("/dcim/sites/"), apiAll("/dcim/locations/"),
        apiAll("/dcim/racks/"), apiAll("/dcim/devices/"),
      ]);
    } catch (e) { box.innerHTML = `<div class="exp-err">ошибка загрузки: ${e.message}</div>`; return; }

    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    const gByParent = {}, sByGroup = {}, lBySiteRoot = {}, lByParent = {},
          rByLoc = {}, rBySite = {}, dByRack = {}, dByLoc = {}, dBySite = {};
    groups.sort(byName).forEach(g => { const p = g.parent ? g.parent.id : 0; (gByParent[p] = gByParent[p] || []).push(g); });
    sites.sort(byName).forEach(s => { const g = s.group ? s.group.id : 0; (sByGroup[g] = sByGroup[g] || []).push(s); });
    locs.sort(byName).forEach(l => {
      if (l.parent) (lByParent[l.parent.id] = lByParent[l.parent.id] || []).push(l);
      else { const s = l.site && l.site.id; (lBySiteRoot[s] = lBySiteRoot[s] || []).push(l); }
    });
    racks.sort(byName).forEach(r => {
      if (r.location) (rByLoc[r.location.id] = rByLoc[r.location.id] || []).push(r);
      else { const s = r.site && r.site.id; (rBySite[s] = rBySite[s] || []).push(r); }
    });
    devs.sort(byName).forEach(d => {
      if (d.rack) (dByRack[d.rack.id] = dByRack[d.rack.id] || []).push(d);
      else if (d.location) (dByLoc[d.location.id] = dByLoc[d.location.id] || []).push(d);
      else { const s = d.site && d.site.id; (dBySite[s] = dBySite[s] || []).push(d); }
    });

    const H = [];
    const node = (o, lvl, kind, icon, bold) =>
      H.push(`<label class="exp-node exp-l${lvl}${bold ? " exp-b" : ""}" style="padding-left:${6 + lvl * 20}px">` +
        `<input type="checkbox" data-kind="${kind}" data-id="${o.id}">` +
        `<i class="mdi ${icon}"></i><span>${o.name}</span></label>`);
    const emitDev = (d, lvl) => node(d, lvl, "device", iconForDevice(d), false);
    const emitRack = (r, lvl) => {
      node(r, lvl, "rack", "mdi-server", false);
      (dByRack[r.id] || []).forEach(d => emitDev(d, lvl + 1));
    };
    const emitLoc = (l, lvl) => {
      node(l, lvl, "location", "mdi-map-marker", false);
      (lByParent[l.id] || []).forEach(c => emitLoc(c, lvl + 1));
      (rByLoc[l.id] || []).forEach(r => emitRack(r, lvl + 1));
      (dByLoc[l.id] || []).forEach(d => emitDev(d, lvl + 1));
    };
    const emitSite = (s, lvl) => {
      node(s, lvl, "site", "mdi-office-building", true);
      (lBySiteRoot[s.id] || []).forEach(l => emitLoc(l, lvl + 1));
      (rBySite[s.id] || []).forEach(r => emitRack(r, lvl + 1));
      (dBySite[s.id] || []).forEach(d => emitDev(d, lvl + 1));
    };
    const emitGroup = (g, lvl) => {
      node(g, lvl, "group", "mdi-folder-outline", true);   // group — cascade check only
      (gByParent[g.id] || []).forEach(c => emitGroup(c, lvl + 1));
      (sByGroup[g.id] || []).forEach(s => emitSite(s, lvl + 1));
    };
    (gByParent[0] || []).forEach(g => emitGroup(g, 0));
    (sByGroup[0] || []).forEach(s => emitSite(s, 0));

    box.innerHTML = H.join("") || `<div class="exp-loading">нет площадок</div>`;
    box.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => this._cascade(cb)));
  }

  // Checking a parent cascades to all following deeper-level nodes.
  _cascade(cb) {
    const node = cb.closest(".exp-node"), lvl = LVL(node);
    let el = node.nextElementSibling;
    while (el && el.classList.contains("exp-node") && LVL(el) > lvl) {
      const c = el.querySelector("input"); if (c) c.checked = cb.checked;
      el = el.nextElementSibling;
    }
  }
  _checkAll(on) {
    const box = $("#exp-tree"); if (box) box.querySelectorAll("input").forEach(c => c.checked = on);
  }

  async _run() {
    if (this._running) return;                          // one click only
    const box = $("#exp-tree"); if (!box) return;
    const pick = kind => [...box.querySelectorAll(`input[data-kind="${kind}"]:checked`)].map(c => +c.dataset.id);
    const fmt = ($("#exp-form") || {}).value || "patchen";
    const lang = ($("#exp-lang") || {}).value || "ru";
    const body = { form: fmt, lang, site_ids: pick("site"), location_ids: pick("location"),
                   rack_ids: pick("rack"), device_ids: pick("device") };
    if (!body.site_ids.length && !body.location_ids.length && !body.rack_ids.length && !body.device_ids.length) {
      this._status("выбери площадку / локацию / стойку / устройство", true); return;
    }
    this._running = true;
    const btn = $("#exp-run"); if (btn) btn.disabled = true;
    const sp = $("#exp-spin"); if (sp) sp.hidden = false;
    this._status("готовлю файл…");
    try {
      const r = await fetch(state.base + "/plugins/schematic/export/", {
        method: "POST", credentials: "same-origin",
        headers: { "X-CSRFToken": csrf(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { this._status("ошибка экспорта: HTTP " + r.status, true); return; }
      const rows = r.headers.get("X-Row-Count") || "?";
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "schematic-export.xlsx"; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
      this._status(rows === "0"
        ? (fmt === "universal" ? "выгружено 0 — в выбранном нет устройств"
                               : "выгружено 0 строк (в выбранном нет связей розетка→панель→свич)")
        : `готово — строк выгружено: ${rows}`);
    } catch (e) {
      this._status("сеть недоступна: " + e.message, true);
    } finally {
      this._running = false;
      if (btn) btn.disabled = false;
      if (sp) sp.hidden = true;
    }
  }

  _status(t, err) { const el = $("#exp-status"); if (el) { el.textContent = t || ""; el.className = err ? "exp-err" : "exp-ok"; } }
}
