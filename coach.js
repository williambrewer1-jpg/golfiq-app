// Progress engine: handicap forecast, scoring milestones, practice-game roadmaps, streaks, badges and the weekly goal.
// Pure functions (no DOM), unit-tested in tests/coach.test.mjs.
import * as A from './analytics.js';
import * as B from './bench.js';
import * as F from './features.js';
const { isNum, mean, median, std } = A;
const DAY = 86400000;
const dt = (s) => Date.parse(`${String(s).slice(0, 10)}T12:00:00`);

// small seeded random generator, so a forecast doesn't change each time the page draws
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => { const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// Theil–Sen slope (median of pairwise slopes): a trend that one freak round can't swing
export function theilSen(xs, ys) {
  const s = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) s.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  const slope = s.length ? median(s) : 0, icpt = median(ys.map((y, i) => y - slope * xs[i]));
  return { slope, icpt };
}

// ------------------------------------------------------------------ 1. handicap in 6 months
// Simulates your next 6 months of rounds: same pace as the last 6 months, score differentials around your current
// level drifting with your recent trend (halved, and capped – trends rarely continue at full speed), with your
// round-to-round spread. The WHS index (best 8 of the last 20) is worked out at the end of each simulated season.
// "If you fix your top priorities" lowers the average differential by half the strokes those priorities cost, phased in.
// "Potential" is the headline: your current index minus the earned gain from potentialPlan() (a small base, momentum for
// working on two focus areas, and strokes unlocked by hitting practice-game targets), phased in over four months.
// It starts at your current index and never rises above it. The shaded range is the normal spread of a WHS index.
export const POTENTIAL = {
  base: 0.5,                         // always applies
  momentum2: 0.5, momentum3: 0.25,   // two active focus areas; a third active skill adds a little more
  transfer: 0.5, transfer_confirmed: 1.0,   // share of a sub-skill's strokes value credited before / after the course confirms it
  hits_needed: 3, hit_days: 60, active_days: 14, active_games: 2,
  pressure_hit: 1.5,                 // a pressure-finish hit counts this many hits
  confirm_rounds: 5, stall_rounds: 8,
  unlocked_cap: 3.0, total_cap: 4.0, pct_cap: 0.30,
};
export function forecast(rounds, { months = 6, savings = 0, gain = POTENTIAL.base, now = Date.now(), sims = 500 } = {}) {
  const d = rounds.filter((r) => isNum(r.differential_for_index) && r.date).map((r) => ({ t: dt(r.date), v: r.differential_for_index })).sort((a, b) => a.t - b.t);
  if (d.length < 8) return { ok: false, need: 8 - d.length };
  const win = d.filter((x) => x.t >= now - 365 * DAY).slice(-40), use = win.length >= 8 ? win : d.slice(-20);
  const xs = use.map((x) => (x.t - now) / DAY), ys = use.map((x) => x.v), ts = theilSen(xs, ys);
  const slope = Math.max(-0.6 / 30, Math.min(0.4 / 30, ts.slope * 0.5));      // per day, halved and capped
  const level = ts.icpt;                                                        // trend line value today
  const sd = Math.max(2, std(ys.map((y, i) => y - (ts.icpt + ts.slope * xs[i]))) || 2);
  const recent = d.filter((x) => x.t >= now - 182 * DAY).length, perMonth = Math.max(1, recent / 6), n = Math.max(1, Math.round(perMonth * months));
  const horizon = months * 30.4, hist = d.map((x) => x.v), current = A.whsIndex(hist.slice(-20));
  const run = (save, trend = slope, rampDays = horizon) => {
    const r = rng(1234 + Math.round(save * 100)), out = [], path = Array.from({ length: months + 1 }, () => []);
    for (let s = 0; s < sims; s++) {
      const fut = [];
      for (let k = 1; k <= n; k++) { const t = horizon * k / n, mu = level + trend * t - save * Math.min(1, t / rampDays); fut.push({ t, v: Math.round((mu + sd * gauss(r)) * 10) / 10 }); }
      for (let m = 0; m <= months; m++) path[m].push(A.whsIndex([...hist, ...fut.filter((x) => x.t <= m * 30.4 + 1e-6).map((x) => x.v)].slice(-20)));
      out.push(A.whsIndex([...hist, ...fut.map((x) => x.v)].slice(-20)));
    }
    const q = (a, p) => A.quantile(a.filter(isNum), p);
    return { likely: q(out, 0.5), low: q(out, 0.1), high: q(out, 0.9), path: path.map((p, i) => ({ month: i, likely: q(p, 0.5), low: q(p, 0.1), high: q(p, 0.9) })) };
  };
  const base = run(0), fix = savings > 0.2 ? run(savings * 0.5) : null;
  // Potential: the earned gain comes straight off your index, phased in over four months. No extra trend is added:
  // potential = current index - gain. It starts at your current index and never rises above it.
  const potSave = Math.max(0, gain || 0), start = isNum(current) ? current : base.path[0].likely, ramp = horizon * 2 / 3;
  const potPath = base.path.map((p) => { const t = p.month * 30.4, mid = start - potSave * Math.min(1, t / ramp), f = Math.min(1, t / horizon);
    const lo = (p.likely - p.low) * f, hi = (p.high - p.likely) * f;
    return { month: p.month, likely: Math.round(mid * 10) / 10, low: Math.round((mid - lo) * 10) / 10, high: Math.round(Math.min(start, mid + hi) * 10) / 10 }; });
  const potEnd = potPath[potPath.length - 1];
  return { ok: true, current, ...base, optimistic: fix?.likely ?? null, optimistic_path: fix?.path || null,
    potential: potEnd.likely, potential_low: potEnd.low, potential_path: potPath, potential_save: potSave, rounds_ahead: n, per_month: perMonth, trend_per_month: slope * 30.4, sd, level, months };
}

// ------------------------------------------------------------------ 2. milestones
export const SCORE_MILESTONES = [100, 90, 80, 70];
// Chance of breaking each score in one round, from your recent 18-hole gross scores (trend-adjusted level, real spread).
export function milestones(rounds, { now = Date.now(), shift = 0 } = {}) {
  const r18 = rounds.filter((r) => r.format === '18' && isNum(r.gross) && r.date).sort((a, b) => dt(a.date) - dt(b.date));
  const firsts = Object.fromEntries(SCORE_MILESTONES.map((m) => [m, r18.find((r) => r.gross < m) || null]));
  const recent = r18.slice(-20);
  let mu = null, sd = null;
  if (recent.length >= 5) {
    const xs = recent.map((r) => (dt(r.date) - now) / DAY), ys = recent.map((r) => r.gross), ts = recent.length >= 8 ? theilSen(xs, ys) : { icpt: mean(ys), slope: 0 };
    mu = ts.icpt + shift; sd = Math.max(2.5, std(ys));
  }
  const rows = SCORE_MILESTONES.map((m) => {
    const p = mu === null ? null : F.normCdf((m - 0.5 - mu) / sd);       // gross m-1 or better
    return { score: m, label: `Break ${m}`, first: firsts[m] ? { date: firsts[m].date, gross: firsts[m].gross, course: firsts[m].course_name } : null,
      p_round: p, p_next10: p === null ? null : 1 - (1 - p) ** 10, rounds_expected: p && p > 0.002 ? 1 / p : null };
  });
  const next = rows.find((x) => !x.first) || null;
  const pts = rounds.filter((r) => r.format === '18' && isNum(r.stableford_round));
  const stab = [36, 40].map((t) => ({ label: `${t}+ Stableford`, target: t, first: pts.filter((r) => r.stableford_round >= t).sort((a, b) => dt(a.date) - dt(b.date))[0] || null, best: pts.length ? Math.max(...pts.map((r) => r.stableford_round)) : null }));
  return { rows, next, level: mu, sd, n: recent.length, stableford: stab };
}

// ------------------------------------------------------------------ 3/4. practice-game roadmaps
// Each rung is the score that golfers of that standard typically post in the game (bench.js, Shot Scope data).
// Typical standard: breaking 100 regularly ≈ 24 handicap, 90 ≈ 14, 80 ≈ 5.
export const RUNGS = [['Break 100', 24], ['Break 90', 14], ['Break 80', 5], ['Scratch', 0]];
export const SHORT_GAMES = ['putt-369', 'putt-lag', 'putt-par18', 'putt-streak', 'chip-updown', 'chip-par18'];
export const LONG_GAMES = ['range-greens', 'range-wedge', 'combine', 'range-course'];
// Range round: per-18-hole score over par typical of each standard (break 90 ≈ +17 etc.)
const rrRung = (h) => h + 3;
function rangeRoundLevel(perHoleOver) {           // handicap that typically scores this over par per 18 holes
  const over18 = perHoleOver * 18; return Math.max(0, Math.min(30, over18 - 3));
}
const holesOf = (res) => res.holes || Number((/(\d+) holes/.exec(res.note || '') || [])[1]) || 18;
// hcp: your current index – for a game you haven't played yet, the next rung is the first standard better than yours
export function roadmap(gameIds, results, games, unitM = 0.9144, hcp = null) {
  return gameIds.map((id) => {
    const g = games.find((x) => x.id === id); if (!g) return null;
    const rs = results.filter((r) => r.game === id && isNum(r.score)).sort((a, b) => a.date.localeCompare(b.date));
    const last5 = rs.slice(-5);
    let level = null, current = null, rungs;
    if (id === 'range-course') {
      const per = last5.map((r) => (isNum(r.to_par) ? r.to_par / holesOf(r) : null)).filter(isNum);
      current = per.length ? mean(per) * 18 : null; level = current === null ? null : rangeRoundLevel(current / 18);
      rungs = RUNGS.map(([label, h]) => ({ label, h, target: rrRung(h), reached: level !== null && level <= h, unit: 'over par / 18' }));
    } else {
      if (!B.hasLevel(id)) return null;
      current = last5.length ? mean(last5.map((r) => r.score)) : null;
      const l = current === null ? null : B.level(id, current, g.better, unitM); level = l ? l.h : null;
      rungs = RUNGS.map(([label, h]) => ({ label, h, target: B.expectedFor(id, h, unitM), reached: level !== null && level <= h + 1e-9 }));
    }
    const next = level === null && isNum(hcp) ? (rungs.find((r) => r.h < hcp) || null) : (rungs.find((r) => !r.reached) || null);
    return { id, name: g.name, cat: g.cat, better: id === 'range-course' ? 'lower' : g.better, unit: g.unit, n: rs.length, current, level, rungs, next };
  }).filter(Boolean);
}

// ------------------------------------------------------------------ 5. streaks, badges, weekly goal
// Practice days: any game score, practice-log session or wedge-matrix entry.
export function practiceDates(journal) {
  return [...new Set([...(journal.results || []), ...(journal.sessions || []), ...(journal.wedge?.entries || [])].map((x) => String(x.date || '').slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
}
export function streaks(dates, now = new Date()) {
  const wk = (d) => B.isoWeek(new Date(`${d}T12:00:00`)), weeks = new Set(dates.map(wk));
  const back = (n) => { const d = new Date(now.getTime() - n * 7 * DAY); return B.isoWeek(d); };
  let cur = 0, i = weeks.has(back(0)) ? 0 : 1;                        // this week still counts as "open"
  while (weeks.has(back(i))) { cur++; i++; }
  const all = [...weeks].sort(); let best = 0, run = 0, prev = null;
  for (const w of all) { const [y, n] = w.split('-W').map(Number), idx = y * 53 + n; run = prev !== null && idx === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = idx; }
  const strip = Array.from({ length: 12 }, (_, k) => { const w = back(11 - k); return { week: w, days: dates.filter((d) => wk(d) === w).length }; });
  return { current: cur, best: Math.max(best, cur), thisWeek: weeks.has(back(0)), strip };
}
export function badges({ rounds, holes, journal, roadmaps }) {
  const r18 = rounds.filter((r) => r.format === '18').sort((a, b) => dt(a.date) - dt(b.date)), res = journal.results || [];
  const first = (arr, f) => { const x = arr.find(f); return x ? x.date : null; };
  const hs = [...holes].filter((h) => isNum(h.to_par)).sort((a, b) => dt(a.date) - dt(b.date));
  const st = streaks(practiceDates(journal)), scores = [...res].sort((a, b) => a.date.localeCompare(b.date));
  const lvlScratch = (roadmaps || []).find((g) => g.level !== null && g.level <= 0);
  const B_ = (id, name, desc, earned, progress = null) => ({ id, name, desc, earned, progress });
  return [
    B_('b100', 'Broke 100', 'An 18-hole gross score of 99 or better', first(r18, (r) => r.gross < 100)),
    B_('b90', 'Broke 90', '89 or better', first(r18, (r) => r.gross < 90)),
    B_('b80', 'Broke 80', '79 or better', first(r18, (r) => r.gross < 80)),
    B_('b70', 'Broke 70', '69 or better', first(r18, (r) => r.gross < 70)),
    B_('s36', 'Played to handicap', '36+ Stableford points', first(r18, (r) => r.stableford_round >= 36)),
    B_('s40', 'Cut-maker', '40+ Stableford points', first(r18, (r) => r.stableford_round >= 40)),
    B_('bird', 'First birdie', 'One under par on a hole', first(hs, (h) => h.to_par === -1)),
    B_('eagle', 'Eagle', 'Two under par on a hole', first(hs, (h) => h.to_par <= -2)),
    B_('no3p', 'Lag master', 'A full round with no 3-putts', first(r18, (r) => r.three_putts === 0 && isNum(r.putts_round))),
    B_('nopen', 'Clean card', 'A full round with no penalties', first(r18, (r) => r.penalties === 0)),
    B_('r25', 'Regular', '25 rounds tracked', rounds.length >= 25 ? [...rounds].sort((a, b) => dt(a.date) - dt(b.date))[24].date : null, `${Math.min(rounds.length, 25)}/25`),
    B_('p1', 'First practice score', 'Recorded a practice game', scores[0]?.date || null),
    B_('p25', 'Grinder', '25 practice scores', scores.length >= 25 ? scores[24].date : null, `${Math.min(scores.length, 25)}/25`),
    B_('w4', 'Four-week habit', 'Practised four weeks in a row', st.best >= 4 ? 'yes' : null, `${Math.min(st.best, 4)}/4 weeks`),
    B_('w12', 'Twelve-week habit', 'Practised twelve weeks in a row', st.best >= 12 ? 'yes' : null, `${Math.min(st.best, 12)}/12 weeks`),
    B_('c50', 'Combine 50', '50+ points in the monthly combine', first(scores, (r) => r.game === 'combine' && r.score >= 50)),
    B_('c70', 'Combine 70', '70+ points in the monthly combine', first(scores, (r) => r.game === 'combine' && r.score >= 70)),
    B_('rr', 'Range round', 'Finished a range round', first(scores, (r) => r.game === 'range-course')),
    B_('scr', 'Tour-level practice', 'A game where your recent level is scratch', lvlScratch ? 'yes' : null, lvlScratch ? lvlScratch.name : null),
  ];
}
// The finding (where you lose most strokes) decides which game this week's goal uses.
export const GOAL_GAME = { three_putts: 'putt-lag', scrambling: 'chip-updown', gir: 'range-greens', fairways: 'range-fairways', penalties: 'range-fairways', blowups: 'chip-par18' };
export function weeklyGoal({ findings, roadmaps, results, games, week = B.isoWeek(), assigned = [] }) {
  const inWeek = (r) => B.isoWeek(new Date(`${r.date}T12:00:00`)) === week;
  const make = (gameId, target, perWeek, why, from) => {
    const g = games.find((x) => x.id === gameId); if (!g) return null;
    const mine = results.filter((r) => r.game === gameId && inWeek(r) && isNum(r.score)), lower = g.better === 'lower';
    const best = mine.length ? (lower ? Math.min(...mine.map((r) => r.score)) : Math.max(...mine.map((r) => r.score))) : null;
    const hit = best !== null && isNum(target) && (lower ? best <= target : best >= target);
    return { game: gameId, name: g.name, target, per_week: perWeek, attempts: mine.length, best, hit, done: hit && mine.length >= perWeek, why, from, better: g.better, unit: g.unit };
  };
  const out = [];
  for (const a of assigned) { const x = make(a.game, a.target, a.per_week || 2, a.why || 'From your coach', 'coach'); if (x) out.push(x); }
  if (!out.length) {
    const f = (findings || [])[0], gid = (f && GOAL_GAME[f.key]) || 'putt-369', rm = (roadmaps || []).find((r) => r.id === gid);
    const g = games.find((x) => x.id === gid), hist = results.filter((r) => r.game === gid && isNum(r.score)).map((r) => r.score);
    const target = rm?.next ? rm.next.target : hist.length ? (g.better === 'lower' ? Math.min(...hist) : Math.max(...hist)) : null;
    const x = make(gid, isNum(target) ? (g.better === 'lower' ? Math.floor(target * 10) / 10 : Math.ceil(target * 10) / 10) : null, 3,
      f ? `Your biggest leak: ${f.title} (~${f.strokes_per_round.toFixed(1)} strokes a round)` : 'A good all-round habit', 'auto');
    if (x) out.push(x);
  }
  return out;
}
// Coach assignments ("assign" in coach notes) from notes dated in the last 7 days
export function assignments(notes, now = Date.now()) {
  return (notes || []).filter((n) => Array.isArray(n.assign) && n.assign.length && now - dt(n.date) <= 7 * DAY)
    .flatMap((n) => n.assign.map((a) => ({ ...a, why: `${n.title} (${n.date})` })));
}

// ------------------------------------------------------------------ level up: genuine improvement vs a better golfer
// Your stats against what a golfer `step` shots better typically does (Shot Scope data via Golf Monthly:
// scratch / 10 / 20 handicap), the strokes each gap is worth, and the practice game + target score that trains it.
export const STANDARDS = {
  gir: [59, 32, 14],          // greens in regulation %
  updown: [54, 39, 31],       // up-and-down % (missed greens saved)
  three: [3, 7, 13],          // three-putt % of holes
  fw: [50, 48, 45],           // fairways %
};
export const STANDARD_SOURCE = ['Scratch vs 10 vs 20 handicap (Shot Scope / Golf Monthly)', 'https://www.golfmonthly.com/features/scratch-vs-10-vs-20-handicap-how-the-stats-compare'];
export const standard = (key, h) => { const v = STANDARDS[key], x = Math.max(0, Math.min(36, h));
  return x <= 10 ? v[0] + (v[1] - v[0]) * x / 10 : v[1] + (v[2] - v[1]) * (x - 10) / 10; };

// ------------------------------------------------------------------ earned potential
// gain = base + momentum + unlocked, capped. `ratings` is skills.skillRatings(); `results` the practice journal results.
// baselines: { [sub full_key]: strokes value when the first target hit was scored } so a confirmed sub-skill keeps its credit
// after the on-course number has caught up (its current strokes value is then zero).
const hitScore = (r, g) => isNum(r.score) && isNum(g.target) && (g.better === 'lower' ? r.score <= g.target : r.score >= g.target);
export function potentialPlan({ ratings, results = [], rounds = [], now = Date.now(), baselines = {}, index = null } = {}) {
  const P = POTENTIAL, empty = { base: P.base, momentum: 0, active: [], unlocked: 0, locked: 0, gain: P.base, ledger: [], focus: [], capped: false };
  if (!ratings?.skills) return empty;
  const gid = (r) => r.game ?? r.game_id, res = results.filter((r) => isNum(r.score) && r.date);
  const since = (days) => now - days * DAY;
  // active skills: two scored games (or one guided session) in the skill's games within the last 14 days
  const active = ratings.skills.filter((s) => s.rated).filter((s) => {
    const ids = new Set(s.subs.flatMap((x) => x.games.map((g) => g.id))), mine = res.filter((r) => ids.has(gid(r)) && dt(r.date) >= since(P.active_days));
    return mine.length >= P.active_games || mine.some((r) => r.mode === 'guided' || r.challenge);
  }).map((s) => s.key);
  const focus = ratings.focus || [], focusActive = focus.filter((k) => active.includes(k)).length;
  const momentum = focusActive >= 2 ? P.momentum2 + (active.length >= 3 ? P.momentum3 : 0) : 0;
  const ledger = [];
  for (const sk of ratings.skills.filter((s) => focus.includes(s.key))) for (const sub of sk.subs) {
    const games = sub.games.filter((g) => isNum(g.target)); if (!games.length || !sub.enough) continue;
    const base = Math.max(sub.strokes || 0, baselines[sub.full_key] || 0); if (base <= 0) continue;
    const mine = res.filter((r) => dt(r.date) >= since(P.hit_days)).map((r) => ({ r, g: games.find((g) => g.id === gid(r)) })).filter((x) => x.g && hitScore(x.r, x.g));
    const hits = mine.reduce((t, x) => t + (x.r.pressure && x.r.pressure_hit !== false ? P.pressure_hit : 1), 0), progress = Math.min(1, hits / P.hits_needed);
    const first = res.filter((r) => games.some((g) => g.id === gid(r) && hitScore(r, g))).map((r) => r.date).sort()[0] || null;
    const after = first ? rounds.filter((r) => r.format === '18' && String(r.date) > String(first)).length : 0;
    const onCourse = isNum(sub.you) && isNum(sub.target_value) && (sub.higher ? sub.you >= sub.target_value : sub.you <= sub.target_value);
    const confirmed = progress > 0 && after >= P.confirm_rounds && onCourse;
    const stalled = !confirmed && progress >= 1 && after >= P.stall_rounds;
    const transfer = confirmed ? P.transfer_confirmed : P.transfer, max_credit = base * P.transfer_confirmed, credit = base * transfer * progress;
    const g0 = games[0], step = base * P.transfer / P.hits_needed, left = Math.max(1, Math.ceil(P.hits_needed - hits));
    const next = hits < P.hits_needed ? `Score ${g0.target}${g0.better === 'lower' ? ' or less' : '+'} in ${g0.name}${left > 1 ? ` ${left} more times` : ' once more'} → −${(Math.round(step * 10) / 10).toFixed(1)}`
      : stalled ? 'Not showing up on the course yet – try the on-course challenge' : confirmed ? 'Showing up on the course ✓' : 'Keep it up: play a few rounds so the course can confirm it';
    ledger.push({ sub: sub.full_key, skill: sk.key, title: sub.title, base_strokes: base, game: g0.id, game_name: g0.name, hits, need: P.hits_needed, credit, max_credit, confirmed, stalled, next, step: hits < P.hits_needed ? step : 0 });
  }
  ledger.sort((a, b) => b.step - a.step || b.max_credit - a.max_credit);
  const sum = ledger.reduce((t, x) => t + x.credit, 0), room = ledger.reduce((t, x) => t + x.max_credit, 0);
  const unlocked = Math.min(P.unlocked_cap, sum), locked = Math.max(0, Math.min(P.unlocked_cap, room * P.transfer) - unlocked);
  const raw = P.base + momentum + unlocked, cap = Math.min(P.total_cap, isNum(index) ? P.pct_cap * Math.max(0, index) : P.total_cap);
  const gain = Math.max(0, Math.min(raw, cap));
  return { base: P.base, momentum, active, unlocked, locked, gain, ledger, focus, capped: gain < raw - 1e-9 };
}
