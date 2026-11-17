// onboarding.js — the first-run intro: who sees it, the "no handicap" level choices, the goals, and the profile that is saved.
// A2 (goal on Home / Progress / Settings): goalProgress, sessionsThisWeek, practiceAvg, setGoal.
// Pure logic only (no DOM); the screens are drawn and wired in app.js. Every number here is a default and can be tuned.
//
//   needsOnboarding({ settings, journal, rounds })  true for a fresh app that has not been through (or skipped) the intro
//   hasData({ settings, journal, rounds })          true when the golfer already has anything of their own on this phone
//   startLevel(profile, index)                      a typed index, else the estimate from the level choice, else null
//   preselectGoal(level)                            the goal shown as selected on the "Your goal" screen
//   buildProfile(answers, today) / skipProfile(today) / handicapEntry(hcp, today)
//   readProfile(settings)                           the saved profile with every field checked (old data has none)

// "I don't have one": four choices and the starting practice level each maps to. A starting level is an estimate and is labelled as one.
export const LEVEL_CHOICES = [
  { key: 'new', level: 36 },
  { key: 'over100', level: 30 },
  { key: '90s', level: 24 },
  { key: '80s', level: 16 },
];
// Goals, with the handicap each one needs ("about"): a round a little under the target score on a par-72 course, using the rule of thumb
// gross score ≈ par + handicap (so Break 90 needs about 18). This is a convention, not a measured statistic; the UI says "about".
export const PAR_REF = 72;
export const GOALS = [
  { key: 'break100', score: 100 },
  { key: 'break90', score: 90 },
  { key: 'break80', score: 80 },
  { key: 'scratch', level: 0 },
  { key: 'enjoy', level: null },
];
export const goalLevel = (key) => { const g = GOALS.find((x) => x.key === key); if (!g) return null; return 'score' in g ? g.score - PAR_REF : g.level; };
export const GOAL_MONTHS = [3, 6, 12], DEFAULT_MONTHS = 6;
export const PER_WEEK = [1, 2, 3], DEFAULT_PER_WEEK = 2;
export const NAME_MAX = 30;
export const HCP_MIN = -10, HCP_MAX = 54;                 // World Handicap System range (plus handicaps are negative here, as in Settings → Handicap)
import { isoWeek } from './bench.js';
import { practiceLevel } from './firstweek.js';
export const INTRO_SCREENS = 4;
export const FIRST_GAME = 'putt-369';                     // "Play my first game" — part B makes this step 1 of the first week

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const levelOf = (key) => LEVEL_CHOICES.find((x) => x.key === key)?.level ?? null;

export function hasData({ settings = {}, journal = {}, rounds = [] } = {}) {
  const j = journal || {}, n = (a) => (Array.isArray(a) ? a.length : 0);
  return !!(n(rounds) || n(j.results) || n(j.sessions) || j.draft || j.game_draft || n(j.notes) || n(j.thoughts) || n(j.wedge?.entries) || n(settings?.handicaps));
}
// A golfer with existing data is never shown the intro; the app marks them as onboarded silently (see markIfHasData).
export function needsOnboarding(ctx = {}) { return !readProfile(ctx.settings).onboarded_at && !hasData(ctx); }
// → a profile to save when an existing golfer should be marked as onboarded without seeing anything, else null
export function markIfHasData(ctx = {}, today) { return !readProfile(ctx.settings).onboarded_at && hasData(ctx) ? { ...(ctx.settings?.profile || {}), onboarded_at: today } : null; }

export function parseHandicap(txt) {
  const s = String(txt ?? '').trim().replace(',', '.').replace(/^\+\s*/, '-');    // "+2" is a plus handicap: stored as −2
  if (!s) return null;
  const v = Number(s); if (!isNum(v) || v < HCP_MIN || v > HCP_MAX) return null;
  return Math.round(v * 10) / 10;
}
// The level the goal is measured from: a handicap index when there is one, else the estimate from the level choice.
export function startLevel(profile, index) { if (isNum(index)) return { level: index, estimate: false }; const l = levelOf(profile?.level_choice); return isNum(l) ? { level: l, estimate: true } : null; }
// The next goal below the golfer's level (strictly below: an 18 is offered Break 80). Unknown level → Break 100; already scratch or better → Just enjoy practising.
export function preselectGoal(level) {
  if (!isNum(level)) return 'break100';
  const g = GOALS.filter((x) => isNum(goalLevel(x.key)) && goalLevel(x.key) < level).sort((a, b) => goalLevel(b.key) - goalLevel(a.key))[0];
  return g ? g.key : 'enjoy';
}

const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
// answers: { name, hcp (number|null), level_choice, goal, months, per_week } → the profile to save (onboarded_at = today)
export function buildProfile(a = {}, today) {
  const hcp = isNum(a.hcp) ? a.hcp : null, goal = GOALS.some((g) => g.key === a.goal) ? a.goal : preselectGoal(startLevel({ level_choice: a.level_choice }, hcp)?.level);
  const p = { onboarded_at: today, goal: { key: goal, months: GOAL_MONTHS.includes(a.months) ? a.months : DEFAULT_MONTHS, set_at: today }, per_week: PER_WEEK.includes(a.per_week) ? a.per_week : DEFAULT_PER_WEEK };
  const from = startLevel({ level_choice: a.level_choice }, hcp)?.level; if (isNum(from)) p.goal.from = from;     // the level the progress bar starts from (an estimate when there is no handicap)
  const name = cleanName(a.name); if (name) p.name = name;
  if (hcp === null && levelOf(a.level_choice) !== null) p.level_choice = a.level_choice;   // a typed handicap goes into the handicap history instead
  return p;
}
export const skipProfile = (today) => ({ onboarded_at: today });
export const HCP_NOTE = 'From the BreakingPar intro';
export const handicapEntry = (hcp, today) => (isNum(hcp) ? { date: today, handicap_index: hcp, note: HCP_NOTE } : null);
// add or replace today's entry, kept in date order (as Settings → Handicap does)
export const withHandicap = (list, entry) => (entry ? [...(list || []).filter((h) => h.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date)) : [...(list || [])]);

// The saved profile with each field checked, so old or hand-edited data can never break a screen.
export function readProfile(settings) {
  const p = settings && typeof settings.profile === 'object' && settings.profile ? settings.profile : {}, out = {};
  if (typeof p.onboarded_at === 'string' && p.onboarded_at) out.onboarded_at = p.onboarded_at;
  const name = cleanName(p.name); if (name) out.name = name;
  if (levelOf(p.level_choice) !== null) out.level_choice = p.level_choice;
  if (p.goal && GOALS.some((g) => g.key === p.goal.key)) out.goal = { key: p.goal.key, months: GOAL_MONTHS.includes(p.goal.months) ? p.goal.months : DEFAULT_MONTHS, set_at: typeof p.goal.set_at === 'string' ? p.goal.set_at : null };
  if (out.goal && isNum(p.goal.from)) out.goal.from = p.goal.from;
  if (PER_WEEK.includes(p.per_week)) out.per_week = p.per_week;
  return out;
}

// ---------------------------------------------------------------- A2: the goal on Home, Progress and Settings
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// the date a goal is due: the day it was set plus its months (clamped to the end of a short month)
export function goalDue(goal) {
  if (!goal?.set_at) return null; const [y, m, d] = goal.set_at.split('-').map(Number); if (!y || !m || !d) return null;
  const t = new Date(y, m - 1 + (GOAL_MONTHS.includes(goal.months) ? goal.months : DEFAULT_MONTHS), 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last)); return iso(t);
}
// The practice level from the rated skills: the average of their practice handicaps (skills.js `practice_hcp`). Null until one skill has a practice rating.
// the golfer's current practice level: one formula for the whole app, owned by firstweek.js (the road's starting point uses the same one, on the first-week results)
export function practiceAvg(skills) { return practiceLevel(skills || []); }
// Where the golfer is against their goal. The level used is the handicap index when there is one, otherwise the practice level, otherwise the estimate from the intro.
// → null when no goal is set; target is null for "Just enjoy practising" (a goal with no number).
export function goalProgress({ profile, index = null, practice = null, now = new Date() } = {}) {
  const g = profile?.goal; if (!g) return null;
  const target = goalLevel(g.key), due = goalDue(g), today = iso(now);
  const cur = isNum(index) ? { level: index, basis: 'index' } : isNum(practice) ? { level: practice, basis: 'practice' } : isNum(profile.level_choice !== undefined ? levelOf(profile.level_choice) : null) ? { level: levelOf(profile.level_choice), basis: 'estimate' } : null;
  const out = { key: g.key, months: g.months, target, due, overdue: !!due && due < today, from: isNum(g.from) ? g.from : null, level: cur?.level ?? null, basis: cur?.basis ?? null, reached: false, progress: null };
  if (!isNum(target) || !cur) return out;
  out.reached = cur.level <= target;
  if (out.reached) out.progress = 1;
  else if (isNum(out.from) && out.from > target) out.progress = Math.max(0, Math.min(1, (out.from - cur.level) / (out.from - target)));   // never below 0: getting worse is not shown as going backwards
  return out;
}
// Days with practice (a game score, a practice session or a wedge entry) in this ISO week. A "session" here is a day of practice; the weekly-streak rule is unchanged.
export function sessionsThisWeek(dates, now = new Date()) {
  const wk = isoWeek(now); return new Set((dates || []).filter((d) => isoWeek(new Date(`${d}T12:00:00`)) === wk)).size;
}
// Settings → General: change the goal, date and sessions per week. Only the fields given are changed; changing the goal or date restarts it from today at the current level.
export function setGoal(profile, { key, months, per_week, level = null }, today) {
  const p = { ...(profile || {}) }, was = p.goal;
  if (PER_WEEK.includes(per_week)) p.per_week = per_week;
  if (key !== undefined && key !== '' && GOALS.some((x) => x.key === key)) {
    const m = GOAL_MONTHS.includes(months) ? months : (was?.months || DEFAULT_MONTHS), same = was && was.key === key && was.months === m;
    p.goal = same ? { ...was } : { key, months: m, set_at: today, ...(isNum(level) ? { from: level } : {}) };
  }
  return p;
}
