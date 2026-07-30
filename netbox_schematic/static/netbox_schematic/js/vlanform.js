"use strict";
// VlanForm: L2 membership (VLAN) of a physical interface.
// Popover next to the VLAN button in the device passport, built like IpForm:
// candidates come from NetBox, the write is ONE PATCH, and the view refreshes
// without a full tree.reload().
//
// NetBox write semantics this form exists to hide. Two layers disagree and the
// API one decides (dcim/api/serializers_/device_components InterfaceSerializer
// .validate, then dcim/models/device_components BaseInterface.save):
//  · The serializer 400s on mode/VLAN mismatches: untagged or tagged VLANs with
//    no mode, tagged VLANs on access/tagged-all, an S-VLAN outside q-in-q.
//  · On PATCH it fills what we did NOT send from the INSTANCE. So a VLAN sent
//    without `mode` is judged against the OLD mode — that is why `mode` is always
//    in the body, and why leaving q-in-q has to clear qinq_svlan explicitly
//    (otherwise the stored S-VLAN 400s an otherwise valid save).
//  · The model layer still clears tagged_vlans whenever mode != "tagged", and
//    q-in-q is NOT covered by the serializer check — that path drops them
//    silently, so we warn BEFORE saving rather than rely on a 400.
// Also loud: untagged_vlan/tagged_vlans must belong to the device's site or be
// global. v1 only DISPLAYS the S-VLAN, it never sets one.
//
// Candidates: /ipam/vlans/?available_on_device= — NetBox's own scope logic
// (VLANGroups scoped to region/site-group/site/location/rack + site + global).
// Don't reimplement it: the same list its own UI offers.

import { $, state, portKey } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { parseIfaceName, ifacePortNum } from "./device.js";

const MODES = [
  { value: "", label: "— без VLAN —" },
  { value: "access", label: "Access — один VLAN без тега" },
  { value: "tagged", label: "Транк — VLAN с тегами" },
  { value: "tagged-all", label: "Транк — все VLAN" },
  { value: "q-in-q", label: "Q-in-Q (802.1ad)" },
];
const CAP = 200;   // rendered rows of the tagged list (search narrows it down)

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// VLAN name is free text in NetBox and lands in innerHTML here — escape it.
const vlanLabel = v => `VLAN ${v.vid}` + (v.name ? " · " + esc(v.name) : "");

export class VlanForm {
  constructor(app) {
    this.app = app;
    this.pop = $("#vlanform");
    this.vlans = [];          // candidates for THIS device
    this.tagged = new Set();  // checked tagged VLAN ids
    this._wireStatic();
  }

  // Attach handlers to the popover's static parts once.
  _wireStatic() {
    this.pop.querySelector(".vf-cancel").addEventListener("click", () => this.close());
    this.pop.querySelector(".vf-ok").addEventListener("click", () => this._submit());
    this.pop.querySelector(".vf-mode").addEventListener("change", () => this._applyMode());
    this.pop.querySelector(".vf-search").addEventListener("input", e => {
      this.q = e.target.value; this._renderTagged();
    });
    this.pop.querySelector(".vf-newbtn").addEventListener("click", () => this._openNew());
    this.pop.querySelector(".vf-nok").addEventListener("click", () => this._createVlan());
    this.pop.querySelector(".vf-nname").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); this._createVlan(); }
    });
    this.pop.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
  }

  // open the form for ONE interface (passport button)
  async open(dev, iface, ev) {
    this.targets = [{ item: iface, dev }];
    await this._openFor(ev);
  }

  // open for SEVERAL ports picked on the VLAN canvas — same form, one write.
  // picks: [{kind, item, dev}] from state.vlanPick.
  async openBulk(picks, ev) {
    if (!picks || !picks.length) return;
    this.targets = picks.map(p => ({ item: p.item, dev: p.dev }));
    await this._openFor(ev);
  }

  async _openFor(ev) {
    const many = this.targets.length > 1;
    // First target stays the reference one (site for a new VLAN, header, warnings).
    this.dev = this.targets[0].dev;
    this.iface = this.targets[0].item;
    this.q = "";
    if (many) {
      const devs = [...new Set(this.targets.map(t => t.dev.name))];
      this.pop.querySelector(".vf-port").innerHTML =
        `<span class="vf-iftype">${this.targets.length} портов</span>`;
      this.pop.querySelector(".vf-dev").textContent =
        devs.length > 1 ? devs.length + " устройства" : devs[0];
    } else {
      // "Port: …" — same structure as IpForm: type/stack/slot as text, port as a dot.
      const pn = parseIfaceName(this.iface.name);
      const num = ifacePortNum(this.iface.name);
      const labels = pn.parts.filter(p => p.label !== "Порт").map(p => `${p.label} ${p.value}`).join(" · ");
      this.pop.querySelector(".vf-port").innerHTML =
        `<span class="vf-iftype">${pn.type}</span>` +
        (labels ? ` · ${labels}` : "") +
        (num ? ` · <span class="c-portdot p-iface">${num}</span>` : "");
      this.pop.querySelector(".vf-dev").textContent = this.dev.name;
    }

    // Prefill. `mode` arrives as {value,label} from both the graph payload and the
    // REST serializer. With several ports prefill ONLY what they agree on —
    // showing the first port's VLAN as if it were everyone's would be a lie, and
    // the user would save it onto the rest without noticing.
    const modeOf = it => (it.mode && it.mode.value) || "";
    const modes = new Set(this.targets.map(t => modeOf(t.item)));
    this.pop.querySelector(".vf-mode").innerHTML =
      MODES.map(m => `<option value="${m.value}">${m.label}</option>`).join("");
    this.pop.querySelector(".vf-mode").value = modes.size === 1 ? [...modes][0] : "";

    const tagSets = this.targets.map(t => (t.item.tagged_vlans || []).map(v => v.id).sort().join(","));
    this.tagged = new Set(new Set(tagSets).size === 1
      ? (this.targets[0].item.tagged_vlans || []).map(v => v.id) : []);

    const untags = new Set(this.targets.map(t =>
      (t.item.untagged_vlan && t.item.untagged_vlan.id) || 0));
    const untagPre = untags.size === 1 ? [...untags][0] : 0;

    this.pop.querySelector(".vf-search").value = "";
    this._closeNew();

    this._show(ev);
    await this._loadVlans();
    this._renderUntagged(untagPre || null);
    this._renderTagged();
    this._applyMode();
    // _show measured the popover while the list still said "загружаю…"; the
    // filled list makes it much taller, so re-clamp it into the window.
    this._reposition();
  }

  // Keep the popover fully inside the window after its height/width changed.
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

  // Candidates, reloaded on EVERY open: this form itself creates VLANs, and a
  // stale cache would hide one made a minute ago (same reasoning as ImportUI).
  async _loadVlans() {
    const host = this.pop.querySelector(".vf-taglist");
    host.innerHTML = `<div class="vf-empty">загружаю…</div>`;
    const devIds = [...new Set(this.targets.map(t => t.dev.id))];
    let lists = [];
    try {
      lists = await Promise.all(devIds.map(id =>
        apiAll("/ipam/vlans/?available_on_device=" + id)));
    } catch (e) {
      setStatus("не получить список VLAN: " + e.message, "err");
    }
    // Ports on SEVERAL devices → intersect the candidate lists. A VLAN available
    // to only some of them would 400 the whole batch (the bulk PATCH is one
    // transaction), so it must not be offered in the first place.
    let list = lists.length ? lists[0] : [];
    for (const other of lists.slice(1)) {
      const ids = new Set(other.map(v => v.id));
      list = list.filter(v => ids.has(v.id));
    }
    const seen = new Set(list.map(v => v.id));
    // A VLAN already on a picked port may sit outside the device's scope (assigned
    // in NetBox from elsewhere). Keep it in the list, otherwise saving would
    // quietly drop it from the form.
    for (const t of this.targets)
      for (const v of [t.item.untagged_vlan, ...(t.item.tagged_vlans || [])])
        if (v && !seen.has(v.id)) { list.push(v); seen.add(v.id); }
    this.vlans = list.map(v => ({ id: v.id, vid: v.vid, name: v.name }))
      .sort((a, b) => (a.vid ?? 0) - (b.vid ?? 0));
  }

  _mode() { return this.pop.querySelector(".vf-mode").value; }

  // Untagged select: empty option + every candidate.
  _renderUntagged(selId) {
    const sel = this.pop.querySelector(".vf-untag");
    const keep = selId !== undefined ? selId : (sel.value ? +sel.value : null);
    sel.innerHTML = `<option value="">— нет —</option>` +
      this.vlans.map(v => `<option value="${v.id}">${vlanLabel(v)}</option>`).join("");
    if (keep) sel.value = String(keep);
  }

  // Tagged list: checkboxes, filtered by the search box.
  _renderTagged() {
    const host = this.pop.querySelector(".vf-taglist");
    const q = (this.q || "").trim().toLowerCase();
    const match = this.vlans.filter(v =>
      !q || String(v.vid).includes(q) || (v.name || "").toLowerCase().includes(q));
    if (!match.length) {
      host.innerHTML = `<div class="vf-empty">${this.vlans.length ? "ничего не найдено" : "VLAN не найдены"}</div>`;
      return;
    }
    const shown = match.slice(0, CAP);
    host.innerHTML = shown.map(v =>
      `<label class="vf-tagrow"><input type="checkbox" value="${v.id}"${
        this.tagged.has(v.id) ? " checked" : ""}> ${vlanLabel(v)}</label>`).join("") +
      (match.length > CAP ? `<div class="vf-empty">показаны первые ${CAP} — уточни поиск</div>` : "");
    host.querySelectorAll("input[type=checkbox]").forEach(cb =>
      cb.addEventListener("change", () => {
        if (cb.checked) this.tagged.add(+cb.value); else this.tagged.delete(+cb.value);
        this._warn();
      }));
  }

  // Which rows make sense for the chosen mode + the "what NetBox will silently
  // drop" warning.
  _applyMode() {
    const mode = this._mode();
    // tagged-all implies every VLAN — an explicit list would be a lie.
    const showTag = mode === "tagged";
    // A native (untagged) VLAN is meaningful for everything except "no mode".
    const showUntag = !!mode;
    this.pop.querySelector(".vf-untag-row").style.display = showUntag ? "" : "none";
    this.pop.querySelector(".vf-tag-row").style.display = showTag ? "" : "none";
    this.pop.querySelector(".vf-new").style.display = showUntag ? "" : "none";
    this._warn();
  }

  _warn() {
    const el = this.pop.querySelector(".vf-warn");
    const mode = this._mode();
    const msgs = [];
    // Counted over EVERY picked port, not just the reference one — with a bulk
    // pick the damage is what the whole selection loses, not what the first does.
    const many = this.targets.length > 1;
    const tot = this.targets.reduce((n, t) => n + (t.item.tagged_vlans || []).length, 0);
    const nTag = this.targets.filter(t => (t.item.tagged_vlans || []).length).length;
    const nAny = this.targets.filter(t =>
      t.item.untagged_vlan || (t.item.tagged_vlans || []).length).length;
    const nSv = this.targets.filter(t => t.item.qinq_svlan).length;
    if (!mode && nAny)
      msgs.push(many ? `режим снят — NetBox уберёт VLAN с ${nAny} портов из ${this.targets.length}`
                     : "режим снят — NetBox уберёт VLAN с этого порта");
    else if (mode && mode !== "tagged" && tot)
      msgs.push(`NetBox снимет ${tot} тегированных VLAN${many ? ` на ${nTag} портах` : ""}: `
        + "их держит только режим «Транк — VLAN с тегами»");
    if (mode === "q-in-q")
      msgs.push("сервисный VLAN (S-VLAN) здесь не меняется — правится в NetBox");
    else if (nSv)
      msgs.push(`сервисный VLAN (S-VLAN) будет снят${many ? ` на ${nSv} портах` : ""}: `
        + "его допускает только режим Q-in-Q");
    if (many) msgs.push(`применится сразу ко всем ${this.targets.length} портам`);
    el.innerHTML = msgs.map(m => `<div>${m}</div>`).join("");
    el.style.display = msgs.length ? "block" : "none";
  }

  // create VLAN on the fly
  _openNew() {
    const row = this.pop.querySelector(".vf-newrow");
    if (row.style.display === "flex") { this._closeNew(); return; }
    row.style.display = "flex";
    this.pop.querySelector(".vf-nvid").value = "";
    this.pop.querySelector(".vf-nname").value = "";
    this.pop.querySelector(".vf-nglob").checked = false;
    this.pop.querySelector(".vf-nvid").focus();
  }
  _closeNew() { this.pop.querySelector(".vf-newrow").style.display = "none"; }

  async _createVlan() {
    const vid = parseInt(this.pop.querySelector(".vf-nvid").value, 10);
    const name = this.pop.querySelector(".vf-nname").value.trim();
    const glob = this.pop.querySelector(".vf-nglob").checked;
    if (!(vid >= 1 && vid <= 4094)) { setStatus("VID — число от 1 до 4094", "err"); return; }
    if (!name) { setStatus("укажи имя VLAN", "err"); return; }
    // VID is unique only WITHIN a VLANGroup, so NetBox would happily make a
    // second VLAN 20 in the same site. Here that is almost always a slip —
    // point at the existing one instead of quietly creating a twin.
    if (this.vlans.some(v => v.vid === vid)) {
      setStatus("VLAN " + vid + " уже есть — выбери его в списке", "err"); return;
    }
    try {
      // Site-scoped by default: an untagged VLAN must belong to the device's
      // site or be global (NetBox clean()). «Общий» makes it global — that is
      // what a trunk spanning several sites needs.
      // Picked ports spanning SEVERAL sites can't share a site-scoped VLAN: it
      // would validate on some and 400 the batch. Fall back to global and say so
      // rather than create something half the selection can't use.
      const sites = new Set(this.targets.map(t => (t.dev.site && t.dev.site.id) || 0));
      const body = { vid, name, status: "active" };
      if (!glob && sites.size === 1 && this.dev.site && this.dev.site.id)
        body.site = this.dev.site.id;
      if (!glob && sites.size > 1)
        setStatus("порты на разных площадках — VLAN создан общим", "ok");
      const v = await api("/ipam/vlans/", "POST", body);
      this.vlans.push({ id: v.id, vid: v.vid, name: v.name });
      this.vlans.sort((a, b) => (a.vid ?? 0) - (b.vid ?? 0));
      this._closeNew();
      if (this._mode() === "tagged") { this.tagged.add(v.id); this._renderUntagged(); }
      else this._renderUntagged(v.id);
      this._renderTagged();
      setStatus("VLAN " + v.vid + " создан", "ok");
    } catch (e) {
      setStatus("не создать VLAN: " + e.message, "err");
    }
  }

  // submit
  async _submit() {
    const mode = this._mode();
    const untag = this.pop.querySelector(".vf-untag").value;
    const targets = this.targets;
    // `mode` is ALWAYS in the body — see the file header: without it NetBox
    // nulls untagged_vlan on save and answers 200.
    const base = {
      mode: mode || null,
      untagged_vlan: mode && untag ? +untag : null,
      tagged_vlans: mode === "tagged" ? [...this.tagged] : [],
    };
    // Leaving q-in-q: the serializer takes qinq_svlan from the instance when it
    // is absent from the payload, so a stored S-VLAN would 400 the save with
    // "Interface mode does not support q-in-q service vlan". Drop it with the mode.
    const rowFor = it => {
      const row = { ...base };
      if (mode !== "q-in-q" && it.qinq_svlan) row.qinq_svlan = null;
      return row;
    };
    this.close();
    await this._write(targets, rowFor, "VLAN");
  }

  // Strip every VLAN off the picked ports — the trash button on the pick block.
  // Same write, empty payload: `mode` is still ALWAYS sent (null), and qinq_svlan is
  // cleared explicitly for the reason above. No dialog is opened, so this is the one
  // path that has to ask for itself.
  async clearBulk(picks) {
    const targets = (picks || []).filter(p => p && p.item);
    if (!targets.length) return;
    const withVlan = targets.filter(t => t.item.untagged_vlan ||
      (t.item.tagged_vlans || []).length || t.item.qinq_svlan);
    if (!withVlan.length) { setStatus("на выбранных портах VLAN нет", ""); return; }
    const what = withVlan.length === 1
      ? `порта ${withVlan[0].item.name}`
      : `${withVlan.length} портов`;
    if (!confirm(`Снять все VLAN с ${what}?`)) return;
    await this._write(withVlan, () => ({
      mode: null, untagged_vlan: null, tagged_vlans: [], qinq_svlan: null,
    }), "VLAN снят");
  }

  // The shared write: one PATCH for one port, the bulk list endpoint for several,
  // then mirror the answer back and repaint. Used by the form's save and by the
  // trash button, so the two cannot drift apart in how they refresh the canvas.
  async _write(targets, rowFor, doneWord) {
    try {
      if (targets.length === 1) {
        const it = targets[0].item;
        this._mirror(it, await api("/dcim/interfaces/" + it.id + "/", "PATCH", rowFor(it)));
        setStatus(doneWord + " на " + it.name + ": сохранено", "ok");
      } else {
        // NetBox bulk PATCH: the LIST endpoint takes [{id, …}] and runs the same
        // per-object serializer inside ONE transaction (BulkUpdateModelMixin.
        // perform_bulk_update). So it's one round-trip instead of N, and it is
        // all-or-nothing — no half-assigned selection to clean up after a 400.
        const upd = await api("/dcim/interfaces/", "PATCH",
          targets.map(t => ({ id: t.item.id, ...rowFor(t.item) })));
        const byId = new Map((upd || []).map(u => [u.id, u]));
        for (const t of targets) {
          const u = byId.get(t.item.id);
          if (u) this._mirror(t.item, u);
        }
        setStatus(doneWord + " на " + targets.length + " портах: сохранено", "ok");
      }
      this.app.layers.renderPanel();     // rebuild the VLAN list/counts
      // The dots' VLAN rings come from item state — relayout repaints them. The
      // pick is dropped first: its block described an action that just happened.
      if (this.app.schema) {
        this.app.schema._clearVlanPick();
        this.app.schema.relayoutNodes();
      }
      if (targets.length === 1) await this.app.device.show(targets[0].dev);
    } catch (e) {
      setStatus("не получилось: " + e.message, "err");
    }
  }

  // Write the server's answer back into the in-memory port — the same object
  // _devPorts holds — so the VLAN layer and the port tooltip are correct without
  // a full tree.reload() (the refreshCables/_refreshRadio pattern).
  _mirror(iface, upd) {
    const val = f => f === "tagged_vlans" ? (upd[f] || []) : (upd[f] || null);
    const fields = ["mode", "untagged_vlan", "tagged_vlans", "qinq_svlan"];
    fields.forEach(f => { iface[f] = val(f); });
    const p = state.ports[portKey("dcim.interface", iface.id)];
    if (p && p.item !== iface) fields.forEach(f => { p.item[f] = val(f); });
  }

  // positioning/closing — same rules as IpForm (the button sits at the panel's
  // right edge, so the popover opens to the LEFT of the cursor).
  _show(ev) {
    const pop = this.pop;
    pop.classList.add("open");
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = ev.clientX - 12 - w;
    if (x < 8) x = ev.clientX + 12;
    if (x + w > innerWidth - 8) x = Math.max(8, innerWidth - 8 - w);
    let y = ev.clientY + 12;
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - 8 - h);
    pop.style.left = x + "px";
    pop.style.top = y + "px";
    if (!this._outsideBound) {
      this._onOutside = e => { if (!e.target.closest("#vlanform")) this.close(); };
      document.addEventListener("mousedown", this._onOutside, true);
      this._outsideBound = true;
    }
  }
  close() {
    this.pop.classList.remove("open");
    this._closeNew();
    if (this._outsideBound) {
      document.removeEventListener("mousedown", this._onOutside, true);
      this._outsideBound = false;
    }
  }
}
