// Unit tests for the pure pieces behind the phase D screens: the tier ring on a game card, and the wording of the daily card and the session screens.
// Run: node tests/aroundgames.test.mjs
import assert from 'node:assert/strict';
import * as G from '../games.js';
import * as F from '../features.js';
import * as FEEL from '../feel.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id);
const res = (g, score, date = '2026-11-01', id = `r${score}${date}`) => ({ id, game: g.id, score, date });
const hi = game('putt-369'), lo = game('putt-par18'), own = game('range-speed');

t('tierProgress: nothing played has an empty ring and no tier', () => {
  const p = G.tierProgress(hi, []); assert.deepEqual([p.p, p.tier, p.best], [0, null, null]);
});
t('tierProgress: before the first tier, the ring is the share of the first tier score reached', () => {
  const p = G.tierProgress(hi, [res(hi, 3)]);                        // Bronze is 5 on the 3-6-9 ladder
  assert.equal(p.tier, null); assert.equal(p.next.key, 'bronze'); assert.equal(p.p, 0.6);
});
t('tierProgress: a tier just reached starts a new ring at 0, and it fills towards the next tier', () => {
  assert.equal(G.tierProgress(hi, [res(hi, 6)]).tier.key, 'silver'); assert.equal(G.tierProgress(hi, [res(hi, 6)]).p, 0);
  const ts = G.tierScores(hi, 1), mid = (ts[1].score + ts[2].score) / 2, p = G.tierProgress(hi, [res(hi, mid)]);
  assert.equal(p.tier.key, 'silver'); assert.ok(p.p > 0 && p.p < 1);
});
t('tierProgress: the top tier is a full ring with no next tier', () => {
  const p = G.tierProgress(hi, [res(hi, 9)]); assert.equal(p.tier.key, 'platinum'); assert.equal(p.next, null); assert.equal(p.p, 1);
});
t('tierProgress: a lower-is-better game with no tier starts the ring at the first score played', () => {
  const p = G.tierProgress(lo, [res(lo, 24, '2026-11-01'), res(lo, 22, '2026-11-02')]);
  assert.equal(p.tier, null); assert.equal(p.p, 0.4);                // 24 -> Bronze at 19: 22 is two of the five strokes
});
t('tierProgress: the ring never goes outside 0 to 1, even when the best score is worse than the first', () => {
  for (const rs of [[res(lo, 30, '2026-11-01'), res(lo, 31, '2026-11-02')], [res(hi, 0)], [res(hi, 9), res(hi, 0, '2026-11-02')]]) {
    const g = rs[0].game === lo.id ? lo : hi, p = G.tierProgress(g, rs).p; assert.ok(p >= 0 && p <= 1, String(p));
  }
});
t('tierProgress: an own-history game says how many plays are needed before it has tiers', () => {
  const p = G.tierProgress(own, [res(own, 200), res(own, 210, '2026-11-02')]); assert.equal(p.ladder, false); assert.equal(p.own, true); assert.equal(G.OWN.min_scores - 2, p.need); assert.equal(p.p, 0);
});
t('tierProgress: an own-history game with enough scores has a ladder and a ring', () => {
  const rs = Array.from({ length: G.OWN.min_scores + 2 }, (_, i) => res(own, 200 + 5 * (i % 4), `2026-10-${String(10 + i).padStart(2, '0')}`));
  const p = G.tierProgress(own, rs); assert.equal(p.ladder, true); assert.ok(p.p >= 0 && p.p <= 1);
});
t('the daily card counts the streak in weeks, in plain words', () => {
  assert.equal(FEEL.COPY.daily.streak(0), 'no streak yet'); assert.equal(FEEL.COPY.daily.streak(1), '1 week in a row'); assert.equal(FEEL.COPY.daily.streak(3), '3 weeks in a row');
  assert.ok(!/\bdays?\b/i.test(FEEL.COPY.daily.streak(3) + FEEL.COPY.daily.play), 'no days on the daily card');
});
t('the session screens use the wording in the plan, with the app name', () => {
  assert.equal(FEEL.COPY.progress(2, 3), '2 of 3 done'); assert.equal(FEEL.COPY.next, 'Up next'); assert.equal(FEEL.COPY.session.start('Up & down 9'), 'Start Up & down 9');
  assert.equal(FEEL.COPY.session.better(1, 4), '1 of 4 skills better than last test'); assert.equal(FEEL.COPY.session.better(1, 1), '1 of 1 skill better than last test');
  assert.equal(FEEL.COPY.session.rated(1), '1 skill rated'); assert.ok(!/golfiq/i.test(JSON.stringify(FEEL.COPY.session) + JSON.stringify(FEEL.COPY.daily)));
});
console.log(`${n} passed`);
