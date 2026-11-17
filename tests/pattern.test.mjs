// Shot-pattern data for the Course view (course-view plan, phase 2): distance quartiles, estimates and "distance only".
// Run: node tests/pattern.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../analytics.js';
import * as F from '../features.js';
import * as HM from '../holemap.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const b = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url)));
const ds = A.buildDataset({ bundles: b.bundles, clubsBundle: b.clubsBundle || {}, settings: b.settings || {}, corrections: [], manualShots: [] });
const byName = (name) => ds.clubs.find((c) => c.name === name);
const pat = (id) => F.clubPattern(ds, id);

t('clubPattern adds the 25th and 75th percentile of the club\'s distance', () => {
  const p = pat(byName('7 Iron').club_id);
  assert.ok(p.p25_m < p.median_m && p.median_m < p.p75_m && p.p10_m < p.p25_m && p.p75_m < p.p90_m);
  const all = A.stockShots(ds.shots, ds.clubs).filter((s) => s.club_id === p.club_id && !s.partial && !s.partial_by_intent).map((s) => s.dist_m);
  assert.equal(p.p25_m, A.quantile(all, 0.25)); assert.equal(p.p75_m, A.quantile(all, 0.75));
});

t('a part swing has no distance quartiles (they would be the full swing\'s)', () => {
  const base = pat(byName('56° Wedge').club_id), w = F.wedgePattern(base, 50, 0.08);
  assert.equal(w.p25_m, null); assert.equal(w.p75_m, null); assert.equal(w.median_m, 50);
  const est = F.wedgePattern({ stats: { enough: false } }, 50, 0.08);
  assert.equal(est.p25_m, null);
});

t('lateralRatio strict: from your own clubs, or null rather than a guess', () => {
  const r = F.lateralRatio(ds, pat, true);
  assert.ok(r > 0.02 && r < 0.3, String(r));
  assert.equal(F.lateralRatio(ds, pat), r, 'same number when your clubs have patterns');
  const none = { clubs: [{ club_id: 'x' }] };
  assert.equal(F.lateralRatio(none, () => ({ stats: { enough: false } }), true), null);
  assert.equal(F.lateralRatio(none, () => ({ stats: { enough: false } })), 0.07, 'the classic card keeps its fallback');
});

t('how sure: own shots, estimated from other clubs, distance only', () => {
  assert.equal(HM.patternKind(pat(byName('Driver').club_id)), 'own');
  const typed = { club_id: 'u1', median_m: 190, p10_m: null, p90_m: null, stats: { n: 3, enough: false } };
  const e = F.estimatedPattern(typed, F.lateralRatio(ds, pat, true));
  assert.equal(HM.patternKind({ ...e, ratio_own: true }), 'estimated');
  assert.equal(HM.patternKind({ ...e, ratio_own: false }), 'distance');
  assert.equal(HM.patternKind(typed), 'distance');
});

t('usual miss on the sample: pitching wedge finishes right, enough to offer "Allow for it"', () => {
  const p = pat(byName('Pitching Wedge').club_id), m = HM.missOffset(p.stats, p.stats.mean_y_m);
  assert.ok(m.right_m > 4 && m.show && m.allow, JSON.stringify(m));
  const d = pat(byName('8 Iron').club_id), m8 = HM.missOffset(d.stats, d.stats.mean_y_m);
  assert.ok(!m8.show, '8 iron is straight: nothing shown');
});

console.log(`${n} tests passed`);
