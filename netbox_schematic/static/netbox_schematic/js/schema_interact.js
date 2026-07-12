"use strict";
// Interaction: hover, aim, cabling, tracing — mixin for the SchemaManager prototype (split out of schema.js).
// Methods are copied into SchemaManager.prototype via _mixin (see schema.js).
import {
  $, state, mk, px, attachTip, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox } from "./schema_util.js";

const EP_TO_OTYPE = { "interfaces": "dcim.interface", "front-ports": "dcim.frontport",
  "rear-ports": "dcim.rearport", "power-ports": "dcim.powerport", "power-outlets": "dcim.poweroutlet" };

// Port media → relevant cable families (to narrow the list when cabling):
// copper interface (base-t) → {copper}; optical/threshold (SFP/base-x) →
// {mmf,smf,dac,aoc}; front/rear — by connector (8p8c… copper; lc/sc/mpo… optic).
// Unknown (wireless/virtual/other/power) → null → do NOT narrow.
function portMedia(item, otype) {
  const t = item && item.type;
  const slug = (t ? (typeof t === "string" ? t : (t.value || "")) : "").toLowerCase();
  if (!slug) return null;
  if (otype === "dcim.interface") {
    if (/base-t\b|base-tx|base-t1/.test(slug)) return new Set(["copper"]);
    if (/base-x|sfp|qsfp|xfp|-x2\b|xenpak|gbic|cfp/.test(slug)) return new Set(["mmf", "smf", "dac", "aoc"]);
    return null;
  }
  if (otype === "dcim.frontport" || otype === "dcim.rearport") {
    if (/8p8c|110-punch|bnc|mrj21|gg45|tera/.test(slug)) return new Set(["copper", "coax"]);
    if (/^lc|^sc|^st|^fc|mpo|mtrj|^sma|urm|splice/.test(slug)) return new Set(["mmf", "smf"]);
    return null;
  }
  return null;
}

class _Mixin {
  _hoverWire(cableId, a, b, on) {
    if (state.pending) return;
    if (this._traceActive) return;   // trace is pinned — hover doesn't touch it (q9)
    document.querySelectorAll("#wires path.wire").forEach(p => {
      const mine = +p.dataset.cable === cableId;
      p.classList.toggle("dim", on && !mine);
      if (mine) p.classList.toggle("hl", on);
    });
    a.el.classList.toggle("hl", on);
    b.el.classList.toggle("hl", on);
    const keep = new Set([a.dev.id, b.dev.id]);
    // Link endpoint nodes — not just «kept lit» but BRIGHTLY highlighted
    // (outline), like ports and the wire; others dim. Else the wire glows but
    // the end ports and their nodes don't.
    Object.entries(state.nodeEls).forEach(([id, el]) => {
      const mine = keep.has(+id);
      el.classList.toggle("dim2", on && !mine);
      el.classList.toggle("conn-hl", on && mine);
    });
    // Power panels don't take part in a port↔port link — dim them with the background.
    Object.values(state.powerBoxEls || {}).forEach(el => el.classList.toggle("dim2", on));
  }
  _portHover(port, on) {
    if (!port) return;   // stale port: node recreated on scope change, its dot still catches hover
    if (state.pending) return;
    if (this._traceActive) return;   // trace is pinned — hover doesn't touch it (q9)
    // Radio port: no cable, highlight the radio line and far end.
    if (!port.item.cable && port.item.wireless_link) { this._hoverRadio(port, on); return; }
    if (!port.item.cable) return;
    const cable = state.cables.find(c => c.id === port.item.cable.id);
    if (!cable) return;
    const aT = (cable.a_terminations || [])[0], bT = (cable.b_terminations || [])[0];
    const a = aT && state.ports[termKey(aT)], b = bT && state.ports[termKey(bT)];
    if (a && b) this._hoverWire(cable.id, a, b, on);
  }

  // Hover on a wireless port: highlight its radio line + both ends (like
  // _hoverWire for a cable). Pair comes from _collectWireless (by data).
  _hoverRadio(port, on) {
    const pairs = (this.app.layers && this.app.layers._collectWireless().pairs) || [];
    const key = portKey(port.otype, port.item.id);
    const pair = pairs.find(pr => pr.a === key || pr.b === key);
    if (!pair) return;
    const a = state.ports[pair.a], b = state.ports[pair.b];
    document.querySelectorAll("#wires path.radiowire").forEach(w =>
      w.classList.toggle("hl", on && +w.dataset.wlink === pair.id));
    if (a) a.el.classList.toggle("hl", on);
    if (b) b.el.classList.toggle("hl", on);
    const keep = new Set([a && a.dev.id, b && b.dev.id]);
    Object.entries(state.nodeEls).forEach(([id, el]) => {
      const mine = keep.has(+id);
      el.classList.toggle("dim2", on && !mine);
      el.classList.toggle("conn-hl", on && mine);
    });
    Object.values(state.powerBoxEls || {}).forEach(el => el.classList.toggle("dim2", on));
  }

  // aiming / port selection
  _enterAim(fromOtype) {
    const okTypes = new Set(COMPAT[fromOtype] || []);
    Object.values(state.ports).forEach(p => {
      const isSelf = state.pending && p.otype === state.pending.otype && p.item.id === state.pending.id;
      const compatible = okTypes.has(p.otype) && !p.item.cable && !isSelf;
      p.el.classList.toggle("aim-dim", !compatible && !isSelf);
      p.el.classList.toggle("aim-ok", compatible);
    });
    document.querySelectorAll("#wires path.wire").forEach(w => w.classList.add("dim"));
    Object.values(state.rackBoxEls).forEach(el => el.classList.add("dim"));
  }
  _exitAim() {
    Object.values(state.ports).forEach(p => p.el.classList.remove("aim-dim", "aim-ok"));
    document.querySelectorAll("#wires path.wire").forEach(w => w.classList.remove("dim", "hl"));
    Object.values(state.rackBoxEls).forEach(el => el.classList.remove("dim"));
    Object.values(state.nodeEls).forEach(el => el.classList.remove("dim2", "conn-hl"));
  }
  setPending(port) {
    if (state.pending) state.pending.el.classList.remove("pending");
    state.pending = port;
    $("#cancelconn").classList.toggle("show", !!port);
    if (port) {
      port.el.classList.add("pending");
      this._enterAim(port.otype);
    } else {
      this._exitAim();
    }
  }

  async _onPortClick(kind, item, dev, dot, ev) {
    const edit = Mode.on("schema");
    // Click-to-create circuit on a free wired port is REMOVED: a circuit now
    // only shows as a cloud on the «Физический» view and is set up in NetBox
    // directly (later — via «provider as node»). A free radio port in
    // «Беспроводной»+edit goes through the shared pending flow below (→ WirelessLink).
    // Radio port already carrying a link: in edit, open the removal menu (drop
    // the WirelessLink) — mirror of a cabled port below. A FREE radio port has no
    // wireless_link and falls through to the pending flow (→ create WirelessLink).
    if (item.wireless_link && !item.cable && !state.pending) {
      if (edit) { this._openLinkMenu(item, dev, dot, ev, null, item.wireless_link.id || item.wireless_link); return; }
      const rp = state.ports[portKey(kind.otype, item.id)];   // non-edit: just light the link
      if (rp) this._hoverRadio(rp, true);
      return;
    }
    if (item.cable && !state.pending) {
      if (edit) { this._openLinkMenu(item, dev, dot, ev); return; }
      // Single view (trace): DON'T load on the first tap — that skips the tooltip
      // (a tap, like hover, must show the port info). For a WHISKER (neighbour not
      // loaded, wire fades out) pop a small "expand" button over the port whose
      // arrow points where the node will appear; tapping IT grows the chain. If
      // the neighbour is already on the schema, just flash it. Desktop keeps the
      // double-click shortcut (_onPortDblClick) to load straight away.
      if (state.single) {
        const skey = portKey(kind.otype, item.id);
        const sp = state.ports[skey];
        const far = this._farDevForPort(skey);
        const loaded = far && far.dev && (state.chain || []).includes(far.dev.id);
        if (loaded) { this._hideExpandBtn(); if (far.dev) this._flashNode(far.dev.id); }
        else if (sp) this._showExpandBtn(sp, kind, item);
        return;
      }
      const key = portKey(kind.otype, item.id);
      const touch = matchMedia("(pointer: coarse)").matches || innerWidth <= 760;
      // Touch: 1st tap — tooltip + link highlight; 2nd tap on the SAME port —
      // trace through patch panels + close tooltip (dblclick is unreliable on iOS,
      // tooltip always opened first). Desktop — unchanged (click = link, dblclick = trace).
      if (touch && this._tipPort === key) {
        this._tipPort = null;
        const tip = $("#tip"); if (tip) tip.style.display = "none";
        if (kind.ep === "interfaces" || kind.ep === "power-ports" || kind.ep === "power-outlets")
          this._trace(kind.ep, item);
        else this._traceLocal(item);
        return;
      }
      this._traceLocal(item);
      this._tipPort = touch ? key : null;
      return;
    }
    if (!edit) {
      setStatus(dev.name + "/" + item.name + " — порт свободен (включи режим стройки)", "");
      return;
    }
    if (!state.pending) {
      this.setPending({ otype: kind.otype, id: item.id, label: dev.name + "/" + item.name, el: dot });
      setStatus("выбран " + state.pending.label + " — кликни совместимый порт или «Отмена»", "ok");
      return;
    }
    if (state.pending.id === item.id && state.pending.otype === kind.otype) {
      this.setPending(null);
      setStatus("выбор отменён");
      return;
    }
    if (!(COMPAT[state.pending.otype] || []).includes(kind.otype) || item.cable) {
      setStatus("несовместимый или занятый порт", "err");
      return;
    }
    const a = state.pending;
    const bLabel = dev.name + "/" + item.name;
    // Radio link: if BOTH ends are wireless interfaces, create a WirelessLink
    // (not a Cable — radio has no wire). Cable type not asked.
    if (this._isWirelessTerm(a) && this._isWirelessTerm({ otype: kind.otype, id: item.id })) {
      this.setPending(null);
      await this._createWirelessLink(a, item.id, bLabel);
      return;
    }
    this.setPending(null);
    this._openCablePopover(a, { otype: kind.otype, id: item.id }, bLabel, ev);
  }

  // Whisker "expand" button. One reused element on #schema (so it zooms/pans with
  // the canvas), floated just above a top-side port / below a bottom-side one; its
  // arrow points where the neighbour will appear (rotated 180° for bottom ports).
  // Tapping it grows the chain along this port's cable.
  _showExpandBtn(port, kind, item) {
    const canvas = $("#schema"); if (!canvas || !port || !port.el) return;
    let btn = document.getElementById("trace-expand");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "trace-expand"; btn.type = "button";
      btn.setAttribute("aria-label", "Загрузить дальнее устройство");
      canvas.appendChild(btn);
      // Tap on empty space (deselect / pan) drops the whole port selection —
      // button, tooltip AND the cable highlight — not just the button. A tap on
      // the button, a port, or the tooltip itself is left alone (capture phase
      // runs before a port's own click, which re-shows it for that port).
      document.addEventListener("pointerdown", e => {
        if (e.target.closest("#trace-expand") || e.target.closest(".port") || e.target.closest("#tip")) return;
        this._hideExpandBtn();
        const tip = document.getElementById("tip"); if (tip) tip.style.display = "none";
        this._tipPort = null;
        if (this._clearTrace) this._clearTrace();
      }, true);
    }
    const up = port.side === "t";
    btn.className = up ? "" : "down";
    btn.innerHTML = `<i class="mdi mdi-arrow-up-box"></i>`;
    const base = canvas.getBoundingClientRect(), z = state.zoom || 1;
    const r = port.el.getBoundingClientRect();
    const cx = (r.left - base.left + r.width / 2) / z;
    const cy = (r.top - base.top + r.height / 2) / z;
    btn.style.left = cx + "px";
    btn.style.top = (cy + (up ? -32 : 32)) + "px";
    btn.style.display = "flex";
    btn.onclick = e => {
      e.stopPropagation();
      this._hideExpandBtn();
      this._revealFromPort(kind.otype, item.id);
    };
  }
  _hideExpandBtn() { const b = document.getElementById("trace-expand"); if (b) b.style.display = "none"; }

  // NOT CALLED NOW (click-to-create circuit removed — see _onPortClick). Kept as
  // a stub for a future «provider as node»: mini-form (provider + cid), then a
  // POST chain — circuit → termination(A, site) → cable(term↔port). The circuit's
  // other end is «in the cloud» (at the provider).
  async _assignCircuit(dev, item, ev) {
    const providers = state.circuitProviders || [];
    const types = state.circuitTypes || [];
    if (!providers.length) {
      setStatus("нет провайдеров — создай Provider в NetBox (Circuits → Providers)", "err");
      return;
    }
    const siteId = dev.site && dev.site.id;
    this.app.openModal("Выход в WAN (Circuit)", dev.name + " · " + item.name, [
      { id: "provider", label: "Провайдер", type: "select",
        options: providers.map(p => ({ value: p.id, label: p.name })) },
      { id: "type", label: "Тип канала", type: "select",
        options: types.map(t => ({ value: t.id, label: t.name })) },
      { id: "cid", label: "Идентификатор канала (CID)", placeholder: "напр. INET-042" },
    ], async v => {
      if (!v.cid) { setStatus("укажи CID канала", "err"); throw new Error("no cid"); }
      // 1) circuit
      const circ = await api("/circuits/circuits/", "POST",
        { cid: v.cid, provider: +v.provider, type: +v.type, status: "active" });
      // 2) termination A at the device's site
      const term = await api("/circuits/circuit-terminations/", "POST",
        { circuit: circ.id, term_side: "A", termination_type: "dcim.site", termination_id: siteId });
      // 3) cable termination ↔ port
      await api("/dcim/cables/", "POST", {
        a_terminations: [{ object_type: "circuits.circuittermination", object_id: term.id }],
        b_terminations: [{ object_type: "dcim.interface", object_id: item.id }],
        status: "connected",
      });
      setStatus("circuit " + v.cid + " подключён к " + dev.name + "/" + item.name, "ok");
      await this.app.tree.reload();   // circuits load in connect() → full reconnect
    });
  }

  // Is termination {otype,id} a wireless interface (radio type)?
  _isWirelessTerm(term) {
    if (term.otype !== "dcim.interface") return false;
    const p = state.ports[portKey(term.otype, term.id)];
    if (!p) return false;
    const t = (p.item.type && p.item.type.value) || "";
    return !!p.item.wireless_link || t.startsWith("ieee802.11") || t.startsWith("other-wireless");
  }

  // Create a WirelessLink between two interfaces (a.id ↔ bId).
  async _createWirelessLink(a, bId, bLabel) {
    try {
      await api("/wireless/wireless-links/", "POST",
        { interface_a: a.id, interface_b: bId, status: "connected" });
      setStatus("радио-линк создан: " + a.label + " ⇄ " + bLabel, "ok");
      // wireless-links load in connect() → full reconnect refreshes state
      await this.app.tree.reload();
    } catch (e) {
      setStatus("не удалось создать радио-линк: " + e.message, "err");
    }
  }

  // cable-type popover (next to the port, not a modal)
  // Preferred cable type from the already-narrowed groups (copper → cat6,
  // optic → smf/mmf, DAC…); else the first concrete type, else «без типа».
  _defaultCableType(groups) {
    const PREF = ["cat6", "cat6a", "cat5e", "smf-os2", "smf", "mmf-om4", "mmf", "dac-passive", "dac-active", "aoc"];
    const vals = groups.flatMap(g => g.opts.map(o => o[0])).filter(Boolean);
    for (const p of PREF) if (vals.includes(p)) return p;
    return vals[0] || "";
  }
  _openCablePopover(a, b, bLabel, ev) {
    const pop = this.cablepop;
    // Type list limited by connection kind (power → power only, data → everything
    // but power), AND NARROWED by port MEDIA: copper port (base-t) → copper only
    // (cat…), optical (SFP/base-x) → optic/DAC. Unknown media → don't narrow.
    // «без типа» — always first.
    let allow = cableFamiliesFor(a.otype, b.otype);
    let byMedia = false;
    if (!(allow.has("power") && allow.size === 1)) {
      const ai = (state.ports[portKey(a.otype, a.id)] || {}).item;
      const bi = (state.ports[portKey(b.otype, b.id)] || {}).item;
      const ma = portMedia(ai, a.otype), mb = portMedia(bi, b.otype);
      const media = ma && mb ? new Set([...ma].filter(f => mb.has(f))) : (ma || mb);
      if (media && media.size) {
        const nn = new Set([...allow].filter(f => media.has(f)));
        if (nn.size) { allow = nn; byMedia = true; }
      }
    }
    const groups = [{ group: "—", opts: [["", "без типа"]] }, ...cableTypeGroups(allow)];
    const isPower = allow.has("power") && allow.size === 1;
    const sel = pop.querySelector(".cp-type");
    sel.innerHTML = groups.map(g =>
      `<optgroup label="${g.group}">` +
      g.opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("") +
      `</optgroup>`).join("");
    // Preselect: power → power; with known media — the preferred type
    // (cat6 / smf / …), else «без типа».
    sel.value = isPower ? "power" : (byMedia ? this._defaultCableType(groups) : "");
    pop.querySelector(".cp-where").textContent = a.label + " ⇄ " + bLabel;

    // Position next to the port (at the cursor), within the window.
    pop.style.display = "block";
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = ev.clientX + 12, y = ev.clientY + 12;
    if (x + w > innerWidth - 8) x = innerWidth - 8 - w;
    if (y + h > innerHeight - 8) y = ev.clientY - 12 - h;
    pop.style.left = Math.max(8, x) + "px";
    pop.style.top = Math.max(8, y) + "px";
    sel.focus();

    const close = () => {
      pop.style.display = "none";
      pop.querySelector(".cp-ok").onclick = null;
      pop.querySelector(".cp-cancel").onclick = null;
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      this._closeCablePop = null;
    };
    this._closeCablePop = close;
    const onOutside = e => { if (!e.target.closest("#cablepop")) close(); };
    const onKey = e => { if (e.key === "Escape") { close(); setStatus("прокладка отменена"); } };
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    pop.querySelector(".cp-cancel").onclick = () => { close(); setStatus("прокладка отменена"); };
    pop.querySelector(".cp-ok").onclick = async () => {
      const type = sel.value;
      close();
      try {
        const body = {
          a_terminations: [{ object_type: a.otype, object_id: a.id }],
          b_terminations: [{ object_type: b.otype, object_id: b.id }],
          status: "connected",
        };
        if (type) body.type = type;   // empty = no type (neutral color)
        await api("/dcim/cables/", "POST", body);
        setStatus("кабель проложен: " + a.label + " ⇄ " + bLabel, "ok");
        await this.refreshCables();
      } catch (e) {
        setStatus("не получилось: " + e.message, "err");
      }
    };
  }

  // link mini-menu. wlinkId set → the menu removes a WirelessLink instead of a
  // Cable (radio ports/wires have no cable); see the linkmenu handlers in _wire().
  _openLinkMenu(item, dev, dot, ev, cableId, wlinkId) {
    state.linkCtx = { cableId: cableId || (item.cable && item.cable.id), wlink: wlinkId || null, item, dev };
    this.linkmenu.style.display = "flex";
    this.linkmenu.style.left = (ev.clientX - 10) + "px";
    this.linkmenu.style.top = (ev.clientY - 42) + "px";
  }
  _closeLinkMenu() { this.linkmenu.style.display = "none"; state.linkCtx = null; }
  _farEndKey(cableId, nearOtype, nearId) {
    const cable = state.cables.find(c => c.id === cableId);
    if (!cable) return null;
    const all = [...(cable.a_terminations || []), ...(cable.b_terminations || [])];
    for (const t of all) {
      if (t.object_type !== nearOtype || t.object_id !== nearId) return termKey(t);
    }
    return null;
  }

  // trace
  // SINGLE click on an occupied port — highlight ONLY its link.
  _traceLocal(item) {
    this._clearTrace();                                     // reset previous highlight
    const cable = state.cables.find(c => c.id === (item.cable && item.cable.id));
    if (!cable) return;
    const aT = (cable.a_terminations || [])[0], bT = (cable.b_terminations || [])[0];
    const a = aT && state.ports[termKey(aT)], b = bT && state.ports[termKey(bT)];
    if (a && b) {
      this._hoverWire(cable.id, a, b, true);
      this._hlCables = new Set([cable.id]);   // survive zoom (see redrawWires)
      this._armTraceClear();
      setStatus(`кабель: ${a.dev.name}/${a.item.name} ⇄ ${b.dev.name}/${b.item.name} — клик снимет`, "ok");
    }
  }
  // DOUBLE click on an occupied port — continuation (full trace through patch
  // panels). Only for interface/power (they have an API trace); front/rear/
  // console have no continuation → just show the link.
  _onPortDblClick(kind, item) {
    if (Mode.on("schema") || state.pending || !item.cable) return;
    // Single-view: double tap reveals the TARGET node (no API trace to build in
    // single view — only this device is on the schema).
    if (state.single) { this._revealFromPort(kind.otype, item.id); return; }
    if (kind.ep === "interfaces" || kind.ep === "power-ports" || kind.ep === "power-outlets")
      this._trace(kind.ep, item);
    else
      this._traceLocal(item);
  }
  async _trace(ep, item) {
    this._clearTrace();                                     // reset previous highlight/dimming
    try {
      const segments = await api(`/dcim/${ep}/${item.id}/trace/`);
      const cableIds = new Set(segments.map(s => s[1] && s[1].id).filter(Boolean));
      this._hlCables = cableIds;   // survive zoom: redrawWires restores wire highlight
      const portKeys = new Set(), devIds = new Set(), panelIds = new Set();
      for (const seg of segments)
        for (const side of [seg[0], seg[2]])
          for (const t of (side || [])) {
            if (t.device) devIds.add(t.device.id);
            const m = (t.url || "").match(/\/dcim\/([a-z-]+)\/(\d+)\//);
            if (m && EP_TO_OTYPE[m[1]]) portKeys.add(EP_TO_OTYPE[m[1]] + ":" + m[2]);
            // feeder in a power trace → keep its panel bright (don't dim)
            if (m && m[1] === "power-feeds") {
              const feed = (state.powerFeeds || []).find(f => f.id === +m[2]);
              if (feed && feed.power_panel) panelIds.add(feed.power_panel.id);
            }
          }
      document.querySelectorAll("#wires path.wire").forEach(p => {
        p.classList.remove("hl", "dim");
        p.classList.add(cableIds.has(+p.dataset.cable) ? "hl" : "dim");
      });
      Object.entries(state.ports).forEach(([k, p]) => p.el.classList.toggle("hl", portKeys.has(k)));
      // Trace nodes — bright (hl), the REST dim (dim2). Clear conn-hl from a
      // prior hover/single click so dimming doesn't «stick» under the
      // continuation (this was exactly the snag).
      Object.entries(state.nodeEls).forEach(([id, el]) => {
        const inTrace = devIds.has(+id);
        el.classList.toggle("hl", inTrace);
        el.classList.toggle("dim2", !inTrace);
        el.classList.remove("conn-hl");
      });
      Object.entries(state.rackDevEls).forEach(([id, el]) => el.classList.toggle("hl", devIds.has(+id)));
      // Panels: all dim except those whose feeder is in the power trace.
      Object.entries(state.powerBoxEls || {}).forEach(([id, el]) => el.classList.toggle("dim2", !panelIds.has(+id)));
      const last = segments[segments.length - 1];
      const endT = last && last[2] && last[2][0];
      const endTxt = endT ? (endT.device ? endT.device.name + "/" : "") + (endT.name || "?") : "?";
      this._armTraceClear();
      setStatus(`путь: ${item.name} → ${endTxt} (${segments.length} кабел${segments.length === 1 ? "ь" : "я/ей"}) — клик снимет`, "ok");
    } catch (e) {
      setStatus("трасса не построилась: " + e.message, "err");
    }
  }
  // Pin the trace: hover no longer touches it (_traceActive), and ANY click
  // (not drag/pan, not on a port) clears it — «click anywhere removes» (q9).
  // Register after the current event so we don't catch the click that spawned
  // the trace.
  _armTraceClear() {
    this._traceActive = true;
    if (this._traceHandlers) return;   // already armed
    let sx = 0, sy = 0;
    const down = ev => { sx = ev.clientX; sy = ev.clientY; };
    const up = ev => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) return;   // pan/drag — don't clear
      if (ev.target.closest && ev.target.closest(".port")) return;             // a port starts its own trace
      this._clearTrace();
    };
    this._traceHandlers = { down, up };
    setTimeout(() => {
      if (!this._traceHandlers) return;
      document.addEventListener("mousedown", down, true);
      document.addEventListener("mouseup", up, true);
    }, 0);
  }
  _clearTrace() {
    document.querySelectorAll("#wires path.wire").forEach(p => p.classList.remove("hl", "dim"));
    document.querySelectorAll(".port.hl").forEach(p => p.classList.remove("hl"));
    document.querySelectorAll(".node.hl, .dev.hl, .node.conn-hl, .node.dim2").forEach(el => el.classList.remove("hl", "conn-hl", "dim2"));
    this._traceActive = false;
    this._hlCables = null;
    if (this._traceHandlers) {
      document.removeEventListener("mousedown", this._traceHandlers.down, true);
      document.removeEventListener("mouseup", this._traceHandlers.up, true);
      this._traceHandlers = null;
    }
  }

  // zoom / centering
}
export const InteractMethods = _Mixin.prototype;
