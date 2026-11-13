// Handicap levels for practice scores, from published amateur data (Shot Scope, via MyGolfSpy and Golf Monthly).
// Each game gets an "expected score" for a 0-25 handicapper; your score is placed on that scale.
// Practice-green and range conditions are easier than the course, so treat levels as a guide, not a handicap.
const H = [0, 5, 10, 15, 20, 25];
// Putts holed by distance (ft) and handicap – Shot Scope via MyGolfSpy "Putting make percentage by handicap"
const MAKE_BANDS = [[0, 3], [3, 6], [6, 9], [9, 12], [12, 18], [18, 24], [24, 30], [30, 60]];
const MAKE = {
  0: [98, 76, 49, 34, 19, 12, 7, 4], 5: [96, 67, 44, 34, 19, 13, 7, 3], 10: [96, 65, 39, 26, 18, 10, 7, 3],
  15: [93, 59, 36, 22, 16, 9, 7, 2], 20: [90, 55, 33, 18, 14, 7, 5, 2], 25: [88, 48, 30, 17, 12, 6, 4, 2],
};
// Average approach proximity (ft) by distance band (yd) – Shot Scope via Golf Monthly
const PROX_BANDS = [[50, 100], [100, 150], [150, 200], [200, 260]];
const PROX = { 0: [26, 38, 54, 92], 5: [36, 50, 82, 150], 10: [41, 57, 92, 190], 15: [48, 72, 122, 264], 20: [49, 81, 132, 291], 25: [57, 91, 168, 362] };
// Up-and-down % (scratch / 10 / 20) – Shot Scope via Golf Monthly; 5/15/25 interpolated, 25 extended on the 10-20 slope
const UPDOWN = { 0: 54, 5: 46.5, 10: 39, 15: 35, 20: 31, 25: 27 };
// Average leave after a ~30 ft first putt: scratch 4.6 ft, 25 handicap 7.8 ft – Shot Scope via MyGolfSpy
export const leave30 = (h) => 4.6 + (7.8 - 4.6) * h / 25;
export const SOURCES = [
  ['Putting make % by handicap (Shot Scope / MyGolfSpy)', 'https://mygolfspy.com/news-opinion/putting-make-percentage-by-handicap-full-chart-are-you-above-or-below-average/'],
  ['Approach proximity by handicap (Shot Scope / Golf Monthly)', 'https://golfmonthly.com/features/how-close-to-the-pin-do-amateur-golfers-hit-their-approach-shots'],
  ['Scratch vs 10 vs 20 handicap stats (Shot Scope / Golf Monthly)', 'https://www.golfmonthly.com/features/scratch-vs-10-vs-20-handicap-how-the-stats-compare'],
  ['Three-putt case study (Shot Scope / MyGolfSpy)', 'https://mygolfspy.com/shot-scope-case-study/'],
];

const lerp = (x, xs, ys) => { if (x <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[ys.length - 1]; };
const byH = (table, h, f) => lerp(h, H, H.map((k) => f(table[k])));
// chance of holing from d feet for handicap h (band mid-points, linear between them)
export function makeProb(dFt, h) {
  const mids = MAKE_BANDS.map(([a, b]) => (b === 60 ? 40 : (a + b) / 2));
  return byH(MAKE, h, (row) => lerp(dFt, mids, row) / 100);
}
// average proximity (ft) from d yards for handicap h (clamped to the published bands)
export function proximityFt(dYd, h) { const mids = PROX_BANDS.map(([a, b]) => (a + b) / 2); return byH(PROX, h, (row) => lerp(dYd, mids, row)); }
export const upDown = (h) => lerp(h, H, H.map((k) => UPDOWN[k])) / 100;
// share of balls finishing within R ft when the average miss is mu ft (assumes a typical round spread around the target)
export const within = (rFt, muFt) => 1 - Math.exp(-Math.PI * rFt * rFt / (4 * muFt * muFt));

// ------------------------------------------------------------------ the combine: 18 approach shots, 6 targets x 3 balls
// Each ball scores by how close it finishes as a share of the target distance.
export const COMBINE_TARGETS = [50, 75, 100, 125, 150, 175];        // in your display unit
export const COMBINE_BUCKETS = [[0.05, 100, 'within 5%'], [0.10, 75, 'within 10%'], [0.15, 50, 'within 15%'], [0.25, 25, 'within 25%'], [Infinity, 0, 'further / mishit']];
export function combineScore(points) { const v = points.filter((p) => Number.isFinite(p)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function combineExpected(h, unitM) {
  let tot = 0;
  for (const t of COMBINE_TARGETS) {
    const dYd = t * unitM / 0.9144, mu = proximityFt(dYd, h);
    let prev = 0;
    for (const [frac, pts] of COMBINE_BUCKETS) { const p = frac === Infinity ? 1 : within(frac * dYd * 3, mu); tot += pts * (p - prev); prev = p; }
  }
  return tot / COMBINE_TARGETS.length;
}

// ------------------------------------------------------------------ expected score per game, as a function of handicap
const P18 = [3, 5, 8, 12, 16, 20, 25, 32, 40];
const EXPECTED = {
  'putt-par18': (h) => P18.reduce((t, d) => { const m1 = makeProb(d, h), lv = d * leave30(h) / 30; return t + 1 + (1 - m1) * (1 + (1 - makeProb(lv, h))); }, 0),
  'putt-369': (h) => 3 * (makeProb(3, h) + makeProb(6, h) + makeProb(9, h)),
  'putt-lag': (h) => 10 * within(3, 35 * leave30(h) / 30),
  'putt-streak': (h) => { const p = makeProb(4, h); return Math.log(25 * (1 - p)) / Math.log(1 / p); },          // longest run in ~25 tries
  'chip-updown': (h) => 9 * upDown(h),
  'chip-par18': (h) => 9 * (3 - upDown(h)),
  'range-greens': (h) => 9 * [80, 100, 120, 140, 160].reduce((t, d) => t + within(0.1 * d * 3, proximityFt(d, h)), 0) / 5,
  'range-wedge': (h) => 10 * [40, 55, 70, 85, 100].reduce((t, d) => t + within(15, proximityFt(d, h)), 0) / 5,
  combine: (h, unitM) => combineExpected(h, unitM),
};
export const NO_LEVEL = {
  'chip-zone': 'No published amateur data for landing-spot accuracy, so this one is tracked against your own history only.',
  'range-fairways': 'Fairways hit barely changes with handicap in Shot Scope data (50% scratch, 48% at 10, 45% at 20), so a level would be noise.',
  'range-round': 'Use Range round instead – it scores a full course and gives a handicap-style level.',
};
export const NOTES = {
  'putt-par18': 'Model: make % by distance per handicap, and the second putt from the average leave (4.6 ft scratch to 7.8 ft at 25 from 30 ft).',
  'putt-lag': 'Model: average leave from ~30 ft (4.6 ft scratch, 7.8 ft at 25 handicap) spread around the hole.',
  'putt-streak': 'Model: make % from 4 ft; expected longest run in about 25 attempts.',
  'chip-updown': 'Up-and-down %: 54% scratch, 39% at 10, 31% at 20 handicap (on the course).',
  'chip-par18': 'Assumes up and down or 3 from each spot, using on-course up-and-down % by handicap.',
  'range-greens': 'A hit = inside 10% of the distance; uses on-course proximity by handicap from 80–160 yd.',
  'range-wedge': 'Inside 5 yd; uses on-course proximity by handicap from 50–100 yd.',
  combine: 'Expected points for each target from on-course proximity by handicap.',
};
export const hasLevel = (id) => !!EXPECTED[id];
// Handicap level for a score: interpolate on the expected-score curve. Returns { h, label } or null.
export function level(gameId, score, better = 'higher', unitM = 0.9144) {
  const f = EXPECTED[gameId]; if (!f || !Number.isFinite(score)) return null;
  const hs = Array.from({ length: 51 }, (_, i) => i / 2), ex = hs.map((h) => f(h, unitM)), good = (a, b) => (better === 'lower' ? a <= b : a >= b);
  if (good(score, ex[0])) return { h: 0, label: 'Scratch or better', expected0: ex[0] };
  if (!good(score, ex[ex.length - 1])) return { h: 25, label: 'Over 25', expected25: ex[ex.length - 1] };
  for (let i = 1; i < hs.length; i++) if (good(score, ex[i])) {
    const t = (score - ex[i - 1]) / (ex[i] - ex[i - 1] || 1), h = hs[i - 1] + t * (hs[i] - hs[i - 1]);
    return { h, label: `≈ ${Math.round(h)} handicap` };
  }
  return null;
}
// what a given handicap is expected to score – shown as targets ("a 10 handicap scores 4.3")
export const expectedFor = (gameId, h, unitM = 0.9144) => (EXPECTED[gameId] ? EXPECTED[gameId](h, unitM) : null);

// ------------------------------------------------------------------ weeks and months
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)), wk = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
// The weekly challenge is the same for everyone: picked from the week number.
export const CHALLENGE_POOL = ['putt-369', 'chip-updown', 'range-greens', 'putt-lag', 'range-wedge', 'putt-par18', 'chip-par18', 'putt-streak'];
export function weeklyChallenge(week = isoWeek()) { const n = Number(week.slice(-2)) + Number(week.slice(0, 4)); return CHALLENGE_POOL[n % CHALLENGE_POOL.length]; }
