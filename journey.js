// Road to scratch (retention plan section 6). One path from the golfer's handicap down to zero, worked out from their own practice results.
// Pure: no DOM, no storage. Stage progress is derived from `results` every time; only boss attempts are stored (`journal.journey.bosses`).
// It describes PRACTICE level, not handicap. A stretch whose milestone the real handicap index has already reached is "earned on the course".
import * as B from './bench.js';
import { SKILLS } from './skills.js';

export const MILESTONES = [30, 25, 20, 15, 10, 5, 0];     // a stretch ends at each of these handicaps
export const STAGE_HITS = 3;                              // milestone-level scores needed to finish a stage
export const PRESSURE_HIT = 1.5;                          // a pressure-finish hit counts this much (the same as the potential rules in coach.js)
export const MIN_GAMES = 2;                               // when a skill has this many benchmarked games, the hits must come from at least two of them

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const gid = (r) => r.game ?? r.game_id;
const r1 = (x) => Math.round(x * 10) / 10;
export const label = (n) => (n === 0 ? 'scratch' : String(n));
export const stretchTitle = (n) => (n === 0 ? 'Reach scratch' : `Beat the ${n}`);
export const stageTitle = (skillTitle, n) => `${skillTitle} to ${label(n)}`;

// the score a handicap-n golfer posts in a game, to one decimal (the number the golfer sees and has to match)
export const milestoneScore = (gameId, n, unitM = 0.9144) => { const v = B.expectedFor(gameId, n, unitM); return isNum(v) ? r1(v) : null; };
const meets = (score, target, better) => isNum(score) && isNum(target) && (better === 'lower' ? score <= target : score >= target);

// The benchmarked games for one skill, in the order of SKILLS, each with the milestone score for stretch n.
function stageGames(skill, n, games, unitM) {
  const seen = new Set(), out = [];
  for (const sub of skill.subs) for (const id of sub.games) {
    if (seen.has(id)) continue; seen.add(id);
    const g = games.find((x) => x.id === id), target = g ? milestoneScore(id, n, unitM) : null;
    if (g && target !== null) out.push({ id, name: g.name, better: g.better || 'higher', target });
  }
  return out;
}

// Hits for one stage. Oldest result first so the day the stage was finished is known.
function stageProgress(sg, results) {
  const ids = new Map(sg.map((g) => [g.id, g]));
  const mine = results.filter((r) => r && isNum(r.score) && r.date && ids.has(gid(r)))
    .map((r, i) => ({ r, i })).sort((a, b) => String(a.r.date).localeCompare(String(b.r.date)) || a.i - b.i).map((x) => x.r);
  let hits = 0, done = false, doneOn = null, doneRid = null; const hitGames = new Set(), best = new Map();
  for (const r of mine) {
    const g = ids.get(gid(r)), prev = best.get(g.id);
    if (!isNum(prev) || (g.better === 'lower' ? r.score < prev : r.score > prev)) best.set(g.id, r.score);
    if (!meets(r.score, g.target, g.better)) continue;
    hits += r.pressure && r.pressure_hit !== false ? PRESSURE_HIT : 1; hitGames.add(g.id);
    if (!done && hits >= STAGE_HITS && (sg.length < MIN_GAMES || hitGames.size >= MIN_GAMES)) { done = true; doneOn = String(r.date).slice(0, 10); doneRid = r.id ?? null; }
  }
  return { hits, done, doneOn, doneRid, needsOther: !done && hits >= STAGE_HITS && sg.length >= MIN_GAMES, best };
}

// How close a game's best score is to the milestone score: 1 or more means it is there. Games never played score 0 (and so come last).
const closeness = (g, best) => (!isNum(best) ? 0 : g.better === 'lower' ? (best > 0 ? g.target / best : 1) : (g.target > 0 ? best / g.target : 1));

export function journey({ index = null, results = [], games = [], unitM = 0.9144, bosses = [] } = {}) {
  const idx = isNum(index) ? index : null, completions = [];
  let opened = false;
  const stretches = MILESTONES.map((n) => {
    const course = idx !== null && idx <= n;
    const stages = SKILLS.map((sk) => {
      const sg = stageGames(sk, n, games, unitM), p = stageProgress(sg, results);
      if (p.done && !course) completions.push({ n, skill: sk.key, title: stageTitle(sk.title, n), date: p.doneOn, rid: p.doneRid });
      const gl = sg.map((g) => { const best = p.best.get(g.id); return { id: g.id, name: g.name, better: g.better, target: g.target, best: isNum(best) ? best : null, there: meets(best, g.target, g.better) }; });
      return { skill: sk.key, title: stageTitle(sk.title, n), hits: Math.min(STAGE_HITS, p.hits), need: STAGE_HITS, done: p.done, needsOther: p.needsOther, games: gl };
    });
    const mine = bosses.filter((b) => b && b.n === n), passed = course || mine.some((b) => b.passed), last = mine[mine.length - 1] || null;
    let state;
    if (course) state = 'course'; else if (passed) state = 'done'; else if (!opened) { state = 'open'; opened = true; } else state = 'locked';
    const boss = { state: passed ? 'passed' : stages.every((s) => s.done) && state === 'open' ? 'ready' : 'locked', attempts: mine.length, last: last ? { date: last.date, passed: !!last.passed } : null };
    return { n, title: stretchTitle(n), state, stages, boss };
  });

  // what to do next: the unfinished stage in the open stretch that is furthest along, then the boss
  const open = stretches.find((s) => s.state === 'open') || null; let current = null;
  if (open) {
    const todo = open.stages.map((st, i) => ({ st, i })).filter((x) => !x.st.done).sort((a, b) => b.st.hits - a.st.hits || a.i - b.i)[0];
    if (todo) {
      const st = todo.st, pick = [...st.games].map((g, i) => ({ g, i, c: closeness(g, g.best) })).sort((a, b) => b.c - a.c || a.i - b.i)[0];
      current = { n: open.n, next: { kind: 'stage', skill: st.skill, title: st.title, hits: st.hits, need: st.need, line: `${st.title} · ${r1(st.hits)} of ${st.need}`, game: pick ? pick.g.id : null } };
    } else if (open.boss.state === 'ready') current = { n: open.n, next: { kind: 'boss', skill: null, title: open.title, line: `${open.title} is ready`, game: null } };
  }
  return { stretches, current, completions };
}

// Did one saved result move a stage forward in the open stretch? For the result screen: { title, from, to, done } or null.
// `args` is what journey() takes; `rid` is the result's id. Compares the path without that result against the path with it.
export function advance(args, rid) {
  const all = args.results || [], r = all.find((x) => x && x.id === rid); if (!r) return null;
  const after = journey(args), before = journey({ ...args, results: all.filter((x) => x !== r) }), o = after.stretches.find((s) => s.state === 'open'); if (!o) return null;
  const b = before.stretches.find((s) => s.n === o.n); if (!b) return null;
  for (let i = 0; i < o.stages.length; i++) {
    const a = o.stages[i], z = b.stages[i];
    if (a.hits > z.hits || (a.done && !z.done)) return { n: o.n, skill: a.skill, title: a.title, from: z.hits, to: a.hits, need: a.need, done: a.done && !z.done };
  }
  return null;
}
