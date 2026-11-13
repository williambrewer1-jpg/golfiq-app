// Skill handicaps: each skill (Putting, Short game, Approach, Driving) gets its own handicap, with sub-skills to drill into.
// A sub-skill is rated by inverting a published benchmark ("your number is what a golfer of handicap X typically does").
// Pure functions, no DOM. Benchmarks come from bench.js / coach.js (Shot Scope data) or, for chip proximity and tee penalties, assumptions built from those tables (bench.js ASSUMED).
import * as A from './analytics.js';
import * as B from './bench.js';
import * as CO from './coach.js';
const { isNum, mean, median } = A;
const M_PER_YD = 0.9144, M_PER_FT = 0.3048;

// Driving distance has no published strokes value, so it is modelled from the approach tables in bench.js: a longer drive leaves a shorter
// approach, valued as the putts saved on that approach (the same way the approach bands are). Every number here can be tuned.
export const DRIVING = { distance_weight: 0.4, approach_yd: 150, approach_lo: 75, approach_hi: 230, min_approach_n: 8 };

// ------------------------------------------------------------------ the model (plan section 4.1)
// Chip proximity and Tee penalties have no published standard: their benchmarks are ASSUMED (see bench.js ASSUMED) and flagged in the UI.
export const SKILLS = [
  { key: 'putting', title: 'Putting', subs: [
    { key: 'short', title: 'Short putts (3–6 ft)', games: ['putt-369', 'putt-streak'], weight: 0.35 },
    { key: 'mid', title: 'Mid putts (6–12 ft)', games: ['putt-369', 'putt-par18'], weight: 0.25 },
    { key: 'lag', title: 'Lag putting', games: ['putt-lag', 'putt-par18'], weight: 0.40 }] },
  { key: 'short', title: 'Short game', subs: [
    { key: 'updown', title: 'Up and down', games: ['chip-updown', 'chip-par18'], weight: 0.8 },
    { key: 'chip', title: 'Chip proximity', games: ['chip-zone'], weight: 0.2 }] },
  { key: 'approach', title: 'Approach', subs: [
    { key: 'gir', title: 'Greens in regulation', games: ['range-greens', 'range-course'], weight: 0.4 },
    { key: 'wedge', title: 'Wedges (50–100 yd)', games: ['range-wedge', 'combine'], weight: 0.2 },
    { key: 'mid', title: 'Mid irons (100–150 yd)', games: ['range-greens', 'combine'], weight: 0.2 },
    { key: 'long', title: 'Long irons (150–200 yd)', games: ['range-greens', 'combine'], weight: 0.2 }] },
  { key: 'driving', title: 'Driving', subs: [
    { key: 'distance', title: 'Distance', games: ['range-driver', 'range-speed'], weight: DRIVING.distance_weight },
    { key: 'penalties', title: 'Tee penalties', games: ['range-fairways', 'range-course', 'range-driver'], weight: 0.4 },
    { key: 'accuracy', title: 'Accuracy', games: ['range-fairways', 'range-driver'], weight: 0.2 }] },
];
// every tunable number in one place
export const RATING = { window: 20, min_rounds: 5, min_pct_n: 20, min_prox_n: 8, practice_scores: 5, practice_offset: 3, step: 3, max_hcp: 36 };
// Driver distance (yd) at scratch / 10 / 20 lives in bench.js (Golf Monthly / Shot Scope, the same source as CO.STANDARD_SOURCE)
export const DRIVER_YD = B.DRIVER_YD;
const BAND_YD = { wedge: [50, 100], mid: [100, 150], long: [150, 200] };
export const ASSUMED_SUBS = ['chip', 'penalties'];            // benchmark is an assumption built from the published tables, not a published figure

// ------------------------------------------------------------------ benchmarks as functions of handicap
// Published tables stop at 25: carry the 20→25 slope on beyond it, never below zero.
const ext = (f) => (h) => (h <= 25 ? f(h) : Math.max(0, f(25) + (f(25) - f(20)) / 5 * (h - 25)));
const std0 = (key) => (h) => Math.max(0, CO.standard(key, h));
export const BENCH = {
  'putting.short': ext((h) => 100 * B.makeProb(4.5, h)),
  'putting.mid': ext((h) => 100 * B.makeProb(9, h)),
  'putting.lag': std0('three'),
  'short.updown': ext((h) => 100 * B.upDown(h)),
  'approach.gir': std0('gir'),
  'approach.wedge': ext((h) => B.proximityFt(75, h)),
  'approach.mid': ext((h) => B.proximityFt(125, h)),
  'approach.long': ext((h) => B.proximityFt(175, h)),
  'driving.distance': B.driverYd,
  'driving.accuracy': std0('fw'),
  'short.chip': ext((h) => 100 * B.chipOnGreen(h)),
  'driving.penalties': (h) => B.teePenalties(h),            // per 14 tee shots
};
// Which way is better. Lower is better for three-putts and proximity.
const HIGHER = { 'putting.short': true, 'putting.mid': true, 'putting.lag': false, 'short.updown': true, 'approach.gir': true, 'approach.wedge': false,
  'approach.mid': false, 'approach.long': false, 'driving.distance': true, 'driving.accuracy': true, 'short.chip': true, 'driving.penalties': false };
const clampH = (h) => Math.max(0, Math.min(RATING.max_hcp, h));
// The handicap whose benchmark equals `value` (bisection: every benchmark is monotone in handicap), clamped to 0–36.
export function rateValue(key, value) {
  const f = BENCH[key]; if (!f || !isNum(value)) return null;
  // at(h): this handicap's number is no better than `value`, so the golfer is at least a handicap h. False below their rating, true above.
  const up = f(RATING.max_hcp) > f(0), at = (h) => (up ? f(h) >= value : f(h) <= value);
  if (at(0)) return 0; if (!at(RATING.max_hcp)) return RATING.max_hcp;
  let lo = 0, hi = RATING.max_hcp;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (at(mid)) hi = mid; else lo = mid; }
  return clampH((lo + hi) / 2);
}

// ------------------------------------------------------------------ helpers
// expected putts from a first putt of d ft for handicap h (same model as the Par-18 putting game in bench.js)
const expPutts = (d, h) => { const m1 = B.makeProb(d, h), lv = d * B.leave30(h) / 30; return 1 + (1 - m1) * (1 + (1 - B.makeProb(lv, h))); };

// ------------------------------------------------------------------ course measures: you, n, extras, in benchmark units (yd, ft, %)
function measures({ rounds, holes, shots }) {
  const out = {}, nR = rounds.length;
  const hs = holes, byRound = (arr) => A.groupBy(arr, (x) => x.round_id);
  // putting
  const fp = hs.filter((x) => isNum(x.first_putt_eff_m) && isNum(x.putts_eff) && x.putts_eff > 0);
  const band = (lo, hi) => fp.filter((x) => x.first_putt_eff_m / M_PER_FT > lo && x.first_putt_eff_m / M_PER_FT <= hi);
  for (const [k, lo, hi] of [['putting.short', 3, 6], ['putting.mid', 6, 12]]) { const g = band(lo, hi);
    out[k] = { n: g.length, you: g.length ? 100 * g.filter((x) => x.putts_eff === 1).length / g.length : null, per_round: g.length / Math.max(1, nR) }; }
  const pu = hs.filter((x) => isNum(x.putts_eff));
  out['putting.lag'] = { n: pu.length, you: pu.length ? 100 * pu.filter((x) => x.putts_eff >= 3).length / pu.length : null };
  // short game
  const missed = hs.filter((x) => x.gir_eff === 0 && isNum(x.to_par));
  out['short.updown'] = { n: missed.length, you: missed.length ? 100 * missed.filter((x) => x.to_par <= 0).length / missed.length : null };
  const ag = shots.filter((s) => s.category === 'around_green' && !s.excluded && isNum(s.on_green_end));
    const agHoles = [...A.groupBy(ag, (s) => `${s.round_id}|${s.hole}`)].map(([k, g]) => { const [rid, hole] = k.split('|'), h = hs.find((x) => x.round_id === rid && String(x.hole) === hole);
    return h && isNum(h.to_par) ? { to_par: h.to_par, chip_on: g[g.length - 1].on_green_end } : null; }).filter(Boolean);
  const cc = A.contrast(agHoles, 'chip_on');
  out['short.chip'] = { n: ag.length, you: ag.length ? 100 * mean(ag.map((s) => s.on_green_end)) : null,
    cost: cc.n_yes >= 10 && cc.n_no >= 10 && isNum(cc.delta) ? Math.max(0.1, Math.min(0.8, cc.delta)) : null, per_round: ag.length / Math.max(1, nR) };
  // approach
  const gi = hs.filter((x) => isNum(x.gir_eff)), cGir = A.contrast(hs, 'gir_eff');
  out['approach.gir'] = { n: gi.length, you: gi.length ? 100 * mean(gi.map((x) => x.gir_eff)) : null,
    cost: isNum(cGir.delta) && cGir.n_yes >= 15 && cGir.n_no >= 15 ? Math.max(0.4, Math.min(1, cGir.delta)) : 0.65 };
  const ap = shots.filter((s) => s.category === 'approach' && !s.excluded && isNum(s.start_to_pin) && isNum(s.end_to_pin));
  for (const [k, [lo, hi]] of Object.entries(BAND_YD)) {
    const g = ap.filter((s) => s.start_to_pin > lo * M_PER_YD && s.start_to_pin <= hi * M_PER_YD);
    out[`approach.${k}`] = { n: g.length, you: g.length ? median(g.map((s) => s.end_to_pin)) / M_PER_FT : null, per_round: g.length / Math.max(1, nR) };
  }
  // driving
  const tee = shots.filter((s) => s.category === 'tee' && !s.excluded);
  const dr = tee.filter((s) => s.club_category === 'driver' && !s.ends_in_penalty && isNum(s.dist_m));
  const apYd = ap.map((s) => s.start_to_pin / M_PER_YD).filter((x) => x >= DRIVING.approach_lo && x <= DRIVING.approach_hi);          // how far out your approaches start: what a longer drive shortens
  out['driving.distance'] = { n: dr.length, you: dr.length ? median(dr.map((s) => s.dist_m)) / M_PER_YD : null, per_round: dr.length / Math.max(1, nR),
    approach_yd: apYd.length >= DRIVING.min_approach_n ? median(apYd) : null };
  const fw = hs.filter((x) => x.par >= 4 && isNum(x.fw_hit)), cFw = A.contrast(hs, 'fw_hit', (x) => x.par >= 4);
  out['driving.accuracy'] = { n: fw.length, you: fw.length ? 100 * mean(fw.map((x) => x.fw_hit)) : null,
    cost: isNum(cFw.delta) && cFw.n_yes >= 15 && cFw.n_no >= 15 ? Math.max(0.1, Math.min(0.6, cFw.delta)) : 0.3, per_round: fw.length / Math.max(1, nR) };
  const penR = rounds.map((r) => tee.filter((s) => s.round_id === r.round_id)).filter((g) => g.length >= 6).map((g) => g.filter((s) => s.ends_in_penalty).length * 14 / g.length);
  out['driving.penalties'] = { n: tee.length, you: penR.length ? mean(penR) : null };   // per 14 tee shots, so rounds with missing tee data compare fairly
  return out;
}
const MIN = (key) => (/^approach\.(wedge|mid|long)$/.test(key) ? RATING.min_prox_n : RATING.min_pct_n);

// Modelled strokes a round from driving `tgt` instead of `m.you` yd: every drive that goes further leaves an approach that much shorter, valued as the
// putts saved (approach proximity at that distance, from the bench.js table, turned into expected putts). Not a published figure: the UI says so.
export function distanceStrokes(m, tgt, hcp) {
  if (!isNum(m.you) || !isNum(tgt)) return 0;
  const h = isNum(hcp) ? hcp : 10, gain = Math.max(0, tgt - m.you), from = m.approach_yd ?? DRIVING.approach_yd, putts = (yd) => expPutts(Math.max(3, B.proximityFt(yd, h)), h);
  return (m.per_round || 0) * Math.max(0, putts(from) - putts(Math.max(DRIVING.approach_lo, from - gain)));
}
// strokes per round gained by moving from `you` to `tgt` (plan 4.2). Re-uses the levelUp() logic for GIR, up-and-down, three-putts, fairways.
function strokesFor(key, m, tgt, hcp) {
  if (!isNum(m.you) || !isNum(tgt)) return 0;
  switch (key) {
    case 'putting.short': case 'putting.mid': return Math.max(0, tgt - m.you) / 100 * m.per_round;
    case 'putting.lag': return Math.max(0, m.you - tgt) / 100 * 18;
    case 'short.updown': return Math.max(0, tgt - m.you) / 100 * (m.misses ?? 0);
    case 'short.chip': return isNum(m.cost) ? Math.max(0, tgt - m.you) / 100 * m.per_round * m.cost : 0;
    case 'approach.gir': return Math.max(0, tgt - m.you) / 100 * 18 * m.cost;
    case 'approach.wedge': case 'approach.mid': case 'approach.long': { const h = isNum(hcp) ? hcp : 10;
      return m.per_round * Math.max(0, expPutts(Math.max(3, m.you), h) - expPutts(Math.max(3, tgt), h)); }
    case 'driving.accuracy': return Math.max(0, tgt - m.you) / 100 * m.per_round * m.cost;
    case 'driving.penalties': return Math.max(0, m.you - tgt);
    case 'driving.distance': return distanceStrokes(m, tgt, hcp);
    default: return 0;
  }
}

// ------------------------------------------------------------------ practice rating
function practiceRating(gameIds, results, games, unitM) {
  const ids = new Set(gameIds), rs = (results || []).filter((r) => ids.has(r.game ?? r.game_id) && isNum(r.score) && B.hasLevel(r.game ?? r.game_id))
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-RATING.practice_scores);
  const hs = rs.map((r) => { const id = r.game ?? r.game_id, g = (games || []).find((x) => x.id === id), l = B.level(id, r.score, g?.better || 'higher', unitM); return l ? l.h : null; }).filter(isNum);
  return hs.length ? mean(hs) : null;
}

// ------------------------------------------------------------------ the ratings
// { rounds, holes, shots } are the full dataset; results are the practice journal results; pinned = J().focus.pinned.
// `findings` is accepted for API compatibility with the Focus tab; every figure here is computed from the holes and shots.
export function skillRatings({ rounds = [], holes = [], shots = [], results = [], games = [], unitM = M_PER_YD, findings = [], pinned = [] } = {}) {
  const r18 = rounds.filter((r) => r.format === '18').sort((a, b) => String(a.start_time_local || a.date).localeCompare(String(b.start_time_local || b.date))).slice(-RATING.window);
  const ids = new Set(r18.map((r) => r.round_id)), enough = r18.length >= RATING.min_rounds;
  const ctx = { rounds: r18, holes: holes.filter((h) => ids.has(h.round_id)), shots: shots.filter((s) => ids.has(s.round_id)) };
  const M = enough ? measures(ctx) : {};
  if (M['short.updown'] && M['approach.gir']) M['short.updown'].misses = 18 * (1 - (M['approach.gir'].you ?? 0) / 100);
  const yd = Math.abs(unitM - M_PER_YD) < 0.01, unit = { dist: yd ? 'yd' : 'm', ft: yd ? 'ft' : 'm' };
  const dispFt = (v) => (isNum(v) ? (yd ? v : v * M_PER_FT) : v), dispYd = (v) => (isNum(v) ? (yd ? v : v * M_PER_YD) : v);
  const best = (id, better) => { const v = (results || []).filter((x) => (x.game ?? x.game_id) === id && isNum(x.score)).map((x) => x.score); return v.length ? (better === 'lower' ? Math.min(...v) : Math.max(...v)) : null; };
  const skills = SKILLS.map((sk) => {
    const subs = sk.subs.map((sd) => {
      const key = `${sk.key}.${sd.key}`, m = M[key] || { n: 0, you: null }, assumed = ASSUMED_SUBS.includes(sd.key), higher = HIGHER[key];
      const enoughData = isNum(m.you) && m.n >= MIN(key);
      const course = enoughData ? rateValue(key, m.you) : null, practice = practiceRating(sd.games, results, games, unitM);
      const hcp = course !== null ? course : practice !== null ? clampH(practice + RATING.practice_offset) : null;
      return { ...sd, key, sub: sd.key, skill: sk.key, m, assumed, higher, enoughData, course, hcp, practice_hcp: practice, source: course !== null ? 'course' : practice !== null ? 'practice' : null };
    });
    const rated = subs.filter((s) => s.hcp !== null), wsum = rated.reduce((t, s) => t + s.weight, 0);
    const hcp = wsum ? rated.reduce((t, s) => t + s.hcp * s.weight, 0) / wsum : null;
    const pr = subs.filter((s) => s.practice_hcp !== null), pw = pr.reduce((t, s) => t + s.weight, 0);
    const practice_hcp = pw ? pr.reduce((t, s) => t + s.practice_hcp * s.weight, 0) / pw : null;
    const target = hcp === null ? null : Math.max(0, Math.round(hcp - RATING.step));
    const out = subs.map((s) => {
      const m = s.m; let tv = null;
      if (target !== null && BENCH[s.key]) tv = BENCH[s.key](target);
      // a golfer already past the target has nothing to gain here
      const strokes = s.enoughData && tv !== null ? strokesFor(s.key, m, tv, hcp) : 0;
      const gm = s.games.map((id) => { const g = (games || []).find((x) => x.id === id); if (!g) return null; const e = target !== null ? B.expectedFor(id, target, unitM) : null;
        return { id, name: g.name, target: isNum(e) ? Math.round(e * 10) / 10 : null, best: best(id, g.better), better: g.better || 'higher' }; }).filter(Boolean);
      const prox = /approach\.(wedge|mid|long)/.test(s.key), dist = s.key === 'driving.distance';
      const cv = (v) => (prox ? dispFt(v) : dist ? dispYd(v) : v);
      const u = prox ? unit.ft : dist ? unit.dist : s.key === 'driving.penalties' ? '/rd' : '%';
      return { key: s.sub, full_key: s.key, title: s.title, you: s.enoughData ? cv(m.you) : null, std: cv(tv), assumed: s.assumed, unit: u, higher: s.higher, hcp: s.hcp, practice_hcp: s.practice_hcp,
        source: s.source, target_value: cv(tv), strokes, n: m.n || 0, weight: s.weight, games: gm,
        how: HOW[s.key], enough: s.enoughData };
    });
    return { key: sk.key, title: sk.title, hcp, practice_hcp, target, strokes: out.reduce((t, s) => t + s.strokes, 0), focus: false, rated: hcp !== null, subs: out };
  });
  // focus: pinned skills first, then the largest strokes values to the next level
  const rank = [...skills].filter((s) => s.rated).sort((a, b) => b.strokes - a.strokes).map((s) => s.key);
  const pin = (pinned || []).filter((k) => skills.some((s) => s.key === k && s.rated)).slice(0, 2);
  const focus = [...pin, ...rank.filter((k) => !pin.includes(k))].slice(0, 2);
  for (const s of skills) s.focus = focus.includes(s.key);
  const rs = skills.filter((s) => s.rated);
  return { index: rs.length ? mean(rs.map((s) => s.hcp)) : null, skills, focus, rounds: r18.length, enough };
}
const HOW = {
  'putting.short': 'Holing the short ones: a stroke every time you convert one you would have missed.',
  'putting.mid': 'Start line and pace from 6–12 ft.',
  'putting.lag': 'Lag from 20–40 ft to inside 3 ft, so a two-putt is certain. Rated on your three-putt rate.',
  'short.updown': 'Chip or pitch to inside 6 ft, then hole it: every save turns a bogey into a par.',
  'short.chip': 'Chips from around the green that finish on it. Assumed standard: no published figure, so it is worked out from up-and-down % and make %.',
  'approach.gir': 'Distance control and proximity: more greens means more two-putt pars and fewer up-and-downs.',
  'approach.wedge': 'Median finish from 50–100 yd. Strokes are putts saved, and overlap a little with greens hit.',
  'approach.mid': 'Median finish from 100–150 yd. Strokes are putts saved, and overlap a little with greens hit.',
  'approach.long': 'Median finish from 150–200 yd. Strokes are putts saved, and overlap a little with greens hit.',
  'driving.distance': 'Median driver distance, trained by the Driver test and Max out. The shots a round are a model, not a published figure: a longer drive leaves a shorter approach, and the putts saved are worked out from the approach tables.',
  'driving.penalties': 'Tee shots that end in a penalty, per 14 tee shots. Assumed standard: no published figure by handicap.',
  'driving.accuracy': 'Fairways hit. This barely changes with handicap in the published data, so treat it as a small lever.',
};
export const SOURCES = [...B.SOURCES, CO.STANDARD_SOURCE];
