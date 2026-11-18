// BreakingPar caddie: strategy tips on the Course view (course-view plan, section 7). Pure – no DOM, no storage.
// Every tip is built from the golfer's own history, the mapped hole and the existing models. When there is not enough
// data behind a tip, it is not given: tips() returns [] rather than guess.
import * as A from './analytics.js';
import * as F from './features.js';

// ---- minimum samples and other tunable numbers (plan 7.1 and 10)
export const MIN = { hole_plays: 3, short_game: 20, long_putts: 20, layup_band: 10, trouble_gap: 10, si_max: 4 };
export const LONG_PUTT_M = 30 * 0.3048;                  // "from 30 ft+"
export const UD_BANDS_M = [[0, 9.144], [9.144, 18.288], [18.288, 27.432]];   // the dataset's short-game bands (0–10, 10–20, 20–30 yd)
export const WEDGE_MAX_M = 125 * 0.9144;                 // lay-up targets come from wedge distances up to 125 yd
export const BESIDE_GREEN_M = 12;                        // a hazard this close to the green's outline is "beside the green"
export const HAZARD_CORRIDOR_M = 30;                     // reach / carry labels: hazards this close to the line of play
export const HAZARD_LABELS_MAX = 4;
export const HAZARD_MIN_AHEAD_M = 10;               // a hazard beside you (reach under this) is not labelled
export const ON_TEE_M = 25;
const HAZ = ['bunker', 'water'];
const NAME = { bunker: 'Bunker', water: 'Water', trees: 'Trees' };

// Where the golfer is on the hole.
export function situation({ pos, tee = null, green, greenPts = null, shotsThisHole = 0, reach_m = null }) {
  if (!pos || !green) return null;
  const d = A.haversine(pos[0], pos[1], green[0], green[1]);
  if (greenPts?.length > 2 ? F.pointInPolygon(pos[0], pos[1], greenPts) : d <= 10) return 'green';
  if (!shotsThisHole && tee && A.haversine(pos[0], pos[1], tee[0], tee[1]) <= ON_TEE_M) return 'tee';
  if (d <= A.T.around_green_max_m) return 'around';
  if (A.isNum(reach_m) && d > reach_m) return 'layup';
  return 'approach';
}

// This hole in the golfer's history: times played, scoring, fairways, greens and the usual miss off the tee.
export function holeHistory(ds, courseId, hole) {
  if (!courseId) return null;
  const h = ds.holes.filter((x) => x.course_id === courseId && x.hole === hole && !x.excluded && A.isNum(x.strokes));
  if (!h.length) return { plays: 0 };
  const par = h[h.length - 1].par, fw = h.filter((x) => x.fw_hit !== null && x.fw_hit !== undefined), gir = h.filter((x) => x.gir_eff !== null && x.gir_eff !== undefined);
  const left = h.filter((x) => x.fairway === 'LEFT').length, right = h.filter((x) => x.fairway === 'RIGHT').length;
  const miss = left + right >= 2 && Math.max(left, right) >= 2 * Math.min(left, right) && left !== right ? (left > right ? 'left' : 'right') : null;
  return { plays: h.length, par, avg: A.mean(h.map((x) => x.strokes)), best: Math.min(...h.map((x) => x.strokes)),
    fw_hit: fw.filter((x) => x.fw_hit === 1).length, fw_n: fw.length, gir_hit: gir.filter((x) => x.gir_eff === 1).length, gir_n: gir.length,
    miss_side: miss, miss_left: left, miss_right: right };
}

// The golfer's own short-game and putting record, for the around-the-green and on-the-green tips.
export function golferStats(ds) {
  const key = (r, h) => `${r}|${h}`, hk = new Map(ds.holes.map((h) => [key(h.round_id, h.hole), h]));
  const ag = ds.shots.filter((s) => s.category === 'around_green' && !s.excluded && A.isNum(s.start_to_pin));
  const tries = [];
  for (const [k, g] of A.groupBy(ag, (s) => key(s.round_id, s.hole))) {
    const h = hk.get(k); if (!h || !A.isNum(h.putts_eff) || h.gir_eff !== 0) continue;
    const first = [...g].sort((a, b) => a.shot_order - b.shot_order)[0];
    tries.push({ d: first.start_to_pin, ok: g.length === 1 && h.putts_eff <= 1 });
  }
  const long = ds.holes.filter((h) => A.isNum(h.first_putt_eff_m) && h.first_putt_eff_m >= LONG_PUTT_M && A.isNum(h.putts_eff) && !h.excluded);
  return { ud: tries, long_putts: { n: long.length, three: long.filter((h) => h.putts_eff >= 3).length } };
}
// Best lay-up distance: the wedge band (up to 125 yd) the golfer finishes closest from, with enough shots.
export function bestLayup(bands, wedgeRows = []) {
  const ok = (bands || []).filter((b) => b.shots >= MIN.layup_band && A.isNum(b.median_proximity_m) && b.band_lo_m < WEDGE_MAX_M);
  if (ok.length) { const b = [...ok].sort((x, y) => x.median_proximity_m - y.median_proximity_m)[0]; return { kind: 'band', band: b.band, lo_m: b.band_lo_m, prox_m: b.median_proximity_m, n: b.shots }; }
  const full = (wedgeRows || []).filter((w) => /full/i.test(w.length) && A.isNum(w.carry_m)).sort((a, b) => b.n - a.n)[0];
  return full ? { kind: 'wedge', club: full.club, carry_m: full.carry_m } : null;
}

// Which sides of the green have a bunker or water (looking from pos), within BESIDE_GREEN_M of the outline.
export function greenSides(pos, green, greenPts, feats) {
  if (!pos || !green || !greenPts?.length) return null;
  const br = A.bearing(pos[0], pos[1], green[0], green[1]), out = { left: [], right: [], short: [], long: [] };
  const gx = greenPts.map((p) => A.alongCross(pos[0], pos[1], p[0], p[1], br)), [a0, a1] = [Math.min(...gx.map((p) => p[0])), Math.max(...gx.map((p) => p[0]))];
  const [c0, c1] = [Math.min(...gx.map((p) => p[1])), Math.max(...gx.map((p) => p[1]))];
  for (const f of feats || []) {
    if (!HAZ.includes(f.kind)) continue;
    const near = f.pts.some((p) => greenPts.some((q) => A.haversine(p[0], p[1], q[0], q[1]) <= BESIDE_GREEN_M)); if (!near) continue;
    const ac = f.pts.map((p) => A.alongCross(pos[0], pos[1], p[0], p[1], br)), ma = A.mean(ac.map((p) => p[0])), mc = A.mean(ac.map((p) => p[1]));
    const side = mc < c0 ? 'left' : mc > c1 ? 'right' : ma < a0 ? 'short' : ma > a1 ? 'long' : mc < 0 ? 'left' : 'right';
    if (!out[side].includes(f.kind)) out[side].push(f.kind);
  }
  return out;
}

// Bunkers and water within reach along the line of play: the distance to reach each and to carry it, nearest first.
export function hazardReach(pos, aim, feats, { max_m, corridor_m = HAZARD_CORRIDOR_M, limit = HAZARD_LABELS_MAX } = {}) {
  if (!pos || !aim || !feats?.length) return [];
  const br = A.bearing(pos[0], pos[1], aim[0], aim[1]), out = [];
  for (const f of feats) {
    if (!HAZ.includes(f.kind)) continue;
    const near = f.pts.map((p) => ({ p, a: A.alongCross(pos[0], pos[1], p[0], p[1], br) })).filter((x) => Math.abs(x.a[1]) <= corridor_m);
    if (near.some((x) => x.a[0] < HAZARD_MIN_AHEAD_M)) continue;          // beside you or behind: not something to reach or carry
    const ac = near; if (!ac.length) continue;
    const reach_m = Math.min(...ac.map((x) => x.a[0])), carry_m = Math.max(...ac.map((x) => x.a[0]));
    if (A.isNum(max_m) && reach_m > max_m) continue;
    const anchor = [...ac].sort((x, y) => Math.abs(x.a[1]) - Math.abs(y.a[1]))[0];
    out.push({ kind: f.kind, reach_m, carry_m, pt: anchor.p, side: Math.sign(A.mean(ac.map((x) => x.a[1]))) || 1 });
  }
  return out.sort((a, b) => a.reach_m - b.reach_m).slice(0, limit);
}

// ---- the tips. Inputs:
// hole: { n, par, si, d_green_m, front_m, back_m, pos, green, greenPts }   history: holeHistory()
// model: { top: [{ club, out: { trouble } }], haz: [{ kind, pts }] (hazards inside the landing zone), aim }
// stats: golferStats()   wedges: { bands: approachByBand(shots, 'm'), rows: wedge rows }   u: { d: (m) => number in the unit, unit, small: (m) => string }
export function tips({ situation: sit, hole, history, model, feats, wedges, stats, u }) {
  const out = [], D = (m) => Math.round(u.d(m)), add = (key, text, strength, detail = '') => out.push({ key, text, detail, strength });
  const hist = history && history.plays >= MIN.hole_plays ? history : null;
  if (sit === 'tee') {
    const tr = (model?.top || []).filter((r) => r.out && A.isNum(r.out.trouble)).map((r) => ({ club: r.club, t: r.out.trouble }));
    const lo = tr.length > 1 ? [...tr].sort((a, b) => a.t - b.t)[0] : null, hi = tr.length > 1 ? [...tr].sort((a, b) => b.t - a.t)[0] : null;
    const gap = lo && hi && hi.t - lo.t >= MIN.trouble_gap;
    if (hist || gap) {
      const t = [hist ? `You average ${hist.avg.toFixed(1)} here.` : null, gap ? `${lo.club}: ${Math.round(lo.t)}% trouble; ${hi.club}: ${Math.round(hi.t)}%.` : null].filter(Boolean).join(' ');
      add('tee-clubs', t, 0.35 + (gap ? Math.min(0.5, (hi.t - lo.t) / 60) : 0), hist ? `${hist.plays} plays of this hole` : '');
    }
    const zone = (model?.haz || []).filter((h) => h.kind === 'water' || h.kind === 'bunker' || h.kind === 'trees');
    if (zone.length && model?.pos && model?.aim) {
      const br = A.bearing(model.pos[0], model.pos[1], model.aim[0], model.aim[1]);
      const parts = zone.map((h) => { const ac = h.pts.map((p) => A.alongCross(model.pos[0], model.pos[1], p[0], p[1], br)); return { kind: h.kind, lo: Math.min(...ac.map((p) => p[0])), hi: Math.max(...ac.map((p) => p[0])), side: A.mean(ac.map((p) => p[1])) < 0 ? 'left' : 'right', area: h.area_m2 || 0 }; });
      const sides = new Set(parts.map((p) => p.side)), main = [...parts].sort((a, b) => b.area - a.area)[0];
      const where = `${NAME[main.kind].toLowerCase()} at ${D(main.lo)}–${D(main.hi)}`;
      if (sides.size === 1) add('tee-trouble', `Trouble is ${main.side}: ${where}. Favour the ${main.side === 'left' ? 'right' : 'left'} half.`, 0.7);
      else add('tee-trouble', `Trouble both sides: ${where} ${main.side}. Keep it in the middle.`, 0.6);
    }
  }
  if (sit === 'approach' && A.isNum(hole?.front_m) && A.isNum(hole?.back_m)) {
    const sides = greenSides(hole.pos, hole.green, hole.greenPts, feats);
    const lr = sides ? ['left', 'right'].filter((s) => sides[s].length) : [];
    if (lr.length === 1) {
      const s = lr[0], k = NAME[sides[s][0]].toLowerCase();
      add('green-sides', `Front ${D(hole.front_m)}, back ${D(hole.back_m)}. Short-sided if you miss ${s}: ${k} ${s} of the green.`, 0.6);
    } else if (lr.length === 2) add('green-sides', `Front ${D(hole.front_m)}, back ${D(hole.back_m)}. Trouble both sides of the green: aim for the middle.`, 0.5);
  }
  if (sit === 'layup') {
    const b = bestLayup(wedges?.bands, wedges?.rows);
    if (b?.kind === 'band') {
      const lo = D(b.lo_m), to = Math.round((lo + 12.5) / 5) * 5;
      add('layup', `Lay up to about ${to}: your best wedge distance.`, 0.6, `From ${b.band.replace(/ (m|yd)$/, '')} you finish ${u.small(b.prox_m)} from the hole on average (${b.n} shots).`);
    } else if (b?.kind === 'wedge') add('layup', `Lay up to ${D(b.carry_m)}: your full ${b.club}.`, 0.5, 'From your wedge distances.');
  }
  if (sit === 'around' && stats?.ud?.length && A.isNum(hole?.d_green_m)) {
    const band = UD_BANDS_M.find(([lo, hi]) => hole.d_green_m > lo && hole.d_green_m <= hi);
    const inBand = band ? stats.ud.filter((x) => x.d > band[0] && x.d <= band[1]) : [];
    if (inBand.length >= MIN.short_game) { const p = Math.round(100 * inBand.filter((x) => x.ok).length / inBand.length); add('up-down', `You get up and down ${p}% from here.`, 0.55, `${inBand.length} times from ${D(band[0])}–${D(band[1])} ${u.unit}.`); }
    else if (stats.ud.length >= MIN.short_game) { const p = Math.round(100 * stats.ud.filter((x) => x.ok).length / stats.ud.length); add('up-down', `You get up and down ${p}% of the time around the green.`, 0.45, `${stats.ud.length} times.`); }
  }
  if (sit === 'green' && stats?.long_putts?.n >= MIN.long_putts && A.isNum(hole?.d_green_m) && hole.d_green_m >= LONG_PUTT_M) {
    const { n, three } = stats.long_putts, far = u.unit === 'yd' ? '30 ft+' : `${Math.round(LONG_PUTT_M)} m+`;
    if (three === 0) add('lag', `From ${far} you have not three-putted in ${n} tries.`, 0.35);
    else { const k = Math.max(2, Math.round(n / three)); add('lag', `From ${far} you three-putt 1 in ${k}. Lag it close.`, 0.4 + Math.min(0.4, three / n), `${three} of ${n} holes.`); }
  }
  if (hist && A.isNum(hole?.si) && hole.si >= 1 && hole.si <= MIN.si_max && hist.avg >= hole.par + 1) {
    add('stroke-index', `Stroke index ${hole.si}: bogey is a good score here.`, 0.3, `You average ${hist.avg.toFixed(1)} on this par ${hole.par}.`);
  }
  return out.sort((a, b) => b.strength - a.strength);
}
