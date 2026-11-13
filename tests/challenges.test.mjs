import assert from 'node:assert/strict';
import * as C from '../challenges.js';
import * as CO from '../coach.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const h = (par, strokes, putts, fairway = null, penalties = 0) => ({ par, strokes, putts, fairway, penalties });
t('five challenges, each tied to a sub-skill the plan knows', () => {
  assert.deepEqual(C.CHALLENGES.map((c) => c.key), ['no-three-putts', 'updowns', 'fairways', 'no-penalties', 'greens']);
  assert.equal(C.forSub('putting.lag').key, 'no-three-putts'); assert.equal(C.forSub('short.updown').key, 'updowns'); assert.equal(C.forSub('driving.penalties').key, 'no-penalties'); assert.equal(C.forSub('nope'), null);
});
t('goals scale for nine holes', () => {
  assert.equal(C.titleFor(C.byKey('updowns'), 18), '5 up-and-downs'); assert.equal(C.titleFor(C.byKey('fairways'), 9), '5 fairways'); assert.equal(C.titleFor(C.byKey('greens'), 9), '4 greens'); assert.equal(C.titleFor(C.byKey('no-penalties'), 9), 'No penalties');
});
t('three-putts, penalties, fairways counted from the card', () => {
  const hs = [h(4, 5, 3, 'HIT'), h(4, 4, 2, 'LEFT', 1), h(3, 3, 1), h(5, 7, 3, 'HIT', 2), h(4, 0, null)];
  assert.equal(C.count('no-three-putts', hs), 2); assert.equal(C.count('no-penalties', hs), 3); assert.equal(C.count('fairways', hs), 2);
});
t('up-and-down: missed the green, made par or better; greens: in regulation', () => {
  const hs = [h(4, 4, 1), h(4, 4, 2), h(3, 3, 1), h(4, 5, 1), h(5, 5, 1)];
  // a green in regulation is reached in par minus two shots or fewer: strokes minus putts <= par - 2
  assert.equal(C.count('greens', [h(4, 4, 2)]), 1); assert.equal(C.count('greens', [h(4, 4, 1)]), 0);
  assert.equal(C.count('updowns', [h(4, 4, 1)]), 1); assert.equal(C.count('updowns', [h(4, 4, 2)]), 0); assert.equal(C.count('updowns', [h(4, 5, 1)]), 0);
});
t('live status: a zero challenge fails on the first miss and succeeds only when every hole is played', () => {
  assert.equal(C.status('no-three-putts', [h(4, 4, 2)], 18).state, 'on');
  assert.equal(C.status('no-three-putts', [h(4, 5, 3)], 18).state, 'failed');
  assert.equal(C.status('no-three-putts', Array(9).fill(h(4, 4, 2)), 9).state, 'achieved');
  assert.equal(C.status('no-three-putts', Array(5).fill(h(4, 4, 2)), 9).state, 'on');
});
t('live status: a min challenge succeeds when reached and fails when it can no longer be', () => {
  const miss = h(4, 4, 2, 'LEFT'), hit = h(4, 4, 2, 'HIT');
  assert.equal(C.status('fairways', Array(10).fill(hit), 18).state, 'achieved');
  assert.equal(C.status('fairways', [...Array(8).fill(miss)], 18).state, 'on');
});
t('fairways challenge fails once it is out of reach', () => { assert.equal(C.status('fairways', Array(9).fill(h(4, 4, 2, 'LEFT')), 18).state, 'failed'); assert.equal(C.status('fairways', Array(8).fill(h(4, 4, 2, 'LEFT')), 18).state, 'on'); });
t('outcome is what gets stored', () => {
  const o = C.outcome('updowns', [h(4, 4, 1), h(5, 5, 1), h(3, 3, 1), h(4, 4, 1), h(4, 4, 1)], 18);
  assert.deepEqual([o.key, o.goal, o.value, o.achieved], ['updowns', 5, 5, true]);
  assert.equal(C.outcome('no-penalties', Array(9).fill(h(4, 4, 2)), 18).achieved, false);                 // part round does not count
  assert.equal(C.outcome('nope', [], 18), null);
});
const sub = (full_key, strokes) => ({ full_key, strokes });
const ratings = { focus: ['putting', 'driving'], skills: [{ key: 'putting', subs: [sub('putting.lag', 1.2), sub('putting.short', 0.5)] }, { key: 'driving', subs: [sub('driving.penalties', 0.9), sub('driving.accuracy', 0.3)] }, { key: 'short', subs: [sub('short.updown', 2)] }] };
t('pick: weakest focus sub-skill that has a challenge', () => { assert.equal(C.pickChallenge({ ratings }).key, 'no-three-putts'); });
t('pick: not the same one twice in a row', () => { assert.equal(C.pickChallenge({ ratings, history: [{ date: '2026-05-01', key: 'no-three-putts' }] }).key, 'no-penalties'); });
t('pick: a stalled sub-skill goes first', () => { assert.equal(C.pickChallenge({ ratings, ledger: [{ sub: 'driving.accuracy', stalled: true }] }).key, 'fairways'); assert.equal(C.pickChallenge({ ratings, ledger: [{ sub: 'driving.accuracy', stalled: true }] }).stalled, true); });
t('pick: nothing to offer without focus areas', () => { assert.equal(C.pickChallenge({ ratings: { focus: [], skills: [] } }), null); assert.equal(C.pickChallenge({}), null); });
t('pick: goal is scaled for nine holes', () => { assert.equal(C.pickChallenge({ ratings: { focus: ['short'], skills: [{ key: 'short', subs: [sub('short.updown', 1)] }] }, n: 9 }).goal, 3); });
console.log(`${n} tests passed`);
