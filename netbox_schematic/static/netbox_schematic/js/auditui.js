"use strict";
// AuditUI: "what's missing and where" over a Campus / site group. Picks a scope,
// POSTs /audit/, and lists findings grouped by site → location.

import { $, state } from "./core.js";
import { apiAll } from "./api.js";

function csrf() {
  const el = document.querySelector("input[name=csrfmiddlewaretoken]");
  return el ? el.value : "";
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export class AuditUI {
  constructor(app) { this.app = app; }

  bind() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("#auditbtn", "click", () => this.open());
    on("#aud-close", "click", () => this.close());
    on("#aud-cancel", "click", () => this.close());
    on("#aud-run", "click", () => this.run());
    const bg = $("#audit-bg");
    if (bg) bg.addEventListener("mousedown", e => { if (e.target === bg) this.close(); });
  }

  async open() {
    const bg = $("#audit-bg"); if (!bg) return;
    $("#aud-summary").innerHTML = ""; $("#aud-results").innerHTML = ""; this._status("");
    bg.classList.add("open");
    const sel = $("#aud-group");
    if (sel && !sel.dataset.loaded) {          // load the site-group picker once
      try {
        const groups = await apiAll("/dcim/site-groups/");
        sel.innerHTML = `<option value="">Все площадки</option>`
          + groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
        sel.dataset.loaded = "1";
      } catch (e) { /* leave empty */ }
    }
  }
  close() { const bg = $("#audit-bg"); if (bg) bg.classList.remove("open"); }
  _status(t) { const s = $("#aud-status"); if (s) s.textContent = t || ""; }

  async run() {
    if (this._running) return;
    const gid = ($("#aud-group") || {}).value;
    const body = {};
    if (gid) body.site_group_ids = [+gid];
    else {                                     // "all" → send every site id
      try { body.site_ids = (await apiAll("/dcim/sites/")).map(s => s.id); } catch (e) { body.site_ids = []; }
    }
    this._running = true;
    const btn = $("#aud-run"); if (btn) btn.disabled = true;
    const sp = $("#aud-spin"); if (sp) sp.hidden = false;
    this._status("проверяю…");
    try {
      const r = await fetch(state.base + "/plugins/schematic/audit/", {
        method: "POST", credentials: "same-origin",
        headers: { "X-CSRFToken": csrf(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { this._status("ошибка: HTTP " + r.status); return; }
      this._render(await r.json());
    } catch (e) {
      this._status("сеть недоступна: " + e.message);
    } finally {
      this._running = false;
      if (btn) btn.disabled = false;
      if (sp) sp.hidden = true;
    }
  }

  _render(rep) {
    const sm = rep.summary || {};
    $("#aud-summary").innerHTML =
      `<div class="aud-sum">`
      + `<span class="aud-chip">устройств ${sm.devices || 0}</span>`
      + `<span class="aud-chip warn">проблем ${sm.warnings || 0}</span>`
      + `<span class="aud-chip info">замечаний ${sm.infos || 0}</span>`
      + (sm.orphan_cables ? `<span class="aud-chip warn">кабелей-сирот ${sm.orphan_cables}</span>` : "")
      + `</div>`;
    const sites = rep.sites || [];
    if (!sites.length) {
      $("#aud-results").innerHTML = `<div class="aud-empty"><i class="mdi mdi-check-circle"></i> всё на месте — замечаний нет</div>`;
      this._status(""); return;
    }
    let html = "";
    for (const s of sites) {
      html += `<div class="aud-site"><i class="mdi mdi-office-building"></i> ${esc(s.site)}</div>`;
      for (const l of s.locations) {
        html += `<div class="aud-loc"><i class="mdi mdi-folder-outline"></i> ${esc(l.location)}</div>`;
        for (const f of l.findings) {
          const icon = f.severity === "warn" ? "mdi-alert-circle" : "mdi-information-outline";
          html += `<div class="aud-find ${f.severity}"><i class="mdi ${icon}"></i>`
            + `<b>${esc(f.device)}</b> — ${esc(f.msg)}</div>`;
        }
      }
    }
    $("#aud-results").innerHTML = html;
    this._status(`готово — проблем ${sm.warnings || 0}, замечаний ${sm.infos || 0}`);
  }
}
