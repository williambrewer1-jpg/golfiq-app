// Unit tests for caddie.js – strategy tips on the Course view (course-view plan, phase 5). Run: node tests/caddie.test.mjs
// Each tip is tested at its minimum data: one short of it gives no tip.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../analytics.js';
import * as CA from '../caddie.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const O = [-30, 140], KY = 111320, KX = KY * Math.cos(O[0] * Math.PI / 180);
const ll = (e, nm) => [O[0] + nm / KY, O[1] + e / KX];
const rect = (e0, n0, e1, n1) => [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)];
const circle = (e, nm, r) => Array.from({ length: 24 }, (_, i) => ll(e + r * Math.sin(i * Math.PI / 12), nm + r * Math.cos(i * Math.PI / 12)));
const TEE = ll(0, 0), GREEN = ll(0, 360), GPTS = circle(0, 360, 14);
const U = { d: (m) => m / 0.9144, unit: 'yd', small: (m) => `${Math.round(m / 0.3048)} ft` };
const hist = (plays, avg, par = 4, si = 2) => ({ plays, avg, par, best: 4, fw_hit: 1, fw_n: 2, gir_hit: 1, gir_n: 2, miss_side: null });
const keys = (ts) => ts.map((x) => x.key);

t('situation: tee, approach, lay-up, around the green, on the green', () => {
  const s = (pos, o = {}) => CA.situation({ pos, tee: TEE, green: GREEN, greenPts: GPTS, shotsThisHole: 0, reach_m: 230, ...o });
  assert.equal(s(ll(2, 5)), 'tee');
  assert.equal(s(ll(2, 5), { shotsThisHole: 1 }), 'layup', 'after a shot from the tee box: not the tee any more');
  assert.equal(s(ll(0, 200)), 'approach');
  assert.equal(s(ll(0, 60)), 'layup', '300 m out, longest club 230 m');
  assert.equal(s(ll(0, 60), { reach_m: null }), 'approach', 'no reach known: approach');
  assert.equal(s(ll(0, 336)), 'around', '24 m out');
  assert.equal(s(ll(4, 362)), 'green');
  assert.equal(s(ll(0, 352), { greenPts: null }), 'green', 'no outline: within 10 m of the centre');
  assert.equal(s(null), null);
});

t('tee: your average here (3+ plays) and the trouble gap between clubs (10 points+)', () => {
  const top = [{ club: 'Driver', out: { trouble: 31 } }, { club: '3 Wood', out: { trouble: 8 } }];
  const tip = (h, tp) => CA.tips({ situation: 'tee', hole: { par: 4 }, history: h, model: { top: tp }, u: U }).find((x) => x.key === 'tee-clubs');
  assert.equal(tip(hist(3, 4.83), top).text, 'You average 4.8 here. 3 Wood: 8% trouble; Driver: 31%.');
  assert.equal(tip(hist(2, 4.83), top).text, '3 Wood: 8% trouble; Driver: 31%.', 'two plays: no average');
  assert.equal(tip(hist(3, 4.83), [{ club: 'Driver', out: { trouble: 12 } }, { club: '3 Wood', out: { trouble: 8 } }]).text, 'You average 4.8 here.', 'gap under 10: no club line');
  assert.equal(tip(hist(2, 4.8), [{ club: 'Driver', out: { trouble: 12 } }, { club: '3 Wood', out: { trouble: 8 } }]), undefined, 'neither: no tip');
  assert.equal(tip(null, [{ club: 'Driver', out: null }, { club: '3 Wood', out: null }]), undefined, 'no patterns: no tip');
});

t('tee: trouble in the landing zone names the side and the distance', () => {
  const model = { pos: TEE, aim: ll(0, 230), top: [], haz: [{ kind: 'water', pts: rect(-40, 197, -12, 219.6), area_m2: 300 }] };
  const tip = CA.tips({ situation: 'tee', hole: { par: 4 }, history: null, model, u: U }).find((x) => x.key === 'tee-trouble');
  assert.equal(tip.text, 'Trouble is left: water at 215–240. Favour the right half.');
  model.haz.push({ kind: 'bunker', pts: rect(15, 220, 25, 230), area_m2: 80 });
  assert.match(CA.tips({ situation: 'tee', hole: { par: 4 }, model, u: U }).find((x) => x.key === 'tee-trouble').text, /^Trouble both sides: water at 215–240 left/);
  assert.equal(CA.tips({ situation: 'tee', hole: { par: 4 }, model: { ...model, haz: [] }, u: U }).length, 0, 'no mapped hazard in the zone: no tip');
});

t('approach: front, back and the side you would be short-sided on (needs the outline and a hazard beside the green)', () => {
  const pos = ll(0, 200), front = 146, back = 174, hole = { par: 4, pos, green: GREEN, greenPts: GPTS, front_m: front, back_m: back };
  const feats = [{ kind: 'bunker', pts: circle(22, 360, 6) }, { kind: 'water', pts: rect(-60, 100, -40, 120) }];
  const tip = CA.tips({ situation: 'approach', hole, feats, u: U }).find((x) => x.key === 'green-sides');
  assert.equal(tip.text, 'Front 160, back 190. Short-sided if you miss right: bunker right of the green.');
  const both = [...feats, { kind: 'water', pts: rect(-30, 350, -20, 370) }];
  assert.match(CA.tips({ situation: 'approach', hole, feats: both, u: U })[0].text, /Trouble both sides of the green/);
  assert.equal(CA.tips({ situation: 'approach', hole, feats: [feats[1]], u: U }).length, 0, 'nothing beside the green: no tip');
  assert.equal(CA.tips({ situation: 'approach', hole: { ...hole, greenPts: null, front_m: null }, feats, u: U }).length, 0, 'no outline: no tip');
  const sides = CA.greenSides(pos, GREEN, GPTS, [{ kind: 'bunker', pts: circle(0, 380, 5) }, { kind: 'bunker', pts: circle(0, 340, 5) }]);
  assert.deepEqual([sides.long, sides.short], [['bunker'], ['bunker']]);
});

t('lay-up: the wedge band you finish closest from, with 10+ shots; else a full wedge from the wedge matrix', () => {
  const bands = [{ band: '50-75 yd', band_lo_m: 45.72, shots: 30, median_proximity_m: 8 }, { band: '75-100 yd', band_lo_m: 68.58, shots: 12, median_proximity_m: 6.5 },
    { band: '100-125 yd', band_lo_m: 91.44, shots: 9, median_proximity_m: 5 }, { band: '125-150 yd', band_lo_m: 114.3, shots: 40, median_proximity_m: 4 }];
  const tip = CA.tips({ situation: 'layup', hole: { par: 5 }, wedges: { bands }, u: U })[0];
  assert.equal(tip.text, 'Lay up to about 90: your best wedge distance.');
  assert.equal(tip.detail, 'From 75-100 you finish 21 ft from the hole on average (12 shots).');
  const fewer = bands.map((b) => (b.band === '75-100 yd' ? { ...b, shots: 9 } : b));
  assert.match(CA.tips({ situation: 'layup', hole: {}, wedges: { bands: fewer }, u: U })[0].text, /about 65/, '75–100 now short of 10 shots: 50–75 instead');
  const none = bands.map((b) => ({ ...b, shots: 5 }));
  assert.equal(CA.tips({ situation: 'layup', hole: {}, wedges: { bands: none }, u: U }).length, 0);
  const rows = [{ club: 'Pitching Wedge', length: 'Full', carry_m: 105 * 0.9144, n: 3 }];
  assert.equal(CA.tips({ situation: 'layup', hole: {}, wedges: { bands: none, rows }, u: U })[0].text, 'Lay up to 105: your full Pitching Wedge.');
});

t('around the green: your up-and-down rate from this distance (20+ tries), else overall (20+)', () => {
  const tries = (k, d, okEvery) => Array.from({ length: k }, (_, i) => ({ d, ok: i % okEvery === 0 }));
  const st = { ud: [...tries(20, 14, 3), ...tries(10, 25, 2)] };
  const tip = CA.tips({ situation: 'around', hole: { d_green_m: 15 }, stats: st, u: U })[0];
  assert.equal(tip.text, 'You get up and down 35% from here.'); assert.equal(tip.detail, '20 times from 10–20 yd.');
  const st2 = { ud: [...tries(19, 14, 3), ...tries(10, 25, 2)] };
  assert.equal(CA.tips({ situation: 'around', hole: { d_green_m: 15 }, stats: st2, u: U })[0].text, 'You get up and down 41% of the time around the green.', 'band short of 20: overall');
  assert.equal(CA.tips({ situation: 'around', hole: { d_green_m: 15 }, stats: { ud: tries(19, 14, 3) }, u: U }).length, 0, 'under 20 in all: no tip');
});

t('on the green: three-putts from 30 ft+ (20+ long putts), only when this putt is that long', () => {
  const tip = (lp, d) => CA.tips({ situation: 'green', hole: { d_green_m: d }, stats: { ud: [], long_putts: lp }, u: U })[0];
  assert.equal(tip({ n: 20, three: 5 }, 10).text, 'From 30 ft+ you three-putt 1 in 4. Lag it close.');
  assert.equal(tip({ n: 19, three: 5 }, 10), undefined, '19 long putts: no tip');
  assert.equal(tip({ n: 20, three: 5 }, 6), undefined, 'a 20 ft putt: not this tip');
  assert.equal(tip({ n: 24, three: 0 }, 10).text, 'From 30 ft+ you have not three-putted in 24 tries.');
  assert.match(CA.tips({ situation: 'green', hole: { d_green_m: 10 }, stats: { long_putts: { n: 20, three: 5 } }, u: { ...U, unit: 'm' } })[0].text, /^From 9 m\+/);
});

t('stroke index 1–4 and your average at least par + 1 (3+ plays): bogey is a good score', () => {
  const tip = (si, h) => CA.tips({ situation: 'approach', hole: { par: 4, si }, history: h, u: U }).find((x) => x.key === 'stroke-index');
  assert.equal(tip(2, hist(3, 5.0)).text, 'Stroke index 2: bogey is a good score here.');
  assert.equal(tip(5, hist(3, 5.0)), undefined, 'SI 5');
  assert.equal(tip(2, hist(3, 4.9)), undefined, 'average under par + 1');
  assert.equal(tip(2, hist(2, 5.5)), undefined, 'two plays');
  assert.equal(tip(null, hist(5, 5.5)), undefined, 'no stroke index');
});

t('tips come strongest first, and nothing comes without data', () => {
  assert.deepEqual(CA.tips({ situation: 'tee', hole: { par: 4 }, u: U }), []);
  assert.deepEqual(CA.tips({ situation: 'around', hole: { d_green_m: 12 }, stats: { ud: [] }, u: U }), []);
  const many = CA.tips({ situation: 'tee', hole: { par: 4, si: 1 }, history: hist(4, 5.2), model: { pos: TEE, aim: ll(0, 230), top: [{ club: 'Driver', out: { trouble: 40 } }, { club: '3 Wood', out: { trouble: 5 } }], haz: [{ kind: 'water', pts: rect(-40, 197, -12, 219.6) }] }, u: U });
  assert.deepEqual(keys(many), ['tee-clubs', 'tee-trouble', 'stroke-index']);
  assert.ok(many.every((x, i) => i === 0 || many[i - 1].strength >= x.strength));
});

t('hazard reach and carry along the line of play: within the corridor and reach, nearest first, at most four', () => {
  const feats = [{ kind: 'bunker', pts: rect(-10, 210, 5, 225) }, { kind: 'water', pts: rect(-20, 120, 20, 140) }, { kind: 'bunker', pts: rect(60, 150, 70, 160) },
    { kind: 'trees', pts: rect(-5, 100, 5, 110) }, { kind: 'bunker', pts: rect(-5, 300, 5, 310) }, ...[250, 260, 270].map((y) => ({ kind: 'bunker', pts: rect(-3, y, 3, y + 5) }))];
  const r = CA.hazardReach(TEE, ll(0, 230), feats, { max_m: 280 });
  assert.deepEqual(r.map((x) => [x.kind, Math.round(x.reach_m), Math.round(x.carry_m)]), [['water', 120, 140], ['bunker', 210, 225], ['bunker', 250, 255], ['bunker', 260, 265]]);
  assert.equal(r.length, 4, 'four labels at most'); assert.ok(!r.some((x) => x.kind === 'trees'), 'bunkers and water only');
  assert.equal(CA.hazardReach(TEE, ll(0, 230), feats, { max_m: 200 }).length, 1, 'beyond reach: left out');
  assert.equal(CA.hazardReach(TEE, ll(0, 230), [{ kind: 'bunker', pts: rect(60, 150, 70, 160) }], { max_m: 280 }).length, 0, '60 m off the line');
  assert.equal(CA.hazardReach(ll(0, 120), ll(0, 230), [{ kind: 'water', pts: rect(-20, 120, 20, 140) }], { max_m: 280 }).length, 0, 'standing beside it: not labelled');
});

t('your history on the sample data: a hole with 3+ plays, short game and long putts', () => {
  const b = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url)));
  const ds = A.buildDataset({ bundles: b.bundles, clubsBundle: b.clubsBundle || {}, settings: b.settings || {}, corrections: [], manualShots: [] });
  const [cid, hole] = [...A.groupBy(ds.holes, (h) => `${h.course_id}|${h.hole}`)].sort((x, y) => y[1].length - x[1].length)[0][0].split('|');
  const h = CA.holeHistory(ds, cid, Number(hole)), g = ds.holes.filter((x) => x.course_id === cid && x.hole === Number(hole));
  assert.ok(h.plays >= 3); assert.equal(h.plays, g.length);
  assert.equal(h.avg, A.mean(g.map((x) => x.strokes))); assert.equal(h.best, Math.min(...g.map((x) => x.strokes)));
  assert.equal(CA.holeHistory(ds, null, 1), null); assert.deepEqual(CA.holeHistory(ds, 'nowhere', 1), { plays: 0 });
  const st = CA.golferStats(ds);
  assert.ok(st.ud.length > 0 && st.ud.every((x) => A.isNum(x.d) && typeof x.ok === 'boolean'));
  assert.equal(st.long_putts.n, ds.holes.filter((x) => A.isNum(x.first_putt_eff_m) && x.first_putt_eff_m >= CA.LONG_PUTT_M && A.isNum(x.putts_eff) && !x.excluded).length);
});

t('minimums are the plan\'s', () => { assert.deepEqual([CA.MIN.hole_plays, CA.MIN.short_game, CA.MIN.long_putts], [3, 20, 20]); });

console.log(`${n} tests passed`);
