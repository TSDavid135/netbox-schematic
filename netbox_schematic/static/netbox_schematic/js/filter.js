"use strict";
// Role / cable filter.
// The «Fl» button above «UI» in the schema overlay expands a DYNAMIC list of
// what's on the current schema: nodes (grouped by device role) and wires (by
// cable family). Checkboxes hide/show via pure CSS over what's already drawn
// (data-role / data-fam) — no data reload, no schema rebuild. Hidden state
// lives in state.hiddenRoles / state.hiddenFams so the filter survives
// re-render (renderAll recreates nodes/wires → reapply).

import { $, state, cableFamily, FAMILY_LABEL, FAMILY_ORDER, termKey } from "./core.js";

export class RoleFilter {
  constructor(app) {
    this.app = app;
  }

  // Rebuild the panel from current data + apply hiding to the DOM. Called
  // from renderAll (after the schema draws) and refreshCables (cables may
  // appear/vanish). Bail if the panel doesn't exist yet.
  render() {
    const body = $(".fl-body");
    if (!body) return;
    const roles = this._presentRoles();
    const fams = this._presentFamilies();
    body.innerHTML = "";

    if (!roles.length && !fams.length) {
      body.innerHTML = `<div class="fl-empty">Нет объектов на схеме</div>`;
      return;
    }

    if (roles.length) {
      body.appendChild(this._section("Узлы (роли)", roles.map(r => ({
        key: "role:" + r.id,
        color: "#" + r.color,
        shape: "box",
        label: r.name,
        count: r.count,
        hidden: !!state.hiddenRoles[r.id],
        toggle: on => this._toggleRole(r.id, on),
      }))));
    }
    if (fams.length) {
      body.appendChild(this._section("Провода (тип)", fams.map(f => ({
        key: "fam:" + f.fam,
        color: `var(--cbl-${f.fam})`,
        shape: "line",
        label: f.label,
        count: f.count,
        hidden: !!state.hiddenFams[f.fam],
        toggle: on => this._toggleFam(f.fam, on),
      }))));
    }
    this.apply();
  }

  // what's on the schema
  _presentRoles() {
    const by = new Map();
    for (const dev of (state.devices || [])) {
      const id = dev.role ? dev.role.id : 0;
      const role = (dev.role && state.roles[id]) || { name: "без роли", color: "607d8b" };
      const cur = by.get(id) || { id, name: role.name, color: role.color, count: 0 };
      cur.count++;
      by.set(id, cur);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  _presentFamilies() {
    const by = new Map();
    for (const c of (state.cables || [])) {
      const isPower = (c.a_terminations || []).concat(c.b_terminations || [])
        .some(t => t.object_type && t.object_type.includes("power"));
      const fam = c.type ? cableFamily(c.type) : (isPower ? "power" : "default");
      by.set(fam, (by.get(fam) || 0) + 1);
    }
    return FAMILY_ORDER.filter(f => by.has(f))
      .map(fam => ({ fam, label: fam === "default" ? "без типа" : FAMILY_LABEL[fam], count: by.get(fam) }));
  }

  // render a section
  _section(title, rows) {
    const sec = document.createElement("div");
    sec.className = "fl-sec";
    const h = document.createElement("div");
    h.className = "fl-sub";
    h.textContent = title;
    sec.appendChild(h);
    for (const r of rows) sec.appendChild(this._row(r));
    return sec;
  }

  _row(r) {
    const row = document.createElement("label");
    row.className = "fl-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !r.hidden;   // checked = visible
    cb.addEventListener("change", () => r.toggle(!cb.checked));
    const sw = document.createElement("span");
    sw.className = "fl-sw " + (r.shape === "line" ? "fl-line" : "fl-box");
    if (r.shape === "line") sw.style.background = r.color;
    else sw.style.borderColor = r.color;
    const name = document.createElement("span");
    name.className = "fl-name";
    name.textContent = r.label;
    const cnt = document.createElement("span");
    cnt.className = "fl-cnt";
    cnt.textContent = r.count;
    row.append(cb, sw, name, cnt);
    return row;
  }

  // hide / show
  _toggleRole(id, hidden) {
    if (hidden) state.hiddenRoles[id] = true; else delete state.hiddenRoles[id];
    this.apply();
  }
  _toggleFam(fam, hidden) {
    if (hidden) state.hiddenFams[fam] = true; else delete state.hiddenFams[fam];
    this.apply();
  }

  // Apply the current hide state to the DOM. Nodes — by data-role. A wire is
  // hidden if: (a) its family is off, OR (b) at least one end sits on a
  // hidden-role node (else the wire would dangle in a corner, since its
  // geometry comes from the hidden node's port bounding-rects).
  apply() {
    // set of device ids whose role is hidden
    const hiddenDev = new Set();
    for (const dev of (state.devices || [])) {
      const rid = dev.role ? dev.role.id : 0;
      if (state.hiddenRoles[rid]) hiddenDev.add(dev.id);
    }
    document.querySelectorAll("#schema .node[data-role]").forEach(el => {
      el.classList.toggle("flt-hidden", !!state.hiddenRoles[el.dataset.role]);
    });
    // cable → device ids at its ends (via state.cables + state.ports)
    document.querySelectorAll("#wires .wire[data-fam]").forEach(el => {
      const famHidden = !!state.hiddenFams[el.dataset.fam];
      const cid = +el.dataset.cable;
      let devHidden = false;
      if (cid) devHidden = this._cableTouchesHidden(cid, hiddenDev);
      el.classList.toggle("flt-hidden", famHidden || devHidden);
    });
  }

  _cableTouchesHidden(cableId, hiddenDev) {
    if (!hiddenDev.size) return false;
    const c = (state.cables || []).find(x => x.id === cableId);
    if (!c) return false;
    // cable end → port in state.ports → device (.dev). Terminations are keyed
    // by object_type+object_id (termKey), as everywhere in the plugin.
    for (const t of [...(c.a_terminations || []), ...(c.b_terminations || [])]) {
      const port = state.ports[termKey(t)];
      if (port?.dev && hiddenDev.has(port.dev.id)) return true;
    }
    return false;
  }
}
