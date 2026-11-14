// Proof it is working (payoff.js): the prediction, beat / within / over, the payoff card's rules. Run: node tests/payoff.test.mjs
import assert from 'node:assert/strict';
import * as P from '../payoff.js';
import { playerLevel } from '../level.js';
import * as F from '../features.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const games = F.DEFAULT_GAMES;
const rnd = (i, o = {}) => ({ round_id: `r${i}`, date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`, format: '18', holes_played: 18, gross: 90, par_played: 72, par_total: 72, course_rating: 71, slope: 125, differential_for_index: 17, ...o });
const mk = (k, f) => Array.from({ length: k }, (_, i) => rnd(i, f ? f(i) : {}));

t('fewer than five past rounds: no prediction', () => { assert.equal(P.predict({ rounds: mk(4), course: { rating: 71, slope: 125, par: 72 }, holes: 18 }), null); });
t('with a rating and slope: rating + mean differential x slope / 113', () => {
  const p = P.predict({ rounds: mk(10), course: { rating: 71, slope: 125, par: 72 }, holes: 18 });
  assert.equal(p.predicted, Math.round(71 + 17 * 125 / 113)); assert.equal(p.basis, 'rating'); assert.equal(p.holes, 18);
});
t('the usual range is one standard deviation of scores to par', () => {
  const rs = mk(10, (i) => ({ gross: i % 2 ? 86 : 94 })), p = P.predict({ rounds: rs, course: { rating: 71, slope: 125, par: 72 }, holes: 18 });
  assert.ok(p.hi > p.predicted && p.lo < p.predicted); assert.equal(p.hi - p.predicted, p.predicted - p.lo);
  assert.equal(p.hi - p.predicted, Math.round(4.2160));     // sd of [14, 22 alternating] is about 4.2
});
t('a steady golfer has a narrow range', () => { const p = P.predict({ rounds: mk(10), course: { rating: 71, slope: 125, par: 72 }, holes: 18 }); assert.equal(p.lo, p.hi); });
t('nine holes use the nine-hole rating and half the differential', () => {
  const p = P.predict({ rounds: mk(10), course: { rating: 71, slope: 125, par: 36 }, holes: 9 });
  assert.equal(p.predicted, Math.round(35.5 + 8.5 * 125 / 113)); assert.equal(p.holes, 9);
});
t('without a rating: par plus the golfer\'s mean score to par, scaled to the holes', () => {
  const p18 = P.predict({ rounds: mk(10), course: { par: 72 }, holes: 18 }), p9 = P.predict({ rounds: mk(10), course: { par: 36 }, holes: 9 });
  assert.equal(p18.predicted, 90); assert.equal(p18.basis, 'par'); assert.equal(p9.predicted, 45);
});
t('no rating and no par: no prediction', () => { assert.equal(P.predict({ rounds: mk(10), course: {}, holes: 18 }), null); });
t('only the last 20 rounds count', () => {
  const old = mk(30, (i) => ({ gross: i < 10 ? 120 : 90, differential_for_index: i < 10 ? 40 : 17 })), p = P.predict({ rounds: old, course: { par: 72 }, holes: 18 });
  assert.equal(p.predicted, 90);
});
t('`before` leaves out the round itself and later ones (imported rounds)', () => {
  const rs = [...mk(8), rnd(8, { gross: 100 })], p = P.predict({ rounds: rs, course: { par: 72 }, holes: 18, before: rs[8].date });
  assert.equal(p.predicted, 90);
});
t('nine-hole rounds in the history are scaled to 18 for the spread and mean', () => {
  const rs = mk(10, (i) => (i % 2 ? { format: '9', holes_played: 9, gross: 48, par_played: 36 } : {}));
  const p = P.predict({ rounds: rs, course: { par: 72 }, holes: 18 }); assert.equal(p.predicted, 93);
});
t('beat, level, within the range, and over it', () => {
  const p = { predicted: 86, lo: 83, hi: 89, holes: 18 };
  let r = P.predictionResult(p, 83); assert.deepEqual([r.beat, r.by, r.within], [true, 3, true]);
  r = P.predictionResult(p, 86); assert.deepEqual([r.beat, r.level, r.within], [false, true, true]);
  r = P.predictionResult(p, 88); assert.deepEqual([r.beat, r.diff, r.within], [false, 2, true]);
  r = P.predictionResult(p, 95); assert.deepEqual([r.beat, r.within], [false, false]); assert.equal(P.predictionResult(null, 80), null);
});
t('history: a saved prediction is used as saved, others are worked out from the rounds before', () => {
  const rs = [...mk(8), rnd(8, { gross: 82 }), rnd(9, { gross: 95 })];
  const h = P.predictionHistory({ rounds: rs, predictions: [{ round_id: 'r9', predicted: 90, lo: 87, hi: 93, n: 18 }] });
  const a = h.find((x) => x.round_id === 'r8'), b = h.find((x) => x.round_id === 'r9');
  assert.equal(a.stored, false); assert.equal(a.beat, true); assert.equal(b.stored, true); assert.equal(b.predicted, 90); assert.equal(b.beat, false); assert.equal(b.within, false);
  assert.ok(h.every((x) => x.round_id !== 'r0'), 'the first rounds have too little history');
});
t('history: a saved prediction for a different number of holes is not used', () => {
  const rs = [...mk(8), rnd(8, { format: '9', holes_played: 9, gross: 45, par_played: 36 })];
  const h = P.predictionHistory({ rounds: rs, predictions: [{ round_id: 'r8', predicted: 80, lo: 77, hi: 83, n: 18 }] });
  assert.equal(h.find((x) => x.round_id === 'r8').stored, false);
});
t('the run counts beaten predictions ending with the latest round', () => {
  assert.deepEqual(P.predictionRun([{ beat: true }, { beat: false }, { beat: true }, { beat: true }]), { total: 4, beaten: 3, run: 2 }); assert.equal(P.predictionRun([{ beat: false }]).run, 0);
});
t('points: +25 for each beaten prediction, on the day of the round', () => {
  const base = playerLevel({ journal: {}, games }), withP = playerLevel({ journal: {}, games, predictions: [{ date: '2026-05-01', title: 'Beat the prediction by 3' }] });
  assert.equal(withP.points - base.points, 25); assert.equal(withP.ledger[0].date, '2026-05-01');
});

// ---- the payoff card
const base = (k) => Array.from({ length: k }, (_, i) => rnd(i, { date: `2026-02-${String(1 + i).padStart(2, '0')}` }));
const holesFor = (rid, threePutts, first = 0.9) => Array.from({ length: 18 }, (_, i) => ({ round_id: rid, hole: i + 1, par: 4, strokes: 5, putts_eff: i < threePutts ? 3 : 2, first_putt_eff_m: 5, gir_eff: i % 2, fw_hit: 1, to_par: 1 }));
const dataset = (baseThree, roundThree) => { const hist = base(10), hs = hist.flatMap((r) => holesFor(r.round_id, baseThree)), round = rnd(20, { date: '2026-03-10' }); hs.push(...holesFor(round.round_id, roundThree)); return { hist, round, hs }; };
const lagResults = (k, date = '2026-03-01') => Array.from({ length: k }, (_, i) => ({ id: `g${i}`, game: 'putt-lag', date, score: 5, mode: 'guided' }));

t('payoff: a practised sub-skill that beat its baseline is a win, in strokes', () => {
  const { hist, round, hs } = dataset(4, 1), r = P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: lagResults(4), games, ratings: { index: 14, focus: [] } });
  const w = r.wins.find((x) => x.sub === 'putting.lag'); assert.ok(w, JSON.stringify(r)); assert.ok(w.strokes >= 0.3);
  assert.match(w.line, /Lag putting: 1 three-putt today, you usually have 4/); assert.match(w.line, /shots? saved/); assert.match(w.line, /You've played Lag ladder 4 times this month/);
  assert.equal(r.none, false);
});
t('payoff: a sub-skill that was not practised never shows as a win', () => {
  const { hist, round, hs } = dataset(4, 0), r = P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: [], games, ratings: { index: 14, focus: [] } });
  assert.equal(r.wins.length, 0); assert.equal(r.none, true);
  assert.equal(P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: lagResults(1), games, ratings: null }).wins.length, 0, 'one result is not enough practice');
});
t('payoff: practice more than 30 days before the round does not count', () => {
  const { hist, round, hs } = dataset(4, 0); assert.equal(P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: lagResults(4, '2026-01-20'), games, ratings: null }).wins.length, 0);
});
t('payoff: a win needs at least 0.3 strokes', () => {
  const { hist, round, hs } = dataset(4, 4); assert.equal(P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: lagResults(4), games, ratings: null }).wins.length, 0);
});
t('payoff: no win means the honest message data and the sub-skill closest to its baseline', () => {
  const { hist, round, hs } = dataset(4, 4), r = P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: lagResults(4), games, ratings: null });
  assert.equal(r.none, true); assert.equal(r.closest?.sub, 'putting.lag');
});
t('payoff: at most one "to work on" line, and only for a practised or focus sub-skill', () => {
  const { hist, round, hs } = dataset(1, 5), r = P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: lagResults(3), games, ratings: { index: 14, focus: [] } });
  assert.equal(r.work_on?.sub, 'putting.lag'); assert.ok(r.work_on.strokes >= 0.3); assert.equal(r.wins.length, 0);
  assert.equal(P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: [], games, ratings: { index: 14, focus: [] } }).work_on, null, 'not practised, not a focus area');
  assert.equal(P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: [], games, ratings: { index: 14, focus: ['putting'] } }).work_on?.sub, 'putting.lag', 'a focus area counts');
});
t('payoff: never more than two wins', () => {
  const { hist, round, hs } = dataset(4, 0); const r = P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: [...lagResults(3), ...['putt-369', 'putt-par18'].flatMap((g) => [0, 1].map((i) => ({ id: g + i, game: g, date: '2026-03-02', score: 5, mode: 'guided' })))], games, ratings: null });
  assert.ok(r.wins.length <= 2);
});
t('payoff: nine-hole rounds scale the strokes by half', () => {
  const { hist, round, hs } = dataset(4, 1), full = P.roundPayoff({ round, holes: hs, shots: [], history: hist, results: lagResults(4), games, ratings: null }).wins[0].strokes;
  const r9 = { ...round, format: '9', holes_played: 9 }, hs9 = hs.filter((h) => h.round_id !== round.round_id || h.hole <= 9), half = P.roundPayoff({ round: r9, holes: hs9, shots: [], history: hist, results: lagResults(4), games, ratings: null });
  assert.ok(half.wins.length === 0 || half.wins[0].strokes < full, 'half the holes, fewer strokes');
});
t('payoff: not enough history, or a part round, gives nothing and says why', () => {
  const { round, hs } = dataset(4, 0); assert.equal(P.roundPayoff({ round, holes: hs, history: base(3), results: lagResults(4), games }).reason, 'history');
  assert.equal(P.roundPayoff({ round: { ...round, format: 'partial', holes_played: 5 }, holes: hs, history: base(10), games }).reason, 'holes');
});
t('payoff: junk input never throws', () => { P.roundPayoff({}); P.predict({}); P.predictionHistory({}); P.predictionRun([]); });
console.log(`payoff: ${n} tests passed`);
