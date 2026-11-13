// Unit tests for the game-screen helpers (phase B): what an answer means (good / not good, one-word verdict), streaks, passing the target, the shot art.
// Run: node tests/gamescreen.test.mjs
import assert from 'node:assert/strict';
import * as G from '../games.js';
import * as F from '../features.js';
import * as FEEL from '../feel.js';
import * as I from '../icons.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id);
const list = (id, seed = 1) => G.steps(game(id), { seed });

t('every guided game has steps, and every answer has a verdict word in the copy', () => {
  for (const id of G.GUIDED) {
    const g = game(id), l = G.steps(g, { seed: 3 }); assert.ok(l && l.length, id);
    const vals = l[0].input === 'strokes' ? [1, 2, 3, 4, 5] : l[0].input === 'distance' ? [200, 250] : [0, 1];
    for (const v of vals) {
      const ball = l[0].input === 'distance' && l[0].results ? { r: v === 200 ? 'm' : 'f' } : undefined;
      const o = G.outcomeOf(g, l[0], v, { ball, before: [] });
      assert.ok(G.VERDICT_KEYS.includes(o.key), `${id}: ${o.key}`); assert.ok(FEEL.COPY.verdict[o.key], `${id}: no word for ${o.key}`);
    }
  }
});
t('every verdict word is one short plain word', () => {
  for (const k of G.VERDICT_KEYS) { const w = FEEL.COPY.verdict[k]; assert.match(w, /^[A-Z][a-z]+$/, k); assert.ok(w.length <= 9, k); }
});
t('hit / miss games: a hit is good and uses the game\'s own word; a miss is "Missed" (or "Outside")', () => {
  const want = { 'putt-369': 'holed', 'putt-lag': 'inside', 'chip-updown': 'saved', 'chip-zone': 'on', 'range-fairways': 'fairway', 'range-greens': 'inside', 'range-wedge': 'inside', 'range-round': 'worked', 'putt-streak': 'holed' };
  for (const [id, k] of Object.entries(want)) {
    const g = game(id), s = list(id)[0];
    assert.deepEqual(G.outcomeOf(g, s, 1), { good: true, key: k }, id);
    const m = G.outcomeOf(g, s, 0); assert.equal(m.good, false, id); assert.ok(['missed', 'outside'].includes(m.key), id);
  }
  assert.equal(G.outcomeOf(game('range-greens'), list('range-greens')[0], 0).key, 'outside');
  assert.equal(G.outcomeOf(game('putt-369'), list('putt-369')[0], 0).key, 'missed');
});
t('strokes games: par or better is good; birdie, par, bogey, double, over', () => {
  const g = game('putt-par18'), s = list('putt-par18')[0];
  assert.deepEqual([1, 2, 3, 4, 5].map((v) => G.outcomeOf(g, s, v).key), ['birdie', 'par', 'bogey', 'double', 'over']);
  assert.deepEqual([1, 2, 3, 4, 5].map((v) => G.outcomeOf(g, s, v).good), [true, true, false, false, false]);
});
t('Driver test: fairway good, missed and wide not good; Max out: longest ball so far is good, others are only logged', () => {
  const dr = game('range-driver'), ds = list('range-driver')[0];
  assert.deepEqual(G.outcomeOf(dr, ds, 250, { ball: { r: 'f' } }), { good: true, key: 'fairway' });
  assert.deepEqual(G.outcomeOf(dr, ds, 230, { ball: { r: 'm' } }), { good: false, key: 'missed' });
  assert.deepEqual(G.outcomeOf(dr, ds, 125, { ball: { r: 'w' } }), { good: false, key: 'wide' });
  const sp = game('range-speed'), ss = list('range-speed')[0];
  assert.deepEqual(G.outcomeOf(sp, ss, 240, { ball: { r: 'f' }, before: [] }), { good: null, key: 'logged' });
  assert.deepEqual(G.outcomeOf(sp, ss, 255, { ball: { r: 'f' }, before: [240] }), { good: true, key: 'longest' });
  assert.deepEqual(G.outcomeOf(sp, ss, 250, { ball: { r: 'f' }, before: [240, 255] }), { good: null, key: 'logged' });
});
t('a missing or odd answer is never a verdict of success', () => {
  assert.equal(G.outcomeOf(game('putt-369'), list('putt-369')[0], NaN).good, null);
  assert.equal(G.outcomeOf(game('putt-369'), undefined, 1).good, null);
});

t('streak: counts good answers at the end of the list, resets on a miss, and agrees after undo', () => {
  const g = game('putt-369'), l = list('putt-369');
  assert.equal(G.streakOf(g, l, []), 0);
  assert.equal(G.streakOf(g, l, [1, 1, 1]), 3);
  assert.equal(G.streakOf(g, l, [1, 1, 1, 0]), 0);
  assert.equal(G.streakOf(g, l, [1, 1, 1, 0, 1, 1]), 2);
  assert.equal(G.streakOf(g, l, [1, 1, 1, 0, 1, 1].slice(0, 5)), 1);
});
t('streak: strokes games count par or better; Driver test counts fairways; Max out has no streak', () => {
  const p = game('putt-par18'), pl = list('putt-par18');
  assert.equal(G.streakOf(p, pl, [2, 1, 2, 3, 2, 2]), 2);
  const d = game('range-driver'), dl = list('range-driver');
  assert.equal(G.streakOf(d, dl, [250, 250, 230], [{ r: 'f' }, { r: 'f' }, { r: 'm' }]), 0);
  assert.equal(G.streakOf(d, dl, [230, 250, 250], [{ r: 'm' }, { r: 'f' }, { r: 'f' }]), 2);
  const s = game('range-speed'), sl = list('range-speed');
  assert.equal(G.countsStreak(s), false); assert.equal(G.streakOf(s, sl, [200, 220, 240], [{}, {}, {}]), 0);
});
t('streak milestones are 3, 5 and 10', () => { assert.deepEqual(G.STREAK_MILESTONES, [3, 5, 10]); });

t('target: true only on the answer that first reaches it', () => {
  const g = game('putt-369'), l = list('putt-369');
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1], null, 5), false);
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1, 1], null, 5), true);
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1, 1, 1], null, 5), false, 'the next ball is not a second moment');
  assert.equal(G.targetPassed(g, l, [1, 0, 1, 1, 1, 1], null, 5), true, 'misses on the way do not matter');
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1, 1].slice(0, 4), null, 5), false, 'undo takes the moment back');
});
t('target: not shown when there is no target, for lower-is-better games, or with nothing answered', () => {
  const g = game('putt-369'), l = list('putt-369');
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1, 1], null, undefined), false);
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1, 1], null, null), false);
  assert.equal(G.targetPassed(g, l, [], null, 0), false);
  const p = game('putt-par18'); assert.equal(p.better, 'lower');
  assert.equal(G.targetPassed(p, list('putt-par18'), [2, 2, 2, 2, 2], null, 10), false);
});
t('target: works for the open streak game', () => {
  const g = game('putt-streak'), l = list('putt-streak');
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1, 1], null, 5), true);
  assert.equal(G.targetPassed(g, l, [1, 1, 1, 1, 1, 0], null, 5), false);
});

t('shot art: every kind is a small inline SVG that uses only token colours', () => {
  assert.ok(I.ART_KINDS.length >= 8);
  for (const k of I.ART_KINDS) {
    const s = I.shotArt(k); assert.match(s, /^<svg [^>]*viewBox="0 0 240 84"/, k); assert.ok(s.endsWith('</svg>'), k);
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(s), `${k}: no hard-coded hex colours`); assert.ok(!/<script|href=|<image/i.test(s), k);
    assert.ok(s.length < 1800, `${k}: ${s.length} bytes`);
  }
  assert.equal(I.shotArt('nonsense'), I.shotArt('putt'), 'an unknown kind falls back to the putt');
});
t('icons for the buttons exist', () => { for (const k of ['tick', 'cross', 'flame', 'sound', 'soundoff']) assert.match(I.icon(k, 20), /^<svg/, k); });
t('the feedback delay is about 450 ms and can be overridden for tests', () => {
  assert.equal(FEEL.feedbackMs(), 450); globalThis.__feelDelay = 0; assert.equal(FEEL.feedbackMs(), 0); globalThis.__feelDelay = -5; assert.equal(FEEL.feedbackMs(), 450); delete globalThis.__feelDelay;
});

console.log(`\n${n} passed`);
