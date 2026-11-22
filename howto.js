// How to play each guided game, in plain words: what you are trying to do, how to set up, what to do each ball, what to tap and how it is scored.
// Also the question and button labels for each step of the game screen, so the golfer always knows what a tap means.
// Pure logic, no DOM, so Node can test it. All distances follow the golfer's unit.
const YD = 0.9144, isYd = (u) => Math.abs(u - YD) < 0.01;
const unitName = (u) => (isYd(u) ? 'yd' : 'm');
const d = (yd, u) => (isYd(u) ? Math.round(yd) : Math.round(yd * YD / 5) * 5);                // a yard distance in the golfer's unit, rounded to 5 m
const dd = (yd, u) => `${d(yd, u)} ${unitName(u)}`;

// Each entry: aim (one line), setup, each (what to do each ball), tap (what to press), score.
const HOW = {
  'putt-369': () => ({
    aim: 'Hole as many of nine short putts as you can.',
    setup: 'Pick one hole on the practice green. Mark spots 3, 6 and 9 ft away (about one, two and three putter lengths).',
    each: 'Three balls from 3 ft, then three from 6 ft, then three from 9 ft. The screen shows which distance is next.',
    tap: 'After each putt, tap Holed or Missed.',
    score: 'One point for every putt holed, out of 9.',
  }),
  'putt-par18': () => ({
    aim: 'Hole out on nine putting holes in as few putts as you can.',
    setup: 'Pick nine different holes on the practice green. One ball and your putter.',
    each: 'The screen gives a distance from 3 to 40 ft. Pace it out, putt, and keep putting until the ball is in.',
    tap: 'Tap how many putts it took. Par is 2 on every hole.',
    score: 'Your total putts for the nine holes. Par is 18; lower is better.',
  }),
  'putt-lag': () => ({
    aim: 'Roll long putts close enough that you would never three-putt.',
    setup: 'Use the biggest practice green. One ball, and a different hole each time if you can.',
    each: 'The screen gives a distance from 20 to 50 ft. Pace it out and hit one putt. Do not hole out.',
    tap: 'Tap Inside 3 ft if it stopped within a putter grip of the hole (holed counts), otherwise Outside.',
    score: 'One point for every putt inside 3 ft, out of 10.',
  }),
  'putt-streak': () => ({
    aim: 'Hole as many 4-footers in a row as you can.',
    setup: 'Set balls in a circle 4 ft from one hole, about one and a third putter lengths away.',
    each: 'Putt your way round the circle, a new spot each time.',
    tap: 'Tap Holed or Missed after each putt. The first miss ends the game.',
    score: 'How many you holed in a row.',
  }),
  'chip-updown': () => ({
    aim: 'Get up and down (chip, then one putt) from nine different spots.',
    setup: 'One ball, a wedge and your putter, around a practice green.',
    each: 'The screen gives you a lie, like rough or a downhill lie. Drop the ball there, chip, then putt out.',
    tap: 'Tap Saved if it was in the hole in two shots or fewer, otherwise Missed.',
    score: 'One point for every up-and-down, out of 9.',
  }),
  'chip-par18': () => ({
    aim: 'Chip and putt out from nine spots in as few shots as you can.',
    setup: 'One ball, a wedge and your putter, around a practice green.',
    each: 'The screen gives you a lie. Chip from there and keep going until the ball is in the hole.',
    tap: 'Tap how many shots it took, chip included. Par is 2 on every hole.',
    score: 'Your total for the nine holes. Par is 18; lower is better.',
  }),
  'chip-zone': () => ({
    aim: 'Land your chips on a spot. That is what controls distance.',
    setup: 'Lay a towel on the green 5 to 10 paces from you. Pick one club and keep it for all ten chips.',
    each: 'Chip ten balls, trying to land each one (the first bounce) on the towel. Where it rolls to does not matter.',
    tap: 'After each chip, tap On the towel or Missed.',
    score: 'One point for every chip that lands on the towel, out of 10.',
  }),
  'range-fairways': (u) => ({
    aim: 'Hit as many of 14 tee shots as you can into a pretend fairway.',
    setup: `Pick two targets on the range about ${dd(30, u)} apart, such as two flags or signs. The fairway is the gap between them.`,
    each: 'Hit 14 tee shots with the clubs you normally use off the tee, with your full routine each time.',
    tap: 'Tap Fairway if the ball finished between the two targets, otherwise Missed.',
    score: 'One point for every fairway, out of 14.',
  }),
  'range-greens': (u) => ({
    aim: 'Hit nine approach shots close to the flag, each to a different distance.',
    setup: `At the range, find flags or signs between ${dd(80, u)} and ${dd(160, u)} away.`,
    each: 'The screen gives a distance. Aim at the target nearest to it, pick your club and hit one ball. New target and club every ball.',
    tap: `Tap Inside if it finished within 10% of the distance (${dd(12, u)} at ${dd(120, u)}; the screen shows the number each time), otherwise Outside.`,
    score: 'One point for every green hit, out of 9.',
  }),
  'range-wedge': (u) => ({
    aim: 'Control your wedge distances: ten shots to called numbers.',
    setup: `At the range, find targets between ${dd(40, u)} and ${dd(100, u)} away. A rangefinder helps.`,
    each: 'The screen calls a distance. Hit one wedge to that number.',
    tap: `Tap Inside if it finished within ${isYd(u) ? '5 yd' : '4.5 m'} of the number, otherwise Outside.`,
    score: `One point for every shot within ${isYd(u) ? '5 yd' : '4.5 m'}, out of 10.`,
  }),
  'range-round': () => ({
    aim: 'Play nine holes of your home course on the range.',
    setup: 'Picture your home course. Use range targets as the fairways and greens.',
    each: 'Each hole is two shots: a tee shot with the club you would use there, then the approach into the green.',
    tap: 'After each shot, tap Worked if it would have found a good spot on the real hole, otherwise Didn\'t work.',
    score: 'One point for every shot that worked, out of 18.',
  }),
  'range-driver': (u) => ({
    aim: 'Find your real driving distance: long and straight together.',
    setup: `Pick two markers or flags about ${dd(40, u)} apart as your fairway. Ten balls and your driver, full routine each time.`,
    each: 'Hit a drive. Move the slider to roughly how far it went, or type a launch-monitor number.',
    tap: 'Then tap where it finished: Fairway, Missed (rough or first cut) or Wide (trees, water or out of bounds on a real hole).',
    score: `A fairway ball counts its full distance, a miss ${dd(20, u)} less and a wide one half. Your score is the average over ten balls.`,
  }),
  'range-speed': () => ({
    aim: 'Swing as hard as you can. Only distance counts.',
    setup: 'Five balls and your driver. Warm up first.',
    each: 'Hit each ball as far as you can. Where it goes does not matter.',
    tap: 'Move the slider to how far it went, then tap Save ball.',
    score: 'Your longest ball. It is compared with your own past scores.',
  }),
};

export const LABELS = { setup: 'Set up', each: 'Each ball', tap: 'What to tap', score: 'Scoring' };
export const hasHow = (id) => !!HOW[id];

// howTo(game, unitM) → { aim, rows: [{ key, label, text }] }. A game without a written guide (one the golfer added) falls back to its own description.
export function howTo(game, unitM = YD) {
  if (!game) return null;
  const f = HOW[game.id];
  if (!f) return game.how ? { aim: game.how, rows: [{ key: 'score', label: LABELS.score, text: game.better === 'lower' ? 'Lower is better.' : 'Higher is better.' }] } : null;
  const h = f(unitM);
  return { aim: h.aim, rows: ['setup', 'each', 'tap', 'score'].map((key) => ({ key, label: LABELS[key], text: h[key] })) };
}

// askOf(game, step, unitM) → { q, yes, no }: the question above the answer buttons, and the words on the buttons (hit/miss steps only).
export function askOf(game, step, unitM = YD) {
  if (!game || !step) return { q: '' };
  if (step.input === 'strokes') return { q: game.cat === 'Chipping' ? `How many shots to hole out, chip included? Par ${step.par ?? 2}.` : `How many putts to hole out? Par ${step.par ?? 2}.` };
  if (step.input === 'distance') return { q: step.results ? 'How far did it go, and where did it finish?' : 'How far did it go?' };
  const u = unitName(unitM);
  switch (game.id) {
    case 'putt-369': case 'putt-streak': return { q: 'Did it go in?', yes: 'Holed', no: 'Missed' };
    case 'putt-lag': return { q: 'Did it stop within 3 ft of the hole?', yes: 'Inside 3 ft', no: 'Outside' };
    case 'chip-updown': return { q: 'In the hole in two shots or fewer?', yes: 'Saved', no: 'Missed' };
    case 'chip-zone': return { q: 'Did it land on the towel?', yes: 'On the towel', no: 'Missed' };
    case 'range-fairways': return { q: 'Did it finish between your two targets?', yes: 'Fairway', no: 'Missed' };
    case 'range-greens': { const n = parseInt(step.prompt, 10), tol = Number.isFinite(n) ? Math.max(1, Math.round(n * 0.1)) : null; return { q: tol ? `Did it finish within ${tol} ${u} of the target?` : 'Did it finish close enough?', yes: 'Inside', no: 'Outside' }; }
    case 'range-wedge': return { q: `Did it finish within ${isYd(unitM) ? '5 yd' : '4.5 m'} of the number?`, yes: 'Inside', no: 'Outside' };
    case 'range-round': return { q: 'Would it have worked on the real hole?', yes: 'Worked', no: 'Didn\'t work' };
    default: return { q: 'Did you hit it?', yes: 'Hit', no: 'Miss' };
  }
}
