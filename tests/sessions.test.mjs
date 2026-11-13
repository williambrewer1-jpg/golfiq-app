import assert from 'node:assert/strict';
import * as S from '../sessions.js';
import * as G from '../games.js';
import * as B from '../bench.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const sub = (title, strokes, games) => ({ title, strokes, games: games.map((id) => ({ id, name: id, target: 5, better: 'higher' })) });
const ratings = { focus: ['putting', 'approach'], skills: [
  { key: 'putting', title: 'Putting', rated: true, strokes: 2, subs: [sub('Lag', 1.4, ['putt-lag', 'putt-par18']), sub('Short', 0.6, ['putt-369', 'putt-streak'])] },
  { key: 'approach', title: 'Approach', rated: true, strokes: 1.5, subs: [sub('Proximity', 1.0, ['range-wedge']), sub('Greens', 0.5, ['range-greens'])] },
  { key: 'short', title: 'Short game', rated: true, strokes: 0.8, subs: [sub('Up and down', 0.8, ['chip-updown', 'chip-zone'])] },
] };
const ids = (s) => s.games.map((g) => g.id);
t('30, 45 and 60 minutes give 2, 3 and 4 games', () => {
  for (const [m, k] of [[30, 2], [45, 3], [60, 4]]) assert.equal(S.buildSession({ minutes: m, ratings, today: '2026-05-04' }).games.length, k);
});
t('weakest sub-skill first, alternating between the two focus skills', () => {
  const s = S.buildSession({ minutes: 45, ratings, today: '2026-05-04' });
  assert.deepEqual(ids(s), ['putt-lag', 'range-wedge', 'putt-par18']);
  assert.deepEqual(s.games.map((g) => g.skill), ['putting', 'approach', 'putting']);
});
t('no repeats within a session', () => { const s = ids(S.buildSession({ minutes: 60, ratings, today: '2026-05-04' })); assert.equal(new Set(s).size, s.length); });
t('yesterday\'s games are skipped while alternatives exist', () => {
  const s = S.buildSession({ minutes: 30, ratings, today: '2026-05-04', results: [{ game: 'putt-lag', date: '2026-05-03' }, { game: 'range-wedge', date: '2026-05-03' }] });
  assert.ok(!ids(s).includes('putt-lag') && !ids(s).includes('range-wedge'), ids(s));
  const old = S.buildSession({ minutes: 30, ratings, today: '2026-05-04', results: [{ game: 'putt-lag', date: '2026-05-01' }] }); assert.ok(ids(old).includes('putt-lag'));
});
t('when focus runs out it fills from other skills, then repeats rather than going short', () => {
  const tiny = { focus: ['putting'], skills: [{ key: 'putting', title: 'P', rated: true, strokes: 1, subs: [sub('Lag', 1, ['putt-lag'])] }, ratings.skills[2]] };
  const s = S.buildSession({ minutes: 45, ratings: tiny, today: '2026-05-04', results: [{ game: 'putt-lag', date: '2026-05-03' }] });
  assert.equal(s.games.length, 3); assert.equal(new Set(ids(s)).size, 3);
});
t('every game has a time and the total is shown', () => { const s = S.buildSession({ minutes: 45, ratings, today: '2026-05-04' }); assert.ok(s.games.every((g) => g.minutes > 0)); assert.equal(s.total, s.games.reduce((a, g) => a + g.minutes, 0)); });
t('only guided games are picked', () => {
  const r = { focus: ['x'], skills: [{ key: 'x', title: 'X', rated: true, strokes: 1, subs: [sub('a', 1, ['combine', 'range-course', 'putt-369'])] }] };
  assert.ok(ids(S.buildSession({ minutes: 30, ratings: r, today: '2026-05-04', pool: ['chip-zone'] })).every((id) => G.GUIDED.has(id)));
});
t('daily challenge is the same for the same date', () => {
  const o = { focusGames: ['putt-lag', 'range-wedge'], pool: B.CHALLENGE_POOL };
  assert.deepEqual(S.dailyChallenge('2026-05-04', o), S.dailyChallenge('2026-05-04', o));
});
t('focus days (Mon, Tue, Thu, Sat) use focus games; other days use the pool', () => {
  const o = { focusGames: ['putt-lag'], pool: ['chip-zone'] };
  const dow = (d) => new Date(`${d}T12:00:00`).getDay();
  let f = 0, p = 0;
  for (let i = 0; i < 14; i++) { const d = S.addDays('2026-05-04', i), c = S.dailyChallenge(d, o); if (S.FOCUS_DAYS.includes(dow(d))) { assert.equal(c.game, 'putt-lag'); f++; } else { assert.equal(c.game, 'chip-zone'); p++; } }
  assert.equal(f, 8); assert.equal(p, 6);
});
t('with no focus games the daily challenge still works and varies', () => {
  const seen = new Set(); for (let i = 0; i < 30; i++) seen.add(S.dailyChallenge(S.addDays('2026-05-04', i), { pool: B.CHALLENGE_POOL }).game); assert.ok(seen.size >= 4);
});
t('daily streak counts back from today or yesterday', () => {
  const d = { '2026-05-04': 'a', '2026-05-03': 'b', '2026-05-02': 'c', '2026-04-30': 'x' };
  assert.equal(S.dailyStreak(d, '2026-05-04'), 3); assert.equal(S.dailyStreak(d, '2026-05-05'), 3); assert.equal(S.dailyStreak(d, '2026-05-06'), 0); assert.equal(S.dailyStreak({}, '2026-05-04'), 0);
});
console.log(`${n} tests passed`);
