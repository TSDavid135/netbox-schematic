"use strict";
// Контуры серверных/площадок (scope) — примесь к прототипу SchemaManager (вынесено из schema.js).
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
  // Пунктирные контуры-обёртки над рядом стоек по уровням иерархии выбранной
  // области (state.scope): выбор площадки → каждая её серверная в контуре;
  // выбор региона → ещё и каждая площадка (внутри — её серверные). Локация
  // (одна серверная) рисуется без внешних контуров. Стойки уже отсортированы
  // площадка→серверная→стойка (см. TreeManager._racksFor) → колонки группы
  // идут подряд, контур = прямоугольник от minCol до maxCol.
  _renderScopeContours(canvas, group, rackMeta) {
    this._contours = [];   // сбрасываем ссылки (переживают redrawWires для fit)
    const scope = state.scope;
    if (!scope || scope.type === "location" || !group.length) return;
    const { LEFT_PAD, TOP_PAD } = this;
    const top0 = TOP_PAD - 34;   // верх бокса стойки
    const boxOf = (racks, padX, padTop, padBot) => {
      const cols = racks.map(r => rackMeta[r.id].col);
      const minCol = Math.min(...cols), maxCol = Math.max(...cols);
      const left = this._colX(minCol);
      const right = this._colX(maxCol) + this.SLOT + BOX_PAD;
      const bottom = Math.max(...racks.map(r => rackMeta[r.id].bottom));
      return { left: left - padX, top: top0 - padTop,
        width: (right - left) + padX * 2, height: (bottom - top0) + padTop + padBot };
    };
    // Location-контуры (серверные) — базовая геометрия. Их «подрастание» под
    // свои внутренние провода считается в _fitContoursToWires (phase 1).
    const locs = [];
    for (const [lid, racks] of groupByKey(group, r => r.location && r.location.id)) {
      if (lid == null) continue;
      const loc = racks[0].location;
      const base = boxOf(racks, 13, 22, 12);
      // Диапазон колонок серверной — для горизонтального «прижима» (clamp), чтобы
      // рамка не вылезла в колонки соседней серверной (см. _fitContoursToWires).
      const cols = racks.map(r => rackMeta[r.id].col);
      const el = this._contourEl("gb-loc", "серверная " + (loc ? loc.name : "?"), base);
      locs.push({ el, base, kind: "loc", locId: lid, locName: loc ? loc.name : "",
        minCol: Math.min(...cols), maxCol: Math.max(...cols),
        rackIds: new Set(racks.map(r => r.id)),
        siteId: racks[0].site && racks[0].site.id });
    }
    // Site-контуры (площадки) — для региона И группы мест (обе могут охватывать
    // несколько площадок). Геометрия НЕ от стоек, а ОБЪЕДИНЕНИЕ уже подросших
    // location-контуров (phase 2), чтобы площадка всегда охватывала свои
    // серверные и не пересекалась с ними (small_fix п.2).
    const sites = [];
    if (scope.type === "region" || scope.type === "sitegroup") {
      for (const [, racks] of groupByKey(group, r => r.site && r.site.id)) {
        const site = racks[0].site;
        const base = boxOf(racks, 28, 48, 26);
        const el = this._contourEl("gb-site", "площадка " + (site ? site.name : "?"), base);
        sites.push({ el, base, kind: "site", rackIds: new Set(racks.map(r => r.id)),
          children: locs.filter(c => c.siteId === (site && site.id)) });
      }
    }
    this._contours = [...sites, ...locs];
    // z-порядок: сначала в DOM площадки (позади), потом серверные (поверх), и
    // все — ПЕРЕД стойками (позади узлов). Так рамки/подписи не перекрывают ноды.
    const frag = document.createDocumentFragment();
    for (const ct of [...sites, ...locs]) frag.appendChild(ct.el);
    canvas.insertBefore(frag, canvas.firstChild);
    this._fitContoursToWires();   // на случай, если провода уже нарисованы
  }
  _contourEl(cls, label, g) {
    return mk("div", { className: "groupbox " + cls,
      html: `<span class="gb-label">${label}</span>`,
      style: { left: g.left + "px", top: g.top + "px", width: g.width + "px", height: g.height + "px" } });
  }

  // Раскладывает контуры в ДВЕ фазы, чтобы уровни не накладывались (small_fix
  // п.2), а межплощадочные провода не «затягивали» рамку внутрь (п.3). Всё в
  // координатах схемы (getBBox = userspace, не зависит от CSS-зума). Идемпотентно.
  //  Phase 1 — серверные: рамка растёт под свои ВНУТРЕННИЕ провода (оба конца в
  //    этой серверной). Провода в другую серверную/площадку выходят наружу.
  //  Phase 2 — площадки: рамка = ОБЪЕДИНЕНИЕ подросших серверных внутри неё
  //    (+ отступ) → площадка гарантированно охватывает свои серверные; плюс
  //    внутриплощадочные провода (оба конца в этой площадке). Провода между
  //    разными Site рамку не двигают (п.3: механизм «внутри» к ним не применим).
  _fitContoursToWires() {
    const list = this._contours;
    if (!list || !list.length) return;
    const svg = $("#wires");
    const paths = svg ? svg.querySelectorAll("path.wire") : [];
    // Кабель → пара стоек его концов (для проверки «внутренний ли провод»).
    const cableRacks = {};
    for (const c of state.cables) {
      const aT = (c.a_terminations || [])[0], bT = (c.b_terminations || [])[0];
      if (!aT || !bT) continue;
      const a = state.ports[termKey(aT)], b = state.ports[termKey(bT)];
      if (a && b) cableRacks[c.id] = [state.devRack[a.dev.id], state.devRack[b.dev.id]];
    }
    // Расширить box границами всех проводов, ВНУТРЕННИХ для набора стоек rackIds.
    const growByInnerWires = (box, rackIds, pad) => {
      let x0 = box.left, y0 = box.top, x1 = box.left + box.width, y1 = box.top + box.height;
      for (const p of paths) {
        const rr = cableRacks[+p.dataset.cable];
        if (!rr || !rackIds.has(rr[0]) || !rackIds.has(rr[1])) continue;
        let bb; try { bb = p.getBBox(); } catch { continue; }
        x0 = Math.min(x0, bb.x - pad); y0 = Math.min(y0, bb.y - pad);
        x1 = Math.max(x1, bb.x + bb.width + pad); y1 = Math.max(y1, bb.y + bb.height + pad);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    };
    // Дорастить box под РЕАЛЬНУЮ геометрию нод стоек rackIds. Нода центрируется
    // в колонке и при большом числе портов становится шире COL_W → вылезает за
    // контур, посчитанный по колонкам (small_fix «Про схема» п.1). Берём
    // фактические left/width/top/height нод (нескалированные — как у box).
    const growByNodes = (box, rackIds, pad) => {
      let x0 = box.left, y0 = box.top, x1 = box.left + box.width, y1 = box.top + box.height;
      for (const [id, node] of Object.entries(state.nodeEls)) {
        if (!rackIds.has(state.devRack[+id])) continue;
        const nl = parseFloat(node.style.left) || 0, nt = parseFloat(node.style.top) || 0;
        const nw = parseFloat(node.style.width) || 0, nh = node.offsetHeight || 56;
        // +13 сверху/снизу — ряды портов торчат за пределы бокса ноды (top/bottom:-13px).
        x0 = Math.min(x0, nl - pad); y0 = Math.min(y0, nt - 13 - pad);
        x1 = Math.max(x1, nl + nw + pad); y1 = Math.max(y1, nt + nh + 13 + pad);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    };
    // Off-rack устройства (потребители) теперь лежат ПОД стойками СВОЕЙ серверной
    // (см. _renderOffRack), сгруппированы в контуры-типы. Рамка серверной растёт
    // ВНИЗ по этим контурам (state.offContours[locId]) — устройства оказываются
    // ВНУТРИ своей серверной. Ключ — id локации (число ct.locId → строковый ключ).
    const offByLoc = state.offContours || {};
    // Силовые щиты локации (боксы под стойками) — контур серверной должен их
    // ОХВАТЫВАТЬ (small_fix: при выборе Site щитки внутри контура). Боксы —
    // state.powerBoxEls[panel.id], привязка к локации — panel.location.id.
    const panelsByLoc = {};
    for (const p of (state.powerPanels || [])) {
      const box = (state.powerBoxEls || {})[p.id];
      const lid = p.location && p.location.id;
      if (box && lid != null) (panelsByLoc[lid] = panelsByLoc[lid] || []).push(box);
    }
    // Дорастить box под геометрию произвольных нод (off-rack) — как growByNodes,
    // но по явному списку элементов, а не по rackIds.
    const growByEls = (box, els, pad) => {
      let x0 = box.left, y0 = box.top, x1 = box.left + box.width, y1 = box.top + box.height;
      for (const node of els) {
        const nl = parseFloat(node.style.left) || 0, nt = parseFloat(node.style.top) || 0;
        const nw = parseFloat(node.style.width) || 0, nh = node.offsetHeight || 56;
        x0 = Math.min(x0, nl - pad); y0 = Math.min(y0, nt - 13 - pad);
        x1 = Math.max(x1, nl + nw + pad); y1 = Math.max(y1, nt + nh + 13 + pad);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    };
    const apply = ct => {
      ct.el.style.left = ct._box.left + "px"; ct.el.style.top = ct._box.top + "px";
      ct.el.style.width = ct._box.width + "px"; ct.el.style.height = ct._box.height + "px";
    };
    // Когда серверных НЕСКОЛЬКО — их рамки прижимаем к «полосе» СВОЕЙ локации
    // (стойки + карман off-rack устройств) по горизонтали (clamp), иначе рост
    // под провода/щиты может завести рамку в полосу соседней серверной и она
    // визуально окажется ВНУТРИ (баг «локация внутри локации»). Полосы соседних
    // локаций разнесены пре-проходом (_computeLocGeometry, AREA_SEP).
    const multiLoc = list.filter(c => c.kind === "loc").length > 1;
    const clampX = ct => {
      if (!multiLoc) return;
      const g = (this._locGeom || {})[ct.locId];
      if (!g) return;
      const bandLeft = this._colX(g.minCol) - COL_GAP / 2;
      const bandRight = g.areaW ? g.devX + g.areaW + 24
        : this._colX(g.maxCol) + this.SLOT + COL_GAP / 2;
      const left = Math.max(ct._box.left, bandLeft);
      const right = Math.min(ct._box.left + ct._box.width, bandRight);
      ct._box = { ...ct._box, left, width: Math.max(0, right - left) };
    };
    // Phase 1 — серверные: рамка растёт под свои внутренние провода, ноды своих
    // стоек (широкие ноды не должны вылезать — small_fix п.1) И под off-rack
    // устройства этой локации (потребители справа / провайдер сверху — в контуре).
    for (const ct of list) {
      if (ct.kind !== "loc") continue;
      ct._box = growByNodes(growByInnerWires(ct.base, ct.rackIds, 8), ct.rackIds, 6);
      const offEls = offByLoc[ct.locId];
      if (offEls && offEls.length) ct._box = growByEls(ct._box, offEls, 16);
      // Щиты локации — pad 22, чтобы охватить и их подпись «Силовые щиты» сверху.
      const panelEls = panelsByLoc[ct.locId];
      if (panelEls && panelEls.length) ct._box = growByEls(ct._box, panelEls, 22);
      clampX(ct);
      apply(ct);
    }
    // Phase 2 — площадки: объединение подросших серверных + внутренние провода
    // + ноды (страховка для стоек без серверной, не попавших в loc-контур).
    for (const ct of list) {
      if (ct.kind !== "site") continue;
      const childBoxes = ct.children.map(c => c._box).filter(Boolean);
      // padTop 40 — чтобы пунктирный верх и подпись «площадка …» шли выше
      // верхнего края и подписи серверной (не сливались).
      const base = unionBox(childBoxes, 15, 40, 15) || ct.base;
      ct._box = growByNodes(growByInnerWires(base, ct.rackIds, 10), ct.rackIds, 6);
      apply(ct);
    }
  }

}
export const ContourMethods = _Mixin.prototype;
