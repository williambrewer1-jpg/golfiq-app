// Road to scratch (journey.js): stage hits, the two-games rule, pressure weighting, course stretches, opening, current.next, advance().
import assert from 'node:assert/strict';
import * as J from '../journey.js';
import * as F from '../features.js';
import * as B from '../bench.js';
import { playerLevel } from '../level.js';

const games = F.DEFAULT_GAMES;
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name); throw e; } };
let id = 0;
const hit = (game, level, date, extra = {}) => ({ id: 'r' + ++id, game, date, score: J.milestoneScore(game, level), mode: 'guided', ...extra });
const miss = (game, date) => { const g = games.find((x) => x.id === game), s = J.milestoneScore(game, 30); return { id: 'r' + ++id, game, date, score: g.better === 'lower' ? s + 5 : s - 1, mode: 'guided' }; };
const stage = (j, n, skill) => j.stretches.find((s) => s.n === n).stages.find((s) => s.skill === skill);

t('the milestones and stage size are the plan\'s', () => { assert.deepEqual(J.MILESTONES, [30, 25, 20, 15, 10, 5, 0]); assert.equal(J.STAGE_HITS, 3); });
t('with no index the path starts at 30 and the first stretch is open', () => {
  const j = J.journey({ index: null, results: [], games }); assert.equal(j.stretches[0].state, 'open'); assert.ok(j.stretches.slice(1).every((s) => s.state === 'locked'));
  assert.equal(j.current.n, 30);
});
t('stretches at or above the index are earned on the course; the first one below is open', () => {
  const j = J.journey({ index: 13.2, results: [], games });
  assert.deepEqual(j.stretches.map((s) => s.state), ['course', 'course', 'course', 'course', 'open', 'locked', 'locked']);
  assert.equal(j.current.n, 10);
});
t('an index exactly on a milestone has reached it', () => { assert.equal(J.journey({ index: 10, games }).stretches.find((s) => s.n === 10).state, 'course'); });
t('a stage needs three hits at the milestone score', () => {
  const r = [hit('putt-369', 10, '2026-05-01'), hit('putt-369', 10, '2026-05-02')];
  let j = J.journey({ index: 13.2, results: r, games }); assert.equal(stage(j, 10, 'putting').hits, 2); assert.equal(stage(j, 10, 'putting').done, false);
  r.push(hit('putt-streak', 10, '2026-05-03')); j = J.journey({ index: 13.2, results: r, games }); assert.equal(stage(j, 10, 'putting').done, true);
});
t('a score just short does not count; equal does', () => {
  const g = 'putt-369', s = J.milestoneScore(g, 10);
  const mk = (score) => [0, 1, 2].map((i) => ({ id: 'q' + i + score, game: g, date: `2026-05-0${i + 1}`, score, mode: 'guided' }));
  assert.equal(stage(J.journey({ index: 13, results: mk(s - 0.1), games }), 10, 'putting').hits, 0);
  assert.equal(stage(J.journey({ index: 13, results: mk(s), games }), 10, 'putting').hits, 3);
});
t('three hits in one game are not enough when the skill has several games', () => {
  const r = [1, 2, 3].map((i) => hit('putt-369', 10, `2026-05-0${i}`));
  const s = stage(J.journey({ index: 13.2, results: r, games }), 10, 'putting');
  assert.equal(s.hits, 3); assert.equal(s.done, false); assert.equal(s.needsOther, true);
  r.push(hit('putt-lag', 10, '2026-05-04')); assert.equal(stage(J.journey({ index: 13.2, results: r, games }), 10, 'putting').done, true);
});
t('lower-is-better games compare the right way', () => {
  const low = games.find((g) => g.better === 'lower'); if (!low) return;
  const s = J.milestoneScore(low.id, 10), ok = { id: 'a', game: low.id, date: '2026-05-01', score: s, mode: 'guided' }, bad = { id: 'b', game: low.id, date: '2026-05-01', score: s + 1, mode: 'guided' };
  const sk = J.journey({ index: 13, results: [ok, bad], games }).stretches.find((x) => x.n === 10).stages.find((x) => x.games.some((y) => y.id === low.id));
  assert.equal(sk.hits, 1);
});
t('a pressure-finish hit counts 1.5', () => {
  const r = [hit('putt-369', 10, '2026-05-01', { pressure: true, pressure_hit: true }), hit('putt-lag', 10, '2026-05-02', { pressure: true, pressure_hit: true })];
  assert.equal(stage(J.journey({ index: 13, results: r, games }), 10, 'putting').hits, 3);
  const miss2 = [hit('putt-369', 10, '2026-05-01', { pressure: true, pressure_hit: false })]; assert.equal(stage(J.journey({ index: 13, results: miss2, games }), 10, 'putting').hits, 1);
});
t('hits never show above 3 and a stage stays earned', () => {
  const r = ['putt-369', 'putt-lag', 'putt-369', 'putt-lag', 'putt-369'].map((g, i) => hit(g, 10, `2026-05-0${i + 1}`));
  const s = stage(J.journey({ index: 13, results: r, games }), 10, 'putting'); assert.equal(s.hits, 3); assert.equal(s.done, true);
  assert.equal(stage(J.journey({ index: 13, results: [...r, miss('putt-369', '2026-06-01')], games }), 10, 'putting').done, true);
});
t('hits at any time count, but only in the skill\'s own games', () => {
  const r = [hit('chip-updown', 10, '2020-01-01'), hit('chip-updown', 10, '2024-01-01'), hit('chip-par18', 10, '2026-01-01')];
  const j = J.journey({ index: 13, results: r, games }); assert.equal(stage(j, 10, 'short').done, true); assert.equal(stage(j, 10, 'putting').hits, 0);
});
t('a better score also counts towards easier stretches (they are locked until the boss, but progress is kept)', () => {
  const j = J.journey({ index: null, results: [hit('putt-369', 5, '2026-05-01')], games });
  assert.equal(stage(j, 30, 'putting').hits, 1); assert.equal(stage(j, 5, 'putting').hits, 1);
});
t('the next stretch opens only when the boss is passed', () => {
  const all = ['putt-369', 'putt-lag', 'chip-updown', 'chip-par18', 'range-greens', 'combine', 'range-driver', 'range-fairways'];
  const r = []; for (const g of all) for (let i = 0; i < 2; i++) r.push(hit(g, 10, `2026-05-0${i + 1}`));
  let j = J.journey({ index: 13.2, results: r, games });
  assert.ok(j.stretches.find((s) => s.n === 10).stages.every((s) => s.done)); assert.equal(j.stretches.find((s) => s.n === 10).boss.state, 'ready');
  assert.equal(j.stretches.find((s) => s.n === 5).state, 'locked'); assert.equal(j.current.next.kind, 'boss');
  j = J.journey({ index: 13.2, results: r, games, bosses: [{ n: 10, date: '2026-05-09', passed: false }] });
  assert.equal(j.stretches.find((s) => s.n === 5).state, 'locked'); assert.equal(j.stretches.find((s) => s.n === 10).boss.attempts, 1);
  j = J.journey({ index: 13.2, results: r, games, bosses: [{ n: 10, date: '2026-05-09', passed: false }, { n: 10, date: '2026-05-10', passed: true }] });
  assert.equal(j.stretches.find((s) => s.n === 10).state, 'done'); assert.equal(j.stretches.find((s) => s.n === 5).state, 'open'); assert.equal(j.current.n, 5);
});
t('the boss is locked until all four stages are done', () => {
  const j = J.journey({ index: 13.2, results: [hit('putt-369', 10, '2026-05-01')], games }); assert.equal(j.stretches.find((s) => s.n === 10).boss.state, 'locked');
});
t('current.next picks the unfinished stage furthest along, with the game closest to the milestone', () => {
  const r = [hit('chip-updown', 10, '2026-05-01'), hit('chip-updown', 10, '2026-05-02'), hit('putt-369', 10, '2026-05-01')];
  const nx = J.journey({ index: 13.2, results: r, games }).current.next;
  assert.equal(nx.kind, 'stage'); assert.equal(nx.skill, 'short'); assert.equal(nx.hits, 2); assert.equal(nx.line, 'Short game to 10 · 2 of 3'); assert.equal(nx.game, 'chip-updown');
});
t('with nothing played, the suggested game is the first one of the first stage', () => {
  const nx = J.journey({ index: 13.2, results: [], games }).current.next; assert.equal(nx.skill, 'putting'); assert.equal(nx.game, 'putt-369');
});
t('the suggested game is the one whose best score is closest to the milestone', () => {
  const low = { id: 'x', game: 'putt-369', date: '2026-05-01', score: J.milestoneScore('putt-369', 10) - 1.5, mode: 'guided' }, near = { id: 'y', game: 'putt-streak', date: '2026-05-01', score: J.milestoneScore('putt-streak', 10) - 0.2, mode: 'guided' };
  assert.equal(J.journey({ index: 13, results: [low, near], games }).current.next.game, 'putt-streak');
});
t('no current step when every stretch is done or earned on the course', () => { assert.equal(J.journey({ index: 0, results: [], games }).current, null); });
t('completions list stages with the day and result that finished them, and skip stretches the course already earned', () => {
  const r = [hit('putt-369', 10, '2026-05-01'), hit('putt-lag', 10, '2026-05-02'), hit('putt-369', 10, '2026-05-03')];
  const j = J.journey({ index: 13.2, results: r, games }), c = j.completions.filter((x) => x.n === 10);
  assert.equal(c.length, 1); assert.equal(c[0].date, '2026-05-03'); assert.equal(c[0].rid, r[2].id); assert.equal(c[0].title, 'Putting to 10');
  assert.ok(!j.completions.some((x) => x.n === 15));
});
t('wording: scratch reads as scratch and never as a handicap claim', () => {
  assert.equal(J.stretchTitle(10), 'Beat the 10'); assert.equal(J.stretchTitle(0), 'Reach scratch'); assert.equal(J.stageTitle('Putting', 0), 'Putting to scratch');
});
t('advance(): a result that moves a stage is reported, one that does not is null', () => {
  const r = [hit('putt-369', 10, '2026-05-01')], args = { index: 13.2, results: r, games };
  const a = J.advance(args, r[0].id); assert.deepEqual([a.title, a.from, a.to, a.done], ['Putting to 10', 0, 1, false]);
  const m = miss('putt-369', '2026-05-02'); assert.equal(J.advance({ ...args, results: [...r, m] }, m.id), null);
  const r2 = [hit('putt-369', 10, '2026-05-01'), hit('putt-lag', 10, '2026-05-02'), hit('putt-369', 10, '2026-05-03')];
  const d = J.advance({ ...args, results: r2 }, r2[2].id); assert.equal(d.done, true); assert.equal(d.to, 3);
});
t('empty and junk input never throws', () => {
  J.journey({}); J.journey({ results: [null, { game: 'putt-369' }, { game: 'nope', score: 3, date: '2026-01-01' }], games, bosses: [null] }); assert.equal(J.advance({ results: [] }, 'x'), null);
});
t('stage points: level.js counts each completed stage once, 50 points, on the day it was finished', () => {
  const r = [hit('putt-369', 10, '2026-05-01'), hit('putt-lag', 10, '2026-05-02'), hit('putt-369', 10, '2026-05-03')], j = J.journey({ index: 13.2, results: r, games });
  const base = playerLevel({ journal: { results: r }, games }), withStage = playerLevel({ journal: { results: r }, games, stages: j.completions });
  assert.equal(withStage.points - base.points, 50); const line = withStage.ledger.find((l) => l.what.includes('Putting to 10')); assert.equal(line.points, 50); assert.equal(line.date, '2026-05-03'); assert.equal(line.rid, r[2].id);
});
console.log(`journey: ${n} tests passed`);
