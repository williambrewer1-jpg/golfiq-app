// Unit tests for locker.js: every unlock rule, the fallback to defaults, fresh unlocks, and the contrast of every app-colour skin in light and dark.
import assert from 'node:assert/strict';
import * as L from '../locker.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ', name); };
const has = (lk, id) => lk.unlocked.has(id);

t('the catalogue has every item in the plan, with unique ids', () => {
  assert.equal(L.CATALOGUE.length, 19);
  assert.equal(new Set(L.CATALOGUE.map(L.itemKey)).size, 19);
  assert.deepEqual(L.KINDS.map((k) => L.CATALOGUE.filter((i) => i.kind === k[0]).length), [7, 5, 4, 3]);
});
t('a new golfer has only the free items, and each kind has a free default', () => {
  const lk = L.locker({});
  assert.deepEqual([...lk.unlocked].sort(), ['badge:roundel', 'confetti:classic', 'skin:clubhouse', 'wallpaper:cream', 'wallpaper:green', 'wallpaper:night']);
  for (const [k, d] of Object.entries(L.DEFAULTS)) assert.ok(has(lk, `${k}:${d}`), k);
});
t('rank items unlock at the right rank', () => {
  for (const [id, r] of [['wallpaper:dawn', 3], ['skin:claret', 4], ['confetti:flags', 5], ['skin:navy', 6], ['skin:midnight', 8]]) {
    assert.ok(!has(L.locker({ level: { rank: { n: r - 1 }, points: 0 } }), id), `${id} locked below ${r}`);
    assert.ok(has(L.locker({ level: { rank: { n: r }, points: 0 } }), id), `${id} unlocked at ${r}`);
  }
});
t('the 8-week streak unlocks Heritage tweed (best streak counts)', () => {
  assert.ok(!has(L.locker({ streaks: { best: 7 } }), 'wallpaper:tweed')); assert.ok(has(L.locker({ streaks: { best: 8 } }), 'wallpaper:tweed'));
});
t('boss items: any boss, the 5, and the 10 are separate', () => {
  const lk = (b) => L.locker({ bosses: b });
  assert.ok(!has(lk([{ n: 10, passed: false }]), 'wallpaper:sunday'));
  const a = lk([{ n: 15, passed: true }]); assert.ok(has(a, 'wallpaper:sunday') && !has(a, 'wallpaper:gold') && !has(a, 'badge:laurel'));
  assert.ok(has(lk([{ n: 5, passed: true }]), 'wallpaper:gold')); assert.ok(has(lk([{ n: 10, passed: true }]), 'badge:laurel'));
});
t('duels unlock Links sand at 10 and show progress before', () => {
  const a = L.locker({ duels: 4 }), it = a.items.find((i) => i.id === 'skin:sand');
  assert.ok(!it.unlocked); assert.deepEqual(it.progress, { have: 4, need: 10 }); assert.ok(has(L.locker({ duels: 10 }), 'skin:sand'));
});
t('tier badges: Gold unlocks Shield, Platinum unlocks Pennant', () => {
  const a = L.locker({ tiers: ['tier-putt-369-bronze', 'tier-putt-369-silver'] }); assert.ok(!has(a, 'badge:shield'));
  const g = L.locker({ tiers: ['tier-putt-369-gold'] }); assert.ok(has(g, 'badge:shield') && !has(g, 'badge:pennant'));
  assert.ok(has(L.locker({ tiers: ['tier-chip-updown-platinum'] }), 'badge:pennant'));
});
t('five beaten predictions unlock Gold-only confetti', () => {
  assert.ok(!has(L.locker({ predictions: 4 }), 'confetti:gold')); assert.ok(has(L.locker({ predictions: 5 }), 'confetti:gold'));
});
t('locked items say how to earn them in plain words, and rank progress uses points', () => {
  const lk = L.locker({ level: { rank: { n: 1 }, points: 200 } }), c = lk.items.find((i) => i.id === 'skin:claret');
  assert.equal(c.how, 'Reach rank 4, Club player'); assert.deepEqual(c.progress, { have: 200, need: 800 });
  for (const i of lk.items) assert.ok(i.how && i.how.length > 3, i.id);
});
t('a choice that is not unlocked falls back to the default; unlocked choices are kept', () => {
  const lk = L.locker({ level: { rank: { n: 4 }, points: 900 } });
  assert.deepEqual(L.resolveLook({ skin: 'navy', badge: 'laurel', confetti: 'classic', wallpaper: 'dawn' }, lk), { skin: 'clubhouse', badge: 'roundel', confetti: 'classic', wallpaper: 'dawn' });
  assert.deepEqual(L.resolveLook(undefined, lk), L.DEFAULTS);
  assert.equal(L.resolveLook({ skin: 'claret' }, lk).skin, 'claret');
});
t('fresh(): nothing the first time, then only new unlocks that are not free', () => {
  const a = L.locker({ level: { rank: { n: 4 }, points: 900 } });
  assert.deepEqual(L.fresh(a, undefined), []);
  const seen = [...a.unlocked];
  const b = L.locker({ level: { rank: { n: 6 }, points: 2300 } });
  assert.deepEqual(L.fresh(b, seen).map((i) => i.id).sort(), ['confetti:flags', 'skin:navy']);
  assert.deepEqual(L.fresh(b, [...b.unlocked]), []);
});
t('every skin keeps 4.5:1 text contrast in light and dark', () => {
  for (const [name, s] of Object.entries(L.SKINS)) for (const mode of ['light', 'dark']) for (const [f, b] of L.SKIN_PAIRS) {
    const r = L.contrast(s[mode][f], s[mode][b]); assert.ok(r >= 4.5, `${name} ${mode} ${f} on ${b} is ${r.toFixed(2)}`);
  }
});
t('header text stays readable and good / bad stay distinguishable in every skin', () => {
  for (const [name, s] of Object.entries(L.SKINS)) for (const mode of ['light', 'dark']) {
    assert.ok(L.contrast('#ffffff', s[mode].head) >= 4.5 && L.contrast('#ffffff', s[mode].head2) >= 4.5, `${name} ${mode} header`);
    const gap = Math.abs(L.hue(s[mode].good) - L.hue(s[mode].bad)); assert.ok(Math.min(gap, 360 - gap) >= 60, `${name} ${mode} good/bad hue gap`);
    for (const k of Object.keys(L.SKIN_VARS)) assert.match(s[mode][k], /^#[0-9a-f]{6}$/i, `${name} ${mode} ${k}`);
  }
});
t('each skin has CSS for light, system dark and app dark', () => {
  const css = L.skinCss();
  for (const k of Object.keys(L.SKINS)) { assert.ok(css.includes(`:root[data-skin="${k}"]{`)); assert.ok(css.includes(`:root:not([data-theme="light"])[data-skin="${k}"]{`)); assert.ok(css.includes(`:root[data-theme="dark"][data-skin="${k}"]{`)); }
  assert.ok(!css.includes('undefined'));
});
t('the contrast helper matches known values', () => {
  assert.ok(Math.abs(L.contrast('#000000', '#ffffff') - 21) < 0.01); assert.ok(Math.abs(L.contrast('#777777', '#ffffff') - 4.48) < 0.05);
});
console.log(`\n${n} tests passed`);
