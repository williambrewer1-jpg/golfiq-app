// Boss games (retention plan section 7): the test at the end of each stretch of the road to scratch ("Beat the 10").
// Pure logic: which games, the milestone score for each, the pass rule, the one-attempt-a-day rule and the stored record. The runner is in guided.js.
// Practice level, not handicap: nothing here says the golfer "is" a 10.
import { milestoneScore, stretchTitle } from './journey.js';
import { minutesFor } from './games.js';

export const BOSS_GAMES = ['putt-369', 'putt-lag', 'chip-updown', 'range-greens', 'range-driver'];   // played back to back, in this order
export const PASS_NEEDED = 4;                                                                        // milestone-level scores needed, out of the five games
export const ATTEMPTS_PER_DAY = 1;
export const BOSS_MINUTES = Math.round(BOSS_GAMES.reduce((t, id) => t + minutesFor(id), 0) / 5) * 5;   // the games' own time estimates, to the nearest 5

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const hit = (score, target, better) => isNum(score) && isNum(target) && (better === 'lower' ? score <= target : score >= target);

// Where the golfer stands in one attempt. `scores` is { gameId: score } for the games finished so far.
export function tally(n, scores = {}, { games = [], unitM = 0.9144 } = {}) {
  const rows = BOSS_GAMES.map((id) => {
    const g = games.find((x) => x.id === id), better = g?.better || 'higher', target = milestoneScore(id, n, unitM), score = isNum(scores[id]) ? scores[id] : null;
    const state = score === null ? 'todo' : hit(score, target, better) ? 'hit' : 'short', gap = state === 'short' ? Math.round(Math.abs(score - target) * 10) / 10 : 0;
    return { id, name: g?.name || id, better, target, score, state, short: gap };
  });
  const hits = rows.filter((r) => r.state === 'hit').length, played = rows.filter((r) => r.state !== 'todo').length, left = rows.length - played;
  return { rows, hits, played, left, need: PASS_NEEDED, passed: hits >= PASS_NEEDED, over: left === 0, possible: hits + left >= PASS_NEEDED };
}

// one attempt a day for each boss; a boss that is already passed is not played again
export function canAttempt(bosses = [], n, today) {
  const mine = (bosses || []).filter((b) => b && b.n === n);
  if (mine.some((b) => b.passed)) return { ok: false, reason: 'passed' };
  if (mine.filter((b) => b.date === today).length >= ATTEMPTS_PER_DAY) return { ok: false, reason: 'today' };
  return { ok: true, reason: null };
}

// The record to store when an attempt ends (finished or quit). A quit attempt counts only if at least one game was finished; otherwise null.
export function record({ id, n, date, results = [], scores = {}, games = [], unitM = 0.9144 }) {
  if (!results.length) return null;
  const t = tally(n, scores, { games, unitM });
  return { id, n, date, passed: t.passed, results: [...results], scores: { ...scores } };
}

export const title = stretchTitle;
export const shareFields = (n, passed) => ({ boss: n, ...(passed ? { boss_passed: true } : {}) });
