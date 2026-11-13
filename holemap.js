// GolfIQ hole map: an SVG drawing of the hole (illustrated from OpenStreetMap outlines, or satellite photos),
// turned so you are at the bottom looking up the hole, with your shot pattern and a draggable aim point.
// Pure geometry + SVG strings; no DOM access, so it is unit-testable.
import * as A from './analytics.js';
import * as F from './features.js';

const R = 6371008.8, RAD = Math.PI / 180;
export const W = 360, H = 470;            // viewBox size; the SVG scales to the screen width

// ------------------------------------------------------------------ frame: lat/lon <-> screen
// Local flat frame centred on `pos`, rotated so the line pos -> up points to the top of the screen.
// c = metres right of that line, a = metres along it.
export function makeFrame(pos, up, include, w = W, h = H) {
  const b = A.bearing(pos[0], pos[1], up[0], up[1]) * RAD, cb = Math.cos(b), sb = Math.sin(b);
  const kx = Math.cos(pos[0] * RAD) * R * RAD, ky = R * RAD;
  const toAC = (la, lo) => { const e = (lo - pos[1]) * kx, n = (la - pos[0]) * ky; return [e * cb - n * sb, e * sb + n * cb]; };
  const fromAC = (c, a) => { const e = c * cb + a * sb, n = -c * sb + a * cb; return [pos[0] + n / ky, pos[1] + e / kx]; };
  const ac = [[0, 0], toAC(up[0], up[1]), ...include.filter(Boolean).map((p) => (p.ac ? p.ac : toAC(p[0], p[1])))];
  let c0 = Math.min(...ac.map((p) => p[0])) - 28, c1 = Math.max(...ac.map((p) => p[0])) + 28;
  let a0 = Math.min(...ac.map((p) => p[1])) - 22, a1 = Math.max(...ac.map((p) => p[1])) + 26;
  const k = Math.min(w / (c1 - c0), h / (a1 - a0));
  const cm = (c0 + c1) / 2, am = (a0 + a1) / 2;                    // centre the content; the spare room goes to the sides
  const sx = (c) => (c - cm) * k + w / 2, sy = (a) => h / 2 - (a - am) * k;
  return {
    k, w, h, bearing: b / RAD, toAC, fromAC,
    xy: (la, lo) => { const [c, a] = toAC(la, lo); return [sx(c), sy(a)]; },
    acXY: (c, a) => [sx(c), sy(a)],
    fromXY: (x, y) => fromAC((x - w / 2) / k + cm, am - (y - h / 2) / k),
    // affine matrix taking (east m, -north m) around pos to screen pixels – used to place the photo tiles
    matrix: [k * cb, -k * sb, k * sb, k * cb, w / 2 - k * cm, h / 2 + k * am],
    toEN: (la, lo) => [(lo - pos[1]) * kx, (la - pos[0]) * ky],
  };
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
const tag = (x, y, t) => { const w = 12 * String(t).length + 12; return `<g class="hm-tag"><rect x="${(x - w / 2).toFixed(1)}" y="${(y - 13).toFixed(1)}" width="${w}" height="26" rx="8" fill="rgba(7,44,31,.86)" stroke="rgba(242,207,74,.9)" stroke-width="1"/><text class="hm-l big" x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" text-anchor="middle">${t}</text></g>`; };

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
  // distance rings from where you are
  const [px, py] = fr.xy(...pos), step = unit === 'yd' ? 45.72 : 50;
  for (let r = step; r < Math.min(rings || 0, step * 12); r += step) {
    const rad = r * fr.k; if (py - rad < 8) break;
    out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${rad.toFixed(1)}" fill="none" stroke="rgba(255,255,255,.38)" stroke-width="1" stroke-dasharray="3 5"/>`);
    out.push(lbl(px - 5, py - rad - 4, String(Math.round(cv(r))), 'ring'));
  }
  if (tee) { const [x, y] = fr.xy(...tee); out.push(`<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" rx="2" fill="#fff" stroke="#0a3d2b" stroke-width="1.5"/>`); }
  if (green) {
    const [x, y] = fr.xy(...green);
    out.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 26).toFixed(1)}" stroke="#fff" stroke-width="1.8"/><path d="M${x.toFixed(1)} ${(y - 26).toFixed(1)}l13 4.5-13 4.5z" fill="#f2cf4a" stroke="#8a6b10" stroke-width=".6"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#fff" stroke="#14261d" stroke-width="1"/>`);
  }
  out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="9" fill="rgba(46,134,222,.25)"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5.5" fill="#2e86de" stroke="#fff" stroke-width="2"/>`);
  if (posLabel) out.push(lbl(px, py + 22, posLabel, 'mid'));
  return out.join('');
}

// The part that moves while you drag: lines, pattern, aim marker, distance labels.
// The drag handle sits this far below the aim (above it near the bottom edge), so a thumb doesn't hide the aim.
export const PAD = 66;
export const padOffset = (ay, h = H) => (ay + PAD <= h - 16 ? PAD : -PAD);
const riskCol = (r) => (r === null || r === undefined ? ['255,214,64', '#ffd640'] : r >= 25 ? ['232,74,58', '#ff6b57'] : r >= 10 ? ['255,170,40', '#ffb030'] : ['120,220,110', '#8ee07d']);

// The part that moves while you drag: lines, pattern (coloured by risk), aim marker, thumb handle, distance tags.
export function dynamicSvg(fr, o) {
  const { pos, aim, green, pat, cv, clubName } = o, out = [];
  const [px, py] = fr.xy(...pos), [ax, ay] = fr.xy(...aim), [rgb, line] = riskCol(pat?.risk), dash = pat?.estimated ? ' stroke-dasharray="6 4"' : '';
  if (pat?.ell50) {
    if (pat.ell90) out.push(`<path d="${P(pat.ell90.map((p) => fr.xy(...p)))}Z" fill="rgba(${rgb},.16)" stroke="rgba(${rgb},.95)" stroke-width="1.4" stroke-dasharray="4 3"/>`);
    out.push(`<path d="${P(pat.ell50.map((p) => fr.xy(...p)))}Z" fill="rgba(${rgb},.32)" stroke="${line}" stroke-width="2.2"${dash}/>`);
  } else if (pat?.arc) out.push(`<path d="${P(pat.arc.map((p) => fr.xy(...p)))}" fill="none" stroke="#ffd640" stroke-width="3" stroke-linecap="round"/>`);
  for (const d of pat?.dots || []) {
    const [x, y] = fr.xy(...(d.p || d));
    out.push(d.bad ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#ff4d3d" stroke="#fff" stroke-width=".9"/>` : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="rgba(255,255,255,.9)" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>`);
  }
  out.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`);
  const dAim = A.haversine(pos[0], pos[1], aim[0], aim[1]);
  out.push(tag((px + ax) / 2 + 26, (py + ay) / 2, Math.round(cv(dAim))));
  if (green && A.haversine(aim[0], aim[1], green[0], green[1]) > 4) {
    const [gx, gy] = fr.xy(...green), dG = A.haversine(aim[0], aim[1], green[0], green[1]);
    out.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="rgba(255,255,255,.85)" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    out.push(tag((ax + gx) / 2 + 26, (ay + gy) / 2, Math.round(cv(dG))));
  }
  // aim ring + thumb handle
  const off = o.pad ?? padOffset(ay, fr.h), hy = ay + off, sgn = Math.sign(off);
  out.push(`<g class="hm-aim"><line x1="${ax.toFixed(1)}" y1="${(ay + sgn * 12).toFixed(1)}" x2="${ax.toFixed(1)}" y2="${(hy - sgn * 17).toFixed(1)}" stroke="rgba(255,255,255,.8)" stroke-width="1.5" stroke-dasharray="2 3"/>
    <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="11" fill="rgba(10,61,43,.35)" stroke="#fff" stroke-width="2.5"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3" fill="#fff"/>
    <g class="hm-pad"><circle cx="${ax.toFixed(1)}" cy="${hy.toFixed(1)}" r="17" fill="rgba(255,255,255,.92)" stroke="#0a3d2b" stroke-width="1.5"/>${[-5, 0, 5].map((d) => `<line x1="${(ax - 6).toFixed(1)}" y1="${(hy + d).toFixed(1)}" x2="${(ax + 6).toFixed(1)}" y2="${(hy + d).toFixed(1)}" stroke="#0a3d2b" stroke-width="1.6" stroke-linecap="round"/>`).join('')}</g></g>`);
  const riskTxt = A.isNum(pat?.risk) ? ` · ${Math.round(pat.risk)}% trouble` : '';
  if (clubName) out.push(lbl(ax, ay - sgn * 20, `${clubName}${pat?.estimated ? ' (est.)' : ''}${riskTxt}`, 'mid'));
  return out.join('');
}

export function svg(fr, staticPart, dynPart, style) {
  return `<svg id="hm" class="holemap ${style}" viewBox="0 0 ${fr.w} ${fr.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hole map – drag the handle under the white ring to set your aim">${staticPart}<g id="hmDyn">${dynPart}</g></svg>`;
}
