"use strict";
// Провода, радио-линки, маршрутизация — примесь к прототипу SchemaManager (вынесено из schema.js).
// Методы копируются в SchemaManager.prototype через _mixin (см. schema.js).
import {
  $, state, mk, px, attachTip, collapsible, portKey, termKey, currentLocationName, modeBtn,
  PORT_KINDS, KIND_RU, COMPAT, cableTypeGroups, cableFamiliesFor, cableFamily, FAMILY_LABEL,
  COL_W, COL_GAP, NODE_GAP, BOX_PAD, DOT, STEP, EXTRA,
} from "./core.js";
import { api, apiAll, setStatus } from "./api.js";
import { Mode } from "./modes.js";
import { wavyAlong, wavyCurve, smoothPath, cubicPath, orthoPath, hopSegment, groupByKey, shortPortName, unionBox } from "./schema_util.js";

class _Mixin {
  // радио-линки (слой Wireless / сетевой режим)
  // Волнистая линия между двумя wireless-интерфейсами (у радио-линка нет
  // кабеля → своя геометрия). Рисуется, когда: активен wireless-слой ИЛИ
  // включён сетевой режим отображения (там радио-связи видны всегда). Зовётся
  // из redrawWires (пережить зум) и при выборе/снятии слоя/режима.
  drawRadioLinks() {
    const svg = $("#wires");
    if (!svg) return;
    svg.querySelectorAll(".radiowire").forEach(el => el.remove());
    // источник пар: активный wireless-слой, иначе — все радио-линки группы
    // (в сетевом режиме); в физическом режиме без слоя — не рисуем. Пары
    // пересобираем СВЕЖИМИ по текущему state.ports (режим мог перезаписать
    // порты), чтобы не зависеть от того, в каком режиме был renderPanel.
    const a = state.activeLayer;
    let pairs = null;
    if (a && a.kind === "wireless" && a.pairs) pairs = a.pairs;
    else if (state.viewMode === "net" && this.app.layers)
      pairs = this.app.layers._collectWireless().pairs;
    if (!pairs || !pairs.length) return;
    const rect = $("#schema").getBoundingClientRect();
    const z = state.zoom, base = { left: rect.left, top: rect.top };
    const center = el => {
      const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z];
    };
    // Радио-линки идут по ТОЙ ЖЕ трассе, что и кабели (short/extend, высота
    // магистрали, коридоры, дорожки) — только мостики им не нужны. В режиме
    // «Углы» ведём волну вдоль угольной ломаной, в «Круглых» — прямая волна.
    const angular = state.wireStyle === "angular";
    const extend = state.wirePath === "extend";
    const ctx = this._routeCtx();
    for (const pair of pairs) {
      const pa = state.ports[pair.a], pb = state.ports[pair.b];
      if (!pa || !pb) continue;
      const [ax, ay] = center(pa.el), [bx, by] = center(pb.el);
      const w = { a: pa, b: pb, ax, ay, bx, by,
        crossRack: this._crossRack(pa.dev.id, pb.dev.id) };
      // Провод в обход нод нужен, когда «Расширенный» и между нодами одной
      // стойки есть другие (разница индексов ≥ 2) — тогда ведём по трассе.
      const around = extend && !w.crossRack
        && Math.abs(state.devNodeIdx[pa.dev.id] - state.devNodeIdx[pb.dev.id]) >= 2;
      let d;
      if (angular) {
        d = wavyAlong(this._routePolyline(w, ctx));            // волна вдоль углов
      } else if (around) {
        d = wavyAlong(this._routePolyline(w, ctx));            // «Круглый»+обход → по трассе
      } else {
        d = wavyCurve(ax, ay, bx, by);                        // «Круглый» → закруглённая кривая
      }
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("class", "radiowire");
      p.dataset.wlink = pair.id;
      svg.appendChild(p);
    }
  }

  // провода
  redrawWires() {
    const svg = $("#wires");
    if (!svg) return;
    const canvas = $("#schema");
    svg.setAttribute("width", canvas.scrollWidth);
    svg.setAttribute("height", canvas.scrollHeight);
    svg.innerHTML = "";
    const base = canvas.getBoundingClientRect();
    const z = state.zoom;
    const center = el => {
      const r = el.getBoundingClientRect();
      return [(r.left - base.left + r.width / 2) / z, (r.top - base.top + r.height / 2) / z];
    };
    // В «Беспроводном» виде физические кабели/питание не рисуем — там только
    // радио-линии (узлы показывают лишь радио-порты). Контуры НЕ рефитим: ноды
    // сжимаются (меньше портов) → контур бы «прыгал» под их размер. Оставляем
    // геометрию из физического вида — контур отражает размеры устройств, а не
    // сжатых нод (small_fix: при смене на беспроводной контур ехал).
    if (state.viewMode === "net") { this.drawRadioLinks(); return; }
    // Стиль проводов: "round" — прежние дуги; "angular" — угольная (Manhattan)
    // разводка с «мостиками»-полуокружностями на пересечениях (см. UI-кнопки).
    if (state.wireStyle === "angular") this._drawAngularWires(svg, center);
    else this._drawRoundWires(svg, center);
    // Линии питания щитков (фидер → PDU Input) — отдельным проходом, т.к.
    // у фидера нет записи в state.ports (он не «порт устройства»).
    this._drawFeedWires(svg, center);
    // Провода пересозданы — заново наложить скрытие фильтра по семействам.
    if (this.app.filter) this.app.filter.apply();
    // …и подсветку активного слоя (иначе при зуме выделение слоя сбрасывалось).
    if (this.app.layers) this.app.layers.reapplyToWires();
    // Радио-линии под текущий режим/слой (drawRadioLinks сам решает рисовать/
    // нет). НЕ зовём applyViewMode отсюда — иначе рекурсия через relayoutNodes.
    this.drawRadioLinks();
    // Вписать контуры серверных/площадок в их внутренние провода (не вылезать).
    this._fitContoursToWires();
  }

  // Один <path> провода со всей обвязкой (цвет по семейству, тултип, ховер,
  // клик-меню). Общий для round/angular разводки, чтобы не дублировать.
  _wirePathEl(c, a, b, d, isPower) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    // Цвет провода — по семейству типа кабеля (c.type). Если тип не задан,
    // fallback на прежнее поведение: питание — power, данные — data.
    const fam = cableFamily(c.type);
    const colorCls = c.type ? "cbl-" + fam : (isPower ? "power" : "data");
    p.setAttribute("class", "wire " + colorCls);
    p.id = "w" + c.id;
    p.dataset.cable = c.id;
    // семейство для фильтра: с типом — по типу, без типа — power/без-типа
    p.dataset.fam = c.type ? fam : (isPower ? "power" : "default");
    attachTip(p, () => `<div class="t-title t-cabletitle"><span>Кабель #${c.id}${c.label ? " «" + c.label + "»" : ""}</span><span class="t-type"><span class="t-sw" style="background:var(--cbl-${cableFamily(c.type)})"></span>Тип: ${this._cableTypeLabel(c.type)}</span></div>
      <div class="t-line">${a.dev.name} · ${a.item.name}</div>
      <div class="mid" style="color:var(--accent)">⇅</div>
      <div class="t-line">${b.dev.name} · ${b.item.name}</div>`);
    p.addEventListener("mouseenter", () => this._hoverWire(c.id, a, b, true));
    p.addEventListener("mouseleave", () => this._hoverWire(c.id, a, b, false));
    p.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!Mode.on("schema")) { this._hoverWire(c.id, a, b, true); return; }
      this._openLinkMenu(a.item, a.dev, a.el, ev, c.id);
    });
    return p;
  }

  // Каждый кабель → пара портов {a,b} + флаги, если оба конца в DOM. Общий
  // разбор для round/angular. Возвращает [{c,a,b,ax,ay,bx,by,isPower,crossRack}].
  _wireEnds(center) {
    const out = [];
    for (const c of state.cables) {
      const aT = (c.a_terminations || [])[0], bT = (c.b_terminations || [])[0];
      if (!aT || !bT) continue;
      // Линии фидер↔PDU рисует отдельный проход (_drawFeedWires): у щитка нет
      // геометрии узла (колонки/индекса) для общего роутера углов → иначе NaN
      // в трассе. Здесь пропускаем.
      if (aT.object_type === "dcim.powerfeed" || bT.object_type === "dcim.powerfeed") continue;
      const a = state.ports[termKey(aT)], b = state.ports[termKey(bT)];
      if (!a || !b) continue;
      const [ax, ay] = center(a.el), [bx, by] = center(b.el);
      out.push({ c, a, b, ax, ay, bx, by,
        isPower: aT.object_type.includes("power") || bT.object_type.includes("power"),
        crossRack: this._crossRack(a.dev.id, b.dev.id),
        // Хотя бы один конец ВНЕ стойки (потребитель/провайдер справа) — для них
        // особая трасса (перпендикулярный выход с запасом), см. _offRackRoute.
        offRack: state.devRack[a.dev.id] == null || state.devRack[b.dev.id] == null });
    }
    return out;
  }
  // Трасса к устройству ВНЕ стойки (потребитель/провайдер справа). Горизонталь
  // ведём на уровне СТОЕЧНОГО конца (его перпендикулярный выход попадает в ЗАЗОР
  // между нодами стойки — там чисто), а разницу высот добираем ВЕРТИКАЛЬНЫМ
  // каналом у самого внестоечного узла (в пустом промежутке между контурами).
  // Так провод не режет чужие ноды (напр. pp-r02) и не липнет к их портам.
  // k — индекс дорожки (разброс параллельных). small_fix.
  _offRackRoute(w, k) {
    const { a, b, ax, ay, bx, by } = w;
    const CL = 22 + (k % 5) * 11;
    const aRack = state.devRack[a.dev.id] != null;
    // rk — стоечный конец (или a, если оба вне стойки); of — внестоечный.
    const rk = aRack ? { x: ax, y: ay, side: a.side }
      : { x: bx, y: by, side: b.side };
    const of = aRack ? { x: bx, y: by, side: b.side, dev: b.dev }
      : { x: ax, y: ay, side: a.side, dev: a.dev };
    const rOut = rk.side === "t" ? rk.y - CL : rk.y + CL;   // уровень горизонтали
    const oOut = of.side === "t" ? of.y - CL : of.y + CL;   // подход к порту внестоечного
    // Канал — чуть ЛЕВЕЕ внестоечного узла (в чистом промежутке между контурами).
    const offNode = state.nodeEls[of.dev.id];
    const nodeLeft = offNode ? (parseFloat(offNode.style.left) || of.x - 40) : of.x - 40;
    const channelX = nodeLeft - 28 + (k % 4) * 9;   // небольшой разброс каналов
    return [[rk.x, rk.y], [rk.x, rOut], [channelX, rOut], [channelX, oOut], [of.x, oOut], [of.x, of.y]];
  }
  // «Межстоечный» ли провод — ТОЛЬКО если оба конца в стойках. Конец на
  // устройстве вне стойки (devRack==null — потребитель/провайдер) → crossRack
  // false → провод рисуется простой кривой (без коридоров/шины, которым нужны
  // devCol/devNodeIdx, отсутствующие у вне-стоечных нод).
  _crossRack(aId, bId) {
    const ra = state.devRack[aId], rb = state.devRack[bId];
    return ra != null && rb != null && ra !== rb;
  }

  // Высота горизонтальной шины магистралей (верхние провода между пач-панелями).
  // РАНЬШЕ уводила почти к верху холста (слишком далеко). Теперь — чуть выше
  // верхних портов, «лесенкой» по каналам, чтобы провода жались к панелям.
  _trunkBusY(ay, by, chan, hi) {
    return Math.max(6, Math.min(ay, by) - (26 + chan * 22) - (hi - 1) * 40);
  }

  // «Круглые» провода: дуги/изгибы
  _drawRoundWires(svg, center) {
    const { LEFT_PAD } = this;
    const hi = state.wireHeightK ?? 1;
    const extend = state.wirePath === "extend";
    const ctx = this._routeCtx();   // для обхода нод в «Расширенном»
    let chan = 0, lane = 0;
    for (const w of this._wireEnds(center)) {
      const { c, a, b, ax, ay, bx, by, isPower, crossRack, offRack } = w;
      let d;
      if (offRack) {
        // Устройство вне стойки: горизонталь на уровне стоечного порта (в зазоре
        // между нодами) + вертикальный канал у внестоечного узла — не режет
        // чужие ноды и не липнет к их портам.
        d = smoothPath(this._offRackRoute(w, lane++), 16);
      } else if (crossRack && state.devNodeIdx[a.dev.id] === 0 && state.devNodeIdx[b.dev.id] === 0) {
        const lift = this._trunkBusY(ay, by, chan++, hi);
        d = cubicPath(ax, ay, bx, by, lift, lift);
      } else if (crossRack) {
        const leftCol = Math.min(state.devCol[a.dev.id], state.devCol[b.dev.id]);
        // Больше дорожек в коридоре (9 вместо 8) и БОЛЬШЕ уровней высоты выноса
        // (6 вместо 3), причём выносы у источника и приёмника РАСкоррелированы
        // ((k+3)%6) — так горизонтальные участки соседних проводов не ложатся на
        // одну высоту (small_fix: провода всё ещё накладывались).
        const k = lane++;
        const gapX = LEFT_PAD + (leftCol + 1) * (this.SLOT + COL_GAP) - COL_GAP / 2 + (k % 9) * 15 - 60;
        const aOut = a.side === "t" ? ay - (18 + (k % 6) * 10) * hi : ay + (18 + (k % 6) * 10) * hi;
        const bOut = b.side === "t" ? by - (18 + ((k + 3) % 6) * 10) * hi : by + (18 + ((k + 3) % 6) * 10) * hi;
        d = orthoPath(ax, ay, bx, by, gapX, aOut, bOut);
      } else if (extend && Math.abs(state.devNodeIdx[a.dev.id] - state.devNodeIdx[b.dev.id]) >= 2) {
        // «Расширенный» и в «Круглых»: обход нод боковым коридором, но со
        // СКРУГЛЁННЫМИ углами (гладкая кривая, а не прямые углы).
        d = smoothPath(this._routePolyline(w, ctx));
      } else {
        const midBend = (ay < by ? 1 : -1) * (40 + (c.id % 4) * 8) * hi;
        d = cubicPath(ax, ay, bx, by, ay + midBend, by - midBend);
      }
      svg.appendChild(this._wirePathEl(c, a, b, d, isPower));
    }
  }

  // Ломаные (массивы точек) всех кабелей под текущую трассу (short/extend).
  //  · магистраль — верхняя шина (см. _trunkBusY);
  //  · межстоечные — через боковой вертикальный коридор gapX (нод там нет);
  //  · внутри стойки:
  //      short  — прямая перемычка на средней высоте (может пройти по ноде);
  //      extend — в ОБХОД нод: выход за край → боковой коридор колонки → вход.
  //    Коридорные вертикали разнесены по «дорожкам» (lane) — так параллельные
  //    соединения идут рядом, а не друг в друге (small_fix: провода п.2).
  _wirePolylines(center) {
    const ctx = this._routeCtx();
    return this._wireEnds(center).map(w => ({ ...w, pts: this._routePolyline(w, ctx) }));
  }

  // Контекст маршрутизации: множители/счётчики «дорожек» (lane) для разнесения
  // параллельных проводов. Свой на каждый проход (кабели / радио).
  _routeCtx() {
    return { LEFT_PAD: this.LEFT_PAD, hi: state.wireHeightK ?? 1,
      extend: state.wirePath === "extend", chan: 0, lane: 0, slane: 0, idx: 0 };
  }

  // Ломаная ОДНОГО соединения под текущую трассу. Общая для кабелей и радио —
  // так «все преобразования» (short/extend, высота магистрали, коридоры,
  // дорожки) применяются и к Wireless. Мостики к результату не относятся —
  // их накладывает только отрисовщик кабелей (у радио их нет).
  _routePolyline(w, ctx) {
    const { a, b, ax, ay, bx, by, crossRack, offRack } = w;
    const { LEFT_PAD, hi, extend } = ctx;
    const vary = w.c ? w.c.id : ctx.idx++;   // у радио нет c.id — берём индекс
    // Устройство вне стойки — горизонталь на уровне стоечного порта + канал у
    // внестоечного узла (см. _offRackRoute), чтобы не резать чужие ноды.
    if (offRack) return this._offRackRoute(w, ctx.lane++);
    if (crossRack && state.devNodeIdx[a.dev.id] === 0 && state.devNodeIdx[b.dev.id] === 0) {
      const busY = this._trunkBusY(ay, by, ctx.chan++, hi);
      return [[ax, ay], [ax, busY], [bx, busY], [bx, by]];
    }
    if (crossRack) {
      const leftCol = Math.min(state.devCol[a.dev.id], state.devCol[b.dev.id]);
      const k = ctx.lane++;
      const gapX = LEFT_PAD + (leftCol + 1) * (this.SLOT + COL_GAP) - COL_GAP / 2 + (k % 9) * 15 - 60;
      const aOut = a.side === "t" ? ay - (18 + (k % 6) * 10) * hi : ay + (18 + (k % 6) * 10) * hi;
      const bOut = b.side === "t" ? by - (18 + ((k + 3) % 6) * 10) * hi : by + (18 + ((k + 3) % 6) * 10) * hi;
      return [[ax, ay], [ax, aOut], [gapX, aOut], [gapX, bOut], [bx, bOut], [bx, by]];
    }
    if (extend && Math.abs(state.devNodeIdx[a.dev.id] - state.devNodeIdx[b.dev.id]) >= 2) {
      // «Расширенный»: провод НИКОГДА не идёт по ноде — уходит за её край и
      // спускается/поднимается в боковом коридоре колонки (там нод нет). НО
      // только когда между нодами ЕСТЬ другая нода (разница индексов ≥ 2);
      // соседние ноды соединяем напрямую (в бок уводить незачем).
      const col = state.devCol[a.dev.id];
      const k = ctx.slane++;
      const corr = LEFT_PAD + (col + 1) * (this.SLOT + COL_GAP) - COL_GAP / 2 - 52 + (k % 6) * 12;
      const aOut = a.side === "t" ? ay - (16 + (k % 3) * 6) : ay + (16 + (k % 3) * 6);
      const bOut = b.side === "t" ? by - (16 + (k % 3) * 6) : by + (16 + (k % 3) * 6);
      return [[ax, ay], [ax, aOut], [corr, aOut], [corr, bOut], [bx, bOut], [bx, by]];
    }
    // «Короткий»: прямая перемычка на средней высоте.
    const aOut = a.side === "t" ? ay - (14 + (vary % 3) * 6) * hi : ay + (14 + (vary % 3) * 6) * hi;
    const bOut = b.side === "t" ? by - (14 + (vary % 3) * 6) * hi : by + (14 + (vary % 3) * 6) * hi;
    const busY = (aOut + bOut) / 2;
    return [[ax, ay], [ax, busY], [bx, busY], [bx, by]];
  }

  // «Углы» провода: угольная (Manhattan) разводка + мостики
  // Горизонтальные участки, пересекая ЧУЖИЕ вертикали, обходят их мостиком-
  // полуокружностью (hopSegment) — так провода не «сливаются». Близкие
  // пересечения объединяются в один широкий мост (см. hopSegment).
  _drawAngularWires(svg, center) {
    const polys = this._wirePolylines(center);
    // Вертикальные сегменты всех ломаных — препятствия для мостиков.
    const verts = [];
    for (const pl of polys)
      for (let i = 1; i < pl.pts.length; i++) {
        const [x1, y1] = pl.pts[i - 1], [x2, y2] = pl.pts[i];
        if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) > 0.5)
          verts.push({ x: x1, y1: Math.min(y1, y2), y2: Math.max(y1, y2), id: pl.c.id });
      }
    // Строим d: вертикали прямые, горизонтали с мостиками над чужими.
    for (const pl of polys) {
      const p0 = pl.pts[0];
      let d = `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`;
      for (let i = 1; i < pl.pts.length; i++) {
        const [x1, y1] = pl.pts[i - 1], [x2, y2] = pl.pts[i];
        if (Math.abs(y1 - y2) < 0.5 && Math.abs(x1 - x2) > 0.5) {
          const xs = verts.filter(v => v.id !== pl.c.id
            && v.x > Math.min(x1, x2) + 1 && v.x < Math.max(x1, x2) - 1
            && y1 > v.y1 - 0.5 && y1 < v.y2 + 0.5).map(v => v.x);
          d += hopSegment(x1, y1, x2, xs);
        } else {
          d += ` L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        }
      }
      svg.appendChild(this._wirePathEl(pl.c, pl.a, pl.b, d, pl.isPower));
    }
  }

}
export const WireMethods = _Mixin.prototype;
