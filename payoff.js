// Proof it is working (retention plan section 10). Pure: no DOM, no storage.
//   predict()          what a golfer usually scores on a course, from their own history, with their usual range
//   predictionResult() beat / within / over for a finished round
//   roundPayoff()      what practice did for one round: sub-skills that were better than the golfer's own baseline, in strokes
// Every number comes from the golfer's own rounds and the strokes-value logic in skills.js. Nothing is invented, and a missed prediction is never a failure.
import * as A from './analytics.js';
import * as SK from './skills.js';

export const PREDICT = { window: 20, min_rounds: 5, ratings_slope: 113 };
export const PAYOFF = { baseline_rounds: 20, practice_days: 30, practice_results: 2, min_strokes: 0.3, max_wins: 2, min_baseline_rounds: 5 };
// the fewest attempts in the one round before a sub-skill is judged on it
export const ROUND_MIN = { 'putting.short': 3, 'putting.mid': 3, 'putting.lag': 9, 'short.updown': 3, 'short.chip': 3, 'approach.gir': 9, 'approach.wedge': 2, 'approach.mid': 2, 'approach.long': 2, 'driving.accuracy': 7, 'driving.penalties': 6 };

const isNum = A.isNum, r1 = (x) => Math.round(x * 10) / 10, DAY = 864e5;
const when = (r) => String(r.start_time_local || r.date || '');
const byTime = (a, b) => when(a).localeCompare(when(b));
const holesOf = (r) => (r.holes_played === 9 || r.format === '9' ? 9 : r.holes_played === 18 || r.format === '18' ? 18 : null);
// score to par for the holes played, scaled to 18 so nine- and eighteen-hole rounds compare
const toPar18 = (r) => { const h = holesOf(r); return h && isNum(r.gross) && isNum(r.par_played) ? (r.gross - r.par_played) * 18 / h : null; };

// ------------------------------------------------------------------ the prediction (10.1)
// course: { rating, slope, par } for the holes to be played (par is that of the holes in play); holes: 9 or 18; before: only rounds dated before this day count.
// With a rating and slope: rating + mean differential x slope / 113 (nine holes: the nine-hole rating and half the differential). Without: par + the golfer's mean score to par.
export function predict({ rounds = [], course = {}, holes = 18, before = null } = {}) {
  const n = holes === 9 ? 9 : 18, f = n / 18;
  const pool = rounds.filter((r) => r && r.date && (!before || String(r.date) < String(before))).sort(byTime).slice(-PREDICT.window);
  const tp = pool.map(toPar18).filter(isNum), diffs = pool.map((r) => r.differential_for_index).filter(isNum);
  if (pool.length < PREDICT.min_rounds || tp.length < PREDICT.min_rounds) return null;
  const sd = tp.length > 1 ? A.std(tp) : 0, spread = isNum(sd) ? sd * f : 0;
  let predicted = null, basis = null;
  if (isNum(course.rating) && isNum(course.slope) && course.slope > 0 && diffs.length >= PREDICT.min_rounds) {
    const rating = n === 9 && course.rating > 50 ? course.rating / 2 : course.rating, md = A.mean(diffs) * f;
    predicted = Math.round(rating + md * course.slope / PREDICT.ratings_slope); basis = 'rating';
  } else if (isNum(course.par)) {
    predicted = Math.round(course.par + A.mean(tp) * f); basis = 'par';
  }
  if (predicted === null) return null;
  return { predicted, lo: Math.round(predicted - spread), hi: Math.round(predicted + spread), basis, holes: n };
}

// beat: the gross score was lower than predicted. within: inside the usual range (when it did not beat the prediction)
export function predictionResult(p, gross) {
  if (!p || !isNum(gross)) return null;
  const diff = gross - p.predicted;
  return { beat: diff < 0, by: diff < 0 ? -diff : 0, diff, level: diff === 0, within: gross >= p.lo && gross <= p.hi };
}

// Every round's prediction, oldest first: the one saved when it started, else one worked out from the rounds before that date (imported rounds).
export function predictionHistory({ rounds = [], predictions = [] } = {}) {
  const saved = new Map((predictions || []).filter(Boolean).map((p) => [p.round_id, p])), all = [...rounds].filter((r) => r && r.date).sort(byTime), out = [];
  for (const r of all) {
    const n = holesOf(r); if (!n || !isNum(r.gross)) continue;
    const s = saved.get(r.round_id);
    let p = s && isNum(s.predicted) && (s.n === undefined || s.n === n) ? { predicted: s.predicted, lo: s.lo, hi: s.hi, holes: n, basis: 'saved' } : null, stored = !!p;
    if (!p) {
      const before = rounds.filter((x) => x.round_id !== r.round_id);
      p = predict({ rounds: before, holes: n, before: r.date, course: { rating: r.course_rating, slope: r.slope, par: isNum(r.par_played) ? r.par_played : null } });
    }
    if (!p) continue;
    out.push({ round_id: r.round_id, date: r.date, course: r.course_name || '', stored, ...p, gross: r.gross, ...predictionResult(p, r.gross) });
  }
  return out;
}
// how many predictions were beaten, and the run of beaten predictions ending with the latest round
export function predictionRun(history) {
  let run = 0; for (let i = history.length - 1; i >= 0 && history[i].beat; i--) run++;
  return { total: history.length, beaten: history.filter((h) => h.beat).length, run };
}

// ------------------------------------------------------------------ what practice did for a round (10.2)
const LINES = {
  'putting.short': { t: 'Short putts', f: (m, b, n) => `${Math.round(m.you * m.n / 100)} of ${m.n} holed from 3–6 ft, you usually hole ${r1(b.you * m.n / 100)}` },
  'putting.mid': { t: 'Mid putts', f: (m, b) => `${Math.round(m.you * m.n / 100)} of ${m.n} holed from 6–12 ft, you usually hole ${r1(b.you * m.n / 100)}` },
  'putting.lag': { t: 'Lag putting', f: (m, b, n) => { const k = Math.round(m.you * m.n / 100); return `${k} three-putt${k === 1 ? '' : 's'} today, you usually have ${r1(b.you * m.n / 100)}`; } },
  'short.updown': { t: 'Up and down', f: (m, b) => `${Math.round(m.you * m.n / 100)} of ${m.n} saves, you usually make ${r1(b.you * m.n / 100)}` },
  'short.chip': { t: 'Chipping', f: (m, b) => `${Math.round(m.you * m.n / 100)} of ${m.n} chips finished on the green, you usually get ${r1(b.you * m.n / 100)}` },
  'approach.gir': { t: 'Greens in regulation', f: (m, b, n) => `${Math.round(m.you * n / 100)} greens, you usually hit ${r1(b.you * n / 100)}` },
  'approach.wedge': { t: 'Wedges', f: (m, b, n, u) => `median finish ${r1(m.you * u.k)} ${u.l} from 50–100 yd, you usually finish ${r1(b.you * u.k)} ${u.l}` },
  'approach.mid': { t: 'Mid irons', f: (m, b, n, u) => `median finish ${r1(m.you * u.k)} ${u.l} from 100–150 yd, you usually finish ${r1(b.you * u.k)} ${u.l}` },
  'approach.long': { t: 'Long irons', f: (m, b, n, u) => `median finish ${r1(m.you * u.k)} ${u.l} from 150–200 yd, you usually finish ${r1(b.you * u.k)} ${u.l}` },
  'driving.accuracy': { t: 'Fairways', f: (m, b) => `${Math.round(m.you * m.n / 100)} of ${m.n} fairways, you usually hit ${r1(b.you * m.n / 100)}` },
  'driving.penalties': { t: 'Tee penalties', f: (m, b) => `${r1(m.you)} penalty tee shots per 14, you usually have ${r1(b.you)}` },
};
const subOf = (key) => { const [sk, sub] = key.split('.'); const s = SK.SKILLS.find((x) => x.key === sk), d = s?.subs.find((x) => x.key === sub); return d ? { ...d, skill: sk, key } : null; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// round: the dataset row; holes/shots: the full dataset arrays; history: the golfer's rounds BEFORE this one; results: practice results; ratings: skillRatings() (for index and focus)
export function roundPayoff({ round, holes = [], shots = [], history = [], results = [], games = [], ratings = null, unitM = 0.9144 } = {}) {
  const none = { wins: [], work_on: null, none: true, closest: null, practised: [], reason: null };
  const n = round ? holesOf(round) : null; if (!n) return { ...none, reason: 'holes' };
  const f = n / 18, base18 = history.filter((r) => r.format === '18').sort(byTime).slice(-PAYOFF.baseline_rounds);
  if (base18.length < PAYOFF.min_baseline_rounds) return { ...none, reason: 'history' };
  const ids = new Set(base18.map((r) => r.round_id)), base = SK.measures({ rounds: base18, holes: holes.filter((h) => ids.has(h.round_id)), shots: shots.filter((s) => ids.has(s.round_id)) });
  if (base['short.updown'] && base['approach.gir']) base['short.updown'].misses = 18 * (1 - (base['approach.gir'].you ?? 0) / 100);
  const mine = SK.measures({ rounds: [round], holes: holes.filter((h) => h.round_id === round.round_id), shots: shots.filter((s) => s.round_id === round.round_id) });
  const hcp = isNum(ratings?.index) ? ratings.index : null, focus = new Set(ratings?.focus || []);
  const day = String(round.date).slice(0, 10), t1 = Date.parse(`${day}T23:59:59`), t0 = t1 - PAYOFF.practice_days * DAY;
  const res = (results || []).filter((r) => isNum(r.score) && r.date && Date.parse(`${String(r.date).slice(0, 10)}T12:00:00`) >= t0 && Date.parse(`${String(r.date).slice(0, 10)}T00:00:00`) <= t1);
  const yd = Math.abs(unitM - 0.9144) < 0.01, u = yd ? { l: 'ft', k: 1 } : { l: 'm', k: 0.3048 };
  const rows = [];
  for (const key of Object.keys(LINES)) {
    const sd = subOf(key), mb = base[key], mr = mine[key]; if (!sd || !mb || !mr || !isNum(mb.you) || !isNum(mr.you)) continue;
    if (mb.n < SK.MIN(key) || mr.n < ROUND_MIN[key]) continue;
    const played = res.filter((r) => sd.games.includes(r.game ?? r.game_id)), isP = played.length >= PAYOFF.practice_results, isFocus = focus.has(sd.skill);
    const gain = SK.strokesFor(key, mb, mr.you, hcp) * f, cost = SK.strokesFor(key, { ...mb, you: mr.you }, mb.you, hcp) * f;
    const per = new Map(); for (const r of played) per.set(r.game ?? r.game_id, (per.get(r.game ?? r.game_id) || 0) + 1);
    const top = [...per.entries()].sort((a, b) => b[1] - a[1])[0], gname = top ? (games.find((g) => g.id === top[0])?.name || top[0]) : null;
    const line = `${LINES[key].t}: ${LINES[key].f(mr, mb, n, u)}`;
    rows.push({ sub: key, title: sd.title, short: LINES[key].t, skill: sd.skill, practised: isP, focus: isFocus, gain, cost, strokes: gain > 0 ? gain : -cost, game: sd.games[0], games_played: played.length,
      line: `${line}${gain >= PAYOFF.min_strokes ? ` — about ${r1(gain)} shot${r1(gain) === 1 ? '' : 's'} saved.` : '.'}${isP && gname ? ` You've played ${gname} ${plural(top[1], 'time')} this month.` : ''}` });
  }
  const wins = rows.filter((r) => r.practised && r.gain >= PAYOFF.min_strokes).sort((a, b) => b.gain - a.gain).slice(0, PAYOFF.max_wins);
  const work = rows.filter((r) => (r.practised || r.focus) && r.cost >= PAYOFF.min_strokes).sort((a, b) => b.cost - a.cost)[0] || null;
  const practised = rows.filter((r) => r.practised), closest = !wins.length ? [...practised].sort((a, b) => Math.abs(a.strokes) - Math.abs(b.strokes))[0] || null : null;
  return { wins: wins.map(({ sub, title, short, line, gain, games_played }) => ({ sub, title, short, line, strokes: r1(gain), games_played })), none: !wins.length,
    work_on: work ? { sub: work.sub, title: work.title, short: work.short, strokes: r1(work.cost), game: work.game, line: `${work.short}: ${r1(work.cost)} ${work.cost >= 1.05 || work.cost < 0.95 ? 'shots' : 'shot'} more than usual today.` } : null,
    closest: closest ? { sub: closest.sub, title: closest.title, short: closest.short } : null, practised: practised.map((r) => r.sub), reason: null };
}
