"use strict";
// Взаимодействие: ховер, прицел, прокладка, трассировка — примесь к прототипу SchemaManager (вынесено из schema.js).
// Методы копируются в SchemaManager.prototype через _mixin (см. schema.js).
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

class _Mixin {
  _hoverWire(cableId, a, b, on) {
    if (state.pending) return;
    if (this._traceActive) return;   // трасса зафиксирована — ховер её не трогает (q9)
    document.querySelectorAll("#wires path.wire").forEach(p => {
      const mine = +p.dataset.cable === cableId;
      p.classList.toggle("dim", on && !mine);
      if (mine) p.classList.toggle("hl", on);
    });
    a.el.classList.toggle("hl", on);
    b.el.classList.toggle("hl", on);
    const keep = new Set([a.dev.id, b.dev.id]);
    // Узлы-концы связи — не просто «не гасим», а ЯРКО подсвечиваем (обводка),
    // как порты и провод; остальные — тускнеют. Иначе провод горит, а порты и
    // сами ноды по краям — нет.
    Object.entries(state.nodeEls).forEach(([id, el]) => {
      const mine = keep.has(+id);
      el.classList.toggle("dim2", on && !mine);
      el.classList.toggle("conn-hl", on && mine);
    });
    // Щитки питания в связи порт↔порт не участвуют — гасим их вместе с фоном.
    Object.values(state.powerBoxEls || {}).forEach(el => el.classList.toggle("dim2", on));
  }
  _portHover(port, on) {
    if (state.pending) return;
    if (this._traceActive) return;   // трасса зафиксирована — ховер её не трогает (q9)
    // Радио-порт: кабеля нет, подсвечиваем радио-линию и дальний конец.
    if (!port.item.cable && port.item.wireless_link) { this._hoverRadio(port, on); return; }
    if (!port.item.cable) return;
    const cable = state.cables.find(c => c.id === port.item.cable.id);
    if (!cable) return;
    const aT = (cable.a_terminations || [])[0], bT = (cable.b_terminations || [])[0];
    const a = aT && state.ports[termKey(aT)], b = bT && state.ports[termKey(bT)];
    if (a && b) this._hoverWire(cable.id, a, b, on);
  }

  // Ховер по wireless-порту: подсветить его радио-линию + оба конца (как
  // _hoverWire для кабеля). Пара берётся из _collectWireless (по данным).
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

  // прицеливание / выбор порта
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
    // Создание circuit кликом по свободному проводному порту УБРАНО: circuit
    // теперь только отображается облачком на «Физическом» виде, а заводится в
    // NetBox напрямую (позже — через «провайдер как нода»). Свободный радио-порт
    // в «Беспроводном»+edit идёт в общий pending-поток ниже (→ WirelessLink).
    if (item.cable && !state.pending) {
      if (edit) { this._openLinkMenu(item, dev, dot, ev); return; }
      // Просмотр: ОДИНОЧНОЕ нажатие — подсветить ТОЛЬКО связь (кабель между
      // двумя портами). Продолжение (трасса через пач-панель) — по ДВОЙНОМУ
      // (см. _onPortDblClick). Так одинаково работает на тач-устройствах.
      this._traceLocal(item);
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
    // Радио-связь: если ОБА конца — wireless-интерфейсы, создаём WirelessLink
    // (не Cable — у радио нет провода). Тип кабеля не спрашиваем.
    if (this._isWirelessTerm(a) && this._isWirelessTerm({ otype: kind.otype, id: item.id })) {
      this.setPending(null);
      await this._createWirelessLink(a, item.id, bLabel);
      return;
    }
    this.setPending(null);
    this._openCablePopover(a, { otype: kind.otype, id: item.id }, bLabel, ev);
  }

  // СЕЙЧАС НЕ ВЫЗЫВАЕТСЯ (создание circuit кликом убрано — см. _onPortClick).
  // Оставлено заготовкой под будущее «провайдер как нода»: мини-форма
  // (провайдер + cid), затем цепочка POST — circuit → termination(A, site) →
  // cable(term↔порт). Второй конец circuit «в облаке» (у провайдера).
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
      // 2) термination A на сайте устройства
      const term = await api("/circuits/circuit-terminations/", "POST",
        { circuit: circ.id, term_side: "A", termination_type: "dcim.site", termination_id: siteId });
      // 3) кабель термination ↔ порт
      await api("/dcim/cables/", "POST", {
        a_terminations: [{ object_type: "circuits.circuittermination", object_id: term.id }],
        b_terminations: [{ object_type: "dcim.interface", object_id: item.id }],
        status: "connected",
      });
      setStatus("circuit " + v.cid + " подключён к " + dev.name + "/" + item.name, "ok");
      await this.app.tree.reload();   // circuits грузятся в connect() → полный reconnect
    });
  }

  // Является ли терминация {otype,id} wireless-интерфейсом (радио-тип).
  _isWirelessTerm(term) {
    if (term.otype !== "dcim.interface") return false;
    const p = state.ports[portKey(term.otype, term.id)];
    if (!p) return false;
    const t = (p.item.type && p.item.type.value) || "";
    return !!p.item.wireless_link || t.startsWith("ieee802.11") || t.startsWith("other-wireless");
  }

  // Создать WirelessLink между двумя интерфейсами (a.id ↔ bId).
  async _createWirelessLink(a, bId, bLabel) {
    try {
      await api("/wireless/wireless-links/", "POST",
        { interface_a: a.id, interface_b: bId, status: "connected" });
      setStatus("радио-линк создан: " + a.label + " ⇄ " + bLabel, "ok");
      // wireless-links грузятся в connect() → полный reconnect обновит state
      await this.app.tree.reload();
    } catch (e) {
      setStatus("не удалось создать радио-линк: " + e.message, "err");
    }
  }

  // поповер выбора типа кабеля (рядом с портом, не модалка)
  _openCablePopover(a, b, bLabel, ev) {
    const pop = this.cablepop;
    // Список типов, ограниченный видом соединения (питание → только power,
    // данные → всё, кроме power). «без типа» — всегда первым.
    const allow = cableFamiliesFor(a.otype, b.otype);
    const groups = [{ group: "—", opts: [["", "без типа"]] }, ...cableTypeGroups(allow)];
    const isPower = allow.has("power") && allow.size === 1;
    const sel = pop.querySelector(".cp-type");
    sel.innerHTML = groups.map(g =>
      `<optgroup label="${g.group}">` +
      g.opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("") +
      `</optgroup>`).join("");
    sel.value = isPower ? "power" : "";
    pop.querySelector(".cp-where").textContent = a.label + " ⇄ " + bLabel;

    // Позиционируем рядом с портом (по курсору), в пределах окна.
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
        if (type) body.type = type;   // пусто = без типа (нейтральный цвет)
        await api("/dcim/cables/", "POST", body);
        setStatus("кабель проложен: " + a.label + " ⇄ " + bLabel, "ok");
        await this.refreshCables();
      } catch (e) {
        setStatus("не получилось: " + e.message, "err");
      }
    };
  }

  // мини-меню связи
  _openLinkMenu(item, dev, dot, ev, cableId) {
    state.linkCtx = { cableId: cableId || (item.cable && item.cable.id), item, dev };
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

  // трасса
  // ОДИНОЧНОЕ нажатие по занятому порту — подсветить ТОЛЬКО его связь.
  _traceLocal(item) {
    this._clearTrace();                                     // сброс прежней подсветки
    const cable = state.cables.find(c => c.id === (item.cable && item.cable.id));
    if (!cable) return;
    const aT = (cable.a_terminations || [])[0], bT = (cable.b_terminations || [])[0];
    const a = aT && state.ports[termKey(aT)], b = bT && state.ports[termKey(bT)];
    if (a && b) {
      this._hoverWire(cable.id, a, b, true);
      this._armTraceClear();
      setStatus(`кабель: ${a.dev.name}/${a.item.name} ⇄ ${b.dev.name}/${b.item.name} — клик снимет`, "ok");
    }
  }
  // ДВОЙНОЕ нажатие по занятому порту — продолжение (полная трасса через
  // пач-панели). Только для interface/power (у них есть API-трасса); у
  // front/rear/console продолжения нет → показываем просто связь.
  _onPortDblClick(kind, item) {
    if (Mode.on("schema") || state.pending || !item.cable) return;
    if (kind.ep === "interfaces" || kind.ep === "power-ports" || kind.ep === "power-outlets")
      this._trace(kind.ep, item);
    else
      this._traceLocal(item);
  }
  async _trace(ep, item) {
    this._clearTrace();                                     // сброс прежней подсветки/затемнения
    try {
      const segments = await api(`/dcim/${ep}/${item.id}/trace/`);
      const cableIds = new Set(segments.map(s => s[1] && s[1].id).filter(Boolean));
      const portKeys = new Set(), devIds = new Set(), panelIds = new Set();
      for (const seg of segments)
        for (const side of [seg[0], seg[2]])
          for (const t of (side || [])) {
            if (t.device) devIds.add(t.device.id);
            const m = (t.url || "").match(/\/dcim\/([a-z-]+)\/(\d+)\//);
            if (m && EP_TO_OTYPE[m[1]]) portKeys.add(EP_TO_OTYPE[m[1]] + ":" + m[2]);
            // фидер в трассе питания → его щиток оставляем ярким (не гасим)
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
      // Ноды трассы — ярко (hl), ОСТАЛЬНЫЕ тускнеют (dim2). Чистим conn-hl от
      // прежнего ховера/одиночного клика, чтобы затемнение не «залипало» под
      // продолжением (была именно эта загвоздка).
      Object.entries(state.nodeEls).forEach(([id, el]) => {
        const inTrace = devIds.has(+id);
        el.classList.toggle("hl", inTrace);
        el.classList.toggle("dim2", !inTrace);
        el.classList.remove("conn-hl");
      });
      Object.entries(state.rackDevEls).forEach(([id, el]) => el.classList.toggle("hl", devIds.has(+id)));
      // Щитки: гаснут все, кроме тех, чей фидер попал в трассу питания.
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
  // Зафиксировать трассу: ховер её больше не трогает (_traceActive), и ЛЮБОЙ
  // клик (не перетаскивание/пан, не по порту) её снимает — «клик по любому
  // месту убирает» (q9). Регистрируем после текущего события, чтобы не поймать
  // клик, породивший трассу.
  _armTraceClear() {
    this._traceActive = true;
    if (this._traceHandlers) return;   // уже вооружено
    let sx = 0, sy = 0;
    const down = ev => { sx = ev.clientX; sy = ev.clientY; };
    const up = ev => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) return;   // пан/драг — не снимаем
      if (ev.target.closest && ev.target.closest(".port")) return;             // порт сам стартует трассу
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
    if (this._traceHandlers) {
      document.removeEventListener("mousedown", this._traceHandlers.down, true);
      document.removeEventListener("mouseup", this._traceHandlers.up, true);
      this._traceHandlers = null;
    }
  }

  // зум / центровка
}
export const InteractMethods = _Mixin.prototype;
