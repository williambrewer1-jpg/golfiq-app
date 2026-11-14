// Unit tests for the result screen's pure pieces (phase C): the headline, which sound and confetti a finish gets, and the wording.
// Run: node tests/resultscreen.test.mjs
import assert from 'node:assert/strict';
import * as G from '../games.js';
import * as F from '../features.js';
import * as FEEL from '../feel.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id);
const hi = game('putt-369'), lo = game('putt-par18');

t('verdict: a personal best needs a score to beat, so a first play never is one', () => {
  assert.equal(G.verdictOf(hi, 4, { target: 5.6, prevBest: null }).pb, false);
  assert.equal(G.verdictOf(hi, 4, { target: 5.6 }).pb, false);
  assert.equal(G.verdictOf(hi, 4, { target: 5.6, prevBest: 3 }).pb, true);
});
t('verdict: equalling your best is not a personal best', () => { assert.equal(G.verdictOf(hi, 6, { target: 5.6, prevBest: 6 }).pb, false); });
t('verdict: higher-is-better — met, short with how far, or no target', () => {
  assert.deepEqual(G.verdictOf(hi, 6, { target: 5.6, prevBest: 7 }), { key: 'met', pb: false, met: true, diff: 0 });
  assert.deepEqual(G.verdictOf(hi, 5.6, { target: 5.6, prevBest: 7 }).key, 'met', 'reaching the target exactly counts');
  assert.deepEqual(G.verdictOf(hi, 2, { target: 5.6, prevBest: 7 }), { key: 'short', pb: false, met: false, diff: 3.6 });
  assert.deepEqual(G.verdictOf(hi, 2, { target: null, prevBest: 7 }), { key: 'done', pb: false, met: false, diff: 0 });
  assert.equal(G.verdictOf(hi, 2, {}).key, 'done');
});
t('verdict: lower-is-better (strokes) — fewer is a personal best and meets the target', () => {
  assert.equal(G.verdictOf(lo, 15, { target: 16.4, prevBest: 18 }).pb, true);
  assert.equal(G.verdictOf(lo, 19, { target: 16.4, prevBest: 18 }).pb, false);
  assert.deepEqual(G.verdictOf(lo, 16, { target: 16.4, prevBest: 16 }), { key: 'met', pb: false, met: true, diff: 0 });
  assert.deepEqual(G.verdictOf(lo, 20, { target: 16.4, prevBest: 16 }), { key: 'short', pb: false, met: false, diff: 3.6 });
});
t('verdict: a personal best that also meets the target keeps both; the headline is the best', () => {
  const v = G.verdictOf(hi, 7, { target: 5.6, prevBest: 6 }); assert.equal(v.key, 'pb'); assert.equal(v.met, true);
  const w = G.verdictOf(hi, 5, { target: 5.6, prevBest: 4 }); assert.equal(w.key, 'pb'); assert.equal(w.met, false); assert.equal(w.diff, 0.6);
});
t('verdict: odd values never read as success', () => {
  assert.equal(G.verdictOf(hi, NaN, { target: 5.6, prevBest: 1 }).key, 'done'); assert.equal(G.verdictOf(hi, undefined, { target: 5.6 }).met, false);
});
t('celebration: a new tier beats a personal best beats a met target; a plain finish has no confetti', () => {
  const v = (o) => G.verdictOf(hi, ...o);
  assert.deepEqual(G.celebrationOf({ verdict: v([7, { target: 5.6, prevBest: 6 }]), tierUp: true }), { sound: 'tier', confetti: true });
  assert.deepEqual(G.celebrationOf({ verdict: v([7, { target: 5.6, prevBest: 6 }]) }), { sound: 'pb', confetti: true });
  assert.deepEqual(G.celebrationOf({ verdict: v([4, { target: 5.6, prevBest: 3 }]) }), { sound: 'pb', confetti: true }, 'a personal best below the target still celebrates');
  assert.deepEqual(G.celebrationOf({ verdict: v([6, { target: 5.6, prevBest: 6 }]) }), { sound: 'win', confetti: true });
  assert.deepEqual(G.celebrationOf({ verdict: v([2, { target: 5.6, prevBest: 6 }]) }), { sound: 'finish', confetti: false });
  assert.deepEqual(G.celebrationOf({ verdict: v([2, {}]) }), { sound: 'finish', confetti: false }, 'no target, nothing to celebrate');
  assert.deepEqual(G.celebrationOf({ verdict: v([2, { target: 5.6 }]), tierUp: true }), { sound: 'tier', confetti: true });
});
t('celebration: every sound it can pick is a defined event', () => {
  for (const s of ['tier', 'pb', 'win', 'finish']) assert.ok(FEEL.EVENT_NAMES.includes(s), s);
  assert.ok(FEEL.EVENT_NAMES.includes('unlock'));
});

t('wording: the level line reads like the plan ("That\'s a 9-handicap score")', () => {
  const L = FEEL.COPY.level;
  assert.equal(L(9), "That's a 9-handicap score."); assert.equal(L(9.4), "That's a 9-handicap score."); assert.equal(L(9.6), "That's a 10-handicap score.");
  assert.equal(L(0), "That's a scratch score or better."); assert.equal(L(25), "That's worse than a 25-handicap score.");
});
t('wording: verdict lines', () => {
  assert.equal(FEEL.COPY.met, 'Target met'); assert.equal(FEEL.COPY.best, 'New personal best'); assert.equal(FEEL.COPY.short(2), '2 short of your target'); assert.equal(FEEL.COPY.over(3), '3 over your target'); assert.equal(FEEL.COPY.done, 'Game complete');
});
t('wording: rewards use BreakingPar\'s plain words and call potential a target', () => {
  const K = FEEL.COPY.rewards;
  assert.equal(K.hit('2', 3), 'Hit 2 of 3'); assert.equal(K.noHit, 'Not a hit yet'); assert.equal(K.of('1', 3), '1 of 3'); assert.equal(K.weeks(1), 'week'); assert.equal(K.weeks(3), 'weeks');
  assert.match(K.note, /target/i); assert.doesNotMatch(K.note, /guarantee|will reach|forecast/i);
  assert.equal(K.leagueTotal(9, 2, 4), '9 points · 2nd of 4'); assert.equal(K.leagueTotal(1, 1, 3), '1 point · 1st of 3'); assert.equal(K.leagueTotal(5, 4, 6), '5 points · 4th of 6');
});
t('the reveal waits on the same test hook as the verdict window', () => {
  assert.equal(FEEL.revealMs(700), 700); globalThis.__feelDelay = 0; assert.equal(FEEL.revealMs(700), 0); globalThis.__feelDelay = 225; assert.equal(FEEL.revealMs(700), 350); globalThis.__feelDelay = -1; assert.equal(FEEL.revealMs(700), 700); delete globalThis.__feelDelay;
});

console.log(`\n${n} passed`);

t('verdictOf: a miss never rounds down to "0 short"', () => {
  const hi = { better: 'higher' }, lo = { better: 'lower' };
  assert.equal(G.verdictOf(hi, 5, { target: 5.04 }).diff, 0.1);
  assert.equal(G.verdictOf(lo, 16, { target: 15.96 }).diff, 0.1);
});
