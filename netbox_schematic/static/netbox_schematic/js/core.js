"use strict";
// Core: shared state, utilities, constants
// All managers import from here. state is the single source of runtime data
// (managers keep their collections and DOM refs in it, as before).

export const $ = s => document.querySelector(s);

export const state = {
  base: "", token: "",
  regions: [], siteGroups: [], sites: [], locations: [], prefixes: [],
  powerPanels: [], powerFeeds: [],   // power panels and feeds (tree + power layer)
  wirelessLinks: [],                 // radio links between interfaces ("Wireless" layer)
  circuits: [], circuitTerms: [],    // provider circuits + terminations ("Circuits" layer)
  circuitProviders: [], circuitTypes: [],   // reference lists for circuit assignment
  ipamPrefixes: [], ipamIps: [], ipamLocations: [],   // "Network / IPAM" canvas
  roles: {}, dtypes: {},
  racks: [], group: [], groupKey: null,
  scope: null,                       // selected scope {type:'region'|'site'|'location', id, name}
  devices: [], devRack: {}, devCol: {}, devNodeIdx: {},
  ports: {},
  ipsByIface: {},                    // interface id → [IP] (tooltip / device card)
  nodeEls: {}, rackDevEls: {}, rackBoxEls: {}, rackColEls: {},
  rackOcc: {}, rackLay: {},
  cables: [],
  cableTypes: [],         // [{value,label}] from OPTIONS /api/dcim/cables/ (loadCableTypes)
  activeLayer: null,      // active highlight layer {kind,id,portKeys} (layers.js)
  _vlanIndex: null,       // Map vid → {vlan,portKeys} for the layers panel and tooltips
  pending: null,          // {otype,id,label,el} — selected port (first cable end)
  drag: null,             // {type,id,name} — tree node being dragged
  linkCtx: null,          // context of the open link mini-menu
  zoom: 1,
  modalSubmit: null,
  toolsCollapsed: true,   // "UI" block on the schema starts collapsed
  filterCollapsed: true,  // "Fl" block (role/cable filter) starts collapsed
  paletteCollapsed: true, // "+" palette (bottom-right corner) starts collapsed
  // Schema view: "phys" (cables) | "net" (radio + circuits) | "vlan" (L2 — wired
  // interfaces only). Each swaps the node's port set; the segment lives at the top
  // of the «Отображение» panel (layers.js renderPanel).
  viewMode: "phys",
  // VLAN view: ports picked for assignment, Map portKey → {kind, item, dev}.
  // Keys, not elements — a relayout replaces the dots (see _paintVlanPick).
  vlanPick: null,
  wireStyle: "round",     // wire style: "round" (arcs) | "angular" (corners + hop bridges)
  wirePath: "short",      // angular routing: "short" (direct) | "extend" (detour around nodes)
  hiddenRoles: {},        // {roleId: true} — hidden node roles (filter, hidden via CSS)
  hiddenFams: {},         // {family: true}  — hidden cable families
};

export const PORT_KINDS = [
  { ep: "interfaces",           otype: "dcim.interface",         cls: "p-iface", label: "интерфейсы" },
  { ep: "front-ports",          otype: "dcim.frontport",         cls: "p-front", label: "front" },
  { ep: "rear-ports",           otype: "dcim.rearport",          cls: "p-rear",  label: "rear" },
  { ep: "console-ports",        otype: "dcim.consoleport",       cls: "p-con",   label: "console" },
  { ep: "console-server-ports", otype: "dcim.consoleserverport", cls: "p-consrv", label: "console-server" },
  { ep: "power-ports",          otype: "dcim.powerport",         cls: "p-pin",   label: "питание" },
  { ep: "power-outlets",        otype: "dcim.poweroutlet",       cls: "p-pout",  label: "розетки" },
];
export const KIND_RU = { "dcim.interface": "сетевой интерфейс", "dcim.frontport": "front-порт панели",
  "dcim.rearport": "rear-порт панели (магистраль)", "dcim.powerport": "ввод питания",
  "dcim.poweroutlet": "розетка питания", "dcim.consoleport": "консольный порт",
  "dcim.consoleserverport": "порт консоль-сервера", "dcim.powerfeed": "фидер питания (щит)" };
// Cable end compatibility matrix (mirrors NetBox COMPATIBLE_TERMINATION_TYPES)
export const COMPAT = {
  "dcim.interface":         ["dcim.interface", "dcim.frontport", "dcim.rearport", "circuits.circuittermination"],
  "dcim.frontport":         ["dcim.interface", "dcim.frontport", "dcim.rearport", "dcim.consoleport", "dcim.consoleserverport", "circuits.circuittermination"],
  "dcim.rearport":          ["dcim.interface", "dcim.frontport", "dcim.rearport", "dcim.consoleport", "dcim.consoleserverport", "circuits.circuittermination"],
  "dcim.consoleport":       ["dcim.consoleserverport", "dcim.frontport", "dcim.rearport"],
  "dcim.consoleserverport": ["dcim.consoleport", "dcim.frontport", "dcim.rearport"],
  "dcim.powerport":   ["dcim.poweroutlet", "dcim.powerfeed"],
  "dcim.poweroutlet": ["dcim.powerport"],
  "dcim.powerfeed":   ["dcim.powerport"],
};

// Cable types
// The TYPE list (value+label) is NOT hardcoded — it comes from NetBox via
// OPTIONS /api/dcim/cables/ (see loadCableTypes in api.js) into
// state.cableTypes as a flat [{value,label}]. In NetBox it is a static
// ChoiceSet (CableTypeChoices) with no separate table/list endpoint, but
// DRF returns its choices in the OPTIONS response — the source of truth.
//
// The plugin keeps only what the API LACKS: mapping a type to a "family"
// (wire color and form grouping). Matched by value PREFIX, not a full list —
// so a new type (cat9, om6…) lands in its family without plugin changes.
const FAMILY_RULES = [
  [/^cat\d|^mrj21/, "copper"],   // copper · twisted pair
  [/^dac-/, "dac"],              // copper · DAC (twinax)
  [/^coax|^rg-|^lmr-/, "coax"],  // copper · coax
  [/^mmf/, "mmf"],               // fiber · multimode
  [/^smf/, "smf"],               // fiber · single-mode
  [/^aoc/, "aoc"],               // fiber · active (AOC)
  [/^power/, "power"],           // power
  [/^usb/, "usb"],               // USB
];
// Cable type family (color/group key). Empty/unknown → "default".
export function cableFamily(type) {
  if (!type) return "default";
  for (const [re, fam] of FAMILY_RULES) if (re.test(type)) return fam;
  return "default";
}
// Human-readable family name — <optgroup> heading in the type picker form.
export const FAMILY_LABEL = {
  copper: "Медь · витая пара", dac: "Медь · DAC", coax: "Медь · коаксиал",
  mmf: "Оптика · многомод", smf: "Оптика · одномод", aoc: "Оптика · активная",
  power: "Питание", usb: "USB", default: "Прочее",
};
// Family order in the dropdown.
export const FAMILY_ORDER = ["copper", "dac", "coax", "mmf", "smf", "aoc", "power", "usb", "default"];
// Which families fit a given connection kind. "power" — power only
// (power port ↔ outlet/feed); "data" — everything except power. The
// connection kind is derived from the port otypes (see cableFamiliesFor).
const POWER_FAMILY = "power";
export function cableFamiliesFor(otypeA, otypeB) {
  const isPower = (otypeA + otypeB).includes("power");
  return isPower
    ? new Set([POWER_FAMILY])                                  // power — the power family only
    : new Set(FAMILY_ORDER.filter(f => f !== POWER_FAMILY));   // data — everything except power
}
// Groups flat state.cableTypes by family → [{group,opts:[[v,l],…]}] for
// <optgroup>. Group order — FAMILY_ORDER, option order — as from the API.
// allowFams (Set) — if given, keep only these families.
export function cableTypeGroups(allowFams) {
  const byFam = {};
  for (const { value, label } of (state.cableTypes || [])) {
    const fam = cableFamily(value);
    if (allowFams && !allowFams.has(fam)) continue;
    (byFam[fam] ||= []).push([value, label]);
  }
  return FAMILY_ORDER
    .filter(fam => byFam[fam])
    .map(fam => ({ group: FAMILY_LABEL[fam], opts: byFam[fam] }));
}

// Geometry
export const UNIT_H = 22;
export const GAP_MIN = 3;        // run of empty units at which we start collapsing
export const GAP_H = 26;         // height of the collapsed "↕ N" strip
export const COL_W = 350, COL_GAP = 170, NODE_GAP = 74, BOX_PAD = 16;
// DOT — port-dot diameter; STEP — pitch between dots in a row. The dot carries its
// port NUMBER, so it is sized by the text, not by the mark: at 16px a two-digit
// number sat wall to wall. STEP grows with it to keep the same breathing room.
export const DOT = 19, STEP = 24, EXTRA = 400;

const TR = { "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y",
  "к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h",
  "ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya" };
export function slugify(name) {
  return name.toLowerCase().split("").map(ch => TR[ch] !== undefined ? TR[ch] : ch).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

// mk(tag, props, ...children): DOM element factory. props is an object:
//   className/id/text/html — special fields; on:{event:fn} — listeners;
//   dataset:{k:v}; style:{k:v}; everything else — attributes.
export function mk(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "className") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k === "style") Object.assign(e.style, v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
export const px = v => parseFloat(v) || 0;
// Mode switch — label centered at the top of a block: "Просмотр" (view; soft
// blue hover shadow) ↔ "Редактирование" (edit; soft orange oval highlight,
// always visible). Click toggles the mode. Keep class .modebtn + data-mode +
// aria-pressed — all wiring (modes.js, main.js) relies on them. extra —
// extra class for positioning within a specific block (e.g. schem-mid).
export const modeBtn = (mode, extra = "") =>
  `<button class="modebtn modeswitch ${extra}" data-mode="${mode}" aria-pressed="false" title="Переключить режим: просмотр / редактирование"><span class="ms-view"><i class="mdi mdi-eye"></i> Просмотр</span><span class="ms-edit-full"><i class="mdi mdi-pencil"></i> Редактирование</span><span class="ms-edit-short"><i class="mdi mdi-pencil"></i> Редакт.</span></button>`;
// Muted color from a role hex ("607d8b" → "rgba(96,125,139,a)").
export function softColor(hex, a = 0.16) {
  const h = (hex || "607d8b").replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
// Port/termination key in state.ports.
export const portKey = (type, id) => type + ":" + id;
export const termKey = t => portKey(t.object_type, t.object_id);
// Collapsible panel: clicking head toggles .collapsed and stores the flag in state.
export function collapsible(root, head, stateKey) {
  if (state[stateKey]) root.classList.add("collapsed");
  head.addEventListener("click", () => {
    root.classList.toggle("collapsed");
    state[stateKey] = root.classList.contains("collapsed");
  });
}
// Name of the selected scope (region / site / server room) — for the
// "Стойки : …" and "Схема соединений : …" panel titles. Shows WHERE the
// schema was loaded from (see state.scope). Fallback — the legacy groupKey.
export function currentLocationName() {
  if (state.scope && state.scope.name) return state.scope.name;
  const locId = (state.groupKey || "").replace(/^\w+:/, "");
  const loc = state.locations.find(l => String(l.id) === String(locId));
  return loc ? loc.name : "";
}

// Custom tooltip
const tip = $("#tip");
// Touch/narrow screen: pin the tooltip slightly BELOW center (finger doesn't
// cover the port) and add a close button — touch has no mouseleave to dismiss it.
const tipTouch = () => matchMedia("(pointer: coarse)").matches || innerWidth <= 760;
// `skip` — an optional predicate checked at SHOW time, not at bind time. A tooltip
// bound once on a long-lived element must be able to go quiet when the surrounding
// mode changes, and deciding at bind time silently goes stale on any screen that
// doesn't rebuild its elements (which is how the VLAN cut kept its port tips in the
// single-device view long after they were supposed to be gone).
export function attachTip(el, htmlFn, skip) {
  const move = ev => {
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 310) + "px";
    tip.style.top = (ev.clientY + 16) + "px";
  };
  // Show the tooltip (returned so callers can re-open it on a repeat tap — touch
  // has no mouseenter on the second tap of the same element).
  const showTip = ev => {
    if (skip && skip()) return;
    // No tooltip in schema edit mode (port click = link action, not info).
    if (document.body.classList.contains("schema-edit")) return;
    tip.innerHTML = htmlFn();
    const phone = innerWidth <= 760;                                  // narrow → pin centered
    const touch = matchMedia("(pointer: coarse)").matches || phone;   // touch → needs a close button
    if (phone) {
      // Phone: a finger hides the small port and the screen is narrow → pin centered.
      tip.classList.add("tip-fixed");
      tip.style.left = "50%"; tip.style.top = "60%"; tip.style.transform = "translateX(-50%)";
    } else {
      // Tablet AND desktop: spawn NEXT TO the port (a tablet has the room, and a
      // finger doesn't cover a port on a big screen). Tablet keeps touch sizing.
      tip.classList.toggle("tip-fixed", touch);
      tip.style.transform = "";
      if (ev) move(ev);
    }
    if (touch) {   // touch has no mouseleave → explicit close button
      tip.insertAdjacentHTML("afterbegin", `<button class="tip-close" aria-label="Закрыть">&times;</button>`);
      const c = tip.querySelector(".tip-close");
      if (c) c.addEventListener("click", e => {
        e.stopPropagation();
        tip.style.display = "none";
        // Closing the tooltip also clears the cable/trace highlight (schema.js listens).
        document.dispatchEvent(new Event("schematic:tipclose"));
      });
    }
    tip.style.display = "block";
  };
  el.addEventListener("mouseenter", showTip);
  el.addEventListener("mousemove", ev => { if (!tipTouch()) move(ev); });
  el.addEventListener("mouseleave", () => { if (!tipTouch()) tip.style.display = "none"; });
  return showTip;
}
// Hide the shared tooltip programmatically (e.g. when opening a device passport —
// a lingering port tip on touch has no mouseleave to dismiss it).
export function hideTip() {
  if (!tip) return;
  tip.style.display = "none";
  tip.classList.remove("tip-fixed");
}

// Two-finger pinch-zoom on a scroll pane — SHARED by every canvas (Инфраструктура,
// Сети, and the WIP ones): zoom about the gesture midpoint keeping that content
// point fixed, then clamp the scroll. The pane needs CSS `touch-action: pan-x
// pan-y` so one finger scrolls natively (= pan) and the browser hands us the
// pinch. opts: { getZoom, setZoom, applyZoom, onEnd?, min=0.3, max=2.5 }.
export function attachPinchZoom(pane, opts) {
  if (!pane) return;
  const { getZoom, setZoom, applyZoom, onEnd, min = 0.3, max = 2.5 } = opts;
  let dist = 0, z0 = 1, cx = 0, cy = 0;
  pane.addEventListener("touchstart", ev => {
    if (ev.touches.length !== 2) return;
    const [a, b] = ev.touches;
    dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    z0 = getZoom() || 1;
    const r = pane.getBoundingClientRect();
    const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
    cx = (pane.scrollLeft + (mx - r.left)) / z0;   // fixed content point (unscaled)
    cy = (pane.scrollTop + (my - r.top)) / z0;
  }, { passive: true });
  pane.addEventListener("touchmove", ev => {
    if (ev.touches.length !== 2 || !dist) return;
    ev.preventDefault();
    const [a, b] = ev.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const z = Math.min(max, Math.max(min, z0 * (d / dist)));
    setZoom(z); applyZoom();
    const r = pane.getBoundingClientRect();
    const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
    const maxL = Math.max(0, pane.scrollWidth - pane.clientWidth);
    const maxT = Math.max(0, pane.scrollHeight - pane.clientHeight);
    pane.scrollLeft = Math.max(0, Math.min(maxL, cx * z - (mx - r.left)));
    pane.scrollTop = Math.max(0, Math.min(maxT, cy * z - (my - r.top)));
  }, { passive: false });
  pane.addEventListener("touchend", ev => {
    if (dist && ev.touches.length < 2) { dist = 0; if (onEnd) onEnd(); }
  });
}
