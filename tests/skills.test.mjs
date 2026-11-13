// Unit tests for skills.js (plan section 4.4). Run: node tests/skills.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../analytics.js';
import * as B from '../bench.js';
import * as CO from '../coach.js';
import * as F from '../features.js';
import { SKILLS, BENCH, RATING, rateValue, skillRatings } from '../skills.js';

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const YD = 0.9144, FT = 0.3048;

// A synthetic golfer whose numbers are exactly those of a handicap-h golfer in the benchmark tables.
// Proportions are spread with a running quota so 360 holes give the exact share.
function synth(h, { approachShots = 24, noPutts = false } = {}) {
  const quota = (p) => { let k = 0; return () => { const a = Math.floor((k + 1) * p + 1e-9) - Math.floor(k * p + 1e-9); k++; return a; }; };
  const rounds = [], holes = [], shots = [], N = 1200, PER = N / 20;       // 60 holes a round: large cohorts, so quota rounding stays well inside ±0.5 handicap
  for (let r = 0; r < 20; r++) { const d = new Date(2026, 0, 1 + r).toISOString().slice(0, 10); rounds.push({ round_id: `r${r}`, format: '18', date: d, start_time_local: `${d}T09:00:00` }); }
  const gir = quota(CO.standard('gir', h) / 100), fw = quota(CO.standard('fw', h) / 100), sh = quota(B.makeProb(4.5, h)), mid = quota(B.makeProb(9, h));
  const t3 = quota(CO.standard('three', h) / 100 * N / (N / 3));
  for (let i = 0; i < N; i++) {
    const g = gir(), cohort = i % 3, hole = { round_id: `r${Math.floor(i / PER)}`, hole: (i % 18) + 1, par: 4, gir_eff: g, fw_hit: fw() };
    hole.to_par = 0;
    if (!noPutts) {
      if (cohort === 0) { hole.first_putt_eff_m = 4.5 * FT; hole.putts_eff = sh() ? 1 : 2; }
      else if (cohort === 1) { hole.first_putt_eff_m = 9 * FT; hole.putts_eff = mid() ? 1 : 2; }
      else { hole.first_putt_eff_m = 30 * FT; hole.putts_eff = t3() ? 3 : 2; }
    }
    holes.push(hole);
  }
  // up and down is measured on missed greens only, so draw the saves over the missed holes
  const missed = holes.filter((x) => x.gir_eff === 0), q = quota(B.upDown(h)); missed.forEach((x) => { x.to_par = q() ? 0 : 1; });
  for (const [mid_, n] of [[75, approachShots], [125, 24], [175, 24]]) for (let k = 0; k < n; k++) shots.push({ round_id: `r${k % 20}`, category: 'approach', start_to_pin: mid_ * YD, end_to_pin: B.proximityFt(mid_, h) * FT, on_green_end: 1 });
  const pen = quota(B.teePenalties(h) / 14);
  for (let k = 0; k < 280; k++) shots.push({ round_id: `r${k % 20}`, hole: 1, category: 'tee', club_category: 'driver', dist_m: BENCH['driving.distance'](h) * YD, ends_in_penalty: pen() });
  const og = quota(B.chipOnGreen(h));
  for (let k = 0; k < 400; k++) shots.push({ round_id: `r${k % 20}`, hole: (k % 18) + 1, category: 'around_green', on_green_end: og() });
  return { rounds, holes, shots };
}
const ratings = (h, o = {}, extra = {}) => skillRatings({ ...synth(h, o), results: [], games: F.DEFAULT_GAMES, unitM: YD, ...extra });
const sub = (r, skill, key) => r.skills.find((s) => s.key === skill).subs.find((s) => s.key === key);

test('inversion round-trips every benchmark', () => {
  for (const key of Object.keys(BENCH)) for (const h of [0, 5, 10, 15, 20]) {
    const v = BENCH[key](h), back = rateValue(key, v);
    near(back, h, 0.05, `${key} @ ${h}:`);
  }
});
test('values beyond the table clamp to 0 and 36', () => {
  assert.equal(rateValue('approach.gir', 90), 0); assert.ok(rateValue('approach.gir', 0) > 25 && rateValue('approach.gir', 0) <= RATING.max_hcp);
  assert.equal(rateValue('putting.lag', 0), 0); assert.equal(rateValue('putting.lag', 50), RATING.max_hcp);
  assert.equal(rateValue('approach.wedge', 5), 0); assert.ok(rateValue('approach.wedge', 200) <= 36);
  assert.equal(rateValue('putting.short', null), null);
});
test('a golfer with exactly the 10-handicap numbers rates 10 ± 0.5 in every published sub-skill', () => {
  const r = ratings(10);
  for (const [sk, key] of [['putting', 'short'], ['putting', 'mid'], ['putting', 'lag'], ['short', 'updown'], ['approach', 'gir'], ['approach', 'wedge'], ['approach', 'mid'], ['approach', 'long'], ['short', 'chip'], ['driving', 'distance'], ['driving', 'penalties'], ['driving', 'accuracy']])
    near(sub(r, sk, key).hcp, 10, 0.5, `${sk}.${key}`);
  for (const s of r.skills) near(s.hcp, 10, 0.5, s.key);
  near(r.index, 10, 0.5, 'index');
});
test('the same holds at 5, 15 and 20', () => { for (const h of [5, 15, 20]) { const r = ratings(h); for (const s of r.skills) near(s.hcp, h, 0.6, `${s.key} @ ${h}`); } });
test('chip proximity and tee penalties are rated from assumed standards and flagged', () => {
  const r = ratings(10), chip = sub(r, 'short', 'chip'), pen = sub(r, 'driving', 'penalties');
  near(chip.hcp, 10, 0.5, 'chip'); near(pen.hcp, 10, 0.5, 'penalties'); assert.ok(chip.assumed && pen.assumed); assert.ok(!sub(r, 'putting', 'lag').assumed);
  assert.ok(B.ASSUMED.penalties_per14.length === 3 && B.ASSUMED.zone_power > 0);
  // a golfer who never has a tee penalty is rated at least as good as scratch on that sub-skill; more penalties rate worse
  assert.ok(rateValue('driving.penalties', 0) === 0 && rateValue('driving.penalties', 1) > rateValue('driving.penalties', 0.5));
  assert.ok(sub(r, 'short', 'chip').games.some((g) => g.id === 'chip-zone' && Number.isFinite(g.target)), 'chip-zone now has a target');
  assert.ok(sub(r, 'driving', 'accuracy').games.some((g) => g.id === 'range-fairways' && Number.isFinite(g.target)), 'imaginary fairways now has a target');
});
test('Landing zone and Imaginary fairways map scores to handicap levels', () => {
  for (const id of ['chip-zone', 'range-fairways']) {
    assert.ok(B.hasLevel(id) && !B.NO_LEVEL[id]);
    let prev = Infinity; for (const h of [0, 5, 10, 15, 20, 25]) { const e = B.expectedFor(id, h); assert.ok(e < prev, `${id} falls as handicap rises`); prev = e; }
    for (const h of [0, 5, 10, 15, 20]) near(B.level(id, B.expectedFor(id, h)).h, h, 0.3, `${id} round trip @ ${h}`);
  }
  near(B.expectedFor('range-fairways', 10), 14 * 0.48, 1e-9);                       // 48% fairways at 10, Shot Scope / Golf Monthly
  near(B.expectedFor('chip-zone', 10), 10 * Math.pow(B.upDown(10) / B.makeProb(6, 10), 3), 1e-9);
});
test('weights re-normalise when a sub-skill is unrated', () => {
  const full = ratings(10), s = full.skills.find((x) => x.key === 'putting');
  const w = s.subs.filter((x) => x.hcp !== null), expect = w.reduce((t, x) => t + x.hcp * x.weight, 0) / w.reduce((t, x) => t + x.weight, 0);
  near(s.hcp, expect, 1e-9, 'weighted mean');
  // no wedge shots at all: approach is the weighted mean of GIR 0.4, mid 0.2 and long 0.2, re-normalised
  const r = ratings(10, { approachShots: 0 }), a = r.skills.find((x) => x.key === 'approach'), g = sub(r, 'approach', 'gir'), m = sub(r, 'approach', 'mid'), l = sub(r, 'approach', 'long');
  assert.equal(sub(r, 'approach', 'wedge').hcp, null);
  near(a.hcp, (g.hcp * 0.4 + m.hcp * 0.2 + l.hcp * 0.2) / 0.8, 1e-9, 'renormalised');
});
test('low-sample sub-skills are unrated; below the minimum rounds nothing rates from the course', () => {
  const r = ratings(10, { approachShots: 7 }), w = sub(r, 'approach', 'wedge');
  assert.equal(w.hcp, null); assert.equal(w.you, null); assert.equal(w.n, 7);
  const d = synth(10); d.rounds = d.rounds.slice(0, 4);
  const few = skillRatings({ ...d, results: [], games: F.DEFAULT_GAMES, unitM: YD });
  assert.equal(few.enough, false); assert.ok(few.skills.every((s) => !s.rated)); assert.equal(few.index, null);
});
test('unrated sub-skills fall back to practice level + 3, kept separate from the course rating', () => {
  const d = synth(10, { approachShots: 7 }), score = B.expectedFor('range-wedge', 8, YD);
  const results = [1, 2, 3].map((i) => ({ id: i, game: 'range-wedge', date: `2026-03-0${i}`, score }));
  const r = skillRatings({ ...d, results, games: F.DEFAULT_GAMES, unitM: YD }), w = sub(r, 'approach', 'wedge');
  near(w.practice_hcp, 8, 0.3, 'practice level'); near(w.hcp, w.practice_hcp + 3, 1e-9, 'practice + 3'); assert.equal(w.source, 'practice');
  // with enough course data the course rating wins and the practice level is reported alongside
  const r2 = skillRatings({ ...synth(10), results, games: F.DEFAULT_GAMES, unitM: YD }), w2 = sub(r2, 'approach', 'wedge');
  assert.equal(w2.source, 'course'); near(w2.hcp, 10, 0.5); near(w2.practice_hcp, 8, 0.3);
});
test('targets are the skill handicap minus 3, rounded, never below 0', () => {
  const r = ratings(15); for (const s of r.skills) assert.equal(s.target, Math.max(0, Math.round(s.hcp - 3)));
  const scratch = ratings(0); for (const s of scratch.skills) { assert.ok(s.target >= 0); assert.ok(s.hcp <= 0.6); assert.equal(s.target, 0); }
});
test('the two focus skills are the top two by strokes value, and pinning overrides', () => {
  const sample = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url), 'utf8'));
  const ds = A.buildDataset({ bundles: sample.bundles, clubsBundle: sample.clubsBundle, settings: sample.settings, corrections: [], manualShots: [] }, { estimateIndex: true });
  const r = skillRatings({ ...ds, results: [], games: F.DEFAULT_GAMES, unitM: YD });
  const top = [...r.skills].filter((s) => s.rated).sort((a, b) => b.strokes - a.strokes).slice(0, 2).map((s) => s.key);
  assert.deepEqual([...r.focus].sort(), [...top].sort()); assert.equal(r.skills.filter((s) => s.focus).length, 2);
  const pinned = r.skills.map((s) => s.key).find((k) => !top.includes(k)), p = skillRatings({ ...ds, results: [], games: F.DEFAULT_GAMES, unitM: YD, pinned: [pinned] });
  assert.ok(p.focus.includes(pinned)); assert.equal(p.focus.length, 2); assert.equal(p.focus[0], pinned);
  // every sub-skill carries sane numbers; strokes are never negative
  for (const s of r.skills) for (const x of s.subs) { assert.ok(x.strokes >= 0 && Number.isFinite(x.strokes), `${s.key}.${x.key} strokes`); assert.ok(x.n >= 0); }
});
test('game targets are the score a golfer at the skill target posts', () => {
  const r = ratings(12), s = r.skills.find((x) => x.key === 'short'), g = s.subs[0].games.find((x) => x.id === 'chip-updown');
  near(g.target, Math.round(B.expectedFor('chip-updown', s.target, YD) * 10) / 10, 1e-9); assert.equal(g.better, 'higher');
});
test('metres: proximity and distance are returned in the display unit', () => {
  const yd = ratings(10), m = skillRatings({ ...synth(10), results: [], games: F.DEFAULT_GAMES, unitM: 1 });
  near(sub(m, 'approach', 'wedge').you, sub(yd, 'approach', 'wedge').you * FT, 1e-6); assert.equal(sub(m, 'approach', 'wedge').unit, 'm');
  near(sub(m, 'driving', 'distance').you, sub(yd, 'driving', 'distance').you * YD, 1e-6); assert.equal(sub(yd, 'driving', 'distance').unit, 'yd');
  near(sub(m, 'approach', 'wedge').hcp, sub(yd, 'approach', 'wedge').hcp, 1e-9, 'rating is unit-independent');
});
test('SKILLS data matches the plan table', () => {
  assert.deepEqual(SKILLS.map((s) => s.key), ['putting', 'short', 'approach', 'driving']);
  assert.deepEqual(SKILLS.map((s) => s.subs.length), [3, 2, 4, 3]);
  for (const s of SKILLS) { const w = s.subs.reduce((t, x) => t + x.weight, 0); near(w, s.key === 'approach' ? 1 : 1, 1e-9, `${s.key} weights`); }
});
console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
