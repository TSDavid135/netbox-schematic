"use strict";
// schema_util: чистые, унифицированные и НЕизменяемые помощники схемы
// Вынесено из schema.js: геометрия путей (SVG «d»), группировка, короткое имя
// порта. Здесь нет обращений к state/DOM/this — только вход → выход. Меняются
// редко и одинаково используются во всех местах схемы. Так schema.js остаётся
// про логику (раскладка, режимы, связи), а формулы живут отдельным модулем.

// Волнистая линия между двумя точками (радио-линк): синусоида вдоль отрезка.
// Возвращает d для <path>. amp — амплитуда волны, wl — длина волны (px).
export function wavyPath(ax, ay, bx, by, amp = 6, wl = 18) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;      // единичный вектор вдоль
  const nx = -uy, ny = ux;                 // нормаль (перпендикуляр)
  const steps = Math.max(6, Math.round(len / (wl / 2)));  // полуволны
  let d = `M ${ax.toFixed(1)} ${ay.toFixed(1)}`;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = ax + dx * (t - 0.5 / steps);              // точка перегиба посередине сегмента
    const cy = ay + dy * (t - 0.5 / steps);
    const sign = i % 2 ? 1 : -1;
    const qx = cx + nx * amp * sign, qy = cy + ny * amp * sign;
    const ex = ax + dx * t, ey = ay + dy * t;
    d += ` Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }
  return d;
}

// Волнистая линия ВДОЛЬ ломаной (для радио-линков, идущих по той же трассе,
// что и кабели). Короткие стыки (< длины волны) рисуются прямо, чтобы углы
// маршрута оставались чёткими. Мостиков у радио нет (см. drawRadioLinks).
export function wavyAlong(pts, amp = 6, wl = 18) {
  if (!pts || pts.length < 2) return "";
  const f = n => n.toFixed(1);
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < wl) { d += ` L ${f(bx)} ${f(by)}`; continue; }   // короткий стык — прямо
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const steps = Math.max(2, Math.round(len / (wl / 2)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const cx = ax + dx * (t - 0.5 / steps), cy = ay + dy * (t - 0.5 / steps);
      const sign = s % 2 ? 1 : -1;
      const qx = cx + nx * amp * sign, qy = cy + ny * amp * sign;
      const ex = ax + dx * t, ey = ay + dy * t;
      d += ` Q ${f(qx)} ${f(qy)} ${f(ex)} ${f(ey)}`;
    }
  }
  return d;
}

// Волнистая линия вдоль ПЛАВНОЙ дуги a→b (не по прямой). Базовая линия —
// квадратичная кривая с перпендикулярным прогибом; на неё накладывается волна.
// Для «круглого» радио: диагонали идут закруглённой кривой, а не прямой.
export function wavyCurve(ax, ay, bx, by, amp = 6, wl = 18, bulge = null) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;                         // нормаль отрезка
  const b = bulge == null ? Math.min(70, len * 0.22) : bulge;  // прогиб дуги
  const cx = (ax + bx) / 2 + nx * b, cy = (ay + by) / 2 + ny * b;  // вершина квадратики
  const steps = Math.max(6, Math.round(len / (wl / 2)));
  const f = n => n.toFixed(1);
  const at = t => { const mt = 1 - t;
    return [mt * mt * ax + 2 * mt * t * cx + t * t * bx, mt * mt * ay + 2 * mt * t * cy + t * t * by]; };
  let d = `M ${f(ax)} ${f(ay)}`;
  let prev = [ax, ay];
  for (let i = 1; i <= steps; i++) {
    const [ex, ey] = at(i / steps);
    const sdx = ex - prev[0], sdy = ey - prev[1], sl = Math.hypot(sdx, sdy) || 1;
    const snx = -sdy / sl, sny = sdx / sl;                     // нормаль текущего сегмента
    const sign = i % 2 ? 1 : -1;
    const mx = (prev[0] + ex) / 2 + snx * amp * sign, my = (prev[1] + ey) / 2 + sny * amp * sign;
    d += ` Q ${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}`;
    prev = [ex, ey];
  }
  return d;
}

// Ломаная со СКРУГЛЁННЫМИ углами (для «круглого» стиля на угольной трассе-
// обходе). Каждый внутренний угол заменяется дугой радиуса r (не больше
// половины прилегающего сегмента).
export function smoothPath(pts, r = 12) {
  if (!pts || pts.length < 2) return "";
  const f = n => n.toFixed(1);
  if (pts.length === 2)
    return `M ${f(pts[0][0])} ${f(pts[0][1])} L ${f(pts[1][0])} ${f(pts[1][1])}`;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const d1 = Math.hypot(x1 - x0, y1 - y0) || 1, d2 = Math.hypot(x2 - x1, y2 - y1) || 1;
    const r1 = Math.min(r, d1 / 2), r2 = Math.min(r, d2 / 2);
    const ex = x1 + (x0 - x1) / d1 * r1, ey = y1 + (y0 - y1) / d1 * r1;   // подход к углу
    const sx = x1 + (x2 - x1) / d2 * r2, sy = y1 + (y2 - y1) / d2 * r2;   // выход из угла
    d += ` L ${f(ex)} ${f(ey)} Q ${f(x1)} ${f(y1)} ${f(sx)} ${f(sy)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${f(last[0])} ${f(last[1])}`;
  return d;
}

// Вертикальный кубик между двумя точками: контрольные точки над/под концами
// (x фиксирован по концам, задаём только их y). Общая форма для «дуги»
// магистрали (c1y=c2y=lift), локального изгиба (c1y=ay+bend, c2y=by−bend) и
// линии питания фидер→PDU (c1y=c2y=midY).
export function cubicPath(x1, y1, x2, y2, c1y, c2y) {
  return `M ${x1} ${y1} C ${x1} ${c1y}, ${x2} ${c2y}, ${x2} ${y2}`;
}

// Ортогональная (угольная) трасса между стойками: выход по вертикали из порта,
// горизонтальная перемычка на gapX, спуск/подъём к дальнему порту. aOut/bOut —
// вертикальные «выносы» из портов, gapX — общий вертикальный коридор.
export function orthoPath(ax, ay, bx, by, gapX, aOut, bOut) {
  return `M ${ax} ${ay} L ${ax} ${aOut} L ${gapX} ${aOut} L ${gapX} ${bOut} L ${bx} ${bOut} L ${bx} ${by}`;
}

// Группировка массива в Map(key → элементы) с сохранением порядка вставки.
export function groupByKey(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Цифра в кружке порта: последнее число имени; если чисел нет
// (напр. «Console») — порядковый номер порта в ряду (ordinal).
export function shortPortName(name, ordinal) {
  const m = name.match(/(\d+)(?!.*\d)/);
  if (m) return m[1];
  return ordinal != null ? String(ordinal) : name.slice(0, 2);
}

// Горизонтальный сегмент угольного провода от (x1,y) до (x2,y) с «мостиками»
// (полуокружность-горбик вверх) над каждым x из xs, попадающим внутрь отрезка.
// Так пересекающиеся провода не «сливаются»: тот, что идёт горизонтально,
// перепрыгивает вертикальный (приём электрических схем). Возвращает ПРОДОЛЖЕНИЕ
// d (начинается с " L …"): путь уже стоит в (x1,y). r — радиус мостика.
export function hopSegment(x1, y, x2, xs, r = 6) {
  const dir = x2 >= x1 ? 1 : -1;
  const f = n => n.toFixed(1);
  // только пересечения строго внутри отрезка (с зазором r от концов), по ходу.
  const inside = xs.filter(x => (x - x1) * dir > r && (x2 - x) * dir > r)
    .sort((a, b) => (a - b) * dir);
  // Близкие пересечения кластеризуем в ОДИН широкий мост — иначе два маленьких
  // мостика наезжают друг на друга (small_fix: провода п.1). Порог — 2r+4.
  const clusters = [];
  for (const x of inside) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(x - last[last.length - 1]) < 2 * r + 4) last.push(x);
    else clusters.push([x]);
  }
  let d = "";
  for (const cl of clusters) {
    // границы кластера по ходу движения → мост от (первый−r) до (последний+r);
    // радиус по X = половина ширины (для одиночного = r → обычный полукруг),
    // высота горбика = r. Полукруг «вверх» (см. sweep).
    const left = cl[0] - dir * r, right = cl[cl.length - 1] + dir * r;
    const rx = Math.abs(right - left) / 2;
    d += ` L ${f(left)} ${f(y)} A ${f(rx)} ${r} 0 0 ${dir > 0 ? 1 : 0} ${f(right)} ${f(y)}`;
  }
  d += ` L ${f(x2)} ${f(y)}`;
  return d;
}

// Прямоугольник-объединение списка боксов {left,top,width,height} + отступы.
// Пустой список → null. Используется, чтобы контур площадки охватывал уже
// «подросшие» под свои провода контуры серверных (гарантия вложенности).
export function unionBox(boxes, padX = 0, padTop = 0, padBot = 0) {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top);
    x1 = Math.max(x1, b.left + b.width); y1 = Math.max(y1, b.top + b.height);
  }
  return { left: x0 - padX, top: y0 - padTop,
    width: (x1 - x0) + padX * 2, height: (y1 - y0) + padTop + padBot };
}
