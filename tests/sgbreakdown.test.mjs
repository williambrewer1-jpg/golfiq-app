// Strokes gained breakdown (distance bands, tee result, miss direction) and the pin-snapped finish fix.
import assert from 'node:assert';
import fs from 'node:fs';
import * as A from '../analytics.js';
import { TOUR_CSV } from '../baseline.js';

const sample = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url)));
const TOUR = A.Baseline.fromCsv(TOUR_CSV, 'pga_tour_broadie');
const build = (bundles) => A.buildDataset({ bundles, clubsBundle: sample.clubsBundle || {}, settings: sample.settings || {}, corrections: [], manualShots: [] });

// 1. Garmin storing the pin as the last shot's finish: not a stiff shot and a 0 ft putt
const bundles = JSON.parse(JSON.stringify(sample.bundles));
let target = null;
for (const b of bundles) {
  const hs = b.shots?.holeShots || b.detail?.holeShots; if (!hs) continue;
  const card = (b.detail.scorecardDetails?.[0]?.scorecard || b.detail.scorecard);
  for (const H of hs) {
    const h = card.holes.find((x) => (x.number ?? x.holeNumber) === H.holeNumber);
    if (!h || !(h.putts > 0) || !H.shots?.length || !H.pinPosition) continue;
    const last = H.shots[H.shots.length - 1]; if (last.endLoc?.lie !== 'Green') continue;
    last.endLoc.lat = H.pinPosition.lat; last.endLoc.lon = H.pinPosition.lon;
    target = { sid: String(b.scorecard_id), hole: H.holeNumber, order: last.shotOrder }; break;
  }
  if (target) break;
}
assert.ok(target, 'sample has a hole to snap');
const ds = build(bundles);
const snapped = ds.shots.find((s) => s.round_id === `garmin-${target.sid}` && s.hole === target.hole && s.shot_order === target.order);
assert.equal(snapped.end_at_pin_marker, true, 'finish on the pin marker is flagged');
assert.equal(snapped.end_to_pin, null, 'no 0 m proximity');
assert.equal(snapped.lateral_m, null); assert.equal(snapped.long_short_m, null);
const hole = ds.holes.find((h) => h.round_id === `garmin-${target.sid}` && h.hole === target.hole);
if (hole.chain_complete) {
  assert.ok(hole.first_putt_eff_m > 1, `first putt uses typical proximity, got ${hole.first_putt_eff_m}`);
  assert.match(hole.first_putt_source, /typical proximity/);
}
// a real finish is untouched
assert.ok(ds.shots.some((s) => !s.end_at_pin_marker && A.isNum(s.end_to_pin) && s.end_to_pin > 0));

// 2. The breakdown
const res = A.strokesGained(ds, TOUR, 'tour');
assert.ok(res.coverage.tracked_rounds > 0 && res.coverage.holes <= res.coverage.all_holes, 'coverage counts tracked rounds only');
const b = A.sgBreakdown(res, ds, 'yd');
const close = (a, c, msg) => assert.ok(Math.abs(a - c) < 1e-9, `${msg}: ${a} vs ${c}`);
// distance bands add up to the category (every approach starts beyond the short-game range, so every one has a band)
close(A.sum(b.approach.rows.map((r) => r.sg_total)), b.approach.all.sg_total, 'approach bands sum to approach');
close(A.sum(b.around.rows.map((r) => r.sg_total)), b.around.all.sg_total, 'short-game bands sum to short game');
close(A.sum(b.tee.finish.map((r) => r.sg_total)), b.tee.all.sg_total, 'tee finishes sum to tee');
assert.equal(b.approach.rows[0].label, 'under 75 yd'); assert.match(b.around.rows.at(-1).label, /–30 yd$/); assert.equal(b.putting.unit, 'ft');
assert.ok(b.putting.rows.every((r) => / ft$/.test(r.label)));
// per 18 = total scaled by complete holes
const r0 = b.approach.rows[0]; close(r0.sg_per18, r0.sg_total * 18 / res.coverage.complete_holes, 'per 18 scaling');
// miss directions: shares add to 100 and every miss counted is a shot going at the green
const m = b.approach.miss;
if (m.missed) close(A.sum(m.dirs.map((d) => d.pct)), 100, 'miss shares');
assert.ok(m.missed <= m.going_at);
assert.equal(A.missDirection({ lateral_m: -2, long_short_m: -10 }), 'Short');
assert.equal(A.missDirection({ lateral_m: 8, long_short_m: 3 }), 'Right');
assert.equal(A.missDirection({ lateral_m: null, long_short_m: 3 }), null);
// leaks: worst first, at least 6 shots each
for (let i = 1; i < b.leaks.length; i++) assert.ok(b.leaks[i - 1].sg_per18 <= b.leaks[i].sg_per18);
assert.ok(b.leaks.every((l) => l.n >= 6));
// metres mode relabels
const bm = A.sgBreakdown(res, ds, 'm'); assert.equal(bm.putting.unit, 'm'); assert.ok(bm.approach.rows.every((r) => / m$/.test(r.label)));
console.log('sg breakdown: pin-snapped finishes fixed, bands add up, misses and leaks consistent – passed');
