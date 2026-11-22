import assert from 'node:assert/strict';
import * as H from '../howto.js';
import * as G from '../games.js';
import * as F from '../features.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id);
const guided = F.DEFAULT_GAMES.filter((g) => G.GUIDED.has(g.id));

t('every guided game has a how-to-play guide with an aim and four rows', () => {
  for (const g of guided) {
    const h = H.howTo(g); assert.ok(H.hasHow(g.id), g.id); assert.ok(h.aim.length > 10, g.id);
    assert.deepEqual(h.rows.map((r) => r.key), ['setup', 'each', 'tap', 'score'], g.id);
    for (const r of h.rows) assert.ok(r.text && r.label, `${g.id} ${r.key}`);
  }
});
t('the guide uses the golfer\'s unit', () => {
  assert.match(H.howTo(game('range-greens'), 0.9144).rows[0].text, /80 yd and 160 yd/);
  assert.match(H.howTo(game('range-greens'), 1).rows[0].text, /75 m and 145 m/);
  assert.doesNotMatch(JSON.stringify(H.howTo(game('range-wedge'), 1)), / yd/);
});
t('a game the golfer added falls back to its own description', () => {
  const h = H.howTo({ id: 'g-mine', name: 'Mine', how: 'Do the thing.', better: 'higher' }); assert.equal(h.aim, 'Do the thing.');
  assert.equal(H.howTo({ id: 'x' }), null); assert.equal(H.hasHow('g-mine'), false);
});
t('every hit-or-miss step asks a question and labels both buttons', () => {
  for (const g of guided) for (const [k, s] of G.steps(g, { seed: 4 }).entries()) {
    const a = H.askOf(g, s); assert.ok(a.q.endsWith('?') || a.q.endsWith('.'), `${g.id} ${k}: ${a.q}`);
    if (s.input === 'hit_miss') { assert.ok(a.yes && a.no && a.yes !== a.no, g.id); assert.notEqual(a.yes, 'Hit', `${g.id} has its own words`); }
  }
});
t('9-shot greens asks about 10% of the distance on the screen', () => {
  const g = game('range-greens'), s = G.steps(g, { seed: 2 }).find((x) => x.prompt.startsWith('120'));
  assert.equal(H.askOf(g, s).q, 'Did it finish within 12 yd of the target?');
});
t('stroke games say what to count and give par', () => {
  const s = G.steps(game('chip-par18'), { seed: 1 })[0]; assert.match(H.askOf(game('chip-par18'), s).q, /chip included\? Par 2/);
  assert.match(H.askOf(game('putt-par18'), G.steps(game('putt-par18'), { seed: 1 })[0]).q, /putts.*Par 2/);
});
t('the step text no longer repeats the question', () => {
  for (const g of guided) for (const s of G.steps(g, { seed: 9 })) assert.doesNotMatch(s.sub || '', /\?\s*$/, `${g.id}: ${s.sub}`);
});
console.log(`${n} passed`);
