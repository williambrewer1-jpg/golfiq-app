// Unit tests for the earned potential (plan 5.4). Run: node tests/potential.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../analytics.js';
import * as CO from '../coach.js';
import * as F from '../features.js';
import { skillRatings } from '../skills.js';

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} ± ${tol}, got ${a}`);
const P = CO.POTENTIAL, NOW = Date.parse('2026-11-14T12:00:00'), day = (n) => new Date(NOW - n * 864e5).toISOString().slice(0, 10);

// hand-built ratings: Approach and Short game are the focus areas
const sub = (skill, key, strokes, games, extra = {}) => ({ key, full_key: `${skill}.${key}`, title: key, strokes, enough: true, you: 30, target_value: 50, higher: true, games, own_history: false, ...extra });
const g = (id, target, better = 'higher') => ({ id, name: id, target, better });
const ratings = (over = {}) => ({ focus: ['approach', 'short'], skills: [
  { key: 'putting', rated: true, subs: [sub('putting', 'lag', 0.4, [g('putt-lag', 7)])] },
  { key: 'short', rated: true, subs: [sub('short', 'updown', 1.2, [g('chip-updown', 5)])] },
  { key: 'approach', rated: true, subs: [sub('approach', 'gir', 2.0, [g('range-greens', 4)]), sub('approach', 'wedge', 0.6, [g('range-wedge', 6)])] },
  { key: 'driving', rated: true, subs: [sub('driving', 'accuracy', 0.1, [g('range-fairways', null)])] }], ...over });
const res = (game, score, ago, extra = {}) => ({ id: `${game}${ago}${score}`, game, score, date: day(ago), ...extra });
const plan = (results, o = {}) => CO.potentialPlan({ ratings: ratings(), results, rounds: [], now: NOW, index: 11, ...o });

test('no practice: gain is the base only', () => { const p = plan([]); assert.equal(p.gain, P.base); assert.equal(p.momentum, 0); assert.equal(p.unlocked, 0); assert.deepEqual(p.active, []); });
test('two active focus skills add momentum; a third active skill adds a little more', () => {
  const two = plan([res('chip-updown', 2, 1), res('chip-updown', 3, 2), res('range-greens', 2, 1), res('range-wedge', 2, 3)]);
  assert.deepEqual(two.active.sort(), ['approach', 'short']); near(two.momentum, P.momentum2, 1e-9); near(two.gain, P.base + P.momentum2, 1e-9);
  const three = plan([res('chip-updown', 2, 1), res('chip-updown', 3, 2), res('range-greens', 2, 1), res('range-wedge', 2, 3), res('putt-lag', 1, 1), res('putt-lag', 2, 2)]);
  near(three.momentum, P.momentum2 + P.momentum3, 1e-9);
  const one = plan([res('chip-updown', 2, 1), res('chip-updown', 3, 2)]); assert.equal(one.momentum, 0, 'only one focus skill active');
});
test('one guided session makes a skill active', () => {
  const p = plan([res('chip-updown', 2, 1, { mode: 'guided' }), res('range-greens', 2, 1, { mode: 'guided' })]); near(p.momentum, P.momentum2, 1e-9);
});
test('activity older than 14 days drops momentum', () => {
  const old = plan([res('chip-updown', 2, 15), res('chip-updown', 3, 16), res('range-greens', 2, 15), res('range-wedge', 2, 17)]); assert.equal(old.momentum, 0); assert.deepEqual(old.active, []);
  const fresh = plan([res('chip-updown', 2, 13), res('chip-updown', 3, 13), res('range-greens', 2, 13), res('range-wedge', 2, 13)]); near(fresh.momentum, P.momentum2, 1e-9);
});
test('hits raise the unlocked amount in thirds', () => {
  const credit = (n) => plan(Array.from({ length: n }, (_, i) => res('chip-updown', 6, 2 + i))).ledger.find((x) => x.sub === 'short.updown').credit, full = 1.2 * P.transfer;
  near(credit(0), 0, 1e-9); near(credit(1), full / 3, 1e-9); near(credit(2), full * 2 / 3, 1e-9); near(credit(3), full, 1e-9); near(credit(5), full, 1e-9, 'capped at full');
  assert.equal(plan([res('chip-updown', 4, 2)]).ledger.find((x) => x.sub === 'short.updown').hits, 0, 'a score under the target is not a hit');
});
test('lower-is-better games count scores at or under the target', () => {
  const r = ratings(); r.skills[1].subs[0].games = [g('chip-par18', 12, 'lower')];
  const p = CO.potentialPlan({ ratings: r, results: [res('chip-par18', 11, 1), res('chip-par18', 13, 1)], rounds: [], now: NOW, index: 11 }); assert.equal(p.ledger.find((x) => x.sub === 'short.updown').hits, 1);
});
test('hits older than 60 days do not count; pressure hits count 1.5', () => {
  assert.equal(plan([res('chip-updown', 6, 61)]).ledger.find((x) => x.sub === 'short.updown').hits, 0);
  near(plan([res('chip-updown', 6, 2, { pressure: true })]).ledger.find((x) => x.sub === 'short.updown').hits, 1.5, 1e-9);
});
test('only sub-skills in a focus area can unlock', () => { assert.ok(!plan([res('putt-lag', 9, 1), res('putt-lag', 9, 2), res('putt-lag', 9, 3)]).ledger.some((x) => x.skill === 'putting')); });
test('caps hold: unlocked <= 3.0, total <= 4.0 and <= 30% of the index', () => {
  const big = ratings(); big.skills[1].subs[0].strokes = 20; big.skills[2].subs[0].strokes = 20;
  const all = [...['chip-updown', 'range-greens', 'putt-lag'].flatMap((id) => [1, 2, 3, 4].map((i) => res(id, 99, i)))];
  const p = CO.potentialPlan({ ratings: big, results: all, rounds: [], now: NOW, index: 20 }); near(p.unlocked, P.unlocked_cap, 1e-9); near(p.gain, P.total_cap, 1e-9); assert.ok(p.capped);
  const low = CO.potentialPlan({ ratings: big, results: all, rounds: [], now: NOW, index: 5 }); near(low.gain, 0.3 * 5, 1e-9, '30% of a 5 index');
  assert.ok(CO.potentialPlan({ ratings: ratings(), results: [], rounds: [], now: NOW, index: 0 }).gain >= 0);
});
test('the course confirms a sub-skill: full credit; no movement after 8 rounds: stays at half', () => {
  const results = [1, 2, 3].map((i) => res('chip-updown', 6, 40 + i)), rounds = (n) => Array.from({ length: n }, (_, i) => ({ format: '18', date: day(30 - i) }));
  const r = ratings(); r.skills[1].subs[0].you = 55;                             // on-course number now at the target (50)
  const conf = CO.potentialPlan({ ratings: r, results, rounds: rounds(6), now: NOW, index: 11, baselines: { 'short.updown': 1.2 } }).ledger.find((x) => x.sub === 'short.updown');
  assert.ok(conf.confirmed); near(conf.credit, 1.2, 1e-9);
  const stall = CO.potentialPlan({ ratings: ratings(), results, rounds: rounds(9), now: NOW, index: 11 }).ledger.find((x) => x.sub === 'short.updown');
  assert.ok(stall.stalled && !stall.confirmed); near(stall.credit, 1.2 * P.transfer, 1e-9); assert.match(stall.next, /on-course challenge/);
  const early = CO.potentialPlan({ ratings: ratings(), results, rounds: rounds(3), now: NOW, index: 11 }).ledger.find((x) => x.sub === 'short.updown'); assert.ok(!early.stalled && !early.confirmed);
});
test('the ledger leads with the best next action', () => {
  const p = plan([]); assert.equal(p.ledger[0].sub, 'approach.gir'); assert.match(p.ledger[0].next, /Score 4\+ in range-greens 3 more times → −0\.3/);
  assert.match(plan([res('range-greens', 9, 1), res('range-greens', 9, 2)]).ledger.find((x) => x.sub === 'approach.gir').next, /once more/);
});
test('forecast: potential = current - gain, starts at the current index and never rises above it', () => {
  const sample = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url), 'utf8'));
  const ds = A.buildDataset({ bundles: sample.bundles, clubsBundle: sample.clubsBundle, settings: sample.settings, corrections: [], manualShots: [] }, { estimateIndex: true });
  for (const gain of [0.5, 1.5, 4]) { const f = CO.forecast(ds.rounds, { gain, now: Date.parse('2026-11-24') });
    assert.ok(f.ok); near(f.potential_path[0].likely, f.current, 0.05); near(f.potential, f.current - gain, 0.06, `gain ${gain}`);
    assert.ok(f.potential_path.every((p) => p.likely <= f.current + 1e-9 && p.high <= f.current + 1e-9)); }
});
test('sample data with no extra practice: potential sits 0.5–1.0 shots under the current index', () => {
  const sample = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url), 'utf8'));
  const ds = A.buildDataset({ bundles: sample.bundles, clubsBundle: sample.clubsBundle, settings: sample.settings, corrections: [], manualShots: [] }, { estimateIndex: true });
  const fc0 = CO.forecast(ds.rounds, { now: Date.parse('2026-11-24') }), sk = skillRatings({ ...ds, results: [], games: F.DEFAULT_GAMES, unitM: 0.9144 });
  const pl = CO.potentialPlan({ ratings: sk, results: [], rounds: ds.rounds, now: Date.parse('2026-11-24'), index: fc0.current });
  const fc = CO.forecast(ds.rounds, { gain: pl.gain, now: Date.parse('2026-11-24') }), drop = fc.current - fc.potential;
  assert.ok(drop >= 0.5 - 1e-9 && drop <= 1.0 + 1e-9, `drop ${drop}`); console.log(`     sample: ${fc.current} -> ${fc.potential} (gain ${pl.gain})`);
});
test('Imaginary fairways and Landing zone targets can now unlock potential', () => {
  const sample = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url), 'utf8'));
  const ds = A.buildDataset({ bundles: sample.bundles, clubsBundle: sample.clubsBundle, settings: sample.settings, corrections: [], manualShots: [] }, { estimateIndex: true });
  const today = new Date().toISOString().slice(0, 10), results = [1, 2, 3].flatMap((i) => [{ id: `f${i}`, game: 'range-fairways', date: today, score: 14 }, { id: `z${i}`, game: 'chip-zone', date: today, score: 10 }]);
  const sk = skillRatings({ ...ds, results, games: F.DEFAULT_GAMES, unitM: 0.9144, pinned: ['driving', 'short'] });
  const acc = sk.skills.find((s) => s.key === 'driving').subs.find((s) => s.key === 'accuracy'); assert.ok(Number.isFinite(acc.games[0].target), 'fairways target');
  const pl = CO.potentialPlan({ ratings: sk, results, rounds: ds.rounds, index: 11 }), x = pl.ledger.find((l) => l.sub === 'driving.accuracy');
  assert.ok(x && x.hits === 3 && x.credit > 0, JSON.stringify(x));
  assert.ok(sk.skills.find((s) => s.key === 'short').subs.find((s) => s.key === 'chip').practice_hcp !== null, 'chip practice level from Landing zone');
});
test('POTENTIAL defaults match the plan', () => { assert.deepEqual([P.base, P.momentum2, P.momentum3, P.transfer, P.unlocked_cap, P.total_cap, P.pct_cap, P.hits_needed, P.hit_days, P.active_days], [0.5, 0.5, 0.25, 0.5, 3, 4, 0.3, 3, 60, 14]); });
console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
