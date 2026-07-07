"use strict";
// DeviceManager: паспорт устройства + модалка создания

import { $, state, mk, modeBtn } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
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
// used=true → кружок ЗАКРАШЕН цветом типа (как «занятый» порт на схеме).
export function portNameHtml(name, otype, used) {
  const pn = parseIfaceName(name);
  const num = ifacePortNum(name);
  // Подсказка: «Стек 1 · Слот 0 · Порт 3» (только имеющиеся части).
  const title = pn.parts.map(p => `${p.label} ${p.value}`).join(" · ") || name;
  const kindCls = DOT_KIND[otype] || "p-iface";
  return `<span class="port-badge" title="${title}">` +
    `<span class="c-iface">${pn.type || name}</span>` +
    (num ? `<span class="c-portdot ${kindCls}${used ? " used" : ""}">${num}</span>` : "") +
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
    this.current = null;        // последнее показанное устройство (для перерисовки)
    this.currentPanel = null;   // …или показанный силовой щит
    // Смена режима (схемы ИЛИ собственного режима блока деталей) — перерисовать
    // открытый паспорт, чтобы появились/исчезли кнопки правки (+IP, ✎ фидера,
    // карандаш щита). Режим "detail" — переключатель прямо в блоке деталей.
    const rerender = () => {
      if (this.current) this.show(this.current);
      else if (this.currentPanel) this.showPanel(this.currentPanel);
    };
    Mode.onChange("schema", rerender);
    Mode.onChange("detail", rerender);
  }
  // Правка в блоке деталей доступна, если включён режим схемы ИЛИ собственный
  // режим блока деталей (переключатель в его заголовке).
  _editable() { return Mode.on("detail") || Mode.on("schema"); }

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

  // Заголовок паспорта с переключателем режима блока деталей (data-mode=detail).
  _detailHead(title, sub) {
    return `<div class="detail-head">${modeBtn("detail", "compact ms-corner")}` +
      `<h2>${title}</h2><div class="sub">${sub}</div></div>`;
  }
  async show(dev) {
    this.current = dev;
    this.currentPanel = null;
    const panel = $("#detail");
    const sub = `${dev.device_type.model} · ${dev.role.name} · U${dev.position ?? "—"}`;
    panel.innerHTML = this._detailHead(dev.name, sub) + `<div class="placeholder">загружаю…</div>`;
    const ips = await apiAll("/ipam/ip-addresses/?device_id=" + dev.id);
    const ipByIface = {};
    ips.forEach(ip => {
      const k = ip.assigned_object_id;
      if (!ipByIface[k]) ipByIface[k] = [];
      ipByIface[k].push(ip.address);
    });
    panel.innerHTML = this._detailHead(dev.name, sub);
    Mode.syncButtons("detail");
    const edit = this._editable();
    // В правке: подтянуть недостающие компоненты из шаблонов device type
    // (напр. после смены типа устройства — NetBox их сам не пересоздаёт).
    if (edit) {
      panel.appendChild(mk("button", { className: "sync-comp-btn",
        html: `<i class="mdi mdi-sync"></i> Синхронизировать порты с типом`,
        on: { click: () => this.syncComponents(dev) } }));
    }

    const ifacePorts = Object.values(state.ports)
      .filter(p => p.dev.id === dev.id && p.otype === "dcim.interface");
    if (ifacePorts.length) {
      panel.appendChild(mk("h4", { text: "Интерфейсы и IP" }));
      for (const p of ifacePorts) {
        const addrs = (ipByIface[p.item.id] || []).map(a => chip(a, "c-ip")).join("");
        // Связан ли интерфейс (кабель или радио-линк) → порт закрашен, а ховер
        // по строке подсвечивает его на схеме (detail п.3).
        const linked = !!(p.item.cable || p.item.wireless_link);
        const row = mk("div", { className: "iface-row" + (linked ? " linked" : ""),
          html: portNameHtml(p.item.name, p.otype, linked) + (addrs || '<span style="color:var(--muted);font-size:11px">без адреса</span>') });
        if (linked) row.addEventListener("mouseenter", () => this.app.schema._portHover(p, true));
        if (linked) row.addEventListener("mouseleave", () => this.app.schema._portHover(p, false));
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

  // Паспорт силового щита (Power Panel) — клик по названию щитка на схеме.
  // Не устройство, поэтому this.current сбрасываем (иначе onChange("schema")
  // попытается перерисовать его как device через show()).
  showPanel(panel) {
    this.current = null;
    this.currentPanel = panel;
    const el = $("#detail");
    const feeds = (state.powerFeeds || []).filter(f => f.power_panel && f.power_panel.id === panel.id);
    const loc = panel.location ? panel.location.name : "—";
    const edit = this._editable();
    el.innerHTML = this._detailHead(panel.name, `силовой щит · ${loc} · ${feeds.length} фид.`);
    Mode.syncButtons("detail");
    // Карандаш у названия щита (в правке) — переименовать сам щит.
    if (edit) {
      const pen = mk("button", { className: "head-edit", title: "Изменить щит",
        html: `<i class="mdi mdi-pencil"></i>`,
        on: { click: () => this._editPanel(panel) } });
      el.querySelector(".detail-head h2").appendChild(pen);
    }
    el.appendChild(mk("h4", { text: "Фидеры (" + feeds.length + ")" }));
    if (!feeds.length) {
      el.appendChild(mk("div", { className: "placeholder", text: "фидеров нет — добавь в режиме стройки" }));
      return;
    }
    for (const f of feeds) {
      const va = f.amperage ? `${f.voltage || "?"} В / ${f.amperage} А` : "";
      const rack = f.rack ? (f.rack.display || f.rack.name) : "—";
      const st = f.cable ? "подключён" : "не подключён";
      const row = mk("div", { className: "conn",
        html: `<div class="side">${chip(f.name, "c-dev")}${va ? `<span style="color:var(--muted);font-size:11px">${va}</span>` : ""}</div>
          <div class="mid">→</div>
          <div class="side">${chip(rack, "")}<span style="color:var(--muted);font-size:11px">${st}</span></div>` });
      // В режиме правки — «изменить» (в т.ч. стойку «куда идёт») и «удалить»
      // фидер прямо из паспорта щита (удобнее, чем искать его в дереве).
      if (edit) {
        const info = { kind: "feed", id: f.id, name: f.name };
        const acts = mk("div", { className: "feed-acts" });
        acts.appendChild(mk("button", { title: "Изменить фидер", html: `<i class="mdi mdi-pencil"></i>`,
          on: { click: e => { e.stopPropagation(); this.app.tree._editFeed(info); } } }));
        acts.appendChild(mk("button", { className: "danger", title: "Удалить фидер", html: `<i class="mdi mdi-delete"></i>`,
          on: { click: e => { e.stopPropagation(); this.app.tree._delete(info); } } }));
        row.appendChild(acts);
      }
      el.appendChild(row);
    }
  }
  // Переименовать силовой щит (карандаш в паспорте). После reload берём свежий
  // объект щита и перепоказываем паспорт.
  _editPanel(panel) {
    this.app.openModal("Изменить щит", "Текущее: " + panel.name,
      [{ id: "name", label: "Название щита", value: panel.name }],
      async v => {
        if (!v.name) throw new Error("пустое название");
        await api("/dcim/power-panels/" + panel.id + "/", "PATCH", { name: v.name });
        setStatus("щит переименован: " + v.name, "ok");
        await this.app.tree.reload();
        this.showPanel((state.powerPanels || []).find(p => p.id === panel.id) || panel);
      }, "Сохранить");
  }

  // Создать устройство-ПОТРЕБИТЕЛЬ вне стойки (кнопка «+» на схеме). Роль с
  // «провайдер/provider» в имени → рендерится НАД стойками, прочие — сеткой
  // справа (см. schema._renderOffRack + main.js классификация _off). Гарантируем
  // порт (интерфейс), чтобы к устройству можно было тянуть кабель.
  // ctx (от палитры/дропа, опц.): {siteId, locId, locName, name, provider} —
  // площадка/локация фиксируются из места дропа, имя/роль предзаполняются.
  async createConsumer(ctx = {}) {
    const roles = Object.values(state.roles), types = Object.values(state.dtypes);
    if (!roles.length || !types.length) {
      setStatus("нет ролей/типов — заведи их в NetBox (DCIM → Device Roles / Device Types)", "err");
      return;
    }
    const sites = state.group
      ? [...new Map(state.group.filter(r => r.site).map(r => [r.site.id, r.site])).values()] : [];
    if (!sites.length) { setStatus("выбери в дереве область с площадкой", "err"); return; }
    // Роль по подсказке: провайдер → роль с provider/провайдер в имени; иначе —
    // роль, чьё имя похоже на подпись (ПК/Камера…); иначе первая.
    const rx = ctx.provider ? /provider|провайдер/i : (ctx.name ? new RegExp(ctx.name, "i") : null);
    const rm = rx && roles.find(r => rx.test(r.name || ""));
    const where = ctx.locName ? "локация: " + ctx.locName : "вне стойки; провод потянешь к его порту";
    this.app.openModal("Новое устройство", where,
      [
        { id: "name", label: "Имя", value: ctx.name || "", placeholder: "ТВ переговорная" },
        { id: "role", label: "Роль (провайдер → над стойками)", type: "select",
          value: rm ? rm.id : roles[0].id,
          options: roles.map(r => ({ value: r.id, label: r.name })) },
        { id: "type", label: "Тип устройства", type: "select",
          options: types.map(t => ({ value: t.id, label: t.display || t.model })) },
        { id: "site", label: "Площадка", type: "select",
          value: ctx.siteId != null ? ctx.siteId : sites[0].id,
          options: sites.map(s => ({ value: s.id, label: s.name })) },
      ],
      async v => {
        if (!v.name) throw new Error("укажи имя");
        const body = { name: v.name, role: +v.role, device_type: +v.type, site: +v.site, status: "active" };
        if (ctx.locId) body.location = +ctx.locId;   // положить в локацию из дропа
        const dev = await api("/dcim/devices/", "POST", body);
        // Нет интерфейса (у типа не было шаблона) → добавим, чтобы был порт для кабеля.
        try {
          const ifaces = await apiAll("/dcim/interfaces/?device_id=" + dev.id);
          if (!ifaces.length)
            await api("/dcim/interfaces/", "POST", { device: dev.id, name: "port1", type: "1000base-t" });
        } catch (_) {}
        setStatus("создано устройство: " + v.name, "ok");
        await this.app.tree.reload();
      }, "Создать");
  }

  // Паспорт ЛОКАЦИИ (клик по серверной в дереве): список её устройств —
  // по стойкам + «Вне стоек» (потребители). Каждое кликабельно → его паспорт.
  // Данные берём из уже загруженного state.devices (scope=локация → это её девайсы).
  showLocation(loc) {
    this.current = null; this.currentPanel = null;
    const el = $("#detail");
    const rackDevs = state.devices.filter(d => d.rack);
    const offDevs = state.devices.filter(d => d._off && d.location && d.location.id === loc.id);
    const total = rackDevs.length + offDevs.length;
    el.innerHTML = this._detailHead(loc.name, "серверная · " + total + " устройств");
    Mode.syncButtons("detail");
    const row = d => {
      const color = (state.roles[d.role && d.role.id] || {}).color || "607d8b";
      const r = mk("div", { className: "loc-dev",
        html: `<span class="ld-dot" style="background:#${color}"></span>` +
          `<span class="ld-name">${d.name}</span>` +
          `<span class="ld-mut">${(d.device_type && d.device_type.model) || ""}</span>` });
      r.addEventListener("click", () => this.show(d));
      return r;
    };
    // По стойкам (сверху вниз по позиции).
    const byRack = {};
    for (const d of rackDevs) { const k = (d.rack.name || d.rack.display || "?"); (byRack[k] = byRack[k] || []).push(d); }
    for (const rk of Object.keys(byRack).sort()) {
      el.appendChild(mk("h4", { text: "Стойка " + rk }));
      byRack[rk].sort((a, b) => (b.position || 0) - (a.position || 0)).forEach(d => el.appendChild(row(d)));
    }
    if (offDevs.length) {
      el.appendChild(mk("h4", { text: "Вне стоек" }));
      offDevs.forEach(d => el.appendChild(row(d)));
    }
    if (!total) el.appendChild(mk("div", { className: "placeholder", text: "устройств нет" }));
  }

  // Привести компоненты устройства к его device type. NetBox инстанцирует порты
  // из шаблонов только при СОЗДАНИИ и не пересоздаёт при смене типа — это
  // действие ДОБАВЛЯЕТ недостающие и УДАЛЯЕТ лишние (которых нет в типе), чтобы
  // порты соответствовали типу (напр. у PDU — розетки, а не интерфейсы свича).
  // Удаление лишнего сносит и висящие на них кабели → спрашиваем подтверждение.
  // Все виды компонентов; front-порты/розетки ссылаются на rear/power по имени.
  KIND_ENDPOINTS = [
    ["interface-templates", "interfaces"],
    ["console-port-templates", "console-ports"],
    ["console-server-port-templates", "console-server-ports"],
    ["power-port-templates", "power-ports"],
    ["power-outlet-templates", "power-outlets"],
    ["rear-port-templates", "rear-ports"],
    ["front-port-templates", "front-ports"],
  ];
  async syncComponents(dev) {
    const dtId = dev.device_type.id;
    setStatus("сверяю компоненты с типом…");
    try {
      const plans = [];
      for (const [tmpl, comp] of this.KIND_ENDPOINTS) {
        const [tmpls, existing] = await Promise.all([
          apiAll(`/dcim/${tmpl}/?devicetype_id=${dtId}`),
          apiAll(`/dcim/${comp}/?device_id=${dev.id}`),
        ]);
        const tmplNames = new Set(tmpls.map(t => t.name));
        const haveNames = new Set(existing.map(c => c.name));
        plans.push({ tmpl, comp,
          toDelete: existing.filter(c => !tmplNames.has(c.name)) });
      }
      const nDelete = plans.reduce((s, p) => s + p.toDelete.length, 0);
      // Число добавляемых считаем как разницу шаблонов и уже имеющихся имён —
      // но проще собрать при создании; для диалога хватит «привести к типу».
      this.openModal("Привести порты к типу?",
        `Тип: ${dev.device_type.model}. Добавлю недостающие компоненты и удалю ${nDelete} лишних (которых нет в типе). Удаление снимет кабели на этих портах — действие необратимо.`,
        [], async () => this._applySync(dev, dtId, plans), "Применить");
    } catch (e) {
      setStatus("не удалось сверить: " + e.message, "err");
    }
  }
  async _applySync(dev, dtId, plans) {
    setStatus("привожу порты к типу…");
    try {
      // 1) Удаляем лишние. Сперва зависимые (front-порты, розетки), потом
      //    остальные (rear/power-порты и т.д.) — чтобы не ловить конфликты FK.
      const delOrder = ["front-ports", "power-outlets", "interfaces",
        "console-ports", "console-server-ports", "rear-ports", "power-ports"];
      const byComp = {}; plans.forEach(p => byComp[p.comp] = p);
      // IP, назначенные на интерфейсы устройства → снимаем перед удалением порта
      // (назначенный IP держит интерфейс: PROTECT → 409). Один запрос на устройство.
      const ipsByIface = {};
      try {
        for (const ip of await apiAll(`/ipam/ip-addresses/?device_id=${dev.id}`))
          if (ip.assigned_object_type === "dcim.interface" && ip.assigned_object_id)
            (ipsByIface[ip.assigned_object_id] = ipsByIface[ip.assigned_object_id] || []).push(ip);
      } catch (_) {}
      let removed = 0; const failed = [];
      for (const comp of delOrder) {
        const p = byComp[comp];
        if (!p) continue;
        for (const c of p.toDelete) {
          try {
            // Порт с зависимостями NetBox удалить не даёт (409, PROTECT). Сперва
            // снимаем кабель, а с интерфейса — назначенные IP, потом сам порт.
            const cableId = c.cable && (c.cable.id || c.cable);
            if (cableId) { try { await api(`/dcim/cables/${cableId}/`, "DELETE"); } catch (_) {} }
            if (comp === "interfaces") for (const ip of ipsByIface[c.id] || []) {
              try { await api(`/ipam/ip-addresses/${ip.id}/`, "PATCH",
                { assigned_object_type: null, assigned_object_id: null }); } catch (_) {}
            }
            await api(`/dcim/${comp}/${c.id}/`, "DELETE");
            removed++;
          } catch (e) { failed.push(c.name); }
        }
      }
      // 2) Создаём недостающие. Порядок: независимые + rear/power-порты раньше
      //    front-портов и розеток (те ссылаются на них по имени; re-fetch внутри).
      let created = 0;
      created += await this._syncKind(dev, dtId, "interface-templates", "interfaces");
      created += await this._syncKind(dev, dtId, "console-port-templates", "console-ports");
      created += await this._syncKind(dev, dtId, "console-server-port-templates", "console-server-ports");
      created += await this._syncKind(dev, dtId, "power-port-templates", "power-ports");
      created += await this._syncKind(dev, dtId, "rear-port-templates", "rear-ports");
      created += await this._syncFrontPorts(dev, dtId);
      created += await this._syncPowerOutlets(dev, dtId);
      const tail = failed.length
        ? ` · не удалось удалить ${failed.length} (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""})`
        : "";
      setStatus(`готово: +${created} / −${removed}${tail}`, failed.length ? "err" : "ok");
      await this.app.tree.reload();
    } catch (e) {
      setStatus("сбой синхронизации: " + e.message, "err");
    }
  }
  // Простые компоненты (без ссылок на другие порты): создаём недостающие по имени.
  async _syncKind(dev, dtId, tmplEp, compEp) {
    const [tmpls, existing] = await Promise.all([
      apiAll(`/dcim/${tmplEp}/?devicetype_id=${dtId}`),
      apiAll(`/dcim/${compEp}/?device_id=${dev.id}`),
    ]);
    const have = new Set(existing.map(c => c.name));
    let n = 0;
    for (const t of tmpls) {
      if (have.has(t.name)) continue;
      const body = { device: dev.id, name: t.name };
      if (t.type) body.type = t.type.value;
      if (compEp === "power-ports") {
        if (t.maximum_draw != null) body.maximum_draw = t.maximum_draw;
        if (t.allocated_draw != null) body.allocated_draw = t.allocated_draw;
      }
      if (compEp === "rear-ports" && t.positions != null) body.positions = t.positions;
      await api(`/dcim/${compEp}/`, "POST", body);
      n++;
    }
    return n;
  }
  // Front-порты ссылаются на rear-порт (по имени в шаблоне) — резолвим в id.
  async _syncFrontPorts(dev, dtId) {
    const [tmpls, existing, rears] = await Promise.all([
      apiAll(`/dcim/front-port-templates/?devicetype_id=${dtId}`),
      apiAll(`/dcim/front-ports/?device_id=${dev.id}`),
      apiAll(`/dcim/rear-ports/?device_id=${dev.id}`),
    ]);
    const have = new Set(existing.map(c => c.name));
    const rearByName = {}; rears.forEach(r => rearByName[r.name] = r.id);
    let n = 0;
    for (const t of tmpls) {
      if (have.has(t.name)) continue;
      const rearId = t.rear_port && rearByName[t.rear_port.name];
      if (!rearId) continue;   // без соответствующего rear-порта фронт не создать
      await api("/dcim/front-ports/", "POST", {
        device: dev.id, name: t.name, ...(t.type ? { type: t.type.value } : {}),
        rear_port: rearId, rear_port_position: t.rear_port_position || 1,
      });
      n++;
    }
    return n;
  }
  // Розетки питания могут ссылаться на power-порт (по имени) — резолвим опц.
  async _syncPowerOutlets(dev, dtId) {
    const [tmpls, existing, pports] = await Promise.all([
      apiAll(`/dcim/power-outlet-templates/?devicetype_id=${dtId}`),
      apiAll(`/dcim/power-outlets/?device_id=${dev.id}`),
      apiAll(`/dcim/power-ports/?device_id=${dev.id}`),
    ]);
    const have = new Set(existing.map(c => c.name));
    const ppByName = {}; pports.forEach(p => ppByName[p.name] = p.id);
    let n = 0;
    for (const t of tmpls) {
      if (have.has(t.name)) continue;
      const body = { device: dev.id, name: t.name };
      if (t.type) body.type = t.type.value;
      const ppName = t.power_port && t.power_port.name;
      if (ppName && ppByName[ppName]) body.power_port = ppByName[ppName];
      if (t.feed_leg) body.feed_leg = t.feed_leg.value || t.feed_leg;
      await api("/dcim/power-outlets/", "POST", body);
      n++;
    }
    return n;
  }
}
