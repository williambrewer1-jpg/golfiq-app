// Unit tests for the Course view geometry in holemap.js (course-view plan, phase 1). Run: node tests/holemap.test.mjs
import assert from 'node:assert/strict';
import * as HM from '../holemap.js';
import * as A from '../analytics.js';
import * as F from '../features.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

// an invented spot; positions are built in metres east / north of it
const O = [-30, 140], KY = 111320, KX = KY * Math.cos(O[0] * Math.PI / 180);
const ll = (e, nm) => [O[0] + nm / KY, O[1] + e / KX];
const circle = (e, nm, r, k = 32) => Array.from({ length: k }, (_, i) => ll(e + r * Math.sin(2 * Math.PI * i / k), nm + r * Math.cos(2 * Math.PI * i / k)));
const tee = ll(0, 0), pin = ll(0, 300), green = circle(0, 300, 14);

t('makeFrame without options is unchanged: content centred in the whole box', () => {
  const fr = HM.makeFrame(tee, pin, []);
  assert.equal(fr.w, HM.W); assert.equal(fr.h, HM.H);
  const [x0, y0] = fr.xy(...tee), [x1, y1] = fr.xy(...pin);
  near(x0, HM.W / 2, 0.5, 'tee x'); near(x1, HM.W / 2, 0.5, 'pin x');
  assert.ok(y0 > y1, 'up the hole is up the screen');
  near((y0 + y1) / 2, HM.H / 2 + (26 - 22) / 2 * fr.k, 1, 'centred vertically');
  assert.deepEqual(fr.view, { l: 0, t: 0, w: HM.W, h: HM.H });
});

t('makeFrame inset keeps the content inside the clear area (top bar and sheet)', () => {
  const fr = HM.makeFrame(tee, pin, [], 390, 844, { inset: { t: 130, b: 230 } });
  const [, y0] = fr.xy(...tee), [, y1] = fr.xy(...pin);
  assert.ok(y1 >= 130 && y0 <= 844 - 230, `${y1} .. ${y0}`);
  near((y0 + y1) / 2, 130 + (844 - 360) / 2 + 2 * fr.k, 2, 'centred in the clear area');
  assert.deepEqual(fr.view, { l: 0, t: 130, w: 390, h: 484 });
  const back = fr.fromXY(...fr.xy(...pin)); near(back[0], pin[0], 1e-9); near(back[1], pin[1], 1e-9);
});

t('makeFrame matrix matches xy (satellite tiles line up with the drawing)', () => {
  const fr = HM.makeFrame(tee, pin, [ll(30, 150)], 390, 844, { inset: { t: 120, b: 200 } });
  const p = ll(25, 120), [e, nn] = fr.toEN(...p), [a, b, c, d, ex, fy] = fr.matrix;
  const x = a * e + c * -nn + ex, y = b * e + d * -nn + fy, [X, Y] = fr.xy(...p);
  near(x, X, 1e-6); near(y, Y, 1e-6);
});

t('makeFrame exact fits only the given points; maxK caps the scale', () => {
  const pts = HM.zoomPoints('green', { pos: tee, green: pin, greenPts: green }).pts;
  const fr = HM.makeFrame(tee, pin, pts, 390, 844, { inset: { t: 130, b: 230 }, exact: true });
  const [, yt] = fr.xy(...tee);
  assert.ok(yt > 844, 'the tee is off screen in the Green zoom');
  const tight = HM.makeFrame(tee, pin, pts, 390, 844, { inset: { t: 130, b: 230 }, exact: true, pad: [4, 4, 4] });
  assert.ok(tight.k > fr.k * 1.4, 'the Green zoom\'s small margin brings it closer');
  const capped = HM.makeFrame(tee, pin, pts, 390, 844, { exact: true, maxK: 2 });
  assert.equal(capped.k, 2);
});

t('greenEdges: front and back where your line crosses the outline', () => {
  const e = HM.greenEdges(tee, pin, green);
  near(e.front_m, 286, 0.6, 'front'); near(e.back_m, 314, 0.6, 'back'); near(e.mid_m, 300, 0.5, 'middle');
  const off = ll(60, 0), e2 = HM.greenEdges(off, pin, green), d = A.haversine(off[0], off[1], pin[0], pin[1]);
  near(e2.front_m, d - 14, 0.8, 'front from an angle'); near(e2.back_m, d + 14, 0.8, 'back from an angle');
});

t('greenEdges: from on the green the front is 0', () => {
  const e = HM.greenEdges(ll(0, 292), pin, green);
  assert.equal(e.front_m, 0); near(e.back_m, 22, 0.6);
});

t('greenEdges: no crossing, no outline or no line gives null (caller falls back)', () => {
  assert.equal(HM.greenEdges(tee, ll(80, 300), green), null, 'pin outside the outline, line misses it');
  assert.equal(HM.greenEdges(tee, pin, null), null);
  assert.equal(HM.greenEdges(tee, pin, green.slice(0, 2)), null);
  assert.equal(HM.greenEdges(pin, pin, green), null);
});

t('greenEdges agrees with the outline extent for a round green seen straight on', () => {
  const e = HM.greenEdges(tee, pin, green), fb = F.greenFrontBack(tee[0], tee[1], pin, [{ kind: 'green', pts: green }]);
  near(e.front_m, fb.front_m, 0.6); near(e.back_m, fb.back_m, 0.6);
});

t('greenOutline finds the outline holding the green centre, or one within 30 m', () => {
  const feats = [{ kind: 'green', pts: green }, { kind: 'bunker', pts: circle(30, 300, 5) }];
  assert.equal(HM.greenOutline(pin, feats), green);
  assert.equal(HM.greenOutline(ll(0, 320), feats), green, '20 m away');
  assert.equal(HM.greenOutline(ll(0, 360), feats), null, '60 m away');
  assert.equal(HM.greenOutline(null, feats), null);
});

t('zoomPoints: Hole = tee to green; Shot = you to a little past the aim; Green = the green and surrounds', () => {
  const aim = ll(0, 200), line = [tee, ll(0, 150), pin];
  const h = HM.zoomPoints('hole', { pos: ll(0, 80), aim, green: pin, tee, line });
  assert.ok(h.exact && h.pts.some((p) => p === tee) && h.pts.some((p) => p === pin));
  const s = HM.zoomPoints('shot', { pos: tee, aim, green: pin, tee, line });
  const past = s.pts[2], dPast = A.haversine(tee[0], tee[1], past[0], past[1]);
  near(dPast, 200 * (1 + HM.ZOOM_PAST_AIM), 0.5, 'shot zoom reaches 20% past the aim');
  assert.ok(!s.pts.includes(pin), 'the green is not forced into the Shot zoom');
  const sNear = HM.zoomPoints('shot', { pos: tee, aim: ll(0, 40), green: pin });
  near(A.haversine(tee[0], tee[1], ...sNear.pts[2]), 40 + HM.ZOOM_PAST_MIN_M, 0.5, 'at least 25 m past a short aim');
  const g = HM.zoomPoints('green', { pos: tee, green: pin, greenPts: green });
  assert.ok(g.pts.length === green.length + 4 && !g.pts.includes(tee));
  const g0 = HM.zoomPoints('green', { pos: tee, green: pin, greenPts: null });
  assert.equal(g0.pts.length, 5, 'no outline: the green centre and padding');
});

t('inView2 checks the clear area, not the whole screen', () => {
  const fr = HM.makeFrame(tee, pin, [], 390, 844, { inset: { t: 130, b: 230 } });
  assert.ok(HM.inView2(fr, ll(0, 150)));
  assert.ok(!HM.inView2(fr, ll(0, -120)), 'behind you, under the sheet');
  assert.ok(!HM.inView2(fr, ll(0, 600)), 'beyond the green, under the top bar');
});

t('tag scales with the font size (28 px yardages in the Course view)', () => {
  const small = HM.tag(100, 100, '157'), big = HM.tag(100, 100, '157', 28);
  const w = (s) => Number(/width="([\d.]+)"/.exec(s)[1]), h = (s) => Number(/height="([\d.]+)"/.exec(s)[1]);
  assert.equal(w(small), 48); assert.equal(h(small), 26);                    // unchanged for the classic card
  assert.ok(w(big) > w(small) * 1.5 && h(big) >= 40);
  assert.ok(big.includes('font-size:28px') && !small.includes('font-size'));
});

t('Course view drawing: position and rings move to the dynamic layer', () => {
  const fr = HM.makeFrame(tee, pin, [], 390, 844, { inset: { t: 130, b: 230 } }), cv = (m) => m / 0.9144;
  const st = HM.staticSvg(fr, { feats: [{ kind: 'green', pts: green }], style: 'map', green: pin, pos: tee, unit: 'yd', cv, rings: 340, noPos: true });
  assert.ok(!st.includes('hm-me') && !st.includes('stroke-dasharray="3 5"'), 'no dot or rings in the static layer');
  const classic = HM.staticSvg(fr, { feats: [], style: 'map', green: pin, pos: tee, unit: 'yd', cv, rings: 340 });
  assert.ok(classic.includes('hm-me') && classic.includes('stroke-dasharray="3 5"'), 'classic card still draws them');
  const dyn = HM.dynamicSvg(fr, { pos: tee, aim: ll(0, 200), green: pin, pat: null, cv, unit: 'yd', big: true, live: { rings: 340, acc: 30 } });
  assert.ok(dyn.includes('hm-me'), 'dot in the moving layer');
  assert.ok((dyn.match(/stroke-dasharray="3 5"/g) || []).length >= 5, 'rings in the moving layer');
  assert.ok(dyn.includes('font-size:28px'), '28 px yardage tags');
  assert.ok(/r="24"/.test(dyn), 'larger thumb handle');
  assert.ok(dyn.includes('rgba(46,134,222,.12)'), 'poor accuracy shows as a pale ring');
  const good = HM.dynamicSvg(fr, { pos: tee, aim: ll(0, 200), green: pin, pat: null, cv, unit: 'yd', big: true, live: { rings: 0, acc: 4 } });
  assert.ok(!good.includes('rgba(46,134,222,.12)'), 'no accuracy ring when it is small');
});

t('ringsSvg: one ring every 50 yd, none past the top of the clear area', () => {
  const fr = HM.makeFrame(tee, pin, [], 390, 844, { inset: { t: 130, b: 230 } }), cv = (m) => m / 0.9144;
  const all = (HM.ringsSvg(fr, tee, 340, 'yd', cv).match(/<circle/g) || []).length;
  assert.equal(all, 7, '50..350 yd under 340 m');
  const clipped = (HM.ringsSvg(fr, tee, 340, 'yd', cv, 400).match(/<circle/g) || []).length;
  assert.ok(clipped < all);
});


// ------------------------------------------------------------------ phase 2: the shot pattern
const stats = (cx, cy, sx, sy, n = 40) => { const pts = []; for (let i = 0; i < n; i++) { const u = (i + 0.5) / n, v = (i * 0.618034) % 1, r = Math.sqrt(-2 * Math.log(1 - u * 0.999)); pts.push({ x: cx + sx * r * Math.cos(2 * Math.PI * v), y: cy + sy * r * Math.sin(2 * Math.PI * v) }); } return A.dispersionStats(pts); };
const P0 = ll(0, 0), AIM = ll(0, 150);
const ac = (p, br = 0) => A.alongCross(P0[0], P0[1], p[0], p[1], br);

t('corridor: zones, edges from the ball to the widest part, centre where the shots finish', () => {
  const st = stats(0, 150, 8, 6), c = HM.corridor(P0, AIM, st);
  assert.ok(c.inner.length > 40 && c.outer.length > 40, 'both zones with 40 shots');
  assert.deepEqual(c.left[0], P0); assert.deepEqual(c.right[0], P0);
  const [al, cr] = ac(c.left[1]), [ar, rr] = ac(c.right[1]);
  assert.ok(cr < 0 && rr > 0, 'left edge left, right edge right'); near(Math.abs(cr), Math.abs(rr), 1.5, 'symmetric for a centred pattern');
  for (const p of c.outer) { const [a, x] = ac(p); assert.ok(Math.atan2(x, a) >= Math.atan2(cr, al) - 1e-9 && Math.atan2(x, a) <= Math.atan2(rr, ar) + 1e-9, 'zone within the edges'); }
  const [ca, cc] = ac(c.centre); near(ca, st.mean_y_m, 0.3); near(cc, st.mean_lateral_m, 0.3);
  const few = HM.corridor(P0, AIM, stats(0, 150, 8, 6, 12));
  assert.ok(few.inner && few.outer === null, 'under 20 shots: the middle half only, edges to it');
  assert.ok(few.left && few.right);
  assert.equal(HM.corridor(P0, AIM, { n: 4, enough: false }), null);
});

t('corridor: slope / plays-like moves the zone (adj), no crosswind drift', () => {
  const st = stats(0, 150, 8, 6), up = HM.corridor(P0, AIM, st, (y) => y - 10);
  near(ac(up.centre)[0], st.mean_y_m - 10, 0.3, 'ten metres uphill: lands ten short');
  near(ac(up.centre)[1], st.mean_lateral_m, 0.3, 'sideways unchanged');
});

t('missOffset: right/left and long/short of the aim; shown past 4 yd; Allow only for a sideways miss of 2 yd+', () => {
  const m = HM.missOffset(stats(5.5, 146, 8, 6), 150);
  near(m.right_m, 5.5, 0.3); near(m.long_m, -4, 0.3); assert.ok(m.show && m.allow);
  const small = HM.missOffset(stats(1, 149, 8, 6), 150); assert.ok(!small.show, 'under 4 yd: nothing shown');
  const short = HM.missOffset(stats(0.5, 140, 8, 6), 150); assert.ok(short.show && !short.allow, 'a short miss is shown but cannot be aimed away');
  assert.equal(HM.missOffset(stats(5, 140, 8, 6)).long_m, null, 'no aim distance: no long/short');
  assert.equal(HM.missOffset({ enough: false }), null);
  const wrongClub = HM.missOffset(stats(1, 100, 8, 6), 150); assert.ok(wrongClub.long_m === null && !wrongClub.show, '50 m short is the wrong club, not a miss');
  near(HM.MISS_SHOW_M, 3.6576, 1e-6);
});

t('allowForMiss: turns the aim so the pattern centre lands on the original line, same distance', () => {
  const st = stats(6, 150, 8, 6), aim2 = HM.allowForMiss(P0, AIM, st);
  near(A.haversine(P0[0], P0[1], aim2[0], aim2[1]), A.haversine(P0[0], P0[1], AIM[0], AIM[1]), 0.01, 'aim distance unchanged');
  assert.ok(ac(aim2)[1] < -5, 'aim moved left for a right miss');
  const c2 = HM.corridor(P0, aim2, st).centre;
  near(ac(c2)[1], 0, 0.15, 'centre now on the old line');
  const left = HM.allowForMiss(P0, AIM, stats(-6, 150, 8, 6)); assert.ok(ac(left)[1] > 5, 'and right for a left miss');
  assert.equal(HM.ALLOW_ALONG, false);
});

t('rangeTicks: the 25th and 75th percentile distances on the line to the aim', () => {
  const tk = HM.rangeTicks(P0, AIM, 140, 160);
  near(ac(tk.p25)[0], 140, 0.05); near(ac(tk.p75)[0], 160, 0.05); near(ac(tk.p25)[1], 0, 0.05);
  const adj = HM.rangeTicks(P0, AIM, 140, 160, (y) => y * 0.9); near(ac(adj.p75)[0], 144, 0.05, 'plays-like applied');
  assert.equal(HM.rangeTicks(P0, AIM, null, 160), null);
});

const zone = circle(0, 150, 20, 48);
const area = (pts) => { const o = pts[0], kx = KY * Math.cos(o[0] * Math.PI / 180); let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += (p[1] - o[1]) * kx * (q[0] - o[0]) * KY - (q[1] - o[1]) * kx * (p[0] - o[0]) * KY; } return Math.abs(a / 2); };
t('clipZone: a bunker wholly inside the zone comes back whole', () => {
  const b = circle(5, 150, 4, 16), r = HM.clipZone(zone, [{ kind: 'bunker', pts: b }]);
  assert.equal(r.length, 1); assert.equal(r[0].kind, 'bunker'); near(r[0].area_m2, area(b), 0.5);
});
t('clipZone: only the overlapping part of a hazard, nothing for a far one or for fairway', () => {
  const water = [ll(10, 120), ll(60, 120), ll(60, 180), ll(10, 180), ll(10, 120)];             // covers x >= 10 of a 20 m circle
  const r = HM.clipZone(zone, [{ kind: 'water', pts: water }, { kind: 'bunker', pts: circle(200, 150, 5) }, { kind: 'fairway', pts: circle(0, 150, 30) }]);
  assert.equal(r.length, 1); assert.equal(r[0].kind, 'water');
  const seg = 20 * 20 * Math.acos(0.5) - 10 * Math.sqrt(20 * 20 - 100);                          // circular segment beyond x = 10
  near(r[0].area_m2, seg, seg * 0.04, 'segment area');
  for (const p of r[0].pts) assert.ok(F.pointInPolygon(p[0], p[1], zone) || A.haversine(p[0], p[1], ...ll(0, 150)) <= 20.01, 'inside the zone');
});
t('clipZone: concave hazards, single trees and tree rows', () => {
  const U = [ll(-30, 130), ll(30, 130), ll(30, 170), ll(18, 170), ll(18, 140), ll(-18, 140), ll(-18, 170), ll(-30, 170)];   // a U shape around the middle
  const r = HM.clipZone(zone, [{ kind: 'trees', pts: U }]);
  assert.ok(r.length >= 1 && r.every((x) => x.kind === 'trees'));
  const tree = HM.clipZone(zone, [{ kind: 'tree', pts: [ll(0, 150)] }]);
  assert.equal(tree.length, 1); near(tree[0].area_m2, 3 * F.TREE_RADIUS_M ** 2, 0.5, 'a 12-sided circle of the tree radius');
  const row = HM.clipZone(zone, [{ kind: 'treerow', pts: [ll(-40, 155), ll(40, 155)] }]);
  assert.ok(row.length >= 8 && row.every((x) => x.kind === 'trees'), 'circles along the row inside the zone');
  assert.deepEqual(HM.clipZone(zone, []), []); assert.deepEqual(HM.clipZone(null, [{ kind: 'bunker', pts: zone }]), []);
});

t('patternKind: own, estimated (spread from your other clubs), distance only, none', () => {
  assert.equal(HM.patternKind({ stats: { enough: true } }), 'own');
  assert.equal(HM.patternKind({ estimated: true, ratio_own: true, stats: { enough: true }, median_m: 180 }), 'estimated');
  assert.equal(HM.patternKind({ estimated: true, ratio_own: false, stats: { enough: true }, median_m: 180 }), 'distance', 'no own clubs to borrow a spread from');
  assert.equal(HM.patternKind({ stats: { enough: false }, median_m: 180 }), 'distance');
  assert.equal(HM.patternKind({ stats: { enough: false }, median_m: null }), 'none');
  assert.equal(HM.patternKind(null), 'none');
});

t('patternSvg: three clearly different styles; trouble hatched where it is; shots only on request', () => {
  const fr = HM.makeFrame(P0, AIM, [ll(0, 170)], 390, 844), st = stats(6, 150, 8, 6), cor = HM.corridor(P0, AIM, st);
  const haz = HM.clipZone(cor.outer, [{ kind: 'bunker', pts: circle(12, 150, 6) }]), ticks = HM.rangeTicks(P0, AIM, 142, 158);
  const own = HM.patternSvg(fr, P0, AIM, { v2: true, kind: 'own', ...cor, haz, ticks, dots: [{ p: ll(0, 150), bad: false }, { p: ll(12, 150), bad: true }] });
  assert.ok(own.includes('hm-zone50') && own.includes('hm-zone90') && (own.match(/hm-edge/g) || []).length === 2);
  assert.ok(!/hm-zone50[^>]*stroke-dasharray/.test(own), 'own: solid');
  assert.ok(own.includes('url(#hmZoneIn)') && own.includes('radialGradient'), 'fills fade at the edge');
  assert.ok(own.includes('class="hm-trouble" data-kind="bunker"') && own.includes('url(#hmHatch)'), 'trouble hatched, not just coloured');
  assert.equal((own.match(/hm-tick/g) || []).length, 2, 'two distance ticks');
  assert.ok(own.includes('hm-dot bad') && own.includes('class="hm-dot"'), 'a trouble shot is a cross, others dots');
  assert.ok(!/#ff6b57"\s*stroke-width="2.2"/.test(own) && !own.includes('rgba(232,74,58'), 'the whole shape is not tinted by the overall risk');
  const est = HM.patternSvg(fr, P0, AIM, { v2: true, kind: 'estimated', ...cor, haz: [], dots: [] });
  assert.ok(/hm-zone50[^>]*stroke-dasharray/.test(est) && /hm-edge[^>]*stroke-dasharray/.test(est), 'estimated: dashed');
  const dist = HM.patternSvg(fr, P0, AIM, { v2: true, kind: 'distance', arc: [ll(-5, 150), ll(0, 151), ll(5, 150)], ticks });
  assert.ok(dist.includes('hm-arc') && !dist.includes('hm-zone50') && !dist.includes('hm-edge'), 'distance only: the arc');
  const dyn = HM.dynamicSvg(fr, { pos: P0, aim: AIM, green: ll(0, 300), pat: { v2: true, kind: 'own', ...cor, haz: [], miss: HM.missOffset(st, 150), dots: [] }, cv: (m) => m, unit: 'm', big: true });
  assert.ok(dyn.includes('hm-miss'), 'usual-miss arrow from the aim');
  const dynE = HM.dynamicSvg(fr, { pos: P0, aim: AIM, green: ll(0, 300), pat: { v2: true, kind: 'estimated', ...cor, haz: [], miss: null, dots: [] }, cv: (m) => m, unit: 'm', big: true });
  assert.ok(!dynE.includes('hm-miss'), 'no miss arrow for an estimate');
  const classic = HM.dynamicSvg(fr, { pos: P0, aim: AIM, green: ll(0, 300), pat: { ell50: cor.inner, ell90: cor.outer, risk: 30, dots: [] }, cv: (m) => m, unit: 'm' });
  assert.ok(classic.includes('rgba(232,74,58') && !classic.includes('hm-zone50'), 'the classic card keeps its look');
});

console.log(`${n} tests passed`);
