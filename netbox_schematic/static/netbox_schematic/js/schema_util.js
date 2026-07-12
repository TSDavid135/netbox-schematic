"use strict";
// schema_util: pure, uniform, IMMUTABLE schema helpers
// Extracted from schema.js: path geometry (SVG "d"), grouping, short port
// names. No state/DOM/this access — input → output only. Keeps schema.js
// about logic (layout, modes, links) while formulas live in their own module.

// Wavy line ALONG a polyline (for radio links following the same route as
// cables). Short joints (< one wavelength) are drawn straight so the route
// corners stay crisp. Radio links get no hop bridges (see drawRadioLinks).
export function wavyAlong(pts, amp = 6, wl = 18) {
  if (!pts || pts.length < 2) return "";
  const f = n => n.toFixed(1);
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < wl) { d += ` L ${f(bx)} ${f(by)}`; continue; }   // short joint — straight
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

// Wavy line along a SMOOTH arc a→b (not a straight line). The base is a
// quadratic curve with a perpendicular bulge; the wave is laid over it.
// For "round" radio style: diagonals follow a rounded curve, not a line.
export function wavyCurve(ax, ay, bx, by, amp = 6, wl = 18, bulge = null) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;                         // segment normal
  const b = bulge == null ? Math.min(70, len * 0.22) : bulge;  // arc bulge
  const cx = (ax + bx) / 2 + nx * b, cy = (ay + by) / 2 + ny * b;  // quadratic apex
  const steps = Math.max(6, Math.round(len / (wl / 2)));
  const f = n => n.toFixed(1);
  const at = t => { const mt = 1 - t;
    return [mt * mt * ax + 2 * mt * t * cx + t * t * bx, mt * mt * ay + 2 * mt * t * cy + t * t * by]; };
  let d = `M ${f(ax)} ${f(ay)}`;
  let prev = [ax, ay];
  for (let i = 1; i <= steps; i++) {
    const [ex, ey] = at(i / steps);
    const sdx = ex - prev[0], sdy = ey - prev[1], sl = Math.hypot(sdx, sdy) || 1;
    const snx = -sdy / sl, sny = sdx / sl;                     // current segment normal
    const sign = i % 2 ? 1 : -1;
    const mx = (prev[0] + ex) / 2 + snx * amp * sign, my = (prev[1] + ey) / 2 + sny * amp * sign;
    d += ` Q ${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}`;
    prev = [ex, ey];
  }
  return d;
}

// Polyline with ROUNDED corners (for "round" style on an angular detour
// route). Each inner corner is replaced by an arc of radius r (capped at
// half the adjacent segment).
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
    const ex = x1 + (x0 - x1) / d1 * r1, ey = y1 + (y0 - y1) / d1 * r1;   // approach into the corner
    const sx = x1 + (x2 - x1) / d2 * r2, sy = y1 + (y2 - y1) / d2 * r2;   // exit out of the corner
    d += ` L ${f(ex)} ${f(ey)} Q ${f(x1)} ${f(y1)} ${f(sx)} ${f(sy)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${f(last[0])} ${f(last[1])}`;
  return d;
}

// Vertical cubic between two points: control points above/below the ends
// (x fixed at the ends, only their y is given). Shared shape for the trunk
// "arc" (c1y=c2y=lift), a local bend (c1y=ay+bend, c2y=by−bend) and the
// feeder→PDU power line (c1y=c2y=midY).
export function cubicPath(x1, y1, x2, y2, c1y, c2y) {
  return `M ${x1} ${y1} C ${x1} ${c1y}, ${x2} ${c2y}, ${x2} ${y2}`;
}

// Orthogonal (angular) route between racks: vertical exit from the port,
// horizontal jumper at gapX, drop/rise to the far port. aOut/bOut are the
// vertical stubs out of the ports, gapX is the shared vertical corridor.
export function orthoPath(ax, ay, bx, by, gapX, aOut, bOut) {
  return `M ${ax} ${ay} L ${ax} ${aOut} L ${gapX} ${aOut} L ${gapX} ${bOut} L ${bx} ${bOut} L ${bx} ${by}`;
}

// Group an array into Map(key → items), preserving insertion order.
export function groupByKey(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Digit in the port circle: the last number in the name; if there is none
// (e.g. "Console") — the port's ordinal position in the row.
export function shortPortName(name, ordinal) {
  const m = name.match(/(\d+)(?!.*\d)/);
  if (m) return m[1];
  return ordinal != null ? String(ordinal) : name.slice(0, 2);
}

// Horizontal segment of an angular wire from (x1,y) to (x2,y) with "hop
// bridges" (upward semicircle bumps) over every x in xs inside the segment.
// Keeps crossing wires from visually merging: the horizontal wire hops over
// the vertical one (electrical-schematic convention). Returns a CONTINUATION
// of d (starts with " L …"): the path already stands at (x1,y). r — bridge radius.
export function hopSegment(x1, y, x2, xs, r = 6) {
  const dir = x2 >= x1 ? 1 : -1;
  const f = n => n.toFixed(1);
  // only crossings strictly inside the segment (clearance r from the ends), in travel order.
  const inside = xs.filter(x => (x - x1) * dir > r && (x2 - x) * dir > r)
    .sort((a, b) => (a - b) * dir);
  // Cluster nearby crossings into ONE wide bridge — otherwise two small
  // bridges overlap each other (small_fix: wires item 1). Threshold — 2r+4.
  const clusters = [];
  for (const x of inside) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(x - last[last.length - 1]) < 2 * r + 4) last.push(x);
    else clusters.push([x]);
  }
  let d = "";
  for (const cl of clusters) {
    // cluster bounds in travel order → bridge from (first−r) to (last+r);
    // X radius = half the width (single crossing = r → a regular semicircle),
    // bump height = r. Semicircle opens upward (see sweep).
    const left = cl[0] - dir * r, right = cl[cl.length - 1] + dir * r;
    const rx = Math.abs(right - left) / 2;
    d += ` L ${f(left)} ${f(y)} A ${f(rx)} ${r} 0 0 ${dir > 0 ? 1 : 0} ${f(right)} ${f(y)}`;
  }
  d += ` L ${f(x2)} ${f(y)}`;
  return d;
}

// Union rectangle of boxes {left,top,width,height} + padding. Empty list →
// null. Used so a site contour encloses server-room contours that already
// grew to fit their wires (guarantees nesting).
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
