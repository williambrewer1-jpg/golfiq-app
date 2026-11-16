// Player level (retention plan section 4): points for every action, the daily cap, ranks, the floor and the rank-up rule. Run: node tests/level.test.mjs
import assert from 'node:assert/strict';
import * as L from '../level.js';
import * as F from '../features.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const games = F.DEFAULT_GAMES, P = L.POINTS;
const lv = (journal, extra = {}) => L.playerLevel({ journal, games, unitM: 0.9144, ...extra });
const g = (id, date, score, x = {}) => ({ id: `${id}-${date}-${score}-${Math.random()}`, game: id, date, score, mode: 'guided', ...x });

t('a guided game is 10 and a typed-in score is 5', () => {
  assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0)] }).points, P.game);
  assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0, { mode: undefined })] }).points, P.quick);
});
t('meeting the target adds 10, and only when the score reaches it', () => {
  const r = [g('putt-lag', '2026-11-01', 0)];
  assert.equal(lv({ results: r }, { targets: { 'putt-lag': 0 } }).points, P.game + P.target);
  assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0)] }, { targets: { 'putt-lag': 1 } }).points, P.game);
  assert.equal(lv({ results: [g('putt-par18', '2026-11-01', 16)] }, { targets: { 'putt-par18': 17 } }).points, P.game + P.target + P.tier, 'fewer is better: 16 beats a target of 17 (and is the Gold tier)');
});
t('a new tier adds 25 once per tier, and a lower tier later adds nothing', () => {
  const j = { results: [g('putt-lag', '2026-11-01', 2), g('putt-lag', '2026-11-02', 2), g('putt-lag', '2026-11-03', 1)] };   // Silver, then Silver again, then Bronze
  const l = lv(j), by = (d) => l.ledger.find((x) => x.date === d).points;
  assert.equal(by('2026-11-01'), P.game + P.tier);                  // Bronze and Silver reached together: one tier line for the highest reached
  assert.equal(by('2026-11-02'), P.game);
  assert.equal(by('2026-11-03'), P.game);
});
t('a personal best needs an earlier score to beat, and is judged in order', () => {
  const l = lv({ results: [g('putt-lag', '2026-11-01', 0), g('putt-lag', '2026-11-02', 0), g('putt-lag', '2026-11-03', 1)] });
  assert.equal(l.ledger.find((x) => x.date === '2026-11-01').points, P.game);
  assert.equal(l.ledger.find((x) => x.date === '2026-11-02').points, P.game);                       // equal is not a best
  assert.equal(l.ledger.find((x) => x.date === '2026-11-03').points, P.game + P.pb + P.tier);     // 1 is a best and the first Bronze
  const low = lv({ results: [g('putt-par18', '2026-11-01', 18), g('putt-par18', '2026-11-02', 17)] });
  assert.ok(low.ledger.find((x) => x.date === '2026-11-02').what.includes('personal best'), 'lower is better');
});
t('a pressure finish that held adds 5; one that did not adds nothing', () => {
  assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0, { pressure: true, pressure_hit: true })] }).points, P.game + P.pressure);
  assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0, { pressure: true, pressure_hit: false })] }).points, P.game);
});
t('the daily challenge adds 10', () => { assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0, { challenge: 'daily' })] }).points, P.game + P.daily); });
t('a welcome-back game scores double, bonuses included', () => {
  assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0, { welcome_back: true })] }).points, P.game * P.welcome_back);
  assert.equal(lv({ results: [g('putt-lag', '2026-11-01', 0, { welcome_back: true })] }, { targets: { 'putt-lag': 0 } }).points, (P.game + P.target) * P.welcome_back);
});
t('only a completed guided session counts: 20 points', () => {
  const s = (x) => ({ id: 'ses1', date: '2026-11-01', guided: true, results: [], ...x });
  assert.equal(lv({ sessions: [s({ complete: true })] }).points, P.session);
  assert.equal(lv({ sessions: [s({})] }).points, 0, 'finished early');
  assert.equal(lv({ sessions: [s({ complete: true, guided: false })] }).points, 0, 'a typed-in log is not a session');
  assert.equal(lv({ sessions: [s({ id: 'test9', complete: true })] }).points, 0, 'a skills test is counted as a test, not as a session');
});
t('rounds: 18 holes 30, 9 holes 15, a part round counts half from 9 holes, under 9 nothing', () => {
  const r = (format, holes_played) => ({ date: '2026-11-01', format, holes_played });
  assert.equal(lv({}, { rounds: [r('18', 18)] }).points, P.round);
  assert.equal(lv({}, { rounds: [r('9', 9)] }).points, P.round9);
  assert.equal(lv({}, { rounds: [r('partial', 12)] }).points, P.round9);
  assert.equal(lv({}, { rounds: [r('partial', 5)] }).points, 0);
});
t('an on-course challenge is 20 only when achieved, and a skills test is 40', () => {
  assert.equal(lv({ course_challenges: [{ date: '2026-11-01', achieved: true }, { date: '2026-11-02', achieved: false }] }).points, P.challenge);
  assert.equal(lv({ skills_tests: [{ date: '2026-11-01' }] }).points, P.test);
});
t('a passed boss is 150 and a failed attempt is nothing', () => {
  assert.equal(lv({ journey: { bosses: [{ n: 10, date: '2026-11-01', passed: true }, { n: 10, date: '2026-11-02', passed: false }] } }).points, P.boss);
});
t('duels count when they are passed in: 10 for playing, 15 more for a win', () => {
  assert.equal(lv({}, { duels: [{ date: '2026-11-01', won: true }, { date: '2026-11-02', won: false }] }).points, P.duel * 2 + P.duelWin);
});
t('the daily cap holds games and typed-in scores to 150 a day, in the order played', () => {
  const j = { results: Array.from({ length: 20 }, (_, i) => g('putt-lag', '2026-11-01', 0, { id: `a${i}` })) };     // 20 x 10 = 200 raw
  const l = L.playerLevel({ journal: j, games, today: '2026-11-01' }); assert.equal(l.points, L.DAILY_CAP); assert.equal(l.today, L.DAILY_CAP, 'today is the 1st');
  const l2 = L.playerLevel({ journal: j, games, today: '2026-11-02' }); assert.equal(l2.today, 0);
  assert.equal(L.pointsFor(l, 'a0'), 10); assert.equal(L.pointsFor(l, 'a19'), 0, 'the last ones were over the limit');
  assert.equal(lv({ results: [...j.results, g('putt-lag', '2026-11-02', 0)] }).points, L.DAILY_CAP + 10, 'the next day starts fresh');
});
t('rounds, sessions, tests and bosses sit outside the cap', () => {
  const j = { results: Array.from({ length: 20 }, (_, i) => g('putt-lag', '2026-11-01', 0, { id: `a${i}` })), skills_tests: [{ date: '2026-11-01' }], sessions: [{ id: 's', date: '2026-11-01', guided: true, complete: true }] };
  assert.equal(lv(j, { rounds: [{ date: '2026-11-01', format: '18' }] }).points, L.DAILY_CAP + P.test + P.session + P.round);
});
t('ranks start at each threshold and the top is Legend', () => {
  const at = [[0, 'Rookie'], [149, 'Rookie'], [150, 'Range regular'], [399, 'Range regular'], [400, 'Weekend golfer'], [800, 'Club player'], [1400, 'Medal player'], [2200, 'Team player'], [3200, 'Club champion'], [4500, 'County player'], [6200, 'Elite amateur'], [8500, 'Legend'], [99999, 'Legend']];
  for (const [p, name] of at) assert.equal(L.rankFor(p).name, name, `${p} points`);
  assert.equal(L.RANKS.length, 10); assert.ok(!L.RANKS.some((r) => /scratch/i.test(r.name)), 'the top rank is never called Scratch');
});
t('progress, points to the next rank, and the top rank', () => {
  const l = L.playerLevel({ journal: {}, games, rounds: Array.from({ length: 6 }, (_, i) => ({ date: `2026-10-0${i + 1}`, format: '18' })) });     // 180 points
  assert.equal(l.rank.name, 'Range regular'); assert.equal(l.next.name, 'Weekend golfer'); assert.equal(l.toNext, 220); assert.ok(Math.abs(l.progress - 30 / 250) < 1e-9);
  const top = L.playerLevel({ journal: { skills_tests: Array.from({ length: 213 }, (_, i) => ({ date: '2026-11-01', i })) }, games });             // 8520
  assert.equal(top.rank.name, 'Legend'); assert.equal(top.next, null); assert.equal(top.progress, 1); assert.equal(top.toNext, 0);
});
t('the floor keeps a rank from reading lower than the one already shown', () => {
  const l = L.playerLevel({ journal: {}, games, floor: 3 }); assert.equal(l.rank.n, 3); assert.equal(l.progress, 0, 'never a negative bar');
  assert.equal(L.playerLevel({ journal: { skills_tests: Array.from({ length: 5 }, () => ({ date: '2026-11-01' })) }, games, floor: 1 }).rank.n, 2);
});
t('the rank-up moment: a higher rank than the one seen, never for Rookie', () => {
  const l2 = L.playerLevel({ journal: { skills_tests: [{ date: '2026-11-01' }, { date: '2026-11-01' }, { date: '2026-11-01' }, { date: '2026-11-01' }] }, games });       // 160 points
  assert.equal(L.rankUp(l2, 1).name, 'Range regular'); assert.equal(L.rankUp(l2, 2), null); assert.equal(L.rankUp(l2, 5), null);
  assert.equal(L.rankUp(L.playerLevel({ journal: {}, games }), 0), null, 'Rookie is where everyone starts');
});
t('ledger lines are newest first and carry the result id', () => {
  const l = lv({ results: [g('putt-lag', '2026-11-01', 0, { id: 'x1' }), g('putt-lag', '2026-11-03', 0, { id: 'x3' }), g('putt-lag', '2026-11-02', 0, { id: 'x2' })] });
  assert.deepEqual(l.ledger.map((x) => x.rid), ['x3', 'x2', 'x1']);
});
t('deleting a result can lower the points (they come from the history that is left)', () => {
  const a = g('putt-lag', '2026-11-01', 0), b = g('putt-lag', '2026-11-02', 0);
  assert.ok(lv({ results: [a] }).points < lv({ results: [a, b] }).points);
});
t('empty and odd history never throws', () => {
  assert.equal(lv({}).points, 0); assert.equal(L.playerLevel().points, 0);
  assert.equal(lv({ results: [{ game: 'custom-x', date: '2026-11-01', score: 3 }, { game: 'putt-lag', date: '', score: 1 }, null] }).points, P.quick, 'an unknown game still counts as a score; a result with no date does not');
});
console.log(`${n} tests passed`);
