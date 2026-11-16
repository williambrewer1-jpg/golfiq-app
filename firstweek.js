// BreakingPar first week (first-run plan, part B): five short guided games for a golfer who starts with no rounds, so the Journey and the skills
// have something real to work from. Pure logic: no DOM and no storage, so Node can test it (tests/firstweek.test.mjs).
//
// What is stored: J().first_week = { started_at, steps: [{ n, game, swapped, result_id, date }], done_at, skipped_at }. Everything else (which step
// is next, each step's mark, the practice level) is worked out from that and the results.
//
// Who sees it: `started_at` is written only when the app finds no rounds and no practice results at all, so a golfer who already has data never sees
// the first week. After that it shows until it is finished or skipped. Loading rounds part-way through does not remove it, but rounds loaded before the
// first step is played do (that golfer is not new to BreakingPar's data any more).
import * as B from './bench.js';
import { minutesFor } from './games.js';

// ---- every number below is a default and can be tuned here
export const STEPS = [
  { n: 1, title: 'Holing out', game: 'putt-369', alt: null, skill: 'putting' },
  { n: 2, title: 'Distance control', game: 'putt-lag', alt: null, skill: 'putting' },
  { n: 3, title: 'Around the green', game: 'chip-updown', alt: 'putt-streak', skill: 'short' },
  { n: 4, title: 'Into the green', game: 'range-greens', alt: 'putt-par18', skill: 'approach' },
  { n: 5, title: 'Off the tee', game: 'range-driver', alt: 'putt-369', skill: 'driving' },
];
export const SHORT_MAX_MIN = 15;          // a first-week step takes at most this many minutes (every listed game fits today, so none needs a shorter version)
export const NEW_DAYS = 14;               // how long after the first practice result a golfer with no rounds still counts as new

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const day = (s) => String(s || '').slice(0, 10);
const r1 = (x) => Math.round(x * 10) / 10;

// The app has never seen any data from this golfer: the moment to start a first week.
export const freshStart = ({ journal = {}, rounds = [] } = {}) => !journal.first_week && !rounds.length && !(journal.results || []).length;
export const newFirstWeek = (now = new Date().toISOString()) => ({ started_at: now, steps: [], done_at: null, skipped_at: null });

// The step a finished game counts as, once: the first play of a step sets its mark. A replay is a normal result and changes nothing here.
// Returns a new first_week (the old one is not changed). done_at is set when the fifth step is recorded.
export function recordStep(fw, { n, game, swapped = false, result_id = null, date }) {
  if (!fw || !STEPS.some((s) => s.n === n) || (fw.steps || []).some((s) => s.n === n)) return fw;
  const steps = [...(fw.steps || []), { n, game, swapped: !!swapped, result_id, date: day(date) }].sort((a, b) => a.n - b.n);
  return { ...fw, steps, done_at: fw.done_at || (STEPS.every((s) => steps.some((x) => x.n === s.n)) ? day(date) : null) };
}

// firstWeek({ journal, rounds, games, unitM })
// → { show, started, done, skipped, steps: [{ n, title, game, name, minutes, alt, alt_name, alt_minutes, skill, state: 'done'|'next'|'locked', swapped, played, mark }],
//     next: step | null, progress: 0..1, count }
// mark = { score, h, game } from the step's own result: the score to beat when the step is played again (h is the handicap level it matches, if the game has one).
export function firstWeek({ journal = {}, rounds = [], games = [], unitM = 0.9144 } = {}) {
  const fw = journal.first_week || null, results = journal.results || [], name = (id) => games.find((g) => g.id === id)?.name || id;
  const rec = (n) => (fw?.steps || []).find((s) => s.n === n) || null;
  let nextSet = false;
  const steps = STEPS.map((s) => {
    const r = rec(s.n), res = r ? results.find((x) => x.id === r.result_id) : null, played = r ? r.game : s.game, g = games.find((x) => x.id === played);
    let state = 'locked'; if (r) state = 'done'; else if (!nextSet) { state = 'next'; nextSet = true; }
    const lv = res && isNum(res.score) && g ? B.level(played, res.score, g.better || 'higher', unitM) : null;
    return { n: s.n, title: s.title, game: s.game, name: name(s.game), minutes: minutesFor(s.game), alt: s.alt, alt_name: s.alt ? name(s.alt) : null, alt_minutes: s.alt ? minutesFor(s.alt) : null,
      skill: s.skill, state, swapped: !!r?.swapped, played, played_name: name(played), result_id: r?.result_id || null,
      mark: res && isNum(res.score) ? { score: res.score, h: lv ? r1(lv.h) : null, game: played, better: g?.better || 'higher' } : null };
  });
  const count = steps.filter((s) => s.state === 'done').length, done = !!fw?.done_at, skipped = !!fw?.skipped_at;
  const show = !!fw?.started_at && !done && !skipped && (!rounds.length || count > 0);
  return { show, started: !!fw?.started_at, done, skipped, steps, next: steps.find((s) => s.state === 'next') || null, count, progress: count / STEPS.length };
}

// The golfer's practice level: the average practice handicap of the skills that have one (skills.js skillRatings). null when none is rated.
// It describes practice, not the course, so it is always called a practice level, never a handicap.
export function practiceLevel(ratings) {
  const skills = Array.isArray(ratings) ? ratings : ratings?.skills || [], v = skills.map((s) => s.practice_hcp).filter(isNum);
  return v.length ? r1(v.reduce((t, x) => t + x, 0) / v.length) : null;
}

// For part B2 (short early practice): no rounds loaded, and either no practice yet or the first practice result is under NEW_DAYS days old.
export function isNewGolfer({ journal = {}, rounds = [], now = new Date() } = {}) {
  if (rounds.length) return false;
  const first = (journal.results || []).map((r) => day(r.date)).filter(Boolean).sort()[0]; if (!first) return true;
  const t = now instanceof Date ? now : new Date(now), days = (Date.parse(`${day(t.toISOString())}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 864e5;
  return days < NEW_DAYS;
}
