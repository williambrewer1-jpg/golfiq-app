// feel.js — sound, motion helpers and celebrations for the practice games, so game code only calls named events.
// Sounds are synthesised with the Web Audio API (no audio files); animation is CSS plus one small canvas for confetti. Works offline.
// iPhone notes: audio can only start after a tap, so unlock() must be called from a tap handler. Web Audio follows the phone's silent switch; that is the
// right behaviour and is not worked around. Nothing here throws, and nothing delays input: every function is safe to call from a tap handler.
//
//   init(settings)            read settings.feel = { sound, motion } (both on by default) and apply them
//   unlock()                  create / resume the AudioContext (call on the first tap of any game button)
//   play(event, opts)         play a named sound; a no-op when sound is off or there is no audio context. Returns true if it was scheduled
//   pulse(el, kind)           add one CSS animation class, remove it again when it ends
//   confetti(canvas, opts)    brand-coloured burst, about 1.2 s, skipped when motion is off
//   countUp(el, from, to, ms) animate a number
//   COPY                      every feedback phrase, in one place

const G = globalThis;
export const FEEL_DEFAULTS = { sound: true, motion: true };

// ------------------------------------------------------------------ settings
let cfg = { ...FEEL_DEFAULTS };
export const read = (settings) => ({ ...FEEL_DEFAULTS, ...(settings && typeof settings.feel === 'object' && settings.feel ? Object.fromEntries(Object.entries(settings.feel).filter(([k, v]) => k in FEEL_DEFAULTS && typeof v === 'boolean')) : {}) });
export const get = () => ({ ...cfg });
const osCalm = () => { try { return !!G.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
// true when animation should be reduced to a fade: the phone asks for it, or the Motion switch is off
export const calm = () => osCalm() || !cfg.motion;
function applyMotion() { try { G.document?.documentElement?.classList.toggle('calm', calm()); } catch { /* no DOM */ } }
let watching = false;
export function init(settings) {
  cfg = read(settings); applyMotion();
  if (!watching) { watching = true; try { G.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyMotion); } catch { /* old Safari */ } }
  if (!cfg.sound) silence();
  return get();
}

// ------------------------------------------------------------------ sound definitions
// Each event is a list of voices. A voice is a tone { t, d, f, to?, wave, g } or a filtered noise burst { noise: true, t, d, f, g, q? }:
//   t = start (s), d = length (s), f = frequency (Hz), to = glide target (Hz), wave = oscillator type, g = loudness 0-1 (scaled by PEAK).
export const PEAK = 0.15;                                  // peak gain of the loudest voice: soft by design
export const MAX_SHORT_MS = 400;                           // every event is under this, except the finishes
export const LONG_EVENTS = ['finish', 'win', 'tier', 'pb'];
const hz = (semis) => 440 * 2 ** (semis / 12);             // semitones from A4
const C4 = hz(-9), E4 = hz(-5), F4 = hz(-4), G4 = hz(-2), C5 = hz(3), E5 = hz(7), G5 = hz(10), C6 = hz(15), E6 = hz(19), G6 = hz(22), A6 = hz(24), E7 = hz(31);   // equal-tempered, A4 = 440 Hz
const tone = (t, d, f, g, wave = 'sine', to) => ({ t, d, f, g, wave, ...(to ? { to } : {}) });
const noise = (t, d, f, g, q = 1) => ({ noise: true, t, d, f, g, q });
const up = (voices, semis) => voices.map((v) => (v.noise ? v : { ...v, f: v.f * 2 ** (semis / 12), ...(v.to ? { to: v.to * 2 ** (semis / 12) } : {}) }));
const FANFARE = [tone(0, 0.16, C5, 0.7, 'triangle'), tone(0.13, 0.16, E5, 0.7, 'triangle'), tone(0.26, 0.16, G5, 0.7, 'triangle'), tone(0.39, 0.5, C6, 0.85, 'triangle'), tone(0.39, 0.5, C5, 0.35, 'sine')];

export const EVENTS = {
  tap: [noise(0, 0.03, 2400, 0.5, 0.8)],                                                                    // very short soft click
  good: [noise(0, 0.07, 320, 0.45, 0.7), tone(0, 0.09, 110, 0.5, 'sine', 80), tone(0.04, 0.12, C5, 0.7), tone(0.14, 0.2, E5, 0.7)],   // low cup knock, then a major third up
  miss: [tone(0, 0.26, hz(-14), 0.6, 'sine', hz(-15))],                                                      // one soft lower note
  step: [tone(0, 0.035, 1200, 0.35, 'sine')],                                                                // light tick
  streak: [tone(0, 0.1, C5, 0.7), tone(0.09, 0.1, E5, 0.7), tone(0.18, 0.18, G5, 0.8)],                       // rising three-note run; opts.level lifts it a whole step per milestone
  target: [tone(0, 0.13, E6, 0.55), tone(0.12, 0.2, A6, 0.6)],                                               // bright two-note chime
  finish: [tone(0, 0.5, F4, 0.35), tone(0, 0.5, C5, 0.3), tone(0.4, 0.7, C4, 0.4), tone(0.4, 0.7, E4, 0.4), tone(0.4, 0.7, G4, 0.4)],   // a sus chord that resolves
  win: FANFARE,                                                                                              // four-note fanfare, about 0.9 s
  tier: [...FANFARE, tone(0.5, 0.8, E7, 0.22), tone(0.5, 0.8, E7 * 1.006, 0.22)],                              // the fanfare plus a shimmering high note
  pb: up(FANFARE, 2),                                                                                        // the fanfare one step higher
  unlock: [tone(0, 0.26, hz(-14), 0.45, 'sine', hz(7)), tone(0.2, 0.18, G6, 0.55)],                           // low-to-high sweep under a chime
};
export const EVENT_NAMES = Object.keys(EVENTS);
export const lengthOf = (name) => Math.max(0, ...(EVENTS[name] || []).map((v) => v.t + v.d));
export const SEMITONES_PER_LEVEL = 2;                       // streak milestones 3, 5, 10 lift the run by a whole step each
export const streakLevel = (n) => (n >= 10 ? 2 : n >= 5 ? 1 : 0);

// ------------------------------------------------------------------ audio engine
let ctx = null, master = null, noiseBuf = null;
const Ctor = () => G.AudioContext || G.webkitAudioContext;
export function unlock() {
  try {
    const A = Ctor(); if (!A) return false;
    if (!ctx) { ctx = new A(); master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume?.()?.catch?.(() => {});
    if (!ctx.__primed) { ctx.__primed = true; const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); }   // iOS: a silent buffer inside the tap fully wakes audio
    return true;
  } catch { ctx = null; return false; }
}
export const ready = () => !!ctx && ctx.state !== 'closed';
function silence() { try { if (master) { master.disconnect(); master = ctx.createGain(); master.connect(ctx.destination); } } catch { /* nothing playing */ } }

const noiseBuffer = () => {
  if (noiseBuf) return noiseBuf;
  const n = Math.floor(ctx.sampleRate * 0.25), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
};
function voice(v, t0, shift) {
  const g = ctx.createGain(), peak = Math.max(0.0002, Math.min(1, v.g) * PEAK), start = t0 + v.t, end = start + v.d;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(peak, start + Math.min(0.012, v.d / 3));                  // short attack: no click
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  let src;
  if (v.noise) {
    src = ctx.createBufferSource(); src.buffer = noiseBuffer();
    const f = ctx.createBiquadFilter(); f.type = v.f > 1500 ? 'bandpass' : 'lowpass'; f.frequency.value = v.f; f.Q.value = v.q || 1;
    src.connect(f); f.connect(g);
  } else {
    src = ctx.createOscillator(); src.type = v.wave || 'sine';
    const k = 2 ** (shift / 12); src.frequency.setValueAtTime(v.f * k, start);
    if (v.to) src.frequency.exponentialRampToValueAtTime(v.to * k, end);
    src.connect(g);
  }
  g.connect(master); src.start(start); src.stop(end + 0.03);
}
// Plays a named event. opts.level lifts a streak run (0, 1, 2). Returns true only if sound was actually scheduled.
export function play(event, opts = {}) {
  const log = G.__feelTest ? (G.__feelLog ||= []) : null; if (log) log.push(event);          // tests set window.__feelTest = true and read window.__feelLog
  const def = EVENTS[event];
  if (!def || !cfg.sound || !ctx || ctx.state === 'closed') return false;
  try {
    if (ctx.state === 'suspended') ctx.resume?.()?.catch?.(() => {});
    const t0 = ctx.currentTime + 0.005, shift = event === 'streak' ? SEMITONES_PER_LEVEL * Math.max(0, Math.min(2, opts.level | 0)) : 0;
    def.forEach((v) => voice(v, t0, shift));
    if (G.__feelTest) (G.__feelHeard ||= []).push(event);
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------ motion
// The keyframes live in index.html under "/* ---- game feel */". A pulse adds fx-<kind>, then removes it when the animation ends.
export const PULSES = ['pop', 'shake', 'drop', 'slide-next', 'slide-out', 'flame', 'rise', 'stamp'];
export function pulse(el, kind) {
  if (!el || !PULSES.includes(kind)) return false;
  const cls = `fx-${kind}`;
  try {
    el.classList.remove(cls); void el.offsetWidth;                                       // restart if it is already running
    el.classList.add(cls);
    const off = () => { el.classList.remove(cls); el.removeEventListener('animationend', onEnd); clearTimeout(timer); };
    const onEnd = (e) => { if (e.target === el) off(); };                                 // ignore animations that finish on a child
    const timer = setTimeout(off, 2500);                                                 // safety net if the element is hidden and animationend never fires
    el.addEventListener('animationend', onEnd);
    return true;
  } catch { return false; }
}

// Count a number up (or down). fmt turns the value into text; by default whole numbers, or one decimal when either end has one.
export function countUp(el, from, to, ms = 600, fmt) {
  if (!el || !Number.isFinite(from) || !Number.isFinite(to)) return () => {};
  const dp = [from, to].some((x) => Math.abs(x * 10 - Math.round(x * 10)) > 1e-9) ? 2 : [from, to].some((x) => !Number.isInteger(x)) ? 1 : 0;
  const f = fmt || ((v) => v.toFixed(dp)), show = (v) => { el.textContent = f(v); };
  if (calm() || from === to || !(ms > 0) || !G.requestAnimationFrame) { show(to); return () => {}; }
  let stop = false, t0 = null;
  const tick = (now) => {
    if (stop) return; if (t0 === null) t0 = now;
    const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;                         // ease-out
    if (k >= 1) { show(to); return; }
    show(from + (to - from) * e); G.requestAnimationFrame(tick);
  };
  show(from); G.requestAnimationFrame(tick);
  return () => { stop = true; show(to); };
}

// ------------------------------------------------------------------ confetti
export const CONFETTI = { count: 70, ms: 1200, gravity: 900, fallback: ['#0b6b47', '#f2cf4a', '#c9a43a', '#f3efe3'] };
const lum = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return null; const n = parseInt(m[1], 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
// green, gold and cream from the current theme's own tokens; cream is whichever of --bg and --ink is the lighter, so it works in light and dark
export function palette() {
  const cs = G.getComputedStyle?.(G.document.documentElement), v = (n) => (cs?.getPropertyValue(n) || '').trim();
  const bg = v('--bg'), ink = v('--ink'), cream = (lum(bg) ?? -1) >= (lum(ink) ?? -1) ? bg : ink;
  return [v('--good') || CONFETTI.fallback[0], v('--flag') || CONFETTI.fallback[1], v('--gold') || CONFETTI.fallback[2], cream || CONFETTI.fallback[3]];
}
// Draws a brand-coloured burst (green, gold and cream, from the theme) on the canvas, then clears it. Skipped when motion is off.
export function confetti(canvas, opts = {}) {
  const log = G.__feelTest ? (G.__feelLog ||= []) : null;
  if (!canvas || !canvas.getContext || calm()) { if (log) log.push('confetti:skipped'); return false; }
  if (log) log.push('confetti');
  try {
    const dpr = Math.min(2, G.devicePixelRatio || 1), r = canvas.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    canvas.width = w * dpr; canvas.height = h * dpr; const x = canvas.getContext('2d'); x.scale(dpr, dpr);
    const pick = palette();
    const ms = opts.ms || CONFETTI.ms, n = opts.count || CONFETTI.count, ox = opts.x ?? w / 2, oy = opts.y ?? h * 0.35;
    const ps = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 260 + Math.random() * 380; return { x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: 5 + Math.random() * 5, h: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, c: pick[i % pick.length] }; });
    let t0 = null, last = null;
    const frame = (now) => {
      if (t0 === null) { t0 = now; last = now; }
      const dt = Math.min(0.05, (now - last) / 1000), age = now - t0; last = now;
      x.clearRect(0, 0, w, h);
      if (age >= ms) return;
      x.globalAlpha = Math.max(0, Math.min(1, (ms - age) / 400));                           // fade out over the last 400 ms
      for (const p of ps) { p.vy += CONFETTI.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.99; p.rot += p.vr * dt; x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); }
      G.requestAnimationFrame(frame);
    };
    G.requestAnimationFrame(frame);
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------ wording
// Every feedback phrase lives here, so the tone stays in one place. Short, plain, warm. The app is being renamed: new wording says BreakingPar.
export const COPY = {
  app: 'BreakingPar',
  verdict: { holed: 'Holed', missed: 'Missed', inside: 'Inside', outside: 'Outside', short: 'Just short', hit: 'Hit', fairway: 'Fairway', wide: 'Wide' },
  target: (score, h, lower = false) => `Target ${score}${lower ? ' or fewer' : ''} · a ${h} handicap`,
  streak: (n) => `${n} in a row`,
  reachedTarget: 'Target reached',
  pressure: 'Pressure ball — counts double',
  met: 'Target met',
  best: 'New personal best',
  short: (n) => `${n} short of your target`,
  level: (h) => `That's a ${h}-handicap score.`,
  tier: (name) => `${name} tier`,
  next: 'Up next',
  progress: (i, n) => `${i} of ${n} done`,
  sound: { on: 'Sound on', off: 'Sound off' },
  settings: {
    title: 'Sound and motion',
    sound: 'Sound', soundNote: 'Short sounds as you play in BreakingPar. They follow your phone\'s silent switch.',
    motion: 'Motion', motionNote: 'Small animations and confetti. Off, or with Reduce Motion on your phone, they become a quick fade.',
    try: 'Try the sounds', tryOff: 'Sound is off. Switch it on to hear them.', tryNone: 'No sound available on this device.',
    names: { tap: 'Tap', good: 'Good result', miss: 'Miss', step: 'Next ball', streak: 'Streak', target: 'Target passed', finish: 'Game finished', win: 'Target met', tier: 'New tier', pb: 'Personal best', unlock: 'Potential credit' },
  },
};
