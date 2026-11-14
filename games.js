// Guided practice games: step generators, scoring, tiers and pressure finishes. Pure logic, no DOM, so Node can test it.
import * as B from './bench.js';
const { DRIVER_TEST } = B;

// ------------------------------------------------------------------ seeded random (the same seed gives the same game)
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (arr, r) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
const YD = 0.9144, isYd = (u) => Math.abs(u - YD) < 0.01;
const dist = (yd, unitM) => (isYd(unitM) ? Math.round(yd) : Math.round(yd * YD / 5) * 5);        // a yard distance shown in the golfer's unit
const unitName = (unitM) => (isYd(unitM) ? 'yd' : 'm');
const LIES = ['Tight lie', 'Rough', 'Downhill lie', 'Uphill lie', 'Fringe', 'Bunker side', 'Short-sided', 'Long carry to the flag', 'Sidehill lie'];
const CLUBS_HINT = 'Pick a new target and club each ball.';

// ------------------------------------------------------------------ the games: minutes, input and steps
// input: 'hit_miss' (1 or 0), 'strokes' (1–6) or 'distance' (a distance plus, for the Driver test, where the ball finished). open: true means the game ends on the first miss (streak).
export const MINUTES = { 'putt-par18': 10, 'putt-369': 6, 'putt-lag': 6, 'putt-streak': 5, 'chip-updown': 12, 'chip-par18': 12, 'chip-zone': 8, 'range-fairways': 15, 'range-greens': 12, 'range-wedge': 10, 'range-round': 20, 'range-driver': 10, 'range-speed': 5 };
export const GUIDED = new Set(Object.keys(MINUTES));
export const minutesFor = (id) => MINUTES[id] || 10;
const P18 = [3, 5, 8, 12, 16, 20, 25, 32, 40];

// steps(game, {seed, unitM}) → [{prompt, sub, input}]
export function steps(game, { seed = 1, unitM = YD } = {}) {
  const r = rng(seed), id = game.id, u = unitName(unitM), n = (k, f) => Array.from({ length: k }, (_, i) => f(i));
  const hm = (prompt, sub) => ({ prompt, sub, input: 'hit_miss' });
  switch (id) {
    case 'putt-par18': return shuffle(P18, r).map((d, i) => ({ prompt: `Hole ${i + 1} of 9`, sub: `${d} ft · hole out`, input: 'strokes', par: 2 }));
    case 'putt-369': return n(9, (i) => { const d = [3, 6, 9][Math.floor(i / 3)]; return hm(`${d} ft`, `Ball ${(i % 3) + 1} of 3 · holed?`); });
    case 'putt-lag': return shuffle([20, 24, 28, 32, 35, 38, 42, 45, 48, 50], r).map((d, i) => hm(`${d} ft`, `Putt ${i + 1} of 10 · finish inside 3 ft?`));
    case 'putt-streak': return n(40, (i) => hm('4 ft', `Putt ${i + 1} · the streak ends on a miss`));
    case 'chip-updown': return shuffle(LIES, r).map((l, i) => hm(l, `Lie ${i + 1} of 9 · up and down?`));
    case 'chip-par18': return shuffle(LIES, r).map((l, i) => ({ prompt: `Hole ${i + 1} of 9`, sub: `${l} · chip and putt out`, input: 'strokes', par: 2 }));
    case 'chip-zone': return n(10, (i) => hm('Land it on the towel', `Chip ${i + 1} of 10 · on the towel?`));
    case 'range-fairways': return n(14, (i) => hm(`Tee shot ${i + 1} of 14`, 'Finished between your two targets?'));
    case 'range-greens': return shuffle([80, 90, 100, 110, 120, 130, 140, 150, 160], r).map((d, i) => hm(`${dist(d, unitM)} ${u}`, `Shot ${i + 1} of 9 · inside ${Math.max(1, Math.round(dist(d, unitM) * 0.1))} ${u}? ${CLUBS_HINT}`));
    case 'range-wedge': return n(10, () => 0).map((_, i) => hm(`${dist(40 + Math.floor(r() * 13) * 5, unitM)} ${u}`, `Shot ${i + 1} of 10 · finish within ${isYd(unitM) ? '5 yd' : '4.5 m'}?`));
    case 'range-driver': return n(DRIVER_TEST.balls, (i) => ({ prompt: `Ball ${i + 1} of ${DRIVER_TEST.balls}`, sub: 'How far did it go, and where did it finish?', input: 'distance', results: true }));
    case 'range-speed': return n(DRIVER_TEST.speed_balls, (i) => ({ prompt: `Ball ${i + 1} of ${DRIVER_TEST.speed_balls}`, sub: 'Swing for maximum distance', input: 'distance', results: false }));
    case 'range-round': return n(18, (i) => hm(i % 2 ? `Hole ${(i + 1) >> 1} approach` : `Hole ${(i >> 1) + 1} tee shot`, 'Would it have worked?'));
    default: return null;
  }
}
export const isOpen = (id) => id === 'putt-streak';

// ------------------------------------------------------------------ distance games (Driver test, Max out)
// A ball is { d: distance in the golfer's unit, r: 'f' fairway | 'm' missed (playable) | 'w' wide, a: range-ball adjustment % used }.
// Its effective distance is what the draft stores as the answer, so scoring, ghosts and undo work like any other game.
export const isDistance = (game) => !!game?.distance;
const r1 = (x) => Math.round(x * 10) / 10;
export const adjusted = (ball) => ball.d * (1 + (ball.a || 0) / 100);
export function ballValue(ball, unitM = YD) {
  const dist = adjusted(ball);
  if (ball.r === 'w') return r1(dist * DRIVER_TEST.wide_factor);
  if (ball.r === 'm') return r1(Math.max(0, dist - DRIVER_TEST.miss_yd * YD / unitM));
  return r1(dist);
}
// Driver test = average effective distance; Max out = the longest ball
export function distanceScore(game, answers) {
  const a = (answers || []).filter(Number.isFinite); if (!a.length) return 0;
  return game.id === 'range-speed' ? r1(Math.max(...a)) : r1(a.reduce((t, x) => t + x, 0) / a.length);
}
export function driverSummary(balls) {
  const b = balls || [], n = (k) => b.filter((x) => x.r === k).length, d = b.map(adjusted);
  return { n: b.length, fairways: n('f'), missed: n('m'), wides: n('w'), avg: d.length ? r1(d.reduce((t, x) => t + x, 0) / d.length) : null, longest: d.length ? r1(Math.max(...d)) : null };
}
export const pressureRule = (game) => (game.id === 'putt-streak' ? 'the last putt ends it' : game.id === 'range-driver' ? 'the last ball has to find the fairway' : game.id === 'range-speed' ? 'the last ball has to match your longest' : 'the last step counts double');
export const pressureBanner = (game) => (game.id === 'range-driver' ? 'Pressure ball: it has to find the fairway' : game.id === 'range-speed' ? 'Pressure ball: match your longest' : 'Pressure shot: it counts double');

// ------------------------------------------------------------------ scoring
// answers: array of 0/1 (hit_miss) or strokes. Returns { score, done, last, hits }.
export function scoreOf(game, list, answers) {
  const a = answers || [], total = list ? list.length : a.length;
  if (isDistance(game)) return { score: distanceScore(game, a), done: a.length >= total, last: a[a.length - 1], hits: null };
  if (isOpen(game.id)) { const miss = a.indexOf(0); return { score: miss < 0 ? a.length : miss, done: miss >= 0 || a.length >= total, last: a[a.length - 1] }; }
  const strokes = list?.[0]?.input === 'strokes', score = a.reduce((t, x) => t + (Number.isFinite(x) ? x : 0), 0);
  return { score, done: a.length >= total, last: a[a.length - 1], hits: strokes ? null : score };
}
// The last step is "the pressure shot": holing/hitting it counts double (a bonus point); missing it costs a point; for stroke games a
// bogey-or-worse on it adds a stroke. The saved score is the plain score, so it still compares with the handicap benchmark.
export function pressureOf(game, list, answers, balls) {
  const a = answers || [], last = a[a.length - 1]; if (!a.length) return null;
  if (isDistance(game)) {            // the saved score stays the plain score; the pressure ball is hit or missed on its own terms
    const ok = game.id === 'range-speed' ? last >= Math.max(...a) : (balls || [])[a.length - 1]?.r === 'f';
    return { hit: !!ok, delta: 0, label: game.id === 'range-speed' ? (ok ? 'Pressure ball matched your longest' : 'Pressure ball fell short of your longest') : (ok ? 'Pressure ball found the fairway' : 'Pressure ball missed the fairway') };
  }
  if (isOpen(game.id)) return { hit: a.length > 0 && a.indexOf(0) < 0, delta: 0, label: 'Streak finish' };
  const stroke = list?.[0]?.input === 'strokes', par = list?.[a.length - 1]?.par ?? 2;
  if (stroke) { const ok = last <= par; return { hit: ok, delta: ok ? 0 : 1, label: ok ? 'Pressure hole at par or better' : 'Pressure hole over par: +1 stroke' }; }
  const ok = last === 1; return { hit: ok, delta: ok ? 1 : -1, label: ok ? 'Pressure shot hit: bonus point' : 'Pressure shot missed: −1 point' };
}
export const pressureScore = (game, list, answers, balls) => {
  const s = scoreOf(game, list, answers).score, p = pressureOf(game, list, answers, balls);
  return p ? Math.max(0, s + p.delta) : s;
};

// ------------------------------------------------------------------ feedback on the game screen
// What one answer means for the screen: good (true), not good (false) or neither (null), and a verdict key. The words themselves live in feel.js COPY.verdict.
const WORDS = { 'putt-369': ['missed', 'holed'], 'putt-streak': ['missed', 'holed'], 'putt-lag': ['missed', 'inside'], 'chip-updown': ['missed', 'saved'], 'chip-zone': ['missed', 'on'], 'range-fairways': ['missed', 'fairway'], 'range-greens': ['outside', 'inside'], 'range-wedge': ['outside', 'inside'], 'range-round': ['missed', 'worked'] };
export const VERDICT_KEYS = ['holed', 'missed', 'inside', 'outside', 'saved', 'on', 'worked', 'fairway', 'wide', 'longest', 'logged', 'birdie', 'par', 'bogey', 'double', 'over'];
export function outcomeOf(game, step, answer, { ball, before } = {}) {
  if (!step || !Number.isFinite(answer)) return { good: null, key: 'logged' };
  if (step.input === 'distance') {
    if (step.results) return ball?.r === 'f' ? { good: true, key: 'fairway' } : ball?.r === 'w' ? { good: false, key: 'wide' } : { good: false, key: 'missed' };
    const prev = (before || []).filter(Number.isFinite);                                   // Max out: a ball that matches or beats your longest so far is "longest"; the first ball is not
    return prev.length && answer >= Math.max(...prev) ? { good: true, key: 'longest' } : { good: null, key: 'logged' };
  }
  if (step.input === 'strokes') { const par = step.par ?? 2; return { good: answer <= par, key: answer <= par - 1 ? 'birdie' : answer === par ? 'par' : answer === par + 1 ? 'bogey' : answer === par + 2 ? 'double' : 'over' }; }
  const w = WORDS[game.id] || ['missed', 'holed']; return answer === 1 ? { good: true, key: w[1] } : { good: false, key: w[0] };
}
// ---- the result headline (phase C)
// A personal best needs a score to beat, so a first play is never one. "Met" and "short" are about the target for the golfer's next handicap step.
export function verdictOf(game, score, { target = null, prevBest = null } = {}) {
  const lower = game.better === 'lower', beats = (a, b) => (lower ? a < b : a > b);
  const pb = Number.isFinite(score) && Number.isFinite(prevBest) && beats(score, prevBest);
  const has = Number.isFinite(score) && Number.isFinite(target), met = has && (lower ? score <= target : score >= target);
  return { key: pb ? 'pb' : met ? 'met' : has ? 'short' : 'done', pb, met, diff: has && !met ? Math.max(0.1, Math.round(Math.abs(target - score) * 10) / 10) : 0 };
}
// which sound the finish makes and whether there is confetti: a new tier beats a personal best, which beats a met target; the rest is a plain finish
export function celebrationOf({ verdict, tierUp = false }) {
  const sound = tierUp ? 'tier' : verdict.pb ? 'pb' : verdict.met ? 'win' : 'finish';
  return { sound, confetti: sound !== 'finish' };
}
export const STREAK_MILESTONES = [3, 5, 10];                                               // good in a row: these get a banner and a sound
export const countsStreak = (game) => game.id !== 'range-speed';                          // Max out has no hit or miss
// how many good answers in a row end the list (worked out from the answers, so undo and reload always agree)
export function streakOf(game, list, answers, balls) {
  if (!countsStreak(game)) return 0;
  const a = answers || []; let n = 0;
  for (let k = a.length - 1; k >= 0; k--) { if (outcomeOf(game, list?.[k], a[k], { ball: (balls || [])[k], before: a.slice(0, k) }).good !== true) break; n++; }
  return n;
}
// true on the answer that takes the running score to the target for the first time (games where more is better, and only if there is a target)
export function targetPassed(game, list, answers, balls, target) {
  if (!Number.isFinite(target) || game.better === 'lower') return false;
  const a = answers || [], k = a.length; if (!k) return false;
  const at = (j) => scoreOf(game, list, a.slice(0, j)).score;
  if (at(k) < target) return false;
  for (let j = 1; j < k; j++) if (at(j) >= target) return false;
  return true;
}

// ------------------------------------------------------------------ tiers: Bronze, Silver, Gold, Platinum = what a 20, 10, 5 and 0 handicapper scores
export const TIERS = [{ key: 'bronze', name: 'Bronze', h: 20 }, { key: 'silver', name: 'Silver', h: 10 }, { key: 'gold', name: 'Gold', h: 5 }, { key: 'platinum', name: 'Platinum', h: 0 }];
export function tierScores(game, unitM = YD, history = null) {
  if (isOwn(game)) return ownTierScores(game, history);
  if (!B.hasLevel(game.id)) return null;
  const lower = game.better === 'lower', whole = game.id !== 'combine';
  let prev = null;
  return TIERS.map((t) => {
    let s = B.expectedFor(game.id, t.h, unitM);
    if (whole) s = lower ? Math.floor(s + 1e-9) : Math.ceil(s - 1e-9);
    if (prev !== null && (lower ? s >= prev : s <= prev)) s = lower ? prev - 1 : prev + 1;          // each tier needs a better score than the one below
    if (game.max && s > game.max) s = game.max;
    prev = s; return { ...t, score: s };
  });
}
export function tierFor(game, score, unitM = YD, history = null) {
  const ts = tierScores(game, unitM, history); if (!ts || !Number.isFinite(score)) return null;
  const lower = game.better === 'lower', met = ts.filter((t) => (lower ? score <= t.score : score >= t.score));
  const cur = met.length ? met[met.length - 1] : null, next = ts[met.length] || null;
  return { tier: cur, next, all: ts };
}
export const TIER_COLOURS = { bronze: '#a56a3a', silver: '#8a97a4', gold: '#c9a227', platinum: '#5b7fa6' };
export function tierUp(game, before, after, unitM = YD) {
  const a = tierFor(game, after, unitM)?.tier; if (!a) return null;
  const b = Number.isFinite(before) ? tierFor(game, before, unitM)?.tier : null;
  const rank = (t) => (t ? TIERS.findIndex((x) => x.key === t.key) : -1);
  return rank(a) > rank(b) ? a : null;
}
// ------------------------------------------------------------------ own-history tiers
// Max out and the simple Range round have no published benchmark by handicap, so their three tiers come from the golfer's own scores:
// Bronze = at least your median, Silver = your best quarter, Gold = a new personal best. A score is judged against the scores BEFORE it, so the bar
// rises as you improve and Gold is always a real record. Nothing is rated until there are OWN.min_scores earlier scores. No Platinum for these games.
export const OWN = { min_scores: 3, quarter: 0.25, tiers: [{ key: 'bronze', name: 'Bronze', note: 'your median score' }, { key: 'silver', name: 'Silver', note: 'your best quarter' }, { key: 'gold', name: 'Gold', note: 'a new personal best' }] };
export const isOwn = (game) => !!game && GUIDED.has(game.id) && !B.hasLevel(game.id);
const scoresOf = (game, results) => (results || []).filter((r) => r.game === game.id && Number.isFinite(r.score)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
export const scoresBefore = (game, results, id) => { const rs = scoresOf(game, results), i = rs.findIndex((r) => r.id === id); return (i < 0 ? rs : rs.slice(0, i)).map((r) => r.score); };
const rankOf = (t) => (t ? TIERS.findIndex((x) => x.key === t.key) : -1);
export function ownTierScores(game, prior) {
  const sc = (prior || []).filter(Number.isFinite); if (sc.length < OWN.min_scores) return null;
  const lower = game.better === 'lower', a = [...sc].sort((x, y) => (lower ? y - x : x - y));                  // worst first, best last
  const at = (p) => { const pos = p * (a.length - 1), i = Math.floor(pos), f = pos - i; return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * f; };
  const step = sc.every(Number.isInteger) ? 1 : 0.1, tidy = (v) => Math.round(v * 100) / 100;
  const harder = (v) => tidy((lower ? Math.floor(v / step + 1e-9) : Math.ceil(v / step - 1e-9)) * step);              // round towards the better side, so the number shown is the number needed
  const dir = lower ? -1 : 1, best = a[a.length - 1], out = [];
  let prev = null;
  for (const [i, v] of [at(0.5), at(1 - OWN.quarter), best + dir * step].entries()) {
    let x = i === 2 ? tidy(v) : harder(v);
    if (prev !== null && (lower ? x >= prev : x <= prev)) x = tidy(prev + dir * step);                              // each tier needs a better score than the one below
    prev = x; out.push({ ...OWN.tiers[i], h: null, score: x });
  }
  return out;
}
// every earlier result with the tier it reached when it was played (oldest first)
export function ownTierHistory(game, results) {
  const rs = scoresOf(game, results);
  return rs.map((r, i) => ({ result: r, tier: tierFor(game, r.score, YD, rs.slice(0, i).map((x) => x.score))?.tier || null }));
}
// the tier this result reached if it is higher than any earlier result reached, else null
export function ownTierUp(game, results, id) {
  const h = ownTierHistory(game, results), i = h.findIndex((x) => x.result.id === id); if (i < 0 || !h[i].tier) return null;
  return rankOf(h[i].tier) > Math.max(-1, ...h.slice(0, i).map((x) => rankOf(x.tier))) ? h[i].tier : null;
}
// what the launcher shows: the ladder to aim at, the tier already held, and the next rung
export function tierState(game, results, unitM = YD) {
  if (isOwn(game)) {
    const all = scoresOf(game, results).map((r) => r.score), ts = ownTierScores(game, all);
    if (!ts) return { ladder: null, tier: null, next: null, own: true, need: OWN.min_scores - all.length };
    const top = ownTierHistory(game, results).reduce((m, h) => (rankOf(h.tier) > rankOf(m) ? h.tier : m), null);
    return { ladder: ts, tier: top, next: ts[rankOf(top) + 1] || null, own: true, need: 0 };
  }
  const ts = tierScores(game, unitM); if (!ts) return { ladder: null, tier: null, next: null, own: false, need: 0 };
  const best = bestScore(game, results), cur = best !== null ? tierFor(game, best, unitM) : null;
  return { ladder: ts, tier: cur?.tier || null, next: cur ? cur.next : null, own: false, need: 0 };
}
// best score per game from the results list
export function bestScore(game, results) {
  const s = results.filter((r) => r.game === game.id && Number.isFinite(r.score)).map((r) => r.score);
  return s.length ? (game.better === 'lower' ? Math.min(...s) : Math.max(...s)) : null;
}
// tier badges for CO.badges: one per game, earned on the date the tier was first reached
export function tierBadges(games, results, unitM = YD) {
  const out = [];
  for (const g of games) {
    if (isOwn(g)) {
      const hist = ownTierHistory(g, results);
      for (const t of OWN.tiers) { const hit = hist.find((x) => rankOf(x.tier) >= rankOf(t)); out.push({ id: `tier-${g.id}-${t.key}`, name: `${t.name} · ${g.name}`, desc: `Reach ${t.note}, judged against your earlier scores`, earned: hit ? hit.result.date : null, tier: t.key, game: g.id }); }
      continue;
    }
    const ts = tierScores(g, unitM); if (!ts) continue;
    const rs = results.filter((r) => r.game === g.id && Number.isFinite(r.score)).sort((a, b) => a.date.localeCompare(b.date));
    for (const t of ts) {
      const hit = rs.find((r) => (g.better === 'lower' ? r.score <= t.score : r.score >= t.score));
      out.push({ id: `tier-${g.id}-${t.key}`, name: `${t.name} · ${g.name}`, desc: `Score ${t.score}${g.better === 'lower' ? ' or fewer' : ' or more'}: what a ${t.h} handicapper scores`, earned: hit ? hit.date : null, tier: t.key, game: g.id });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the draft saved after every step
// adj: the range-ball adjustment (%) from Settings, kept in the draft so a game is scored the same way it was played
// welcome_back / target: a welcome-back game (retention plan 5.2) is played against the golfer's own median, which the draft carries so the screen and the result agree
export function newDraft(game, { seed = Date.now() % 2147483647, unitM = YD, pressure = false, session_id = null, ghost = null, adj = 0, welcome_back = false, target = null, boss = null, duel = null } = {}) {
  const list = steps(game, { seed, unitM }); if (!list) return null;
  return { game: game.id, seed, pressure: !!pressure, answers: [], started: new Date().toISOString(), unitM, session_id, ghost,
    ...(welcome_back ? { welcome_back: true, target: Number.isFinite(target) ? target : null } : {}),
    ...(boss ? { boss, target: Number.isFinite(target) ? target : null } : {}),
    ...(duel ? { duel, target: Number.isFinite(target) ? target : null } : {}),      // a duel (duels.js): the same seed for both players, and the golfer's own target for the margin
    ...(isDistance(game) ? { balls: [], adj: Math.max(0, Math.min(DRIVER_TEST.adj_max, Number(adj) || 0)), premium: false } : {}) };
}
export function resultFromDraft(draft, game, { date, id } = {}) {
  const list = steps(game, { seed: draft.seed, unitM: draft.unitM }), sc = scoreOf(game, list, draft.answers), pr = draft.pressure ? pressureOf(game, list, draft.answers, draft.balls) : null;
  const detail = draft.answers.slice(0, isOpen(game.id) ? draft.answers.length : list.length);
  return { id: id || `r${Date.now()}`, game: game.id, date: date || new Date().toISOString().slice(0, 10), score: sc.score, note: '', mode: 'guided', detail, seed: draft.seed,
    ...(isDistance(game) ? { balls: draft.balls || [], ...(game.id === 'range-driver' ? (() => { const m = driverSummary(draft.balls); return { avg_dist: m.avg, fairways: m.fairways, wides: m.wides }; })() : { longest: driverSummary(draft.balls).longest }) } : {}),
    ...(draft.pressure ? { pressure: true, pressure_hit: !!pr?.hit } : {}), ...(draft.session_id ? { session_id: draft.session_id } : {}), ...(draft.welcome_back ? { welcome_back: true } : {}), ...(draft.boss ? { boss: draft.boss } : {}), ...(draft.duel ? { duel: draft.duel } : {}) };
}
