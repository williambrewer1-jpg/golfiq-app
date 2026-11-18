// Unit tests for shots.js – shot tracking and what a hole works out for itself (course-view plan, phase 3).
// Run: node tests/shots.test.mjs
import assert from 'node:assert/strict';
import * as SH from '../shots.js';
import * as A from '../analytics.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);
// an invented hole running north: metres east / north of the tee
const O = [-30, 140], KY = 111320, KX = KY * Math.cos(O[0] * Math.PI / 180);
const ll = (e, nm) => [O[0] + nm / KY, O[1] + e / KX];
const rect = (e0, n0, e1, n1) => [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)];
const circle = (e, nm, r) => Array.from({ length: 24 }, (_, i) => ll(e + r * Math.sin(i * Math.PI / 12), nm + r * Math.cos(i * Math.PI / 12)));
const TEE = ll(0, 0), GREEN = ll(0, 360), LINE = [TEE, ll(0, 200), GREEN];
const FEATS = [{ kind: 'tee', pts: rect(-8, -6, 8, 6) }, { kind: 'fairway', pts: rect(-15, 60, 15, 338) }, { kind: 'green', pts: circle(0, 360, 14) },
  { kind: 'bunker', pts: circle(24, 356, 6) }, { kind: 'water', pts: rect(-50, 200, -20, 250) }];
const G = (pt, acc = 4) => ({ gps: pt, acc, tee: TEE, feats: FEATS });
const hole = (par = 4) => ({ par, strokes: null, putts: null, penalties: 0, fairway: null });

t('resultAt reads the mapped surface; a tee box counts as fairway; no map gives null', () => {
  assert.equal(SH.resultAt(ll(0, 230), FEATS), 'fairway');
  assert.equal(SH.resultAt(ll(40, 230), FEATS), 'rough');
  assert.equal(SH.resultAt(ll(-35, 225), FEATS), 'water');
  assert.equal(SH.resultAt(ll(24, 356), FEATS), 'bunker');
  assert.equal(SH.resultAt(ll(2, 361), FEATS), 'green');
  assert.equal(SH.resultAt(ll(0, 0), FEATS), 'fairway');
  assert.equal(SH.resultAt(ll(0, 230), []), null);
  assert.equal(SH.resultAt(null, FEATS), null);
});

t('a par 4 played normally: fairway, green, two putts = par, fairway hit, green in regulation', () => {
  const h = hole();
  const s1 = SH.hit(h, { ...G(ll(0, 1)), club_id: 'drv', aim: ll(0, 230) });
  assert.equal(s1.lie, 'tee'); assert.equal(SH.stateOf(h), 'open');
  const c1 = SH.close(h, G(ll(6, 236)));
  assert.equal(c1.kind, 'end'); assert.equal(s1.result, 'fairway'); assert.equal(s1.approx, false);
  near(SH.shotLine(s1).dist_m, 235, 1); near(SH.shotLine(s1).right_m, 6, 0.6, 'right of aim');
  assert.equal(SH.stateOf(h), 'ready');
  const s2 = SH.hit(h, { ...G(ll(6, 236)), club_id: '8i', aim: GREEN });
  assert.equal(s2.lie, 'fairway');
  SH.close(h, G(ll(3, 358)));
  assert.equal(SH.stateOf(h), 'putting', 'on the green: putting');
  const dv = SH.holeOut(h, { putts: 2, first_putt_m: 6 * SH.FT, par: 4, line: LINE, green: GREEN });
  assert.deepEqual([dv.strokes, dv.putts, dv.penalties, dv.fairway, dv.gir, dv.up_down, dv.sand_save], [4, 2, 0, 'HIT', 1, null, null]);
  assert.equal(h.strokes, 4); assert.equal(h.putts, 2); assert.equal(h.fairway, 'HIT'); assert.equal(h.done, true);
  near(h.first_putt_m, 1.83, 0.01); assert.equal(SH.stateOf(h), 'done');
  assert.equal(SH.scoreName(h.strokes, 4), 'Par');
});

t('a par 4 with a water penalty: drop taken at the next "At my ball", score includes the stroke, fairway missed left', () => {
  const h = hole();
  SH.hit(h, { ...G(ll(0, 1)), club_id: 'drv' });
  SH.penalty(h, 'water');
  assert.equal(SH.stateOf(h), 'drop'); assert.equal(SH.lastShot(h).result, 'water');
  assert.equal(SH.ballPos(h, TEE), null, 'ball unknown until the drop');
  const d = SH.close(h, G(ll(-18, 222)));
  assert.equal(d.kind, 'drop'); assert.deepEqual(SH.ballPos(h, TEE), ll(-18, 222));
  assert.equal(SH.nextLie(h, FEATS), 'rough', 'lie from the drop spot');
  SH.hit(h, G(ll(-18, 222))); SH.close(h, G(ll(2, 352)));
  const dv = SH.holeOut(h, { putts: 2, par: 4, line: LINE, green: GREEN });
  assert.deepEqual([dv.strokes, dv.penalties, dv.fairway, dv.gir], [5, 1, 'LEFT', 0]);
  assert.equal(h.penalties, 1);
});

t('out of bounds / lost: stroke and distance – the next shot is played from where the last one was', () => {
  const h = hole();
  SH.hit(h, { ...G(ll(0, 1)), club_id: 'drv' });
  SH.penalty(h, 'ob');
  assert.equal(SH.stateOf(h), 'ready', 'no drop for out of bounds');
  assert.deepEqual(SH.ballPos(h, TEE), ll(0, 1));
  const s2 = SH.hit(h, { gps: null, acc: null, tee: TEE, feats: FEATS, club_id: 'drv' });
  assert.deepEqual(s2.start, ll(0, 1), 'replayed from the first start'); assert.equal(s2.lie, 'tee'); assert.equal(s2.approx, false);
  SH.close(h, G(ll(0, 240))); SH.hit(h, G(ll(0, 240))); SH.close(h, G(ll(0, 355)));
  const dv = SH.holeOut(h, { putts: 1, par: 4, line: LINE, green: GREEN });
  assert.deepEqual([dv.strokes, dv.penalties], [5, 1], 'tee, penalty, tee again, approach, putt');
});

t('unplayable after finding the ball: penalty on the closed shot, then the drop', () => {
  const h = hole();
  SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(30, 240)));
  SH.penalty(h, 'unplayable');
  assert.equal(SH.stateOf(h), 'drop');
  SH.close(h, G(ll(26, 240)));
  assert.deepEqual(SH.lastShot(h).end, ll(30, 240), 'the shot keeps where it finished');
  assert.deepEqual(SH.lastShot(h).drop, ll(26, 240));
});

t('forgotten "At my ball": a second "I\'ve hit" closes the first shot where the second starts', () => {
  const h = hole();
  SH.hit(h, G(ll(0, 1))); SH.hit(h, G(ll(-4, 228)));
  assert.equal(h.shots.length, 2);
  assert.deepEqual(h.shots[0].end, ll(-4, 228)); assert.equal(h.shots[0].result, 'fairway');
  assert.deepEqual(h.shots[1].start, ll(-4, 228)); assert.equal(h.shots[1].lie, 'fairway');
});

t('poor GPS: the tee stands in on the tee; a weak fix at the ball is marked approximate', () => {
  const h = hole();
  const s1 = SH.hit(h, { ...G(ll(9, 14), 40) });
  assert.deepEqual(s1.start, TEE); assert.equal(s1.approx, false, 'tee position is known');
  SH.close(h, { gps: ll(0, 230), acc: 25, feats: FEATS });
  assert.equal(s1.approx, true, 'end from a 25 m fix');
  const s2 = SH.hit(h, { gps: ll(0, 232), acc: 30, tee: TEE, feats: FEATS });
  assert.deepEqual(s2.start, ll(0, 230), 'the last end stands in for a weak fix'); assert.equal(s2.approx, false);
  const h2 = hole(), s = SH.hit(h2, { gps: null, acc: null, tee: null, feats: FEATS });
  assert.equal(s.start, null); assert.equal(s.approx, true, 'no GPS and no tee: approximate');
  assert.equal(SH.POOR_GPS_M, 15);
});

t('marked on the map: exact, not approximate, and flagged as marked', () => {
  const h = hole();
  SH.hit(h, G(ll(0, 1)));
  SH.close(h, { gps: null, acc: null, marked: ll(-10, 230), feats: FEATS });
  const s = h.shots[0]; assert.equal(s.marked, true); assert.equal(s.approx, false); assert.equal(s.result, 'fairway');
});

t('up and down: green missed, one chip from around the green, one putt; sand save from a bunker', () => {
  const h = hole();
  SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(0, 240)));
  SH.hit(h, G(ll(0, 240))); SH.close(h, G(ll(26, 352)));           // into the bunker right of the green
  assert.equal(h.shots[1].result, 'bunker');
  const chip = SH.hit(h, G(ll(26, 352)));
  assert.equal(chip.lie, 'bunker');
  SH.close(h, G(ll(3, 359)));
  const dv = SH.holeOut(h, { putts: 1, par: 4, line: LINE, green: GREEN });
  assert.deepEqual([dv.strokes, dv.gir, dv.up_down, dv.sand_save], [4, 0, 1, 1]);
  const h2 = structuredClone(h); const dv2 = SH.holeOut(h2, { putts: 2, par: 4, line: LINE, green: GREEN });
  assert.deepEqual([dv2.strokes, dv2.gir, dv2.up_down, dv2.sand_save], [5, 0, 0, 0]);
  const h3 = hole(); SH.hit(h3, G(ll(0, 1))); SH.close(h3, G(ll(0, 240))); SH.hit(h3, G(ll(0, 240))); SH.close(h3, G(ll(0, 340)));
  SH.hit(h3, G(ll(0, 340))); SH.close(h3, G(ll(0, 344))); SH.hit(h3, G(ll(0, 344))); SH.close(h3, G(ll(0, 358)));       // two chips from 20 m and 16 m
  const dv3 = SH.holeOut(h3, { putts: 1, par: 4, line: LINE, green: GREEN });
  assert.equal(dv3.up_down, 0, 'two chips: not up and down'); assert.equal(dv3.sand_save, null, 'not from sand');
  const h4 = hole(); SH.hit(h4, G(ll(0, 1))); SH.close(h4, G(ll(0, 240))); SH.hit(h4, G(ll(0, 240))); SH.close(h4, G(ll(0, 355)));
  assert.equal(SH.holeOut(h4, { putts: 2, par: 4, line: LINE, green: GREEN }).up_down, null, 'green hit: not applicable');
});

t('chip-in: holed from off the green with no putts', () => {
  const h = hole(3);
  SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(-14, 352)));
  assert.equal(SH.stateOf(h), 'ready');
  SH.hit(h, G(ll(-14, 352))); SH.close(h, G(ll(0, 360)));
  const dv = SH.holeOut(h, { putts: 0, par: 3, line: LINE, green: GREEN });
  assert.deepEqual([dv.strokes, dv.fairway, dv.gir, dv.up_down], [2, null, 0, 1]);
  assert.equal(SH.scoreName(2, 3), 'Birdie');
});

t('fairway side follows a dogleg', () => {
  const dog = [TEE, ll(0, 200), ll(150, 300)];                        // turns right at 200 m
  assert.equal(SH.sideOfLine(ll(-10, 150), dog), -1);
  assert.equal(SH.sideOfLine(ll(10, 150), dog), 1);
  assert.equal(SH.sideOfLine(ll(40, 250), dog), -1, 'inside the second leg, beyond the corner: left of the line');
  assert.equal(SH.sideOfLine(ll(80, 230), dog), 1);
  assert.equal(SH.sideOfLine(ll(0, 150), dog), 0);
  assert.equal(SH.sideOfLine(null, dog), null); assert.equal(SH.sideOfLine(TEE, [TEE]), null);
});

t('par 4 tee shot into the rough right: missed right; on the green: not counted either way', () => {
  const h = hole(); SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(25, 230)));
  assert.equal(SH.derive({ ...h, putts_tracked: 2 }, { par: 4, line: LINE, green: GREEN }).fairway, 'RIGHT');
  const h2 = hole(); SH.hit(h2, G(ll(0, 1))); SH.close(h2, G(ll(0, 358)));
  assert.equal(SH.derive({ ...h2, putts_tracked: 2 }, { par: 4, line: LINE, green: GREEN }).fairway, null);
});

t('corrections win over derived values, even when the hole is worked out again', () => {
  const h = hole(); SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(0, 240))); SH.hit(h, G(ll(0, 240))); SH.close(h, G(ll(0, 358)));
  SH.holeOut(h, { putts: 2, par: 4, line: LINE, green: GREEN });
  h.strokes = 5; SH.correct(h, 'strokes'); h.fairway = 'LEFT'; SH.correct(h, 'fairway');
  SH.applyDerived(h, SH.derive(h, { par: 4, line: LINE, green: GREEN }));
  assert.equal(h.strokes, 5); assert.equal(h.fairway, 'LEFT'); assert.equal(h.putts, 2);
  assert.equal(h.derived.fairway, 'HIT', 'the derived value is still kept alongside');
});

t('undo steps back one tap at a time', () => {
  const h = hole();
  SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(30, 240))); SH.penalty(h, 'unplayable'); SH.close(h, G(ll(26, 240)));
  SH.undo(h); assert.equal(SH.stateOf(h), 'drop', 'drop undone');
  SH.undo(h); assert.equal(SH.lastShot(h).penalty, null); assert.equal(SH.stateOf(h), 'ready');
  SH.undo(h); assert.equal(SH.stateOf(h), 'open', 'end undone: back to walking');
  SH.undo(h); assert.equal(h.shots.length, 0);
});

t('added and removed shots keep the open shot last and count for the score', () => {
  const h = hole();
  SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(0, 240))); SH.hit(h, G(ll(0, 240)));
  SH.addShot(h, { club_id: 'pw', result: 'rough' });
  assert.equal(h.shots.length, 3); assert.equal(h.shots[2].manual, undefined, 'the open shot is still last'); assert.ok(SH.openShot(h));
  assert.deepEqual(h.shots.map((s) => s.n), [1, 2, 3]);
  SH.close(h, G(ll(0, 358)));
  assert.equal(SH.holeOut(h, { putts: 2, par: 4, line: LINE, green: GREEN }).strokes, 5);
  SH.removeShot(h, 1); assert.deepEqual(h.shots.map((s) => s.n), [1, 2]);
  assert.equal(SH.derive(h, { par: 4, line: LINE, green: GREEN }).strokes, 4);
});

t('"Not on the green" stops the automatic putting panel until the next shot', () => {
  const h = hole(); SH.hit(h, G(ll(0, 1))); SH.close(h, G(ll(0, 358)));
  assert.equal(SH.stateOf(h), 'putting');
  h.putting = false; assert.equal(SH.stateOf(h), 'ready');
  assert.equal(SH.stateOf(h, { onGreen: true }), 'ready');
  SH.hit(h, G(ll(0, 358))); assert.equal(h.putting, undefined);
  const h2 = hole(); assert.equal(SH.stateOf(h2, { onGreen: true }), 'putting', 'standing on the green');
  h2.putting = true; assert.equal(SH.stateOf(h2), 'putting');
});

t('score names', () => {
  assert.deepEqual([[3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [2, 5], [1, 3], [2, 5]].map(([s, p]) => SH.scoreName(s, p)),
    ['Birdie', 'Par', 'Bogey', 'Double bogey', 'Triple bogey', '+4', 'Albatross', 'Hole in one', 'Albatross']);
  assert.equal(SH.scoreName(null, 4), '');
});

t('defaults are the plan\'s numbers and the dataset\'s "around the green"', () => {
  assert.equal(SH.STRIP_MS, 4000); assert.equal(SH.FIRST_PUTT_MAX_FT, 60); assert.equal(SH.FIRST_PUTT_STEP_FT, 3);
  assert.equal(SH.AROUND_GREEN_M, A.T.around_green_max_m);
});

console.log(`${n} tests passed`);
