// Unit tests for own-history tiers (Max out and the simple Range round have no handicap benchmark, so tiers come from the golfer's own scores).
// Run: node tests/owntiers.test.mjs
import assert from 'node:assert/strict';
import * as G from '../games.js';
import * as F from '../features.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id), spd = game('range-speed'), rnd = game('range-round'), bench = game('putt-369');
const mk = (id, sc, day0 = 1) => sc.map((s, i) => ({ id: `${id}${i}`, game: id, date: `2026-10-${String(day0 + i).padStart(2, '0')}`, score: s }));
const keys = (ts) => ts.map((x) => x.key).join(',');

t('only the two games without a benchmark use own tiers', () => {
  assert.ok(G.isOwn(spd)); assert.ok(G.isOwn(rnd)); assert.ok(!G.isOwn(bench)); assert.ok(!G.isOwn(game('range-driver')));
  assert.equal(G.OWN.tiers.length, 3, 'three tiers, no Platinum'); assert.equal(G.OWN.min_scores, 3);
});
t('no tiers before three earlier scores', () => {
  for (let k = 0; k < 3; k++) assert.equal(G.ownTierScores(spd, Array.from({ length: k }, (_, i) => 200 + i)), null, `${k} scores`);
  assert.ok(G.ownTierScores(spd, [200, 210, 220]));
  assert.equal(G.tierFor(spd, 230, 0.9144, [200, 210]), null, 'tierFor gives nothing to judge against');
  assert.equal(G.tierScores(spd, 0.9144, null), null);
});
t('Bronze = median, Silver = best quarter, Gold = one step past your best', () => {
  const ts = G.ownTierScores(rnd, [10, 12, 14, 16, 18]);                      // whole numbers: step 1
  assert.equal(keys(ts), 'bronze,silver,gold'); assert.deepEqual(ts.map((x) => x.score), [14, 16, 19]);   // 75th percentile of five scores is the fourth
  const dec = G.ownTierScores(spd, [240, 250, 262.5, 255, 248]);               // decimals: step 0.1, thresholds rounded to the harder side
  assert.deepEqual(dec.map((x) => x.score), [250, 255, 262.6]);
});
t('thresholds round towards the harder side, so the shown number is the number needed', () => {
  const ts = G.ownTierScores(rnd, [10, 11, 12, 15]);                           // median 11.5 -> 12
  assert.equal(ts[0].score, 12); assert.ok(G.tierFor(rnd, 12, 0.9144, [10, 11, 12, 15]).tier?.key === 'bronze'); assert.equal(G.tierFor(rnd, 11, 0.9144, [10, 11, 12, 15]).tier, null);
});
t('the ladder always climbs, even when scores are all equal', () => {
  const ts = G.ownTierScores(rnd, [10, 10, 10, 10]);
  assert.deepEqual(ts.map((x) => x.score), [10, 11, 12]);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i].score > ts[i - 1].score);
});
t('Gold needs a new personal best', () => {
  const prior = [200, 220, 240, 230];
  assert.equal(G.tierFor(spd, 240, 0.9144, prior).tier?.key, 'silver', 'equalling the best is not Gold');
  assert.equal(G.tierFor(spd, 241, 0.9144, prior).tier?.key, 'gold');
});
t('a lower-is-better own game flips the direction', () => {
  const low = { id: 'range-round', better: 'lower', name: 'x' };
  const ts = G.ownTierScores(low, [30, 28, 26, 24, 22]);
  assert.deepEqual(ts.map((x) => x.score), [26, 24, 21]);
  assert.equal(G.tierFor(low, 21, 0.9144, [30, 28, 26, 24, 22]).tier?.key, 'gold'); assert.equal(G.tierFor(low, 22, 0.9144, [30, 28, 26, 24, 22]).tier?.key, 'silver');
});
t('history judges each result against the scores before it', () => {
  const rs = mk('range-round', [10, 12, 14, 16, 18, 15, 20]);
  assert.equal(G.ownTierHistory(rnd, rs).map((h) => h.tier?.key || '-').join(','), '-,-,-,gold,gold,bronze,gold');
  assert.deepEqual(G.scoresBefore(rnd, rs, 'range-round3'), [10, 12, 14]); assert.deepEqual(G.scoresBefore(rnd, rs, 'nope').length, 7);
  assert.deepEqual(G.scoresBefore(rnd, [...rs, ...mk('putt-369', [5, 6], 1)], 'range-round0'), [], 'other games are ignored');
});
t('ownTierUp reports a tier only when it is higher than any earlier result reached', () => {
  const rs = mk('range-round', [10, 12, 14, 16, 18, 15, 20]);
  assert.equal(G.ownTierUp(rnd, rs, 'range-round2'), null, 'too early to rate');
  assert.equal(G.ownTierUp(rnd, rs, 'range-round3')?.key, 'gold');
  assert.equal(G.ownTierUp(rnd, rs, 'range-round4'), null, 'gold again is not new');
  assert.equal(G.ownTierUp(rnd, rs, 'range-round5'), null);
  const slow = mk('range-round', [10, 12, 14, 13, 14, 16]);                      // 13 beats the median 12 and the top-quarter mark 13 of [10,12,14]: Silver
  assert.equal(G.ownTierUp(rnd, slow, 'range-round3')?.key, 'silver');
  assert.equal(G.ownTierUp(rnd, slow, 'range-round4'), null, 'Silver again is not new');
  assert.equal(G.ownTierUp(rnd, slow, 'range-round5')?.key, 'gold', 'a record is Gold');
});
t('tierState drives the launcher: need, ladder, held tier and next rung', () => {
  assert.deepEqual({ ...G.tierState(spd, mk('range-speed', [200, 210])), ladder: undefined }, { ladder: undefined, tier: null, next: null, own: true, need: 1 });
  const st = G.tierState(spd, mk('range-speed', [200, 210, 220, 230]));
  assert.equal(st.own, true); assert.equal(st.need, 0); assert.equal(keys(st.ladder), 'bronze,silver,gold');
  assert.equal(st.tier?.key, 'gold', 'the 4th score was a record, so Gold has been earned'); assert.equal(st.next, null);
  const flat = G.tierState(rnd, mk('range-round', [10, 11, 12]));
  assert.equal(flat.tier, null); assert.equal(flat.next.key, 'bronze');
  const b = G.tierState(bench, []); assert.equal(b.own, false); assert.ok(b.ladder.length === 4, 'benchmark games keep four tiers');
});
t('benchmark games are unchanged by the own-history code', () => {
  const ts = G.tierScores(bench, 0.9144); assert.equal(ts.length, 4); assert.deepEqual(G.tierFor(bench, 5, 0.9144), G.tierFor(bench, 5, 0.9144, [1, 2, 3]));
});
t('badges: three per own game, earned on the date the tier was first reached, none for unplayed games', () => {
  const rs = mk('range-round', [10, 12, 14, 16, 18]);
  const bs = G.tierBadges([rnd], rs, 0.9144);
  assert.deepEqual(bs.map((b) => b.id), ['tier-range-round-bronze', 'tier-range-round-silver', 'tier-range-round-gold']);
  assert.equal(bs[2].earned, '2026-10-04'); assert.equal(bs[0].earned, '2026-10-04');
  const none = G.tierBadges([rnd], [], 0.9144); assert.equal(none.length, 3); assert.ok(none.every((b) => !b.earned));
  assert.equal(G.tierBadges([spd, bench], [], 0.9144).length, 3 + 4);
});
console.log(`${n} tests passed`);
