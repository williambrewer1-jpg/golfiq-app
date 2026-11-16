// Boss games (boss.js): pass at four of five, fail at three, one attempt a day, quit rules, results carry the boss number, friends fields.
import assert from 'node:assert/strict';
import * as BS from '../boss.js';
import * as J from '../journey.js';
import * as G from '../games.js';
import * as F from '../features.js';
const games = F.DEFAULT_GAMES; let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const at = (lvl, ids) => Object.fromEntries(ids.map((id) => [id, J.milestoneScore(id, lvl)]));
const short = (id, lvl) => { const g = games.find((x) => x.id === id), s = J.milestoneScore(id, lvl); return g.better === 'lower' ? s + 3 : s - Math.max(0.5, s * 0.3); };

t('five games, four needed, one attempt a day', () => { assert.equal(BS.BOSS_GAMES.length, 5); assert.equal(BS.PASS_NEEDED, 4); assert.equal(BS.ATTEMPTS_PER_DAY, 1); assert.ok(BS.BOSS_MINUTES >= 25 && BS.BOSS_MINUTES <= 45, BS.BOSS_MINUTES); });
t('every boss game has a milestone score at every stretch', () => { for (const m of J.MILESTONES) for (const id of BS.BOSS_GAMES) assert.ok(Number.isFinite(J.milestoneScore(id, m)), `${id} ${m}`); });
t('four of five at the milestone score passes', () => {
  const sc = { ...at(10, BS.BOSS_GAMES.slice(0, 4)), [BS.BOSS_GAMES[4]]: short(BS.BOSS_GAMES[4], 10) }, r = BS.tally(10, sc, { games });
  assert.equal(r.hits, 4); assert.equal(r.passed, true); assert.equal(r.over, true);
});
t('three of five does not pass', () => {
  const sc = { ...at(10, BS.BOSS_GAMES.slice(0, 3)), [BS.BOSS_GAMES[3]]: short(BS.BOSS_GAMES[3], 10), [BS.BOSS_GAMES[4]]: short(BS.BOSS_GAMES[4], 10) }, r = BS.tally(10, sc, { games });
  assert.equal(r.hits, 3); assert.equal(r.passed, false); assert.equal(r.possible, false);
});
t('after each game the golfer can see whether a pass is still possible', () => {
  const ids = BS.BOSS_GAMES, sh = (i) => short(ids[i], 10);
  let r = BS.tally(10, { [ids[0]]: sh(0) }, { games }); assert.equal(r.possible, true); assert.equal(r.left, 4);
  r = BS.tally(10, { [ids[0]]: sh(0), [ids[1]]: sh(1) }, { games }); assert.equal(r.possible, false); assert.equal(r.played, 2);
});
t('a score exactly on the milestone score is a hit; just short is not', () => {
  const id = 'putt-369', s = J.milestoneScore(id, 10);
  assert.equal(BS.tally(10, { [id]: s }, { games }).rows[0].state, 'hit'); assert.equal(BS.tally(10, { [id]: s - 0.1 }, { games }).rows[0].state, 'short');
});
t('short games report by how much', () => { const id = 'putt-369', s = J.milestoneScore(id, 10), r = BS.tally(10, { [id]: s - 1 }, { games }).rows[0]; assert.equal(r.short, 1); assert.equal(r.target, s); });
t('lower-is-better games compare the right way', () => {
  const low = BS.BOSS_GAMES.find((id) => games.find((g) => g.id === id)?.better === 'lower'); if (!low) return;
  const s = J.milestoneScore(low, 10); assert.equal(BS.tally(10, { [low]: s }, { games }).rows.find((x) => x.id === low).state, 'hit'); assert.equal(BS.tally(10, { [low]: s + 1 }, { games }).rows.find((x) => x.id === low).state, 'short');
});
t('one attempt a day for each boss; a passed boss is not played again', () => {
  const b = [{ n: 10, date: '2026-05-01', passed: false }];
  assert.deepEqual(BS.canAttempt(b, 10, '2026-05-01'), { ok: false, reason: 'today' }); assert.equal(BS.canAttempt(b, 10, '2026-05-02').ok, true);
  assert.equal(BS.canAttempt(b, 5, '2026-05-01').ok, true, 'another boss is its own attempt');
  assert.equal(BS.canAttempt([...b, { n: 10, date: '2026-05-02', passed: true }], 10, '2026-05-09').reason, 'passed');
});
t('a quit attempt counts only if at least one game was finished', () => {
  assert.equal(BS.record({ id: 'b1', n: 10, date: '2026-05-01', results: [], scores: {}, games }), null);
  const rec = BS.record({ id: 'b1', n: 10, date: '2026-05-01', results: ['r1'], scores: { 'putt-369': short('putt-369', 10) }, games });
  assert.deepEqual([rec.n, rec.passed, rec.results, rec.id], [10, false, ['r1'], 'b1']);
});
t('the stored record matches the plan: n, date, passed, results, scores', () => {
  const sc = at(10, BS.BOSS_GAMES), rec = BS.record({ id: 'b2', n: 10, date: '2026-05-02', results: ['a', 'b', 'c', 'd', 'e'], scores: sc, games });
  assert.equal(rec.passed, true); assert.deepEqual(Object.keys(rec).sort(), ['date', 'id', 'n', 'passed', 'results', 'scores']);
});
t('the draft and the saved result carry the boss number, and pressure finish is on', () => {
  const g = games.find((x) => x.id === 'putt-369'), d = G.newDraft(g, { pressure: true, boss: 10, target: 5 });
  assert.equal(d.boss, 10); assert.equal(d.pressure, true); assert.equal(d.target, 5);
  d.answers = G.steps(g, { seed: d.seed, unitM: d.unitM }).map(() => 1); assert.equal(G.resultFromDraft(d, g, { date: '2026-05-01' }).boss, 10);
  assert.equal(G.resultFromDraft({ ...d, boss: undefined }, g, { date: '2026-05-01' }).boss, undefined, 'normal results have no boss field');
});
t('friends: the score document gets the boss number, and boss_passed only when passed', () => {
  assert.deepEqual(BS.shareFields(10, true), { boss: 10, boss_passed: true }); assert.deepEqual(BS.shareFields(10, false), { boss: 10 });
});
t('wording: the title is "Beat the N", scratch reads "Reach scratch"', () => { assert.equal(BS.title(10), 'Beat the 10'); assert.equal(BS.title(0), 'Reach scratch'); });
console.log(`boss: ${n} tests passed`);
