"use strict";
// DeviceManager: паспорт устройства + модалка создания

import { $, state, mk } from "./core.js";
import { apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";

const chip = (text, cls) => `<span class="chip ${cls || ""}">${text}</span>`;

// Класс порт-кружка по типу терминации — цвет и ФИГУРА как на схеме (front/
// rear/console-server/розетка — квадрат; остальное — круг). См. .c-portdot.p-*.
const DOT_KIND = {
  "dcim.interface": "p-iface", "dcim.frontport": "p-front", "dcim.rearport": "p-rear",
  "dcim.consoleport": "p-con", "dcim.consoleserverport": "p-consrv",
  "dcim.powerport": "p-pin", "dcim.poweroutlet": "p-pout",
  "dcim.powerfeed": "p-feed", "circuits.circuittermination": "p-circuit",
};

// Имя порта/интерфейса компактно: закруглённый бейдж {тип + порт-кружок номера}.
// Кружок вписан ВНУТРЬ бейджа (не режется) и покрашен под тип порта (otype).
// Стек/слот — в нативном тултипе (title). otype опционален (по умолчанию iface).
export function portNameHtml(name, otype) {
  const pn = parseIfaceName(name);
  const num = ifacePortNum(name);
  // Подсказка: «Стек 1 · Слот 0 · Порт 3» (только имеющиеся части).
  const title = pn.parts.map(p => `${p.label} ${p.value}`).join(" · ") || name;
  const kindCls = DOT_KIND[otype] || "p-iface";
  return `<span class="port-badge" title="${title}">` +
    `<span class="c-iface">${pn.type || name}</span>` +
    (num ? `<span class="c-portdot ${kindCls}">${num}</span>` : "") +
    `</span>`;
}

// Разбор имени интерфейса на «тип + позиция». Cisco-нотация: буквенный тип +
// X/Y/Z (член-стека / слот / порт). Возвращает {type, parts:[{label,value}]}.
// Если формат не X/Y/Z — parts = [{label:"Номер", value:<остаток>}] или пусто.
export function parseIfaceName(name) {
  const m = String(name).match(/^([A-Za-z][A-Za-z .-]*?)\s*(\d+(?:\/\d+)*)?$/);
  if (!m) return { type: name, parts: [] };
  const type = m[1].trim();
  const nums = m[2] ? m[2].split("/") : [];
  if (nums.length === 3)
    return { type, parts: [
      { label: "Стек", value: nums[0] }, { label: "Слот", value: nums[1] }, { label: "Порт", value: nums[2] } ] };
  if (nums.length === 2)
    return { type, parts: [{ label: "Слот", value: nums[0] }, { label: "Порт", value: nums[1] }] };
  if (nums.length === 1)
    return { type, parts: [{ label: "Порт", value: nums[0] }] };
  return { type, parts: [] };
}
// «Хвостовой» номер порта имени — для порт-кружка в чипе (последнее число).
export function ifacePortNum(name) {
  const m = String(name).match(/(\d+)(?!.*\d)/);
  return m ? m[1] : "";
}

export class DeviceManager {
  constructor(app) {
    this.app = app;
    this.current = null;   // последнее показанное устройство (для перерисовки)
    // Смена режима схемы (view↔edit) — перерисовать паспорт, чтобы появились/
    // исчезли кнопки +IP.
    Mode.onChange("schema", () => { if (this.current) this.show(this.current); });
  }

  // Универсальная модалка: title, подпись where, поля, обработчик onSubmit.
  openModal(title, where, fields, onSubmit, okLabel = "Создать") {
    $("#modal-title").textContent = title;
    $("#modal-where").textContent = where || "";
    $("#m-create").textContent = okLabel;
    const wrap = $("#modal-fields");
    wrap.innerHTML = "";
    for (const f of fields) {
      wrap.insertAdjacentHTML("beforeend", `<label for="mf-${f.id}">${f.label}</label>`);
      if (f.type === "select") {
        const sel = mk("select", { id: "mf-" + f.id,
          html: f.options.map(o => `<option value="${o.value}">${o.label}</option>`).join("") });
        if (f.value != null) sel.value = String(f.value);
        wrap.appendChild(sel);
      } else {
        wrap.appendChild(mk("input", { id: "mf-" + f.id, placeholder: f.placeholder || "",
          ...(f.value != null ? { value: f.value } : {}) }));
      }
    }
    state.modalSubmit = async () => {
      const values = {};
      for (const f of fields) values[f.id] = $("#mf-" + f.id).value.trim();
      await onSubmit(values);
    };
    $("#modal-bg").style.display = "flex";
    const first = wrap.querySelector("input, select");
    if (first) first.focus();
  }

  wireModal() {
    $("#m-cancel").addEventListener("click", () => $("#modal-bg").style.display = "none");
    $("#m-create").addEventListener("click", async () => {
      try {
        await state.modalSubmit();
        $("#modal-bg").style.display = "none";
      } catch (e) {
        setStatus("не получилось: " + e.message, "err");
      }
    });
  }

  async show(dev) {
    this.current = dev;
    const panel = $("#detail");
    panel.innerHTML = `<h2>${dev.name}</h2>
      <div class="sub">${dev.device_type.model} · ${dev.role.name} · U${dev.position ?? "—"}</div>
      <div class="placeholder">загружаю…</div>`;
    const ips = await apiAll("/ipam/ip-addresses/?device_id=" + dev.id);
    const ipByIface = {};
    ips.forEach(ip => {
      const k = ip.assigned_object_id;
      if (!ipByIface[k]) ipByIface[k] = [];
      ipByIface[k].push(ip.address);
    });
    panel.innerHTML = `<h2>${dev.name}</h2>
      <div class="sub">${dev.device_type.model} · ${dev.role.name} · U${dev.position ?? "—"}</div>`;
    const edit = Mode.on("schema");

    const ifacePorts = Object.values(state.ports)
      .filter(p => p.dev.id === dev.id && p.otype === "dcim.interface");
    if (ifacePorts.length) {
      panel.appendChild(mk("h4", { text: "Интерфейсы и IP" }));
      for (const p of ifacePorts) {
        const addrs = (ipByIface[p.item.id] || []).map(a => chip(a, "c-ip")).join("");
        const row = mk("div", { className: "iface-row",
          html: portNameHtml(p.item.name, p.otype) + (addrs || '<span style="color:var(--muted);font-size:11px">без адреса</span>') });
        if (edit) {
          const ab = mk("button", { text: "+IP", on: { click: ev =>
            this.app.ipform.open(dev, p.item, ev) } });
          row.appendChild(ab);
        }
        panel.appendChild(row);
      }
    }

    const conns = state.cables.filter(c =>
      [...(c.a_terminations || []), ...(c.b_terminations || [])]
        .some(t => t.object && t.object.device && t.object.device.id === dev.id));
    panel.appendChild(mk("h4", { text: "Соединения (" + conns.length + ")" }));
    if (!conns.length) {
      panel.appendChild(mk("div", { className: "placeholder",
        text: "кабелей нет — включи режим стройки и кликай по точкам портов" }));
    }
    for (const c of conns) {
      const sideHtml = t => {
        if (!t || !t.object) return chip("?", "");
        const o = t.object;
        return (o.device ? chip(o.device.name, "c-dev") : "") + portNameHtml(o.name, t.object_type);
      };
      panel.appendChild(mk("div", { className: "conn",
        html: `<div class="side">${sideHtml((c.a_terminations || [])[0])}</div>
          <div class="mid">⇄</div>
          <div class="side">${sideHtml((c.b_terminations || [])[0])}</div>` }));
    }
  }
}
