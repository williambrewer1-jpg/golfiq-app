// Weekly league and ghost play for the friends group. Pure logic over the score documents the group already shares.
import * as G from './games.js';
import { isoWeek } from './bench.js';

// ------------------------------------------------------------------ what gets posted with a score
// Only scores, tiers and per-step results go up (never rounds, shots or locations). A score document is limited to 20 fields by the Firestore rules.
export const MAX_FIELDS = 20;
export function shareExtras(res, { hit = null, tier = null } = {}) {
  const o = {};
  if (typeof hit === 'boolean') o.hit = hit;
  if (tier) o.tier = tier;
  if (res.mode === 'guided' && Array.isArray(res.detail)) { o.mode = 'guided'; o.detail = res.detail.slice(0, 40); if (Number.isFinite(res.seed)) o.seed = res.seed; }
  if (res.pressure) o.pressure = true;
  return o;
}

// ------------------------------------------------------------------ weekly league
// 3 points for beating your own target, 1 for playing, +1 for a pressure finish. The first 10 scores of the week count.
export const LEAGUE = { play: 1, hit: 3, pressure: 1, cap: 10 };
export const points = (s) => (s.hit === true ? LEAGUE.hit : LEAGUE.play) + (s.pressure === true ? LEAGUE.pressure : 0);
export function league(scores) {
  const by = new Map();
  scores.forEach((s, i) => { if (!s.uid) return; if (!by.has(s.uid)) by.set(s.uid, []); by.get(s.uid).push({ ...s, _i: i }); });
  const rows = [...by].map(([uid, list]) => {
    const used = list.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a._i - b._i).slice(0, LEAGUE.cap);
    return { uid, nick: used[used.length - 1].nick || 'Golfer', points: used.reduce((t, s) => t + points(s), 0), plays: used.length, hits: used.filter((s) => s.hit === true).length, pressure: used.filter((s) => s.pressure === true).length };
  });
  rows.sort((a, b) => b.points - a.points || b.hits - a.hits || a.nick.localeCompare(b.nick));
  let rank = 0;
  rows.forEach((r, i) => { rank = i > 0 && r.points === rows[i - 1].points && r.hits === rows[i - 1].hits ? rank : i + 1; r.rank = rank; });
  return rows;
}
export const winners = (rows) => rows.filter((r) => r.rank === 1 && r.points > 0);
// the ISO week before a given one ("2026-W46" → "2026-W45")
export function prevWeek(week) {
  const [y, w] = week.split('-W').map(Number), jan4 = new Date(y, 0, 4, 12), mon1 = new Date(jan4.getTime() - ((jan4.getDay() || 7) - 1) * 864e5), thu = new Date(mon1.getTime() + ((w - 1) * 7 + 3) * 864e5);
  return isoWeek(new Date(thu.getTime() - 7 * 864e5));
}

// ------------------------------------------------------------------ ghost: play the same steps as a friend's score this week
export function ghostsFor(scores, game, myUid, limit = 3) {
  const lower = game.better === 'lower', best = new Map();
  for (const s of scores) {
    if (s.game !== game.id || s.uid === myUid || s.mode !== 'guided' || !Array.isArray(s.detail) || !s.detail.length || !Number.isFinite(s.seed)) continue;
    const cur = best.get(s.uid);
    if (!cur || (lower ? s.score < cur.score : s.score > cur.score)) best.set(s.uid, s);
  }
  return [...best.values()].sort((a, b) => (lower ? a.score - b.score : b.score - a.score)).slice(0, limit).map((s) => ({ uid: s.uid, nick: s.nick || 'Golfer', score: s.score, detail: s.detail, seed: s.seed }));
}
// the score after k steps from a list of answers
export function partial(game, detail, k) {
  const a = (detail || []).slice(0, k);
  if (G.isDistance(game)) return G.distanceScore(game, a);               // Driver test: the average so far; Max out: the longest so far
  if (G.isOpen(game.id)) { const m = a.indexOf(0); return m < 0 ? a.length : m; }
  return a.reduce((t, x) => t + (Number.isFinite(x) ? x : 0), 0);
}
// ahead, behind or level after k steps (for strokes, fewer is ahead)
export function compareAt(game, mine, ghost, k) {
  const me = partial(game, mine, k), gh = partial(game, ghost, k), lower = game.better === 'lower', diff = lower ? gh - me : me - gh;
  return { me, ghost: gh, diff, state: diff > 0 ? 'ahead' : diff < 0 ? 'behind' : 'level' };
}
export function finalCompare(game, myScore, ghostScore) {
  const lower = game.better === 'lower', diff = lower ? ghostScore - myScore : myScore - ghostScore;
  return { diff, state: diff > 0 ? 'won' : diff < 0 ? 'lost' : 'tied' };
}
