// First week (firstweek.js, first-run plan part B): step order and states, the swap rule, marks, practiceLevel, the journey from the practice level,
// the new-golfer window, and the points and badge for finishing.
import assert from 'node:assert/strict';
import * as FW from '../firstweek.js';
import * as J from '../journey.js';
import * as F from '../features.js';
import * as G from '../games.js';
import * as SK from '../skills.js';
import * as C from '../coach.js';
import { playerLevel, POINTS } from '../level.js';

const games = F.DEFAULT_GAMES;
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name); throw e; } };
const res = (id, game, score, date = '2026-11-10') => ({ id, game, score, date, mode: 'guided', first_week: 1 });
const states = (fw) => fw.steps.map((s) => s.state);
const play = (fw, n, game, id, date = '2026-11-10', swapped = false) => FW.recordStep(fw, { n, game, swapped, result_id: id, date });

t('five steps in the plan\'s order, each with its game and swap', () => {
  assert.deepEqual(FW.STEPS.map((s) => s.game), ['putt-369', 'putt-lag', 'chip-updown', 'range-greens', 'range-driver']);
  assert.deepEqual(FW.STEPS.map((s) => s.alt), [null, null, 'putt-streak', 'putt-par18', 'putt-369']);
  assert.equal(FW.SHORT_MAX_MIN, 15); assert.equal(FW.NEW_DAYS, 14);
});
t('every step and swap fits in SHORT_MAX_MIN minutes (so no shortened version is needed)', () => {
  for (const s of FW.STEPS) for (const id of [s.game, s.alt].filter(Boolean)) assert.ok(G.minutesFor(id) <= FW.SHORT_MAX_MIN, id);
});
t('a fresh start needs no rounds and no results, and only happens once', () => {
  assert.ok(FW.freshStart({ journal: { results: [] }, rounds: [] }));
  assert.ok(!FW.freshStart({ journal: { results: [res('a', 'putt-369', 5)] }, rounds: [] }), 'a golfer with practice data never gets it');
  assert.ok(!FW.freshStart({ journal: { results: [] }, rounds: [{ round_id: 1 }] }), 'a golfer with rounds never gets it');
  assert.ok(!FW.freshStart({ journal: { results: [], first_week: FW.newFirstWeek() }, rounds: [] }));
});
t('no first_week stored: nothing shows (existing golfers)', () => {
  const f = FW.firstWeek({ journal: { results: [res('a', 'putt-369', 5)] }, rounds: [], games }); assert.equal(f.show, false); assert.equal(f.started, false);
});
t('a new first week: step 1 is next, the rest locked', () => {
  const f = FW.firstWeek({ journal: { first_week: FW.newFirstWeek(), results: [] }, rounds: [], games });
  assert.ok(f.show); assert.deepEqual(states(f), ['next', 'locked', 'locked', 'locked', 'locked']); assert.equal(f.next.n, 1); assert.equal(f.count, 0);
  assert.equal(f.steps[0].minutes, G.MINUTES['putt-369']); assert.equal(f.steps[2].alt_name, games.find((g) => g.id === 'putt-streak').name);
});
t('steps open in order and there is no daily lock: all five can be done on one day', () => {
  let fw = FW.newFirstWeek(); const results = [];
  FW.STEPS.forEach((s, i) => { results.push(res(`r${i}`, s.game, 5)); fw = play(fw, s.n, s.game, `r${i}`); const f = FW.firstWeek({ journal: { first_week: fw, results }, rounds: [], games });
    assert.deepEqual(states(f).slice(0, i + 1), Array(i + 1).fill('done')); if (i < 4) assert.equal(f.next.n, i + 2); });
  assert.equal(fw.done_at, '2026-11-10');
  const f = FW.firstWeek({ journal: { first_week: fw, results }, rounds: [], games }); assert.equal(f.done, true); assert.equal(f.show, false); assert.equal(f.progress, 1);
});
t('a step is recorded once: a replay does not change it', () => {
  let fw = play(FW.newFirstWeek(), 1, 'putt-369', 'a'); fw = play(fw, 1, 'putt-369', 'b');
  assert.equal(fw.steps.length, 1); assert.equal(fw.steps[0].result_id, 'a');
});
t('an unknown step number is ignored', () => { const fw = FW.newFirstWeek(); assert.equal(play(fw, 9, 'putt-369', 'x'), fw); });
t('a swapped step counts as done and remembers the game played', () => {
  let fw = FW.newFirstWeek(); fw = play(fw, 1, 'putt-369', 'a'); fw = play(fw, 2, 'putt-lag', 'b'); fw = play(fw, 3, 'putt-streak', 'c', '2026-11-10', true);
  const f = FW.firstWeek({ journal: { first_week: fw, results: [res('a', 'putt-369', 5), res('b', 'putt-lag', 6), res('c', 'putt-streak', 9)] }, rounds: [], games });
  assert.equal(f.steps[2].state, 'done'); assert.equal(f.steps[2].swapped, true); assert.equal(f.steps[2].played, 'putt-streak'); assert.equal(f.next.n, 4);
  assert.equal(f.steps[2].mark.score, 9); assert.equal(f.steps[2].mark.game, 'putt-streak');
});
t('a swapped step leaves its skill unrated until a game in that skill is played', () => {
  const results = [res('c', 'putt-streak', 9)], sk = SK.skillRatings({ results, games });
  assert.equal(sk.skills.find((s) => s.key === 'short').practice_hcp, null);
  assert.notEqual(sk.skills.find((s) => s.key === 'putting').practice_hcp, null);
});
t('the mark is the first play\'s score, with the handicap level it matches', () => {
  const fw = play(FW.newFirstWeek(), 1, 'putt-369', 'a'), f = FW.firstWeek({ journal: { first_week: fw, results: [res('a', 'putt-369', 6)] }, rounds: [], games });
  assert.equal(f.steps[0].mark.score, 6); assert.ok(Number.isFinite(f.steps[0].mark.h) && f.steps[0].mark.h >= 0 && f.steps[0].mark.h <= 25);
  assert.equal(f.steps[1].mark, null, 'no mark before a step is played');
});
t('a first play has no target to miss: the verdict is never "short"', () => {
  const g = games.find((x) => x.id === 'putt-369'), v = G.verdictOf(g, 0, { target: null, prevBest: null });
  assert.equal(v.met, false); assert.equal(v.key, 'done'); assert.equal(v.diff, 0);
});
t('a replay uses the mark as its target (lower-is-better games too)', () => {
  const lag = games.find((x) => x.id === 'putt-lag'), p18 = games.find((x) => x.id === 'putt-par18');
  assert.equal(G.verdictOf(lag, 7, { target: 6 }).met, true); assert.equal(G.verdictOf(lag, 5, { target: 6 }).key, 'short');
  assert.equal(G.verdictOf(p18, 20, { target: 21 }).met, true); assert.equal(G.verdictOf(p18, 23, { target: 21 }).met, false);
  const d = G.newDraft(lag, { seed: 3, first_week: 2, target: 6 }); assert.equal(d.first_week, 2); assert.equal(d.target, 6);
  const d1 = G.newDraft(lag, { seed: 3, first_week: 2 }); assert.equal(d1.target, null, 'a first play carries no target');
  d1.answers = Array(10).fill(1); const r = G.resultFromDraft(d1, lag, { date: '2026-11-10', id: 'z' }); assert.equal(r.first_week, 2);
  assert.equal(G.resultFromDraft(G.newDraft(lag, { seed: 3 }), lag, {}).first_week, undefined, 'ordinary results are unchanged');
});
t('rounds loaded before the first step hide it; loaded part-way through do not', () => {
  const fw0 = FW.newFirstWeek(), rounds = [{ round_id: 1 }];
  assert.equal(FW.firstWeek({ journal: { first_week: fw0, results: [] }, rounds, games }).show, false);
  const fw1 = play(fw0, 1, 'putt-369', 'a'); assert.equal(FW.firstWeek({ journal: { first_week: fw1, results: [res('a', 'putt-369', 5)] }, rounds, games }).show, true);
});
t('skipping hides it for good', () => {
  const fw = { ...play(FW.newFirstWeek(), 1, 'putt-369', 'a'), skipped_at: '2026-11-11' }, f = FW.firstWeek({ journal: { first_week: fw, results: [] }, rounds: [], games });
  assert.equal(f.show, false); assert.equal(f.skipped, true);
});
t('practiceLevel averages the rated skills\' practice handicaps', () => {
  assert.equal(FW.practiceLevel({ skills: [{ practice_hcp: 20 }, { practice_hcp: 28 }, { practice_hcp: null }, { practice_hcp: null }] }), 24);
  assert.equal(FW.practiceLevel([{ practice_hcp: 10.04 }]), 10);
  assert.equal(FW.practiceLevel({ skills: [{ practice_hcp: null }] }), null); assert.equal(FW.practiceLevel(null), null);
});
t('practiceLevel from real first-week scores uses skills.js', () => {
  const results = FW.STEPS.map((s, i) => ({ id: `p${i}`, game: s.game, date: '2026-11-10', score: J.milestoneScore(s.game, 20), mode: 'guided' }));
  const lv = FW.practiceLevel(SK.skillRatings({ results, games })); assert.ok(Math.abs(lv - 20) <= 1.5, lv);
});
t('journey with no index starts from the practice level, flagged practice', () => {
  const j = J.journey({ index: null, practice: 24, results: [], games });
  assert.equal(j.basis, 'practice'); assert.equal(j.start, 24);
  assert.deepEqual(j.stretches.map((s) => s.state), ['practice', 'practice', 'open', 'locked', 'locked', 'locked', 'locked']); assert.equal(j.current.n, 20);
  assert.equal(j.stretches[0].boss.state, 'passed');
});
t('a passed-over stretch earns no stage points', () => {
  const r = ['putt-369', 'putt-369', 'putt-lag'].map((g, i) => ({ id: `s${i}`, game: g, date: '2026-11-10', score: J.milestoneScore(g, 30), mode: 'guided' }));
  assert.equal(J.journey({ index: null, practice: 24, results: r, games }).completions.length, 0);
  assert.equal(J.journey({ index: null, practice: null, results: r, games }).completions.length, 1);
});
t('an index always wins over the practice level', () => {
  const j = J.journey({ index: 13.2, practice: 24, games }); assert.equal(j.basis, 'index'); assert.equal(j.stretches[0].state, 'course'); assert.equal(j.current.n, 10);
  assert.equal(J.journey({ index: null, practice: null, games }).basis, null);
});
t('new golfer: under 14 days since the first practice result, rounds or not', () => {
  const now = new Date('2026-11-24T10:00:00Z'), j = (d) => ({ results: [{ id: 'a', game: 'putt-369', date: d, score: 5 }, { id: 'b', game: 'putt-lag', date: '2026-11-23', score: 5 }] });
  assert.ok(FW.isNewGolfer({ journal: { results: [] }, rounds: [], now }), 'no practice yet');
  assert.ok(FW.isNewGolfer({ journal: j('2026-11-11'), rounds: [], now }), '13 days');
  assert.ok(!FW.isNewGolfer({ journal: j('2026-11-10'), rounds: [], now }), '14 days: the window is from the first result, not the latest');
  assert.ok(FW.isNewGolfer({ journal: j('2026-11-11'), rounds: [{ round_id: 1 }], now }), 'rounds do not end it');
  assert.ok(!FW.isNewGolfer({ journal: j('2026-10-01'), rounds: [], now }), 'no rounds does not keep it going');
  assert.equal(FW.NEW_DAILY_MAX, 10);
});
t('finishing earns 100 points once, outside the daily cap; skipping earns none', () => {
  const lv = playerLevel({ journal: { results: [], first_week: { done_at: '2026-11-10' } }, games });
  assert.equal(POINTS.first_week, 100); assert.ok(lv.ledger.some((l) => l.what === 'First week finished' && l.points === 100)); assert.equal(lv.points, 100);
  assert.equal(playerLevel({ journal: { results: [], first_week: { skipped_at: '2026-11-10' } }, games }).points, 0);
});
t('the First week badge is earned on the day it was finished', () => {
  const b = (fw) => C.badges({ rounds: [], holes: [], journal: { results: [], sessions: [], first_week: fw }, roadmaps: [] }).find((x) => x.id === 'fw');
  assert.equal(b({ done_at: '2026-11-10' }).earned, '2026-11-10'); assert.equal(b({ skipped_at: '2026-11-10' }).earned, null); assert.equal(b(undefined).earned, null);
});
console.log(`firstweek: ${n} tests passed`);
