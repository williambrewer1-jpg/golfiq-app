// Plays-like distances, terrain elevation, the strokes-gained strategy predictor and the range-round engine.
// Pure functions (network fetches return plain data), so everything here is unit-testable.
import * as A from './analytics.js';
import * as F from './features.js';
import * as HM from './holemap.js';

const RAD = Math.PI / 180, MPH = 0.621371;            // km/h -> mph
// ------------------------------------------------------------------ plays like
// Rules of thumb, each labelled in the app:
//  elevation: 1 m up plays 1 m longer (common caddie rule)
//  wind: into the wind about +1% per mph, downwind about -0.5% per mph (GolfWRX rule of thumb; a headwind hurts more than a tailwind helps)
//  temperature: about 1 yd per 10°F for a mid-iron vs 70°F (18Birdies) ≈ 0.12% per °C
//  altitude: ball flies ~1.16% further per 1000 ft above sea level (Titleist)
export function playsLike(dist_m, o = {}) {
  if (!A.isNum(dist_m)) return null;
  const parts = { elev: 0, wind: 0, temp: 0, alt: 0 };
  if (A.isNum(o.dz_m)) parts.elev = o.dz_m;
  if (A.isNum(o.wind_kmh) && A.isNum(o.wind_from) && A.isNum(o.bearing)) {
    const head = o.wind_kmh * MPH * Math.cos((o.wind_from - o.bearing) * RAD);      // + = into you
    parts.wind = dist_m * (head >= 0 ? 0.01 * head : 0.005 * head);
    parts.head_mph = head; parts.cross_mph = o.wind_kmh * MPH * Math.sin((o.wind_from - o.bearing) * RAD);
  }
  if (A.isNum(o.temp_c)) parts.temp = dist_m * 0.0012 * (21 - o.temp_c);
  if (A.isNum(o.alt_m) && o.alt_m > 0) parts.alt = -dist_m * o.alt_m * 3.28084 * 1.16e-5;
  const factor = 1 + (parts.wind + parts.temp + parts.alt) / dist_m;               // proportional effects
  return { plays_m: dist_m + parts.elev + parts.wind + parts.temp + parts.alt, factor, parts };
}
// A shot whose flat-ground distance is y lands at y' along the ground once slope/wind/temperature are allowed for.
export const groundDistance = (y, dz, factor) => Math.max(0, (y - (dz || 0)) / (factor || 1));

// ------------------------------------------------------------------ elevation grid (Open-Meteo, Copernicus 90 m DEM)
export function elevGridSpec(fr, n = 9) {
  const corners = [[0, 0], [fr.w, 0], [0, fr.h], [fr.w, fr.h]].map(([x, y]) => fr.fromXY(x, y));
  const la = corners.map((p) => p[0]), lo = corners.map((p) => p[1]);
  const spec = { lat0: Math.min(...la), lat1: Math.max(...la), lon0: Math.min(...lo), lon1: Math.max(...lo), n };
  spec.points = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) spec.points.push([spec.lat0 + (spec.lat1 - spec.lat0) * i / (n - 1), spec.lon0 + (spec.lon1 - spec.lon0) * j / (n - 1)]);
  return spec;
}
export const elevUrl = (pts) => `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p[0].toFixed(5)).join(',')}&longitude=${pts.map((p) => p[1].toFixed(5)).join(',')}`;
export function elevAt(g, lat, lon) {
  if (!g?.values?.length) return null;
  const fi = Math.max(0, Math.min(g.n - 1, (lat - g.lat0) / ((g.lat1 - g.lat0) || 1) * (g.n - 1))), fj = Math.max(0, Math.min(g.n - 1, (lon - g.lon0) / ((g.lon1 - g.lon0) || 1) * (g.n - 1)));
  const i = Math.min(Math.floor(fi), g.n - 2), j = Math.min(Math.floor(fj), g.n - 2), ti = fi - i, tj = fj - j, v = (a, b) => g.values[a * g.n + b];
  return (1 - ti) * ((1 - tj) * v(i, j) + tj * v(i, j + 1)) + ti * ((1 - tj) * v(i + 1, j) + tj * v(i + 1, j + 1));
}
export const gridCovers = (g, pts) => g && pts.every(([la, lo]) => la >= g.lat0 - 1e-4 && la <= g.lat1 + 1e-4 && lo >= g.lon0 - 1e-4 && lo <= g.lon1 + 1e-4);

// ------------------------------------------------------------------ where a ball finishes, and what that's worth
// Lie for the strokes-gained baseline, from the mapped surface. Water = penalty + drop in the rough.
export function lieFor(surface) {
  return { green: 'green', fairway: 'fairway', tee: 'fairway', rough: 'rough', bunker: 'sand', trees: 'recovery', water: 'rough' }[surface] || 'rough';
}
// Expected strokes to finish the hole from each landing spot.
export function expectedFrom(landing, green, feats, E) {
  let tot = 0, pen = 0, n = 0;
  for (const [la, lo] of landing) {
    const surf = F.surfaceAt(la, lo, feats) || 'rough', d = A.haversine(la, lo, green[0], green[1]);
    const e = E(lieFor(surf), surf === 'green' ? Math.max(d, 0.3) : d); if (!A.isNum(e)) continue;
    tot += e + (surf === 'water' ? 1 : 0); pen += surf === 'water' ? 1 : 0; n++;
  }
  return n ? { expected: tot / n, water_pct: 100 * pen / n, n } : null;
}
// Strategy predictor: for each club, aim along the hole at that club's distance (or at the green if it reaches),
// drop your real shot pattern there and add up what each finishing spot is worth.
// Only the outlines near this shot matter – keeps the maths quick on a phone.
export function nearFeatures(feats, pts, radius = 350) {
  return (feats || []).filter((f) => f.kind !== 'hole' && f.pts.some((p) => pts.some((q) => Math.abs(p[0] - q[0]) < radius / 111000 && A.haversine(p[0], p[1], q[0], q[1]) < radius)));
}
export function predict({ ds, pos, green, line, feats, E, clubs, dz = () => 0, factor = 1, aimFor = null, maxPts = 150, minFrac = 0, patternOf = (id) => F.clubPattern(ds, id) }) {
  const dGreen = A.haversine(pos[0], pos[1], green[0], green[1]), out = [];
  feats = nearFeatures(feats, [pos, green, ...(line || [])], Math.max(250, dGreen * 0.6));
  for (const c of clubs) {
    const pt = patternOf(c.club_id);
    if (!pt.stats.enough || !A.isNum(pt.median_m)) continue;
    if (pt.median_m > dGreen * 1.25 + 30 || pt.median_m < dGreen * minFrac) continue;   // far too much (or too little) club
    const reach = groundDistance(pt.median_m, 0, factor), goGreen = reach >= dGreen - 15;
    const aim = aimFor ? aimFor(c) : goGreen ? green : HM.pointAlongHole(pos, green, line, reach);
    const br = A.bearing(pos[0], pos[1], aim[0], aim[1]);
    const sample = pt.pts.length > maxPts ? pt.pts.filter((_, i) => i % Math.ceil(pt.pts.length / maxPts) === 0) : pt.pts;
    const landing = sample.map((p) => { const land0 = F.offsetPoint(pos[0], pos[1], br, p.y, p.x); return F.offsetPoint(pos[0], pos[1], br, groundDistance(p.y, dz(land0), factor), p.x); });
    const r = expectedFrom(landing, green, feats, E); if (!r) continue;
    const o = HM.outcomes(landing, feats);
    out.push({ club_id: c.club_id, club: c.name, aim, n: sample.length, expected: 1 + r.expected, water_pct: r.water_pct, out: o, goes_for_green: goGreen });
  }
  out.sort((a, b) => a.expected - b.expected);
  out.forEach((r) => { r.vs_best = r.expected - out[0].expected; });
  return out;
}

// ------------------------------------------------------------------ range round: play a course on the range
// Each hole: hit the shots the app calls for and tap how they finished. Once you're on or around the green,
// the rest of the hole is scored from what you'd expect to take from there (your own strokes-gained model).
export const RR_LONG = [['fairway', 'Fairway'], ['left', 'Rough left'], ['right', 'Rough right'], ['trouble', 'Trouble (+1)']];
export const RR_GREEN = [['green', 'On the green'], ['fringe', 'Just off'], ['missed', 'Missed the green'], ['bunker', 'Greenside bunker'], ['trouble', 'Trouble (+1)']];
const FINISH = { green: null, fringe: ['rough', 9], missed: ['rough', 22], bunker: ['sand', 14] };
export function rrStart(course) {
  return { id: `rr-${Date.now()}`, course_id: course.course_id, course_name: course.name, rating: course.rating ?? null, slope: course.slope ?? null,
    holes: course.holes.map((h) => ({ hole: h.hole, par: h.par, len_m: h.len_m, shots: [], strokes: 0, remaining_m: h.len_m, lie: 'tee', done: false, score: null })), i: 0, started: new Date().toISOString() };
}
export function rrApply(rr, clubMedian, result, greenPuttM, E) {
  const h = rr.holes[rr.i]; if (!h || h.done) return rr;
  const going = clubMedian >= h.remaining_m - 20;
  h.shots.push({ result, from_m: h.remaining_m, club_m: clubMedian }); h.strokes += 1;
  if (result === 'trouble') { h.strokes += 1; h.lie = 'rough'; h.remaining_m = Math.max(5, Math.abs(h.remaining_m - clubMedian * 0.8)); }
  else if (!going || ['fairway', 'left', 'right'].includes(result)) { h.remaining_m = Math.max(5, Math.abs(h.remaining_m - clubMedian)); h.lie = result === 'fairway' ? 'fairway' : 'rough'; }
  else {
    const [lie, d] = result === 'green' ? ['green', greenPuttM] : FINISH[result];
    h.finish = { lie, d }; h.score = h.strokes + E(lie, d); h.done = true;
  }
  if (!h.done && h.shots.length >= h.par + 3) { h.finish = { lie: 'rough', d: 20 }; h.score = h.strokes + E('rough', 20); h.done = true; }
  if (h.done && rr.i < rr.holes.length - 1) rr.i += 1;
  return rr;
}
export function rrTotals(rr) {
  const done = rr.holes.filter((h) => h.done), score = done.reduce((t, h) => t + h.score, 0), par = done.reduce((t, h) => t + h.par, 0);
  const full = done.length === rr.holes.length;
  const diff = full && A.isNum(rr.rating) && A.isNum(rr.slope) && rr.holes.length === 18 ? 113 / rr.slope * (score - rr.rating) : null;
  return { holes: done.length, score, par, to_par: score - par, full, differential: diff };
}

// Hazards around a green, by side, as seen from the tee/approach line (for the strategy card).
export function greenHazards(from, green, feats) {
  const g = (feats || []).find((f) => f.kind === 'green' && F.pointInPolygon(green[0], green[1], f.pts));
  const br = A.bearing(from[0], from[1], green[0], green[1]), sides = { short: [], long: [], left: [], right: [] };
  for (const f of feats || []) {
    if (!['bunker', 'water'].includes(f.kind)) continue;
    const cLat = A.mean(f.pts.map((p) => p[0])), cLon = A.mean(f.pts.map((p) => p[1])), d = A.haversine(green[0], green[1], cLat, cLon);
    if (d > (g ? 40 : 30)) continue;
    const [al, cr] = A.alongCross(green[0], green[1], cLat, cLon, br), side = Math.abs(al) > Math.abs(cr) ? (al > 0 ? 'long' : 'short') : (cr > 0 ? 'right' : 'left');
    sides[side].push(f.kind);
  }
  const safe = ['short', 'left', 'right', 'long'].filter((k) => !sides[k].length);
  return { sides, safe };
}
