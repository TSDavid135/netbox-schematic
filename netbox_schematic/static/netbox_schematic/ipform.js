"use strict";
// IpForm: умная форма назначения IP на интерфейс
// Поповер рядом с кнопкой +IP. Составной ввод: 4 октета + авто-маска из
// выбранной сети + индикатор свободности + разворачиваемый список адресов
// сети (свободные/занятые). Фронт собирает "a.b.c.d/mask" для POST.
//
// Сеть выбирается: авто-подбор подходящих префиксов (по сайту устройства /
// VLAN интерфейса) + возможность вручную выбрать любой из state.prefixes.

import { $, state } from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { parseIfaceName, ifacePortNum } from "./device.js";

// IPv4 helpers
const ipToInt = ip => ip.split(".").reduce((a, o) => (a << 8 >>> 0) + (+o), 0) >>> 0;
const intToIp = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join(".");
// Разбор CIDR "10.10.0.0/24" → {net:int, mask:int, bits}. Возвращает null для не-IPv4.
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

  // Один раз навесить обработчики на статичные части поповера.
  _wireStatic() {
    this.pop.querySelector(".if-cancel").addEventListener("click", () => this.close());
    this.pop.querySelector(".if-ok").addEventListener("click", () => this._submit());
    this.pop.querySelector(".if-list-btn").addEventListener("click", () => this._toggleList());
    this.pop.querySelector(".if-prefix").addEventListener("change", e => this._selectPrefix(e.target.value));
    // Октеты: авто-переход по точке/пробелу/цифрам, backspace назад.
    this.octs = [...this.pop.querySelectorAll(".if-oct")];
    this.octs.forEach((inp, i) => {
      inp.addEventListener("input", () => this._onOctInput(inp, i));
      inp.addEventListener("keydown", e => this._onOctKey(e, inp, i));
    });
  }

  // открыть форму для интерфейса
  async open(dev, iface, ev) {
    this.dev = dev;
    this.iface = iface;
    // «Порт: …» структурно: Тип + Стек/Слот подписями, сам порт — кружком.
    const pn = parseIfaceName(iface.name);
    const num = ifacePortNum(iface.name);
    // Стек/слот текстом, порт-часть заменяем на кружок (как на схеме).
    const labels = pn.parts.filter(p => p.label !== "Порт").map(p => `${p.label} ${p.value}`).join(" · ");
    this.pop.querySelector(".if-port").innerHTML =
      `<span class="if-iftype">${pn.type}</span>` +
      (labels ? ` · ${labels}` : "") +
      (num ? ` <span class="c-portdot">${num}</span>` : "");
    this.pop.querySelector(".if-dev").textContent = dev.name;
    this.octs.forEach(o => o.value = "");
    this._setFree(null);
    this._closeList();

    // Кандидаты-префиксы: авто (по VLAN интерфейса / сайту устройства) — сверху,
    // затем все остальные. Каждый пункт value = его id.
    const prefixes = this._candidatePrefixes(dev, iface);
    const sel = this.pop.querySelector(".if-prefix");
    sel.innerHTML = prefixes.map(p =>
      `<option value="${p.id}">${p.prefix}${p._auto ? " ★" : ""}${p.description ? " — " + p.description : ""}</option>`).join("");
    this._show(ev);
    if (prefixes.length) { sel.value = prefixes[0].id; await this._selectPrefix(prefixes[0].id); }
    else { this.cur = null; this.pop.querySelector(".if-mask").textContent = "/?"; }
    this.octs[0].focus();
  }

  // Подходящие префиксы: сначала «авто» (по сайту устройства), потом все.
  _candidatePrefixes(dev, iface) {
    const all = state.prefixes || [];
    const siteId = dev.site && dev.site.id;
    const auto = new Set();
    // VLAN интерфейса → префиксы этого VLAN.
    const vlanIds = new Set();
    if (iface.untagged_vlan) vlanIds.add(iface.untagged_vlan.id);
    for (const v of iface.tagged_vlans || []) vlanIds.add(v.id);
    for (const p of all) {
      if (p.vlan && vlanIds.has(p.vlan.id)) auto.add(p.id);
      else if (siteId && p.site && p.site.id === siteId) auto.add(p.id);
    }
    const tagged = all.map(p => ({ ...p, _auto: auto.has(p.id) }));
    // Авто — вперёд, затем по префиксу.
    return tagged.sort((a, b) => (b._auto - a._auto) || String(a.prefix).localeCompare(String(b.prefix)));
  }

  // выбор префикса → маска + загрузка занятых адресов
  async _selectPrefix(prefixId) {
    const p = (state.prefixes || []).find(x => String(x.id) === String(prefixId));
    if (!p) { this.cur = null; return; }
    const cidr = parseCidr(p.prefix);
    this.cur = { prefix: p, cidr };
    this.pop.querySelector(".if-mask").textContent = cidr ? "/" + cidr.bits : "/?";
    // Подставить сетевую часть в октеты (первые байты сети), хост оставить пустым.
    if (cidr) {
      const netOcts = intToIp(cidr.net).split(".");
      // Заполняем октеты, целиком покрытые маской (network-часть); хост-октеты чистим.
      const fullBytes = Math.floor(cidr.bits / 8);
      netOcts.forEach((v, i) => { this.octs[i].value = i < fullBytes ? v : ""; });
    }
    // Занятые адреса сети.
    this.used = new Set();
    try {
      const ips = await apiAll(`/ipam/ip-addresses/?parent=${encodeURIComponent(p.prefix)}`);
      ips.forEach(ip => { const a = String(ip.address).split("/")[0]; this.used.add(a); });
    } catch (e) { this.used = new Set(); /* нет данных о занятости — не блокируем */ }
    this._recheck();
    if (this._listOpen) this._renderList();
  }

  // октеты: ввод и навигация
  _onOctInput(inp, i) {
    // Пробел/точка в конце → переход к следующему октету (точка «добавлена»).
    if (/[ .]/.test(inp.value)) {
      inp.value = inp.value.replace(/[ .]/g, "");
      if (i < 3) this.octs[i + 1].focus();
    }
    // Только цифры, 0–255.
    inp.value = inp.value.replace(/\D/g, "").slice(0, 3);
    if (inp.value !== "" && +inp.value > 255) inp.value = "255";
    // Авто-переход при 3 цифрах или значении, однозначно требующем перехода.
    if (inp.value.length === 3 && i < 3) this.octs[i + 1].focus();
    this._recheck();
  }
  _onOctKey(e, inp, i) {
    if ((e.key === "." || e.key === " ") && i < 3) { e.preventDefault(); this.octs[i + 1].focus(); }
    else if (e.key === "Backspace" && inp.value === "" && i > 0) { e.preventDefault(); this.octs[i - 1].focus(); }
    else if (e.key === "Enter") { e.preventDefault(); this._submit(); }
    else if (e.key === "Escape") { e.preventDefault(); this.close(); }
  }

  // Текущий адрес из октетов (или null, если не все 4 заполнены валидно).
  _currentIp() {
    const vals = this.octs.map(o => o.value);
    if (vals.some(v => v === "" || +v > 255)) return null;
    return vals.join(".");
  }
  // Проверить свободность и обновить индикатор.
  _recheck() {
    const ip = this._currentIp();
    if (!ip) { this._setFree(null); return; }
    // Адрес должен принадлежать выбранной сети.
    if (this.cur && this.cur.cidr) {
      const n = ipToInt(ip);
      const inNet = (n & this.cur.cidr.maskInt) >>> 0;
      if (inNet !== this.cur.cidr.net) { this._setFree("out"); return; }
    }
    this._setFree(this.used && this.used.has(ip) ? false : true);
  }
  // Индикатор: true=свободен(зел), false=занят(крас), "out"=вне сети, null=нейтр.
  _setFree(state_) {
    const dot = this.pop.querySelector(".if-dot");
    dot.className = "if-dot" +
      (state_ === true ? " ok" : state_ === false ? " busy" : state_ === "out" ? " out" : "");
    dot.title = state_ === true ? "адрес свободен" : state_ === false ? "адрес занят"
      : state_ === "out" ? "адрес вне выбранной сети" : "";
  }

  // список адресов сети (свободные/занятые)
  _toggleList() { this._listOpen ? this._closeList() : this._openList(); }
  _openList() {
    this._listOpen = true;
    this.pop.classList.add("with-list");
    this._renderList();
    this._reposition();   // список расширил поповер вправо — удержать в окне
  }
  _closeList() { this._listOpen = false; this.pop.classList.remove("with-list"); }

  // Сдвинуть поповер так, чтобы он целиком помещался в окно (после смены ширины).
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
    // Хостовые адреса: пропускаем сетевой (первый) и широковещательный
    // (последний) для обычных сетей /<31. Для /31 и /32 показываем все.
    const skipEnds = bits < 31;
    const firstK = skipEnds ? 1 : 0;
    const lastK = skipEnds ? size - 1 : size;   // exclusive верхняя граница
    // Ограничим отрисовку (большие сети): максимум 256 адресов.
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

  // отправка
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

  // позиционирование/закрытие
  _show(ev) {
    const pop = this.pop;
    pop.classList.add("open");
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const LIST_W = 200;   // запас справа под разворачиваемый список адресов
    // Кнопка +IP у правого края панели, поэтому по умолчанию ставим поповер
    // ЛЕВЕЕ курсора и резервируем справа место под список, чтобы он не вылезал.
    let x = ev.clientX - 12 - w;
    if (x < 8) x = ev.clientX + 12;                       // не влез слева — вправо
    if (x + w + LIST_W > innerWidth - 8)                  // с учётом будущего списка
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
