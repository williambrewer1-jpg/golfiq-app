// Unit tests for duels.js and the duel calls in cloud.js, against the fake Firebase (including a group on the old rules).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as D from '../duels.js';
import * as CL from '../cloud.js';
import * as LV from '../level.js';
const { makeFakeFirebase } = createRequire(import.meta.url)('./fake_firebase.js');
let n = 0; const t = async (name, f) => { await f(); n++; console.log('ok  ', name); };
const NOW = Date.parse('2026-11-14T02:00:00Z'), DAY = 86400000;
const hi = { id: 'putt-369', better: 'higher' }, lo = { id: 'chip-par18', better: 'lower' };
const me = { uid: 'u1', nick: 'Wills' }, sam = { uid: 'u2', nick: 'Sam' }, kim = { uid: 'u3', nick: 'Kim' }, al = { uid: 'u4', nick: 'Al' };
const mk = (o = {}) => D.newDuel({ me, them: sam, game: hi, seed: 4242, now: NOW, ...o });

await t('margin: score minus target, sign flipped for lower-is-better games', () => {
  assert.equal(D.margin(hi, 14, 12), 2); assert.equal(D.margin(hi, 10, 12), -2);
  assert.equal(D.margin(lo, 20, 24), 4); assert.equal(D.margin(lo, 27, 24), -3);
  assert.equal(D.margin(hi, 12.34, 10), 2.3); assert.equal(D.margin(hi, null, 10), null); assert.equal(D.margin(hi, 10, undefined), null);
});
await t('newDuel: the document has the planned fields, at most 20, defaults handicap / 7 days / open', () => {
  const d = mk();
  assert.deepEqual(Object.keys(d).sort(), ['a', 'b', 'better', 'created', 'deadline', 'from_nick', 'from_uid', 'game', 'mode', 'pressure', 'seed', 'stake', 'status', 'to_nick', 'to_uid', 'unitM', 'winner'].sort());
  assert.ok(Object.keys(d).length <= D.MAX_FIELDS);
  assert.equal(d.mode, 'handicap'); assert.equal(d.status, 'open'); assert.equal(d.a, null); assert.equal(d.b, null); assert.equal(d.winner, null); assert.equal(d.pressure, false);
  assert.equal(Date.parse(d.deadline) - Date.parse(d.created), 7 * DAY); assert.equal(d.seed, 4242); assert.equal(d.game, 'putt-369');
});
await t('newDuel: deadline 3 / 7 / 14 days only, mode handicap or straight, stake cut to 60 characters, better kept', () => {
  assert.equal(Date.parse(mk({ days: 3 }).deadline) - NOW, 3 * DAY); assert.equal(Date.parse(mk({ days: 14 }).deadline) - NOW, 14 * DAY); assert.equal(Date.parse(mk({ days: 5 }).deadline) - NOW, 7 * DAY);
  assert.equal(mk({ mode: 'straight' }).mode, 'straight'); assert.equal(mk({ mode: 'odd' }).mode, 'handicap');
  assert.equal(mk({ stake: 'x'.repeat(100) }).stake.length, D.STAKE_MAX); assert.equal(mk({ stake: '  Loser buys the coffees  ' }).stake, 'Loser buys the coffees');
  assert.equal(mk({ game: lo }).better, 'lower'); assert.equal(mk({ pressure: true }).pressure, true); assert.equal(mk({ unitM: 1 }).unitM, 1);
});
await t('newDuel: not against yourself, not without an opponent, a game or a seed', () => {
  assert.equal(mk({ them: me }), null); assert.equal(mk({ them: null }), null); assert.equal(mk({ game: null }), null); assert.equal(mk({ seed: 0 }), null); assert.equal(mk({ seed: 1.5 }), null);
});

// ---- the attempts
await t('one attempt only: the challenger can play at once, the opponent only after accepting, and a started attempt is spent', () => {
  const d = mk();
  assert.equal(D.canPlay(d, 'u1', NOW), true); assert.equal(D.canPlay(d, 'u2', NOW), false);          // not accepted yet
  assert.equal(D.canAnswer(d, 'u2', NOW), true); assert.equal(D.canAnswer(d, 'u1', NOW), false);
  const acc = { ...d, status: 'accepted' }; assert.equal(D.canPlay(acc, 'u2', NOW), true); assert.equal(D.canAnswer(acc, 'u2', NOW), false);
  assert.equal(D.canPlay(acc, 'u3', NOW), false, 'a stranger cannot play');
  const b = D.begin(acc, 'u2', NOW); assert.deepEqual(Object.keys(b), ['b']); assert.equal(b.b.started, new Date(NOW).toISOString());
  const started = { ...acc, ...b }; assert.equal(D.canPlay(started, 'u2', NOW), false, 'quitting forfeits: the attempt cannot be started again');
  assert.equal(D.begin(started, 'u2', NOW), null);
});
await t('no attempts after the deadline, or after a decline', () => {
  const d = { ...mk(), status: 'accepted' }, late = NOW + 8 * DAY;
  assert.equal(D.canPlay(d, 'u1', late), false); assert.equal(D.canPlay(d, 'u2', late), false); assert.equal(D.canPlay({ ...d, status: 'declined' }, 'u1', NOW), false);
});
await t('finish writes score, target, margin and time on a started attempt, once', () => {
  let d = { ...mk(), status: 'accepted' }; d = { ...d, ...D.begin(d, 'u1', NOW) };
  const f = D.finish(d, 'u1', { score: 14, target: 12 }, NOW + 1000); assert.deepEqual(f.a, { started: new Date(NOW).toISOString(), score: 14, target: 12, margin: 2, at: new Date(NOW + 1000).toISOString() });
  d = { ...d, ...f }; assert.equal(D.finish(d, 'u1', { score: 20, target: 12 }, NOW + 2000), null, 'a finished attempt cannot be overwritten');
  assert.equal(D.finish({ ...mk() }, 'u1', { score: 14, target: 12 }), null, 'an attempt that was never started cannot be finished');
  assert.equal(D.finish(d, 'u9', { score: 1 }), null);
  const lower = { ...mk({ game: lo }), a: { started: 'x' } }; assert.equal(D.finish(lower, 'u1', { score: 20, target: 24 }).a.margin, 4);
  assert.equal(D.finish({ ...mk(), a: { started: 'x' } }, 'u1', { score: 9, target: null }).a.margin, null);
});

// ---- who wins
const played = (o, a, b) => ({ ...mk(o), status: 'accepted', a: { score: a[0], target: a[1], margin: D.margin(o?.game || hi, a[0], a[1]), at: 'x' }, b: { score: b[0], target: b[1], margin: D.margin(o?.game || hi, b[0], b[1]), at: 'y' } });
await t('handicap duel: the bigger margin wins, so a 20-handicapper can beat a 5-handicapper', () => {
  const d = played({}, [12, 10], [18, 20]);       // challenger 12 vs target 10 (+2); opponent 18 vs target 20 (-2): the weaker player's raw score is lower but the margin is what counts
  assert.equal(D.winnerOf(d), 'a');
  const e = played({}, [20, 24], [13, 12]);       // challenger 20 vs 24 (-4), opponent 13 vs 12 (+1)
  assert.equal(D.winnerOf(e), 'b');
  const f = played({}, [9, 12], [14, 20]);        // opponent scored more but is further under their own target? a=-3, b=-6 -> a wins
  assert.equal(D.winnerOf(f), 'a');
});
await t('straight duel: the better raw score wins, whatever the targets are', () => {
  const d = played({ mode: 'straight' }, [12, 10], [18, 20]); assert.equal(D.winnerOf(d), 'b');
  assert.equal(D.winnerOf(played({ mode: 'straight' }, [20, 10], [18, 5])), 'a');
});
await t('lower-is-better games: handicap flips the sign, straight prefers the lower score', () => {
  const g = { game: lo };
  const hc = played({ ...g }, [22, 24], [27, 30]);     // a: +2 under target, b: +3 under target
  assert.equal(D.winnerOf(hc), 'b');
  const st = played({ ...g, mode: 'straight' }, [22, 24], [27, 30]); assert.equal(D.winnerOf(st), 'a');
});
await t('a draw: margins within 0.05 (handicap) or the same raw score (straight)', () => {
  assert.equal(D.winnerOf(played({}, [12, 10], [14, 12])), 'draw');
  assert.equal(D.winnerOf(played({ mode: 'straight' }, [12, 10], [12, 20])), 'draw');
  assert.equal(D.winnerOf(played({}, [12, 10], [14.04, 12])), 'draw');
  assert.equal(D.winnerOf(played({}, [12, 10], [14.3, 12])), 'b');
});
await t('a handicap duel with a missing target falls back to the raw scores for both', () => {
  const d = { ...played({}, [12, 10], [14, null]) }; assert.equal(d.b.margin, null); assert.equal(D.winnerOf(d), 'b');
});
await t('winnerOf needs both attempts finished', () => {
  const d = { ...mk(), a: { score: 5, margin: 1 }, b: { started: 'x' } }; assert.equal(D.winnerOf(d), null);
});

// ---- decide: finishing, forfeit, expiry
await t('decide: both played -> done with the winner; nothing to decide while one is still to play and the deadline has not passed', () => {
  assert.deepEqual(D.decide(played({}, [12, 10], [18, 20]), NOW + DAY), { status: 'done', winner: 'a' });
  const one = { ...mk(), status: 'accepted', a: { score: 5, margin: 1 } }; assert.equal(D.decide(one, NOW + DAY), null);
  assert.equal(D.decide(mk(), NOW + DAY), null);
});
await t('decide: past the deadline with one played, that player wins by forfeit', () => {
  const late = NOW + 8 * DAY;
  const a = { ...mk(), status: 'accepted', a: { score: 5, margin: 1 }, b: null }; assert.deepEqual(D.decide(a, late), { status: 'done', winner: 'a' });
  const b = { ...mk(), status: 'accepted', a: { started: 'x' }, b: { score: 5, margin: 1 } }; assert.deepEqual(D.decide(b, late), { status: 'done', winner: 'b' });
  assert.equal(D.isForfeit({ ...a, ...D.decide(a, late) }), true); assert.equal(D.isForfeit(played({}, [1, 1], [2, 1])), false);
});
await t('decide: past the deadline with nobody played, it expires quietly (an attempt that was started but not finished is not a score)', () => {
  const late = NOW + 8 * DAY;
  assert.deepEqual(D.decide(mk(), late), { status: 'expired', winner: null });
  assert.deepEqual(D.decide({ ...mk(), status: 'accepted', a: { started: 'x' }, b: { started: 'y' } }, late), { status: 'expired', winner: null });
});
await t('decide: finished duels are left alone; a declined one stays declined', () => {
  const late = NOW + 30 * DAY; for (const status of ['done', 'expired', 'declined']) assert.equal(D.decide({ ...mk(), status }, late), null);
});

// ---- hidden until played
await t('visible: the other player\'s attempt stays hidden until mine is finished, or the duel is over', () => {
  const d = { ...mk(), status: 'accepted', a: { score: 14, target: 12, margin: 2 }, b: { started: 'x' } };
  let v = D.visible(d, 'u2'); assert.equal(v.theirs, null); assert.equal(v.hidden, true); assert.deepEqual(v.mine, { started: 'x' });          // Sam started but has not finished: still hidden
  const d2 = { ...d, b: { score: 9, target: 12, margin: -3 } }; v = D.visible(d2, 'u2'); assert.equal(v.theirs.score, 14); assert.equal(v.hidden, false);
  v = D.visible(d, 'u1'); assert.deepEqual(v.theirs, { started: 'x' }, 'the challenger has played, so they see Sam has started; there is no score in it yet');
  const d3 = { ...mk(), status: 'accepted', a: { score: 14, margin: 2 }, b: null }; assert.equal(D.visible(d3, 'u1').theirs, null); assert.equal(D.visible(d3, 'u1').hidden, false);
  const done = { ...d, status: 'done', winner: 'a' }; assert.equal(D.visible(done, 'u2').theirs.score, 14); assert.equal(D.visible({ ...d, status: 'expired' }, 'u2').theirs.score, 14);
  assert.equal(D.visible(d, 'u9').side, null); assert.equal(D.visible(d, 'u9').theirs, null);
});

// ---- limits and records
await t('limits: at most three open duels per player and one open duel per pair', () => {
  const open = (from, to, o = {}) => ({ ...D.newDuel({ me: from, them: to, game: hi, seed: 7, now: NOW }), ...o });
  assert.deepEqual(D.canChallenge([], 'u1', 'u2', NOW), { ok: true, reason: null });
  assert.equal(D.canChallenge([open(me, sam)], 'u1', 'u2', NOW).reason, 'pair');
  assert.equal(D.canChallenge([open(sam, me)], 'u1', 'u2', NOW).reason, 'pair', 'a duel the other way round is the same pair');
  assert.equal(D.canChallenge([open(me, sam), open(me, kim), open(al, me)], 'u1', 'u5', NOW).reason, 'limit');
  assert.equal(D.canChallenge([open(me, sam), open(me, kim)], 'u1', 'u4', NOW).ok, true);
  assert.equal(D.canChallenge([], 'u1', 'u1', NOW).reason, 'self');
  // finished, declined and out-of-date duels do not count
  assert.equal(D.canChallenge([open(me, sam, { status: 'done' }), open(me, kim, { status: 'declined' }), open(me, al, { status: 'expired' })], 'u1', 'u2', NOW).ok, true);
  assert.equal(D.canChallenge([open(me, sam), open(me, kim), open(me, al)], 'u1', 'u5', NOW + 8 * DAY).ok, true, 'past the deadline they are not open any more');
  assert.equal(D.canReceive([open(sam, kim), open(al, kim), open(me, kim)], 'u3', NOW), false); assert.equal(D.canReceive([open(sam, kim)], 'u3', NOW), true);
});
await t('record: won–drawn–lost from finished duels, either way round; forfeit wins count, declined and expired do not', () => {
  const dn = (from, to, winner, o = {}) => ({ ...D.newDuel({ me: from, them: to, game: hi, seed: 9, now: NOW }), status: 'done', winner, ...o });
  const ds = [dn(me, sam, 'a'), dn(sam, me, 'a'), dn(me, sam, 'draw'), dn(sam, me, 'b'), dn(me, kim, 'a'), dn(me, sam, null, { status: 'expired' }), dn(me, sam, null, { status: 'declined' }), { ...dn(me, sam, null), status: 'open' }];
  const r = D.record(ds, 'u1', 'u2'); assert.deepEqual(r, { won: 2, drawn: 1, lost: 1 }); assert.equal(D.recordText(r), '2–1–1'); assert.equal(D.recordTotal(r), 4);
  assert.deepEqual(D.record(ds, 'u2', 'u1'), { won: 1, drawn: 1, lost: 2 }); assert.deepEqual(D.record(ds, 'u1', 'u3'), { won: 1, drawn: 0, lost: 0 }); assert.deepEqual(D.record(ds, 'u1', 'u9'), { won: 0, drawn: 0, lost: 0 });
});
await t('groups: incoming, to play, waiting and finished, newest first', () => {
  const mkd = (from, to, o = {}, now = NOW) => ({ ...D.newDuel({ me: from, them: to, game: hi, seed: 3, now }), ...o });
  const incoming = mkd(sam, me), accepted = mkd(me, kim, { status: 'accepted' }), waiting = mkd(me, al, { status: 'accepted', a: { score: 3, margin: 0 } }), fin = mkd(me, { uid: 'u6', nick: 'Jo' }, { status: 'done', winner: 'a' }), stranger = mkd(sam, kim);
  const g = D.groups([incoming, accepted, waiting, fin, stranger], 'u1', NOW);
  assert.deepEqual(g.incoming, [incoming]); assert.equal(g.toPlay.length, 1); assert.equal(g.toPlay[0].to_uid, 'u3'); assert.deepEqual(g.waiting, [waiting]); assert.deepEqual(g.finished, [fin]);
  assert.equal(D.daysLeft(incoming, NOW), 7); assert.equal(D.daysLeft(incoming, NOW + 6.5 * DAY), 1); assert.equal(D.daysLeft(incoming, NOW + 9 * DAY), 0);
});

// ---- rematch
await t('rematch: a new duel from me to the same opponent, same settings, a new seed, a fresh deadline', () => {
  const done = { ...mk({ mode: 'straight', pressure: true, stake: 'Coffees', days: 14 }), status: 'done', winner: 'b', a: { score: 1 }, b: { score: 2 } };
  const r = D.rematch(done, 'u1', { seed: 99, now: NOW + 3 * DAY }); assert.equal(r.from_uid, 'u1'); assert.equal(r.to_uid, 'u2'); assert.equal(r.seed, 99); assert.equal(r.status, 'open'); assert.equal(r.a, null); assert.equal(r.winner, null);
  assert.equal(r.mode, 'straight'); assert.equal(r.pressure, true); assert.equal(r.stake, 'Coffees'); assert.equal(r.game, done.game); assert.equal(Date.parse(r.deadline) - (NOW + 3 * DAY), 14 * DAY);
  const back = D.rematch(done, 'u2', { seed: 5, now: NOW }); assert.equal(back.from_uid, 'u2'); assert.equal(back.to_uid, 'u1', 'the opponent can ask for the rematch too');
  assert.notEqual(D.rematch(done, 'u1', { seed: 4242, now: NOW }).seed, done.seed, 'never the same seed again');
  assert.equal(D.rematch(done, 'u9', { seed: 5 }), null);
});

// ---- points: a duel played is 10 points and a duel won 15 more (level.js)
await t('pointsEntries: one entry per duel result on this phone; points are derived from them', () => {
  const res = [{ id: 'r1', game: 'putt-369', date: '2026-11-10', score: 12, duel: 'd1', duel_won: true }, { id: 'r2', game: 'putt-369', date: '2026-11-11', score: 10, duel: 'd2', duel_won: false }, { id: 'r3', game: 'putt-369', date: '2026-11-12', score: 9 }, { id: 'r4', game: 'putt-369', date: '2026-11-13', score: 9, duel: 'd3' }];
  const e = D.pointsEntries(res); assert.deepEqual(e, [{ date: '2026-11-10', won: true }, { date: '2026-11-11', won: false }, { date: '2026-11-13', won: false }]);
  const base = LV.playerLevel({ journal: {}, rounds: [], duels: [], games: [], today: '2026-11-14' }).points, withD = LV.playerLevel({ journal: {}, rounds: [], duels: e, games: [], today: '2026-11-14' }).points;
  assert.equal(withD - base, 3 * 10 + 15); assert.equal(D.pointsEntries(undefined).length, 0);
});

// ---- against the fake Firebase
async function group(opts) {
  const fb = makeFakeFirebase(opts); CL.setFetch(fb.fetch);
  const mkm = async (nick, code) => { const cfg = { apiKey: 'k', projectId: 'p' }; await CL.signIn(cfg); if (code) await CL.joinGroup(cfg, code, nick); else code = await CL.createGroup(cfg, 'Mates', nick); return { cfg, code }; };
  const a = await mkm('Wills'), b = await mkm('Sam', a.code), c = await mkm('Kim', a.code); return { fb, a, b, c, code: a.code };
}
const duelFor = (a, b, o = {}) => D.newDuel({ me: { uid: a.cfg.auth.uid, nick: 'W' }, them: { uid: b.cfg.auth.uid, nick: 'S' }, game: hi, seed: 321, now: Date.now(), ...o });
await t('a full duel in the fake Firebase: create, accept, both attempts, the final status written once', async () => {
  const { fb, a, b, code } = await group({}); const wu = a.cfg.auth.uid, su = b.cfg.auth.uid;
  const id = await CL.createDuel(a.cfg, code, duelFor(a, b));
  let all = await CL.listDuels(b.cfg, code); assert.equal(all.length, 1); assert.equal(all[0].id, id); assert.equal(all[0].status, 'open'); assert.equal(all[0].a, null);
  assert.equal(D.canAnswer(all[0], su), true);
  await CL.patchDuel(b.cfg, code, id, { status: 'accepted' });
  all = await CL.listDuels(a.cfg, code); assert.equal(all[0].status, 'accepted');
  // the challenger locks in and finishes
  let d = all[0]; await CL.patchDuel(a.cfg, code, id, D.begin(d, wu)); d = (await CL.listDuels(a.cfg, code))[0]; assert.equal(D.canPlay(d, wu), false);
  await CL.patchDuel(a.cfg, code, id, D.finish(d, wu, { score: 14, target: 12 })); d = (await CL.listDuels(b.cfg, code))[0];
  assert.equal(D.visible(d, su).theirs, null, 'Sam cannot see it before playing'); assert.equal(D.decide(d), null);
  await CL.patchDuel(b.cfg, code, id, D.begin(d, su)); d = (await CL.listDuels(b.cfg, code))[0];
  await CL.patchDuel(b.cfg, code, id, D.finish(d, su, { score: 9, target: 12 })); d = (await CL.listDuels(b.cfg, code))[0];
  const fin = D.decide(d); assert.deepEqual(fin, { status: 'done', winner: 'a' }); await CL.patchDuel(b.cfg, code, id, fin);
  d = (await CL.listDuels(a.cfg, code))[0]; assert.equal(d.status, 'done'); assert.equal(d.winner, 'a'); assert.equal(d.a.score, 14); assert.equal(d.b.score, 9); assert.equal(d.b.margin, -3);
  assert.deepEqual(D.record([d], wu, su), { won: 1, drawn: 0, lost: 0 }); assert.equal(D.visible(d, su).theirs.score, 14);
  assert.equal(D.decide(d), null, 'nothing more to write');
  assert.equal(fb.read(`groups/${code}/duels`).length, 1);
});
await t('a duel document stays within 20 fields even when both attempts are in', async () => {
  const { fb, a, b, code } = await group({}); const id = await CL.createDuel(a.cfg, code, duelFor(a, b));
  const d = (await CL.listDuels(a.cfg, code))[0]; assert.ok(Object.keys(d).filter((k) => k !== 'id').length <= D.MAX_FIELDS);
  assert.ok(Object.keys(fb.docs.get(`groups/${code}/duels/${id}`)).length <= 20);
});
await t('the rules (fake): only the challenger creates and deletes; either player updates; a third member cannot touch it; creation is capped at 20 fields', async () => {
  const { a, b, c, code } = await group({});
  await assert.rejects(() => CL.createDuel(b.cfg, code, duelFor(a, b)), (e) => e.status === 403, 'from_uid must be you');
  await assert.rejects(() => CL.createDuel(a.cfg, code, { ...duelFor(a, b), ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`x${i}`, i])) }), (e) => e.status === 403, 'more than 20 fields');
  const id = await CL.createDuel(a.cfg, code, duelFor(a, b));
  await CL.patchDuel(b.cfg, code, id, { status: 'accepted' });
  await assert.rejects(() => CL.patchDuel(c.cfg, code, id, { status: 'declined' }), (e) => e.status === 403);
  await assert.rejects(() => CL.removeDuel(b.cfg, code, id), (e) => e.status === 403);
  await CL.removeDuel(a.cfg, code, id); assert.equal((await CL.listDuels(a.cfg, code)).length, 0);
});
await t('two phones writing their own attempt do not overwrite each other', async () => {
  const { a, b, code } = await group({}); const id = await CL.createDuel(a.cfg, code, duelFor(a, b)); await CL.patchDuel(b.cfg, code, id, { status: 'accepted' });
  await Promise.all([CL.patchDuel(a.cfg, code, id, { a: { started: 'x', score: 3, target: 1, margin: 2, at: 'y' } }), CL.patchDuel(b.cfg, code, id, { b: { started: 'x', score: 4, target: 1, margin: 3, at: 'y' } })]);
  const d = (await CL.listDuels(a.cfg, code))[0]; assert.equal(d.a.score, 3); assert.equal(d.b.score, 4); assert.equal(d.status, 'accepted');
});
await t('old rules: listing, creating and updating duels are refused with status 403, and the rest of the group still works', async () => {
  const { a, code } = await group({ rules: 'old' });
  await assert.rejects(() => CL.listDuels(a.cfg, code), (e) => e.status === 403);
  await assert.rejects(() => CL.createDuel(a.cfg, code, { x: 1 }), (e) => e.status === 403);
  await assert.rejects(() => CL.patchDuel(a.cfg, code, 'abc', { status: 'accepted' }), (e) => e.status === 403);
  await CL.postScore(a.cfg, code, { game: 'g', score: 1, week: 'w' }); assert.equal((await CL.scoresWhere(a.cfg, code, 'week', 'w')).length, 1);
});
await t('the rules text still includes the duels path (and the rules version has not moved: this phase changes no rules)', () => {
  assert.match(CL.RULES, /match \/duels\/\{id\}/); assert.equal(CL.RULES_VERSION, 2);
});

console.log(`\n${n} duel tests passed`);
