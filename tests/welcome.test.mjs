// Welcome back (retention plan 5.2): when it shows, which game, which target. Run: node tests/welcome.test.mjs
import assert from 'node:assert/strict';
import * as S from '../sessions.js';
import * as G from '../games.js';
import * as F from '../features.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const games = F.DEFAULT_GAMES, TODAY = '2026-11-30';
const r = (game, date, score) => ({ id: `${game}${date}${score}`, game, date, score });
const wb = (o) => S.welcomeBack({ today: TODAY, games, unitM: 0.9144, tierScores: G.tierScores, ...o });

t('appears at 14 days away and not at 13', () => {
  assert.equal(wb({ results: [r('putt-369', '2026-11-17', 5)] }), null, '13 days');
  assert.equal(wb({ results: [r('putt-369', '2026-11-16', 5)] }).days, 14);
  assert.equal(wb({ results: [r('putt-369', '2026-09-01', 5)] }).days, 90);
});
t('a session or a round in the last 13 days keeps it away, and so does any other result', () => {
  const old = [r('putt-369', '2026-09-01', 5)];
  assert.equal(wb({ results: old, sessions: [{ date: '2026-11-20' }] }), null);
  assert.equal(wb({ results: old, rounds: [{ date: '2026-11-25' }] }), null);
  assert.equal(wb({ results: [...old, r('chip-updown', '2026-11-29', 4)] }), null, 'playing anything else removes it');
});
t('never played means nothing to come back to', () => { assert.equal(wb({ results: [] }), null); assert.equal(wb({ results: [], rounds: [{ date: '2026-01-01' }] }), null); });
t('the game is the one of the three played most, with putt-369 first on a tie', () => {
  const rs = (id, k) => Array.from({ length: k }, (_, i) => r(id, `2026-0${i + 1}-01`, 5));
  assert.equal(wb({ results: [...rs('putt-lag', 3), ...rs('putt-369', 2), ...rs('putt-streak', 1)] }).game, 'putt-lag');
  assert.equal(wb({ results: [...rs('putt-streak', 3), ...rs('putt-lag', 1)] }).game, 'putt-streak');
  assert.equal(wb({ results: [...rs('putt-lag', 2), ...rs('putt-369', 2)] }).game, 'putt-369');
  assert.equal(wb({ results: [...rs('chip-updown', 5), ...rs('putt-lag', 1)] }).game, 'putt-lag', 'other games do not count');
});
t('the target is the golfer\'s own median in that game, rounded down for a whole-number game', () => {
  const w = (scores) => wb({ results: scores.map((s, i) => r('putt-lag', `2026-0${i + 1}-01`, s)) });
  assert.equal(w([2, 6, 4]).target, 4); assert.equal(w([2, 6, 4]).basis, 'median');
  assert.equal(w([3, 4]).target, 3, '3.5 rounds down so it is a score that can be reached');
  assert.equal(w([0, 0, 1]).target, 1, 'never below 1');
  assert.equal(wb({ results: [r('putt-369', '2026-01-01', 9), r('putt-369', '2026-02-01', 9)] }).target, 9, 'never above the game maximum');
});
t('only the games\' own results are used for the median', () => {
  assert.equal(wb({ results: [r('putt-lag', '2026-01-01', 8), r('putt-369', '2026-01-02', 2), r('putt-369', '2026-01-03', 2), r('putt-369', '2026-01-04', 3)] }).target, 2);
});
t('with none of the three played, it is putt-369 with the 20-handicap score', () => {
  const w = wb({ results: [r('chip-updown', '2026-01-01', 4)] }), bronze = G.tierScores(games.find((g) => g.id === 'putt-369'), 0.9144).find((x) => x.h === 20).score;
  assert.equal(w.game, 'putt-369'); assert.equal(w.basis, 'bench'); assert.equal(w.target, bronze); assert.equal(w.played, 0);
});
t('the three welcome games are all guided and take 6 minutes or less', () => {
  for (const id of S.WELCOME.games) { assert.ok(G.GUIDED.has(id)); assert.ok(G.minutesFor(id) <= 6, id); }
});
t('a welcome-back draft carries its target and the result is marked', () => {
  const g = games.find((x) => x.id === 'putt-lag'), d = G.newDraft(g, { welcome_back: true, target: 4, seed: 3 });
  assert.equal(d.welcome_back, true); assert.equal(d.target, 4);
  d.answers = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1];
  const res = G.resultFromDraft(d, g, { date: '2026-11-30', id: 'x' }); assert.equal(res.welcome_back, true); assert.equal(res.score, 7);
  assert.equal(G.resultFromDraft(G.newDraft(g, { seed: 3 }), g, { date: '2026-11-30', id: 'y' }).welcome_back, undefined, 'a normal game is not marked');
});
console.log(`${n} tests passed`);
