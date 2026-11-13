// GolfIQ analytics engine (JavaScript port of the Python package golfiq/).
// Pure functions, no DOM. Verified against the Python implementation by tests/golden.test.mjs.
// Conventions: missing values are null; distances in metres; provenance in *_source fields.

export const T = {
  around_green_max_m: 27.4, assumed_green_radius_m: 12.0, recovery_progress_ratio: 0.5,
  partial_shot_ratio: 0.6, gps_max_shot_m: 400.0, gps_min_shot_m: 1.0,
  min_shots_club_stats: 8, min_shots_club_reliable: 20, min_shots_dispersion: 10,
  min_shots_dispersion_90: 20, min_drives_for_aim_line: 3, duplicate_window_minutes: 20,
  putts_default_suspect_holes: 9, stableford_allowance: 0.95, sg_min_coverage: 0.30,
};
const M_PER_YD = 0.9144, M_PER_FT = 0.3048;

// ------------------------------------------------------------------ small stats helpers
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const num = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const vals = (a) => a.filter(isNum);
export const sum = (a) => vals(a).reduce((x, y) => x + y, 0);
export const sumOrNull = (a) => { const v = vals(a); return v.length ? v.reduce((x, y) => x + y, 0) : null; };
export const mean = (a) => { const v = vals(a); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
export const std = (a) => {
  const v = vals(a); if (v.length < 2) return null;
  const m = v.reduce((x, y) => x + y, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
export function quantile(a, q) {           // pandas/numpy default (linear, type 7)
  const v = vals(a).sort((x, y) => x - y); if (!v.length) return null;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
export const median = (a) => quantile(a, 0.5);
export const count = (a) => vals(a).length;
export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
const roundHalfUp = (x) => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5));
const pyRound = (x) => {                    // Python round(): banker's rounding
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
};

// ------------------------------------------------------------------ geo
const R = 6371008.8, SEMI = 180 / 2 ** 31, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
export function toDegrees(v) { const n = num(v); if (n === null) return null; return Math.abs(n) > 180 ? n * SEMI : n; }
export const validPoint = (lat, lon) => isNum(lat) && isNum(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
export function haversine(la1, lo1, la2, lo2) {
  const a1 = rad(la1), a2 = rad(la2), dl = rad(la2 - la1), dn = rad(lo2 - lo1);
  const a = Math.sin(dl / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function bearing(la1, lo1, la2, lo2) {
  const a1 = rad(la1), a2 = rad(la2), dn = rad(lo2 - lo1);
  const x = Math.sin(dn) * Math.cos(a2), y = Math.cos(a1) * Math.sin(a2) - Math.sin(a1) * Math.cos(a2) * Math.cos(dn);
  return (deg(Math.atan2(x, y)) + 360) % 360;
}
export function alongCross(la0, lo0, la, lo, brgDeg) {
  const e = rad(lo - lo0) * R * Math.cos(rad(la0)), n = rad(la - la0) * R, th = rad(brgDeg);
  const ux = Math.sin(th), uy = Math.cos(th);
  return [e * ux + n * uy, e * uy - n * ux];
}
export function circularMedian(b) {
  const v = vals(b); if (!v.length) return null;
  const d = v.map((x) => v.reduce((s, y) => s + Math.abs(((x - y + 180) % 360 + 360) % 360 - 180), 0));
  const mn = Math.min(...d), cand = v.filter((x, i) => d[i] <= mn + 1e-6);   // even count: average the tied minimisers
  const sx = mean(cand.map((x) => Math.sin(rad(x)))), cx = mean(cand.map((x) => Math.cos(rad(x))));
  return (deg(Math.atan2(sx, cx)) + 360) % 360;
}

// ------------------------------------------------------------------ WHS
export const courseHandicap = (hi, slope, rating, par) => roundHalfUp(hi * slope / 113 + (rating - par));
export const playingHandicap = (ch, allowance = 0.95) => roundHalfUp(ch * allowance);
export function strokesReceived(ph, siRank, n = 18) {
  ph = pyRound(ph); siRank = Math.trunc(siRank);
  if (ph >= 0) { const base = Math.floor(ph / n), rem = ph % n; return base + (siRank <= rem ? 1 : 0); }
  const give = -ph, base = Math.floor(give / n), rem = give % n;
  return -(base + (siRank > n - rem ? 1 : 0));
}
export const stablefordPoints = (g, par, sr) => Math.max(0, Math.trunc(2 + par + sr - g));

// ------------------------------------------------------------------ parsing raw Garmin JSON
const first = (d, ...keys) => {
  if (!d || typeof d !== 'object') return null;
  for (const k of keys) if (d[k] !== undefined && d[k] !== null && d[k] !== '') return d[k];
  return null;
};
const int = (v) => { const n = num(v); return n === null ? null : Math.trunc(n); };
export function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v), ms = n > 1e11 ? n : n * 1000;
    return new Date(ms).toISOString().slice(0, 19) + '+00:00';
  }
  return String(v).trim().replace('Z', '+00:00').replace(/\.\d+(?=[+-]|$)/, '');
}
function digitsList(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) { const o = v.map(int); return o.some((x) => x !== null) ? o : null; }
  const s = String(v).trim();
  if (/[,\s]/.test(s)) return s.split(/[,\s]+/).filter(Boolean).map(int);
  if (/^\d+$/.test(s)) return [...s].map(Number);
  return null;
}
const LIE = {
  teebox: 'Tee', tee: 'Tee', tee_box: 'Tee', fairway: 'Fairway', rough: 'Rough', firstcut: 'Rough', first_cut: 'Rough',
  semirough: 'Rough', bunker: 'Sand', sand: 'Sand', fairwaybunker: 'Sand', greensidebunker: 'Sand', green: 'Green',
  fringe: 'Fringe', recovery: 'Recovery', trees: 'Recovery', water: 'Water', hazard: 'Water', penaltyarea: 'Water',
  outofbounds: 'OB', ob: 'OB', unknown: null, '': null,
};
export function normLie(v) {
  if (v === null || v === undefined) return null;
  const k = String(v).toLowerCase().replace(/[^a-z_]/g, '');
  return k in LIE ? LIE[k] : String(v);
}

export function parseRoundBundle(bundle) {
  const issues = [];
  const issue = (severity, field, message) => issues.push({ severity, field, message });
  let sid = first(bundle, 'scorecard_id');
  const summary = bundle.summary || {};
  const detail = 'detail' in bundle ? bundle.detail : bundle;
  let sc = null, snaps = [];
  if (detail && typeof detail === 'object') {
    snaps = detail.courseSnapshots || [];
    const cards = detail.scorecardDetails;
    if (Array.isArray(cards) && cards.length) {
      for (const c of cards) { const s = c?.scorecard || c; if (s && (sid === null || String(s.id) === String(sid))) { sc = s; break; } }
      if (!sc) sc = cards[0].scorecard || cards[0];
    } else if (detail.scorecard) sc = detail.scorecard;
    else if (detail.holes) sc = detail;
  }
  if (!sc) throw new Error('No scorecard found in bundle');
  sid = String(first(sc, 'id') ?? sid);
  const round_id = `garmin-${sid}`;
  const snapId = first(sc, 'courseSnapshotId');
  let snap = null;
  for (const s of snaps) if (snapId === null || String(s.courseSnapshotId) === String(snapId)) { snap = s; break; }
  const cg = first(sc, 'courseGlobalId') ?? first(snap, 'courseGlobalId');
  const course_name = first(snap, 'name', 'courseName') ?? first(sc, 'courseName') ?? first(summary, 'courseName');
  let course_id = null;
  if (cg !== null) course_id = `garmin-${cg}`;
  else if (course_name) course_id = 'name-' + course_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  else issue('warning', 'course', 'Course name/id not present');
  if (!course_name) issue('warning', 'course_name', 'Course name not present');
  const startLocal = first(sc, 'formattedStartTime', 'startTimeLocal');
  const start = startLocal ? parseTime(startLocal) : parseTime(first(sc, 'startTime') ?? first(summary, 'startTime'));
  if (!start) issue('error', 'date', 'Round date/time missing');
  const pars = digitsList(first(snap, 'holePars', 'pars'));
  let si = null;
  for (const key of ['holeHandicaps', 'handicaps', 'strokeIndexes', 'holeStrokeIndexes']) {
    const c = digitsList(first(snap, key));
    if (c && c.every((x) => x !== null) && Math.max(...c) > 9) { si = c; break; }
    if (c && c.length <= 9 && c.every((x) => x !== null)) { si = c; break; }
  }
  if (!si) issue('info', 'stroke_index', 'Stroke index not in Garmin data - enter it under Settings > Courses for Stableford');
  const tee = first(sc, 'teeBox', 'teeBoxName', 'teeName');
  const rating = num(first(sc, 'teeBoxRating', 'courseRating')), slope = num(first(sc, 'teeBoxSlope', 'slopeRating'));
  if (tee === null) issue('info', 'tee', 'Tee not present');
  if (rating === null || slope === null) issue('info', 'rating_slope', 'Course rating/slope not present - enter under Settings > Courses');

  const pins = {}, holes = [];
  for (const h of sc.holes || []) {
    const n = int(first(h, 'number', 'holeNumber')); if (n === null) continue;
    const strokes = int(first(h, 'strokes')); if (!strokes) continue;
    let par = int(first(h, 'par')); if (par === null && pars && n - 1 < pars.length) par = pars[n - 1];
    const stroke_index = si && n - 1 < si.length ? si[n - 1] : null;
    let fw = first(h, 'fairwayShotOutcome', 'fairway'); fw = fw !== null ? String(fw).toUpperCase() : null;
    if (par === 3) fw = 'NA';
    const plat = toDegrees(first(h, 'pinPositionLat')), plon = toDegrees(first(h, 'pinPositionLon'));
    const ok = validPoint(plat, plon); if (ok) pins[n] = [plat, plon];
    holes.push({ round_id, hole: n, par, stroke_index, strokes, putts: h.putts ?? null, penalties: h.penalties ?? null,
      fairway: fw, pin_lat: ok ? plat : null, pin_lon: ok ? plon : null });
  }
  holes.forEach((h) => { h.putts = int(h.putts); h.penalties = int(h.penalties); });
  if (!holes.length) issue('error', 'holes', 'No played holes in scorecard');
  if (holes.some((h) => h.par === null)) issue('warning', 'par', 'Par missing for some holes');
  if (holes.every((h) => h.putts === null)) issue('warning', 'putts', 'No putts recorded');

  const shots = [];
  const sr = bundle.shots || {};
  let hs = sr && typeof sr === 'object' ? sr.holeShots : null;
  if (!hs && detail && typeof detail === 'object') hs = detail.holeShots;
  if (!hs || !hs.length) issue('warning', 'shots', 'No shot-level data for this round');
  for (const H of hs || []) {
    const hn = int(first(H, 'holeNumber', 'number'));
    const pin = H.pinPosition || {};
    const plat = toDegrees(first(pin, 'lat', 'latitude')), plon = toDegrees(first(pin, 'lon', 'longitude'));
    if (hn !== null && validPoint(plat, plon)) pins[hn] = [plat, plon];
    (H.shots || []).forEach((s, i) => {
      const n = int(first(s, 'holeNumber') ?? hn), order = num(first(s, 'shotOrder', 'order') ?? i + 1);
      const st = s.startLoc || {}, en = s.endLoc || {};
      const slat = toDegrees(first(st, 'lat')), slon = toDegrees(first(st, 'lon'));
      const elat = toDegrees(first(en, 'lat')), elon = toDegrees(first(en, 'lon'));
      const gid = first(s, 'id');
      let club = first(s, 'clubId'); club = club === 0 || club === '0' || club === null ? null : String(club);
      const sOk = validPoint(slat, slon), eOk = validPoint(elat, elon);
      shots.push({
        shot_key: gid !== null ? `${round_id}:${gid}` : `${round_id}:${n}:${order}`, round_id, hole: n, shot_order: order,
        garmin_shot_id: gid !== null ? String(gid) : null, club_id: club,
        start_lat: sOk ? slat : null, start_lon: sOk ? slon : null, start_lie: normLie(first(st, 'lie')),
        end_lat: eOk ? elat : null, end_lon: eOk ? elon : null, end_lie: normLie(first(en, 'lie')),
        dist_m: num(first(s, 'meters', 'distance')), shot_time: parseTime(first(s, 'shotTime')),
        shot_type_garmin: first(s, 'shotType'), auto_shot_type: first(s, 'autoShotType'),
        shot_source: first(s, 'shotSource'), source: 'garmin',
      });
    });
  }
  for (const h of holes) if (h.pin_lat === null && pins[h.hole]) [h.pin_lat, h.pin_lon] = pins[h.hole];
  if (shots.length && !shots.some((s) => s.club_id)) issue('warning', 'club', 'Shots present but none carry a club id');
  const par_total = holes.reduce((a, h) => a + (h.par || 0), 0) || null;
  const gross = holes.reduce((a, h) => a + h.strokes, 0) || null;
  const round = {
    round_id, source: 'garmin', source_id: sid, start_time_local: start, date: start ? start.slice(0, 10) : null,
    course_id, course_name, tee, course_rating: rating, slope, par_total, holes_played: holes.length, gross,
    garmin_handicapped_strokes: int(first(sc, 'handicappedStrokes')),
    garmin_player_handicap: num(first(sc, 'playerHandicap', 'courseHandicap')),
    score_type: first(sc, 'scoreType', 'scoringType'), in_progress: first(sc, 'roundInProgress') ? 1 : 0,
    origin: bundle.source === 'manual_entry' ? 'manual' : 'garmin',
  };
  if (round.in_progress) issue('warning', 'in_progress', 'Garmin marks this round as still in progress');
  const course_holes = (course_id && pars) ? pars.slice(0, 18).map((p, i) => ({ hole: i + 1, par: p, stroke_index: si && i < si.length ? si[i] : null })) : [];
  return { round, holes, shots, course_id, course_name, tee, rating, slope, course_holes, issues };
}

const CATS = [['putter', /putt/], ['driver', /driver|\b1w\b|^dr$/], ['wood', /wood|\b[3-9]w\b/],
  ['hybrid', /hybrid|rescue|\b\d ?h(y)?\b/], ['wedge', /wedge|\b(pw|gw|aw|sw|lw|uw)\b|\b(4[6-9]|5\d|6[0-4])\b|°/],
  ['iron', /iron|\b\d ?i\b/]];
export function guessCategory(name) {
  if (!name) return 'other';
  const n = name.toLowerCase(); for (const [c, re] of CATS) if (re.test(n)) return c; return 'other';
}
export function parseClubsBundle(b) {
  let raw = b?.clubs; if (raw && !Array.isArray(raw)) raw = first(raw, 'clubs', 'playerClubs') || [];
  let types = b?.club_types || []; if (types && !Array.isArray(types)) types = first(types, 'clubTypes', 'types') || [];
  const tn = {};
  for (const t of types || []) { const id = first(t, 'value', 'id', 'clubTypeId'), nm = first(t, 'name', 'displayName', 'shortName'); if (id !== null && nm) tn[String(id)] = String(nm); }
  const out = [];
  for (const c of raw || []) {
    const id = first(c, 'id', 'clubId'); if (id === null) continue;
    const tid = first(c, 'clubTypeId');
    const nm = first(c, 'name', 'model', 'displayName') || tn[String(tid)] || (tid !== null ? `Club type ${tid}` : `Club ${id}`);
    out.push({ club_id: String(id), club_type_id: tid !== null ? String(tid) : null, garmin_name: String(nm),
      garmin_retired: first(c, 'retired') || first(c, 'deleted') ? 1 : 0 });
  }
  return out;
}

// ------------------------------------------------------------------ corrections overlay
export function latestCorrections(corrections) {
  const m = new Map();
  for (const c of [...(corrections || [])].filter((c) => c.active).sort((a, b) => a.id - b.id)) m.set(`${c.entity}|${c.key}|${c.field}`, c);
  const byEntity = { round: new Map(), hole: new Map(), shot: new Map() };
  for (const c of m.values()) {
    const e = byEntity[c.entity]; if (!e) continue;
    if (!e.has(c.key)) e.set(c.key, {}); e.get(c.key)[c.field] = c.value;
  }
  return byEntity;
}
function applyOverlay(row, ov) {
  row.corrected_fields = [];
  if (!ov) return row;
  for (const [f, v] of Object.entries(ov)) { row[f] = v; row.corrected_fields.push(f); }
  return row;
}
export const holeKey = (rid, hole) => `${rid}|${Math.trunc(hole)}`;

// ------------------------------------------------------------------ base tables from state
// state: {bundles:[], clubsBundle, settings:{clubs, tees, holes, handicaps}, corrections:[], manualShots:[]}
export function buildBase(state) {
  const parsed = [], issues = [];
  const keys = [...(state.bundles || [])];
  for (const b of keys) {
    try { parsed.push(parseRoundBundle(b)); } catch (e) { issues.push({ severity: 'error', round_id: null, field: 'file', message: `${b?.scorecard_id ?? '?'}: ${e.message}` }); }
  }
  parsed.sort((a, b) => String(a.round.source_id).localeCompare(String(b.round.source_id)));
  const rounds = [], holes = [], shots = [], tees = {}, chole = {}, courses = {};
  const settings = state.settings || {};
  for (const p of parsed) {
    rounds.push({ ...p.round }); p.holes.forEach((h) => holes.push({ ...h })); p.shots.forEach((s) => shots.push({ ...s }));
    p.issues.forEach((i) => issues.push({ ...i, round_id: p.round.round_id }));
    if (p.course_id) {
      courses[p.course_id] = courses[p.course_id] || p.course_name;
      if (p.tee) {
        const k = `${p.course_id}|${p.tee}`, t = tees[k] || { course_id: p.course_id, tee: p.tee, rating: null, slope: null, source: 'garmin' };
        if (p.rating !== null) t.rating = p.rating; if (p.slope !== null) t.slope = p.slope; tees[k] = t;
      }
      for (const ch of p.course_holes) {
        const k = `${p.course_id}|${ch.hole}`, c = chole[k] || { par: null, stroke_index: null, source: 'garmin' };
        if (ch.par !== null) c.par = ch.par; if (ch.stroke_index !== null) c.stroke_index = ch.stroke_index; chole[k] = c;
      }
    }
  }
  for (const [k, t] of Object.entries(settings.tees || {})) {
    const [cid, tee] = k.split('|'); tees[k] = { course_id: cid, tee, rating: num(t.rating), slope: num(t.slope), source: 'user' };
  }
  for (const [k, c] of Object.entries(settings.holes || {})) chole[k] = { par: num(c.par), stroke_index: num(c.stroke_index), source: 'user' };
  for (const m of state.manualShots || []) shots.push({ ...m, source: 'manual' });
  // clubs: Garmin list + placeholders + user-added, then user overrides
  const clubs = {};
  for (const c of parseClubsBundle(state.clubsBundle || {})) clubs[c.club_id] = { ...c, display_name: c.garmin_name, category: guessCategory(c.garmin_name), sort_order: null, target_carry_m: null, target_total_m: null, active: c.garmin_retired ? 0 : 1, source: 'garmin' };
  for (const s of shots) if (s.club_id && !clubs[s.club_id]) clubs[s.club_id] = { club_id: s.club_id, garmin_name: `Unknown club ${s.club_id}`, display_name: `Unknown club ${s.club_id}`, category: 'other', active: 1, source: 'placeholder' };
  for (const [id, o] of Object.entries(settings.clubs || {})) clubs[id] = { club_id: id, garmin_name: null, display_name: o.display_name || id, category: 'other', active: 1, source: 'user', ...(clubs[id] || {}), ...o };
  // duplicates
  const byTime = rounds.filter((r) => r.start_time_local).sort((a, b) => a.start_time_local.localeCompare(b.start_time_local));
  const nShots = {}; shots.forEach((s) => { nShots[s.round_id] = (nShots[s.round_id] || 0) + 1; });
  const ts = (s) => Date.parse(s.slice(0, 19));
  for (const r of rounds) r.duplicate_of = null;
  let duplicates = 0;
  for (let i = 0; i < byTime.length; i++) {
    const a = byTime[i];
    for (let j = i + 1; j < byTime.length; j++) {
      const b = byTime[j];
      if (ts(b.start_time_local) - ts(a.start_time_local) > T.duplicate_window_minutes * 60000) break;
      if ((a.course_id ?? a.course_name) === (b.course_id ?? b.course_name)) {
        const [keep, drop] = (nShots[a.round_id] || 0) >= (nShots[b.round_id] || 0) ? [a, b] : [b, a];
        if (drop.duplicate_of === null) drop.duplicate_of = keep.round_id;
        duplicates++;
      }
    }
  }
  return { rounds, holes, shots, clubs: Object.values(clubs), tees, chole, courses, issues, duplicates,
    handicaps: [...(settings.handicaps || [])].sort((a, b) => a.date.localeCompare(b.date)) };
}

// ------------------------------------------------------------------ effective dataset
export function buildDataset(state, opts = {}) {
  const base = buildBase(state);
  const ov = latestCorrections(state.corrections);
  let rounds = base.rounds.map((r) => applyOverlay({ ...r, weather: null, conditions: null, excluded: null, handicap_index: null, notes: null, is_competition: null }, ov.round.get(r.round_id)));
  let holes = base.holes.map((h) => applyOverlay({ ...h, gir: null, first_putt_m: null, putts_confirmed: null, excluded: null }, ov.hole.get(holeKey(h.round_id, h.hole))));
  let shots = base.shots.map((s) => applyOverlay({ ...s, excluded: null, shot_category: null }, ov.shot.get(s.shot_key)));
  const clubs = buildClubs(base.clubs);
  if (!rounds.length) return { rounds: [], holes: [], shots: [], clubs, base, issues: base.issues };
  rounds = buildRoundsBase(rounds, base);
  if (!opts.includeDuplicates) rounds = rounds.filter((r) => r.duplicate_of === null);
  if (!opts.includeExcluded) rounds = rounds.filter((r) => !r.excluded);
  const ids = new Set(rounds.map((r) => r.round_id));
  holes = holes.filter((h) => ids.has(h.round_id));
  shots = shots.filter((s) => ids.has(s.round_id));
  holes = buildHoles(holes, rounds, base.chole);
  if (opts.estimateIndex) estimateIndexes(rounds, holes);
  shots = buildShots(shots, holes, clubs);
  holeChain(holes, shots);
  roundMetrics(rounds, holes, shots);
  rounds.sort((a, b) => (a.start_time_local || '').localeCompare(b.start_time_local || ''));
  return { rounds, holes, shots, clubs, base, issues: base.issues };
}

// ---- WHS Handicap Index from score differentials (Rules of Handicapping 5.2a table).
// Not applied: PCC, soft/hard caps, exceptional-score reduction, 9-hole score combination.
export function whsIndex(diffs) {
  const d = diffs.filter(isNum).slice(-20), n = d.length;
  if (n < 3) return null;
  const [k, adj] = n === 3 ? [1, -2] : n === 4 ? [1, -1] : n === 5 ? [1, 0] : n === 6 ? [2, -1] : n <= 8 ? [2, 0] : n <= 11 ? [3, 0]
    : n <= 14 ? [4, 0] : n <= 16 ? [5, 0] : n <= 18 ? [6, 0] : n === 19 ? [7, 0] : [8, 0];
  const low = [...d].sort((x, y) => x - y).slice(0, k);
  return Math.min(54, Math.round((low.reduce((x, y) => x + y, 0) / k + adj) * 10) / 10);
}
export function whsCounting(diffs) {           // which of the last 20 differentials count
  const d = diffs.slice(-20), n = d.filter(isNum).length; if (n < 3) return new Set();
  const k = n <= 5 ? 1 : n <= 8 ? 2 : n <= 11 ? 3 : n <= 14 ? 4 : n <= 16 ? 5 : n <= 18 ? 6 : n === 19 ? 7 : 8;
  return new Set(d.map((v, i) => [v, i]).filter(([v]) => isNum(v)).sort((x, y) => x[0] - y[0]).slice(0, k).map(([, i]) => i));
}
// Expected 9-hole score differential for a given Handicap Index. The WHS does not publish its exact table;
// this is the widely published linear approximation of it (0.52 x HI + 1.197).
export const expectedNineDifferential = (hi) => 0.52 * hi + 1.197;
// Walk rounds in date order: where no official index is known for a round, use the index computed
// from your earlier rounds, so Stableford/differentials can be reconstructed for the whole history.
function estimateIndexes(rounds, holes) {
  const byR = groupBy(holes, (h) => h.round_id), diffs = [];
  const order = [...rounds].sort((a, b) => (a.start_time_local || '').localeCompare(b.start_time_local || ''));
  for (const r of order) {
    const hs = byR.get(r.round_id) || [];
    r.index_before = whsIndex(diffs);
    if (r.hi === null && r.index_before !== null) {
      r.hi = r.index_before; r.hi_source = 'GolfIQ estimate (from your earlier rounds)';
      hs.forEach((h) => { h.hi = r.hi; applyHandicap(h); });
    }
    let d = null;
    const rated = isNum(r.slope) && isNum(r.course_rating) && hs.every((h) => h.par !== null);
    const ags = () => (hs.every((h) => h.ags_hole !== null) ? sum(hs.map((h) => h.ags_hole)) : null);
    if (hs.length === 18 && rated) {
      if (ags() !== null) d = 113 / r.slope * (ags() - r.course_rating);
      else { d = 113 / r.slope * (sum(hs.map((h) => Math.min(h.strokes, h.par + 5))) - r.course_rating); r.differential_provisional = d; }
    } else if (hs.length === 9 && rated && isNum(r.hi)) {
      // WHS (2024): a 9-hole score becomes an 18-hole differential by adding the player's EXPECTED differential
      // for the nine not played, which depends only on their Handicap Index at the time.
      const cr9 = r.course_rating > 50 ? r.course_rating / 2 : r.course_rating;      // Garmin gives the 18-hole rating
      const played = ags() !== null ? ags() : sum(hs.map((h) => Math.min(h.strokes, h.par + 5)));
      r.differential_9 = 113 / r.slope * (played - cr9);
      r.expected_9 = expectedNineDifferential(r.hi);
      d = r.differential_9 + r.expected_9;
      r.differential_nine_hole = d;
    }
    r.differential_for_index = d;
    if (d !== null) diffs.push(d);
    r.index_after = whsIndex(diffs);
  }
}

function buildClubs(list) {
  const order = { driver: 0, wood: 1, hybrid: 2, iron: 3, wedge: 4, putter: 5, other: 6 };
  const c = list.map((x) => ({ ...x, cat_rank: order[x.category] ?? 6, name: x.display_name || x.garmin_name || x.club_id,
    target_carry_m: num(x.target_carry_m), target_total_m: num(x.target_total_m), sort_order: num(x.sort_order) }));
  return c.sort((a, b) => a.cat_rank - b.cat_rank || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.name.localeCompare(b.name));
}

function buildRoundsBase(rounds, base) {
  for (const r of rounds) {
    r.course_rating = num(r.course_rating); r.slope = num(r.slope); r.garmin_player_handicap = num(r.garmin_player_handicap);
    r.rating_source = r.course_rating !== null ? 'garmin' : null;
    const t = base.tees[`${r.course_id}|${r.tee}`];
    const corrected = r.corrected_fields.includes('course_rating') || r.corrected_fields.includes('slope');
    if (t && (t.source === 'user' || r.course_rating === null) && t.rating !== null && !corrected) {
      r.course_rating = t.rating; if (t.slope !== null) r.slope = t.slope; r.rating_source = t.source;
    }
    if (r.corrected_fields.includes('course_rating')) r.rating_source = 'user';
    r.hi = num(r.handicap_index); r.hi_source = r.hi !== null ? 'user (round)' : null;
    if (r.hi === null && r.date) {
      const prior = base.handicaps.filter((h) => h.date <= r.date);
      if (prior.length) { r.hi = num(prior[prior.length - 1].handicap_index); r.hi_source = 'handicap history'; }
    }
    r.excluded = !!r.excluded;
  }
  return rounds;
}

// Handicap-dependent hole fields (course/playing handicap, strokes received, Stableford, net double bogey cap).
function applyHandicap(h) {
  const hp = h.holes_played ?? 18;
  if ([h.hi, h.slope, h.course_rating, h.par_total].every(isNum)) {
    if (hp <= 9) h.ch = courseHandicap(h.hi / 2, h.slope, h.course_rating > 50 ? h.course_rating / 2 : h.course_rating, h.par_total);
    else if (hp < 18) h.ch = courseHandicap(h.hi, h.slope, h.course_rating, pyRound(h.par_total * 18 / hp));
    else h.ch = courseHandicap(h.hi, h.slope, h.course_rating, h.par_total);
  } else h.ch = null;
  h.ph = h.ch !== null ? playingHandicap(h.ch, T.stableford_allowance) : null;
  h.ph_source = h.ph !== null ? 'computed (WHS)' : null;
  if (h.ph === null && h.garmin_player_handicap !== null) { h.ph = pyRound(h.garmin_player_handicap); h.ph_source = 'garmin recorded'; }
  const n = hp > 9 ? 18 : 9;
  h.strokes_rec = h.ph !== null && isNum(h.si_rank) ? strokesReceived(h.ph, h.si_rank, n) : null;
  h.net = h.strokes_rec !== null ? h.strokes - h.strokes_rec : null;
  h.stableford = h.strokes_rec !== null && h.par !== null ? stablefordPoints(h.strokes, h.par, h.strokes_rec) : null;
  h.ch_strokes = h.ch !== null && isNum(h.si_rank) ? strokesReceived(pyRound(h.ch), h.si_rank, n) : null;
  h.ags_hole = h.ch_strokes !== null ? Math.min(h.strokes, h.par + 2 + h.ch_strokes) : null;
}

function buildHoles(holes, rounds, chole) {
  const rmap = new Map(rounds.map((r) => [r.round_id, r]));
  for (const h of holes) {
    const r = rmap.get(h.round_id);
    Object.assign(h, { course_id: r.course_id, date: r.date, start_time_local: r.start_time_local, course_rating: r.course_rating,
      slope: r.slope, par_total: r.par_total, holes_played: r.holes_played, hi: r.hi, garmin_player_handicap: r.garmin_player_handicap });
    const c = chole[`${h.course_id}|${h.hole}`];
    if (c) for (const [col, cv] of [['par', c.par], ['stroke_index', c.stroke_index]]) {
      if ((h[col] === null || h[col] === undefined || c.source === 'user') && cv !== null && !h.corrected_fields.includes(col)) h[col] = cv;
    }
    for (const k of ['par', 'stroke_index', 'strokes', 'putts', 'penalties', 'pin_lat', 'pin_lon', 'first_putt_m']) h[k] = num(h[k]);
  }
  const byRound = groupBy(holes, (h) => h.round_id);
  for (const hs of byRound.values()) {
    const p = hs.map((h) => h.putts).filter(isNum);
    const allTwo = p.length >= T.putts_default_suspect_holes && p.every((x) => x === 2);
    const confirmed = hs.some((h) => !!h.putts_confirmed || h.corrected_fields.includes('putts'));
    for (const h of hs) {
      h.putts_status = h.corrected_fields.includes('putts') ? 'user' : h.putts === null ? 'missing' : (allTwo && !confirmed) ? 'suspect_default' : 'garmin';
    }
    // stroke-index rank within played holes (9-hole rounds on an 18-hole card)
    hs.forEach((h, i) => { h._i = i; });
    const ranked = hs.filter((h) => h.stroke_index !== null).sort((a, b) => a.stroke_index - b.stroke_index || a._i - b._i);
    ranked.forEach((h, i) => { h.si_rank = i + 1; });
    hs.forEach((h) => { if (h.stroke_index === null) h.si_rank = null; if (h.holes_played > 9) h.si_rank = h.stroke_index; });
  }
  for (const h of holes) {
    h.putts_eff = ['garmin', 'user'].includes(h.putts_status) ? h.putts : null;
    h.penalties_eff = h.penalties;
    h.to_par = h.strokes !== null && h.par !== null ? h.strokes - h.par : null;
    const ug = (h.gir === true || h.gir === false || h.gir === 0 || h.gir === 1) ? (h.gir ? 1 : 0) : null;
    const comp = h.putts_eff !== null && h.par !== null ? ((h.strokes - h.putts_eff) <= (h.par - 2) ? 1 : 0) : null;
    h.gir_eff = ug !== null ? ug : comp;
    h.gir_source = ug !== null ? 'user' : comp !== null ? 'computed' : null;
    if (h.par === 3) h.fairway = 'NA';
    h.fw_hit = h.fairway === 'HIT' ? 1 : ['LEFT', 'RIGHT', 'SHORT', 'LONG', 'MISS'].includes(h.fairway) ? 0 : null;
    applyHandicap(h);
    h.blowup = h.to_par !== null && h.to_par >= 3 ? 1 : 0;
    h.excluded = h.excluded === true || h.excluded === 1;
  }
  return holes;
}

function buildShots(shots, holes, clubs) {
  if (!shots.length) return [];
  const hmap = new Map(holes.map((h) => [holeKey(h.round_id, h.hole), h]));
  const cmap = new Map(clubs.map((c) => [c.club_id, c]));
  for (const s of shots) {
    for (const k of ['start_lat', 'start_lon', 'end_lat', 'end_lon', 'dist_m', 'shot_order']) s[k] = num(s[k]);
    s.hole = Math.trunc(Number(s.hole));
    const h = hmap.get(holeKey(s.round_id, s.hole)) || {};
    Object.assign(s, { par: h.par ?? null, pin_lat: h.pin_lat ?? null, pin_lon: h.pin_lon ?? null, course_id: h.course_id ?? null,
      date: h.date ?? null, start_time_local: h.start_time_local ?? null });
    const c = s.club_id ? cmap.get(s.club_id) : null;
    s.club = s.club_id ? (c ? c.name : null) : 'Unassigned'; s.club_category = c ? c.category : null;
  }
  shots.sort((a, b) => a.round_id.localeCompare(b.round_id) || a.hole - b.hole || a.shot_order - b.shot_order);
  for (const s of shots) {
    const hasS = s.start_lat !== null, hasE = s.end_lat !== null, hasP = s.pin_lat !== null;
    const gps = hasS && hasE ? haversine(s.start_lat, s.start_lon, s.end_lat, s.end_lon) : null;
    s.dist_source = s.corrected_fields.includes('dist_m') ? 'user' : s.dist_m !== null ? 'garmin (GPS start->end)' : gps !== null ? 'computed (GPS)' : null;
    if (s.dist_m === null) s.dist_m = gps;
    s.start_to_pin = hasS && hasP ? haversine(s.start_lat, s.start_lon, s.pin_lat, s.pin_lon) : null;
    s.end_to_pin = hasE && hasP ? haversine(s.end_lat, s.end_lon, s.pin_lat, s.pin_lon) : null;
    if (num(s.start_to_pin_m) !== null) s.start_to_pin = num(s.start_to_pin_m);
  }
  const groups = groupBy(shots, (s) => `${s.round_id}|${s.hole}`);
  for (const g of groups.values()) g.forEach((s, i) => {
    if (s.end_to_pin === null && s.end_lat === null && i + 1 < g.length) s.end_to_pin = g[i + 1].start_to_pin;
  });
  for (const g of groups.values()) g.forEach((s, i) => {
    const gt = String(s.shot_type_garmin ?? '').toUpperCase(), lie = s.start_lie ?? '';
    const isTee = lie === 'Tee' || gt === 'TEE' || (i === 0 && s.shot_order === 1 && lie === '');
    const isPutt = lie === 'Green' || gt === 'PUTT' || s.club_category === 'putter';
    const isPen = gt === 'PENALTY';
    const progress = isNum(s.start_to_pin) && isNum(s.end_to_pin) && s.dist_m ? (s.start_to_pin - s.end_to_pin) / s.dist_m : null;
    const ag = s.start_to_pin !== null && s.start_to_pin <= T.around_green_max_m;
    const recovery = !isTee && (lie === 'Recovery' || (s.start_to_pin !== null && s.start_to_pin > T.around_green_max_m && progress !== null && progress < T.recovery_progress_ratio));
    const gcat = { TEE: 'tee', APPROACH: 'approach', CHIP: 'around_green', PUTT: 'putt' }[gt] || 'unknown';
    let cat;
    if (isPen) cat = 'penalty'; else if (isPutt) cat = 'putt'; else if (isTee && s.par >= 4) cat = 'tee';
    else if (isTee && s.par === 3) cat = 'approach'; else if (s.start_to_pin === null) cat = gcat;
    else if (ag) cat = 'around_green'; else if (recovery) cat = 'recovery'; else cat = 'approach';
    s.category_source = (s.start_to_pin !== null || isPen || isPutt || isTee) ? 'computed' : 'garmin shotType';
    s.category = s.shot_category ?? cat; if (s.shot_category) s.category_source = 'user';
    s.par3_tee = isTee && s.par === 3; s.progress_ratio = progress;
    s.lateral_m = null; s.long_short_m = null; s.lateral_ref = null;
  });
  for (const s of shots) {
    if (['approach', 'around_green'].includes(s.category) && s.start_lat !== null && s.end_lat !== null && s.pin_lat !== null) {
      const b = bearing(s.start_lat, s.start_lon, s.pin_lat, s.pin_lon);
      const [al, cr] = alongCross(s.start_lat, s.start_lon, s.end_lat, s.end_lon, b);
      s.lateral_m = cr; s.long_short_m = al - s.start_to_pin; s.lateral_ref = 'pin';
    }
  }
  const tees = shots.filter((s) => s.category === 'tee' && s.start_lat !== null && s.end_lat !== null);
  for (const g of groupBy(tees, (s) => `${s.course_id}|${s.hole}`).values()) {
    if (g.length < T.min_drives_for_aim_line) continue;
    const aim = circularMedian(g.map((s) => bearing(s.start_lat, s.start_lon, s.end_lat, s.end_lon)));
    for (const s of g) { s.lateral_m = alongCross(s.start_lat, s.start_lon, s.end_lat, s.end_lon, aim)[1]; s.lateral_ref = 'median drive line on this hole'; }
  }
  for (const s of shots) {
    const userEx = s.excluded === true || s.excluded === 1;
    const nonputt = !['putt', 'penalty'].includes(s.category);
    s.excluded_reason = userEx ? 'user' : (nonputt && s.dist_m !== null && s.dist_m > T.gps_max_shot_m) ? 'gps: implausible distance'
      : (nonputt && s.dist_m !== null && s.dist_m < T.gps_min_shot_m) ? 'gps: zero distance' : null;
    s.excluded = s.excluded_reason !== null;
  }
  for (const g of groups.values()) g.forEach((s, i) => {
    const nxt = i + 1 < g.length ? g[i + 1].category : null;
    s.ends_in_penalty = ['Water', 'OB'].includes(s.end_lie) || nxt === 'penalty';
    s.full_swing = ['tee', 'approach'].includes(s.category) && !s.excluded && !!s.club_id && s.club_category !== 'putter' && !s.ends_in_penalty && s.dist_m !== null;
    s.on_green_end = s.end_lie !== null ? (s.end_lie === 'Green' ? 1 : 0) : s.end_to_pin !== null ? (s.end_to_pin <= T.assumed_green_radius_m ? 1 : 0) : null;
    s.on_green_source = s.end_lie !== null ? 'garmin lie' : s.end_to_pin !== null ? 'estimated (distance to pin)' : null;
  });
  return shots;
}

function holeChain(holes, shots) {
  const swings = groupBy(shots.filter((s) => !['putt', 'penalty'].includes(s.category)), (s) => holeKey(s.round_id, s.hole));
  const pens = groupBy(shots.filter((s) => s.category === 'penalty'), (s) => holeKey(s.round_id, s.hole));
  for (const h of holes) {
    const k = holeKey(h.round_id, h.hole), sw = swings.get(k) || [];
    h.swings_tracked = sw.length; h.penalty_rows = (pens.get(k) || []).length;
    const p = h.penalties_eff !== null ? h.penalties_eff : h.penalty_rows;
    h.swings_missing = h.putts_eff !== null ? h.strokes - h.putts_eff - p - h.swings_tracked : null;
    h.chain_complete = h.swings_missing === 0 && h.putts_eff !== null && h.pin_lat !== null;
    const last = sw.length ? [...sw].sort((a, b) => a.shot_order - b.shot_order)[sw.length - 1] : null;
    const estOk = h.chain_complete && last && last.on_green_end === 1 && h.putts_eff > 0;
    h.first_putt_est_m = estOk ? last.end_to_pin : null;
    h.first_putt_eff_m = h.first_putt_m !== null ? h.first_putt_m : h.first_putt_est_m;
    h.first_putt_source = h.first_putt_m !== null ? 'user' : estOk ? 'estimated (GPS to pin marker)' : null;
  }
}

function roundMetrics(rounds, holes, shots) {
  const hb = groupBy(holes, (h) => h.round_id), sb = groupBy(shots, (s) => s.round_id);
  for (const r of rounds) {
    const h = hb.get(r.round_id) || [], s = sb.get(r.round_id) || [];
    const pc = h.map((x) => x.putts_eff).filter(isNum);
    Object.assign(r, {
      holes_played: h.length, gross: sum(h.map((x) => x.strokes)), par_played: sumOrNull(h.map((x) => x.par)),
      putts: sumOrNull(h.map((x) => x.putts_eff)), putts_holes: pc.length,
      gir_n: sumOrNull(h.map((x) => x.gir_eff)), gir_holes: count(h.map((x) => x.gir_eff)),
      fw_n: sumOrNull(h.map((x) => x.fw_hit)), fw_holes: count(h.map((x) => x.fw_hit)),
      penalties: sumOrNull(h.map((x) => x.penalties_eff)), stableford: sumOrNull(h.map((x) => x.stableford)),
      stableford_holes: count(h.map((x) => x.stableford)), ags: sumOrNull(h.map((x) => x.ags_hole)), ags_holes: count(h.map((x) => x.ags_hole)),
      one_putts: pc.length ? pc.filter((x) => x === 1).length : null, three_putts: pc.length ? pc.filter((x) => x >= 3).length : null,
      blowups: sum(h.map((x) => x.blowup)),
      birdies_or_better: h.filter((x) => x.to_par !== null && x.to_par <= -1).length, pars: h.filter((x) => x.to_par === 0).length,
      bogeys: h.filter((x) => x.to_par === 1).length, doubles: h.filter((x) => x.to_par === 2).length,
      triples_plus: h.filter((x) => x.to_par !== null && x.to_par >= 3).length,
      chain_complete_holes: h.filter((x) => x.chain_complete).length,
      ph: h[0]?.ph ?? null, ph_source: h[0]?.ph_source ?? null, ch: h[0]?.ch ?? null,
    });
    const st = groupBy(h, (x) => x.putts_status); let mode = null, best = -1;
    for (const [k, v] of [...st.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) if (v.length > best) { best = v.length; mode = k; }
    r.putts_status = mode;
    r.gross_eff = r.gross; r.to_par = r.par_played !== null ? r.gross - r.par_played : null;
    r.format = r.holes_played === 18 ? '18' : r.holes_played === 9 ? '9' : 'partial';
    r.putts_round = r.putts_holes === r.holes_played ? r.putts : null;
    r.gir_pct = r.gir_holes ? 100 * r.gir_n / r.gir_holes : null;
    r.fw_pct = r.fw_holes ? 100 * r.fw_n / r.fw_holes : null;
    r.putts_per_gir = mean(h.filter((x) => x.gir_eff === 1).map((x) => x.putts_eff));
    r.one_putt_pct = r.putts_holes ? 100 * r.one_putts / r.putts_holes : null;
    r.three_putt_pct = r.putts_holes ? 100 * r.three_putts / r.putts_holes : null;
    r.stableford_complete = r.stableford_holes === r.holes_played;
    r.stableford_round = r.stableford_complete ? r.stableford : null;
    r.stableford_source = r.stableford_complete ? 'reconstructed: ' + (r.ph_source || '') : null;
    const ok = r.format === '18' && r.ags_holes === 18 && r.slope !== null && r.course_rating !== null;
    r.differential = ok ? (113 / r.slope) * (r.ags - r.course_rating) : (r.differential_provisional ?? null);
    r.differential_source = ok ? 'WHS (net double bogey cap)' : isNum(r.differential_provisional) ? 'provisional (par+5 cap: no handicap or stroke index yet)' : null;
    if (r.format === '9' && isNum(r.differential_nine_hole)) { r.differential = r.differential_nine_hole; r.differential_source = '9 holes played + expected score for the other 9 (WHS)'; }
    r.chain_coverage = r.holes_played ? r.chain_complete_holes / r.holes_played : null;
    r.shots_tracked = s.length; r.shots_with_club = s.filter((x) => x.club_id).length;
    r.label = `${r.date} · ${r.course_name ?? '?'} (${r.gross})`;
  }
}

// ------------------------------------------------------------------ filters / trends
export const METRICS = {
  stableford_round: ['Stableford (reconstructed)', true, 'pts'], gross: ['Gross score', false, ''],
  to_par: ['Score to par', false, ''], differential: ['Score differential (WHS)', false, ''],
  gir_pct: ['GIR', true, '%'], fw_pct: ['Fairways hit', true, '%'], putts_round: ['Putts / round', false, ''],
  putts_per_gir: ['Putts per GIR', false, ''], one_putt_pct: ['1-putt', true, '%'], three_putt_pct: ['3-putt', false, '%'],
  penalties: ['Penalties / round', false, ''], blowups: ['Triple bogey+ holes', false, ''],
};

export function filterDataset(ds, f = {}) {
  let r = ds.rounds;
  if (f.dateFrom) r = r.filter((x) => x.date >= f.dateFrom);
  if (f.dateTo) r = r.filter((x) => x.date <= f.dateTo);
  if (f.courses?.length) r = r.filter((x) => f.courses.includes(x.course_name));
  if (f.tees?.length) r = r.filter((x) => f.tees.includes(x.tee));
  if (f.formats?.length) r = r.filter((x) => f.formats.includes(x.format));
  if (f.hcp && r.some((x) => x.hi !== null)) r = r.filter((x) => x.hi === null || (x.hi >= f.hcp[0] && x.hi <= f.hcp[1]));
  r = [...r].sort((a, b) => (a.start_time_local || '').localeCompare(b.start_time_local || ''));
  if (f.lastN) r = r.slice(-f.lastN);
  return subset(ds, r.map((x) => x.round_id));
}
export function subset(ds, ids) {
  const s = new Set(ids);
  return { ...ds, rounds: ds.rounds.filter((r) => s.has(r.round_id)), holes: ds.holes.filter((h) => s.has(h.round_id)), shots: ds.shots.filter((x) => s.has(x.round_id)) };
}
export function withRolling(rounds, metric, windows = [5, 10, 20]) {
  return rounds.map((r, i) => {
    const o = { round_id: r.round_id, date: r.date, label: r.label, value: r[metric], n: i + 1 };
    for (const w of windows) {
      if (i + 1 < w) { o[`roll${w}`] = null; continue; }
      const win = rounds.slice(i + 1 - w, i + 1).map((x) => x[metric]);
      o[`roll${w}`] = win.every(isNum) ? mean(win) : null;
    }
    return o;
  });
}
// Student t CDF via regularized incomplete beta (Numerical Recipes)
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y; return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function ibeta(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function welchP(a, b) {
  const x = vals(a), y = vals(b); if (x.length < 2 || y.length < 2) return null;
  const va = std(x) ** 2 / x.length, vb = std(y) ** 2 / y.length; if (va + vb === 0) return null;
  const t = (mean(x) - mean(y)) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (x.length - 1) + vb ** 2 / (y.length - 1));
  return ibeta(df / 2, 0.5, df / (df + t * t));
}
export function compareWindows(values, higherIsBetter, windows = [5, 10, 20, 50]) {
  const v = vals(values);
  return windows.map((w) => {
    if (v.length < 2 * w) return { window: w, recent: null, prior: null, delta: null, p: null, verdict: 'insufficient data' };
    const rec = v.slice(-w), pri = v.slice(-2 * w, -w), d = mean(rec) - mean(pri), p = welchP(rec, pri);
    const good = higherIsBetter ? d > 0 : d < 0;
    return { window: w, recent: mean(rec), prior: mean(pri), delta: d, p, verdict: p === null || p >= 0.10 ? 'no clear change' : good ? 'improving' : 'worse' };
  });
}
export function kpiTable(rounds, recentN = 5) {
  return Object.entries(METRICS).map(([m, [label, hib, unit]]) => {
    const v = rounds.map((r) => r[m]).filter(isNum);
    if (!v.length) return { metric: m, label, unit, all: null, recent: null, baseline: null, delta: null, good: null, n: 0 };
    const rec = v.slice(-recentN), base = v.length > recentN ? v.slice(0, -recentN) : [];
    const d = base.length ? mean(rec) - mean(base) : null;
    return { metric: m, label, unit, all: mean(v), recent: mean(rec), baseline: base.length ? mean(base) : null, delta: d,
      good: d !== null && d !== 0 ? (d > 0) === hib : null, n: v.length };
  });
}
export function consistency(rounds, m) {
  const v = rounds.map((r) => r[m]).filter(isNum);
  if (v.length < 3) return { sd: null, iqr: null, n: v.length };
  return { sd: std(v), iqr: quantile(v, 0.75) - quantile(v, 0.25), n: v.length };
}

// ------------------------------------------------------------------ scoring
const BINS = [[-9, -2, 'Eagle+'], [-1, -1, 'Birdie'], [0, 0, 'Par'], [1, 1, 'Bogey'], [2, 2, 'Double'], [3, 99, 'Triple+']];
export const scoreBucket = (tp) => (BINS.find(([lo, hi]) => tp >= lo && tp <= hi) || [0, 0, '?'])[2];
export function distribution(holes) {
  const h = holes.filter((x) => x.to_par !== null), out = BINS.map(([, , b]) => ({ bucket: b, holes: 0 }));
  for (const x of h) out.find((o) => o.bucket === scoreBucket(x.to_par)).holes++;
  const tot = h.length || 1; out.forEach((o) => { o.pct = 100 * o.holes / tot; o.per_18 = o.holes / tot * 18; });
  return out;
}
export function byPar(holes) {
  return [...groupBy(holes.filter((h) => h.par !== null), (h) => h.par)].sort((a, b) => a[0] - b[0]).map(([par, g]) => ({
    par, holes: g.length, avg_score: mean(g.map((x) => x.strokes)), avg_to_par: mean(g.map((x) => x.to_par)),
    stableford_avg: mean(g.map((x) => x.stableford)), gir_pct: pct(g.map((x) => x.gir_eff)), blowup_pct: pct(g.map((x) => x.blowup)) }));
}
const pct = (a) => { const m = mean(a); return m === null ? null : 100 * m; };
export function frontBack(holes, rounds) {
  const ids = new Set(rounds.filter((r) => r.format === '18').map((r) => r.round_id));
  const h = holes.filter((x) => ids.has(x.round_id));
  return [['Front 9', (x) => x.hole <= 9], ['Back 9', (x) => x.hole > 9]].map(([nine, f]) => {
    const g = h.filter(f), n = new Set(g.map((x) => x.round_id)).size || 1;
    return { nine, avg_to_par_per_9: sum(g.map((x) => x.to_par)) / n, stableford_per_9: sum(g.map((x) => x.stableford)) / n, putts_per_9: sum(g.map((x) => x.putts_eff)) / n };
  });
}
export function holeAverages(holes, courseId) {
  return [...groupBy(holes.filter((h) => h.course_id === courseId), (h) => h.hole)].sort((a, b) => a[0] - b[0]).map(([hole, g]) => ({
    hole, par: g[0].par, si: g[0].stroke_index, played: g.length, avg: mean(g.map((x) => x.strokes)), avg_to_par: mean(g.map((x) => x.to_par)),
    stableford: mean(g.map((x) => x.stableford)), blowup_pct: pct(g.map((x) => x.blowup)), gir_pct: pct(g.map((x) => x.gir_eff)) }));
}
export function courseSummary(rounds) {
  return [...groupBy(rounds, (r) => `${r.course_name}|${r.tee}`)].map(([, g]) => ({
    course: g[0].course_name, tee: g[0].tee, rounds: g.length, avg_gross: mean(g.map((r) => r.gross)), avg_to_par: mean(g.map((r) => r.to_par)),
    avg_differential: mean(g.map((r) => r.differential)), avg_stableford: mean(g.map((r) => r.stableford_round)), rating: g[0].course_rating, slope: g[0].slope }));
}
export function blowupSummary(holes, rounds) {
  const n = new Set(rounds.map((r) => r.round_id)).size || 1, b = holes.filter((h) => h.blowup === 1);
  return { per_round: b.length / n, beyond_double_per_round: sum(b.map((h) => h.to_par - 2)) / n,
    with_penalty_pct: b.length ? 100 * b.filter((h) => (h.penalties_eff || 0) > 0).length / b.length : null };
}

// ------------------------------------------------------------------ ball striking
// Approach distance bands. Edges are defined in the display unit so labels are round numbers.
const BAND_SETS = { m: [27, 50, 75, 100, 125, 150, 175, 200, 250, 600], yd: [30, 50, 75, 100, 125, 150, 175, 200, 250, 650] };
const unitFactor = (unit) => (unit === 'yd' ? M_PER_YD : unit === 'ft' ? M_PER_FT : 1);
function bandSet(unit = 'm') {
  const e = BAND_SETS[unit] || BAND_SETS.m, f = unitFactor(unit);
  return { edgesM: e.map((x) => x * f), lo: e, label: (i) => (i + 2 < e.length ? `${e[i]}-${e[i + 1]} ${unit}` : `${e[i]}+ ${unit}`) };
}
export function approachShots(shots, unit = 'm') {
  const B = bandSet(unit), E = B.edgesM;
  return shots.filter((s) => s.category === 'approach' && !s.excluded && s.start_to_pin !== null).map((s) => {
    const d = Math.round(s.start_to_pin * 1000) / 1000;   // mm rounding: no float noise at band edges
    const i = E.findIndex((b, k) => k < E.length - 1 && d > b && d <= E[k + 1] + (unit === 'm' ? 0 : 1e-6));
    return { ...s, band: i >= 0 ? B.label(i) : null, band_i: i };
  });
}
function approachAgg(g) {
  const ls = g.map((s) => s.long_short_m).filter(isNum);
  return { shots: g.length, green_hit_pct: pct(g.map((s) => s.on_green_end)), median_proximity_m: median(g.map((s) => s.end_to_pin)),
    mean_long_short_m: mean(ls), sd_long_short_m: std(ls), mean_lateral_m: mean(g.map((s) => s.lateral_m)), sd_lateral_m: std(g.map((s) => s.lateral_m)),
    short_pct: ls.length ? 100 * ls.filter((x) => x < -10).length / ls.length : null, long_pct: ls.length ? 100 * ls.filter((x) => x > 10).length / ls.length : null };
}
export function approachByBand(shots, unit = 'm') {
  const a = approachShots(shots, unit).filter((s) => s.band), B = bandSet(unit);
  return [...groupBy(a, (s) => s.band_i)].sort((x, y) => x[0] - y[0]).map(([i, g]) => ({ band: B.label(i), band_lo: B.lo[i], band_lo_m: B.edgesM[i], ...approachAgg(g) }));
}
export function approachByClub(shots) {
  const a = approachShots(shots).filter((s) => s.club_id);
  return [...groupBy(a, (s) => s.club)].sort((x, y) => x[0].localeCompare(y[0])).map(([club, g]) => ({ club, ...approachAgg(g), median_start_m: median(g.map((s) => s.start_to_pin)) }));
}
export function greenMissDirections(shots, maxStart = 200) {
  const a = approachShots(shots).filter((s) => s.start_to_pin <= maxStart && s.on_green_end === 0 && s.lateral_m !== null && s.long_short_m !== null);
  const out = ['Short', 'Long', 'Left', 'Right'].map((d) => ({ direction: d, count: 0 }));
  for (const s of a) {
    const d = Math.abs(s.long_short_m) >= Math.abs(s.lateral_m) ? (s.long_short_m < 0 ? 'Short' : 'Long') : (s.lateral_m < 0 ? 'Left' : 'Right');
    out.find((o) => o.direction === d).count++;
  }
  const tot = sum(out.map((o) => o.count)); out.forEach((o) => { o.pct = tot ? 100 * o.count / tot : null; });
  return tot ? out : [];
}
export function driving(holes, shots) {
  const h = holes.filter((x) => x.par >= 4), known = h.filter((x) => x.fw_hit !== null).length;
  const cnt = (v) => h.filter((x) => x.fairway === v).length;
  const tee = shots.filter((s) => s.category === 'tee'), ok = tee.filter((s) => !s.excluded);
  return { fairway_holes: known, fw_hit_pct: known ? pct(h.map((x) => x.fw_hit)) : null,
    miss_left_pct: known ? 100 * cnt('LEFT') / known : null, miss_right_pct: known ? 100 * cnt('RIGHT') / known : null,
    tee_shots_tracked: tee.length, tee_penalty_pct: tee.length ? 100 * tee.filter((s) => s.ends_in_penalty).length / tee.length : null,
    median_tee_dist_m: median(ok.map((s) => s.dist_m)),
    by_club: [...groupBy(ok, (s) => s.club)].map(([club, g]) => ({ club, shots: g.length, median_m: median(g.map((s) => s.dist_m)), sd_m: std(g.map((s) => s.dist_m)), lateral_sd_m: std(g.map((s) => s.lateral_m)) })) };
}
export function contrast(holes, flag, mask) {
  const h = holes.filter((x) => (!mask || mask(x)) && x[flag] !== null && x[flag] !== undefined && x.to_par !== null);
  const a = h.filter((x) => x[flag] === 1).map((x) => x.to_par), b = h.filter((x) => x[flag] === 0).map((x) => x.to_par);
  return { n_yes: a.length, n_no: b.length, to_par_yes: mean(a), to_par_no: mean(b), delta: a.length && b.length ? mean(b) - mean(a) : null };
}

// ------------------------------------------------------------------ putting
const PUTT_SETS = { m: [0, 1, 2, 3, 5, 8, 12, 20, 60], ft: [0, 3, 6, 10, 15, 25, 40, 60, 200] };
export function puttingSummary(holes, rounds) {
  const h = holes.filter((x) => x.putts_eff !== null), n = h.length, gir = h.filter((x) => x.gir_eff === 1);
  const share = (f) => (n ? 100 * h.filter(f).length / n : null);
  return { holes_with_putts: n, holes_missing_putts: holes.filter((x) => x.putts_eff === null).length,
    suspect_default_holes: holes.filter((x) => x.putts_status === 'suspect_default').length,
    putts_per_round: mean(rounds.map((r) => r.putts_round)), putts_per_hole: mean(h.map((x) => x.putts_eff)),
    putts_per_gir: mean(gir.map((x) => x.putts_eff)), one_putt_pct: share((x) => x.putts_eff === 1),
    two_putt_pct: share((x) => x.putts_eff === 2), three_putt_pct: share((x) => x.putts_eff >= 3),
    three_putts_per_round: n ? 18 * h.filter((x) => x.putts_eff >= 3).length / n : null };
}
export function puttsPerHoleDistribution(holes) {
  const p = holes.map((h) => h.putts_eff).filter(isNum).map((x) => Math.min(x, 4));
  const out = [0, 1, 2, 3, 4].map((k) => ({ putts: k === 4 ? '4+' : String(k), holes: p.filter((x) => x === k).length })).filter((o) => o.holes);
  out.forEach((o) => { o.pct = 100 * o.holes / p.length; }); return out;
}
export function byFirstPuttDistance(holes, source = 'user', unit = 'm') {
  const h = holes.filter((x) => x.first_putt_eff_m !== null && x.putts_eff > 0 && String(x.first_putt_source).startsWith(source));
  const PB = PUTT_SETS[unit] || PUTT_SETS.m, f = unitFactor(unit), out = [];
  for (let i = 0; i < PB.length - 1; i++) {
    const g = h.filter((x) => x.first_putt_eff_m > PB[i] * f && x.first_putt_eff_m <= PB[i + 1] * f + 1e-9); if (!g.length) continue;
    out.push({ band: `${PB[i]}-${PB[i + 1]} ${unit}`, holes: g.length, avg_putts: mean(g.map((x) => x.putts_eff)),
      make_pct: 100 * g.filter((x) => x.putts_eff === 1).length / g.length, three_putt_pct: 100 * g.filter((x) => x.putts_eff >= 3).length / g.length });
  }
  return out;
}

// ------------------------------------------------------------------ clubs
export const sampleLabel = (n) => (n < T.min_shots_club_stats ? 'insufficient' : n < T.min_shots_club_reliable ? 'low' : 'reliable');
export function referenceFull(shots, clubs) {
  const ref = {};
  for (const [cid, g] of groupBy(shots.filter((s) => s.full_swing), (s) => s.club_id)) ref[cid] = quantile(g.map((s) => s.dist_m), 0.8);
  for (const c of clubs || []) {
    const t = c.target_total_m ?? (c.target_carry_m !== null && c.target_carry_m !== undefined ? c.target_carry_m * 1.05 : null);
    if (isNum(t)) ref[c.club_id] = t;
  }
  return ref;
}
export function stockShots(shots, clubs) {
  const ref = referenceFull(shots, clubs);
  return shots.filter((s) => s.full_swing).map((s) => {
    const r = ref[s.club_id] ?? null;
    const intent = s.category === 'approach' && s.start_to_pin !== null && r !== null && s.start_to_pin < 0.8 * r;
    return { ...s, ref_full_m: r, partial_by_intent: intent, partial: !intent && r !== null && s.dist_m < T.partial_shot_ratio * r };
  });
}
export function clubTable(shots, clubs) {
  const st = stockShots(shots, clubs), cmap = new Map(clubs.map((c) => [c.club_id, c]));
  const rows = [];
  for (const [cid, all] of [...groupBy(shots.filter((s) => s.club_id), (s) => s.club_id)].sort((a, b) => a[0].localeCompare(b[0]))) {
    const g = st.filter((s) => s.club_id === cid), stock = g.filter((s) => !s.partial && !s.partial_by_intent), d = stock.map((s) => s.dist_m);
    const info = cmap.get(cid) || {}, uncon = g.filter((s) => !s.partial_by_intent);
    const row = { club_id: cid, club: all[0].club, category: info.category ?? null, cat_rank: info.cat_rank ?? 9,
      shots_all: all.length, shots_full: g.length, shots_stock: stock.length,
      partial_pct: uncon.length ? 100 * uncon.filter((s) => s.partial).length / uncon.length : null,
      partial_by_intent: g.filter((s) => s.partial_by_intent).length,
      tee_shots: all.filter((s) => s.category === 'tee').length, approach_shots: all.filter((s) => s.category === 'approach').length,
      recovery_shots: all.filter((s) => s.category === 'recovery').length, around_green_shots: all.filter((s) => s.category === 'around_green').length,
      target_carry_m: info.target_carry_m ?? null, target_total_m: info.target_total_m ?? null, sample: sampleLabel(stock.length) };
    if (d.length) {
      const lat = stock.map((s) => s.lateral_m).filter(isNum), ls = stock.map((s) => s.long_short_m).filter(isNum);
      Object.assign(row, { mean_m: mean(d), median_m: median(d), sd_m: std(d), min_m: Math.min(...d), max_m: Math.max(...d),
        p10_m: quantile(d, 0.1), p25_m: quantile(d, 0.25), p75_m: quantile(d, 0.75), p90_m: quantile(d, 0.9),
        iqr_m: quantile(d, 0.75) - quantile(d, 0.25), cv_pct: mean(d) ? 100 * (std(d) ?? NaN) / mean(d) : null,
        lateral_sd_m: lat.length >= T.min_shots_dispersion ? std(lat) : null,
        short_miss_pct: ls.length >= 5 ? 100 * ls.filter((x) => x < -10).length / ls.length : null,
        long_miss_pct: ls.length >= 5 ? 100 * ls.filter((x) => x > 10).length / ls.length : null,
        vs_target_total_m: isNum(row.target_total_m) ? median(d) - row.target_total_m : null });
      if (!isNum(row.cv_pct)) row.cv_pct = null;
    } else Object.assign(row, { median_m: null });
    rows.push(row);
  }
  rows.sort((a, b) => a.cat_rank - b.cat_rank || (b.median_m ?? -1) - (a.median_m ?? -1));
  const ok = rows.filter((r) => r.category !== 'putter' && r.sample !== 'insufficient'), medCv = median(ok.map((r) => r.cv_pct));
  rows.forEach((r) => { r.inconsistent = medCv !== null && r.category !== 'putter' && r.sample !== 'insufficient' && r.cv_pct > 1.5 * medCv; });
  return rows;
}
export function gapping(table, bigGap = 25) {
  const t = table.filter((r) => r.category !== 'putter' && r.median_m !== null && r.sample !== 'insufficient').sort((a, b) => b.median_m - a.median_m);
  const out = [];
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1], gap = a.median_m - b.median_m;
    const ov = Math.max(0, Math.min(a.p75_m, b.p75_m) - Math.max(a.p25_m, b.p25_m)), span = Math.min(a.iqr_m, b.iqr_m) || null;
    out.push({ longer: a.club, shorter: b.club, gap_m: gap, iqr_overlap_m: ov, overlap_pct: span ? 100 * ov / span : null,
      flag: gap > bigGap ? 'large gap' : ((span && ov / span > 0.5) || gap < 5) ? 'overlap' : '' });
  }
  return out;
}
export function distanceTrend(shots, clubs, clubId) {
  const s = stockShots(shots, clubs).filter((x) => x.club_id === clubId && !x.partial && !x.partial_by_intent && x.date);
  return [...groupBy(s, (x) => `${x.date.slice(0, 4)}-Q${Math.floor((+x.date.slice(5, 7) - 1) / 3) + 1}`)].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, g]) => ({ period, shots: g.length, median_m: median(g.map((x) => x.dist_m)) }));
}
export function attentionRanking(table) {
  const t = table.filter((r) => r.category !== 'putter' && r.sample !== 'insufficient').map((r) => ({ ...r }));
  const z = (col) => {
    const v = t.map((r) => r[col]), ok = v.filter(isNum), m = mean(ok), s = std(ok);
    return v.map((x) => (ok.length > 2 && s > 0 && isNum(x) ? (x - m) / s : 0));
  };
  const a = z('cv_pct'), b = z('partial_pct'), c = z('lateral_sd_m');
  t.forEach((r, i) => { r.score = a[i] + b[i] + 0.5 * c[i]; });
  return t.sort((x, y) => y.score - x.score);
}

// ------------------------------------------------------------------ dispersion
const CHI2 = { 0.5: 1.3863, 0.9: 4.6052 };
export function pattern(shots, mode) {
  return shots.filter((s) => !s.excluded && s.lateral_m !== null && (mode === 'approach' ? s.long_short_m !== null : s.category === 'tee'))
    .map((s) => ({ ...s, x: s.lateral_m, y: mode === 'approach' ? s.long_short_m : Math.sqrt(Math.max(s.dist_m ** 2 - s.lateral_m ** 2, 0)) }));
}
export function dispersionStats(pts) {
  const n = pts.length, out = { n, enough: n >= T.min_shots_dispersion, enough_90: n >= T.min_shots_dispersion_90 };
  if (!out.enough) return out;
  const x = pts.map((p) => p.x), y = pts.map((p) => p.y), cx = mean(x), cy = mean(y);
  const sxx = sum(x.map((v) => (v - cx) ** 2)) / (n - 1), syy = sum(y.map((v) => (v - cy) ** 2)) / (n - 1), sxy = sum(x.map((v, i) => (v - cx) * (y[i] - cy))) / (n - 1);
  const det = Math.max(sxx * syy - sxy * sxy, 0), r = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  Object.assign(out, { mean_lateral_m: cx, sd_lateral_m: Math.sqrt(sxx), mean_y_m: cy, sd_y_m: Math.sqrt(syy),
    pct_right: 100 * x.filter((v) => v > 0).length / n, pct_left: 100 * x.filter((v) => v < 0).length / n,
    r50_m: quantile(r, 0.5), area50_m2: Math.PI * CHI2[0.5] * Math.sqrt(det), cov: [sxx, sxy, syy], centre: [cx, cy] });
  if (out.enough_90) { out.r90_m = quantile(r, 0.9); out.area90_m2 = Math.PI * CHI2[0.9] * Math.sqrt(det); }
  return out;
}
export function ellipse(centre, cov, p, nPts = 72) {
  const [a, b, c] = cov, tr = a + c, d = Math.sqrt(Math.max((a - c) ** 2 / 4 + b * b, 0));
  const l1 = Math.max(tr / 2 + d, 0), l2 = Math.max(tr / 2 - d, 0), th = 0.5 * Math.atan2(2 * b, a - c), k = Math.sqrt(CHI2[p]);
  const xs = [], ys = [];
  for (let i = 0; i <= nPts; i++) {
    const t = 2 * Math.PI * i / nPts, u = Math.sqrt(l1) * Math.cos(t) * k, v = Math.sqrt(l2) * Math.sin(t) * k;
    xs.push(centre[0] + u * Math.cos(th) - v * Math.sin(th)); ys.push(centre[1] + u * Math.sin(th) + v * Math.cos(th));
  }
  return [xs, ys];
}

// ------------------------------------------------------------------ strokes gained
const LIE_GROUP = { Tee: 'tee', Fairway: 'fairway', Fringe: 'fairway', Rough: 'rough', Sand: 'sand', Recovery: 'recovery', Green: 'green' };
const CAT_MAP = { tee: 'Off the tee', approach: 'Approach', recovery: 'Approach', around_green: 'Around the green', putt: 'Putting', unknown: 'Approach' };
export const SG_CATS = ['Off the tee', 'Approach', 'Around the green', 'Putting'];
export class Baseline {
  constructor(rows, name) {
    this.name = name; this.tables = {};
    const conv = { yd: M_PER_YD, ft: M_PER_FT, m: 1 };
    for (const [lie, g] of groupBy(rows, (r) => r.lie)) {
      const pts = g.map((r) => [Number(r.distance) * conv[r.unit], Number(r.expected)]).sort((a, b) => a[0] - b[0]);
      this.tables[lie] = pts;
    }
  }
  static fromCsv(text, name) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')); const hdr = lines.shift().split(',');
    return new Baseline(lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [hdr[i].trim(), v.trim()]))), name);
  }
  expected(lie, d) {
    if (!isNum(d)) return null; if (d <= 0.05 && lie === 'green') return 0;
    const t = this.tables[lie] || this.tables.rough;
    if (d <= t[0][0]) return t[0][1]; if (d >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 0; i < t.length - 1; i++) if (d <= t[i + 1][0]) { const [x0, y0] = t[i], [x1, y1] = t[i + 1]; return y0 + (y1 - y0) * (d - x0) / (x1 - x0); }
    return null;
  }
}
function sgStates(ds) {
  const holes = ds.holes.filter((h) => h.chain_complete && !h.excluded);
  if (!holes.length) return [];
  const byHole = groupBy(ds.shots, (s) => holeKey(s.round_id, s.hole)), rows = [];
  for (const hole of holes) {
    const g = [...(byHole.get(holeKey(hole.round_id, hole.hole)) || [])].sort((a, b) => a.shot_order - b.shot_order);
    const swings = g.filter((s) => !['putt', 'penalty'].includes(s.category));
    const penFor = {}; let lastKey = null;
    for (const s of g) { if (s.category === 'penalty') { if (lastKey) penFor[lastKey] = (penFor[lastKey] || 0) + 1; } else if (s.category !== 'putt') lastKey = s.shot_key; }
    const placed = sum(Object.values(penFor)), totalPen = hole.penalties_eff !== null ? hole.penalties_eff : g.filter((s) => s.category === 'penalty').length;
    const unplaced = Math.max(totalPen - placed, 0), putts = hole.putts_eff;
    let remaining = swings.length + placed + putts;
    swings.forEach((sw, i) => {
      let lie = LIE_GROUP[sw.start_lie] || null, flag = lie ? 'garmin lie' : 'assumed rough';
      if (i === 0 && !lie && sw.category === 'tee') { lie = 'tee'; flag = 'inferred tee'; }
      const pen = penFor[sw.shot_key] || 0;
      rows.push({ round_id: hole.round_id, hole: hole.hole, date: sw.date, shot_key: sw.shot_key, club: sw.club, kind: 'swing',
        category: CAT_MAP[sw.category] || 'Approach', lie: lie || 'rough', lie_flag: flag, dist_m: sw.start_to_pin, remaining, pen, dist_flag: 'measured (GPS)' });
      remaining -= 1 + pen;
    });
    if (putts > 0) rows.push({ round_id: hole.round_id, hole: hole.hole, date: hole.date, shot_key: null, club: 'Putter', kind: 'green', category: 'Putting',
      lie: 'green', dist_m: hole.first_putt_eff_m, remaining: putts, pen: 0, dist_flag: hole.first_putt_source || 'missing' });
    rows.push({ round_id: hole.round_id, hole: hole.hole, date: hole.date, kind: 'holed', category: null, lie: 'holed', dist_m: 0, remaining: 0, pen: 0, dist_flag: '', unplaced_pen: unplaced });
  }
  return rows;
}
const DB = { tee: [0, 150, 200, 250, 300, 350, 400, 450, 500, 700], fairway: [0, 25, 50, 75, 100, 125, 150, 175, 200, 250, 600],
  rough: [0, 25, 50, 75, 100, 125, 150, 175, 200, 250, 600], sand: [0, 15, 30, 60, 100, 600], recovery: [0, 100, 200, 600], green: [0, 1, 2, 3, 5, 8, 12, 20, 60] };
const band = (lie, d) => { const e = DB[lie] || DB.rough; let i = 0; d = Math.round(d * 1000) / 1000; while (i < e.length && e[i] <= d) i++; return Math.max(0, Math.min(i - 1, e.length - 2)); };
export function personalModel(ref) {
  const r = ref.filter((x) => x.kind !== 'holed' && isNum(x.dist_m) && isNum(x.E_tour) && x.dist_flag !== 'missing')
    .map((x) => ({ ...x, resid: x.remaining - x.E_tour, band: band(x.lie, x.dist_m) }));
  const model = new Map(), gm = r.length ? mean(r.map((x) => x.resid)) : 0, K = 10;
  for (const [lie, g] of groupBy(r, (x) => x.lie)) {
    const lm = (sum(g.map((x) => x.resid)) + K * gm) / (g.length + K); model.set(`${lie}|`, lm);
    for (const [b, gb] of groupBy(g, (x) => x.band)) model.set(`${lie}|${b}`, (sum(gb.map((x) => x.resid)) + K * lm) / (gb.length + K));
  }
  model.set('|', gm); return model;
}
const personalExpected = (m, lie, d, et) => (!isNum(d) || !isNum(et) ? null : et + (m.get(`${lie}|${band(lie, d)}`) ?? m.get(`${lie}|`) ?? m.get('|') ?? 0));
export function strokesGained(ds, tour, baseline = 'personal', personalFrom = null) {
  const st = sgStates(ds), n = ds.holes.length, nc = ds.holes.filter((h) => h.chain_complete).length;
  const coverage = { holes: n, complete_holes: nc, coverage: n ? nc / n : 0 };
  if (!st.length) return { states: st, byRound: [], coverage, name: String(baseline) };
  st.forEach((x) => { x.E_tour = x.kind === 'holed' ? 0 : tour.expected(x.lie, x.dist_m); });
  let name;
  if (baseline instanceof Baseline) { st.forEach((x) => { x.E = x.kind === 'holed' ? 0 : baseline.expected(x.lie, x.dist_m); }); name = baseline.name; }
  else if (baseline === 'personal') {
    const ref = personalFrom ? sgStates(personalFrom) : st.map((x) => ({ ...x }));
    ref.forEach((x) => { x.E_tour = x.kind === 'holed' ? 0 : tour.expected(x.lie, x.dist_m); });
    const m = personalModel(ref); st.forEach((x) => { x.E = x.kind === 'holed' ? 0 : personalExpected(m, x.lie, x.dist_m, x.E_tour); }); name = 'personal';
  } else { st.forEach((x) => { x.E = x.E_tour; }); name = 'pga_tour_broadie'; }
  for (const g of groupBy(st, (x) => holeKey(x.round_id, x.hole)).values()) g.forEach((x, i) => {
    const nx = g[i + 1];
    x.sg = x.kind === 'holed' || !nx || !isNum(x.E) || !isNum(nx.E) ? null : x.E - nx.E - (x.kind === 'green' ? x.remaining : 1 + x.pen);
    x.putt_dist_estimated = x.kind === 'green' && String(x.dist_flag).startsWith('estimated');
  });
  const comp = {}; ds.holes.filter((h) => h.chain_complete).forEach((h) => { comp[h.round_id] = (comp[h.round_id] || 0) + 1; });
  const rmap = new Map(ds.rounds.map((r) => [r.round_id, r])), byRound = [];
  for (const [rid, g] of groupBy(st, (x) => x.round_id)) {
    if (!g.some((x) => x.kind !== 'holed' && isNum(x.sg))) continue;
    const row = { round_id: rid, complete_holes: comp[rid] || 0, date: rmap.get(rid)?.date, label: rmap.get(rid)?.label, start: rmap.get(rid)?.start_time_local || '' };
    for (const c of SG_CATS) row[c] = sumOrNull(g.filter((x) => x.kind !== 'holed' && x.category === c).map((x) => x.sg));
    row.unattributed = -sum(g.filter((x) => x.kind === 'holed').map((x) => x.unplaced_pen));
    row.total = sumOrNull([...SG_CATS.map((c) => row[c]), row.unattributed]);
    const k = row.complete_holes ? 18 / row.complete_holes : null;
    for (const c of [...SG_CATS, 'unattributed', 'total']) row[`${c}_per18`] = isNum(row[c]) && k ? row[c] * k : null;
    byRound.push(row);
  }
  byRound.sort((a, b) => a.start.localeCompare(b.start));
  return { states: st, byRound, coverage, name };
}
export function sgSummary(res) {
  return [...SG_CATS, 'unattributed', 'total'].map((c) => ({ category: c, sg_per_round: mean(res.byRound.map((r) => r[`${c}_per18`])) }));
}

// ------------------------------------------------------------------ coaching
const MIN_ROUNDS = 8;
function bestQuartile(v, hib) {
  v = vals(v); if (v.length < 4) return null;
  const cut = quantile(v, hib ? 0.75 : 0.25); return mean(v.filter((x) => (hib ? x >= cut : x <= cut)));
}
function consistencyText(v, target, hib) {
  v = vals(v); if (!v.length || target === null) return 'unknown';
  const share = v.filter((x) => (hib ? x < target : x > target)).length / v.length, p = `${Math.round(share * 100)}%`;
  return share >= 0.6 ? `consistent - worse than target in ${p} of rounds` : `variable - worse than target in ${p} of rounds (driven by bad days)`;
}
const conf = (n) => (n >= 20 ? 'high' : n >= 10 ? 'medium' : 'low');
const f1 = (v, d = 1) => (isNum(v) ? v.toFixed(d) : '–');
const sgn = (v) => (isNum(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : '–');
export function findings(ds, unit = 'm') {
  const DU = (m, d = 0) => (isNum(m) ? `${(m / unitFactor(unit)).toFixed(d)} ${unit}` : '–');
  const PUT = unit === 'yd' ? 'ft' : 'm', DP = (m) => (isNum(m) ? `${(m / unitFactor(PUT)).toFixed(0)} ${PUT}` : '–');
  const r = ds.rounds.filter((x) => x.format === '18').sort((a, b) => (a.start_time_local || '').localeCompare(b.start_time_local || ''));
  const ids = new Set(r.map((x) => x.round_id)), h = ds.holes.filter((x) => ids.has(x.round_id)), s = ds.shots.filter((x) => ids.has(x.round_id));
  const out = []; if (r.length < MIN_ROUNDS) return out; const n = r.length;
  // penalties
  const pen = r.map((x) => x.penalties);
  if (count(pen) >= MIN_ROUNDS) {
    const cur = mean(pen), tgt = bestQuartile(pen, false), tee = s.filter((x) => x.category === 'tee');
    const ev = [`${f1(cur)} penalty strokes/round over ${count(pen)} rounds (best-quartile rounds: ${f1(tgt)})`,
      `${Math.round(100 * vals(pen).filter((x) => x > 0).length / count(pen))}% of rounds contain at least one penalty`];
    const pc = [...groupBy(s.filter((x) => x.ends_in_penalty && x.club_id), (x) => x.club)].map(([k, g]) => [k, g.length]).sort((a, b) => b[1] - a[1]);
    if (tee.length) {
      ev.push(`${Math.round(100 * tee.filter((x) => x.ends_in_penalty).length / tee.length)}% of tracked tee shots ended in a penalty`);
      if (pc.length) ev.push('Shots ending in penalty by club: ' + pc.slice(0, 3).map(([k, v]) => `${k} (${v})`).join(', '));
    }
    const tc = pc.length ? pc[0][0] : 'the club causing most penalties';
    out.push({ key: 'penalties', title: 'Penalty strokes', strokes_per_round: cur - tgt, current: cur, target: tgt, unit: '/round', evidence: ev,
      why: 'Each penalty is a full stroke lost with no chance of recovery.',
      focus: `Course-management and start-line work with ${tc}: pick a target that takes the penalty side out of play; rehearse a 'safe' shot shape on the range.`,
      target_text: `Average <= ${f1(tgt)} penalty strokes/round over the next 10 rounds`, tracking: 'Penalties / round (rolling 10) on Overview',
      consistency: consistencyText(pen, tgt, false), confidence: conf(n), extra: {} });
  }
  // three-putts
  const tp = r.map((x) => (x.putts_holes === x.holes_played ? x.three_putts : null));
  if (count(tp) >= MIN_ROUNDS) {
    const cur = mean(tp), tgt = bestQuartile(tp, false), gir = h.filter((x) => x.gir_eff === 1);
    const ev = [`${f1(cur)} three-putts/round (best-quartile rounds: ${f1(tgt)})`, gir.length ? `Putts per GIR: ${f1(mean(gir.map((x) => x.putts_eff)), 2)}` : 'No GIR holes with putts'];
    const est = h.filter((x) => x.first_putt_eff_m !== null && x.putts_eff >= 3);
    if (est.length >= 5) ev.push(`Median first-putt distance on 3-putt holes: ${DP(median(est.map((x) => x.first_putt_eff_m)))} (${est.every((x) => x.first_putt_source === 'user') ? 'entered' : 'partly GPS-estimated'})`);
    out.push({ key: 'three_putts', title: 'Three-putts (lag putting)', strokes_per_round: cur - tgt, current: cur, target: tgt, unit: '/round', evidence: ev,
      why: 'A three-putt costs a stroke versus a two-putt, and is usually a lag-distance problem rather than holing out.',
      focus: `Lag drills from ${DP(10).split(' ')[0]}-${DP(20)}: ladder drill to a ${DP(1)} circle; finish every session with 3 x 10 balls from ${DP(1).split(' ')[0]}-${DP(1.5)}.`,
      target_text: `<= ${f1(tgt)} three-putts/round (rolling 10)`, tracking: '3-putt % and 3-putts/round on Putting page',
      consistency: consistencyText(tp, tgt, false), confidence: conf(n), extra: {} });
  }
  // fairways
  let c = contrast(h, 'fw_hit', (x) => x.par >= 4); const fw = r.map((x) => x.fw_pct);
  if (c.n_yes >= 15 && c.n_no >= 15 && count(fw) >= MIN_ROUNDS && c.delta > 0) {
    const cur = mean(fw), tgt = bestQuartile(fw, true);
    const per = mean([...groupBy(h, (x) => x.round_id).values()].map((g) => g.filter((x) => x.fw_hit !== null).length));
    const d = driving(h, s);
    const side = d.miss_right_pct > d.miss_left_pct * 1.5 ? 'right' : d.miss_left_pct > d.miss_right_pct * 1.5 ? 'left' : null;
    out.push({ key: 'fairways', title: 'Driving accuracy', strokes_per_round: (tgt - cur) / 100 * per * c.delta, current: cur, target: tgt, unit: '%',
      evidence: [`Fairways ${f1(cur, 0)}% (best-quartile rounds: ${f1(tgt, 0)}%)`,
        `On par 4/5s you average ${sgn(c.to_par_yes)} to par after hitting the fairway vs ${sgn(c.to_par_no)} after missing (${f1(c.delta, 2)} strokes per miss, n=${c.n_yes}/${c.n_no})`,
        `Misses: ${f1(d.miss_left_pct, 0)}% left, ${f1(d.miss_right_pct, 0)}% right`],
      why: 'Your own scores show missing the fairway costs you strokes on the hole.',
      focus: 'Driver start-line and face control: alignment-stick gate drill, ' + (side ? `with a specific fix for the ${side} miss (dominant in your data).` : 'both-way misses suggest face-to-path consistency rather than aim.'),
      target_text: `Fairways >= ${f1(tgt, 0)}% (rolling 10)`, tracking: 'Fairways % on Stats → Tee', consistency: consistencyText(fw, tgt, true), confidence: conf(n), extra: {} });
  }
  // GIR
  c = contrast(h, 'gir_eff'); const gir = r.map((x) => x.gir_pct);
  if (c.n_yes >= 15 && c.n_no >= 15 && count(gir) >= MIN_ROUNDS) {
    const cur = mean(gir), tgt = bestQuartile(gir, true);
    const ev = [`GIR ${f1(cur, 0)}% (best-quartile rounds: ${f1(tgt, 0)}%)`,
      `You average ${sgn(c.to_par_yes)} to par on GIR holes vs ${sgn(c.to_par_no)} when missing (${f1(c.delta, 2)} per missed green; includes short-game effect)`];
    const sel = approachByBand(s, unit).filter((b) => b.shots >= 8 && b.band_lo_m >= 68 && b.band_lo_m < 183);
    if (sel.length) ev.push('Greens hit by approach distance: ' + sel.map((b) => `${b.band} ${f1(b.green_hit_pct, 0)}% (n=${b.shots})`).join(', '));
    const miss = greenMissDirections(s); let focus = 'Approach play';
    if (miss.length && sum(miss.map((m) => m.count)) >= 10) {
      const top = [...miss].sort((a, b) => b.count - a.count)[0]; const dir = top.direction.toLowerCase();
      ev.push(`Missed greens are most often ${dir} (${f1(top.pct, 0)}% of misses)`);
      focus = ['Short', 'Long'].includes(top.direction)
        ? `Distance control: your dominant green miss is ${dir}. Practise to known stock distances (use your GPS medians on Stats → Bag, not book numbers) and club up/down accordingly.`
        : `Direction control: your dominant green miss is ${dir}. Work on start line with irons (gate drill) and aim away from the ${dir} side of greens.`;
    }
    out.push({ key: 'gir', title: 'Greens in regulation / approach', strokes_per_round: (tgt - cur) / 100 * 18 * c.delta, current: cur, target: tgt, unit: '%', evidence: ev,
      why: 'Missing greens forces an up-and-down; your own data shows what that costs.', focus, target_text: `GIR >= ${f1(tgt, 0)}% (rolling 10)`,
      tracking: 'GIR % on Stats → Approach', consistency: consistencyText(gir, tgt, true), confidence: conf(n), extra: { note: 'upper bound - overlaps with short game' } });
  }
  // scrambling
  const mh = h.filter((x) => x.gir_eff === 0);
  if (mh.length >= 30) {
    const pr = [...groupBy(mh, (x) => x.round_id).values()].map((g) => 100 * g.filter((x) => x.to_par <= 0).length / g.length);
    const cur = mean(pr), tgt = bestQuartile(pr, true), per = mean([...groupBy(mh, (x) => x.round_id).values()].map((g) => g.length));
    const ev = [`Scrambling (par or better after missing the green): ${f1(cur, 0)}% (best-quartile rounds: ${f1(tgt, 0)}%)`,
      `${f1(per)} missed greens/round; ${Math.round(100 * mh.filter((x) => x.to_par >= 2).length / mh.length)}% of them end in double bogey or worse`];
    const ag = s.filter((x) => x.category === 'around_green');
    if (ag.length >= 10) ev.push(`Tracked around-the-green shots ending on the green: ${f1(pct(ag.map((x) => x.on_green_end)), 0)}%`);
    out.push({ key: 'scrambling', title: 'Short game (scrambling)', strokes_per_round: (tgt - cur) / 100 * per, current: cur, target: tgt, unit: '%', evidence: ev,
      why: 'Converting more missed greens into pars directly removes bogeys.',
      focus: `Up-and-down games from mixed lies within ${DU(25)}: 9 balls, score par/bogey, chip to a ${DP(2)} circle then hole out.`,
      target_text: `Scrambling >= ${f1(tgt, 0)}% (rolling 10)`, tracking: 'Scrambling on Stats → Short game', consistency: consistencyText(pr, tgt, true), confidence: conf(pr.length), extra: {} });
  }
  // blow-ups
  const bl = [...groupBy(h, (x) => x.round_id).values()].map((g) => sum(g.map((x) => Math.max(0, x.to_par - 2))));
  if (bl.length >= MIN_ROUNDS) {
    const cur = mean(bl), tgt = bestQuartile(bl, false), b = h.filter((x) => x.blowup === 1);
    const ev = [`${f1(cur)} strokes/round beyond double bogey (best-quartile rounds: ${f1(tgt)})`, `${f1(b.length / n)} triple-bogey-or-worse holes per round`];
    if (b.length) ev.push(`${Math.round(100 * b.filter((x) => (x.penalties_eff || 0) > 0).length / b.length)}% of blow-ups include a penalty; by par: ` +
      [...groupBy(b, (x) => x.par)].sort((a, c2) => a[0] - c2[0]).map(([k, g]) => `par ${k}: ${g.length}`).join(', '));
    out.push({ key: 'blowups', title: 'Blow-up holes', strokes_per_round: cur - tgt, current: cur, target: tgt, unit: '/round', evidence: ev,
      why: 'Big numbers wreck both gross and Stableford; avoiding them is usually decision-making, not swing change.',
      focus: 'Damage-limitation rules: after trouble take the widest route back to the fairway; aim for bogey-avoid-double on hard holes.',
      target_text: `<= ${f1(tgt)} strokes beyond double per round (rolling 10)`, tracking: 'Blow-ups on Scoring page',
      consistency: consistencyText(bl, tgt, false), confidence: conf(n), extra: { note: 'overlaps with penalties' } });
  }
  return out.sort((a, b) => (isNum(b.strokes_per_round) ? b.strokes_per_round : -9) - (isNum(a.strokes_per_round) ? a.strokes_per_round : -9));
}
export function clubAttention(ds, top = 3, unit = 'm') {
  const DU = (m) => (isNum(m) ? (m / unitFactor(unit)).toFixed(0) : '–');
  const t = clubTable(ds.shots, ds.clubs); if (!t.length) return [];
  const medCv = median(t.filter((r) => r.sample !== 'insufficient').map((r) => r.cv_pct));
  return attentionRanking(t).slice(0, top).map((r) => ({ club: r.club, score: r.score, evidence: [
    `Stock distance median ${DU(r.median_m)} ${unit}, IQR ${DU(r.p25_m)}-${DU(r.p75_m)} ${unit} (n=${r.shots_stock}, ${r.sample})`,
    `Distance variability (CV) ${f1(r.cv_pct)}% vs bag median ${f1(medCv)}%`, `Partial/mishit rate ${f1(r.partial_pct, 0)}% of full-swing attempts`,
    ...(isNum(r.lateral_sd_m) ? [`Lateral spread SD ${DU(r.lateral_sd_m)} ${unit}`] : [])] }));
}
