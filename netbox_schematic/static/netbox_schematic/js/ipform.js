"use strict";
// IpForm: smart form for assigning an IP to an interface
// Popover next to the +IP button. Composite input: 4 octets + auto mask from
// the selected network + availability indicator + expandable list of the
// network's addresses (free/used). Frontend builds "a.b.c.d/mask" for POST.
//
// Network selection: auto-pick of matching prefixes (by device site /
// interface VLAN) + option to manually pick any of state.prefixes.

import { $, state } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { parseIfaceName, ifacePortNum } from "./device.js";

// IPv4 helpers
const ipToInt = ip => ip.split(".").reduce((a, o) => (a << 8 >>> 0) + (+o), 0) >>> 0;
const intToIp = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join(".");
// Parse CIDR "10.10.0.0/24" → {net:int, mask:int, bits}. Returns null for non-IPv4.
function parseCidr(cidr) {
  const m = String(cidr).match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!m) return null;
  const bits = +m[2];
  const maskInt = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const net = (ipToInt(m[1]) & maskInt) >>> 0;
  return { net, maskInt, bits, base: m[1] };
}

export class IpForm {
  constructor(app) {
    this.app = app;
    this.pop = $("#ipform");
    this._wireStatic();
  }

  // Attach handlers to the popover's static parts once.
  _wireStatic() {
    this.pop.querySelector(".if-cancel").addEventListener("click", () => this.close());
    this.pop.querySelector(".if-ok").addEventListener("click", () => this._submit());
    this.pop.querySelector(".if-list-btn").addEventListener("click", () => this._toggleList());
    this.pop.querySelector(".if-prefix").addEventListener("change", e => this._selectPrefix(e.target.value));
    // Octets: auto-advance on dot/space/digits, backspace moves back.
    this.octs = [...this.pop.querySelectorAll(".if-oct")];
    this.octs.forEach((inp, i) => {
      inp.addEventListener("input", () => this._onOctInput(inp, i));
      inp.addEventListener("keydown", e => this._onOctKey(e, inp, i));
    });
  }

  // open the form for an interface
  async open(dev, iface, ev) {
    this.dev = dev;
    this.iface = iface;
    // "Port: …" structured: Type + Stack/Slot as labels, the port itself as a dot.
    const pn = parseIfaceName(iface.name);
    const num = ifacePortNum(iface.name);
    // Stack/slot as text; the port part is replaced with a dot (as on the schema).
    const labels = pn.parts.filter(p => p.label !== "Порт").map(p => `${p.label} ${p.value}`).join(" · ");
    this.pop.querySelector(".if-port").innerHTML =
      `<span class="if-iftype">${pn.type}</span>` +
      (labels ? ` · ${labels}` : "") +
      (num ? ` · <span class="c-portdot p-iface">${num}</span>` : "");
    this.pop.querySelector(".if-dev").textContent = dev.name;
    this.octs.forEach(o => o.value = "");
    this._setFree(null);
    this._closeList();

    // Candidate prefixes: networks tied to the device's PLACE via the networks
    // canvas (prefix.scope: location/site/region/group) or the interface VLAN —
    // as a SEPARATE group on top, preselected; the rest below. Option value = prefix id.
    const prefixes = this._candidatePrefixes(dev, iface);
    const auto = prefixes.filter(p => p._auto), rest = prefixes.filter(p => !p._auto);
    const optHtml = p => `<option value="${p.id}">${p.prefix}${p.description ? " — " + p.description : ""}</option>`;
    const sel = this.pop.querySelector(".if-prefix");
    const html =
      (auto.length ? `<optgroup label="★ сети места устройства">${auto.map(optHtml).join("")}</optgroup>` : "") +
      (rest.length ? `<optgroup label="все сети">${rest.map(optHtml).join("")}</optgroup>` : "");
    sel.innerHTML = html || `<option value="">— сетей нет —</option>`;
    this._show(ev);
    const first = auto[0] || rest[0];
    if (first) { sel.value = first.id; await this._selectPrefix(first.id); }
    else { this.cur = null; this.pop.querySelector(".if-mask").textContent = "/?"; }
    this.octs[0].focus();
  }

  // Matching prefixes: "auto" ones first (by device site), then all.
  _candidatePrefixes(dev, iface) {
    const all = state.prefixes || [];
    const siteId = dev.site && dev.site.id;
    const locId = dev.location && dev.location.id;
    // Device region/group via the full site from state (dev.site lacks them).
    const fullSite = siteId && (state.sites || []).find(s => s.id === siteId);
    const regionId = fullSite && fullSite.region && fullSite.region.id;
    const groupId = fullSite && fullSite.group && fullSite.group.id;
    // Interface VLAN → prefixes of that VLAN.
    const vlanIds = new Set();
    if (iface.untagged_vlan) vlanIds.add(iface.untagged_vlan.id);
    for (const v of iface.tagged_vlans || []) vlanIds.add(v.id);
    // A prefix is tied to the device's area via the networks canvas (prefix.scope) —
    // location/site/region/group. This is how the NETWORK schema influences the pick.
    const scopeMatch = p => {
      if (!p.scope_type || !p.scope_id) return false;
      if (p.scope_type === "dcim.location") return p.scope_id === locId;
      if (p.scope_type === "dcim.site") return p.scope_id === siteId;
      if (p.scope_type === "dcim.region") return p.scope_id === regionId;
      if (p.scope_type === "dcim.sitegroup") return p.scope_id === groupId;
      return false;
    };
    const auto = new Set();
    for (const p of all) {
      // Legacy `p.site` removed: NetBox 4.2+ Prefix has no site field (replaced
      // by generic scope) → matching goes through scopeMatch (scope_type/id) only.
      if ((p.vlan && vlanIds.has(p.vlan.id)) || scopeMatch(p)) auto.add(p.id);
    }
    const tagged = all.map(p => ({ ...p, _auto: auto.has(p.id) }));
    // Auto first, then by prefix.
    return tagged.sort((a, b) => (b._auto - a._auto) || String(a.prefix).localeCompare(String(b.prefix)));
  }

  // prefix selection → mask + loading of used addresses
  async _selectPrefix(prefixId) {
    const p = (state.prefixes || []).find(x => String(x.id) === String(prefixId));
    if (!p) { this.cur = null; return; }
    const cidr = parseCidr(p.prefix);
    this.cur = { prefix: p, cidr };
    this.pop.querySelector(".if-mask").textContent = cidr ? "/" + cidr.bits : "/?";
    // Prefill the network part into the octets (leading network bytes), leave host empty.
    if (cidr) {
      const netOcts = intToIp(cidr.net).split(".");
      // Fill octets fully covered by the mask (network part); clear host octets.
      const fullBytes = Math.floor(cidr.bits / 8);
      netOcts.forEach((v, i) => { this.octs[i].value = i < fullBytes ? v : ""; });
    }
    // Used addresses of the network.
    this.used = new Set();
    try {
      const ips = await apiAll(`/ipam/ip-addresses/?parent=${encodeURIComponent(p.prefix)}`);
      ips.forEach(ip => { const a = String(ip.address).split("/")[0]; this.used.add(a); });
    } catch (e) { this.used = new Set(); /* no usage data — don't block */ }
    this._recheck();
    if (this._listOpen) this._renderList();
  }

  // octets: input and navigation
  _onOctInput(inp, i) {
    // Trailing space/dot → move to the next octet (the dot is "consumed").
    if (/[ .]/.test(inp.value)) {
      inp.value = inp.value.replace(/[ .]/g, "");
      if (i < 3) this.octs[i + 1].focus();
    }
    // Digits only, 0–255.
    inp.value = inp.value.replace(/\D/g, "").slice(0, 3);
    if (inp.value !== "" && +inp.value > 255) inp.value = "255";
    // Auto-advance on 3 digits or a value that clearly requires it.
    if (inp.value.length === 3 && i < 3) this.octs[i + 1].focus();
    this._recheck();
  }
  _onOctKey(e, inp, i) {
    if ((e.key === "." || e.key === " ") && i < 3) { e.preventDefault(); this.octs[i + 1].focus(); }
    else if (e.key === "Backspace" && inp.value === "" && i > 0) { e.preventDefault(); this.octs[i - 1].focus(); }
    else if (e.key === "Enter") { e.preventDefault(); this._submit(); }
    else if (e.key === "Escape") { e.preventDefault(); this.close(); }
  }

  // Current address from the octets (or null unless all 4 are validly filled).
  _currentIp() {
    const vals = this.octs.map(o => o.value);
    if (vals.some(v => v === "" || +v > 255)) return null;
    return vals.join(".");
  }
  // Check availability and update the indicator.
  _recheck() {
    const ip = this._currentIp();
    if (!ip) { this._setFree(null); return; }
    // The address must belong to the selected network.
    if (this.cur && this.cur.cidr) {
      const n = ipToInt(ip);
      const inNet = (n & this.cur.cidr.maskInt) >>> 0;
      if (inNet !== this.cur.cidr.net) { this._setFree("out"); return; }
    }
    this._setFree(this.used && this.used.has(ip) ? false : true);
  }
  // Indicator: true=free(green), false=used(red), "out"=outside net, null=neutral.
  _setFree(state_) {
    const dot = this.pop.querySelector(".if-dot");
    dot.className = "if-dot" +
      (state_ === true ? " ok" : state_ === false ? " busy" : state_ === "out" ? " out" : "");
    dot.title = state_ === true ? "адрес свободен" : state_ === false ? "адрес занят"
      : state_ === "out" ? "адрес вне выбранной сети" : "";
  }

  // network address list (free/used)
  _toggleList() { this._listOpen ? this._closeList() : this._openList(); }
  _openList() {
    this._listOpen = true;
    this.pop.classList.add("with-list");
    this._renderList();
    this._reposition();   // the list widened the popover rightward — keep it in the window
  }
  _closeList() { this._listOpen = false; this.pop.classList.remove("with-list"); }

  // Shift the popover so it fully fits in the window (after a width change).
  _reposition() {
    const pop = this.pop;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const r = pop.getBoundingClientRect();
    let x = r.left, y = r.top;
    if (x + w > innerWidth - 8) x = Math.max(8, innerWidth - 8 - w);
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - 8 - h);
    pop.style.left = x + "px";
    pop.style.top = y + "px";
  }

  _renderList() {
    const host = this.pop.querySelector(".if-list");
    if (!this.cur || !this.cur.cidr) { host.innerHTML = `<div class="if-empty">выбери сеть</div>`; return; }
    const { net, bits } = this.cur.cidr;
    const size = 2 ** (32 - bits);
    // Host addresses: skip network (first) and broadcast (last) for regular
    // /<31 networks. For /31 and /32 show all.
    const skipEnds = bits < 31;
    const firstK = skipEnds ? 1 : 0;
    const lastK = skipEnds ? size - 1 : size;   // exclusive upper bound
    // Cap rendering (large networks): 256 addresses max.
    const CAP = 256;
    const count = Math.min(lastK - firstK, CAP);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const addr = intToIp((net + firstK + i) >>> 0);
      const busy = this.used && this.used.has(addr);
      rows.push(`<button class="if-addr ${busy ? "busy" : "free"}" type="button" data-ip="${addr}">
        <span class="if-adot"></span>${addr}</button>`);
    }
    const hostTotal = lastK - firstK;
    host.innerHTML =
      `<div class="if-list-head">Адреса сети ${this.cur.prefix.prefix}` +
      (hostTotal > CAP ? ` <span class="if-mut">(первые ${CAP})</span>` : "") + `</div>` +
      rows.join("");
    host.querySelectorAll(".if-addr").forEach(b =>
      b.addEventListener("click", () => this._pickAddr(b.dataset.ip)));
  }
  _pickAddr(ip) {
    ip.split(".").forEach((o, i) => this.octs[i].value = o);
    this._recheck();
    this.octs[3].focus();
  }

  // submit
  async _submit() {
    const ip = this._currentIp();
    if (!ip) { setStatus("введи полный адрес (4 октета)", "err"); return; }
    if (!this.cur || !this.cur.cidr) { setStatus("выбери сеть", "err"); return; }
    const address = ip + "/" + this.cur.cidr.bits;
    const iface = this.iface, dev = this.dev;
    this.close();
    try {
      await api("/ipam/ip-addresses/", "POST", {
        address, status: "active",
        assigned_object_type: "dcim.interface", assigned_object_id: iface.id,
      });
      setStatus("IP " + address + " назначен на " + iface.name, "ok");
      await this.app.device.show(dev);
    } catch (e) {
      setStatus("не получилось: " + e.message, "err");
    }
  }

  // positioning/closing
  _show(ev) {
    const pop = this.pop;
    pop.classList.add("open");
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const LIST_W = 200;   // right-side reserve for the expandable address list
    // The +IP button sits at the panel's right edge, so by default place the
    // popover LEFT of the cursor and reserve room on the right for the list.
    let x = ev.clientX - 12 - w;
    if (x < 8) x = ev.clientX + 12;                       // didn't fit on the left — go right
    if (x + w + LIST_W > innerWidth - 8)                  // accounting for the future list
      x = Math.max(8, innerWidth - 8 - w - LIST_W);
    let y = ev.clientY + 12;
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - 8 - h);
    pop.style.left = x + "px";
    pop.style.top = y + "px";
    if (!this._outsideBound) {
      this._onOutside = e => { if (!e.target.closest("#ipform")) this.close(); };
      document.addEventListener("mousedown", this._onOutside, true);
      this._outsideBound = true;
    }
  }
  close() {
    this.pop.classList.remove("open");
    this._closeList();
    if (this._outsideBound) {
      document.removeEventListener("mousedown", this._onOutside, true);
      this._outsideBound = false;
    }
  }
}
