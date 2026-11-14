// Unit tests for charts.js: scales, binning, rolling windows and the HTML each builder returns (valid, no NaN, sensible for empty and tiny data).
// Run: node tests/charts.test.mjs
import assert from 'node:assert/strict';
import * as C from '../charts.js';

let n = 0; const t = (name, f) => { C.resetCharts(); f(); n++; console.log('ok', name); };
const clean = (html, name = '') => { for (const bad of ['NaN', 'undefined', 'Infinity', 'null']) assert.ok(!html.includes(bad), `${name} contains ${bad}: ${html.slice(html.indexOf(bad) - 60, html.indexOf(bad) + 40)}`); };
const rounds = (vals, start = '2026-01-01') => vals.map((v, i) => ({ date: new Date(Date.parse(start) + i * 7 * 864e5).toISOString().slice(0, 10), label: `round ${i + 1}`, v }));

t('niceScale gives round ticks that cover the data', () => {
  const s = C.niceScale(25, 38, 3); assert.ok(s.lo <= 25 && s.hi >= 38); assert.deepEqual(s.ticks.map((x) => x % s.step), s.ticks.map(() => 0));
  assert.ok(s.ticks.length >= 3 && s.ticks.length <= 8, String(s.ticks));
  assert.deepEqual(C.niceScale(0, 100, 3).ticks, [0, 50, 100]);
});
t('niceScale copes with equal, reversed and bad values', () => {
  const e = C.niceScale(5, 5); assert.ok(e.hi > e.lo); const r = C.niceScale(10, 2); assert.ok(r.lo <= 2 && r.hi >= 10);
  const b = C.niceScale(NaN, 3); assert.ok(b.hi > b.lo); const z = C.niceScale(0, 0); assert.ok(z.hi > z.lo);
  const sm = C.niceScale(0.1, 0.4); assert.ok(sm.step < 0.2 && sm.hi >= 0.4);
});
t('bin counts every value once', () => {
  const v = [24, 25, 27, 30, 30, 31, 35]; const b = C.bin(v, 2); assert.equal(b.reduce((s, x) => s + x.count, 0), v.length);
  assert.equal(b[0].lo, 24); assert.equal(b.at(-1).hi, 36); assert.equal(b.find((x) => x.lo === 30).count, 3);
  assert.deepEqual(C.bin([], 2), []); assert.equal(C.bin([3], 2).length, 1); assert.deepEqual(C.bin([1, 2], 0), []);
  assert.equal(C.bin([-3, -1, 0, 1], 2).reduce((s, x) => s + x.count, 0), 4);
});
t('rolling needs a full window', () => {
  assert.deepEqual(C.rolling([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]); assert.deepEqual(C.rolling([1], 5), [null]);
});
t('trendWins only offers windows the data can fill', () => {
  assert.deepEqual(C.trendWins(3), []); assert.deepEqual(C.trendWins(5), [5]); assert.deepEqual(C.trendWins(12), [5, 10]); assert.deepEqual(C.trendWins(60), [5, 10, 20]);
});
t('shortDate', () => { assert.equal(C.shortDate('2026-11-04'), '4 Nov'); assert.equal(C.shortDate('2026-11-04', true), '4 Nov 26'); assert.equal(C.shortDate(''), ''); });

t('trend: headline, arrow and aria for a higher-is-better metric', () => {
  const v = [28, 30, 29, 31, 30, 33, 34, 33, 35, 34], h = C.trend({ rounds: rounds(v).map((r) => ({ ...r, sf: r.v })), metric: 'sf', label: 'Stableford', unit: 'pts', hib: true, ref: 36, win: 5 });
  clean(h, 'trend'); assert.ok(h.includes('<svg') && h.includes('class="ch-big">33.8<'), h.slice(0, 400)); assert.ok(h.includes('class="good">▲ 4.2'), 'arrow'); assert.ok(h.includes('vs previous 5'));
  assert.ok(/aria-label="Stableford 5-round average 33.8 pts, up 4.2 on the previous 5/.test(h)); assert.ok(h.includes('class="ref"'), 'reference line');
});
t('trend: lower is better colours a drop green', () => {
  const v = [40, 39, 41, 40, 39, 36, 35, 36, 35, 34], h = C.trend({ rounds: rounds(v).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'Putts', hib: false, win: 5 });
  assert.ok(h.includes('class="good">▼'), h.match(/ch-sub">[^]*?<\/div>/)?.[0]);
  const w = C.trend({ rounds: rounds(v.slice().reverse()).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'Putts', hib: false, win: 5 }); assert.ok(w.includes('class="bad">▲'));
});
t('trend: a flat run says no change', () => {
  const h = C.trend({ rounds: rounds(Array(10).fill(30)).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'X', win: 5 }); clean(h); assert.ok(h.includes('no change vs previous 5'));
});
t('trend: fewer rounds than the window shows dots and the plain average', () => {
  const h = C.trend({ rounds: rounds([30, 32, 34]).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'Pts', win: 5 }); clean(h);
  assert.ok(h.includes('class="ch-big">32.0<') && h.includes('3 rounds so far') && h.includes('· average') && !h.includes('class="ln"'));
});
t('trend: one round, empty data, and gaps', () => {
  const one = C.trend({ rounds: rounds([31]).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'Pts', win: 5 }); clean(one, 'one'); assert.ok(one.includes('1 round so far'));
  assert.ok(C.trend({ rounds: [], metric: 'g', label: 'x' }).includes('No data'));
  const gaps = C.trend({ rounds: rounds([30, null, 32, undefined, 34, 33, 31, 30]).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'x', win: 5 }); clean(gaps, 'gaps'); assert.ok(gaps.includes('6 rounds') || gaps.includes('class="ch-big"'));
});
t('trend: equal values and a percentage metric', () => {
  clean(C.trend({ rounds: rounds(Array(8).fill(50)).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'GIR', unit: '%', win: 5 }), 'equal');
  const p = C.trend({ rounds: rounds([40, 45, 50, 55, 60, 62]).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'GIR', unit: '%', win: 5 }); assert.ok(p.includes('class="ch-big">54<'), p.match(/ch-big">[^<]*/)?.[0]);
});
t('trend: the date labels show the year only when the span crosses one', () => {
  const same = C.trend({ rounds: rounds([1, 2, 3, 4, 5, 6], '2026-01-05').map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'x', win: 5 }); assert.ok(same.includes('>5 Jan<'));
  const cross = C.trend({ rounds: rounds([1, 2, 3, 4, 5, 6], '2025-12-20').map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'x', win: 5 }); assert.ok(cross.includes('>20 Dec 25<'));
});
t('trend: user text is escaped in the aria label', () => { const h = C.trend({ rounds: rounds([1, 2]).map((r) => ({ ...r, g: r.v })), metric: 'g', label: 'A "quoted" <b>', win: 5 }); assert.ok(!h.includes('<b>') && h.includes('&lt;b&gt;')); });

t('bars: values, labels and zero baseline', () => {
  const h = C.bars({ items: [{ label: 'a', value: 3 }, { label: 'b', value: 0 }, { label: 'c', value: 5, hot: true }], digits: 0 }); clean(h, 'bars');
  assert.ok(h.includes('class="ch-bar hot"') && h.includes('class="base"') && (h.match(/class="val"/g) || []).length === 3 && h.includes('Tap a bar'));
});
t('bars: negatives sit below the baseline and nothing is NaN', () => {
  const h = C.bars({ items: [{ label: 'a', value: -2 }, { label: 'b', value: 3 }], digits: 1 }); clean(h, 'neg'); assert.ok(h.includes('-2.0'));
});
t('bars: many bars drop the value labels and keep first and last labels', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ label: `d${i}`, value: i % 5 })); const h = C.bars({ items }); clean(h, 'many');
  assert.ok(!h.includes('class="val"') && h.includes('>d0<') && h.includes('>d29<') && !h.includes('>d15<'));
});
t('bars: empty, one bar, all zero', () => {
  assert.equal(C.bars({ items: [] }), ''); assert.equal(C.bars({ items: [{ label: 'a', value: NaN }] }), '');
  clean(C.bars({ items: [{ label: 'a', value: 4 }] }), 'one'); clean(C.bars({ items: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }), 'zero');
});
t('line: handles dates, a reference and a single series with one point', () => {
  const pts = [0, 1, 2, 3].map((i) => ({ x: Date.UTC(2026, 0, 1 + i * 10), y: 50 + i * 5 }));
  const h = C.line({ series: [{ kind: 'line', tone: 'accent', pts, scrub: true }], xKind: 'date', yRange: [0, 100], unit: '%', aria: 'Scrambling' }); clean(h, 'line'); assert.ok(h.includes('>1 Jan<') && h.includes('role="img"'));
  clean(C.line({ series: [{ kind: 'line', pts: [{ x: 1, y: 2 }] }] }), 'one point'); assert.equal(C.line({ series: [{ kind: 'line', pts: [] }] }), '');
});
t('every chart gets its own id', () => {
  const a = C.bars({ items: [{ label: 'a', value: 1 }] }), b = C.bars({ items: [{ label: 'a', value: 1 }] }); const id = (h) => /id="(ch\d+)"/.exec(h)[1]; assert.notEqual(id(a), id(b));
});

t('strip: parts, key and tap captions', () => {
  const h = C.strip({ parts: [{ label: 'Par', value: 7.2, tone: C.SCORE_TONES.Par }, { label: 'Bogey', value: 6, tone: 'warn' }, { label: 'Eagle+', value: 0 }], digits: 1 }); clean(h, 'strip');
  assert.equal((h.match(/class="ch-seg"/g) || []).length, 2); assert.ok(h.includes('Par <b>7.2</b>') && !h.includes('Eagle+')); assert.equal(C.strip({ parts: [{ label: 'x', value: 0 }] }), '');
});
t('tiles: values, units, missing values', () => {
  const h = C.tiles([{ label: 'Par 3', value: 41.6, unit: '%', sub: '36 holes' }, { label: 'Par 4', value: null }]); clean(h, 'tiles'); assert.ok(h.includes('42%') && h.includes('36 holes') && h.includes('–')); assert.equal(C.tiles([]), '');
});
t('holeTone: averages and single holes colour the same way', () => {
  assert.deepEqual([-1, 0, 1, 2, 3, 4].map(C.holeTone), ['a', 'p', 'b', 'd', 't', 't']); assert.deepEqual([0.3, 0.8, 1.6, 2.6].map(C.holeTone), ['p', 'b', 'd', 't']); assert.equal(C.holeTone(null), 'n');
});
t('holeGrid: nines, signs, tone classes and a compare row', () => {
  const cells = (vs) => vs.map((v, i) => ({ hole: i + 1, value: v, detail: `hole ${i + 1}` }));
  const h = C.holeGrid({ groups: [{ title: 'Front 9', rows: [{ cells: cells([-1, 0, 1, 2, 3, 0.4, null, 1, 0]) }] }, { title: 'Back 9', rows: [{ cells: [] }] }], digits: 1 }); clean(h, 'grid');
  assert.equal((h.match(/class="ch-hole /g) || []).length, 9); assert.ok(h.includes('ch-hole ha') && h.includes('ch-hole hp') && h.includes('ch-hole hb') && h.includes('ch-hole hd') && h.includes('ch-hole ht') && h.includes('ch-hole hn'));
  assert.ok(h.includes('−1.0') && h.includes('+1.0') && !h.includes('Back 9'), 'minus sign, empty nine dropped');
  const cmp = C.holeGrid({ groups: [{ title: 'Front 9', rows: [{ name: 'A', cells: cells([1, 2]) }, { name: 'B', cells: cells([0, 2]) }, { name: 'B − A', kind: 'diff', cells: cells([-1, 0]) }] }], digits: 0 }); clean(cmp, 'cmp');
  assert.ok(cmp.includes('holes named') && cmp.includes('dfg') && cmp.includes('df0')); assert.equal(C.holeGrid({ groups: [] }), '');
});
t('hbars: plain and diverging', () => {
  const h = C.hbars({ items: [{ label: '100-125', value: 62, sub: 'n=40' }, { label: '125-150', value: 48 }], unit: '%', max: 100 }); clean(h, 'hbars'); assert.ok(h.includes('width:62%') && h.includes('n=40'));
  const d = C.hbars({ items: [{ label: 'Putting', value: -1.4 }, { label: 'Approach', value: 0.7 }], diverging: true, digits: 1 }); clean(d, 'div'); assert.ok(d.includes('right:50%') && d.includes('left:50%') && d.includes('−1.4') && d.includes('+0.7') && d.includes('<u>'));
  assert.equal(C.hbars({ items: [] }), ''); clean(C.hbars({ items: [{ label: 'a', value: 0 }] }), 'zero');
});
t('fairway and green: percentages in the right places, tolerant of gaps', () => {
  const f = C.fairway({ hit: 48.4, left: 30.9, right: 20.7, holes: 120 }); clean(f, 'fairway'); assert.ok(f.includes('>48%<') && f.includes('>31%<')); assert.equal(C.fairway({ hit: null, left: null, right: null }), '');
  clean(C.fairway({ hit: 50, left: null, right: 50 }), 'fairway gap');
  const g = C.green({ dirs: [{ direction: 'Short', pct: 40, count: 8 }, { direction: 'Long', pct: 20, count: 4 }, { direction: 'Left', pct: 25, count: 5 }, { direction: 'Right', pct: 15, count: 3 }] }); clean(g, 'green');
  assert.ok(g.includes('>40%<') && g.includes('var(--bad)')); assert.equal(C.green({ dirs: [] }), ''); clean(C.green({ dirs: [{ direction: 'Short', pct: 0, count: 0 }] }), 'green zero');
});
console.log(`\n${n} tests passed`);
