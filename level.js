// BreakingPar player level: points, ranks and the ledger. Pure logic, no DOM, so Node can test it (tests/level.test.mjs).
//
// Points are worked out from history every time and never stored as a running total, so a golfer's past practice counts from the first day and nothing
// can drift out of sync. They are earned only by real practice and rounds: nothing is bought, nothing is awarded for opening the app and nothing is taken
// away for missing a day. (Deleting a past result does lower the total, because the points come from the history that is left. That is acceptable.)
//
// "Target met" is judged against the target in force now (`targets`, built by the page from skills.js), because a result does not store its target. As the
// skill handicaps improve, an old score can stop counting as a hit, so the page passes `floor` (the highest rank the golfer has already been shown) and the
// rank never reads lower than that: a rank only goes up.
//
// Counted from history today: games and quick entries (with their bonuses), guided sessions, rounds, on-course challenges, skills tests and passed bosses.
// Later phases add their own lines through the same table: path stages (R2), beaten predictions (R4) and duels (R7, the `duels` argument).
import * as G from './games.js';
import { earnsFreeze } from './coach.js';

// ---- every number below is a default and can be tuned here
export const POINTS = {
  game: 10, quick: 5, target: 10, tier: 25, pb: 15, pressure: 5, daily: 10,    // a guided game, a typed-in score, and the extras on a result
  session: 20, round: 30, round9: 15, challenge: 20, predicted: 25, test: 40, stage: 50, boss: 150,
  duel: 10, duelWin: 15,
  welcome_back: 2,                                                           // a welcome-back game scores its normal points times this
};
// At most this many points a day from games and quick entries, so volume alone cannot farm levels. Rounds, sessions, tests and bosses sit outside it.
export const DAILY_CAP = 150;
export const RANKS = [
  { n: 1, name: 'Rookie', at: 0 }, { n: 2, name: 'Range regular', at: 150 }, { n: 3, name: 'Weekend golfer', at: 400 }, { n: 4, name: 'Club player', at: 800 },
  { n: 5, name: 'Medal player', at: 1400 }, { n: 6, name: 'Team player', at: 2200 }, { n: 7, name: 'Club champion', at: 3200 }, { n: 8, name: 'County player', at: 4500 },
  { n: 9, name: 'Elite amateur', at: 6200 }, { n: 10, name: 'Legend', at: 8500 },                      // the top rank is "Legend", never "Scratch": it is not a handicap
];
export const LEDGER_LINES = 20;                                                                       // lines shown in the "Your level" sheet

export const rankFor = (points) => RANKS.reduce((r, x) => (points >= x.at ? x : r), RANKS[0]);
export const rankByNumber = (n) => RANKS.find((x) => x.n === n) || null;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const day = (s) => String(s || '').slice(0, 10);

// Round points: a full round counts in full, 9 holes count half, and a part round counts half once it reaches 9 holes.
export function roundPoints(r) {
  if (r.format === '18') return POINTS.round;
  const holes = isNum(r.holes_played) ? r.holes_played : r.format === '9' ? 9 : 0;
  return holes >= 18 ? POINTS.round : holes >= 9 ? POINTS.round9 : 0;
}

// playerLevel({ journal, rounds, duels, games, unitM, targets, floor, today })
//   targets: { [gameId]: the score that counts as meeting this golfer's target }   floor: highest rank number already shown
// → { points, rank: {n, name, at}, next: {n, name, at} | null, toNext, progress: 0..1, today, ledger: [{ date, what, points, rid?, capped? }] }   (ledger newest first)
export function playerLevel({ journal = {}, rounds = [], duels = [], games = [], unitM = 0.9144, targets = {}, floor = 0, today = null, stages = [], predictions = [] } = {}) {
  const results = (journal.results || []).filter((r) => r && r.game && day(r.date)), byId = new Map(games.map((g) => [g.id, g]));
  const lines = [];                                                                                    // { date, seq, what, points, capped, rid }
  let seq = 0;

  // ---- practice results, oldest first (ties keep saved order), so "first time", "best so far" and the daily cap all follow the order they happened in
  const order = results.map((r, i) => ({ r, i })).sort((a, b) => day(a.r.date).localeCompare(day(b.r.date)) || a.i - b.i).map((x) => x.r);
  const best = new Map(), top = new Map();                                                             // best score and highest tier rank so far, per game
  for (const r of order) {
    const g = byId.get(r.game), guided = r.mode === 'guided', parts = [[guided ? 'played' : 'score saved', guided ? POINTS.game : POINTS.quick]];
    const lower = g?.better === 'lower', t = targets[r.game];
    if (g && isNum(t) && isNum(r.score) && (lower ? r.score <= t : r.score >= t)) parts.push(['target met', POINTS.target]);
    if (g && isNum(r.score)) {
      const prev = best.get(g.id);
      if (isNum(prev) && (lower ? r.score < prev : r.score > prev)) parts.push(['personal best', POINTS.pb]);
      if (!isNum(prev) || (lower ? r.score < prev : r.score > prev)) best.set(g.id, r.score);
      const ti = G.tierFor(g, r.score, unitM, G.isOwn(g) ? G.scoresBefore(g, results, r.id) : null)?.tier, rank = ti ? G.TIERS.findIndex((x) => x.key === ti.key) : -1;
      if (rank > (top.has(g.id) ? top.get(g.id) : -1)) { parts.push([`${ti.name} tier`, POINTS.tier]); top.set(g.id, rank); }
    }
    if (r.pressure && r.pressure_hit) parts.push(['pressure finish', POINTS.pressure]);
    if (r.challenge === 'daily') parts.push(['daily challenge', POINTS.daily]);
    let pts = parts.reduce((s, p) => s + p[1], 0), what = `${g?.name || r.game}: ${parts.slice(1).map((p) => p[0]).join(', ') || parts[0][0]}`;
    if (r.welcome_back) { pts *= POINTS.welcome_back; what = `${g?.name || r.game}: welcome back, points doubled`; }
    lines.push({ date: day(r.date), seq: seq++, what, points: pts, capped: true, rid: r.id });
  }
  // ---- the daily cap, applied in the order things happened
  const used = new Map();
  for (const l of lines) if (l.capped) { const left = Math.max(0, DAILY_CAP - (used.get(l.date) || 0)), got = Math.min(l.points, left); used.set(l.date, (used.get(l.date) || 0) + got); l.points = got; }

  // ---- everything outside the cap
  const add = (date, what, points, rid) => { if (points > 0 && day(date)) lines.push({ date: day(date), seq: seq++, what, points, capped: false, ...(rid ? { rid } : {}) }); };
  for (const s of journal.sessions || []) if (earnsFreeze(s)) add(s.date, 'Session finished', POINTS.session);
  for (const r of rounds) add(r.date, `Round${r.course_name ? ` at ${r.course_name}` : ''}${r.format === '18' ? '' : ' (part round)'}`, roundPoints(r));
  for (const c of journal.course_challenges || []) if (c.achieved) add(c.date, 'On-course challenge', POINTS.challenge);
  for (const t of journal.skills_tests || []) add(t.date, 'Monthly skills test', POINTS.test);
  // journey stages (journey.js): one line per finished stage, on the day its last hit was posted. Counted from results, so nothing is stored.
  for (const s of stages || []) add(s.date, `Journey stage: ${s.title}`, POINTS.stage, s.rid);
  // beaten predictions (payoff.js): one line per round that finished lower than its prediction. Derived from the rounds, so nothing is stored.
  for (const p of predictions || []) add(p.date, p.title || 'Beat the prediction', POINTS.predicted, p.rid);
  for (const b of journal.journey?.bosses || []) if (b.passed) add(b.date, `Boss game passed: Beat the ${b.n}`, POINTS.boss);
  for (const d of duels || []) { add(d.date, 'Duel played', POINTS.duel); if (d.won) add(d.date, 'Duel won', POINTS.duelWin); }

  const points = lines.reduce((s, l) => s + l.points, 0), derived = rankFor(points), shown = rankByNumber(Math.max(derived.n, floor | 0)) || derived;
  const next = RANKS.find((x) => x.n === shown.n + 1) || null, now = today || day(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString());
  const ledger = lines.filter((l) => l.points > 0).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  return {
    points, rank: shown, next, toNext: next ? Math.max(0, next.at - points) : 0,
    progress: next ? Math.max(0, Math.min(1, (points - shown.at) / (next.at - shown.at))) : 1,
    today: lines.filter((l) => l.date === now).reduce((s, l) => s + l.points, 0), ledger,
  };
}

// What one saved result earned, for the "+35 points" line on the result screen (the same numbers as the ledger, so the two never disagree).
export const pointsFor = (level, rid) => level.ledger.filter((l) => l.rid === rid).reduce((s, l) => s + l.points, 0);
// The rank the golfer should be shown a "ranked up" moment for: higher than the one already shown, else null. Rank 1 is where everyone starts, so it is never a moment.
export const rankUp = (level, seen) => (level.rank.n > Math.max(1, seen | 0) ? level.rank : null);
