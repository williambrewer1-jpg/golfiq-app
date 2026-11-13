// Monthly skills test: five guided games in a fixed order, rated per skill. Pure logic so Node can test it.
import * as B from './bench.js';
import { minutesFor } from './games.js';

export const TEST_GAMES = ['putt-369', 'putt-lag', 'chip-updown', 'range-wedge', 'range-greens', 'range-driver'];
export const TEST_MINUTES = Math.round(TEST_GAMES.reduce((t, id) => t + minutesFor(id), 0) / 5) * 5;       // the games' own time estimates added up, to the nearest 5
export const TEST_SKILLS = { putting: ['putt-369', 'putt-lag'], short: ['chip-updown'], approach: ['range-wedge', 'range-greens'], driving: ['range-driver'] };
export const SKILL_TITLES = { putting: 'Putting', short: 'Short game', approach: 'Approach', driving: 'Driving' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const monthOf = (date) => String(date).slice(0, 7);

// practice handicap per skill from one test: the average handicap level of its games.
export function rate(scores, games, unitM = 0.9144) {
  const per_game = {};
  for (const id of TEST_GAMES) {
    const sc = scores[id]; if (!isNum(sc)) continue;
    const g = (games || []).find((x) => x.id === id), l = B.level(id, sc, g?.better || 'higher', unitM);
    per_game[id] = { score: sc, h: l ? l.h : null, label: l ? l.label : '' };
  }
  const ratings = {};
  for (const [skill, ids] of Object.entries(TEST_SKILLS)) { const hs = ids.map((id) => per_game[id]?.h).filter(isNum); ratings[skill] = hs.length === ids.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null; }
  return { ratings, per_game };
}
// this test against the one before it: change > 0 means better (a lower handicap)
export function compare(cur, prev) {
  return Object.keys(SKILL_TITLES).map((k) => {
    const now = cur?.ratings?.[k] ?? null, before = prev?.ratings?.[k] ?? null;
    return { key: k, title: SKILL_TITLES[k], now, before, change: isNum(now) && isNum(before) ? before - now : null };
  });
}
export const lastTest = (tests, beforeId = null) => {
  const sorted = [...(tests || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  const i = beforeId ? sorted.findIndex((t) => t.id === beforeId) : sorted.length;
  return i > 0 ? sorted[i - 1] : null;
};
// reminder on Home: the first week of the month, until this month's test is done
export function due(tests, today) {
  const day = Number(String(today).slice(8, 10)), done = (tests || []).some((t) => monthOf(t.date) === monthOf(today));
  return { show: !done && day <= 7, done, available: !done };
}
// radar values: outside is better, so plot (36 - handicap); null skills are left out
export const radarValue = (h) => (isNum(h) ? Math.max(0, 36 - h) : null);
