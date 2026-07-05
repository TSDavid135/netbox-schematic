"use strict";
// API: сессия NetBox + CSRF, токены не нужны.
// Токен берём из скрытого input'а (Django рендерит из {% csrf_token %}) —
// НЕ из куки csrftoken (та замаскирована, даёт "incorrect length").

import { $, state } from "./core.js";

function csrfToken() {
  const el = document.querySelector("input[name=csrfmiddlewaretoken]");
  return el ? el.value : "";
}
export async function api(path, method, body) {
  const m = (method || "GET").toUpperCase();
  const unsafe = m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  const r = await fetch(state.base + "/api" + path, {
    method: m,
    credentials: "same-origin",
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
  return r.status === 204 ? null : r.json();
}
export async function apiAll(path) {
  let url = path + (path.includes("?") ? "&" : "?") + "limit=200";
  let out = [];
  while (url) {
    const d = await api(url);
    out = out.concat(d.results);
    url = d.next ? d.next.replace(state.base + "/api", "") : null;
  }
  return out;
}
// Тянет список типов кабеля из NetBox через OPTIONS (DRF отдаёт choices
// поля type). Пишет плоский [{value,label}] в state.cableTypes. Тихо
// глотает ошибки — форма тогда покажет только пункт «без типа».
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
}
