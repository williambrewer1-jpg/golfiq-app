// Unit tests for feel.js: the event table, the sound engine (against a fake AudioContext), motion helpers, settings and wording.
// Run: node tests/feel.test.mjs
import assert from 'node:assert/strict';
import * as F from '../feel.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

// ---- a fake Web Audio API that records what would have been played
const made = { ctx: 0, osc: [], noise: [], gains: [], filters: [], disconnects: 0, resumed: 0, primed: 0 };
const param = () => ({ calls: [], setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; }, linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); }, exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); }, value: 0 });
class FakeCtx {
  constructor() { made.ctx++; this.state = 'suspended'; this.currentTime = 10; this.sampleRate = 44100; this.destination = { node: 'dest' }; }
  resume() { made.resumed++; this.state = 'running'; return Promise.resolve(); }
  createGain() { const g = { gain: param(), connect() {}, disconnect() { made.disconnects++; } }; made.gains.push(g); return g; }
  createOscillator() { const o = { type: 'sine', frequency: param(), connect() {}, start(x) { this.started = x; }, stop(x) { this.stopped = x; } }; made.osc.push(o); return o; }
  createBufferSource() { const s = { connect() {}, start(x) { this.started = x; made.primed += this.buffer && this.buffer.silent ? 1 : 0; }, stop(x) { this.stopped = x; } }; made.noise.push(s); return s; }
  createBuffer(ch, len) { return { silent: len === 1, getChannelData: () => new Float32Array(len) }; }
  createBiquadFilter() { const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; made.filters.push(f); return f; }
}
const reset = () => { made.osc.length = 0; made.noise.length = 0; made.gains.length = 0; made.filters.length = 0; made.disconnects = 0; };
const tones = (name) => F.EVENTS[name].filter((v) => !v.noise), noises = (name) => F.EVENTS[name].filter((v) => v.noise);

t('every event in the plan has a definition', () => {
  assert.deepEqual([...F.EVENT_NAMES].sort(), ['finish', 'good', 'miss', 'pb', 'step', 'streak', 'tap', 'target', 'tier', 'unlock', 'win']);
  for (const name of F.EVENT_NAMES) assert.ok(F.EVENTS[name].length > 0, name);
});
t('every voice is well formed', () => {
  for (const [name, voices] of Object.entries(F.EVENTS)) for (const v of voices) {
    assert.ok(v.t >= 0 && v.d > 0 && v.d < 1.5, `${name} timing`); assert.ok(Number.isFinite(v.f) && v.f > 20 && v.f < 12000, `${name} frequency ${v.f}`);
    assert.ok(v.g > 0 && v.g <= 1, `${name} gain`); if (!v.noise) { assert.ok(['sine', 'triangle'].includes(v.wave), `${name} wave ${v.wave}`); if (v.to) assert.ok(v.to > 20 && v.to < 12000); }
  }
});
t('everything is under 400 ms except the finishes; the fanfare is about 0.9 s', () => {
  for (const name of F.EVENT_NAMES) { const ms = F.lengthOf(name) * 1000; if (F.LONG_EVENTS.includes(name)) assert.ok(ms >= 400 && ms <= 1500, `${name} ${ms}`); else assert.ok(ms < F.MAX_SHORT_MS, `${name} ${ms}`); }
  near(F.lengthOf('win'), 0.9, 0.05); assert.deepEqual([...F.LONG_EVENTS].sort(), ['finish', 'pb', 'tier', 'win']);
});
t('sounds are soft: no voice above the 0.15 peak, and overlapping voices stay well under full scale', () => {
  assert.equal(F.PEAK, 0.15);
  for (const [name, voices] of Object.entries(F.EVENTS)) {
    for (const v of voices) assert.ok(v.g * F.PEAK <= 0.15 + 1e-9, name);
    for (const a of voices) { const sum = voices.filter((b) => b.t <= a.t && a.t < b.t + b.d).reduce((s, b) => s + b.g * F.PEAK, 0); assert.ok(sum <= 0.3, `${name} overlap ${sum}`); }
  }
});
t('shapes match the plan: cup knock then a major third; one lower note; four-note fanfare', () => {
  const good = F.EVENTS.good, notes = good.filter((v) => !v.noise && v.f > 400).sort((a, b) => a.t - b.t);
  assert.equal(notes.length, 2); near(notes[1].f / notes[0].f, 2 ** (4 / 12), 1e-3, 'major third'); near(notes[0].f, 523.25, 0.1, 'C5, not an octave off'); assert.ok(good.some((v) => v.noise && v.f < 500), 'a low filtered-noise knock');
  const miss = F.EVENTS.miss; assert.equal(miss.length, 1); assert.ok(miss[0].f < 300, 'lower note');
  const fan = tones('win').filter((v) => v.wave === 'triangle').sort((a, b) => a.t - b.t); assert.equal(fan.length, 4, 'four fanfare notes'); assert.deepEqual(fan.map((v) => Math.round(v.f)), [523, 659, 784, 1047], 'C E G C, rising'); near(F.EVENTS.miss[0].f, 196, 0.5, 'G3'); assert.equal(F.EVENTS.streak.length, 3, 'three-note run'); assert.equal(F.EVENTS.target.length, 2, 'two-note chime');
  assert.ok(noises('tap').length === 1 && F.lengthOf('tap') < 0.06, 'click');
});
t('personal best is the fanfare one step higher; a tier is the fanfare plus a high shimmer', () => {
  const w = tones('win'), p = tones('pb'); assert.equal(w.length, p.length);
  w.forEach((v, i) => { near(p[i].f / v.f, 2 ** (2 / 12), 1e-9); near(p[i].t, v.t); near(p[i].d, v.d); });
  const tier = F.EVENTS.tier; assert.deepEqual(tier.slice(0, F.EVENTS.win.length), F.EVENTS.win); assert.ok(tier.slice(F.EVENTS.win.length).every((v) => v.f > 2000), 'shimmer is high');
});
t('streak milestones 3, 5 and 10 lift the run one step each', () => {
  assert.deepEqual([2, 3, 4, 5, 9, 10, 25].map(F.streakLevel), [0, 0, 0, 1, 1, 2, 2]); assert.equal(F.SEMITONES_PER_LEVEL, 2);
});

t('settings: on by default, partial values merge, junk is ignored', () => {
  assert.deepEqual(F.read(undefined), { sound: true, motion: true }); assert.deepEqual(F.read({}), { sound: true, motion: true });
  assert.deepEqual(F.read({ feel: { sound: false } }), { sound: false, motion: true }); assert.deepEqual(F.read({ feel: { motion: false, extra: 1 } }), { sound: true, motion: false });
  assert.deepEqual(F.read({ feel: { sound: 'no', motion: 0 } }), { sound: true, motion: true }, 'non-booleans are ignored'); assert.deepEqual(F.read({ feel: null }), { sound: true, motion: true });
  assert.deepEqual(F.init({ feel: { sound: false, motion: false } }), { sound: false, motion: false }); assert.deepEqual(F.get(), { sound: false, motion: false });
  F.init({}); assert.deepEqual(F.get(), { sound: true, motion: true }); F.get().sound = false; assert.equal(F.get().sound, true, 'get returns a copy');
});
t('play is a no-op with no audio context, and unlock fails quietly without Web Audio', () => {
  F.init({}); delete globalThis.AudioContext; delete globalThis.webkitAudioContext;
  assert.equal(F.ready(), false); assert.equal(F.play('good'), false); assert.equal(F.unlock(), false); assert.equal(F.play('good'), false);
});
t('unlock creates one context, wakes it, primes iOS with a silent buffer, and is safe to repeat', () => {
  globalThis.AudioContext = FakeCtx; reset(); made.ctx = 0; made.resumed = 0;
  assert.equal(F.unlock(), true); assert.equal(made.ctx, 1); assert.ok(made.resumed >= 1); assert.equal(made.primed, 1); assert.equal(F.ready(), true);
  assert.equal(F.unlock(), true); assert.equal(made.ctx, 1, 'one context only'); assert.equal(made.primed, 1, 'primed once');
});
t('play is a no-op when sound is off, for an unknown event, and never throws', () => {
  F.init({ feel: { sound: false } }); reset();
  assert.equal(F.play('good'), false); assert.equal(made.osc.length + made.noise.length, 0, 'nothing scheduled');
  F.init({}); assert.equal(F.play('nope'), false); assert.equal(F.play(undefined), false); assert.equal(made.osc.length + made.noise.length, 0);
});
t('every event schedules its voices with soft, click-free envelopes', () => {
  F.init({});
  for (const name of F.EVENT_NAMES) {
    reset(); assert.equal(F.play(name), true, name);
    assert.equal(made.osc.length, tones(name).length, `${name} oscillators`); assert.equal(made.noise.length, noises(name).length, `${name} noise bursts`); assert.equal(made.gains.length, F.EVENTS[name].length);
    for (const g of made.gains) { const peak = Math.max(...g.gain.calls.filter((c) => c[0] === 'lin').map((c) => c[1])); assert.ok(peak <= 0.15 + 1e-9 && peak > 0, `${name} peak ${peak}`); assert.ok(g.gain.calls[0][1] < 0.001, 'starts silent'); assert.equal(g.gain.calls.at(-1)[0], 'exp', 'decays to silence'); }
    for (const o of made.osc) { assert.ok(o.stopped > o.started, 'stops after it starts'); assert.ok(o.started >= 10, 'starts from the context clock'); }
  }
});
t('a streak run is lifted by the level; a glide ends where it should', () => {
  F.init({}); reset(); F.play('streak', { level: 0 }); const base = made.osc.map((o) => o.frequency.calls[0][1]);
  reset(); F.play('streak', { level: 2 }); const high = made.osc.map((o) => o.frequency.calls[0][1]);
  high.forEach((f, i) => near(f / base[i], 2 ** (4 / 12), 1e-9)); reset(); F.play('streak', { level: 9 }); near(made.osc[0].frequency.calls[0][1] / base[0], 2 ** (4 / 12), 1e-9, 'level is capped');
  reset(); F.play('miss'); assert.equal(made.osc[0].frequency.calls.at(-1)[0], 'exp', 'miss glides down'); assert.ok(made.osc[0].frequency.calls.at(-1)[1] < made.osc[0].frequency.calls[0][1]);
  reset(); F.play('unlock'); assert.ok(made.osc[0].frequency.calls.at(-1)[1] > made.osc[0].frequency.calls[0][1] * 3, 'sweep goes up');
});
t('turning sound off silences anything still playing; a context that throws never breaks play', () => {
  F.init({}); reset(); F.play('win'); const before = made.disconnects; F.init({ feel: { sound: false } }); assert.equal(made.disconnects, before + 1, 'master is cut');
  F.init({}); const c = globalThis.AudioContext; globalThis.AudioContext = class { constructor() { throw new Error('no audio'); } };
  assert.doesNotThrow(() => F.play('good')); globalThis.AudioContext = c;
});
t('test flag: requested events are logged, and only the ones actually scheduled are logged as heard', () => {
  globalThis.__feelTest = true; delete globalThis.__feelLog; delete globalThis.__feelHeard; F.init({});
  F.play('tap'); F.play('good'); F.init({ feel: { sound: false } }); F.play('miss'); F.init({}); F.play('win');
  assert.deepEqual(globalThis.__feelLog, ['tap', 'good', 'miss', 'win']); assert.deepEqual(globalThis.__feelHeard, ['tap', 'good', 'win']);
  delete globalThis.__feelTest; delete globalThis.__feelLog; delete globalThis.__feelHeard; F.play('tap'); assert.equal(globalThis.__feelLog, undefined, 'no logging without the flag');
});

// ---- motion
const el = () => { const cls = new Set(), ls = {}; return { cls, textContent: '', offsetWidth: 1, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, addEventListener: (e, f) => { (ls[e] ||= []).push(f); }, removeEventListener: (e, f) => { ls[e] = (ls[e] || []).filter((x) => x !== f); }, fire: (e, target) => (ls[e] || []).slice().forEach((f) => f({ target: target || undefined })), ls }; };
t('pulse adds one class and removes it when its own animation ends (not a child\'s)', () => {
  const a = el(); a.fire.self = a; assert.equal(F.pulse(a, 'pop'), true); assert.ok(a.cls.has('fx-pop'));
  a.fire('animationend', { child: true }); assert.ok(a.cls.has('fx-pop'), 'a child animation does not end it'); a.fire('animationend', a); assert.ok(!a.cls.has('fx-pop')); assert.equal(a.ls.animationend.length, 0, 'listener removed');
  for (const k of F.PULSES) { const b = el(); assert.equal(F.pulse(b, k), true, k); assert.ok(b.cls.has(`fx-${k}`)); b.fire('animationend', b); }
  assert.deepEqual([...F.PULSES].sort(), ['drop', 'flame', 'pop', 'rise', 'shake', 'slide-next', 'slide-out', 'stamp']);
});
t('pulse ignores a missing element or an unknown name', () => { assert.equal(F.pulse(null, 'pop'), false); assert.equal(F.pulse(el(), 'wobble'), false); assert.equal(F.pulse(undefined, undefined), false); });
const frames = []; globalThis.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
const run = (ms, step = 16) => { for (let t0 = 1000, now = t0; frames.length && now <= t0 + ms + step; now += step) { const f = frames.splice(0); f.forEach((fn) => fn(now)); } };
t('countUp runs from the start to exactly the end, easing out, and can be formatted', () => {
  F.init({}); const e = el(), seen = []; const orig = Object.getOwnPropertyDescriptor(e, 'textContent');
  Object.defineProperty(e, 'textContent', { set(v) { seen.push(v); }, get() { return seen.at(-1); } });
  F.countUp(e, 0, 12, 600); assert.equal(seen[0], '0'); run(700); assert.equal(seen.at(-1), '12'); const nums = seen.map(Number); assert.deepEqual([...nums].sort((a, b) => a - b), nums, 'only goes up'); assert.ok(nums.length > 5, 'animated');
  const mid = nums[Math.floor(nums.length / 2)]; assert.ok(mid > 6, 'eases out: more than half done by half the time');
  seen.length = 0; F.countUp(e, 10.4, 10.2, 300); run(400); assert.equal(seen.at(-1), '10.2'); assert.ok(seen.map(Number).every((v) => v <= 10.4 && v >= 10.2), 'counts down');
  seen.length = 0; F.countUp(e, 0, 5, 300, (v) => `${Math.round(v)} pts`); run(400); assert.equal(seen.at(-1), '5 pts'); void orig;
});
t('countUp stops cleanly, finishes at once when motion is off, and ignores bad input', () => {
  F.init({}); const e = el(); frames.length = 0; const stop = F.countUp(e, 0, 20, 600); stop(); assert.equal(e.textContent, '20'); run(700); assert.equal(e.textContent, '20');
  F.init({ feel: { motion: false } }); assert.equal(F.calm(), true); const f = el(); F.countUp(f, 0, 9, 600); assert.equal(f.textContent, '9', 'no animation when calm'); assert.equal(frames.length, 0);
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {} }); F.init({}); assert.equal(F.calm(), true, 'the phone asks for reduced motion'); const g = el(); F.countUp(g, 0, 7, 600); assert.equal(g.textContent, '7');
  delete globalThis.matchMedia; F.init({}); assert.equal(F.calm(), false);
  assert.doesNotThrow(() => { F.countUp(null, 0, 1); F.countUp(el(), NaN, 1); F.countUp(el(), 0, Infinity); }); const h = el(); F.countUp(h, 4, 4, 300); assert.equal(h.textContent, '4');
});
t('confetti is skipped without a canvas or when motion is off, and says so in the test log', () => {
  globalThis.__feelTest = true; delete globalThis.__feelLog; F.init({});
  assert.equal(F.confetti(null), false); assert.equal(F.confetti({}), false); F.init({ feel: { motion: false } }); assert.equal(F.confetti({ getContext() { throw new Error('should not draw'); }, getBoundingClientRect() { return {}; } }), false);
  assert.deepEqual(globalThis.__feelLog, ['confetti:skipped', 'confetti:skipped', 'confetti:skipped']); delete globalThis.__feelTest; delete globalThis.__feelLog; F.init({});
});

// ---- wording
t('wording lives in COPY and uses the name BreakingPar, never GolfIQ', () => {
  assert.equal(F.COPY.app, 'BreakingPar'); const all = JSON.stringify(F.COPY, (k, v) => (typeof v === 'function' ? v(5, 10, false) : v)); assert.ok(!/golfiq/i.test(all)); assert.ok(/BreakingPar/.test(all));
  assert.equal(F.COPY.verdict.holed, 'Holed'); assert.equal(F.COPY.met, 'Target met'); assert.equal(F.COPY.best, 'New personal best'); assert.equal(F.COPY.short(2), '2 short of your target'); assert.equal(F.COPY.level(9), "That's a 9-handicap score.");
  assert.equal(F.COPY.target(5, 10), 'Target 5 · a 10 handicap'); assert.equal(F.COPY.progress(2, 3), '2 of 3 done'); assert.equal(F.COPY.next, 'Up next');
  assert.ok(F.COPY.sound.on !== F.COPY.sound.off); for (const name of F.EVENT_NAMES) assert.ok(F.COPY.settings.names[name], `a plain label for ${name}`);
  assert.ok(!/!/.test(all), 'no exclamation marks');
});
console.log(`${n} tests passed`);
