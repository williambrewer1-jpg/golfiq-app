// Practice with a friend: two to four golfers on one phone, taking turns in the same guided game (first-run plan, part C). Pure logic, no DOM, so Node can test it.
//
// Everything lives in the game draft (J().game_draft.party), so a game survives the phone locking:
//   { id, mode: 'straight'|'handicap', players: [{ name, hcp, colour, owner, target, answers: [], balls?: [] }], log: [playerIndex, ...], seen }
//   log  — who answered, in order, so Undo can step back one answer across a hand-over
//   seen — the player whose turn was last shown on screen; when the player whose turn it is differs, the screen asks to pass the phone
//
// Turns go by station: a run of consecutive steps with the same prompt (the three balls from 6 ft). One player plays the whole station, then the phone passes on.
// The order rotates by one each station, so the same player does not always go first.
//
// GUESTS' NAMES AND SCORES STAY ON THIS PHONE. Only the owner's score is saved as a practice result, and the guests ride inside that record (`partyRecord`).
// They are never uploaded: the friends score document is built from a fixed list of fields (league.js shareExtras) that does not include them.
import * as G from './games.js';
import * as B from './bench.js';

// ---- every number below is a default and can be tuned here
export const MAX_PLAYERS = 4;                    // the owner plus up to three guests
export const MIN_PLAYERS = 2;
export const NAME_MAX = 20;                      // characters in a player's name
export const HCP_MIN = -10, HCP_MAX = 54;        // a typed handicap outside this range is ignored (plus handicaps are negative)
export const RECENT_PARTNERS = 10;               // names kept for quick picking on the set-up sheet
export const TIE_EPS = 0.05;                     // scores or margins closer than this share a place
export const MODES = ['straight', 'handicap'];
// The four player colours, as names of existing colour tokens in index.html (used as var(--name)). Colour is never the only cue: the name is always shown with it.
export const COLOURS = ['flag', 'bad', 'good', 'muted'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const clone = (p) => JSON.parse(JSON.stringify(p));

// "12.4", "+2" (a plus handicap) or "" → a number or null
export function parseHcp(v) {
  if (isNum(v)) return v >= HCP_MIN && v <= HCP_MAX ? r1(v) : null;
  const s = String(v ?? '').trim().replace(',', '.'); if (!s) return null;
  const n = s.startsWith('+') ? -Number(s.slice(1)) : Number(s);
  return isNum(n) && n >= HCP_MIN && n <= HCP_MAX ? r1(n) : null;
}
export const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// The owner's handicap for a handicap game: their index, or failing that their practice level (the average practice handicap of the rated skills).
// A practice level is not a handicap; the screen says which one it is.
export function ownerLevel({ index = null, ratings = null } = {}) {
  if (isNum(index)) return { hcp: r1(index), basis: 'index' };
  const p = (ratings?.skills || []).map((s) => s.practice_hcp).filter(isNum);
  return p.length ? { hcp: r1(p.reduce((a, b) => a + b, 0) / p.length), basis: 'practice' } : { hcp: null, basis: null };
}

// Handicap scoring needs a benchmark for the game and a handicap for every player
export const canHandicap = (players, game) => !!game && B.hasLevel(game.id) && (players || []).length >= MIN_PLAYERS && players.every((p) => isNum(p.hcp));
// The score a golfer of this handicap posts in this game (bench.js), rounded to a tenth
export function targetFor(game, hcp, unitM) { if (!game || !isNum(hcp)) return null; const t = B.expectedFor(game.id, hcp, unitM); return isNum(t) ? r1(t) : null; }

// Why a list of players cannot start, or null when it can: 'few', 'many', 'name', 'same'
export function problem(players) {
  const ps = players || [];
  if (ps.length < MIN_PLAYERS) return 'few';
  if (ps.length > MAX_PLAYERS) return 'many';
  if (ps.some((p) => !cleanName(p.name))) return 'name';
  const names = ps.map((p) => cleanName(p.name).toLowerCase());
  return new Set(names).size === names.length ? null : 'same';
}

// newParty({ owner: {name, hcp}, guests: [{name, hcp}], mode, game, unitM, id }) → the party block for the draft, or null if it cannot start
export function newParty({ owner, guests = [], mode = 'straight', game, unitM = 0.9144, id = null } = {}) {
  if (!game || !G.GUIDED.has(game.id) || !owner) return null;
  const list = [{ ...owner, owner: true }, ...(guests || []).map((x) => ({ ...x, owner: false }))].map((p) => ({ name: cleanName(p.name), hcp: parseHcp(p.hcp), owner: !!p.owner }));
  if (problem(list)) return null;
  const hc = mode === 'handicap' && canHandicap(list, game);
  const players = list.map((p, i) => ({ ...p, colour: COLOURS[i % COLOURS.length], target: targetFor(game, p.hcp, unitM), answers: [], ...(G.isDistance(game) ? { balls: [] } : {}) }));
  return { id: id || `party${Date.now()}`, mode: hc ? 'handicap' : 'straight', players, log: [], seen: 0 };
}

// ------------------------------------------------------------------ stations and turns
// stations(steps) → [{ start, end, prompt }]: consecutive steps with the same prompt, end exclusive
export function stations(steps) {
  const out = [];
  (steps || []).forEach((s, i) => { const last = out[out.length - 1]; if (last && last.prompt === s.prompt) last.end = i + 1; else out.push({ start: i, end: i + 1, prompt: s.prompt }); });
  return out;
}
// The order players take a station in: it rotates by one each station
export function turnOrder(party, stationIndex) { const n = party.players.length, s = ((stationIndex % n) + n) % n; return party.players.map((_, k) => (s + k) % n); }
const playerDone = (game, list, p) => G.scoreOf(game, list, p.answers).done;
// Whose turn it is: { station, player } (indexes), or null when every player has finished
export function turn(party, game, list) {
  if (!party) return null;
  const sts = stations(list);
  for (let s = 0; s < sts.length; s++) for (const i of turnOrder(party, s)) { const p = party.players[i]; if (!playerDone(game, list, p) && p.answers.length < sts[s].end) return { station: s, player: i }; }
  return null;
}
export const finished = (party, game, list) => !turn(party, game, list);
// true when the player whose turn it is has not been shown their turn yet: the screen asks to pass the phone
export function needsHandover(party, game, list) { const t = turn(party, game, list); return !!t && t.player !== party.seen; }
export function handedOver(party, game, list) { const t = turn(party, game, list); return t ? { ...party, seen: t.player } : party; }

// One answer for the player whose turn it is. Returns a new party (the input is not changed), or the same party if the game is over.
export function play(party, game, list, value, ball = null) {
  const t = turn(party, game, list); if (!t) return party;
  const p = clone(party), me = p.players[t.player];
  me.answers.push(value); if (ball) (me.balls = me.balls || []).push(ball);
  p.log.push(t.player); return p;
}
// Undo the last answer, whoever gave it: across a hand-over the turn goes back to that player
export function undo(party) {
  if (!party?.log?.length) return party;
  const p = clone(party), i = p.log.pop(), me = p.players[i];
  me.answers.pop(); if (me.balls?.length > me.answers.length) me.balls.pop();
  return p;
}
// What a player still has to play in a station, for the hand-over screen: { prompt, left, open }
export function stationInfo(party, game, list, t = turn(party, game, list)) {
  if (!t) return null; const st = stations(list)[t.station], p = party.players[t.player];
  return { prompt: st.prompt, left: st.end - Math.max(st.start, p.answers.length), open: G.isOpen(game.id) };
}

// ------------------------------------------------------------------ standings
// How far past (or short of) a target a score is. Positive is good, sign flipped for lower-is-better games (the same rule as duels.js margin).
export const margin = (game, score, target) => (!isNum(score) || !isNum(target) ? null : r1(game?.better === 'lower' ? target - score : score - target));
// The target after k of n steps: games that add up (holes, hits, strokes) take their share of it; averages, longest-ball and streak games keep the whole target
function targetAt(game, list, target, k) {
  if (!isNum(target)) return null;
  if (G.isDistance(game) || G.isOpen(game.id) || k >= list.length) return target;
  return target * k / list.length;
}
// standings(party, game, unitM, { list, upTo }) → { rows, order, leaders, winner, final, mode }
//   rows (in player order): { i, name, colour, owner, hcp, score, target, margin, place }
//   upTo: count only the first upTo answers of every player (the live leader is judged after whole stations, so nobody is ahead just for going first)
//   winner: the winning player's index, 'tie' when places are shared at the top, null before the end
export function standings(party, game, unitM = 0.9144, { list = G.steps(game, { seed: 1, unitM }), upTo = null } = {}) {
  const lower = game.better === 'lower', hc = party.mode === 'handicap';
  const rows = party.players.map((p, i) => {
    const a = upTo === null ? p.answers : p.answers.slice(0, upTo), k = upTo === null ? list.length : Math.min(upTo, list.length);
    const score = a.length ? G.scoreOf(game, list, a).score : null;
    const tg = hc ? targetAt(game, list, p.target, k) : null, m = hc ? margin(game, score, tg) : null;
    const value = hc ? m : !isNum(score) ? null : lower ? -score : score;
    return { i, name: p.name, colour: p.colour, owner: !!p.owner, hcp: p.hcp, score: isNum(score) ? r1(score) : null, target: isNum(p.target) ? p.target : null, margin: m, value, place: null };
  });
  const ranked = rows.filter((r) => isNum(r.value)).sort((a, b) => b.value - a.value || a.i - b.i);
  ranked.forEach((r, k) => { r.place = k && Math.abs(r.value - ranked[k - 1].value) < TIE_EPS ? ranked[k - 1].place : k + 1; });
  const leaders = ranked.filter((r) => r.place === 1).map((r) => r.i), final = upTo === null && finished(party, game, list);
  return { rows: rows.map(({ value, ...r }) => r), order: ranked.map((r) => r.i), leaders, winner: final ? (leaders.length === 1 ? leaders[0] : leaders.length ? 'tie' : null) : null, final, mode: party.mode };
}
// How many steps every player has finished, counting whole stations only (a player whose game ended early, as in a streak, counts as through)
export function completedSteps(party, game, list) {
  let k = 0;
  for (const st of stations(list)) { if (party.players.every((p) => playerDone(game, list, p) || p.answers.length >= st.end)) k = st.end; else break; }
  return k;
}
// The leaders after the last station everyone has played: [] until the first station is done. A change of leader plays a sound on the game screen.
export function liveLeaders(party, game, unitM, list) {
  const k = completedSteps(party, game, list); if (!k) return [];
  return standings(party, game, unitM, { list, upTo: finished(party, game, list) ? null : k }).leaders;
}

// ------------------------------------------------------------------ what is saved
// The block stored on the owner's practice result. Guests' names and scores stay inside it, on this phone.
export function partyRecord(party, game, unitM, list) {
  const s = standings(party, game, unitM, { list });
  return { id: party.id, mode: party.mode, players: s.rows.map((r) => ({ name: r.name, hcp: r.hcp, score: r.score, ...(party.mode === 'handicap' ? { margin: r.margin } : {}), place: r.place, ...(r.owner ? { owner: true } : {}) })),
    winner: isNum(s.winner) ? s.rows[s.winner].name : null };
}
// The owner's answers as a plain draft, so the owner's score is worked out exactly like a solo game
export function ownerDraft(draft) {
  const o = draft?.party?.players?.find((p) => p.owner); if (!o) return draft;
  return { ...draft, answers: [...o.answers], ...(o.balls ? { balls: [...o.balls] } : {}) };
}
// The recent partners list (J().partners): newest first, one entry per name (case ignored), at most RECENT_PARTNERS
export function rememberPartners(partners, guests, date) {
  const seen = new Set(), out = [];
  for (const p of [...(guests || []).map((g) => ({ name: cleanName(g.name), hcp: parseHcp(g.hcp), last_played: date })), ...(partners || [])]) {
    const k = cleanName(p?.name).toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); out.push({ name: cleanName(p.name), hcp: isNum(p.hcp) ? p.hcp : null, last_played: p.last_played || date });
  }
  return out.slice(0, RECENT_PARTNERS);
}
