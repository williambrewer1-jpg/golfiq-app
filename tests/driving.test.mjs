// Unit tests for the two driving games (Driver test, Max out): benchmark, ball scoring, range-ball adjustment, drafts, ghosts, skills links.
// Run: node tests/driving.test.mjs
import assert from 'node:assert/strict';
import * as B from '../bench.js';
import * as G from '../games.js';
import * as F from '../features.js';
import * as LG from '../league.js';
import { skillRatings, SKILLS, DRIVING, BENCH, distanceStrokes } from '../skills.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const YD = 0.9144, game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id), drv = game('range-driver'), spd = game('range-speed');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

t('both games exist, are guided, and are scored in the golfer\'s unit', () => {
  for (const g of [drv, spd]) { assert.ok(g, 'defined'); assert.equal(g.cat, 'Range'); assert.equal(g.better, 'higher'); assert.ok(g.distance); assert.ok(G.GUIDED.has(g.id)); assert.ok(G.minutesFor(g.id) > 0); }
  assert.equal(F.unitOf(drv, 'm'), 'm'); assert.equal(F.unitOf(drv, 'yd'), 'yd'); assert.equal(F.unitOf(game('putt-369'), 'm'), 'holed / 9');
});
t('Driver test benchmark: 275 at scratch, falling as handicap rises', () => {
  near(B.expectedFor('range-driver', 0), 275, 1e-9);                                           // 285 - 20 x (1 - 0.50)
  near(B.expectedFor('range-driver', 10), 259 - 20 * 0.52, 1e-9); near(B.expectedFor('range-driver', 20), 225 - 20 * 0.55, 1e-9);
  let prev = Infinity; for (let h = 0; h <= 25; h += 0.5) { const e = B.expectedFor('range-driver', h); assert.ok(e < prev, `h ${h}`); prev = e; }
  near(B.expectedFor('range-driver', 10, 1), B.expectedFor('range-driver', 10) * YD, 1e-9, 'metres');
  assert.ok(B.NOTES['range-driver'].includes('assumes no wide balls'), 'the note says what is assumed');
});
t('ten fairways at 259 yd rate better than a 10 handicap; a level round-trips', () => {
  assert.ok(B.level('range-driver', 259, 'higher', YD).h < 10);
  for (const h of [0, 5, 10, 15, 20]) near(B.level('range-driver', B.expectedFor('range-driver', h, YD), 'higher', YD).h, h, 0.05);
  for (const h of [5, 10, 20]) near(B.level('range-driver', B.expectedFor('range-driver', h, 1), 'higher', 1).h, h, 0.05, 'metres');
});
t('Max out has no handicap level, only your own history', () => { assert.equal(B.hasLevel('range-speed'), false); assert.ok(B.NO_LEVEL['range-speed']); assert.equal(B.level('range-speed', 250), null); });
t('steps: ten balls with a where-did-it-finish choice; five balls for Max out without one', () => {
  const a = G.steps(drv, { seed: 3 }), b = G.steps(spd, { seed: 3 });
  assert.equal(a.length, 10); assert.ok(a.every((s) => s.input === 'distance' && s.results === true)); assert.equal(b.length, 5); assert.ok(b.every((s) => s.input === 'distance' && s.results === false));
});
t('effective distance: fairway full, miss 20 yd less, wide half', () => {
  assert.equal(G.ballValue({ d: 250, r: 'f' }), 250); assert.equal(G.ballValue({ d: 250, r: 'm' }), 230); assert.equal(G.ballValue({ d: 250, r: 'w' }), 125);
  near(G.ballValue({ d: 230, r: 'm' }, 1), 230 - 20 * YD, 0.05, 'a miss costs 18.3 m when playing in metres');
  assert.equal(G.ballValue({ d: 10, r: 'm' }), 0, 'never below zero');
});
t('range-ball adjustment scales the distance before the miss and wide rules', () => {
  assert.equal(G.ballValue({ d: 200, r: 'f', a: 10 }), 220); assert.equal(G.ballValue({ d: 200, r: 'm', a: 10 }), 200); assert.equal(G.ballValue({ d: 200, r: 'w', a: 10 }), 110);
  assert.equal(G.ballValue({ d: 200, r: 'f', a: 0 }), 200); near(G.adjusted({ d: 200, a: 15 }), 230, 1e-9);
});
t('score: Driver test is the average effective distance, Max out the longest ball', () => {
  const l = G.steps(drv, { seed: 1 }), a = [250, 230, 125, 240];
  assert.equal(G.scoreOf(drv, l, a).score, 211.3); assert.equal(G.scoreOf(drv, l, a).done, false); assert.equal(G.scoreOf(drv, l, new Array(10).fill(240)).done, true);
  assert.equal(G.scoreOf(drv, l, []).score, 0);
  const s = G.steps(spd, { seed: 1 }); assert.equal(G.scoreOf(spd, s, [240, 262.5, 251]).score, 262.5); assert.equal(G.scoreOf(spd, s, [1, 2, 3, 4, 5]).done, true);
});
t('summary counts fairways, misses and wide balls', () => {
  const m = G.driverSummary([{ d: 250, r: 'f' }, { d: 240, r: 'f' }, { d: 230, r: 'm' }, { d: 220, r: 'w' }, { d: 200, r: 'f', a: 10 }]);
  assert.deepEqual([m.n, m.fairways, m.missed, m.wides, m.avg, m.longest], [5, 3, 1, 1, 232, 250]);
});
t('a draft keeps the adjustment it was started with; other games get no extra fields', () => {
  const d = G.newDraft(drv, { seed: 1, adj: 8 }), p = G.newDraft(game('putt-369'), { seed: 1, adj: 8 });
  assert.deepEqual([d.adj, d.premium, d.balls], [8, false, []]); assert.equal(p.adj, undefined); assert.equal(p.balls, undefined);
  assert.equal(G.newDraft(drv, { seed: 1, adj: 40 }).adj, B.DRIVER_TEST.adj_max); assert.equal(G.newDraft(drv, { seed: 1, adj: -3 }).adj, 0); assert.equal(G.newDraft(drv, { seed: 1 }).adj, 0);
});
t('the result keeps per-ball detail, plain numbers for ghosts, and the Driver test summary', () => {
  const d = G.newDraft(drv, { seed: 9, adj: 0 }), kinds = ['f', 'f', 'm', 'f', 'w', 'f', 'f', 'm', 'f', 'f'];
  kinds.forEach((r, i) => { const b = { d: 240 + i, r, a: 0 }; d.balls.push(b); d.answers.push(G.ballValue(b)); });
  const res = G.resultFromDraft(d, drv, { date: '2026-11-14', id: 'x' });
  assert.equal(res.mode, 'guided'); assert.equal(res.detail.length, 10); assert.ok(res.detail.every(Number.isFinite)); assert.equal(res.balls.length, 10);
  assert.deepEqual([res.fairways, res.wides, res.avg_dist], [7, 1, 244.5]); assert.equal(res.score, G.scoreOf(drv, G.steps(drv, { seed: 9 }), res.detail).score);
  const s = G.newDraft(spd, { seed: 2 }); [230, 251, 244].forEach((x) => { s.balls.push({ d: x, r: 'f', a: 0 }); s.answers.push(x); });
  assert.equal(G.resultFromDraft(s, spd, {}).longest, 251);
});
t('pressure ball: has to find the fairway (Driver test) or match the longest (Max out); the saved score stays plain', () => {
  const l = G.steps(drv, { seed: 1 }), a = new Array(10).fill(240), fw = a.map(() => ({ r: 'f' })), mi = [...fw.slice(0, 9), { r: 'm' }];
  assert.equal(G.pressureOf(drv, l, a, fw).hit, true); assert.equal(G.pressureOf(drv, l, a, mi).hit, false); assert.equal(G.pressureOf(drv, l, a, mi).delta, 0);
  const s = G.steps(spd, { seed: 1 }); assert.equal(G.pressureOf(spd, s, [240, 250, 255, 249, 256]).hit, true); assert.equal(G.pressureOf(spd, s, [240, 250, 255, 249, 250]).hit, false);
  assert.match(G.pressureRule(drv), /fairway/); assert.match(G.pressureRule(spd), /longest/); assert.equal(G.pressureRule(game('putt-streak')), 'the last putt ends it'); assert.equal(G.pressureRule(game('putt-369')), 'the last step counts double');
});
t('ghost play: the friend\'s average (or longest) after k balls', () => {
  assert.equal(LG.partial(drv, [250, 230, 210, 250], 2), 240); assert.equal(LG.partial(drv, [250, 230], 4), 240);
  assert.equal(LG.partial(spd, [230, 250, 240], 2), 250);
  assert.equal(LG.compareAt(drv, [260, 250], [250, 230], 2).state, 'ahead'); assert.equal(LG.compareAt(drv, [200], [230], 1).state, 'behind');
});
t('tiers for the Driver test are the 20, 10, 5 and 0 handicap scores in your unit', () => {
  const ts = G.tierScores(drv, YD); assert.deepEqual(ts.map((x) => x.key), ['bronze', 'silver', 'gold', 'platinum']);
  assert.equal(ts[0].score, Math.ceil(B.expectedFor('range-driver', 20, YD))); assert.equal(ts[3].score, 275);
  assert.ok(G.tierScores(drv, 1)[3].score < ts[3].score, 'fewer metres for the same tier');
  assert.equal(G.tierFor(drv, 276, YD).tier.key, 'platinum'); assert.equal(G.tierFor(drv, 100, YD).tier, null);
});

// ------------------------------------------------------------------ skills: links and the strokes value of distance
t('skills: both games train distance; the Driver test also trains accuracy and tee penalties', () => {
  const sub = (k) => SKILLS.find((s) => s.key === 'driving').subs.find((s) => s.key === k);
  assert.deepEqual(sub('distance').games, ['range-driver', 'range-speed']); assert.ok(sub('penalties').games.includes('range-driver')); assert.ok(sub('accuracy').games.includes('range-driver'));
  assert.equal(sub('distance').weight, DRIVING.distance_weight); assert.equal(DRIVING.distance_weight, 0.4);
  near(SKILLS.find((s) => s.key === 'driving').subs.reduce((t, x) => t + x.weight, 0), 1, 1e-9);
});
function golfer(distYd, { approachYd = 150, perRound = 14 } = {}) {
  const rounds = [], shots = [];
  for (let r = 0; r < 20; r++) { const d = new Date(2026, 0, 1 + r).toISOString().slice(0, 10); rounds.push({ round_id: `r${r}`, format: '18', date: d, start_time_local: `${d}T09:00:00` }); }
  for (let k = 0; k < 20 * perRound; k++) shots.push({ round_id: `r${k % 20}`, hole: 1, category: 'tee', club_category: 'driver', dist_m: distYd * YD, ends_in_penalty: 0 });
  for (let k = 0; k < 40; k++) shots.push({ round_id: `r${k % 20}`, category: 'approach', start_to_pin: approachYd * YD, end_to_pin: 20, on_green_end: 1 });
  return { rounds, holes: [], shots };
}
const dist = (r) => r.skills.find((s) => s.key === 'driving').subs.find((s) => s.key === 'distance');
const rate = (d, o, extra = {}) => skillRatings({ ...golfer(d, o), results: [], games: F.DEFAULT_GAMES, unitM: YD, ...extra });
t('distance now has a strokes value, and it counts towards the Driving skill', () => {
  const r = rate(215), s = dist(r), sk = r.skills.find((x) => x.key === 'driving');
  assert.ok(s.enough && s.strokes > 0.2 && s.strokes < 2, `strokes ${s.strokes}`); assert.ok(sk.strokes >= s.strokes - 1e-9); assert.equal(s.context_only, undefined);
  assert.ok(/model/.test(s.how), 'the how-text says it is a model');
  assert.ok(s.games.find((g) => g.id === 'range-driver').target > 200, 'driver test target'); assert.equal(s.games.find((g) => g.id === 'range-speed').target, null, 'Max out has no target');
});
t('distance strokes: more yards to find is worth more (same handicap); nothing once you are past the target', () => {
  const m = { you: 220, per_round: 14, approach_yd: 150 }; let prev = 0;
  for (const tgt of [225, 235, 245, 255, 265, 275]) { const v = distanceStrokes(m, tgt, 12); assert.ok(v >= prev - 1e-12 && v > 0, `${tgt} ${v}`); prev = v; }
  assert.equal(distanceStrokes(m, 200, 12), 0); assert.equal(distanceStrokes({ ...m, you: null }, 250, 12), 0); assert.equal(dist(rate(320)).strokes, 0);
  assert.ok(distanceStrokes(m, 250, 12) / 3 < 0.5, 'under half a shot per 10 yd: a modest figure');
});
t('distance strokes use your own approach distance and driver shots a round', () => {
  assert.ok(dist(rate(220, { approachYd: 190 })).strokes > dist(rate(220, { approachYd: 100 })).strokes, 'longer approaches gain more from a longer drive');
  near(dist(rate(220, { perRound: 7 })).strokes * 2, dist(rate(220, { perRound: 14 })).strokes, 0.02, 'half the drives, half the value');
  assert.ok(dist(rate(220, { approachYd: 40 })).strokes > 0, 'falls back to the default approach distance when none of your approaches are in range');
});
t('distance still needs enough drives to be rated', () => { const s = dist(rate(215, { perRound: 0.5 })); assert.equal(s.enough, false); assert.equal(s.strokes, 0); });
t('a Driver test result gives the Driving skill a practice level', () => {
  const results = [{ id: 'a', game: 'range-driver', date: '2026-11-01', score: B.expectedFor('range-driver', 12, YD) }];
  const r = skillRatings({ rounds: [], holes: [], shots: [], results, games: F.DEFAULT_GAMES, unitM: YD }), sk = r.skills.find((x) => x.key === 'driving');
  near(sk.practice_hcp, 12, 0.1); for (const k of ['distance', 'penalties', 'accuracy']) near(sk.subs.find((s) => s.key === k).practice_hcp, 12, 0.1, k);
  const only = [{ id: 'b', game: 'range-speed', date: '2026-11-01', score: 250 }];
  assert.equal(skillRatings({ rounds: [], holes: [], shots: [], results: only, games: F.DEFAULT_GAMES, unitM: YD }).skills.find((x) => x.key === 'driving').practice_hcp, null, 'Max out never rates the handicap');
});
t('the benchmark table moved to bench.js and skills.js still agrees with it', () => { for (const h of [0, 7, 10, 18, 25]) assert.equal(BENCH['driving.distance'](h), B.driverYd(h)); assert.deepEqual(B.DRIVER_YD, [285, 259, 225]); });
console.log(`${n} tests passed`);
