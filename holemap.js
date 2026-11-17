// BreakingPar hole map: an SVG drawing of the hole (illustrated from OpenStreetMap outlines, or satellite photos),
// turned so you are at the bottom looking up the hole, with your shot pattern and a draggable aim point.
// Pure geometry + SVG strings; no DOM access, so it is unit-testable.
import * as A from './analytics.js';
import * as F from './features.js';

const R = 6371008.8, RAD = Math.PI / 180;
export const W = 360, H = 470;            // viewBox size; the SVG scales to the screen width

// ------------------------------------------------------------------ frame: lat/lon <-> screen
// Local flat frame centred on `pos`, rotated so the line pos -> up points to the top of the screen.
// c = metres right of that line, a = metres along it.
// opt.inset {t, b, l, r}: screen pixels kept clear (top bar, bottom sheet) – the content fits and centres in the rest.
// opt.exact: fit only `include` (not pos and up) – used by the Green zoom. opt.maxK caps the scale (pixels per metre). opt.pad: margins in metres.
export function makeFrame(pos, up, include, w = W, h = H, opt = {}) {
  const b = A.bearing(pos[0], pos[1], up[0], up[1]) * RAD, cb = Math.cos(b), sb = Math.sin(b);
  const kx = Math.cos(pos[0] * RAD) * R * RAD, ky = R * RAD;
  const toAC = (la, lo) => { const e = (lo - pos[1]) * kx, n = (la - pos[0]) * ky; return [e * cb - n * sb, e * sb + n * cb]; };
  const fromAC = (c, a) => { const e = c * cb + a * sb, n = -c * sb + a * cb; return [pos[0] + n / ky, pos[1] + e / kx]; };
  const inc = include.filter(Boolean).map((p) => (p.ac ? p.ac : toAC(p[0], p[1])));
  const ac = opt.exact && inc.length ? inc : [[0, 0], toAC(up[0], up[1]), ...inc];
  const [mc, ma0, ma1] = opt.pad || [28, 22, 26];                   // margins in metres: sides, below, above
  let c0 = Math.min(...ac.map((p) => p[0])) - mc, c1 = Math.max(...ac.map((p) => p[0])) + mc;
  let a0 = Math.min(...ac.map((p) => p[1])) - ma0, a1 = Math.max(...ac.map((p) => p[1])) + ma1;
  const I = { t: 0, b: 0, l: 0, r: 0, ...(opt.inset || {}) }, vw = Math.max(40, w - I.l - I.r), vh = Math.max(40, h - I.t - I.b);
  const k = Math.min(vw / (c1 - c0), vh / (a1 - a0), opt.maxK ?? Infinity);
  const cm = (c0 + c1) / 2, am = (a0 + a1) / 2, cx = I.l + vw / 2, cy = I.t + vh / 2;   // centre the content in the clear area; the spare room goes to the sides
  const sx = (c) => (c - cm) * k + cx, sy = (a) => cy - (a - am) * k;
  return {
    k, w, h, bearing: b / RAD, toAC, fromAC, view: { l: I.l, t: I.t, w: vw, h: vh },
    xy: (la, lo) => { const [c, a] = toAC(la, lo); return [sx(c), sy(a)]; },
    acXY: (c, a) => [sx(c), sy(a)],
    fromXY: (x, y) => fromAC((x - cx) / k + cm, am - (y - cy) / k),
    // affine matrix taking (east m, -north m) around pos to screen pixels – used to place the photo tiles
    matrix: [k * cb, -k * sb, k * sb, k * cb, cx - k * cm, cy + k * am],
    toEN: (la, lo) => [(lo - pos[1]) * kx, (la - pos[0]) * ky],
  };
}
// Is a point inside the clear part of the frame (with a margin in pixels)?
export const inView2 = (fr, p, m = 0) => { const [x, y] = fr.xy(p[0], p[1]), v = fr.view || { l: 0, t: 0, w: fr.w, h: fr.h }; return x >= v.l + m && x <= v.l + v.w - m && y >= v.t + m && y <= v.t + v.h - m; };

// ------------------------------------------------------------------ Course view geometry
// Front and back of the green along your line to the pin: where that line enters and leaves the mapped green outline.
// Returns null when the line does not cross the outline (then the caller falls back to the outline's extent).
export function greenEdges(pos, pin, pts) {
  if (!pos || !pin || !pts || pts.length < 3) return null;
  const kx = Math.cos(pos[0] * RAD) * R * RAD, ky = R * RAD, en = (p) => [(p[1] - pos[1]) * kx, (p[0] - pos[0]) * ky];
  const [px, py] = en(pin), L = Math.hypot(px, py); if (L < 0.5) return null;
  const ux = px / L, uy = py / L, ts = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = en(pts[j]), [bx, by] = en(pts[i]), dx = bx - ax, dy = by - ay, den = ux * dy - uy * dx;
    if (Math.abs(den) < 1e-9) continue;
    const t = (ax * dy - ay * dx) / den, s = (ax * uy - ay * ux) / den;              // ray: t along the line; s along the edge
    if (s >= 0 && s <= 1 && t >= 0) ts.push(t);
  }
  const inside = F.pointInPolygon(pos[0], pos[1], pts);
  if (inside) return ts.length ? { front_m: 0, back_m: Math.max(...ts), mid_m: L } : null;
  if (ts.length < 2) return null;
  return { front_m: Math.min(...ts), back_m: Math.max(...ts), mid_m: L };
}
// The mapped green outline that holds (or is nearest, within 30 m of) a green centre.
export function greenOutline(pin, feats) {
  if (!pin) return null;
  const gs = (feats || []).filter((f) => f.kind === 'green');
  const g = gs.find((f) => F.pointInPolygon(pin[0], pin[1], f.pts)); if (g) return g.pts;
  const near = gs.map((f) => ({ f, d: A.haversine(pin[0], pin[1], A.mean(f.pts.map((p) => p[0])), A.mean(f.pts.map((p) => p[1]))) })).sort((a, b) => a.d - b.d)[0];
  return near && near.d < 30 ? near.f.pts : null;
}
// Zoom presets: which points the map must show. 'hole' = tee to green, 'shot' = you to a little past the aim, 'green' = the green and its surrounds.
export const ZOOMS = ['shot', 'hole', 'green'];
export const ZOOM_PAST_AIM = 0.2, ZOOM_PAST_MIN_M = 25, ZOOM_GREEN_PAD_M = 8, ZOOM_GREEN_MARGIN_M = 4;
export function zoomPoints(preset, { pos, aim, green, tee, line, greenPts, extra = [] }) {
  if (preset === 'hole') return { pts: [tee || pos, green, ...(line || []), pos].filter(Boolean), exact: true };
  if (preset === 'green' && green) {
    const br = A.bearing(pos[0], pos[1], green[0], green[1]), base = greenPts?.length ? greenPts : [green];
    const pad = [0, 90, 180, 270].map((d) => F.destination(green[0], green[1], br + d, ZOOM_GREEN_PAD_M + (greenPts?.length ? 0 : 12)));
    return { pts: [...base, ...pad], exact: true, pad: [ZOOM_GREEN_MARGIN_M, ZOOM_GREEN_MARGIN_M, ZOOM_GREEN_MARGIN_M] };
  }
  const to = aim || green; if (!to) return { pts: [pos], exact: false };
  const d = A.haversine(pos[0], pos[1], to[0], to[1]), past = F.destination(to[0], to[1], A.bearing(pos[0], pos[1], to[0], to[1]), Math.max(ZOOM_PAST_MIN_M, d * ZOOM_PAST_AIM));
  return { pts: [pos, to, past, ...extra], exact: true };
}

// ------------------------------------------------------------------ shot pattern (course-view plan, section 5)
export const MISS_SHOW_M = 4 * 0.9144;          // show "your usual miss" when the pattern's centre is more than 4 yd from the aim
export const MISS_ALLOW_MIN_M = 2 * 0.9144;     // offer "Allow for it" only when the sideways part is at least 2 yd
export const ALLOW_ALONG = false;
export const MISS_LONG_MAX_M = 20 * 0.9144;     // further than this long or short of the aim is the wrong club, not a usual miss: left out               // "Allow for it" moves the aim sideways only: the distance comes from the club, not the aim
const plane = (o) => {
  const kx = Math.cos(o[0] * RAD) * R * RAD, ky = R * RAD;
  return { en: (p) => [(p[1] - o[1]) * kx, (p[0] - o[0]) * ky], ll: ([e, n]) => [o[0] + n / ky, o[1] + e / kx] };
};
// How sure a pattern is: 'own' (enough of your shots with direction), 'estimated' (your distance, spread borrowed from your
// other clubs), 'distance' (a distance but no spread from your own clubs to borrow), 'none'.
export function patternKind(pt) {
  if (!pt) return 'none';
  if (pt.stats?.enough && !pt.estimated) return 'own';
  if (pt.estimated && pt.ratio_own !== false && pt.stats?.enough) return 'estimated';
  return A.isNum(pt.median_m) ? 'distance' : 'none';
}
// The landing zone for a club hit from pos at aim: inner = middle half of shots, outer = 90% (needs 20 shots), the two
// corridor edges from the ball out to the widest part of the zone, and the zone's centre. adj = slope / plays-like.
export function corridor(pos, aim, stats, adj = (y) => y) {
  if (!stats?.enough || !stats.cov) return null;
  const inner = placeEllipse(pos, aim, stats, 0.5, adj), outer = stats.enough_90 ? placeEllipse(pos, aim, stats, 0.9, adj) : null;
  const br = A.bearing(pos[0], pos[1], aim[0], aim[1]), zone = outer || inner;
  let lo = null, hi = null;
  for (const p of zone) {
    const [al, cr] = A.alongCross(pos[0], pos[1], p[0], p[1], br); if (al <= 0) continue;
    const ang = Math.atan2(cr, al);
    if (!lo || ang < lo.a) lo = { a: ang, p }; if (!hi || ang > hi.a) hi = { a: ang, p };
  }
  const centre = F.offsetPoint(pos[0], pos[1], br, adj(stats.mean_y_m), stats.mean_lateral_m);
  return { inner, outer, left: lo ? [pos, lo.p] : null, right: hi ? [pos, hi.p] : null, centre };
}
// Your usual miss at this aim: metres right (+) / left (−) of the aim line, and long (+) / short (−) of the aim.
export function missOffset(stats, aimDist_m = null, adj = (y) => y) {
  if (!stats?.enough || !A.isNum(stats.mean_lateral_m)) return null;
  const right_m = stats.mean_lateral_m, l0 = A.isNum(aimDist_m) ? adj(stats.mean_y_m) - aimDist_m : null, long_m = l0 !== null && Math.abs(l0) <= MISS_LONG_MAX_M ? l0 : null;
  const off_m = Math.hypot(right_m, long_m || 0);
  return { right_m, long_m, off_m, show: off_m > MISS_SHOW_M, allow: Math.abs(right_m) >= MISS_ALLOW_MIN_M };
}
// "Allow for it": turn the aim about you so the pattern's centre finishes on the line you first aimed along.
export function allowForMiss(pos, aim, stats, adj = (y) => y) {
  const m = missOffset(stats); if (!m) return aim;
  const br = A.bearing(pos[0], pos[1], aim[0], aim[1]), d = A.haversine(pos[0], pos[1], aim[0], aim[1]);
  const turn = Math.atan2(m.right_m, adj(stats.mean_y_m)) / RAD;
  const along = ALLOW_ALONG ? Math.max(1, d - (adj(stats.mean_y_m) - d)) : d;
  return F.destination(pos[0], pos[1], br - turn, along);
}
// The 25th and 75th percentile of the club's distance as two points on the line to the aim (ticks on the map).
export function rangeTicks(pos, aim, p25_m, p75_m, adj = (y) => y) {
  if (!A.isNum(p25_m) || !A.isNum(p75_m)) return null;
  const br = A.bearing(pos[0], pos[1], aim[0], aim[1]);
  return { p25: F.destination(pos[0], pos[1], br, adj(p25_m)), p75: F.destination(pos[0], pos[1], br, adj(p75_m)) };
}
// The parts of a landing zone that lie over a bunker, water or trees, as polygons (Sutherland–Hodgman against the
// zone, which is an ellipse and so convex). Single trees and tree rows count as circles of the tree radius.
export const HAZARDS = ['bunker', 'water', 'trees', 'tree', 'treerow'];
export function clipZone(zone, feats) {
  if (!zone || zone.length < 3 || !feats?.length) return [];
  const pl = plane(zone[0]), Z = zone.map(pl.en);
  if (Z.length > 3 && Z[0][0] === Z[Z.length - 1][0] && Z[0][1] === Z[Z.length - 1][1]) Z.pop();
  const sgn = Math.sign(Z.reduce((t, p, i) => { const q = Z[(i + 1) % Z.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0)) || 1;
  const xs = Z.map((p) => p[0]), ys = Z.map((p) => p[1]), bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const tr = F.TREE_RADIUS_M, circ = (c) => Array.from({ length: 12 }, (_, i) => [c[0] + tr * Math.cos(i * Math.PI / 6), c[1] + tr * Math.sin(i * Math.PI / 6)]);
  const out = [];
  for (const f of feats) {
    if (!HAZARDS.includes(f.kind)) continue;
    const P = f.pts.map(pl.en), fx = P.map((p) => p[0]), fy = P.map((p) => p[1]);
    if (Math.max(...fx) + tr < bb[0] || Math.min(...fx) - tr > bb[2] || Math.max(...fy) + tr < bb[1] || Math.min(...fy) - tr > bb[3]) continue;
    let polys;
    if (f.kind === 'tree') polys = [circ(P[0])];
    else if (f.kind === 'treerow') {                                     // a circle every tree radius along the row
      polys = [];
      for (let i = 0; i < P.length; i++) {
        polys.push(circ(P[i])); if (i === P.length - 1) break;
        const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]), k = Math.floor(L / tr);
        for (let j = 1; j < k; j++) polys.push(circ([P[i][0] + (P[i + 1][0] - P[i][0]) * j / k, P[i][1] + (P[i + 1][1] - P[i][1]) * j / k]));
      }
    } else polys = [P];
    for (const poly of polys) {
      const c = clipConvex(poly, Z, sgn);
      if (c.length >= 3) out.push({ kind: f.kind === 'tree' || f.kind === 'treerow' ? 'trees' : f.kind, pts: c.map(pl.ll), area_m2: Math.abs(areaOf(c)) });
    }
  }
  return out;
}
const areaOf = (P) => P.reduce((t, p, i) => { const q = P[(i + 1) % P.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function clipConvex(subject, clip, sgn) {
  let out = subject.slice();
  if (out.length > 3 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inp = out; out = [];
    const side = (p) => sgn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
    const cut = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) return p; const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den; return [p[0] + t * dx, p[1] + t * dy]; };
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], pin = side(p), qin = side(q);
      if (pin) { out.push(p); if (!qin) out.push(cut(p, q)); } else if (qin) out.push(cut(p, q));
    }
  }
  return out;
}

// ------------------------------------------------------------------ satellite tiles (Esri World Imagery)
const tileXY = (la, lo, z) => { const n = 2 ** z, x = (lo + 180) / 360 * n, s = Math.log(Math.tan(Math.PI / 4 + la * RAD / 2)); return [x, (1 - s / Math.PI) / 2 * n]; };
const tileLL = (x, y, z) => { const n = 2 ** z, lo = x / n * 360 - 180, la = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / RAD; return [la, lo]; };
export function tiles(fr, lat) {
  const mpp = 1 / (fr.k * 2.2);                                       // aim for ~2 photo pixels per screen pixel
  let z = Math.max(3, Math.min(19, Math.round(Math.log2(156543.03 * Math.cos(lat * RAD) / mpp))));
  const corners = [[0, 0], [fr.w, 0], [0, fr.h], [fr.w, fr.h]].map(([x, y]) => fr.fromXY(x, y));
  let out;
  for (;; z--) {
    const t = corners.map(([la, lo]) => tileXY(la, lo, z)), xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.floor(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.floor(Math.max(...ys));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 48 && z > 3) continue;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 48) return [];
    out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const [e0, n0] = fr.toEN(...tileLL(x, y, z)), [e1, n1] = fr.toEN(...tileLL(x + 1, y + 1, z));
      out.push({ z, x, y, u: e0, v: -n0, w: (e1 - e0) * 1.006, h: (n0 - n1) * 1.006 });
    }
    return out;
  }
}

// ------------------------------------------------------------------ hole geometry
// Where the hole goes: Garmin knowledge first (your tracked rounds), then the OpenStreetMap hole line, then the nearest mapped green.
export function holeTargets(known, feats, holeNo, pos) {
  const lines = (feats || []).filter((f) => f.kind === 'hole' && f.ref === holeNo);
  const line = lines.length ? lines.map((l) => ({ l, d: pos ? A.haversine(pos[0], pos[1], l.pts[0][0], l.pts[0][1]) : 0 })).sort((p, q) => p.d - q.d)[0].l : null;
  let green = known?.pin || null, src = known?.pin ? 'garmin' : null;
  if (!green && line) { green = snapToGreen(line.pts[line.pts.length - 1], feats); src = 'osm-hole'; }
  const tee = known?.tee || (line ? line.pts[0] : null);
  return { green, tee, line: line?.pts || null, par: line?.par || null, src };
}
function snapToGreen(p, feats) {
  const g = (feats || []).find((f) => f.kind === 'green' && F.pointInPolygon(p[0], p[1], f.pts));
  return g ? [A.mean(g.pts.map((q) => q[0])), A.mean(g.pts.map((q) => q[1]))] : p;
}
// The point on the hole's centre line (or the straight line to the green) that is `dist` metres from pos.
export function pointAlongHole(pos, green, line, dist) {
  const path = line && line.length >= 2 ? [...line] : [pos, green];
  let start = 0, best = Infinity;                                      // nearest vertex to the player, then walk forward
  path.forEach((p, i) => { const d = A.haversine(pos[0], pos[1], p[0], p[1]); if (d < best && i < path.length - 1) { best = d; start = i; } });
  const pts = [pos, ...path.slice(start + 1)];
  for (let i = 1; i < pts.length; i++) {
    const d0 = A.haversine(pos[0], pos[1], pts[i - 1][0], pts[i - 1][1]), d1 = A.haversine(pos[0], pos[1], pts[i][0], pts[i][1]);
    if (d1 >= dist) {
      // distance from you isn't linear along a segment that bends away, so find the spot by halving
      const at = (t) => [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
      let lo = 0, hi = 1;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2, p = at(mid); if (A.haversine(pos[0], pos[1], p[0], p[1]) < dist) lo = mid; else hi = mid; }
      return at((lo + hi) / 2);
    }
  }
  return green;
}

// ------------------------------------------------------------------ pattern placement + outcomes
// Your shots with a club, hit from pos along the line to the aim point: x = metres right, y = metres travelled.
// adj turns a flat-ground distance into the distance actually travelled (slope, wind, temperature – see strategy.js)
export function placePattern(pos, aim, pts, adj = (y) => y) {
  const br = A.bearing(pos[0], pos[1], aim[0], aim[1]);
  return pts.map((p) => F.offsetPoint(pos[0], pos[1], br, adj(p.y), p.x));
}
export function placeEllipse(pos, aim, stats, q, adj = (y) => y) {
  const [ex, ey] = A.ellipse(stats.centre, stats.cov, q, 48), br = A.bearing(pos[0], pos[1], aim[0], aim[1]);
  return ex.map((x, i) => F.offsetPoint(pos[0], pos[1], br, adj(ey[i]), x));
}
// Share of a club's past shots that would finish on each surface if hit at this aim point.
export function outcomes(landing, feats) {
  const n = landing.length, cnt = { green: 0, fairway: 0, rough: 0, bunker: 0, water: 0, trees: 0, tee: 0 };
  if (!n || !feats?.length) return null;
  for (const [la, lo] of landing) cnt[F.surfaceAt(la, lo, feats)]++;
  const pct = Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, 100 * v / n]));
  return { n, ...pct, trouble: pct.bunker + pct.water + pct.trees };
}

// ------------------------------------------------------------------ SVG
const P = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
const inView = (fr, pts, pad = 60) => pts.some(([la, lo]) => { const [x, y] = fr.xy(la, lo); return x > -pad && x < fr.w + pad && y > -pad && y < fr.h + pad; });
const lbl = (x, y, t, cls = '') => `<text class="hm-l ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${t}</text>`;
// a distance in a dark tag, so it reads over any background
export const tag = (x, y, t, size = 18) => { const u = size / 1.5, w = u * String(t).length + u, hh = Math.round(size * 1.45); return `<g class="hm-tag"><rect x="${(x - w / 2).toFixed(1)}" y="${(y - hh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${hh}" rx="8" fill="rgba(7,44,31,.86)" stroke="rgba(242,207,74,.9)" stroke-width="1"/><text class="hm-l big" x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" text-anchor="middle"${size !== 18 ? ` style="font-size:${size}px"` : ''}>${t}</text></g>`; };

const DEFS = `<defs>
<pattern id="hmRough" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#6fa64a"/><path d="M1 3l1.5-2M5.5 8l1.5-2" stroke="#5f9640" stroke-width="1"/></pattern>
<pattern id="hmFair" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="11" fill="#a3d36c"/><rect y="11" width="22" height="11" fill="#97ca60"/></pattern>
<pattern id="hmWood" width="16" height="14" patternUnits="userSpaceOnUse"><rect width="16" height="14" fill="#2f6b34"/><circle cx="4" cy="4" r="4.2" fill="#3b7f3e"/><circle cx="12" cy="10" r="4.2" fill="#3b7f3e"/><circle cx="3" cy="3" r="1.6" fill="#4f9650"/><circle cx="11" cy="9" r="1.6" fill="#4f9650"/></pattern>
<radialGradient id="hmTree"><stop offset="0" stop-color="#5aa457"/><stop offset=".7" stop-color="#2f7a35"/><stop offset="1" stop-color="#1f5a26"/></radialGradient>
</defs>`;

export function staticSvg(fr, o) {
  const { feats = [], style, tileList, green, tee, line, pos, posLabel, unit, cv, rings } = o;
  const out = [DEFS];
  if (style === 'sat') {
    out.push(`<rect width="${fr.w}" height="${fr.h}" fill="#33402f"/><g transform="matrix(${fr.matrix.map((v) => v.toFixed(5)).join(' ')})">`);
    for (const t of tileList || []) out.push(`<image href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}" x="${t.u.toFixed(2)}" y="${t.v.toFixed(2)}" width="${t.w.toFixed(2)}" height="${t.h.toFixed(2)}" preserveAspectRatio="none"/>`);
    out.push('</g>');
    for (const f of feats) if (f.kind === 'green' && inView(fr, f.pts)) out.push(`<path d="${P(f.pts.map((p) => fr.xy(...p)))}Z" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.2"/>`);
  } else {
    out.push(`<rect width="${fr.w}" height="${fr.h}" fill="url(#hmRough)"/>`);
    const poly = (kind, attrs) => { for (const f of feats) if (f.kind === kind && inView(fr, f.pts)) out.push(`<path d="${P(f.pts.map((p) => fr.xy(...p)))}Z" ${attrs}/>`); };
    poly('rough', 'fill="#79b052"');
    poly('trees', 'fill="url(#hmWood)" stroke="#24552a" stroke-width="1.2"');
    poly('fairway', 'fill="url(#hmFair)" stroke="#86bd52" stroke-width="1.5"');
    poly('tee', 'fill="#a9dc78" stroke="#7fb555" stroke-width="1.2"');
    poly('water', 'fill="#4c9bd6" stroke="#9fd0f2" stroke-width="2"');
    poly('bunker', 'fill="#f1e1ae" stroke="#d6bd76" stroke-width="1.2"');
    poly('green', 'fill="#bfe98f" stroke="#7fc25a" stroke-width="3" paint-order="stroke"');
    const tr = Math.max(3, F.TREE_RADIUS_M * fr.k);
    for (const f of feats) if (f.kind === 'treerow' && inView(fr, f.pts)) {
      const xy = f.pts.map((p) => fr.xy(...p));
      out.push(`<path d="${P(xy)}" fill="none" stroke="#2f7a35" stroke-width="${(tr * 2).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${P(xy)}" fill="none" stroke="#4f9650" stroke-width="${(tr * 0.8).toFixed(1)}" stroke-linecap="round" stroke-dasharray="1 ${(tr * 1.6).toFixed(1)}"/>`);
    }
    for (const f of feats) if (f.kind === 'tree' && inView(fr, f.pts, 10)) { const [x, y] = fr.xy(...f.pts[0]); out.push(`<circle cx="${x.toFixed(1)}" cy="${(y + tr * 0.25).toFixed(1)}" r="${tr.toFixed(1)}" fill="rgba(0,0,0,.22)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${tr.toFixed(1)}" fill="url(#hmTree)"/>`); }
  }
  if (line) out.push(`<path d="${P(line.map((p) => fr.xy(...p)))}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/>`);
  // distance rings from where you are (in the Course view they move with you, so they are drawn in the dynamic layer)
  if (!o.noPos) out.push(ringsSvg(fr, pos, rings, unit, cv));
  if (tee) { const [x, y] = fr.xy(...tee); out.push(`<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" rx="2" fill="#fff" stroke="#0a3d2b" stroke-width="1.5"/>`); }
  if (green) {
    const [x, y] = fr.xy(...green);
    out.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 26).toFixed(1)}" stroke="#fff" stroke-width="1.8"/><path d="M${x.toFixed(1)} ${(y - 26).toFixed(1)}l13 4.5-13 4.5z" fill="#f2cf4a" stroke="#8a6b10" stroke-width=".6"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#fff" stroke="#14261d" stroke-width="1"/>`);
  }
  if (!o.noPos) { out.push(posDot(fr, pos)); if (posLabel) { const [px, py] = fr.xy(...pos); out.push(lbl(px, py + 22, posLabel, 'mid')); } }
  return out.join('');
}
export const RING_STEP = { yd: 45.72, m: 50 }, RING_MAX = 12;
export function ringsSvg(fr, pos, rings, unit, cv, minY = 8) {
  const out = [], [px, py] = fr.xy(...pos), step = RING_STEP[unit] || RING_STEP.m;
  for (let r = step; r < Math.min(rings || 0, step * RING_MAX); r += step) {
    const rad = r * fr.k; if (py - rad < minY) break;
    out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${rad.toFixed(1)}" fill="none" stroke="rgba(255,255,255,.38)" stroke-width="1" stroke-dasharray="3 5"/>`);
    out.push(lbl(px - 5, py - rad - 4, String(Math.round(cv(r))), 'ring'));
  }
  return out.join('');
}
// you: a blue dot; poor accuracy adds a pale ring of that radius
export function posDot(fr, pos, acc_m = null) {
  const [px, py] = fr.xy(...pos), ar = A.isNum(acc_m) ? acc_m * fr.k : 0;
  return `${ar > 12 ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${Math.min(ar, 400).toFixed(1)}" fill="rgba(46,134,222,.12)" stroke="rgba(46,134,222,.5)" stroke-width="1"/>` : ''}<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="9" fill="rgba(46,134,222,.25)"/><circle class="hm-me" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5.5" fill="#2e86de" stroke="#fff" stroke-width="2"/>`;
}

// The part that moves while you drag: lines, pattern, aim marker, distance labels.
// The drag handle sits this far below the aim (above it near the bottom edge), so a thumb doesn't hide the aim.
export const PAD = 66;
export const padOffset = (ay, h = H) => (ay + PAD <= h - 16 ? PAD : -PAD);
const riskCol = (r) => (r === null || r === undefined ? ['255,214,64', '#ffd640'] : r >= 25 ? ['232,74,58', '#ff6b57'] : r >= 10 ? ['255,170,40', '#ffb030'] : ['120,220,110', '#8ee07d']);

// The part that moves while you drag: lines, pattern (coloured by risk), aim marker, thumb handle, distance tags.
export function dynamicSvg(fr, o) {
  const { pos, aim, green, pat, cv, clubName } = o, out = [], TS = o.big ? 28 : 18, HR = o.big ? 24 : 17;
  if (o.live) out.push(ringsSvg(fr, pos, o.live.rings, o.unit, cv, (fr.view?.t || 0) + 8));
  const [px, py] = fr.xy(...pos), [ax, ay] = fr.xy(...aim), [rgb, line] = riskCol(pat?.risk), dash = pat?.estimated ? ' stroke-dasharray="6 4"' : '';
  if (pat?.v2) out.push(patternSvg(fr, pos, aim, pat));
  else if (pat?.ell50) {
    if (pat.ell90) out.push(`<path d="${P(pat.ell90.map((p) => fr.xy(...p)))}Z" fill="rgba(${rgb},.16)" stroke="rgba(${rgb},.95)" stroke-width="1.4" stroke-dasharray="4 3"/>`);
    out.push(`<path d="${P(pat.ell50.map((p) => fr.xy(...p)))}Z" fill="rgba(${rgb},.32)" stroke="${line}" stroke-width="2.2"${dash}/>`);
  } else if (pat?.arc) out.push(`<path d="${P(pat.arc.map((p) => fr.xy(...p)))}" fill="none" stroke="#ffd640" stroke-width="3" stroke-linecap="round"/>`);
  for (const d of pat?.v2 ? [] : pat?.dots || []) {
    const [x, y] = fr.xy(...(d.p || d));
    out.push(d.bad ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#ff4d3d" stroke="#fff" stroke-width=".9"/>` : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="rgba(255,255,255,.9)" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>`);
  }
  out.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`);
  const dAim = A.haversine(pos[0], pos[1], aim[0], aim[1]);
  out.push(tag((px + ax) / 2 + TS * 1.45, (py + ay) / 2, Math.round(cv(dAim)), TS));
  if (green && A.haversine(aim[0], aim[1], green[0], green[1]) > 4) {
    const [gx, gy] = fr.xy(...green), dG = A.haversine(aim[0], aim[1], green[0], green[1]);
    out.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="rgba(255,255,255,.85)" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    out.push(tag((ax + gx) / 2 + TS * 1.45, (ay + gy) / 2, Math.round(cv(dG)), TS));
  }
  // aim ring + thumb handle
  const off = o.pad ?? padOffset(ay, fr.h), hy = ay + off, sgn = Math.sign(off);
  out.push(`<g class="hm-aim"><line x1="${ax.toFixed(1)}" y1="${(ay + sgn * 12).toFixed(1)}" x2="${ax.toFixed(1)}" y2="${(hy - sgn * 17).toFixed(1)}" stroke="rgba(255,255,255,.8)" stroke-width="1.5" stroke-dasharray="2 3"/>
    <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="11" fill="rgba(10,61,43,.35)" stroke="#fff" stroke-width="2.5"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3" fill="#fff"/>
    <g class="hm-pad"><circle cx="${ax.toFixed(1)}" cy="${hy.toFixed(1)}" r="${HR}" fill="rgba(255,255,255,.92)" stroke="#0a3d2b" stroke-width="1.5"/>${[-5, 0, 5].map((d) => `<line x1="${(ax - 6).toFixed(1)}" y1="${(hy + d).toFixed(1)}" x2="${(ax + 6).toFixed(1)}" y2="${(hy + d).toFixed(1)}" stroke="#0a3d2b" stroke-width="1.6" stroke-linecap="round"/>`).join('')}</g></g>`);
  const riskTxt = A.isNum(pat?.risk) ? ` · ${Math.round(pat.risk)}% trouble` : '';
  if (pat?.v2 && pat.miss?.show && pat.centre) out.push(missArrow(fr, aim, pat.centre));
  if (clubName) out.push(lbl(ax, ay - sgn * (o.big ? 26 : 20), `${clubName}${pat?.estimated ? ' (est.)' : ''}${riskTxt}`, 'mid'));
  if (o.live) out.push(posDot(fr, pos, o.live.acc));
  return out.join('');
}

// ---- the redesigned pattern (Course view): neutral fading zones, trouble tinted and hatched where it is,
// corridor edges, distance ticks, and – only on request – your past shots, with trouble marked by shape as well as colour.
// kind: 'own' (solid), 'estimated' (dashed, no dots, no miss arrow), 'distance' (distance arc only).
const ZONE_DEFS = `<defs><radialGradient id="hmZoneIn"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".75" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity=".08"/></radialGradient>
<radialGradient id="hmZoneOut"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".8" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></radialGradient>
<pattern id="hmHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="rgba(214,48,36,.5)"/><line x1="0" y1="0" x2="0" y2="7" stroke="#fff" stroke-width="2.2" stroke-opacity=".85"/></pattern></defs>`;
export function patternSvg(fr, pos, aim, pat) {
  const out = [ZONE_DEFS], est = pat.kind === 'estimated', dash = est ? ' stroke-dasharray="7 5"' : '';
  const path = (pts) => `${P(pts.map((p) => fr.xy(...p)))}Z`;
  if (pat.kind === 'distance') {
    if (pat.arc) out.push(`<path class="hm-arc" d="${P(pat.arc.map((p) => fr.xy(...p)))}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-opacity=".95"/>`);
  } else {
    for (const e of [pat.left, pat.right]) if (e) { const [a, b] = e.map((p) => fr.xy(...p)); out.push(`<line class="hm-edge" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#fff" stroke-opacity=".75" stroke-width="1.6"${dash}/>`); }
    if (pat.outer) out.push(`<path class="hm-zone90" d="${path(pat.outer)}" fill="url(#hmZoneOut)" stroke="#fff" stroke-opacity="${est ? '.7' : '.35'}" stroke-width="1.2"${dash}/>`);
    if (pat.inner) out.push(`<path class="hm-zone50" d="${path(pat.inner)}" fill="url(#hmZoneIn)" stroke="#fff" stroke-opacity="${est ? '.9' : '.6'}" stroke-width="1.6"${dash}/>`);
    for (const h of pat.haz || []) out.push(`<path class="hm-trouble" data-kind="${h.kind}" d="${path(h.pts)}" fill="url(#hmHatch)" stroke="#ff6b57" stroke-width="1.6"/>`);
  }
  if (pat.ticks) {
    const a0 = fr.xy(...pos), a1 = fr.xy(...aim), L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1, nx = -(a1[1] - a0[1]) / L, ny = (a1[0] - a0[0]) / L;
    for (const t of [pat.ticks.p25, pat.ticks.p75]) { const [x, y] = fr.xy(...t); out.push(`<line class="hm-tick" x1="${(x - nx * 11).toFixed(1)}" y1="${(y - ny * 11).toFixed(1)}" x2="${(x + nx * 11).toFixed(1)}" y2="${(y + ny * 11).toFixed(1)}" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><line x1="${(x - nx * 11).toFixed(1)}" y1="${(y - ny * 11).toFixed(1)}" x2="${(x + nx * 11).toFixed(1)}" y2="${(y + ny * 11).toFixed(1)}" stroke="#0a3d2b" stroke-width="1.2" stroke-linecap="round"/>`); }
  }
  for (const d of pat.dots || []) {
    const [x, y] = fr.xy(...(d.p || d));
    out.push(d.bad ? `<path class="hm-dot bad" d="M${(x - 4).toFixed(1)} ${(y - 4).toFixed(1)}l8 8m0-8l-8 8" stroke="#fff" stroke-width="4.4" stroke-linecap="round"/><path d="M${(x - 4).toFixed(1)} ${(y - 4).toFixed(1)}l8 8m0-8l-8 8" stroke="#d63024" stroke-width="2.4" stroke-linecap="round"/>`
      : `<circle class="hm-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="rgba(255,255,255,.95)" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>`);
  }
  return out.join('');
}
// a small arrow from the aim to where this club's shots usually finish
function missArrow(fr, aim, centre) {
  const [ax, ay] = fr.xy(...aim), [cx, cy] = fr.xy(...centre), L = Math.hypot(cx - ax, cy - ay);
  if (L < 8) return '';
  const ux = (cx - ax) / L, uy = (cy - ay) / L, sx = ax + ux * 13, sy = ay + uy * 13, hx = cx - ux * 9 - uy * 6, hy = cy - uy * 9 + ux * 6, kx = cx - ux * 9 + uy * 6, ky = cy - uy * 9 - ux * 6;
  const d = `M${sx.toFixed(1)} ${sy.toFixed(1)}L${cx.toFixed(1)} ${cy.toFixed(1)}M${hx.toFixed(1)} ${hy.toFixed(1)}L${cx.toFixed(1)} ${cy.toFixed(1)}L${kx.toFixed(1)} ${ky.toFixed(1)}`;
  return `<g class="hm-miss"><path d="${d}" fill="none" stroke="#0a3d2b" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#f2cf4a" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

export function svg(fr, staticPart, dynPart, style) {
  return `<svg id="hm" class="holemap ${style}" viewBox="0 0 ${fr.w} ${fr.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hole map – drag the handle under the white ring to set your aim">${staticPart}<g id="hmDyn">${dynPart}</g></svg>`;
}
