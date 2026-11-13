// GolfIQ feature analytics (pure functions, no DOM): club recommendation, personal bests,
// before/after comparisons, course playbook, weather effects, course-map geometry, practice stats.
import * as A from './analytics.js';

const { isNum, mean, median, std, quantile, groupBy, sum } = A;

// ------------------------------------------------------------------ 1. club recommendation
// For a target distance: each club's share of stock shots finishing within ±tol of it.
// ------------------------------------------------------------------ club distances: GPS by default, or your own number
// Each club plays to its GPS median unless you've chosen "mine" (Settings → Clubs or Play → Caddie → Your distances),
// or the club has too few tracked shots and you've entered a number. With "mine", your GPS spread is kept and moved
// to your number; with no GPS shots the spread is assumed (6% of distance).
const stockCache = new WeakMap();
function stockOf(ds) {
  if (!stockCache.has(ds)) stockCache.set(ds, groupBy(A.stockShots(ds.shots, ds.clubs).filter((s) => !s.partial && !s.partial_by_intent && isNum(s.dist_m)), (s) => s.club_id));
  return stockCache.get(ds);
}
export function clubDistance(ds, cid) {
  const c = ds.clubs.find((x) => x.club_id === cid), g = stockOf(ds).get(cid) || [], d = g.map((s) => s.dist_m), n = d.length;
  const gps = n ? median(d) : null, mine = isNum(c?.target_total_m) ? c.target_total_m : null, enough = n >= A.T.min_shots_club_stats;
  const use = mine !== null && (c?.dist_source === 'mine' || !enough) ? 'mine' : 'gps';
  return { club_id: cid, n, gps_m: gps, mine_m: mine, use, enough, median_m: use === 'mine' ? mine : gps, shift_m: use === 'mine' && gps !== null ? mine - gps : 0 };
}
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
// share of a normal(mu, sd) inside target ± tol, and the parts short / long of it
export function normalWithin(mu, sd, t, tol) { const a = normCdf((t - tol - mu) / sd), b = normCdf((t + tol - mu) / sd); return { prob: b - a, short: a, long: 1 - b }; }
export const wedgeSd = (carry) => Math.max(2.5, 0.05 * carry);       // range carries: about 5% (at least 2.5 m) either way

export function recommendClubs(ds, targetM, tolM, wedgeRows = []) {
  const out = [], stock = stockOf(ds);
  for (const c of ds.clubs) {
    if (!c || c.category === 'putter' || c.active === 0) continue;
    const cd = clubDistance(ds, c.club_id), g = stock.get(c.club_id) || [];
    if (cd.enough) {
      const d = g.map((s) => s.dist_m + cd.shift_m), n = d.length, within = d.filter((x) => Math.abs(x - targetM) <= tolM).length;
      const lat = g.map((s) => s.lateral_m).filter(isNum);
      out.push({ kind: 'gps', source: cd.use, club: c.name, club_id: c.club_id, n, median_m: median(d), gps_m: cd.gps_m, p25_m: quantile(d, 0.25), p75_m: quantile(d, 0.75),
        prob: within / n, short_pct: d.filter((x) => x < targetM - tolM).length / n, long_pct: d.filter((x) => x > targetM + tolM).length / n,
        diff_m: median(d) - targetM, lateral_sd_m: lat.length >= 8 ? std(lat) : null, sample: cd.use === 'mine' ? 'your number, GPS spread' : A.sampleLabel(n) });
    } else if (cd.use === 'mine') {                                     // your number only: assumed spread
      const sd = 0.06 * cd.mine_m, w = normalWithin(cd.mine_m, sd, targetM, tolM);
      out.push({ kind: 'gps', source: 'mine', club: c.name, club_id: c.club_id, n: cd.n, median_m: cd.mine_m, gps_m: cd.gps_m, p25_m: cd.mine_m - 0.674 * sd, p75_m: cd.mine_m + 0.674 * sd,
        prob: w.prob, short_pct: w.short, long_pct: w.long, diff_m: cd.mine_m - targetM, lateral_sd_m: null, sample: 'your number (spread assumed)' });
    }
  }
  // part-swing wedges from the range matrix (carries you entered); odds assume about ±5% around that carry
  for (const w of wedgeRows) {
    if (!isNum(w.carry_m)) continue;
    const sd = wedgeSd(w.carry_m); if (Math.abs(w.carry_m - targetM) > tolM + 2.5 * sd) continue;
    const r = normalWithin(w.carry_m, sd, targetM, tolM);
    out.push({ kind: 'wedge', club: `${w.club} · ${w.length}`, club_id: w.key || `w:${w.club_id}|${w.length}`, base_club_id: w.club_id, length: w.length, n: w.n, median_m: w.carry_m,
      p25_m: w.carry_m - 0.674 * sd, p75_m: w.carry_m + 0.674 * sd, prob: r.prob, short_pct: r.short, long_pct: r.long, diff_m: w.carry_m - targetM, sample: 'range carry' });
  }
  return out.sort((a, b) => (b.prob ?? -1) - (a.prob ?? -1) || Math.abs(a.diff_m) - Math.abs(b.diff_m));
}
// Wedge-matrix cells as caddie options
export function wedgeRowsOf(entries, clubName) {
  return [...wedgeMatrix(entries || []).values()].map((w) => ({ key: `w:${w.club_id}|${w.length}`, club_id: w.club_id, club: clubName(w.club_id), length: w.length, carry_m: w.carry_m, n: w.sessions }));
}

// ------------------------------------------------------------------ 9. personal bests & milestones
export function personalBests(ds) {
  const r18 = ds.rounds.filter((r) => r.format === '18');
  const best = (rows, key, lower) => {
    const v = rows.filter((r) => isNum(r[key])); if (!v.length) return null;
    const b = v.reduce((x, y) => ((lower ? y[key] < x[key] : y[key] > x[key]) ? y : x));
    return { value: b[key], date: b.date, course: b.course_name, round_id: b.round_id };
  };
  const tee = ds.shots.filter((s) => s.category === 'tee' && !s.excluded && !s.ends_in_penalty && isNum(s.dist_m));
  const ld = tee.length ? tee.reduce((x, y) => (y.dist_m > x.dist_m ? y : x)) : null;
  // streaks over holes in date order
  const holes = [...ds.holes].sort((a, b) => (a.start_time_local || '').localeCompare(b.start_time_local || '') || a.hole - b.hole);
  const streak = (ok, counts = () => true) => { let cur = 0, mx = 0; for (const h of holes) { if (!counts(h)) continue; if (ok(h)) { cur++; mx = Math.max(mx, cur); } else cur = 0; } return mx; };
  const rs = [...r18].sort((a, b) => (a.start_time_local || '').localeCompare(b.start_time_local || ''));
  let cur = 0, noPen = 0; for (const r of rs) { if (r.penalties === 0) { cur++; noPen = Math.max(noPen, cur); } else if (isNum(r.penalties)) cur = 0; }
  const nines = [];
  for (const [rid, hs] of groupBy(ds.holes, (h) => h.round_id)) for (const [name, f] of [['front', (h) => h.hole <= 9], ['back', (h) => h.hole > 9]]) {
    const g = hs.filter(f); if (g.length === 9 && g.every((h) => isNum(h.to_par))) nines.push({ to_par: sum(g.map((h) => h.to_par)), nine: name, date: g[0].date, round_id: rid });
  }
  const b9 = nines.length ? nines.reduce((x, y) => (y.to_par < x.to_par ? y : x)) : null;
  return {
    records: [
      ['Lowest round', best(r18, 'gross', true), 0, ''], ['Best score to par', best(r18, 'to_par', true), 0, ''],
      ['Best Stableford', best(r18, 'stableford_round', false), 0, ' pts'], ['Best differential', best(r18, 'differential', true), 1, ''],
      ['Most greens in regulation', best(r18, 'gir_n', false), 0, ''], ['Most fairways hit', best(r18, 'fw_n', false), 0, ''],
      ['Fewest putts', best(r18, 'putts_round', true), 0, ''], ['Most birdies in a round', best(r18, 'birdies_or_better', false), 0, ''],
      ['Most pars or better', best(r18.map((r) => ({ ...r, pob: r.pars + r.birdies_or_better })), 'pob', false), 0, ''],
    ].filter((x) => x[1]).map(([label, b, d, unit]) => ({ label, ...b, d, unit })),
    longest_drive: ld ? { dist_m: ld.dist_m, club: ld.club, date: ld.date, hole: ld.hole } : null,
    best_nine: b9,
    streaks: { no_three_putt_holes: streak((h) => h.putts_eff < 3, (h) => isNum(h.putts_eff)), bogey_or_better_holes: streak((h) => h.to_par <= 1, (h) => isNum(h.to_par)),
      par_or_better_holes: streak((h) => h.to_par <= 0, (h) => isNum(h.to_par)), rounds_without_penalty: noPen },
    totals: { rounds: ds.rounds.length, holes: ds.holes.length, shots: ds.shots.length, birdies: ds.holes.filter((h) => isNum(h.to_par) && h.to_par <= -1).length,
      pars: ds.holes.filter((h) => h.to_par === 0).length, courses: new Set(ds.rounds.map((r) => r.course_id)).size },
    milestones: [[100, 'Broke 100'], [95, 'Broke 95'], [90, 'Broke 90'], [85, 'Broke 85'], [80, 'Broke 80'], [75, 'Broke 75']].map(([n, label]) => {
      const f = rs.find((r) => r.gross < n); return { label, date: f?.date || null, times: rs.filter((r) => r.gross < n).length };
    }).filter((m) => m.date),
  };
}

// ------------------------------------------------------------------ 5. before / after a date
export function comparePeriods(ds, date, windowRounds = null) {
  const r = ds.rounds.filter((x) => x.format === '18' && x.date).sort((a, b) => (a.start_time_local || '').localeCompare(b.start_time_local || ''));
  let before = r.filter((x) => x.date < date), after = r.filter((x) => x.date >= date);
  if (windowRounds) { before = before.slice(-windowRounds); after = after.slice(0, windowRounds); }
  const metrics = Object.entries(A.METRICS).map(([m, [label, hib, unit]]) => {
    const a = before.map((x) => x[m]).filter(isNum), b = after.map((x) => x[m]).filter(isNum);
    const d = a.length && b.length ? mean(b) - mean(a) : null, p = A.welchP(b, a);
    return { metric: m, label, unit, before: mean(a), after: mean(b), delta: d, p, n_before: a.length, n_after: b.length,
      verdict: d === null ? 'no data' : (a.length < 3 || b.length < 3) ? 'too few rounds' : p === null || p >= 0.10 ? 'no clear change' : (d > 0) === hib ? 'better' : 'worse' };
  });
  const ids = (rows) => new Set(rows.map((x) => x.round_id));
  const tb = A.clubTable(ds.shots.filter((s) => ids(before).has(s.round_id)), ds.clubs), ta = A.clubTable(ds.shots.filter((s) => ids(after).has(s.round_id)), ds.clubs);
  const clubs = ta.filter((c) => c.category !== 'putter').map((c) => {
    const b = tb.find((x) => x.club_id === c.club_id);
    return { club: c.club, before_m: b?.median_m ?? null, after_m: c.median_m, n_before: b?.shots_stock ?? 0, n_after: c.shots_stock,
      delta_m: isNum(b?.median_m) && isNum(c.median_m) ? c.median_m - b.median_m : null, cv_before: b?.cv_pct ?? null, cv_after: c.cv_pct ?? null };
  }).filter((c) => c.n_after >= 5 || c.n_before >= 5);
  return { n_before: before.length, n_after: after.length, metrics, clubs };
}

// ------------------------------------------------------------------ 6. course playbook
export function playbook(ds, courseId) {
  const holes = ds.holes.filter((h) => h.course_id === courseId), shots = ds.shots.filter((s) => s.course_id === courseId);
  const teeBy = new Map();     // first tracked shot of each hole played
  for (const sh of [...shots].sort((x, y) => x.shot_order - y.shot_order)) { const k = A.holeKey(sh.round_id, sh.hole); if (!teeBy.has(k) && sh.category !== 'penalty') teeBy.set(k, sh); }
  for (const [k, sh] of teeBy) if (!(sh.category === 'tee' || sh.par3_tee)) teeBy.delete(k);
  const out = [];
  for (const [hole, g] of [...groupBy(holes, (h) => h.hole)].sort((a, b) => a[0] - b[0])) {
    const par = g[0].par, n = g.length, fw = g.filter((h) => h.fw_hit !== null);
    const byClub = new Map();
    for (const h of g) { const t = teeBy.get(A.holeKey(h.round_id, h.hole)); if (!t || !t.club_id || !isNum(h.to_par)) continue; if (!byClub.has(t.club)) byClub.set(t.club, []); byClub.get(t.club).push({ h, t }); }
    const clubs = [...byClub].map(([club, v]) => ({ club, n: v.length, avg_to_par: mean(v.map((x) => x.h.to_par)), fw_pct: par >= 4 ? pct(v.map((x) => x.h.fw_hit)) : null,
      gir_pct: pct(v.map((x) => x.h.gir_eff)), pen_pct: 100 * v.filter((x) => x.t.ends_in_penalty).length / v.length, median_m: median(v.map((x) => x.t.dist_m)) })).sort((a, b) => b.n - a.n);
    const ok = clubs.filter((c) => c.n >= 3), bestClub = ok.length >= 2 ? [...ok].sort((a, b) => a.avg_to_par - b.avg_to_par)[0] : null;
    const usual = clubs[0] || null, left = fw.filter((h) => h.fairway === 'LEFT').length, right = fw.filter((h) => h.fairway === 'RIGHT').length;
    const appr = shots.filter((s) => s.hole === hole && s.category === 'approach' && isNum(s.long_short_m) && isNum(s.start_to_pin) && s.start_to_pin <= 200);
    const row = { hole, par, si: g[0].stroke_index, n, avg_to_par: mean(g.map((h) => h.to_par)), stableford: mean(g.map((h) => h.stableford)), gir_pct: pct(g.map((h) => h.gir_eff)),
      fw_pct: fw.length ? pct(fw.map((h) => h.fw_hit)) : null, miss_left: left, miss_right: right, putts: mean(g.map((h) => h.putts_eff)),
      blowup_pct: pct(g.map((h) => h.blowup)), pen_per: mean(g.map((h) => h.penalties_eff)), clubs, best_club: bestClub, usual_club: usual,
      approach_long_short_m: appr.length >= 4 ? mean(appr.map((s) => s.long_short_m)) : null, approach_lateral_m: appr.length >= 4 ? mean(appr.map((s) => s.lateral_m)) : null, tips: [] };
    // suggestions only where the data supports them
    if (bestClub && usual && bestClub.club !== usual.club && usual.n >= 3 && usual.avg_to_par - bestClub.avg_to_par >= 0.3) row.tips.push(`You score ${(usual.avg_to_par - bestClub.avg_to_par).toFixed(1)} better with ${bestClub.club} off the tee (n=${bestClub.n}) than ${usual.club} (n=${usual.n}).`);
    if (fw.length >= 5 && (left >= 2 * Math.max(right, 1) || right >= 2 * Math.max(left, 1)) && left + right >= 3) row.tips.push(`Tee shots miss ${left > right ? 'left' : 'right'} here ${Math.max(left, right)} of ${left + right} misses – aim away from that side.`);
    if (isNum(row.pen_per) && row.pen_per >= 0.34 && n >= 3) row.tips.push(`Penalty hole: ${row.pen_per.toFixed(2)} penalty strokes per play. Take the conservative line.`);
    if (isNum(row.approach_long_short_m) && Math.abs(row.approach_long_short_m) >= 8) row.tips.push(`Approaches finish ${row.approach_long_short_m < 0 ? 'short' : 'long'} on average – take ${row.approach_long_short_m < 0 ? 'more' : 'less'} club.`);
    if (isNum(row.putts) && row.putts >= 2.3 && n >= 4) row.tips.push(`Green costs you putts here (${row.putts.toFixed(2)} per play) – prioritise leaving it below the hole.`);
    if (row.blowup_pct >= 25 && n >= 4) row.tips.push(`Blow-up hole (triple+ in ${row.blowup_pct.toFixed(0)}% of plays) – play it as a bogey hole.`);
    out.push(row);
  }
  const ranked = [...out].filter((h) => h.n >= 2).sort((a, b) => b.avg_to_par - a.avg_to_par);
  return { holes: out, hardest: ranked.slice(0, 3).map((h) => h.hole), easiest: ranked.slice(-3).reverse().map((h) => h.hole), rounds: new Set(holes.map((h) => h.round_id)).size };
}
const pct = (a) => { const m = mean(a); return m === null ? null : 100 * m; };

// ------------------------------------------------------------------ 4. weather effects
export function roundLocation(ds, roundId) {
  const h = ds.holes.filter((x) => x.round_id === roundId && isNum(x.pin_lat));
  if (h.length) return { lat: mean(h.map((x) => x.pin_lat)), lon: mean(h.map((x) => x.pin_lon)) };
  const s = ds.shots.filter((x) => x.round_id === roundId && isNum(x.start_lat));
  return s.length ? { lat: mean(s.map((x) => x.start_lat)), lon: mean(s.map((x) => x.start_lon)) } : null;
}
// Reduce an Open-Meteo hourly response to the hours of the round (local time).
export function summariseWeather(json, startLocal, holes) {
  const t = json?.hourly?.time; if (!Array.isArray(t)) return null;
  const startH = Number(startLocal.slice(11, 13)), day = startLocal.slice(0, 10), dur = holes > 9 ? 5 : 3;
  const idx = t.map((x, i) => [x, i]).filter(([x]) => x.slice(0, 10) === day && Number(x.slice(11, 13)) >= startH && Number(x.slice(11, 13)) < startH + dur).map(([, i]) => i);
  if (!idx.length) return null;
  const col = (k) => idx.map((i) => json.hourly[k]?.[i]).filter(isNum);
  const dirs = col('wind_direction_10m'), sx = mean(dirs.map((d) => Math.sin(d * Math.PI / 180))), cx = mean(dirs.map((d) => Math.cos(d * Math.PI / 180)));
  return { temp_c: mean(col('temperature_2m')), wind_kmh: mean(col('wind_speed_10m')), gust_kmh: col('wind_gusts_10m').length ? Math.max(...col('wind_gusts_10m')) : null,
    wind_dir: dirs.length ? (Math.atan2(sx, cx) * 180 / Math.PI + 360) % 360 : null, rain_mm: sum(col('precipitation')), hours: idx.length };
}
function ols(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = mean(x), my = mean(y), sxx = sum(x.map((v) => (v - mx) ** 2)); if (!sxx) return null;
  const slope = sum(x.map((v, i) => (v - mx) * (y[i] - my))) / sxx, r = slope * Math.sqrt(sxx) / Math.sqrt(sum(y.map((v) => (v - my) ** 2)) || 1);
  return { slope, intercept: my - slope * mx, r, n };
}
export function weatherEffects(ds, weather) {
  const wr = ds.rounds.map((r) => ({ r, w: weather[r.round_id] })).filter((x) => x.w && isNum(x.w.temp_c));
  const res = { rounds: wr.length, temp: null, wind: null, score_wind: [], score_temp: [], by_club_temp: [], points: [] };
  if (wr.length < 5) return res;
  const wmap = new Map(wr.map((x) => [x.r.round_id, x.w]));
  const stock = A.stockShots(ds.shots, ds.clubs).filter((s) => !s.partial && !s.partial_by_intent && wmap.has(s.round_id));
  const med = new Map([...groupBy(stock, (s) => s.club_id)].filter(([, g]) => g.length >= 8).map(([k, g]) => [k, median(g.map((s) => s.dist_m))]));
  const rel = stock.filter((s) => med.has(s.club_id)).map((s) => ({ rel: 100 * (s.dist_m / med.get(s.club_id) - 1), t: wmap.get(s.round_id).temp_c, w: wmap.get(s.round_id).wind_kmh, club: s.club, round_id: s.round_id }));
  // per-round mean relative distance (avoids one long round dominating)
  const perRound = [...groupBy(rel, (x) => x.round_id)].filter(([, g]) => g.length >= 8).map(([rid, g]) => ({ rid, rel: mean(g.map((x) => x.rel)), t: g[0].t, w: g[0].w, n: g.length }));
  res.points = perRound;
  const ft = ols(perRound.map((x) => x.t), perRound.map((x) => x.rel));
  if (ft && perRound.length >= 8) res.temp = { pct_per_10c: ft.slope * 10, r: ft.r, n: ft.n, range: [Math.min(...perRound.map((x) => x.t)), Math.max(...perRound.map((x) => x.t))] };
  const calm = perRound.filter((x) => isNum(x.w) && x.w < 15), windy = perRound.filter((x) => isNum(x.w) && x.w >= 20);
  if (calm.length >= 3 && windy.length >= 3) res.wind = { calm_rel: mean(calm.map((x) => x.rel)), windy_rel: mean(windy.map((x) => x.rel)), n_calm: calm.length, n_windy: windy.length,
    p: A.welchP(windy.map((x) => x.rel), calm.map((x) => x.rel)) };
  const bins = (key, edges, labels, metric) => labels.map((label, i) => {
    const g = wr.filter((x) => isNum(x.w[key]) && x.w[key] >= edges[i] && x.w[key] < edges[i + 1] && x.r.format === '18');
    return { label, rounds: g.length, differential: mean(g.map((x) => x.r.differential)), to_par: mean(g.map((x) => x.r.to_par)), putts: mean(g.map((x) => x.r.putts_round)), fw_pct: mean(g.map((x) => x.r.fw_pct)), gir_pct: mean(g.map((x) => x.r.gir_pct)) };
  }).filter((b) => b.rounds);
  res.score_wind = bins('wind_kmh', [0, 10, 20, 30, 999], ['Calm (<10 km/h)', 'Breezy (10–20)', 'Windy (20–30)', 'Very windy (30+)']);
  res.score_temp = bins('temp_c', [-50, 15, 22, 28, 99], ['Cool (<15°C)', 'Mild (15–22)', 'Warm (22–28)', 'Hot (28+)']);
  return res;
}

// ------------------------------------------------------------------ 7. course map geometry (OpenStreetMap)
export function courseBBox(ds, courseId, marginDeg = 0.002) {
  const s = ds.shots.filter((x) => x.course_id === courseId), pts = [];
  s.forEach((x) => { if (isNum(x.start_lat)) pts.push([x.start_lat, x.start_lon]); if (isNum(x.end_lat)) pts.push([x.end_lat, x.end_lon]); });
  ds.holes.filter((h) => h.course_id === courseId && isNum(h.pin_lat)).forEach((h) => pts.push([h.pin_lat, h.pin_lon]));
  if (pts.length < 4) return null;
  const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
  // trim GPS outliers so one bad point doesn't make the map area huge
  return [quantile(la, 0.01) - marginDeg, quantile(lo, 0.01) - marginDeg, quantile(la, 0.99) + marginDeg, quantile(lo, 0.99) + marginDeg];
}
// Course outlines from OpenStreetMap. Version 2 adds trees (woods, tree rows, single trees), rough and the hole centre lines.
export const OSM_VERSION = 2;
export const overpassQuery = (b) => { const bb = b.map((x) => x.toFixed(5)).join(',');
  return `[out:json][timeout:25];(way["golf"~"^(fairway|green|bunker|tee|water_hazard|lateral_water_hazard|rough|hole)$"](${bb});way["natural"~"^(water|wood|scrub|tree_row)$"](${bb});way["landuse"="forest"](${bb});relation["natural"="wood"](${bb});relation["landuse"="forest"](${bb});node["natural"="tree"](${bb}););out geom;`; };
const r6 = (v) => Math.round(v * 1e6) / 1e6;
function osmKind(t = {}) {
  const g = t.golf;
  if (g === 'fairway' || g === 'green' || g === 'bunker' || g === 'tee' || g === 'rough' || g === 'hole') return g;
  if (g === 'water_hazard' || g === 'lateral_water_hazard' || t.natural === 'water') return 'water';
  if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest') return 'trees';
  if (t.natural === 'tree_row') return 'treerow';
  if (t.natural === 'tree') return 'tree';
  return null;
}
export function parseOverpass(json) {
  const out = [];
  for (const e of json?.elements || []) {
    const kind = osmKind(e.tags);
    if (!kind) continue;
    if (e.type === 'node') { if (kind === 'tree' && isNum(e.lat) && isNum(e.lon)) out.push({ kind, pts: [[r6(e.lat), r6(e.lon)]] }); continue; }
    if (e.type === 'relation') {                     // multipolygon woods: keep each outer ring
      if (kind !== 'trees' && kind !== 'water') continue;
      for (const m of e.members || []) if (m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 3) out.push({ kind, pts: m.geometry.map((p) => [r6(p.lat), r6(p.lon)]) });
      continue;
    }
    if (e.type !== 'way' || !Array.isArray(e.geometry)) continue;
    const pts = e.geometry.map((p) => [r6(p.lat), r6(p.lon)]), line = kind === 'hole' || kind === 'treerow';
    if (pts.length < (line ? 2 : 3)) continue;
    const f = { kind, pts };
    if (kind === 'hole') { const n = parseInt(e.tags.ref, 10); f.ref = Number.isFinite(n) ? n : null; f.par = parseInt(e.tags.par, 10) || null; }
    out.push(f);
  }
  return out;
}
export function pointInPolygon(lat, lon, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// metres from a point to a polyline (local flat approximation – fine at golf-hole scale)
export function distToLine(lat, lon, pts) {
  const kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 110540;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const ax = (pts[i][1] - lon) * kx, ay = (pts[i][0] - lat) * ky;
    if (pts.length === 1) return Math.hypot(ax, ay);
    if (i === pts.length - 1) break;
    const bx = (pts[i + 1][1] - lon) * kx, by = (pts[i + 1][0] - lat) * ky, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
export const TREE_RADIUS_M = 4;
// What the ball would be lying on at a point, according to the mapped outlines.
export function surfaceAt(lat, lon, features) {
  if (!isNum(lat) || !isNum(lon)) return null;
  for (const kind of ['green', 'bunker', 'water']) for (const f of features) if (f.kind === kind && pointInPolygon(lat, lon, f.pts)) return kind;
  for (const f of features) {
    if (f.kind === 'trees' && pointInPolygon(lat, lon, f.pts)) return 'trees';
    if ((f.kind === 'tree' || f.kind === 'treerow') && Math.abs(f.pts[0][0] - lat) < 0.002 && distToLine(lat, lon, f.pts) <= TREE_RADIUS_M) return 'trees';
  }
  for (const kind of ['tee', 'fairway']) for (const f of features) if (f.kind === kind && pointInPolygon(lat, lon, f.pts)) return kind;
  return 'rough';
}
// Map-based stats: where shots really finished according to the mapped course outlines.
export function mapStats(ds, courseId, features) {
  if (!features?.length || !features.some((f) => f.kind === 'green')) return null;
  const shots = ds.shots.filter((s) => s.course_id === courseId && !s.excluded && isNum(s.end_lat));
  const tee = shots.filter((s) => s.category === 'tee').map((s) => surfaceAt(s.end_lat, s.end_lon, features));
  const appr = shots.filter((s) => s.category === 'approach' && isNum(s.start_to_pin) && s.start_to_pin <= 200).map((s) => ({ surf: surfaceAt(s.end_lat, s.end_lon, features), garmin: s.on_green_end }));
  const share = (arr, k) => (arr.length ? 100 * arr.filter((x) => x === k).length / arr.length : null);
  return { tee_n: tee.length, tee_fairway_pct: share(tee, 'fairway'), tee_bunker_pct: share(tee, 'bunker'), tee_water_pct: share(tee, 'water'),
    appr_n: appr.length, appr_green_pct: share(appr.map((a) => a.surf), 'green'), appr_bunker_pct: share(appr.map((a) => a.surf), 'bunker'),
    garmin_green_pct: appr.length ? 100 * appr.filter((a) => a.garmin === 1).length / appr.length : null, has_fairways: features.some((f) => f.kind === 'fairway') };
}

// ------------------------------------------------------------------ practice games & wedge matrix
export const DEFAULT_GAMES = [
  { id: 'putt-par18', cat: 'Putting', name: 'Par 18 putting', better: 'lower', unit: 'strokes', how: '9 holes on the practice green, mix of 3–40 ft. Par 2 each. Hole everything out.' },
  { id: 'putt-369', cat: 'Putting', name: '3-6-9 ft ladder', better: 'higher', max: 9, unit: 'holed / 9', how: 'Three balls each from 3, 6 and 9 ft. Count holed putts.' },
  { id: 'putt-lag', cat: 'Putting', name: 'Lag ladder', better: 'higher', max: 10, unit: 'inside 3 ft / 10', how: 'Ten putts from 20–50 ft to different holes. Count finishes inside 3 ft (a putter grip length).' },
  { id: 'putt-streak', cat: 'Putting', name: '4-footer streak', better: 'higher', unit: 'in a row', how: 'Circle of 4 ft putts. Record your longest streak holed in a row.' },
  { id: 'chip-updown', cat: 'Chipping', name: 'Up & down 9', better: 'higher', max: 9, unit: 'up-and-downs / 9', how: 'Nine different lies around the green, one ball each, putt out. Count up-and-downs.' },
  { id: 'chip-par18', cat: 'Chipping', name: 'Par 18 chipping', better: 'lower', unit: 'strokes', how: 'Nine chip-and-putt holes, par 2 each. Total strokes.' },
  { id: 'chip-zone', cat: 'Chipping', name: 'Landing zone', better: 'higher', max: 10, unit: 'hits / 10', how: 'Towel as landing spot. Ten chips with one club; count balls landing on the towel.' },
  { id: 'range-fairways', cat: 'Range', name: 'Imaginary fairways', better: 'higher', max: 14, unit: 'fairways / 14', how: 'Pick two targets ~30 yd apart as a fairway. 14 tee shots (your normal tee clubs), full routine. Count fairways hit.' },
  { id: 'range-greens', cat: 'Range', name: '9-shot greens', better: 'higher', max: 9, unit: 'greens / 9', how: 'Nine approaches, new target and club every ball. A hit = inside ~10% of the distance.' },
  { id: 'range-wedge', cat: 'Range', name: 'Wedge distance ladder', better: 'higher', max: 10, unit: 'inside 5 yd / 10', how: 'Ten wedge shots to called distances (e.g. 40–100). Count balls finishing within 5 yd.' },
  { id: 'range-round', cat: 'Range', name: 'Play the course (simple)', better: 'higher', max: 18, unit: 'good shots / 18', how: 'Play your home course on the range: tee shot then approach for 9 holes. Count shots that would have worked. (Practice → Range round does this properly.)' },
  { id: 'combine', cat: 'Range', name: 'Monthly combine', better: 'higher', max: 100, unit: 'points / 100', how: 'Practice → Combine: 18 shots to six targets, scored by how close they finish.', auto: true },
  { id: 'range-course', cat: 'Range', name: 'Range round', better: 'lower', unit: 'strokes', how: 'Practice → Range round: play a real course shot by shot on the range.', auto: true },
];
export function gameStats(games, results) {
  return games.map((g) => {
    const r = results.filter((x) => x.game === g.id && isNum(x.score)).sort((a, b) => a.date.localeCompare(b.date));
    const sc = r.map((x) => x.score), lower = g.better === 'lower';
    const last5 = sc.slice(-5), prev5 = sc.slice(-10, -5);
    return { ...g, n: r.length, last: r.length ? r[r.length - 1] : null, best: sc.length ? (lower ? Math.min(...sc) : Math.max(...sc)) : null,
      avg5: mean(last5), prev5: prev5.length ? mean(prev5) : null,
      trend: prev5.length >= 3 && last5.length >= 3 ? ((mean(last5) - mean(prev5)) * (lower ? -1 : 1) > 0 ? 'improving' : (mean(last5) === mean(prev5) ? 'flat' : 'worse')) : null, results: r };
  });
}
// Latest wedge matrix: for each club x swing length, the average of the most recent session's entries.
export function wedgeMatrix(entries) {
  const cells = new Map();
  for (const [k, g] of groupBy(entries.filter((e) => isNum(e.carry_m)), (e) => `${e.club_id}|${e.length}`)) {
    const sorted = [...g].sort((a, b) => a.date.localeCompare(b.date)), last = sorted[sorted.length - 1].date, latest = sorted.filter((e) => e.date === last);
    const prev = sorted.filter((e) => e.date < last);
    cells.set(k, { club_id: g[0].club_id, length: g[0].length, carry_m: mean(latest.map((e) => e.carry_m)), date: last, sessions: new Set(sorted.map((e) => e.date)).size,
      prev_m: prev.length ? prev[prev.length - 1].carry_m : null, history: sorted.map((e) => ({ date: e.date, carry_m: e.carry_m })) });
  }
  return cells;
}
export function wedgeLadder(cells, clubName) {
  const rows = [...cells.values()].map((c) => ({ ...c, club: clubName(c.club_id) })).sort((a, b) => b.carry_m - a.carry_m);
  rows.forEach((r, i) => { r.gap_m = i ? rows[i - 1].carry_m - r.carry_m : null; });
  return rows;
}

// ------------------------------------------------------------------ coach notes (written by Claude, pasted or synced)
export function parseCoachNotes(text) {
  const out = [];
  const tryAdd = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(tryAdd); return; }
    if (Array.isArray(o.notes)) { o.notes.forEach(tryAdd); return; }
    if (!o.title && !o.feedback && !o.feels && !o.drills) return;
    const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : x)).filter(Boolean);
    out.push({ date: /^\d{4}-\d{2}-\d{2}/.test(o.date || '') ? o.date.slice(0, 10) : new Date().toISOString().slice(0, 10), title: String(o.title || 'Coach note').slice(0, 120),
      feedback: String(o.feedback || o.summary || '').slice(0, 4000), feels: list(o.feels).map((x) => String(x).slice(0, 300)).slice(0, 12),
      drills: list(o.drills).map((d) => (typeof d === 'string' ? { name: d } : { name: String(d.name || 'Drill').slice(0, 120), how: String(d.how || d.description || '').slice(0, 800), reps: String(d.reps || d.dose || '').slice(0, 120) })).slice(0, 12),
      focus: String(o.focus || '').slice(0, 60), source: 'claude',
      assign: (Array.isArray(o.assign) ? o.assign : []).filter((x) => x && x.game).slice(0, 3).map((x) => ({ game: String(x.game).slice(0, 40), target: Number.isFinite(Number(x.target)) ? Number(x.target) : null, per_week: Math.max(1, Math.min(14, Math.round(Number(x.per_week) || 2))) })) });
  };
  // accept raw JSON, or JSON inside a ```code block``` / surrounding chat text
  const candidates = [text, ...[...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1])];
  const i = String(text).search(/[[{]/); if (i >= 0) { const j = Math.max(String(text).lastIndexOf('}'), String(text).lastIndexOf(']')); if (j > i) candidates.push(String(text).slice(i, j + 1)); }
  for (const c of candidates) { try { tryAdd(JSON.parse(c)); } catch { /* next */ } if (out.length) break; }
  return out;
}
export const COACH_FORMAT = `{"golfiq_coach_note":1,"date":"YYYY-MM-DD","title":"short title","focus":"e.g. driver / wedges / putting","feedback":"what you saw and why it matters","feels":["feel 1","feel 2"],"drills":[{"name":"drill name","how":"how to do it","reps":"e.g. 3 x 10 balls"}],"assign":[{"game":"practice game id","target":6,"per_week":3}]}`;

// ------------------------------------------------------------------ live play: course knowledge + shot pattern on the map
const RE = 6371008.8, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
export function destination(lat, lon, bearingDeg, distM) {
  const br = rad(bearingDeg), d = distM / RE, la1 = rad(lat), lo1 = rad(lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  return [deg(la2), deg(lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2)))];
}
// Point reached by going `along` metres on the bearing and `right` metres to the right of it.
export function offsetPoint(lat, lon, bearingDeg, along, right) {
  const [a, b] = destination(lat, lon, bearingDeg, along);
  return destination(a, b, bearingDeg + 90, right);
}
// What GolfIQ knows about each hole of a course from your earlier tracked rounds: green centre (pin marker) and tee.
export function courseHoles(ds, courseId) {
  const out = {};
  for (const [hole, g] of groupBy(ds.holes.filter((h) => h.course_id === courseId), (h) => h.hole)) {
    const pins = g.filter((h) => isNum(h.pin_lat));
    out[hole] = { hole, par: g[g.length - 1].par, si: g[g.length - 1].stroke_index, pin: pins.length ? [median(pins.map((h) => h.pin_lat)), median(pins.map((h) => h.pin_lon))] : null, tee: null, plays: g.length };
  }
  const first = new Map();
  for (const s of [...ds.shots.filter((x) => x.course_id === courseId && isNum(x.start_lat))].sort((a, b) => a.shot_order - b.shot_order)) { const k = `${s.round_id}|${s.hole}`; if (!first.has(k)) first.set(k, s); }
  for (const [hole, g] of groupBy([...first.values()].filter((s) => s.category === 'tee' || s.par3_tee), (s) => s.hole)) if (out[hole]) out[hole].tee = [median(g.map((s) => s.start_lat)), median(g.map((s) => s.start_lon))];
  return out;
}
// A club's shot pattern in "aim" coordinates: x = metres right of the target line, y = metres travelled along it.
export function clubPattern(ds, clubId) {
  const st = A.stockShots(ds.shots, ds.clubs).filter((s) => s.club_id === clubId && !s.partial && !s.partial_by_intent && isNum(s.lateral_m) && isNum(s.dist_m));
  const cd = clubDistance(ds, clubId), k = cd.shift_m;                  // your own number moves the whole pattern
  const pts = st.map((s) => ({ x: s.lateral_m, y: Math.sqrt(Math.max(s.dist_m ** 2 - s.lateral_m ** 2, 0)) + k }));
  const all = A.stockShots(ds.shots, ds.clubs).filter((s) => s.club_id === clubId && !s.partial && !s.partial_by_intent).map((s) => s.dist_m + k);
  const med = all.length ? median(all) : cd.mine_m;
  return { club_id: clubId, pts, stats: A.dispersionStats(pts), n_dist: all.length, median_m: med, p10_m: all.length >= 5 ? quantile(all, 0.1) : null, p90_m: all.length >= 5 ? quantile(all, 0.9) : null, source: cd.use };
}
// A part swing (wedge matrix) uses the full-swing pattern of that wedge, scaled to its carry.
export function wedgePattern(base, carry, latRatio) {
  if (base?.stats?.enough && isNum(base.stats.mean_y_m) && base.stats.mean_y_m > 0) {
    const k = carry / base.stats.mean_y_m, pts = base.pts.map((p) => ({ x: p.x * k, y: carry + (p.y - base.stats.mean_y_m) * k }));
    return { ...base, pts, stats: A.dispersionStats(pts), median_m: carry, partial_swing: true, base_id: base.club_id };
  }
  const e = estimatedPattern({ median_m: carry, p10_m: carry - 1.2816 * wedgeSd(carry), p90_m: carry + 1.2816 * wedgeSd(carry), stats: { n: 0 } }, latRatio);
  return e ? { ...e, partial_swing: true } : null;
}
// Front / back of a mapped green along the line of play.
export function greenFrontBack(lat, lon, pin, features) {
  if (!pin || !features?.length) return null;
  let g = features.find((f) => f.kind === 'green' && pointInPolygon(pin[0], pin[1], f.pts));
  if (!g) {
    const near = features.filter((f) => f.kind === 'green').map((f) => ({ f, d: A.haversine(pin[0], pin[1], mean(f.pts.map((p) => p[0])), mean(f.pts.map((p) => p[1]))) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 30) g = near.f;
  }
  if (!g) return null;
  const br = A.bearing(lat, lon, pin[0], pin[1]), al = g.pts.map((p) => A.alongCross(lat, lon, p[0], p[1], br)[0]);
  return { front_m: Math.min(...al), back_m: Math.max(...al) };
}
export function nearestGreens(lat, lon, features, n = 4) {
  return (features || []).filter((f) => f.kind === 'green').map((f) => { const c = [mean(f.pts.map((p) => p[0])), mean(f.pts.map((p) => p[1]))]; return { pin: c, dist_m: A.haversine(lat, lon, c[0], c[1]) }; })
    .sort((a, b) => a.dist_m - b.dist_m).slice(0, n);
}
// Garmin-shaped bundle for a round typed in by hand, so every page treats it like any other round.
export function manualBundle(d) {
  const holes = Object.entries(d.holes).map(([n, h]) => ({ n: Number(n), ...h })).filter((h) => h.strokes > 0).sort((a, b) => a.n - b.n);
  const pars = Array.from({ length: 18 }, (_, i) => d.holes[i + 1]?.par || 4), si = Array.from({ length: 18 }, (_, i) => d.holes[i + 1]?.si || null);
  const snap = { courseSnapshotId: 1, name: d.course_name, holePars: pars.join('') };
  if (d.courseGlobalId) snap.courseGlobalId = d.courseGlobalId;
  if (si.every((x) => x)) snap.holeHandicaps = si.join(',');
  const sc = { id: d.id, courseSnapshotId: 1, formattedStartTime: d.start, teeBox: d.tee || null, teeBoxRating: d.rating ?? null, teeBoxSlope: d.slope ?? null,
    holes: holes.map((h) => ({ number: h.n, strokes: h.strokes, putts: h.putts ?? null, penalties: h.penalties ?? 0, fairwayShotOutcome: pars[h.n - 1] >= 4 ? (h.fairway || null) : null })) };
  if (d.courseGlobalId) sc.courseGlobalId = d.courseGlobalId;
  return { golfiq_bundle_version: 1, kind: 'round', source: 'manual_entry', scorecard_id: String(d.id), summary: { id: d.id }, detail: { scorecardDetails: [{ scorecard: sc }], courseSnapshots: [snap] }, shots: { holeShots: [] } };
}

// ------------------------------------------------------------------ short game
// Scrambling, sand saves and chip/pitch results from your scorecards and tracked shots.
export function shortGame(holes, shots, rounds) {
  const key = (r, h) => `${r}|${h}`, hk = new Map(holes.map((h) => [key(h.round_id, h.hole), h]));
  const pctOf = (arr, f) => (arr.length ? 100 * arr.filter(f).length / arr.length : null);
  const missed = holes.filter((h) => h.gir_eff === 0 && isNum(h.to_par));
  const ag = shots.filter((s) => s.category === 'around_green' && !s.excluded);
  const agByHole = groupBy(ag, (s) => key(s.round_id, s.hole));
  const agHoles = [...agByHole.keys()].map((k) => ({ h: hk.get(k), n: agByHole.get(k).length })).filter((x) => x.h && isNum(x.h.putts_eff));
  const sandHoles = [...new Set(ag.filter((s) => s.start_lie === 'Sand').map((s) => key(s.round_id, s.hole)))].map((k) => hk.get(k)).filter((h) => h && isNum(h.to_par));
  const bands = [[0, 9.144], [9.144, 18.288], [18.288, 27.432]].map(([lo, hi]) => {
    const g = ag.filter((s) => isNum(s.start_to_pin) && s.start_to_pin > lo && s.start_to_pin <= hi);
    return { lo_m: lo, hi_m: hi, shots: g.length, on_green_pct: pctOf(g.filter((s) => s.on_green_end !== null), (s) => s.on_green_end === 1), median_left_m: median(g.map((s) => s.end_to_pin).filter(isNum)) };
  });
  const byRound = rounds.map((r) => { const m = missed.filter((h) => h.round_id === r.round_id); return { round_id: r.round_id, date: r.date, missed: m.length, scrambling: pctOf(m, (h) => h.to_par <= 0) }; });
  return {
    missed_greens: missed.length, missed_per_round: rounds.length ? missed.length / rounds.length : null,
    scrambling_pct: pctOf(missed, (h) => h.to_par <= 0), double_after_miss_pct: pctOf(missed, (h) => h.to_par >= 2),
    up_down_pct: pctOf(agHoles, (x) => x.n === 1 && x.h.putts_eff === 1), up_down_n: agHoles.length,
    chip_on_green_pct: pctOf(ag.filter((s) => s.on_green_end !== null), (s) => s.on_green_end === 1), chips: ag.length,
    sand_save_pct: pctOf(sandHoles, (h) => h.to_par <= 0), sand_n: sandHoles.length, bands, byRound,
  };
}

// ------------------------------------------------------------------ score killers (after Scott Fawcett's five scoring rules, plus penalties)
// Per round: bogey+ on par 5s, double bogey+, 3-putts, bogey+ from short-iron range, blown easy saves, double chips, penalty strokes.
export const KILLERS = [
  ['par5_bogey', 'Bogey+ on a par 5'], ['double', 'Double bogey or worse'], ['three_putt', '3-putts'], ['short_iron_bogey', 'Bogey+ from short-iron range'],
  ['blown_save', 'Blown easy saves'], ['double_chip', 'Double chips'], ['penalties', 'Penalty strokes'],
];
export function shortIronRange(ds) {
  const nine = ds.clubs.find((c) => /\b9\s*-?\s*iron\b|^9i$/i.test(c.name));
  const sh = nine ? ds.shots.filter((s) => s.club_id === nine.club_id && isNum(s.dist_m) && !s.excluded) : [];
  return sh.length >= 5 ? median(sh.map((s) => s.dist_m)) : 137.16;            // your 9-iron, else 150 yd
}
export function scoreKillers(holes, shots, shortM = 137.16) {
  const byHole = groupBy(shots, (s) => `${s.round_id}|${s.hole}`), out = new Map();
  for (const h of holes) {
    const r = out.get(h.round_id) || Object.fromEntries([['round_id', h.round_id], ['holes', 0], ...KILLERS.map(([k]) => [k, 0])]); out.set(h.round_id, r);
    r.holes++;
    if (!isNum(h.to_par)) continue;
    const g = [...(byHole.get(`${h.round_id}|${h.hole}`) || [])].sort((a, b) => a.shot_order - b.shot_order);
    if (h.par === 5 && h.to_par >= 1) r.par5_bogey++;
    if (h.to_par >= 2) r.double++;
    if (isNum(h.putts_eff) && h.putts_eff >= 3) r.three_putt++;
    r.penalties += h.penalties_eff || 0;
    const appr = g.filter((s) => s.category === 'approach' && isNum(s.start_to_pin));
    if (h.to_par >= 1 && appr.some((s) => s.start_to_pin <= shortM && s.start_lie !== 'Sand' && s.start_lie !== 'Recovery')) r.short_iron_bogey++;
    const ag = g.filter((s) => s.category === 'around_green');
    if (ag.length >= 2) r.double_chip++;
    const first = ag[0];
    if (first && h.gir_eff === 0 && isNum(first.start_to_pin) && first.start_to_pin <= 27.4 && first.start_lie !== 'Sand' && isNum(h.putts_eff) && ag.length + h.putts_eff > 2 && h.to_par >= 1) r.blown_save++;
  }
  for (const r of out.values()) r.total = KILLERS.reduce((t, [k]) => t + r[k], 0);
  return out;
}

// ------------------------------------------------------------------ estimated pattern for clubs without enough direction data
// Uses your own spread from the clubs that do have enough shots (sideways spread as a share of distance, median
// across clubs), else 7% of distance; distance spread from the club's own 10th-90th percentile, else 6%.
// Deterministic points (no randomness), so the picture doesn't jump about while you drag.
export function lateralRatio(ds, patternOf) {
  const r = ds.clubs.map((c) => patternOf(c.club_id)).filter((p) => p.stats?.enough && p.stats.mean_y_m > 30 && !p.estimated).map((p) => p.stats.sd_lateral_m / p.stats.mean_y_m);
  return r.length ? median(r) : 0.07;
}
export function estimatedPattern(base, latRatio, n = 120) {
  if (!base || !isNum(base.median_m)) return null;
  const sdY = isNum(base.p10_m) && isNum(base.p90_m) && base.p90_m > base.p10_m ? (base.p90_m - base.p10_m) / 2.563 : 0.06 * base.median_m;
  const sdX = latRatio * base.median_m, pts = [];
  for (let i = 0; i < n; i++) {                                         // Box-Muller on a fixed low-discrepancy sequence
    const u = (i + 0.5) / n, v = (i * 0.6180339887) % 1, r = Math.sqrt(-2 * Math.log(1 - u * 0.999)), t = 2 * Math.PI * v;
    pts.push({ x: sdX * r * Math.cos(t), y: base.median_m + sdY * r * Math.sin(t) });
  }
  return { ...base, pts, stats: A.dispersionStats(pts), estimated: true, real_n: base.stats?.n || 0 };
}
