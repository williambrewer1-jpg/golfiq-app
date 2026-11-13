import assert from 'node:assert/strict';
import * as G from '../games.js';
import * as F from '../features.js';
import * as B from '../bench.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id);
const entry = F.DEFAULT_GAMES.filter((g) => !g.auto);

t('every non-auto game has steps and minutes', () => {
  for (const g of entry) { const s = G.steps(g, { seed: 7 }); assert.ok(s?.length, g.id); assert.ok(G.minutesFor(g.id) > 0, g.id); }
  assert.equal(G.steps(game('combine'), {}), null);
});
t('step counts match the game maximum', () => {
  for (const g of entry) if (g.max && g.id !== 'putt-streak') assert.equal(G.steps(g, { seed: 3 }).length, g.max, g.id);
  assert.equal(G.steps(game('putt-par18'), { seed: 3 }).length, 9);
});
t('same seed gives the same steps; different seed differs', () => {
  const a = JSON.stringify(G.steps(game('range-wedge'), { seed: 5 })), b = JSON.stringify(G.steps(game('range-wedge'), { seed: 5 })), c = JSON.stringify(G.steps(game('range-wedge'), { seed: 6 }));
  assert.equal(a, b); assert.notEqual(a, c);
});
t('wedge distances are 40–100 in yards and sensible in metres', () => {
  for (const s of G.steps(game('range-wedge'), { seed: 11, unitM: 0.9144 })) { const d = parseInt(s.prompt, 10); assert.ok(d >= 40 && d <= 100 && d % 5 === 0, s.prompt); assert.match(s.prompt, /yd/); }
  for (const s of G.steps(game('range-wedge'), { seed: 11, unitM: 1 })) { const d = parseInt(s.prompt, 10); assert.ok(d >= 35 && d <= 95 && d % 5 === 0, s.prompt); assert.match(s.prompt, / m/); }
});
t('score is hits for hit_miss and the sum for strokes', () => {
  const g = game('putt-369'), l = G.steps(g, { seed: 1 });
  assert.equal(G.scoreOf(g, l, [1, 1, 0, 1, 0, 0, 1, 1, 1]).score, 6);
  assert.equal(G.scoreOf(g, l, [1, 1]).done, false); assert.equal(G.scoreOf(g, l, new Array(9).fill(1)).done, true);
  const p = game('putt-par18'), pl = G.steps(p, { seed: 1 });
  assert.equal(G.scoreOf(p, pl, [2, 2, 3, 1, 2, 2, 2, 3, 2]).score, 19);
});
t('streak ends on the first miss and scores the run', () => {
  const g = game('putt-streak'), l = G.steps(g, { seed: 1 });
  assert.deepEqual([G.scoreOf(g, l, [1, 1, 1]).done, G.scoreOf(g, l, [1, 1, 1]).score], [false, 3]);
  assert.deepEqual([G.scoreOf(g, l, [1, 1, 1, 0]).done, G.scoreOf(g, l, [1, 1, 1, 0]).score], [true, 3]);
  assert.equal(G.scoreOf(g, l, [0]).score, 0);
});
t('pressure: last hit is a bonus, last miss costs a point, strokes add one', () => {
  const g = game('chip-zone'), l = G.steps(g, { seed: 1 }), a = [1, 1, 1, 0, 0, 0, 0, 0, 0, 1], b = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(G.scoreOf(g, l, a).score, 4); assert.equal(G.pressureScore(g, l, a), 5); assert.equal(G.pressureScore(g, l, b), 2);
  const p = game('putt-par18'), pl = G.steps(p, { seed: 1 });
  assert.equal(G.pressureOf(p, pl, [2, 2, 2, 2, 2, 2, 2, 2, 3]).delta, 1); assert.equal(G.pressureOf(p, pl, [2, 2, 2, 2, 2, 2, 2, 2, 2]).delta, 0);
  assert.equal(G.pressureScore(g, l, [0, 0]), 0);                                                  // never below zero
});
t('tiers are the 20, 10, 5 and 0 handicap scores, in strictly better order', () => {
  for (const g of entry.filter((x) => B.hasLevel(x.id))) {
    const ts = G.tierScores(g, 0.9144), lower = g.better === 'lower';
    assert.deepEqual(ts.map((x) => x.key), ['bronze', 'silver', 'gold', 'platinum'], g.id);
    for (let i = 1; i < 4; i++) assert.ok(lower ? ts[i].score < ts[i - 1].score : ts[i].score > ts[i - 1].score || (g.max && ts[i].score === g.max), `${g.id} ${JSON.stringify(ts)}`);
    if (g.max) for (const x of ts) assert.ok(x.score <= g.max, g.id);
  }
  const ts = G.tierScores(game('putt-369'), 0.9144);
  assert.equal(ts[0].score, Math.ceil(B.expectedFor('putt-369', 20)));
});
t('tierFor gives current and next tier', () => {
  const g = game('putt-369'), ts = G.tierScores(g), f = (s) => G.tierFor(g, s);
  assert.equal(f(0).tier, null); assert.equal(f(0).next.key, 'bronze');
  assert.equal(f(ts[1].score).tier.key, 'silver'); assert.equal(f(ts[1].score).next.key, 'gold');
  assert.equal(f(9).tier.key, 'platinum'); assert.equal(f(9).next, null);
  const p = game('putt-par18'), pt = G.tierScores(p);
  assert.equal(G.tierFor(p, pt[0].score).tier.key, 'bronze'); assert.equal(G.tierFor(p, pt[0].score + 1).tier, null);
});
t('tierUp only fires when a better tier is reached', () => {
  const g = game('putt-369'), ts = G.tierScores(g);
  assert.equal(G.tierUp(g, null, ts[0].score).key, 'bronze');
  assert.equal(G.tierUp(g, ts[0].score, ts[0].score), null);
  assert.equal(G.tierUp(g, ts[0].score, ts[2].score).key, 'gold');
  assert.equal(G.tierUp(g, ts[2].score, ts[0].score), null);
});
t('games with no benchmark have no tiers', () => { assert.equal(G.tierScores(game('range-round')), null); assert.equal(G.tierFor(game('range-round'), 10), null); });
t('tier badges are earned on the first date the score was reached', () => {
  const g = game('putt-369'), ts = G.tierScores(g), res = [{ game: g.id, score: ts[0].score, date: '2026-01-02' }, { game: g.id, score: ts[1].score, date: '2026-02-03' }];
  const b = G.tierBadges([g], res).reduce((m, x) => ({ ...m, [x.tier]: x.earned }), {});
  assert.equal(b.bronze, '2026-01-02'); assert.equal(b.silver, '2026-02-03'); assert.equal(b.gold, null);
});
t('a draft turns into a normal result plus detail, seed and pressure', () => {
  const g = game('chip-zone'), d = G.newDraft(g, { seed: 42, pressure: true });
  d.answers = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1];
  const r = G.resultFromDraft(d, g, { date: '2026-05-01', id: 'r1' });
  assert.deepEqual([r.game, r.score, r.mode, r.seed, r.pressure, r.pressure_hit, r.date], ['chip-zone', 6, 'guided', 42, true, true, '2026-05-01']);
  assert.deepEqual(r.detail, d.answers);
  const d2 = G.newDraft(g, { seed: 1 }); d2.answers = new Array(10).fill(0); assert.equal(G.resultFromDraft(d2, g).pressure, undefined);
});
t('a pressure miss is stored as not a hit, so it does not count extra', () => {
  const g = game('chip-zone'), d = G.newDraft(g, { seed: 1, pressure: true }); d.answers = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0];
  assert.equal(G.resultFromDraft(d, g).pressure_hit, false);
});
t('game with a game-level seed is reproducible from a result', () => {
  const g = game('range-greens'), d = G.newDraft(g, { seed: 99, unitM: 1 });
  assert.equal(JSON.stringify(G.steps(g, { seed: d.seed, unitM: d.unitM })), JSON.stringify(G.steps(g, { seed: 99, unitM: 1 })));
});
console.log(`${n} tests passed`);
