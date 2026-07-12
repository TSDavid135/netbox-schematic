"use strict";
// API: NetBox session + CSRF, no tokens needed.
// The token comes from a hidden input (Django renders {% csrf_token %}) —
// NOT from the csrftoken cookie (masked, yields "incorrect length").

import { $, state } from "./core.js";

function csrfToken() {
  const el = document.querySelector("input[name=csrfmiddlewaretoken]");
  return el ? el.value : "";
}

// Global loading indicator (#reqspin) — shown OVER the modal dimmer so the user
// sees a request is in flight and doesn't re-click (small_fix q4). Every request
// is a named task: the pill fills left→right with the share of finished tasks,
// and a click expands the list of what is still being fetched.

// Endpoint → human name. First match wins; unmatched paths fall back to the URL.
const _EP_NAMES = [
  [/^\/plugins\/schematic\/graph\//, "Схема области"],
  [/^\/plugins\/schematic\/export\//, "Выгрузка в Excel"],
  [/^\/plugins\/schematic\/import\//, "Загрузка из Excel"],
  [/^\/plugins\/schematic\/forms\//, "Формы Excel"],
  [/^\/dcim\/regions\//, "Регионы"],
  [/^\/dcim\/site-groups\//, "Группы площадок"],
  [/^\/dcim\/sites\//, "Площадки"],
  [/^\/dcim\/locations\//, "Локации"],
  [/^\/dcim\/racks\//, "Стойки"],
  [/^\/dcim\/devices\//, "Устройства"],
  [/^\/dcim\/device-types\//, "Типы устройств"],
  [/^\/dcim\/device-roles\//, "Роли устройств"],
  [/^\/dcim\/manufacturers\//, "Производители"],
  [/^\/dcim\/virtual-chassis\//, "Стеки"],
  [/^\/dcim\/cables\//, "Кабели"],
  [/^\/dcim\/interfaces\//, "Интерфейсы"],
  [/^\/dcim\/front-ports\//, "Передние порты"],
  [/^\/dcim\/rear-ports\//, "Задние порты"],
  [/^\/dcim\/console-server-ports\//, "Консольные серверы"],
  [/^\/dcim\/console-ports\//, "Консольные порты"],
  [/^\/dcim\/power-panels\//, "Электрощиты"],
  [/^\/dcim\/power-feeds\//, "Линии питания"],
  [/^\/dcim\/power-outlets\//, "Розетки питания"],
  [/^\/dcim\/power-ports\//, "Порты питания"],
  [/^\/ipam\/prefixes\//, "Префиксы"],
  [/^\/ipam\/ip-addresses\//, "IP-адреса"],
  [/^\/ipam\/vlans\//, "VLAN"],
  [/^\/ipam\//, "IP-адресация"],
  [/^\/wireless\/wireless-links\//, "Беспроводные линии"],
  [/^\/wireless\//, "Беспроводные сети"],
  [/^\/circuits\/circuit-terminations\//, "Окончания каналов"],
  [/^\/circuits\/circuit-types\//, "Типы каналов"],
  [/^\/circuits\/providers\//, "Провайдеры"],
  [/^\/circuits\//, "Каналы связи"],
  [/^\/virtualization\//, "Виртуализация"],
  [/^\/vpn\//, "Туннели"],
  [/^\/tenancy\//, "Арендаторы"],
];
const _VERBS = { POST: "создаю", PATCH: "обновляю", PUT: "обновляю", DELETE: "удаляю", OPTIONS: "опции" };

function _taskName(path, method) {
  const clean = path.split("?")[0];
  const hit = _EP_NAMES.find(([re]) => re.test(clean));
  const name = hit ? hit[1]
    : clean.replace(/^\/+|\/+$/g, "").replace(/\//g, " · ") || "Запрос";
  return _VERBS[method] ? name + " — " + _VERBS[method] : name;
}

function _esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// One burst = everything in flight between two idle moments. `pct` is kept on
// the burst so it can only grow: late tasks enlarge the denominator, and a
// naive done/total would make the fill jump backwards.
const _spin = { tasks: [], done: 0, pct: 0, t0: 0, t1: 0, open: false, tick: null, hold: null };
const _busy = () => _spin.tasks.length - _spin.done;

function _spinStart(name) {
  if (_spin.hold) { clearTimeout(_spin.hold); _spin.hold = null; }
  if (!_busy()) {                     // idle → this task opens a fresh burst
    _spin.tasks = []; _spin.done = 0; _spin.pct = 0; _spin.t0 = performance.now(); _spin.t1 = 0;
  }
  const t = { name, start: performance.now(), ms: 0, state: "wait" };
  _spin.tasks.push(t);
  if (!_spin.tick) _spin.tick = setInterval(_spinPaint, 120);
  _spinPaint();
  return t;
}

function _spinEnd(t, failed) {
  t.state = failed ? "err" : "done";
  t.ms = Math.round(performance.now() - t.start);
  _spin.done++;
  // Freeze the burst's total time the moment the last task lands, so the header
  // shows a stable «Готово · N мс» and doesn't keep ticking up while displayed.
  if (!_busy()) _spin.t1 = performance.now();
  _spinPaint();
  // Idle again: hide at once, unless the user has the detail list open — then
  // leave the finished result on screen long enough to read.
  if (!_busy()) _spin.hold = setTimeout(_spinIdle, _spin.open ? 1600 : 0);
}

function _spinIdle() {
  _spin.hold = null;
  if (_busy()) return;
  if (_spin.tick) { clearInterval(_spin.tick); _spin.tick = null; }
  _spin.open = false;
  const el = document.getElementById("reqspin");
  if (el) { el.classList.remove("on", "open", "done"); el.style.setProperty("--p", "0%"); }
  const pill = document.getElementById("reqpill");
  if (pill) pill.setAttribute("aria-expanded", "false");
  const box = document.getElementById("reqlist");
  if (box) box.hidden = true;
}

function _spinPct() {
  const total = _spin.tasks.length;
  if (!total) return 0;
  if (!_busy()) return (_spin.pct = 100);
  // A lone slow request would sit at 0%. Creep it asymptotically through part of
  // its own share, so the fill still moves without ever faking a finished task.
  const oldest = _spin.tasks.find(t => t.state === "wait");
  const waited = oldest ? performance.now() - oldest.start : 0;
  const creep = (1 / total) * 0.75 * (1 - Math.exp(-waited / 1800));
  _spin.pct = Math.max(_spin.pct, Math.min((_spin.done / total + creep) * 100, 97));
  return _spin.pct;
}

function _spinPaint() {
  const el = document.getElementById("reqspin");
  if (!el) return;
  const busy = _busy();
  // Requests under ~150ms never show the pill — it would just blink.
  if (performance.now() - _spin.t0 >= 150) el.classList.add("on");
  el.classList.toggle("done", !busy);
  const pct = _spinPct();
  el.style.setProperty("--p", pct.toFixed(1) + "%");
  const p = el.querySelector(".rs-pct");
  if (p) p.textContent = Math.round(pct) + "%";
  if (_spin.open) _spinList();
}

// Repeated calls to one endpoint (apiAll pagination, apiAllByIds chunks) collapse
// into a single row with a ×N counter — 40 identical "Устройства" lines help nobody.
function _spinList() {
  const box = document.getElementById("reqlist");
  if (!box) return;
  const groups = new Map();
  for (const t of _spin.tasks) {
    let g = groups.get(t.name);
    if (!g) groups.set(t.name, (g = { name: t.name, total: 0, closed: 0, err: 0, ms: 0 }));
    g.total++;
    if (t.state !== "wait") { g.closed++; g.ms += t.ms; }
    if (t.state === "err") g.err++;
  }
  const rows = [...groups.values()].map(g => {
    const pending = g.total - g.closed;
    const cls = g.err ? "err" : pending ? "wait" : "done";
    const ico = g.err ? '<i class="mdi mdi-alert-circle"></i>'
      : pending ? '<span class="rq-dot"></span>'
      : '<i class="mdi mdi-check"></i>';
    const cnt = g.total > 1 ? `<span class="rq-cnt">${g.closed}/${g.total}</span>` : "";
    const ms = pending ? "…" : g.ms + " мс";
    return `<div class="rq-row ${cls}"><span class="rq-ico">${ico}</span>`
      + `<span class="rq-name">${_esc(g.name)}</span>${cnt}<span class="rq-ms">${ms}</span></div>`;
  });
  const busy = _busy();
  const head = busy
    ? `Выполняется ${busy} из ${_spin.tasks.length}`
    : `Готово · ${_spin.tasks.length} запр. · ${Math.round((_spin.t1 || performance.now()) - _spin.t0)} мс`;
  box.innerHTML = `<div class="rq-head">${head}</div>` + rows.join("");
}

function _spinBind() {
  const pill = document.getElementById("reqpill");
  const el = document.getElementById("reqspin");
  const box = document.getElementById("reqlist");
  if (!pill || !el || !box) return;
  pill.addEventListener("click", () => {
    _spin.open = !_spin.open;
    el.classList.toggle("open", _spin.open);
    pill.setAttribute("aria-expanded", String(_spin.open));
    box.hidden = !_spin.open;
    if (_spin.open) _spinList();
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _spinBind);
else _spinBind();

export async function api(path, method, body) {
  const m = (method || "GET").toUpperCase();
  const unsafe = m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  const task = _spinStart(_taskName(path, m));
  let failed = true;
  try {
    const r = await fetch(state.base + "/api" + path, {
      method: m,
      credentials: "same-origin",
      // The schema is always computed from LIVE NetBox data — forbid the
      // browser HTTP cache, else a deleted/changed object lingers after
      // «Обновить» (GET served from cache). Applies to all requests.
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(unsafe ? { "X-CSRFToken": csrfToken() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      let detail = "";
      try { detail = JSON.stringify(await r.json()); } catch (e) { detail = ""; }
      throw new Error("HTTP " + r.status + " " + detail.slice(0, 300));
    }
    const out = r.status === 204 ? null : await r.json();
    failed = false;
    return out;
  } finally {
    _spinEnd(task, failed);
  }
}
// Request to the plugin's OWN endpoint (not NetBox /api, but /plugins/schematic/…).
// Empty state.base → path relative to root → works behind a proxy / on any port.
export async function apiPlugin(path) {
  const task = _spinStart(_taskName("/plugins/schematic/" + path, "GET"));
  let failed = true;
  try {
    const r = await fetch(state.base + "/plugins/schematic/" + path, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status + " (эндпоинт схемы)");
    const out = await r.json();
    failed = false;
    return out;
  } finally {
    _spinEnd(task, failed);
  }
}
export async function apiAll(path) {
  let url = path + (path.includes("?") ? "&" : "?") + "limit=200";
  let out = [];
  while (url) {
    const d = await api(url);
    out = out.concat(d.results);
    // NetBox returns `next` as an ABSOLUTE URL (http://host/api/dcim/…). Strip
    // the prefix by regex (scheme+host, then leading /api/), NOT via state.base:
    // behind a proxy or on a nonstandard port state.base may not match next's
    // host (or be empty) — the old strip left a full URL and the request failed
    // (pagination bug on scope > 200 objects: /api + http://host/… → «/apihttp://…»).
    url = d.next ? d.next.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/api\//, "/") : null;
  }
  return out;
}
// apiAll over a LIST of id filters (rack_id=…/device_id=…). A long URL list on
// large selections (hundreds of off-rack devices → tens of KB) hits the nginx
// limit (HTTP 414) and fails silently. Split into batches of chunk ids, run
// SEQUENTIALLY (no parallel — spare a weak server; different endpoints already
// load in parallel via Promise.all). extra — extra filter (e.g. "rack_id=null").
// Empty list → no request.
export async function apiAllByIds(base, param, ids, extra = "", chunk = 100) {
  if (!ids || !ids.length) {
    if (extra) return apiAll(base + (base.includes("?") ? "&" : "?") + extra);
    return [];
  }
  const sep = base.includes("?") ? "&" : "?";
  let out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const q = ids.slice(i, i + chunk).map(id => `${param}=${id}`).join("&");
    out = out.concat(await apiAll(base + sep + q + (extra ? "&" + extra : "")));
  }
  return out;
}
// Pulls the cable-type list from NetBox via OPTIONS (DRF returns the type
// field's choices). Writes a flat [{value,label}] to state.cableTypes.
// Swallows errors quietly — the form then shows only the «без типа» option.
export async function loadCableTypes() {
  try {
    const meta = await api("/dcim/cables/", "OPTIONS");
    const choices = meta?.actions?.POST?.type?.choices || [];
    state.cableTypes = choices.map(c => ({ value: c.value, label: c.display_name ?? String(c.value) }));
  } catch (e) {
    state.cableTypes = [];
  }
}
export function setStatus(text, cls) {
  const el = $("#status");
  el.textContent = text;
  el.className = cls || "";
  // Mirror into the #reqspin loader so during a request it's clear WHAT's
  // running («получаю…», «рисую схему…», «создаю…»), not just «Загрузка…».
  const rs = document.querySelector("#reqspin .rs-text");
  if (rs && text) rs.textContent = text;
}
