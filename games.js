// Guided practice games: step generators, scoring, tiers and pressure finishes. Pure logic, no DOM, so Node can test it.
import * as B from './bench.js';

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
// input: 'hit_miss' (1 or 0) or 'strokes' (1–6). open: true means the game ends on the first miss (streak).
export const MINUTES = { 'putt-par18': 10, 'putt-369': 6, 'putt-lag': 6, 'putt-streak': 5, 'chip-updown': 12, 'chip-par18': 12, 'chip-zone': 8, 'range-fairways': 15, 'range-greens': 12, 'range-wedge': 10, 'range-round': 20 };
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
    case 'range-round': return n(18, (i) => hm(i % 2 ? `Hole ${(i + 1) >> 1} approach` : `Hole ${(i >> 1) + 1} tee shot`, 'Would it have worked?'));
    default: return null;
  }
}
export const isOpen = (id) => id === 'putt-streak';

// ------------------------------------------------------------------ scoring
// answers: array of 0/1 (hit_miss) or strokes. Returns { score, done, last, hits }.
export function scoreOf(game, list, answers) {
  const a = answers || [], total = list ? list.length : a.length;
  if (isOpen(game.id)) { const miss = a.indexOf(0); return { score: miss < 0 ? a.length : miss, done: miss >= 0 || a.length >= total, last: a[a.length - 1] }; }
  const strokes = list?.[0]?.input === 'strokes', score = a.reduce((t, x) => t + (Number.isFinite(x) ? x : 0), 0);
  return { score, done: a.length >= total, last: a[a.length - 1], hits: strokes ? null : score };
}
// The last step is "the pressure shot": holing/hitting it counts double (a bonus point); missing it costs a point; for stroke games a
// bogey-or-worse on it adds a stroke. The saved score is the plain score, so it still compares with the handicap benchmark.
export function pressureOf(game, list, answers) {
  const a = answers || [], last = a[a.length - 1]; if (!a.length) return null;
  if (isOpen(game.id)) return { hit: a.length > 0 && a.indexOf(0) < 0, delta: 0, label: 'Streak finish' };
  const stroke = list?.[0]?.input === 'strokes', par = list?.[a.length - 1]?.par ?? 2;
  if (stroke) { const ok = last <= par; return { hit: ok, delta: ok ? 0 : 1, label: ok ? 'Pressure hole at par or better' : 'Pressure hole over par: +1 stroke' }; }
  const ok = last === 1; return { hit: ok, delta: ok ? 1 : -1, label: ok ? 'Pressure shot hit: bonus point' : 'Pressure shot missed: −1 point' };
}
export const pressureScore = (game, list, answers) => {
  const s = scoreOf(game, list, answers).score, p = pressureOf(game, list, answers);
  return p ? Math.max(0, s + p.delta) : s;
};

// ------------------------------------------------------------------ tiers: Bronze, Silver, Gold, Platinum = what a 20, 10, 5 and 0 handicapper scores
export const TIERS = [{ key: 'bronze', name: 'Bronze', h: 20 }, { key: 'silver', name: 'Silver', h: 10 }, { key: 'gold', name: 'Gold', h: 5 }, { key: 'platinum', name: 'Platinum', h: 0 }];
export function tierScores(game, unitM = YD) {
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
export function tierFor(game, score, unitM = YD) {
  const ts = tierScores(game, unitM); if (!ts || !Number.isFinite(score)) return null;
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
// best score per game from the results list
export function bestScore(game, results) {
  const s = results.filter((r) => r.game === game.id && Number.isFinite(r.score)).map((r) => r.score);
  return s.length ? (game.better === 'lower' ? Math.min(...s) : Math.max(...s)) : null;
}
// tier badges for CO.badges: one per game, earned on the date the tier was first reached
export function tierBadges(games, results, unitM = YD) {
  const out = [];
  for (const g of games) {
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
export function newDraft(game, { seed = Date.now() % 2147483647, unitM = YD, pressure = false, session_id = null, ghost = null } = {}) {
  const list = steps(game, { seed, unitM }); if (!list) return null;
  return { game: game.id, seed, pressure: !!pressure, answers: [], started: new Date().toISOString(), unitM, session_id, ghost };
}
export function resultFromDraft(draft, game, { date, id } = {}) {
  const list = steps(game, { seed: draft.seed, unitM: draft.unitM }), sc = scoreOf(game, list, draft.answers), pr = draft.pressure ? pressureOf(game, list, draft.answers) : null;
  const detail = draft.answers.slice(0, isOpen(game.id) ? draft.answers.length : list.length);
  return { id: id || `r${Date.now()}`, game: game.id, date: date || new Date().toISOString().slice(0, 10), score: sc.score, note: '', mode: 'guided', detail, seed: draft.seed,
    ...(draft.pressure ? { pressure: true, pressure_hit: !!pr?.hit } : {}), ...(draft.session_id ? { session_id: draft.session_id } : {}) };
}
