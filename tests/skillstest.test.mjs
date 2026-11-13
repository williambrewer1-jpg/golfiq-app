import assert from 'node:assert/strict';
import * as T from '../skillstest.js';
import * as F from '../features.js';
import * as B from '../bench.js';
import * as G from '../games.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const U = 0.9144;
// a golfer who scores exactly what an h-handicapper is expected to
const scoresAt = (h) => Object.fromEntries(T.TEST_GAMES.map((id) => [id, B.expectedFor(id, h, U)]));
t('six games in a fixed order; the time is the games\' own estimates added up', () => {
  assert.deepEqual(T.TEST_GAMES, ['putt-369', 'putt-lag', 'chip-updown', 'range-wedge', 'range-greens', 'range-driver']);
  const sum = T.TEST_GAMES.reduce((t, id) => t + G.minutesFor(id), 0); assert.ok(Math.abs(T.TEST_MINUTES - sum) <= 2.5, `${T.TEST_MINUTES} vs ${sum}`); assert.equal(T.TEST_MINUTES % 5, 0);
});
t('every test game exists, is guided and has a benchmark', () => {
  for (const id of T.TEST_GAMES) { assert.ok(F.DEFAULT_GAMES.some((g) => g.id === id), id); assert.ok(G.GUIDED.has(id), id); assert.ok(B.hasLevel(id), id); }
});
t('a 10-handicap performance rates about 10 in every skill, Driving included', () => {
  const r = T.rate(scoresAt(10), F.DEFAULT_GAMES, U);
  for (const k of ['putting', 'short', 'approach', 'driving']) assert.ok(Math.abs(r.ratings[k] - 10) < 0.6, `${k} ${r.ratings[k]}`);
});
t('better scores give a lower practice handicap', () => { const a = T.rate(scoresAt(20), F.DEFAULT_GAMES, U).ratings, b = T.rate(scoresAt(5), F.DEFAULT_GAMES, U).ratings; for (const k of ['putting', 'short', 'approach', 'driving']) assert.ok(b[k] < a[k], k); });
t('a skill is only rated when all of its games were played', () => {
  const s = scoresAt(10); delete s['range-greens']; const r = T.rate(s, F.DEFAULT_GAMES, U); assert.equal(r.ratings.approach, null); assert.ok(r.ratings.putting !== null);
  const d = scoresAt(10); delete d['range-driver']; const r2 = T.rate(d, F.DEFAULT_GAMES, U); assert.equal(r2.ratings.driving, null); assert.ok(r2.ratings.approach !== null);
});
t('per-game results keep score, handicap and label', () => { const r = T.rate(scoresAt(10), F.DEFAULT_GAMES, U); assert.ok(r.per_game['putt-369'].label.length > 0 && Number.isFinite(r.per_game['putt-369'].h)); });
t('compare: positive change means a lower handicap', () => {
  const prev = T.rate(scoresAt(14), F.DEFAULT_GAMES, U), cur = T.rate(scoresAt(10), F.DEFAULT_GAMES, U), c = T.compare(cur, prev);
  assert.equal(c.length, 4); for (const x of c) assert.ok(x.change > 2, `${x.key} ${x.change}`);
  assert.ok(T.compare(cur, null).every((x) => x.change === null));
});
t('last test before a given one', () => {
  const tests = [{ id: 'b', date: '2026-02-03' }, { id: 'a', date: '2026-01-02' }, { id: 'c', date: '2026-03-04' }];
  assert.equal(T.lastTest(tests).id, 'c'); assert.equal(T.lastTest(tests, 'c').id, 'b'); assert.equal(T.lastTest(tests, 'a'), null); assert.equal(T.lastTest([]), null);
});
t('reminder shows in the first week of the month until the test is done', () => {
  assert.equal(T.due([], '2026-05-01').show, true); assert.equal(T.due([], '2026-05-07').show, true); assert.equal(T.due([], '2026-05-08').show, false);
  assert.equal(T.due([{ date: '2026-05-03' }], '2026-05-05').show, false); assert.equal(T.due([{ date: '2026-04-30' }], '2026-05-05').show, true);
  assert.equal(T.due([], '2026-05-20').available, true); assert.equal(T.due([{ date: '2026-05-03' }], '2026-05-20').available, false);
});
t('radar plots outside = better and skips unrated skills', () => { assert.equal(T.radarValue(0), 36); assert.equal(T.radarValue(36), 0); assert.equal(T.radarValue(null), null); assert.equal(T.radarValue(40), 0); });
console.log(`${n} tests passed`);
