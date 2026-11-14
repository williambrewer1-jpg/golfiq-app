// Streak freeze (retention plan 5.1): earned by a full guided session, spent on an empty week, worked out from history. Run: node tests/freeze.test.mjs
import assert from 'node:assert/strict';
import * as C from '../coach.js';
import * as B from '../bench.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
// Weeks are Mon-Sun. NOW is Wednesday 2026-11-18 (ISO week 47); Monday of week k weeks back is MON(k).
const NOW = new Date('2026-11-18T12:00:00'), MON = (k) => { const d = new Date('2026-11-16T12:00:00'); d.setDate(d.getDate() - 7 * k); return d.toISOString().slice(0, 10); };
const wk = (k) => MON(k).slice(0, 10), W = (k) => B.isoWeek(new Date(`${wk(k)}T12:00:00`));
const ses = (k, extra = {}) => ({ id: `ses${k}`, date: wk(k), guided: true, complete: true, results: [], ...extra });
const run = (weeks, sessions = []) => C.streaks(weeks.map(wk), NOW, { sessions });

t('old histories without sessions behave exactly as before', () => {
  const a = run([0, 1, 2, 3]); assert.equal(a.current, 4); assert.equal(a.best, 4); assert.equal(a.freezes_held, 0); assert.deepEqual(a.frozen_weeks, []);
  const b = run([1, 2, 3]); assert.equal(b.current, 3, 'this week is still open'); assert.equal(run([2, 3]).current, 0, 'a missed week breaks it');
  assert.equal(C.streaks([], NOW).current, 0); assert.equal(C.streaks([wk(5), wk(4), wk(2), wk(1), wk(0)], NOW).best, 3);
});
t('a full guided session earns a freeze, at most one a week', () => {
  assert.equal(run([3, 2, 1, 0], [ses(3)]).freezes_held, 1);
  assert.equal(run([3, 2, 1, 0], [ses(3), ses(3, { id: 'again' })]).freezes_held, 1, 'two sessions in one week is still one freeze');
  assert.equal(run([3, 2, 1, 0], [ses(3), ses(2)]).freezes_held, 2);
});
t('no more than two are held', () => { assert.equal(run([4, 3, 2, 1, 0], [ses(4), ses(3), ses(2), ses(1)]).freezes_held, 2); });
t('an unfinished session, a typed-in session and a skills test earn nothing', () => {
  assert.equal(run([2, 1, 0], [ses(2, { complete: false })]).freezes_held, 0);
  assert.equal(run([2, 1, 0], [ses(2, { complete: undefined })]).freezes_held, 0);
  assert.equal(run([2, 1, 0], [ses(2, { guided: false })]).freezes_held, 0);
  assert.equal(run([2, 1, 0], [ses(2, { id: 'test77' })]).freezes_held, 0);
  assert.equal(run([2, 1, 0], [ses(2, { notes: 'Monthly skills test' })]).freezes_held, 0);
});
t('a missed week with a freeze keeps the streak without adding to it', () => {
  const s = run([6, 5, 4, 3, 2, 0], [ses(6)]);                       // five weeks, one session in the first, week 1 missed, this week practised
  assert.deepEqual(s.frozen_weeks, [W(1)]); assert.equal(s.freezes_held, 0);
  assert.equal(s.current, 6, 'the frozen week does not add: 5 weeks + this week'); assert.equal(s.best, 6);
  assert.equal(s.saved[W(1)], 5, 'the freeze saved a five-week streak');
  assert.equal(s.strip[10].frozen, true); assert.equal(s.strip[10].days, 0);
});
t('the streak is not broken while this week is still open and empty', () => {
  const s = run([4, 3, 2, 1], [ses(4)]); assert.equal(s.current, 4); assert.equal(s.freezes_held, 1); assert.deepEqual(s.frozen_weeks, []);
});
t('two missed weeks in a row can use two freezes; a third breaks it', () => {
  const two = run([9, 8, 7, 4, 0], [ses(9), ses(8)]);                // weeks 6 and 5 missed: both frozen. Weeks 3, 2 and 1 are missed with nothing left: broken
  assert.deepEqual(two.frozen_weeks, [W(6), W(5)]); assert.equal(two.best, 4, 'weeks 9, 8, 7 and 4: the frozen weeks do not add'); assert.equal(two.current, 1);
  const three = run([9, 8, 7, 3, 0], [ses(9), ses(8)]);              // weeks 6 and 5 frozen, week 4 missed with no freeze left: it breaks there
  assert.equal(three.frozen_weeks.includes(W(4)), false); assert.equal(three.best, 3); assert.equal(three.current, 1);
});
t('a freeze earned in a week is only there for later weeks, and is not spent on a practised week', () => {
  const s = run([3, 2, 1, 0], [ses(1)]); assert.equal(s.freezes_held, 1); assert.deepEqual(s.frozen_weeks, []);
});
t('frozen_live only lists freezes inside the streak that is still running', () => {
  const broke = run([9, 8, 6, 3, 2, 1, 0], [ses(9), ses(8)]);        // weeks 7 and 5 frozen, week 4 broke it, then four weeks again
  assert.deepEqual(broke.frozen_weeks, [W(7), W(5)]); assert.deepEqual(broke.frozen_live, [], 'the streak broke after the freezes'); assert.equal(broke.current, 4);
  const live = run([6, 5, 4, 3, 2, 0], [ses(6)]); assert.deepEqual(live.frozen_live, [W(1)]);
});
t('badges still count weekly streaks, now through a freeze', () => {
  const b = C.badges({ rounds: [], holes: [], journal: { results: [], sessions: [] }, roadmaps: [] }); assert.ok(b.find((x) => x.id === 'w4'));
});
t('without sessions the current streak matches the old counting on 300 random histories (best only differs across New Year, where the old count was wrong)', () => {
  const DAY = 864e5, old = (dates, now) => {                                        // the previous implementation, kept here as the reference
    const wk = (d) => B.isoWeek(new Date(`${d}T12:00:00`)), weeks = new Set(dates.map(wk)), back = (k) => B.isoWeek(new Date(now.getTime() - k * 7 * DAY));
    let cur = 0, i = weeks.has(back(0)) ? 0 : 1; while (weeks.has(back(i))) { cur++; i++; }
    const all = [...weeks].sort(); let best = 0, r = 0, prev = null;
    for (const w of all) { const [y, k] = w.split('-W').map(Number), idx = y * 53 + k; r = prev !== null && idx === prev + 1 ? r + 1 : 1; best = Math.max(best, r); prev = idx; }
    return { current: cur, best: Math.max(best, cur), thisWeek: weeks.has(back(0)) };
  };
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 300; k++) {
    const now = new Date(Date.UTC(2025, 0, 1) + Math.floor(rnd() * 700) * DAY + 12 * 3600e3), dates = Array.from({ length: Math.floor(rnd() * 40) }, () => new Date(now.getTime() - Math.floor(rnd() * 300) * DAY).toISOString().slice(0, 10));
    const a = old(dates, now), b = C.streaks(dates, now); assert.deepEqual({ current: b.current, thisWeek: b.thisWeek }, { current: a.current, thisWeek: a.thisWeek }, JSON.stringify([now, dates]));
    // the old "best" counted weeks as year x 53 + week, so a run across New Year (a 52-week year) was cut in two; the new walk counts real weeks, so it can only be longer
    assert.ok(b.best >= a.best, JSON.stringify([now, dates]));
  }
});
console.log(`${n} tests passed`);
