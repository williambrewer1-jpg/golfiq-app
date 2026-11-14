// Duels: a one-off head-to-head game between two members of the same group (retention plan 8.2). Pure logic; the Firestore calls are in cloud.js.
// One small document per duel: groups/{g}/duels/{id}. Only the game, the seed, who is playing, the two scores and the stake text are shared. No round data.
//
//   { from_uid, from_nick, to_uid, to_nick, game, seed, mode, pressure, stake, created, deadline, status, a, b, winner, better, unitM }
//   a = the challenger's attempt, b = the opponent's: { started, score, target, margin, at }.  `started` is written when the game starts, so the attempt is spent
//   even if the golfer quits (quitting forfeits it). `score`, `target`, `margin` and `at` are written when the game is finished.
//
// THE OPPONENT'S SCORE IS HIDDEN ONLY BY THE APP (`visible` below). That is a courtesy so nobody plays knowing what to beat, not security: the document can be read by
// every member of the group, and friends in a private group are trusted. (SETUP_FRIENDS.md says the same.)
//
// Finishing and expiry are worked out on whichever phone opens the duel next (`decide`), which then writes the final status.

export const DEADLINES = [3, 7, 14];                  // days; 7 is the default
export const DEFAULT_DEADLINE = 7;
export const MODES = ['handicap', 'straight'];        // handicap is the default: each player is measured against their own target
export const DEFAULT_MODE = 'handicap';
export const STAKE_MAX = 60;                          // characters; the app only displays it, no money is involved
export const MAX_OPEN = 3;                            // open duels per player
export const MAX_FIELDS = 20;                         // the Firestore rule allows at most 20 fields
export const TIE_EPS = 0.05;                          // margins closer than this are a draw
const DAY = 86400000;
export const newSeed = () => 1 + Math.floor(Math.random() * 2147483646);                // a seed for a new duel: both players get the same distances in the same order

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };

// How far past (or short of) their own target a score is. Positive is good, for lower-is-better games too (sign flipped).
export function margin(game, score, target) {
  if (!isNum(score) || !isNum(target)) return null;
  return r1(game?.better === 'lower' ? target - score : score - target);
}

// A new duel document, or null if it cannot be made (no opponent, yourself, no game).
//   me / them: { uid, nick };  game: a game object ({ id, better });  seed: a positive integer (the caller passes a random one)
export function newDuel({ me, them, game, seed, mode = DEFAULT_MODE, pressure = false, stake = '', days = DEFAULT_DEADLINE, unitM = 0.9144, now = Date.now() } = {}) {
  if (!me?.uid || !them?.uid || me.uid === them.uid || !game?.id || !Number.isInteger(seed) || seed < 1) return null;
  const d = DEADLINES.includes(days) ? days : DEFAULT_DEADLINE, t = new Date(now).getTime();
  return {
    from_uid: me.uid, from_nick: String(me.nick || 'Golfer').slice(0, 30), to_uid: them.uid, to_nick: String(them.nick || 'Golfer').slice(0, 30),
    game: game.id, seed, mode: MODES.includes(mode) ? mode : DEFAULT_MODE, pressure: !!pressure, stake: String(stake || '').trim().slice(0, STAKE_MAX),
    created: new Date(t).toISOString(), deadline: new Date(t + d * DAY).toISOString(), status: 'open', a: null, b: null, winner: null,
    better: game.better === 'lower' ? 'lower' : 'higher', unitM: unitM === 1 ? 1 : 0.9144,
  };
}

// Whose side am I on: 'a' (challenger), 'b' (opponent) or null
export const side = (duel, me) => (!duel || !me ? null : duel.from_uid === me ? 'a' : duel.to_uid === me ? 'b' : null);
export const otherSide = (s) => (s === 'a' ? 'b' : s === 'b' ? 'a' : null);
export const opponent = (duel, me) => (side(duel, me) === 'a' ? { uid: duel.to_uid, nick: duel.to_nick } : side(duel, me) === 'b' ? { uid: duel.from_uid, nick: duel.from_nick } : null);

const played = (slot) => !!slot && isNum(slot.score);          // finished a score
const spent = (slot) => !!slot;                                  // started: the one attempt is used, finished or not
export const isPast = (duel, now = Date.now()) => now > ms(duel?.deadline);

// A duel still counts as open while it is waiting for someone and its deadline has not passed
export const live = (duel, now = Date.now()) => !!duel && (duel.status === 'open' || duel.status === 'accepted') && !isPast(duel, now);

// Can this pair start a new duel? Reasons: self, limit (you already have three open), pair (one open duel per pair).
export function canChallenge(duels, me, them, now = Date.now()) {
  if (!me || !them || me === them) return { ok: false, reason: 'self' };
  const mine = (duels || []).filter((d) => live(d, now) && side(d, me));
  if (mine.length >= MAX_OPEN) return { ok: false, reason: 'limit' };
  if (mine.some((d) => side(d, them))) return { ok: false, reason: 'pair' };
  return { ok: true, reason: null };
}
// The opponent also has a limit: they cannot take a fourth
export function canReceive(duels, them, now = Date.now()) { return (duels || []).filter((d) => live(d, now) && side(d, them)).length < MAX_OPEN; }

// May I answer (accept or decline) this challenge?
export const canAnswer = (duel, me, now = Date.now()) => live(duel, now) && duel.status === 'open' && duel.to_uid === me;
// May I start my attempt? The challenger may play as soon as the duel is sent; the opponent after accepting. One attempt only: a started slot is spent.
export function canPlay(duel, me, now = Date.now()) {
  const s = side(duel, me); if (!s || !live(duel, now)) return false;
  if (spent(duel[s])) return false;
  return s === 'a' ? true : duel.status === 'accepted';
}

// The change to write when the game starts: the attempt is spent from this moment
export function begin(duel, me, now = Date.now()) { const s = side(duel, me); return s && canPlay(duel, me, now) ? { [s]: { started: new Date(now).toISOString() } } : null; }
// The change to write when the game is finished. `target` is the player's own target for the game (null if they have none: then the margin is null too).
export function finish(duel, me, { score, target = null }, now = Date.now()) {
  const s = side(duel, me); if (!s || !isNum(score)) return null;
  const slot = duel[s]; if (!slot || isNum(slot.score)) return null;                       // the attempt must have been started, and only finishes once
  const game = { better: duel.better };
  return { [s]: { started: slot.started, score, target: isNum(target) ? target : null, margin: margin(game, score, target), at: new Date(now).toISOString() } };
}

// Who won, from the two finished attempts: 'a', 'b' or 'draw'. A handicap duel compares margins (a missing target falls back to a straight comparison for both).
export function winnerOf(duel) {
  if (!played(duel?.a) || !played(duel?.b)) return null;
  const hc = duel.mode !== 'straight' && isNum(duel.a.margin) && isNum(duel.b.margin);
  const x = hc ? duel.a.margin : (duel.better === 'lower' ? -duel.a.score : duel.a.score), y = hc ? duel.b.margin : (duel.better === 'lower' ? -duel.b.score : duel.b.score);
  return Math.abs(x - y) < (hc ? TIE_EPS : 1e-9) ? 'draw' : x > y ? 'a' : 'b';
}

// What the final status should be right now, or null if nothing changes. Returned as { status, winner } to write.
//   both finished -> done (winner by margin or raw score) · deadline passed: one finished -> done, that player wins by forfeit · none finished -> expired
export function decide(duel, now = Date.now()) {
  if (!duel || duel.status === 'declined' || duel.status === 'done' || duel.status === 'expired') return null;
  const w = winnerOf(duel); if (w) return { status: 'done', winner: w };
  if (!isPast(duel, now)) return null;
  if (played(duel.a) && !played(duel.b)) return { status: 'done', winner: 'a' };
  if (played(duel.b) && !played(duel.a)) return { status: 'done', winner: 'b' };
  return { status: 'expired', winner: null };
}
export const isForfeit = (duel) => duel?.status === 'done' && (!played(duel.a) || !played(duel.b));

// What one phone may show. The other player's attempt stays hidden until my own is finished, or the duel is over.
export function visible(duel, me) {
  const s = side(duel, me); if (!s) return { side: null, mine: null, theirs: null, hidden: false };
  const o = otherSide(s), final = duel.status === 'done' || duel.status === 'expired', open = final || played(duel[s]);
  return { side: s, mine: duel[s] || null, theirs: open ? duel[o] || null : null, hidden: !open && !!duel[o] };
}

// The running record between me and one friend, from finished duels only (a forfeit win counts; declined and expired do not)
export function record(duels, me, them) {
  const out = { won: 0, drawn: 0, lost: 0 };
  for (const d of duels || []) {
    if (d.status !== 'done' || !side(d, me) || !side(d, them) || me === them) continue;
    if (d.winner === 'draw') out.drawn++; else if (d.winner === side(d, me)) out.won++; else if (d.winner) out.lost++;
  }
  return out;
}
export const recordText = (r) => `${r.won}–${r.drawn}–${r.lost}`;
export const recordTotal = (r) => r.won + r.drawn + r.lost;

// A rematch: a new duel from me to the same opponent with the same game, scoring, pressure, stake and length, and a new seed
export function rematch(duel, me, { seed, now = Date.now(), unitM } = {}) {
  const them = opponent(duel, me); if (!them) return null;
  const span = Math.round((ms(duel.deadline) - ms(duel.created)) / DAY), days = DEADLINES.includes(span) ? span : DEFAULT_DEADLINE;
  const mine = side(duel, me) === 'a' ? { uid: duel.from_uid, nick: duel.from_nick } : { uid: duel.to_uid, nick: duel.to_nick };
  const next = newDuel({ me: mine, them, game: { id: duel.game, better: duel.better }, seed: seed === duel.seed ? seed + 1 : seed, mode: duel.mode, pressure: duel.pressure, stake: duel.stake, days, unitM: unitM ?? duel.unitM, now });
  return next;
}

// What the points need (level.js `duels`): one entry per duel result saved on this phone. `won` is the outcome stamped on the result once the duel was decided.
export const pointsEntries = (results) => (results || []).filter((r) => r.duel).map((r) => ({ date: r.date, won: r.duel_won === true }));

// The duels to show, newest first, in four groups
export function groups(duels, me, now = Date.now()) {
  const mine = (duels || []).filter((d) => side(d, me)).sort((x, y) => String(y.created).localeCompare(String(x.created)));
  const lv = mine.filter((d) => live(d, now));
  return {
    incoming: lv.filter((d) => d.status === 'open' && d.to_uid === me),
    toPlay: lv.filter((d) => canPlay(d, me, now)),
    waiting: lv.filter((d) => !canPlay(d, me, now) && !(d.status === 'open' && d.to_uid === me)),
    finished: mine.filter((d) => d.status === 'done'),
  };
}

// Days left, for "5 days left" (rounds up; 0 when past)
export const daysLeft = (duel, now = Date.now()) => Math.max(0, Math.ceil((ms(duel.deadline) - now) / DAY));
