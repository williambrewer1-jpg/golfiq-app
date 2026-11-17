// Unit tests for party.js: practice with a friend on one phone (first-run plan, parts C1 and C2). Run: node tests/party.test.mjs
import assert from 'node:assert/strict';
import * as P from '../party.js';
import * as G from '../games.js';
import * as F from '../features.js';
import * as B from '../bench.js';
import * as LG from '../league.js';
import * as FEEL from '../feel.js';
let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ', name); };
const game = (id) => F.DEFAULT_GAMES.find((g) => g.id === id);
const YD = 0.9144;
const list = (id, seed = 7) => G.steps(game(id), { seed, unitM: YD });
const owner = { name: 'Wills', hcp: 12 }, sam = { name: 'Sam', hcp: 20 }, kim = { name: 'Kim', hcp: 5 }, al = { name: 'Al', hcp: 28 };
const mk = (id, guests = [sam], o = {}) => P.newParty({ owner, guests, game: game(id), unitM: YD, id: 'p1', ...o });
// play every answer in `seq` for whoever's turn it is; seq can be a function of (player index, step index)
function playAll(p, id, f, l = list(id)) { let k = 0; while (P.turn(p, game(id), l) && k < 500) { const tt = P.turn(p, game(id), l), me = p.players[tt.player]; p = P.play(p, game(id), l, f(tt.player, me.answers.length)); k++; } return p; }

t('constants: up to four players, four colours from the existing tokens', () => {
  assert.equal(P.MAX_PLAYERS, 4); assert.equal(P.COLOURS.length, 4); assert.equal(new Set(P.COLOURS).size, 4);
  assert.deepEqual(P.COLOURS, ['flag', 'bad', 'good', 'muted']);
});
t('parseHcp: numbers, plus handicaps, blanks and out-of-range values', () => {
  assert.equal(P.parseHcp('12.4'), 12.4); assert.equal(P.parseHcp('+2'), -2); assert.equal(P.parseHcp('7,5'), 7.5); assert.equal(P.parseHcp(''), null);
  assert.equal(P.parseHcp('abc'), null); assert.equal(P.parseHcp('60'), null); assert.equal(P.parseHcp(18), 18); assert.equal(P.parseHcp(null), null);
});
t('ownerLevel: the index first, else the practice level (the average of the rated skills), else none', () => {
  assert.deepEqual(P.ownerLevel({ index: 11.14 }), { hcp: 11.1, basis: 'index' });
  assert.deepEqual(P.ownerLevel({ ratings: { skills: [{ practice_hcp: 20 }, { practice_hcp: 16 }, { practice_hcp: null }] } }), { hcp: 18, basis: 'practice' });
  assert.deepEqual(P.ownerLevel({ ratings: { skills: [{ practice_hcp: null }] } }), { hcp: null, basis: null });
});
t('newParty: the owner first, guests after, a colour each, targets from bench.js', () => {
  const p = mk('putt-369', [sam, kim]);
  assert.equal(p.players.length, 3); assert.equal(p.players[0].owner, true); assert.equal(p.players[1].owner, false);
  assert.deepEqual(p.players.map((x) => x.colour), ['flag', 'bad', 'good']);
  assert.equal(p.players[1].target, Math.round(B.expectedFor('putt-369', 20) * 10) / 10);
  assert.deepEqual(p.log, []); assert.equal(p.seen, 0); assert.equal(p.mode, 'straight');
  assert.ok(Array.isArray(mk('range-driver').players[0].balls)); assert.equal(mk('putt-369').players[0].balls, undefined);
});
t('newParty: one to three guests, a name for everyone, no two the same', () => {
  assert.equal(mk('putt-369', []), null); assert.equal(mk('putt-369', [sam, kim, al, { name: 'Jo' }]), null);
  assert.equal(mk('putt-369', [{ name: '  ' }]), null); assert.equal(mk('putt-369', [{ name: 'wills' }]), null);
  assert.ok(mk('putt-369', [sam, kim, al])); assert.equal(P.problem([owner]), 'few'); assert.equal(P.problem([owner, { name: 'WILLS ' }]), 'same');
  assert.equal(mk('putt-369', [{ name: 'A very long name that goes on and on' }]).players[1].name.length, P.NAME_MAX);
  assert.equal(P.newParty({ owner, guests: [sam], game: game('combine') }), null);                      // not a guided game
});
t('newParty: handicap scoring only when the game has a benchmark and every player has a handicap', () => {
  assert.equal(mk('putt-369', [sam], { mode: 'handicap' }).mode, 'handicap');
  assert.equal(mk('putt-369', [{ name: 'Sam' }], { mode: 'handicap' }).mode, 'straight');
  assert.equal(mk('range-speed', [sam], { mode: 'handicap' }).mode, 'straight');                   // Max out has no benchmark by handicap
  assert.equal(P.canHandicap([owner, sam].map((x) => ({ ...x, hcp: P.parseHcp(x.hcp) })), game('putt-369')), true);
  assert.equal(P.canHandicap([owner, { name: 'Sam', hcp: null }], game('putt-369')), false);
});
t('stations: consecutive steps with the same prompt', () => {
  assert.deepEqual(P.stations(list('putt-369')).map((s) => [s.start, s.end, s.prompt]), [[0, 3, '3 ft'], [3, 6, '6 ft'], [6, 9, '9 ft']]);
  assert.equal(P.stations(list('putt-lag')).length, 10);                     // every putt is from a new distance
  assert.equal(P.stations(list('chip-zone')).length, 1);                     // ten chips at the same towel
  assert.deepEqual(P.stations([]), []);
});
t('turnOrder: the order rotates by one each station', () => {
  const p = mk('putt-369', [sam, kim]);
  assert.deepEqual(P.turnOrder(p, 0), [0, 1, 2]); assert.deepEqual(P.turnOrder(p, 1), [1, 2, 0]); assert.deepEqual(P.turnOrder(p, 2), [2, 0, 1]); assert.deepEqual(P.turnOrder(p, 3), [0, 1, 2]);
});
t('turn: one player plays a whole station, then the phone passes; rotation each station', () => {
  const id = 'putt-369', g = game(id), l = list(id); let p = mk(id, [sam]); const who = [];
  while (P.turn(p, g, l)) { who.push(P.turn(p, g, l).player); p = P.play(p, g, l, 1); }
  assert.deepEqual(who, [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
  assert.equal(P.finished(p, g, l), true); assert.equal(p.log.length, 18);
  assert.deepEqual(p.players[0].answers.length, 9); assert.deepEqual(p.players[1].answers.length, 9);
});
t('turn: a streak game hands over when a player misses, and the others play on', () => {
  const id = 'putt-streak', g = game(id), l = list(id); let p = mk(id, [sam]);
  p = P.play(p, g, l, 1); p = P.play(p, g, l, 0);                            // Wills: 1 then out
  assert.equal(P.turn(p, g, l).player, 1); p = P.play(p, g, l, 1); p = P.play(p, g, l, 1); p = P.play(p, g, l, 1); p = P.play(p, g, l, 0);
  assert.equal(P.finished(p, g, l), true);
  const s = P.standings(p, g, YD, { list: l }); assert.deepEqual(s.rows.map((r) => r.score), [1, 3]); assert.equal(s.winner, 1);
});
t('play / undo: pure, and undo steps back across a hand-over', () => {
  const id = 'putt-369', g = game(id), l = list(id); let p = mk(id, [sam]);
  const p0 = p; p = P.play(p, g, l, 1); assert.deepEqual(p0.players[0].answers, []);              // the input is not changed
  p = P.play(p, g, l, 0); p = P.play(p, g, l, 1);
  assert.equal(P.turn(p, g, l).player, 1); assert.equal(P.needsHandover(p, g, l), true);
  p = P.handedOver(p, g, l); assert.equal(p.seen, 1); assert.equal(P.needsHandover(p, g, l), false);
  p = P.play(p, g, l, 1); assert.deepEqual(p.players[1].answers, [1]);
  p = P.undo(p); assert.deepEqual(p.players[1].answers, []); assert.equal(P.turn(p, g, l).player, 1);
  p = P.undo(p); assert.deepEqual(p.players[0].answers, [1, 0]); assert.equal(P.turn(p, g, l).player, 0);
  assert.equal(P.needsHandover(p, g, l), true);                              // the phone goes back to Wills
  const empty = mk(id, [sam]); assert.equal(P.undo(empty), empty);
});
t('play / undo: distance games keep each player\'s balls with their answers', () => {
  const id = 'range-driver', g = game(id), l = list(id); let p = mk(id, [sam]);
  p = P.play(p, g, l, 250, { d: 250, r: 'f', a: 0 }); assert.equal(p.players[0].balls.length, 1);
  p = P.undo(p); assert.equal(p.players[0].balls.length, 0); assert.equal(p.players[0].answers.length, 0);
});
t('stationInfo: what the next player has left at this station', () => {
  const id = 'putt-369', g = game(id), l = list(id); let p = mk(id, [sam]);
  assert.deepEqual(P.stationInfo(p, g, l), { prompt: '3 ft', left: 3, open: false });
  p = P.play(p, g, l, 1); assert.equal(P.stationInfo(p, g, l).left, 2);
});
t('standings, straight: best raw score wins; places and leader', () => {
  const id = 'putt-369', g = game(id), l = list(id);
  const p = playAll(mk(id, [sam, kim]), id, (i, k) => (i === 1 ? 1 : k % 2));       // Sam holes everything
  const s = P.standings(p, g, YD, { list: l });
  assert.deepEqual(s.rows.map((r) => r.score), [4, 9, 4]); assert.deepEqual(s.rows.map((r) => r.place), [2, 1, 2]);
  assert.deepEqual(s.order, [1, 0, 2]); assert.equal(s.winner, 1); assert.equal(s.final, true); assert.deepEqual(s.leaders, [1]);
});
t('standings, straight: lower is better for stroke games', () => {
  const id = 'putt-par18', g = game(id), l = list(id);
  const p = playAll(mk(id, [sam]), id, (i) => (i === 0 ? 2 : 3));
  const s = P.standings(p, g, YD, { list: l }); assert.deepEqual(s.rows.map((r) => r.score), [18, 27]); assert.equal(s.winner, 0);
});
t('standings, handicap: the biggest margin over your own target wins, also when fewer is better', () => {
  const id = 'putt-369', g = game(id), l = list(id);
  // Kim (5) needs about 5.3, Sam (20) about 4.3: Sam scores 5 (margin +0.7), Kim scores 5 too (margin -0.3)
  const p = playAll(mk(id, [sam, kim], { mode: 'handicap' }), id, (i, k) => (i === 0 ? 0 : k < 5 ? 1 : 0));
  const s = P.standings(p, g, YD, { list: l }), tS = p.players[1].target, tK = p.players[2].target;
  assert.equal(s.rows[1].margin, Math.round((5 - tS) * 10) / 10); assert.equal(s.rows[2].margin, Math.round((5 - tK) * 10) / 10);
  assert.equal(s.winner, 1); assert.equal(s.rows[0].place, 3);
  const id2 = 'putt-par18', l2 = list(id2);                                   // the 28-handicapper takes 22, the 12 takes 18: compare each with their own target
  const q = playAll(mk(id2, [al], { mode: 'handicap' }), id2, (i, k) => (i === 0 ? 2 : k < 4 ? 3 : 2));
  const s2 = P.standings(q, game(id2), YD, { list: l2 });
  assert.equal(s2.rows[0].margin, Math.round((q.players[0].target - 18) * 10) / 10); assert.equal(s2.rows[1].margin, Math.round((q.players[1].target - 22) * 10) / 10);
  assert.equal(s2.winner, s2.rows[0].margin > s2.rows[1].margin ? 0 : 1);
});
t('standings: a tie shares the place, and a shared first place is a tie', () => {
  const id = 'putt-369', g = game(id), l = list(id);
  const p = playAll(mk(id, [sam, kim]), id, (i, k) => (i === 2 ? 0 : k % 2));
  const s = P.standings(p, g, YD, { list: l });
  assert.deepEqual(s.rows.map((r) => r.place), [1, 1, 3]); assert.equal(s.winner, 'tie'); assert.deepEqual(s.leaders, [0, 1]);
});
t('live leader: judged after whole stations only, so going first is no advantage', () => {
  const id = 'putt-369', g = game(id), l = list(id); let p = mk(id, [sam]);
  for (let k = 0; k < 3; k++) p = P.play(p, g, l, 1);                         // Wills holes three
  assert.deepEqual(P.liveLeaders(p, g, YD, l), []);                           // Sam has not played the station yet
  p = P.play(p, g, l, 1); p = P.play(p, g, l, 1); p = P.play(p, g, l, 0);       // Sam: two of three
  assert.equal(P.completedSteps(p, g, l), 3); assert.deepEqual(P.liveLeaders(p, g, YD, l), [0]);
  p = P.play(p, g, l, 1); p = P.play(p, g, l, 1); p = P.play(p, g, l, 1);       // Sam's 6 ft: three of three (Sam goes first at station 2)
  assert.deepEqual(P.liveLeaders(p, g, YD, l), [0]);                           // Wills has not played 6 ft yet, so it is still judged on 3 ft
  p = P.play(p, g, l, 0); p = P.play(p, g, l, 0); p = P.play(p, g, l, 0);
  assert.deepEqual(P.liveLeaders(p, g, YD, l), [1]);                           // after 6 ft: Wills 3, Sam 5
});
t('live leader, handicap: the target is shared out over the steps played', () => {
  const id = 'putt-369', g = game(id), l = list(id); let p = mk(id, [kim], { mode: 'handicap' });
  for (let k = 0; k < 6; k++) p = P.play(p, g, l, k < 3 ? 1 : k < 5 ? 1 : 0);
  const s = P.standings(p, g, YD, { list: l, upTo: 3 }), tW = p.players[0].target, tK = p.players[1].target;
  assert.equal(s.rows[0].margin, Math.round((3 - tW / 3) * 10) / 10); assert.equal(s.rows[1].margin, Math.round((2 - tK / 3) * 10) / 10);
});
t('partyRecord: every player\'s name, handicap, score, place; the owner marked; winner by name', () => {
  const id = 'putt-369', g = game(id), l = list(id);
  const p = playAll(mk(id, [sam], { mode: 'handicap' }), id, (i) => (i === 0 ? 1 : 0));
  const r = P.partyRecord(p, g, YD, l);
  assert.equal(r.id, 'p1'); assert.equal(r.mode, 'handicap'); assert.equal(r.winner, 'Wills');
  assert.deepEqual(r.players.map((x) => [x.name, x.hcp, x.score, x.place, !!x.owner]), [['Wills', 12, 9, 1, true], ['Sam', 20, 0, 2, false]]);
  assert.ok(Number.isFinite(r.players[0].margin));
  const st = P.partyRecord(playAll(mk(id, [sam]), id, () => 1), g, YD, l); assert.equal(st.winner, null); assert.equal('margin' in st.players[0], false);
});
t('ownerDraft: the owner\'s answers make a normal result, with the same score as a solo game', () => {
  const id = 'range-driver', g = game(id), l = list(id); let p = mk(id, [sam]);
  p = playAll(p, id, (i, k) => (i === 0 ? 240 + k : 200));
  p.players.forEach((pl) => { pl.balls = pl.answers.map((d) => ({ d, r: 'f', a: 0 })); });
  const d = { ...G.newDraft(g, { seed: 7, unitM: YD }), party: p }, od = P.ownerDraft(d), res = G.resultFromDraft(od, g, { date: '2026-11-16', id: 'r1' });
  assert.equal(res.score, G.scoreOf(g, l, p.players[0].answers).score); assert.equal(res.balls.length, 10); assert.equal(res.avg_dist, 244.5);
  assert.deepEqual(d.answers, []);                                            // the draft itself is not changed
});
t('rememberPartners: newest first, one per name, at most ten', () => {
  let ps = P.rememberPartners([], [sam, kim], '2026-11-10');
  ps = P.rememberPartners(ps, [{ name: 'sam', hcp: '18' }], '2026-11-16');
  assert.deepEqual(ps.map((x) => [x.name, x.hcp, x.last_played]), [['sam', 18, '2026-11-16'], ['Kim', 5, '2026-11-10']]);
  for (let k = 0; k < 12; k++) ps = P.rememberPartners(ps, [{ name: `P${k}` }], '2026-11-16');
  assert.equal(ps.length, P.RECENT_PARTNERS); assert.equal(ps[0].name, 'P11');
});
t('privacy: the score shared with friends carries none of the party (no guest names or scores)', () => {
  const id = 'putt-369', g = game(id), l = list(id), p = playAll(mk(id, [sam]), id, () => 1);
  const res = { ...G.resultFromDraft(P.ownerDraft({ ...G.newDraft(g, { seed: 7 }), party: p }), g, { date: '2026-11-16' }), party: P.partyRecord(p, g, YD, l) };
  const shared = LG.shareExtras(res, { hit: true, tier: 'gold' }), text = JSON.stringify(shared);
  assert.equal('party' in shared, false); assert.ok(!text.includes('Sam'));
});

// ------------------------------------------------------------------ phase C2: after the game
const rec = (players, winner, x = {}) => ({ mode: 'straight', players, winner, ...x });
const res = (id, date, party) => ({ id, game: 'putt-369', date, score: 5, mode: 'guided', party });
const pw = (o, s, opl, spl) => rec([{ name: 'Wills', hcp: 12, score: o, place: opl, owner: true }, { name: 'Sam', hcp: 20, score: s, place: spl }], opl < spl ? 'Wills' : spl < opl ? 'Sam' : null);
t('regroup: the same players and handicaps for a rematch; handicap scoring kept only where the game has a benchmark', () => {
  const p = mk('putt-369', [sam], { mode: 'handicap' }), done = playAll(p, 'putt-369', (i) => (i ? 0 : 1)), r = P.partyRecord(done, game('putt-369'), YD, list('putt-369'));
  const again = P.regroup(r, game('putt-369'), YD);
  assert.deepEqual(again.players.map((x) => [x.name, x.hcp, x.owner, x.answers.length]), [['Wills', 12, true, 0], ['Sam', 20, false, 0]]);
  assert.equal(again.mode, 'handicap'); assert.equal(again.log.length, 0); assert.ok(again.id);
  const own = F.DEFAULT_GAMES.find((g) => G.GUIDED.has(g.id) && !B.hasLevel(g.id));
  if (own) assert.equal(P.regroup(r, own, YD).mode, 'straight', 'no benchmark: straight scoring');
  assert.equal(P.regroup({ players: [{ name: 'Sam' }] }, game('putt-369'), YD), null, 'no owner in the record: no group');
});
t('groupKey: the same group whatever the order or letter case', () => {
  assert.equal(P.groupKey([{ name: 'Wills' }, { name: 'sam ' }]), P.groupKey([{ name: 'Sam' }, { name: 'wills' }]));
  assert.notEqual(P.groupKey([{ name: 'Wills' }, { name: 'Sam' }]), P.groupKey([{ name: 'Wills' }, { name: 'Sam' }, { name: 'Kim' }]));
});
t('series: shows from the second game of the day with the same group, counts wins up to this game, ties apart', () => {
  const rs = [res('a', '2026-11-17', pw(7, 5, 1, 2)), res('x', '2026-11-17', rec([{ name: 'Wills', place: 1, owner: true }, { name: 'Kim', place: 2 }], 'Wills')),
    res('b', '2026-11-17', pw(4, 6, 2, 1)), res('c', '2026-11-17', pw(6, 6, 1, 1)), res('d', '2026-11-17', pw(8, 2, 1, 2)), res('e', '2026-11-18', pw(8, 2, 1, 2))];
  assert.equal(P.series(rs, 'a'), null, 'the first game is not a series');
  assert.deepEqual(P.series(rs, 'b'), { games: 2, ties: 0, rows: [{ name: 'Wills', wins: 1 }, { name: 'Sam', wins: 1 }] });
  assert.deepEqual(P.series(rs, 'd'), { games: 4, ties: 1, rows: [{ name: 'Wills', wins: 2 }, { name: 'Sam', wins: 1 }] });
  assert.equal(P.series(rs, 'e'), null, 'a new day starts again');
  assert.deepEqual(P.series(rs, 'e', { min: 1 }), { games: 1, ties: 0, rows: [{ name: 'Wills', wins: 1 }, { name: 'Sam', wins: 0 }] }, 'a session summary asks for the series from one game'); assert.equal(P.series(rs, 'x'), null, 'a different group'); assert.equal(P.series(rs, 'nope'), null);
  assert.equal(FEEL.COPY.party.series(P.series(rs, 'd').rows, 1), 'Today: Wills 2 – 1 Sam (1 tied)');
  assert.equal(FEEL.COPY.party.series([{ name: 'Kim', wins: 2 }, { name: 'Wills', wins: 1 }, { name: 'Sam', wins: 0 }], 0), 'Today: Kim 2 · Wills 1 · Sam 0');
});
t('record: won, drawn and lost against one partner, from every saved game together, by places', () => {
  const four = rec([{ name: 'Wills', place: 2, owner: true }, { name: 'Sam', place: 3 }, { name: 'Kim', place: 1 }, { name: 'Al', place: 2 }], 'Kim');
  const rs = [res('a', '2026-11-01', pw(7, 5, 1, 2)), res('b', '2026-11-02', pw(4, 6, 2, 1)), res('c', '2026-11-03', pw(6, 6, 1, 1)), res('d', '2026-11-04', four), { id: 'solo', game: 'putt-369', date: '2026-11-04', score: 3 }];
  assert.deepEqual(P.record(rs, 'sam'), { won: 2, drawn: 1, lost: 1 }, 'in a game of four, beating Sam on places is a win');
  assert.deepEqual(P.record(rs, 'Kim'), { won: 0, drawn: 0, lost: 1 }); assert.deepEqual(P.record(rs, 'Al'), { won: 0, drawn: 1, lost: 0 });
  assert.deepEqual(P.record(rs, 'Nobody'), { won: 0, drawn: 0, lost: 0 }); assert.equal(P.recordTotal(P.record(rs, 'Sam')), 4); assert.deepEqual(P.record(rs, ''), { won: 0, drawn: 0, lost: 0 });
  assert.equal(FEEL.COPY.party.record('Sam', { won: 2, drawn: 1, lost: 1 }), 'Against Sam: won 2 · drawn 1 · lost 1');
});
t('share text: places, scores, margins in a handicap game, the winner and the series; nothing but what is on the podium', () => {
  const txt = FEEL.COPY.party.shareText({ game: 'Putting 3-6-9', rows: [{ name: 'Sam', score: 7, place: 1, margin: 1.5 }, { name: 'Wills', score: 5, place: 2, margin: -0.5 }], winner: 'Sam', hc: true, series: 'Today: Sam 2 – 1 Wills' });
  assert.equal(txt, 'Putting 3-6-9 on BreakingPar\n1st Sam 7 (+1.5 on target)\n2nd Wills 5 (-0.5 on target)\nSam wins.\nToday: Sam 2 – 1 Wills');
  assert.ok(FEEL.COPY.party.shareText({ game: 'X', rows: [{ name: 'A', score: 3, place: 1 }, { name: 'B', score: 3, place: 1 }], winner: null, hc: false }).endsWith('1st B 3\nA tie at the top.'));
  assert.equal(FEEL.COPY.party.send(['Sam']), 'Send Sam the result'); assert.equal(FEEL.COPY.party.send(['Sam', 'Kim']), 'Send the result');
});
console.log(`\n${n} party tests passed`);
