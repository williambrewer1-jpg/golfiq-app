// BreakingPar shot tracking: the pure logic behind "I've hit" / "At my ball" on the Course view (course-view plan, section 6).
// Works on one hole of the round in progress: J().draft.holes[n] = { par, strokes, putts, penalties, fairway, shots: [...],
// first_putt_m, done, derived, corrected }. No DOM, no storage – course.js / track.js call these and save the draft.
import * as A from './analytics.js';
import * as F from './features.js';

// ---- tunable numbers (plan section 10)
export const POOR_GPS_M = 15;                    // positions with worse accuracy are marked approx (score yes, club stats no)
export const STRIP_MS = 4000;                    // the result strip after "At my ball"
export const BALL_NEAR_M = 30;                   // further than this from your known ball: the map shows the view from the ball
export const AROUND_GREEN_M = A.T.around_green_max_m;   // same line as the dataset's "around the green"
export const FIRST_PUTT_MAX_FT = 60, FIRST_PUTT_STEP_FT = 3, FT = 0.3048;
export const PUTTS_MAX = 4;                      // the putt counter's top button reads "4+"

export const RESULTS = ['fairway', 'rough', 'bunker', 'trees', 'water', 'green', 'fringe'];
export const PENALTIES = ['water', 'ob', 'unplayable'];
export const DROP_PENALTIES = ['water', 'unplayable'];   // the next "At my ball" is the drop; out of bounds / lost replays from the start

// What the map says a spot is, as a shot result. No outline: null (the golfer picks).
export function resultAt(pt, feats) {
  if (!pt || !feats?.some((f) => f.kind !== 'hole')) return null;
  const s = F.surfaceAt(pt[0], pt[1], feats);
  return s === 'tee' ? 'fairway' : RESULTS.includes(s) ? s : 'rough';
}

const shotsOf = (h) => (h.shots = h.shots || []);
// The shot in the air or not yet found: hit, not yet closed at the ball, no penalty that ended it.
export const openShot = (h) => { const s = (h?.shots || []).at(-1); return s && !s.end && !s.penalty && !s.manual ? s : null; };
export const awaitingDrop = (h) => { const s = (h?.shots || []).at(-1); return !!(s && DROP_PENALTIES.includes(s.penalty) && !s.drop); };
export const lastShot = (h) => (h?.shots || []).at(-1) || null;

// Where the ball is now, if known: the tee before the first shot, the last shot's end, its drop, or – after out of bounds –
// the spot it was played from. null while a shot is open or a drop is awaited.
export function ballPos(h, tee = null) {
  const s = lastShot(h);
  if (!s) return tee || null;
  if (openShot(h) || awaitingDrop(h)) return null;
  if (s.penalty === 'ob') return s.start || null;
  return s.drop || s.end || null;
}
// The lie for the next shot.
export function nextLie(h, feats = null) {
  const s = lastShot(h); if (!s) return 'tee';
  if (s.penalty === 'ob') return s.lie || 'rough';
  if (s.drop) return resultAt(s.drop, feats) || 'rough';
  return s.result || null;
}

// "I've hit". A shot still open (two "I've hit" taps in a row) is closed where this one starts.
// start: GPS when accurate; otherwise the known ball position (the tee for the first shot); otherwise GPS marked approx.
export function hit(h, { gps = null, acc = null, tee = null, club_id = null, club_assumed = false, aim = null, adjusted_aim = false, feats = null, at = Date.now() }) {
  const shots = shotsOf(h), open = openShot(h), good = gps && A.isNum(acc) && acc <= POOR_GPS_M;
  if (open) close(h, { gps, acc, feats, at });
  const known = ballPos(h, tee);
  const start = good ? gps : known || gps || null, approx = !start || (!good && !known);
  const s = { n: shots.length + 1, club_id, club_assumed: !!club_assumed, start, end: null, aim, lie: nextLie(h, feats), result: null, penalty: null, approx: !!approx, adjusted_aim: !!adjusted_aim, at };
  shots.push(s); h.done = false; delete h.putting;
  return s;
}
// "At my ball" (or a spot marked on the map). Closes the open shot; with a drop awaited, records the drop instead.
// Returns { shot, kind: 'end' | 'drop' } or null when there is nothing to close.
export function close(h, { gps = null, acc = null, marked = null, feats = null, at = Date.now() }) {
  const pt = marked || gps, approx = !marked && !(A.isNum(acc) && acc <= POOR_GPS_M);
  if (awaitingDrop(h)) { const s = lastShot(h); s.drop = pt; s.drop_approx = !pt || approx; return { shot: s, kind: 'drop' }; }
  const s = openShot(h); if (!s) return null;
  s.end = pt || null; s.end_at = at; s.marked = !!marked;
  s.approx = !!(s.approx || !pt || approx);
  s.result = resultAt(pt, feats);
  return { shot: s, kind: 'end' };
}
// Undo the last step: a closed shot reopens; an open shot is removed.
export function undo(h) {
  const s = lastShot(h); if (!s) return;
  if (s.drop) { delete s.drop; delete s.drop_approx; return; }
  if (s.penalty) { s.penalty = null; if (!s.end) s.result = null; return; }
  if (s.end) { s.end = null; s.result = null; delete s.end_at; delete s.marked; return; }
  h.shots.pop();
}
// Penalty: on the shot just hit (open, or closed but unplayable). Water also sets the result.
export function penalty(h, kind) {
  if (!PENALTIES.includes(kind)) return null;
  const s = openShot(h) || lastShot(h); if (!s) return null;
  s.penalty = kind; if (kind === 'water' && !s.end) s.result = 'water';
  return s;
}
// A shot added from the shot list (forgotten): counts for the score, no positions.
export function addShot(h, { club_id = null, result = null, lie = null } = {}) {
  const shots = shotsOf(h), s = { n: shots.length + 1, club_id, club_assumed: !club_id, start: null, end: null, aim: null, lie, result, penalty: null, approx: true, adjusted_aim: false, manual: true, at: Date.now() };
  // keep an open shot last so "At my ball" still closes it
  const open = openShot(h);
  if (open) { shots.splice(shots.length - 1, 0, s); renumber(h); } else shots.push(s);
  return s;
}
export function removeShot(h, i) { (h.shots || []).splice(i, 1); renumber(h); }
const renumber = (h) => (h.shots || []).forEach((s, i) => { s.n = i + 1; });

// Distance of a shot and how far right (+) / left (−) of the aim it finished.
export function shotLine(s) {
  if (!s?.start || !s.end) return null;
  const dist_m = A.haversine(s.start[0], s.start[1], s.end[0], s.end[1]);
  if (!s.aim) return { dist_m, right_m: null };
  const br = A.bearing(s.start[0], s.start[1], s.aim[0], s.aim[1]), [, cross] = A.alongCross(s.start[0], s.start[1], s.end[0], s.end[1], br);
  return { dist_m, right_m: cross };
}

// Which side of the hole's line a point is: +1 right, −1 left (looking from the tee), 0 on it. line = [[lat, lon], ...] tee → green.
export function sideOfLine(pt, line) {
  if (!pt || !line || line.length < 2) return null;
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], br = A.bearing(a[0], a[1], b[0], b[1]), len = A.haversine(a[0], a[1], b[0], b[1]);
    const [al, cr] = A.alongCross(a[0], a[1], pt[0], pt[1], br), along = Math.max(0, Math.min(len, al));
    const d = Math.hypot(al - along, cr);
    if (!best || d < best.d) best = { d, cr };
  }
  return Math.abs(best.cr) < 0.5 ? 0 : Math.sign(best.cr);
}

export const scoreName = (strokes, par) => {
  if (!A.isNum(strokes) || !A.isNum(par) || strokes <= 0) return '';
  if (strokes === 1) return 'Hole in one';
  const d = strokes - par;
  return { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' }[d] || (d > 0 ? `+${d}` : `${d}`);
};

// Everything the hole works out for itself (plan 6.4). putts: from the putt counter. green: centre, for up-and-down.
// fairway: 'HIT' | 'LEFT' | 'RIGHT' | null (par 3, or not known). gir / up_down / sand_save: 1 | 0 | null (not applicable).
export function derive(h, { par, line = null, green = null } = {}) {
  const shots = h.shots || [], putts = A.isNum(h.putts_tracked) ? h.putts_tracked : null;
  const penalties = shots.filter((s) => s.penalty).length;
  const strokes = putts === null ? null : shots.length + penalties + putts;
  let fairway = null;
  const tee = shots[0];
  if (par >= 4 && tee) {
    if (tee.result === 'fairway' && !tee.penalty) fairway = 'HIT';
    else if (tee.result === 'green') fairway = null;
    else { const side = sideOfLine(tee.end || tee.drop || null, line); fairway = side === 1 ? 'RIGHT' : side === -1 ? 'LEFT' : null; }
  }
  const gir = strokes === null ? null : (strokes - putts) <= par - 2 ? 1 : 0;
  // up-and-down: green missed, the ball was then played from around the green once, and holed with at most one putt after it
  let up_down = null, sand_save = null;
  if (gir === 0 && green) {
    const around = shots.filter((s) => s.start && s.lie !== 'green' && A.haversine(s.start[0], s.start[1], green[0], green[1]) <= AROUND_GREEN_M);
    if (around.length) {
      const first = around[0], after = shots.slice(shots.indexOf(first));
      up_down = after.length === 1 && !after.some((s) => s.penalty) && putts <= 1 ? 1 : 0;
      if (first.lie === 'bunker') sand_save = up_down;
    }
  }
  return { strokes, putts, penalties, fairway, gir, up_down, sand_save, first_putt_m: A.isNum(h.first_putt_m) ? h.first_putt_m : null };
}
// Write what the hole worked out into the fields the rest of the app reads (strokes, putts, penalties, fairway),
// except those the golfer has corrected – corrections win (plan 6.4).
export function applyDerived(h, dv) {
  const fixed = new Set(h.corrected || []);
  if (!fixed.has('strokes') && A.isNum(dv.strokes)) h.strokes = dv.strokes;
  if (!fixed.has('putts') && A.isNum(dv.putts)) h.putts = dv.putts;
  if (!fixed.has('penalties')) h.penalties = dv.penalties;
  if (!fixed.has('fairway') && h.par >= 4) h.fairway = dv.fairway;
  h.derived = { fairway: dv.fairway, gir: dv.gir, up_down: dv.up_down, sand_save: dv.sand_save };
  return h;
}
export const correct = (h, field) => { h.corrected = [...new Set([...(h.corrected || []), field])]; };

// Hole out: the putt count (and optional first-putt distance) completes the hole.
export function holeOut(h, { putts, first_putt_m = null, par, line = null, green = null }) {
  h.putts_tracked = Math.max(0, Math.round(putts));
  if (A.isNum(first_putt_m)) h.first_putt_m = first_putt_m; else delete h.first_putt_m;
  h.done = true;
  const dv = derive(h, { par, line, green });
  applyDerived(h, dv);
  return dv;
}
// The state the golfer is in on this hole, for the Course view's bottom strip.
export function stateOf(h, { onGreen = false } = {}) {
  if (h?.done) return 'done';
  if (h?.putting === true) return 'putting';                         // "On the green" tapped
  if (openShot(h)) return 'open';
  if (awaitingDrop(h)) return 'drop';
  const s = lastShot(h);
  if (h?.putting !== false && (onGreen || (s && !s.penalty && s.result === 'green'))) return 'putting';   // false: "Not on the green"
  return 'ready';
}
