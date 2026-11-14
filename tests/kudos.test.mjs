// Unit tests for kudos.js and the kudos calls in cloud.js, against the fake Firebase (including a group on the old rules).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as K from '../kudos.js';
import * as CL from '../cloud.js';
import * as LG from '../league.js';
const { makeFakeFirebase } = createRequire(import.meta.url)('./fake_firebase.js');
let n = 0; const t = async (name, f) => { await f(); n++; console.log('ok  ', name); };
const score = { id: 's1', uid: 'uid-2', nick: 'Sam', week: '2026-W46', game_name: 'Up & down', score: 9 };

await t('give() builds a small document with only the listed fields', () => {
  const d = K.give({ score, uid: 'uid-1', nick: 'Wills', kind: 'fire', now: new Date('2026-11-14T01:00:00Z') });
  assert.deepEqual(d, { score_id: 's1', to_uid: 'uid-2', from_uid: 'uid-1', from_nick: 'Wills', kind: 'fire', at: '2026-11-14T01:00:00.000Z', week: '2026-W46' });
  assert.ok(Object.keys(d).length <= K.MAX_FIELDS);
});
await t('you cannot react to your own score, or send an unknown kind or a score with no id', () => {
  assert.equal(K.give({ score, uid: 'uid-2', nick: 'Sam', kind: 'clap' }), null);
  assert.equal(K.give({ score, uid: 'uid-1', nick: 'W', kind: 'heart' }), null);
  assert.equal(K.give({ score: { ...score, id: undefined }, uid: 'uid-1', nick: 'W', kind: 'clap' }), null);
});
await t('the document id is score id + from uid, so there is one reaction each', () => assert.equal(K.docId('s1', 'uid-1'), 's1_uid-1'));
await t('counts per kind, total and mine', () => {
  const ks = [{ score_id: 's1', from_uid: 'a', kind: 'clap' }, { score_id: 's1', from_uid: 'b', kind: 'clap' }, { score_id: 's1', from_uid: 'me', kind: 'flag' }, { score_id: 's2', from_uid: 'a', kind: 'fire' }];
  assert.deepEqual(K.counts(ks, 's1', 'me'), { clap: 2, fire: 0, flag: 1, total: 3, mine: 'flag' });
  assert.deepEqual(K.counts(ks, 's3', 'me'), { clap: 0, fire: 0, flag: 0, total: 0, mine: null });
});
await t('tap: give, take back, or switch', () => {
  assert.equal(K.tap([], 's1', 'me', 'clap'), 'give');
  const ks = [{ score_id: 's1', from_uid: 'me', kind: 'clap' }];
  assert.equal(K.tap(ks, 's1', 'me', 'clap'), 'take'); assert.equal(K.tap(ks, 's1', 'me', 'fire'), 'switch');
});
await t('apply keeps one reaction per person per score', () => {
  const d = { score_id: 's1', from_uid: 'me', kind: 'fire' };
  let ks = K.apply([{ score_id: 's1', from_uid: 'me', kind: 'clap' }, { score_id: 's1', from_uid: 'b', kind: 'clap' }], d, 'give');
  assert.equal(ks.length, 2); assert.equal(K.counts(ks, 's1', 'me').mine, 'fire');
  ks = K.apply(ks, d, 'take'); assert.equal(K.counts(ks, 's1', 'me').mine, null); assert.equal(ks.length, 1);
});
const mine = [{ id: 's9', uid: 'me', game_name: 'Up & down', score: 9 }, { id: 's8', uid: 'me', game_name: 'Putt 369', score: 12 }];
await t('incoming: only reactions to me, newer than seen, never my own', () => {
  const ks = [{ score_id: 's9', to_uid: 'me', from_uid: 'a', from_nick: 'Sam', kind: 'clap', at: '2026-11-14T02:00:00Z' }, { score_id: 's9', to_uid: 'me', from_uid: 'b', from_nick: 'Kim', kind: 'fire', at: '2026-11-14T03:00:00Z' },
    { score_id: 's9', to_uid: 'me', from_uid: 'c', from_nick: 'Al', kind: 'flag', at: '2026-11-14T04:00:00Z' }, { score_id: 's8', to_uid: 'me', from_uid: 'a', from_nick: 'Sam', kind: 'clap', at: '2026-11-13T01:00:00Z' },
    { score_id: 'x', to_uid: 'other', from_uid: 'a', from_nick: 'Sam', kind: 'clap', at: '2026-11-14T05:00:00Z' }, { score_id: 's9', to_uid: 'me', from_uid: 'me', from_nick: 'Me', kind: 'clap', at: '2026-11-14T06:00:00Z' }];
  const all = K.incoming(ks, 'me', mine, null); assert.equal(all.items.length, 2); assert.equal(all.items[0].score_id, 's9'); assert.equal(all.items[0].count, 3);
  assert.deepEqual(all.items[0].nicks, ['Sam', 'Kim', 'Al']); assert.equal(all.items[0].game_name, 'Up & down'); assert.equal(all.items[0].score, 9);
  const some = K.incoming(ks, 'me', mine, '2026-11-14T02:30:00Z'); assert.equal(some.items.length, 1); assert.deepEqual(some.items[0].nicks, ['Kim', 'Al']); assert.equal(some.latest, '2026-11-14T04:00:00Z');
  assert.equal(K.incoming(ks, 'me', mine, '2026-11-14T04:00:00Z').items.length, 0);
});
await t('who(): one name, two names, or one and "N others"', () => {
  assert.deepEqual(K.who({ nicks: ['Sam'] }), { who: ['Sam'], others: 0 }); assert.deepEqual(K.who({ nicks: ['Sam', 'Kim'] }), { who: ['Sam', 'Kim'], others: 0 });
  assert.deepEqual(K.who({ nicks: ['Sam', 'Kim', 'Al'] }), { who: ['Sam'], others: 2 });
});
await t('newest() finds the latest reaction time', () => { assert.equal(K.newest([{ at: 'b' }, { at: 'c' }, { at: 'a' }]), 'c'); assert.equal(K.newest([]), null); });
await t('league rows carry the last score used, so they can be reacted to', () => {
  const rows = LG.league([{ id: 'a1', uid: 'u', nick: 'Sam', date: '2026-11-10', hit: true }, { id: 'a2', uid: 'u', nick: 'Sam', date: '2026-11-12', hit: false }]);
  assert.equal(rows[0].score_id, 'a2');
});

// ---- against the fake Firebase
async function group(opts) {
  const fb = makeFakeFirebase(opts); CL.setFetch(fb.fetch);
  const mk = async (nick, code) => { const cfg = { apiKey: 'k', projectId: 'p' }; await CL.signIn(cfg); if (code) await CL.joinGroup(cfg, code, nick); else code = await CL.createGroup(cfg, 'Mates', nick); return { cfg, code }; };
  const a = await mk('Wills'), b = await mk('Sam', a.code); return { fb, a, b, code: a.code };
}
await t('give, read back by week, take back (fake Firebase, new rules)', async () => {
  const { fb, a, b, code } = await group({});
  const sid = (await CL.postScore(b.cfg, code, { game: 'g', game_name: 'Up & down', score: 9, week: '2026-W46', nick: 'Sam' })).id;
  const doc = K.give({ score: { id: sid, uid: b.cfg.auth.uid, week: '2026-W46' }, uid: a.cfg.auth.uid, nick: 'Wills', kind: 'clap' });
  await CL.giveKudos(a.cfg, code, doc);
  assert.equal(fb.read(`groups/${code}/kudos`).length, 1);
  const got = await CL.kudosWhere(b.cfg, code, '2026-W46'); assert.equal(got.length, 1); assert.equal(got[0].kind, 'clap'); assert.equal(got[0].id, `${sid}_${a.cfg.auth.uid}`);
  assert.equal((await CL.kudosWhere(b.cfg, code, '2026-W45')).length, 0);
  await CL.takeKudos(a.cfg, code, sid, a.cfg.auth.uid); assert.equal(fb.read(`groups/${code}/kudos`).length, 0);
});
await t('switching a reaction is a delete then a create (the rules have no update)', async () => {
  const { fb, a, b, code } = await group({});
  const sid = (await CL.postScore(b.cfg, code, { game: 'g', score: 9, week: '2026-W46', nick: 'Sam' })).id, base = { score: { id: sid, uid: b.cfg.auth.uid, week: '2026-W46' }, uid: a.cfg.auth.uid, nick: 'Wills' };
  await CL.giveKudos(a.cfg, code, K.give({ ...base, kind: 'clap' }));
  await assert.rejects(() => CL.giveKudos(a.cfg, code, K.give({ ...base, kind: 'fire' })), (e) => e.status === 403);           // an overwrite is refused
  await CL.takeKudos(a.cfg, code, sid, a.cfg.auth.uid); await CL.giveKudos(a.cfg, code, K.give({ ...base, kind: 'fire' }));
  assert.equal(fb.read(`groups/${code}/kudos`)[0].kind, 'fire');
});
await t('the rules refuse a document with the wrong id or too many fields', async () => {
  const { a, code } = await group({});
  await assert.rejects(() => CL.setDoc(a.cfg, `groups/${code}/kudos/not_the_id`, { score_id: 's1', to_uid: 'x', from_uid: a.cfg.auth.uid, from_nick: 'W', kind: 'clap', at: 'a', week: 'w' }), (e) => e.status === 403);
  await assert.rejects(() => CL.giveKudos(a.cfg, code, { score_id: 's1', from_uid: a.cfg.auth.uid, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }), (e) => e.status === 403);
});
await t('with the old rules the kudos paths answer 403 and the scores still work', async () => {
  const { a, b, code } = await group({ rules: 'old' });
  const sid = (await CL.postScore(b.cfg, code, { game: 'g', score: 9, week: '2026-W46', nick: 'Sam' })).id;
  assert.equal((await CL.scoresWhere(a.cfg, code, 'week', '2026-W46')).length, 1);
  await assert.rejects(() => CL.kudosWhere(a.cfg, code, '2026-W46'), (e) => e.status === 403);
  await assert.rejects(() => CL.giveKudos(a.cfg, code, K.give({ score: { id: sid, uid: b.cfg.auth.uid, week: 'w' }, uid: a.cfg.auth.uid, nick: 'W', kind: 'clap' })), (e) => e.status === 403);
});
await t('the rules text includes kudos and duels, with the version bumped', () => {
  assert.ok(CL.RULES.includes('match /kudos/{id}') && CL.RULES.includes('match /duels/{id}') && CL.RULES_VERSION >= 2);
  assert.ok(CL.RULES.includes("id == request.resource.data.score_id + '_' + request.auth.uid"));
  assert.ok(CL.RULES.includes('match /scores/{id}') && CL.RULES.includes('match /live/{id}') && CL.RULES.includes('match /members/{uid}'));   // the old paths are unchanged
});
await t('SETUP_FRIENDS.md shows exactly the rules the app shows (no drift)', async () => {
  const fs = await import('node:fs'), doc = fs.readFileSync(new URL('../SETUP_FRIENDS.md', import.meta.url), 'utf8'), block = /```\n(rules_version[\s\S]*?)\n```/.exec(doc)[1];
  assert.equal(block.trim(), CL.RULES.trim()); assert.ok(doc.includes('kudos') && doc.includes('republish') === false || doc.includes('Publish'));
});
console.log(`\n${n} tests passed`);
