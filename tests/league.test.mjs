import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as L from '../league.js';
import * as CL from '../cloud.js';
import * as G from '../games.js';
import * as F from '../features.js';
const { makeFakeFirebase } = createRequire(import.meta.url)('./fake_firebase.js');
let n = 0; const t = (name, f) => f.constructor.name === 'AsyncFunction' ? (pending.push(f().then(() => { n++; console.log('ok', name); }))) : (f(), n++, console.log('ok', name)); const pending = [];
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id);
const doc = (uid, nick, extra = {}) => ({ uid, nick, game: 'chip-zone', date: '2026-11-10', score: 5, hit: false, ...extra });

t('points: 1 for playing, 3 for beating your target, +1 for a pressure finish', () => {
  assert.equal(L.points(doc('a', 'A')), 1); assert.equal(L.points(doc('a', 'A', { hit: true })), 3); assert.equal(L.points(doc('a', 'A', { pressure: true })), 2); assert.equal(L.points(doc('a', 'A', { hit: true, pressure: true })), 4);
  assert.equal(L.points({ uid: 'a', score: 3 }), 1, 'older scores with no hit field still count as playing');
});
t('league ranks by points, then hits, and shares ranks on a tie', () => {
  const rows = L.league([doc('a', 'Ann', { hit: true }), doc('a', 'Ann', { hit: true }), doc('b', 'Bob'), doc('b', 'Bob'), doc('b', 'Bob'), doc('b', 'Bob', { hit: true }), doc('c', 'Cat', { hit: true }), doc('c', 'Cat', { hit: true })]);
  assert.deepEqual(rows.map((r) => [r.nick, r.points, r.hits, r.rank]), [['Ann', 6, 2, 1], ['Cat', 6, 2, 1], ['Bob', 6, 1, 3]]);
  assert.equal(L.winners(rows).length, 2);
});
t('only the first 10 scores of the week count', () => {
  const rows = L.league(Array.from({ length: 15 }, (_, i) => doc('a', 'Ann', { hit: true, date: `2026-11-${String(10 + (i % 5)).padStart(2, '0')}` })));
  assert.equal(rows[0].plays, 10); assert.equal(rows[0].points, 30);
});
t('league ignores docs with no uid and picks the latest nickname', () => {
  const rows = L.league([{ score: 3 }, doc('a', 'Old', { date: '2026-11-09' }), doc('a', 'New', { date: '2026-11-11' })]); assert.equal(rows.length, 1); assert.equal(rows[0].nick, 'New');
});
t('no points, no winner', () => { assert.equal(L.winners([]).length, 0); });
t('previous ISO week, including across a year end', () => {
  assert.equal(L.prevWeek('2026-W46'), '2026-W45'); assert.equal(L.prevWeek('2026-W01'), '2025-W52'); assert.equal(L.prevWeek('2021-W01'), '2020-W53');
});
t('share extras: scores, tier and per-step results only', () => {
  const g = L.shareExtras({ mode: 'guided', detail: [1, 0, 1], seed: 42, pressure: true }, { hit: true, tier: 'gold' });
  assert.deepEqual(g, { hit: true, tier: 'gold', mode: 'guided', detail: [1, 0, 1], seed: 42, pressure: true });
  assert.deepEqual(L.shareExtras({ score: 4 }, {}), {}); assert.deepEqual(L.shareExtras({ mode: 'guided', detail: [1], seed: 1 }, { hit: false }), { hit: false, mode: 'guided', detail: [1], seed: 1 });
});
t('a full guided score document stays within the 20-field rule', () => {
  const base = { game: 'putt-par18', game_name: 'Par 18 putting', better: 'lower', score: 19, level_h: 8.2, date: '2026-11-10', week: '2026-W46', month: '2026-11', nick: 'Wills', course: 'Home GC', uid: 'u' };
  const all = { ...base, ...L.shareExtras({ mode: 'guided', detail: new Array(40).fill(2), seed: 1, pressure: true }, { hit: true, tier: 'platinum' }) };
  assert.ok(Object.keys(all).length <= L.MAX_FIELDS, Object.keys(all).length); assert.equal(Object.keys(all).length, 17);
});
t('ghosts: best guided score per friend this week for the game, never yourself', () => {
  const sc = (uid, nick, score, extra = {}) => ({ uid, nick, game: 'chip-zone', score, mode: 'guided', detail: new Array(10).fill(1).map((_, i) => (i < score ? 1 : 0)), seed: 7 + score, ...extra });
  const rows = [sc('me', 'Me', 9), sc('a', 'Ann', 4), sc('a', 'Ann', 6), sc('b', 'Bob', 5), sc('c', 'Cat', 8, { mode: undefined }), sc('d', 'Dan', 7, { game: 'putt-369' }), sc('e', 'Eve', 3, { detail: [] })];
  const gh = L.ghostsFor(rows, game('chip-zone'), 'me'); assert.deepEqual(gh.map((x) => [x.nick, x.score]), [['Ann', 6], ['Bob', 5]]);
  assert.equal(gh[0].seed, 13);
  const low = L.ghostsFor([{ ...sc('a', 'Ann', 20), game: 'putt-par18', detail: new Array(9).fill(2), seed: 3 }, { ...sc('b', 'Bob', 18), game: 'putt-par18', detail: new Array(9).fill(2), seed: 4 }], game('putt-par18'), 'me'); assert.equal(low[0].nick, 'Bob', 'lower is better for strokes games');
});
t('ghost comparison per step: ahead, behind or level', () => {
  const g = game('chip-zone'), me = [1, 1, 0, 1], gh = [1, 0, 1, 0];
  assert.deepEqual(L.compareAt(g, me, gh, 2), { me: 2, ghost: 1, diff: 1, state: 'ahead' }); assert.equal(L.compareAt(g, me, gh, 3).state, 'level'); assert.equal(L.compareAt(g, me, gh, 4).state, 'ahead');
  assert.equal(L.compareAt(g, [0, 0], [1, 1], 2).state, 'behind');
  const p = game('putt-par18'); assert.equal(L.compareAt(p, [2, 2, 3], [2, 3, 3], 3).state, 'ahead', 'fewer strokes is ahead'); assert.equal(L.compareAt(p, [3, 3], [2, 2], 2).state, 'behind');
});
t('streak ghost counts holed putts until the first miss', () => { const g = game('putt-streak'); assert.equal(L.partial(g, [1, 1, 1, 0, 1], 5), 3); assert.equal(L.partial(g, [1, 1], 2), 2); });
t('final comparison', () => { const g = game('chip-zone'), p = game('putt-par18'); assert.equal(L.finalCompare(g, 7, 6).state, 'won'); assert.equal(L.finalCompare(g, 5, 6).state, 'lost'); assert.equal(L.finalCompare(p, 18, 19).state, 'won'); assert.equal(L.finalCompare(p, 20, 20).state, 'tied'); });

// the real cloud.js against the fake Firestore
const fb = makeFakeFirebase(); CL.setFetch(fb.fetch); const cfg = { apiKey: 'k', projectId: 'p' }, cfg2 = { apiKey: 'k', projectId: 'p' };
t('posting a guided score and reading it back for a friend', async () => {
  const code = await CL.createGroup(cfg, 'Mates', 'Wills'); await CL.joinGroup(cfg2, code, 'Sam');
  const base = { game: 'chip-zone', game_name: 'Landing zone', better: 'higher', score: 6, level_h: 9, date: '2026-11-10', week: '2026-W46', month: '2026-11', nick: 'Wills' };
  await CL.postScore(cfg, code, { ...base, ...L.shareExtras({ mode: 'guided', detail: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0], seed: 5, pressure: true }, { hit: true, tier: 'silver' }) });
  const rows = await CL.scoresWhere(cfg2, code, 'week', '2026-W46'); assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].detail.length, rows[0].seed, rows[0].tier, rows[0].hit, rows[0].pressure], [10, 5, 'silver', true, true]);
  assert.notEqual(rows[0].uid, (await CL.signIn(cfg2)).uid); assert.equal(L.ghostsFor(rows, game('chip-zone'), (await CL.signIn(cfg2)).uid)[0].nick, 'Wills');
  let blocked = false; try { await CL.postScore(cfg, code, { ...base, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`x${i}`, i])) }); } catch (e) { blocked = true; } assert.ok(blocked, 'the fake enforces the 20-field rule');
});
await Promise.all(pending); console.log(`${n} tests passed`);
