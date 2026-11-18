// Tracked shots into the dataset (course-view plan 6.6, phase 4): a round tracked in BreakingPar must change the stats
// exactly as the same round imported from Garmin would. Run: node tests/tracked.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../analytics.js';
import * as F from '../features.js';
import * as SH from '../shots.js';
import { TOUR_CSV } from '../baseline.js';

let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const TOUR = A.Baseline.fromCsv(TOUR_CSV, 'pga_tour_broadie');
const sample = JSON.parse(fs.readFileSync(new URL('../sample-data.json', import.meta.url)));
const build = (extra) => A.buildDataset({ bundles: [...sample.bundles, ...extra], clubsBundle: sample.clubsBundle || {}, settings: sample.settings || {}, corrections: [], manualShots: [] });
const base = build([]);
const club = (name) => base.clubs.find((c) => c.name === name).club_id;
const DRV = club('Driver'), I7 = club('7 Iron'), PW = club('Pitching Wedge');

// an invented course: holes run north from their tee, metres east / north
const O = [-30, 140], KY = 111320, KX = KY * Math.cos(O[0] * Math.PI / 180);
const ll = (e, nm) => [O[0] + nm / KY, O[1] + e / KX];
const P1 = ll(0, 360), P2 = ll(200, 150);                     // pins of hole 1 (par 4) and hole 2 (par 3)
const G = (pt) => ({ gps: pt, acc: 4, tee: null, feats: null });
const AT = Date.parse('2026-11-18T09:00:00Z');

// ---- the round tracked on the phone
function trackedDraft({ approx = false, assumed = false, firstPutt = null } = {}) {
  const d = { id: 'trk1', start: '2026-11-18T09:00:00', course_id: null, course_name: 'Testwood Links', tee: null, rating: null, slope: null, n: 2, first: 1, hole: 1,
    holes: { 1: { par: 4, strokes: null, putts: null, penalties: 0, fairway: null }, 2: { par: 3, strokes: null, putts: null, penalties: 0, fairway: null } } };
  const h1 = d.holes[1], h2 = d.holes[2];
  SH.hit(h1, { ...G(ll(0, 1)), club_id: DRV, at: AT }); SH.close(h1, G(ll(6, 236))); h1.shots[0].result = 'fairway';
  SH.hit(h1, { ...G(ll(6, 236)), club_id: I7, club_assumed: assumed, at: AT + 6e5 }); SH.close(h1, { gps: ll(3, 352), acc: approx ? 30 : 4 }); h1.shots[1].result = 'green';
  if (approx) h1.shots[1].approx = true;
  SH.holeOut(h1, { putts: 2, first_putt_m: firstPutt, par: 4, line: [ll(0, 0), P1], green: P1 });
  SH.hit(h2, { ...G(ll(200, 1)), club_id: I7, at: AT + 12e5 }); SH.penalty(h2, 'water'); SH.close(h2, G(ll(190, 110)));
  SH.hit(h2, { ...G(ll(190, 110)), club_id: PW, at: AT + 14e5 }); h2.shots[1].lie = 'rough'; SH.close(h2, G(ll(199, 146))); h2.shots[1].result = 'green';
  SH.holeOut(h2, { putts: 1, par: 3, line: [ll(200, 0), P2], green: P2 });
  return d;
}
const appBundle = (d) => SH.withTrackedShots(F.manualBundle(d), d.holes, { 1: P1, 2: P2 });

// ---- the same round as a Garmin watch would have sent it
function garminBundle(d, id = 'trk1') {
  const b = F.manualBundle(d); delete b.source; b.scorecard_id = id; b.summary.id = id;
  b.detail.scorecardDetails[0].scorecard.id = id;
  const L = (pt, lie) => (pt ? { lat: pt[0], lon: pt[1], lie } : { lie });
  const shot = (h, o, clubId, s, e, sl, el, type = null) => ({ id: `app-${h}-${o}`, shotOrder: o, clubId, startLoc: L(s, sl), endLoc: L(e, el), shotTime: null, shotType: type });
  b.shots = { holeShots: [
    { holeNumber: 1, pinPosition: { lat: P1[0], lon: P1[1] }, shots: [shot(1, 1, DRV, ll(0, 1), ll(6, 236), 'TeeBox', 'Fairway', 'TEE'), shot(1, 2, I7, ll(6, 236), ll(3, 352), 'Fairway', 'Green')] },
    { holeNumber: 2, pinPosition: { lat: P2[0], lon: P2[1] }, shots: [shot(2, 1, I7, ll(200, 1), null, 'TeeBox', 'Water', 'TEE'), { id: 'app-2-2', shotOrder: 2, clubId: null, startLoc: { lie: null }, endLoc: { lie: null }, shotType: 'PENALTY' },
      shot(2, 3, PW, ll(190, 110), ll(199, 146), 'Rough', 'Green')] },
  ] };
  return b;
}
const strip = (x) => { const o = { ...x }; for (const k of Object.keys(o)) if (/^(source|shot_source|app_|shot_time|club_stats|dist_source)/.test(k)) delete o[k]; return o; };
const mine = (ds, rid = 'garmin-trk1') => ({ shots: ds.shots.filter((s) => s.round_id === rid).map(strip), holes: ds.holes.filter((h) => h.round_id === rid) });

t('the bundle: Garmin\'s shape, lies, a penalty record, the pin, flags; wedge rows become the club', () => {
  const hs = SH.toHoleShots(trackedDraft().holes[2], 2, { pin: P2 });
  assert.equal(hs.holeNumber, 2); assert.deepEqual([hs.pinPosition.lat, hs.pinPosition.lon], P2);
  assert.deepEqual(hs.shots.map((s) => s.shotType), ['TEE', 'PENALTY', null]);
  assert.deepEqual(hs.shots.map((s) => [s.startLoc.lie, s.endLoc.lie]), [['TeeBox', 'Water'], [null, null], ['Rough', 'Green']]);
  assert.equal(hs.shots[0].endLoc.lat, undefined, 'a ball in the water has no end position');
  assert.ok(hs.shots.every((s) => s.shotSource === SH.APP_SHOT_SOURCE));
  assert.equal(SH.baseClub(`w:${PW}|half`), PW); assert.equal(SH.baseClub(DRV), DRV); assert.equal(SH.baseClub(null), null);
  const ob = { shots: [{ n: 1, club_id: DRV, start: ll(0, 1), end: null, lie: 'tee', result: null, penalty: 'ob', approx: false, club_assumed: true }] };
  const o = SH.toHoleShots(ob, 1).shots;
  assert.equal(o[0].endLoc.lie, 'OutOfBounds'); assert.equal(o[0].appClubAssumed, true); assert.equal(o[1].appPenalty, 'ob');
  assert.equal(A.normLie('OutOfBounds'), 'OB'); assert.equal(A.normLie('TeeBox'), 'Tee'); assert.equal(A.normLie('Bunker'), 'Sand'); assert.equal(A.normLie('Trees'), 'Recovery');
});

t('the tracked round imports: score, putts, penalties and every shot', () => {
  const ds = build([appBundle(trackedDraft())]), m = mine(ds);
  assert.deepEqual(m.holes.map((h) => [h.hole, h.strokes, h.putts, h.penalties]), [[1, 4, 2, 0], [2, 4, 1, 1]]);
  assert.equal(m.shots.length, 5); assert.ok(ds.shots.filter((s) => s.round_id === 'garmin-trk1').every((s) => s.source === 'app'));
  assert.deepEqual(m.shots.map((s) => s.category), ['tee', 'approach', 'approach', 'penalty', 'approach'], 'drive, approach; tee shot, penalty, 41 m pitch');
  assert.ok(m.holes.every((h) => h.chain_complete), 'complete shot chains, so strokes gained can use them');
});

t('a tracked round changes the stats exactly as the same round imported from Garmin', () => {
  const d = trackedDraft(), dsA = build([appBundle(d)]), dsG = build([garminBundle(d)]);
  assert.deepEqual(mine(dsA), mine(dsG), 'shots and holes');
  assert.deepEqual(A.clubTable(dsA.shots, dsA.clubs), A.clubTable(dsG.shots, dsG.clubs), 'club distances');
  for (const id of [DRV, I7, PW]) { const a = F.clubPattern(dsA, id), g = F.clubPattern(dsG, id); assert.deepEqual([a.stats, a.median_m, a.p25_m, a.p75_m, a.n_dist], [g.stats, g.median_m, g.p25_m, g.p75_m, g.n_dist], `pattern ${id}`); }
  assert.deepEqual(A.approachByBand(dsA.shots, 'm'), A.approachByBand(dsG.shots, 'm'), 'approach proximity');
  assert.deepEqual(A.puttingSummary(dsA.holes, dsA.rounds), A.puttingSummary(dsG.holes, dsG.rounds), 'putting');
  assert.deepEqual(F.shortGame(dsA.holes, dsA.shots, dsA.rounds), F.shortGame(dsG.holes, dsG.shots, dsG.rounds), 'short game');
  for (const bl of ['personal', 'pga']) {
    const a = A.strokesGained(dsA, TOUR, bl), g = A.strokesGained(dsG, TOUR, bl);
    assert.deepEqual(a.byRound, g.byRound, `strokes gained (${bl})`); assert.deepEqual(a.coverage, g.coverage);
  }
  assert.ok(A.strokesGained(dsA, TOUR, 'pga').byRound.some((r) => r.round_id === 'garmin-trk1'), 'the tracked round has strokes gained');
});

t('and it does change them: the tracked shots count in club distances', () => {
  const dsA = build([appBundle(trackedDraft())]);
  const row = (ds, id) => A.clubTable(ds.shots, ds.clubs).find((r) => r.club_id === id);
  assert.ok(A.stockShots(dsA.shots, dsA.clubs).some((s) => s.round_id === 'garmin-trk1' && s.club_id === DRV), 'the drive is a stock shot');
  assert.notDeepEqual(row(dsA, DRV), row(base, DRV));
});

t('weak GPS or an assumed club: counted for the score and strokes gained, kept out of club distances and patterns', () => {
  for (const opt of [{ approx: true }, { assumed: true }]) {
    const d = trackedDraft(opt), ds = build([appBundle(d)]), g = build([garminBundle(d)]);
    const s = ds.shots.find((x) => x.round_id === 'garmin-trk1' && x.hole === 1 && x.shot_order === 2);
    assert.equal(s.full_swing, true); assert.equal(s.club_stats, false, JSON.stringify(opt));
    assert.ok(!A.stockShots(ds.shots, ds.clubs).some((x) => x.shot_key === s.shot_key), 'not a stock shot');
    const n7 = (x) => A.stockShots(x.shots, x.clubs).filter((y) => y.club_id === I7).length;
    assert.equal(n7(ds), n7(g) - 1, 'one 7 iron fewer than the Garmin round gives');
    assert.deepEqual(mine(ds).holes.map((h) => h.strokes), [4, 4]);
    assert.deepEqual(A.strokesGained(ds, TOUR, 'pga').byRound, A.strokesGained(g, TOUR, 'pga').byRound, 'strokes gained unchanged');
  }
});

t('a first putt entered on the phone is used as entered', () => {
  const ds = build([appBundle(trackedDraft({ firstPutt: 4.5 }))]), h = ds.holes.find((x) => x.round_id === 'garmin-trk1' && x.hole === 1);
  assert.equal(h.first_putt_eff_m, 4.5); assert.equal(h.first_putt_source, 'user');
  const h2 = ds.holes.find((x) => x.round_id === 'garmin-trk1' && x.hole === 2);
  assert.equal(h2.first_putt_source, 'estimated (GPS to pin marker)', 'not entered: estimated, as for Garmin');
});

t('the same round later arriving from Garmin: the Garmin round is shown, the two are not merged', () => {
  const d = trackedDraft(), app = appBundle(d), gar = garminBundle(d, 'gar9');
  gar.shots.holeShots[0].shots = gar.shots.holeShots[0].shots.slice(0, 1);             // fewer shots than the tracked round
  const all = A.buildDataset({ bundles: [...sample.bundles, app, gar], clubsBundle: sample.clubsBundle || {}, settings: sample.settings || {}, corrections: [], manualShots: [] }, { includeDuplicates: true });
  const ra = all.rounds.find((r) => r.round_id === 'garmin-trk1'), rg = all.rounds.find((r) => r.round_id === 'garmin-gar9');
  assert.equal(ra.duplicate_of, 'garmin-gar9', 'the tracked round is the duplicate'); assert.equal(rg.duplicate_of, null);
  assert.ok(all.shots.filter((s) => s.round_id === 'garmin-trk1').length > all.shots.filter((s) => s.round_id === 'garmin-gar9').length, 'even though it has more shots');
  const ds = build([app, gar]);
  assert.ok(ds.rounds.some((r) => r.round_id === 'garmin-gar9') && !ds.rounds.some((r) => r.round_id === 'garmin-trk1'), 'the Garmin round is the one shown');
  const two = A.buildDataset({ bundles: [...sample.bundles, F.manualBundle({ ...d, id: 'man2' }), app], clubsBundle: {}, settings: sample.settings || {}, corrections: [], manualShots: [] }, { includeDuplicates: true });
  assert.equal(two.rounds.find((r) => r.round_id === 'garmin-man2').duplicate_of, 'garmin-trk1', 'between two phone rounds the one with more shots stays, as before');
});

t('a phone round on a course named from the map still matches the Garmin round of the same game', () => {
  const d = trackedDraft(), app = appBundle(d), gar = garminBundle(d, 'gar7');
  for (const sn of gar.detail.courseSnapshots) { sn.courseGlobalId = 98765; sn.name = 'Testwood Links Golf Club'; }
  gar.detail.scorecardDetails[0].scorecard.courseGlobalId = 98765;
  gar.detail.scorecardDetails[0].scorecard.formattedStartTime = '2026-11-18T09:07:00';      // the watch started a few minutes later
  const all = A.buildDataset({ bundles: [...sample.bundles, app, gar], clubsBundle: {}, settings: sample.settings || {}, corrections: [], manualShots: [] }, { includeDuplicates: true });
  const ra = all.rounds.find((r) => r.round_id === 'garmin-trk1'), rg = all.rounds.find((r) => r.round_id === 'garmin-gar7');
  assert.notEqual(ra.course_id, rg.course_id); assert.equal(ra.duplicate_of, 'garmin-gar7');
  const later = garminBundle(d, 'gar8'); later.detail.scorecardDetails[0].scorecard.formattedStartTime = '2026-11-18T14:00:00';
  const two = A.buildDataset({ bundles: [...sample.bundles, app, later], clubsBundle: {}, settings: sample.settings || {}, corrections: [], manualShots: [] }, { includeDuplicates: true });
  assert.equal(two.rounds.find((r) => r.round_id === 'garmin-trk1').duplicate_of, null, 'a round later the same day is a different round');
});

t('backfill: a round saved before shots went into the dataset gets them, with the first putt', () => {
  const d = trackedDraft({ firstPutt: 3 }), plain = F.manualBundle(d);
  assert.equal(plain.shots.holeShots.length, 0);
  const b = SH.withTrackedShots(plain, { 1: { shots: d.holes[1].shots, first_putt_m: 3 }, 2: { shots: d.holes[2].shots } }, { 1: P1 });
  assert.equal(b.shots.holeShots.length, 2); assert.equal(plain.shots.holeShots.length, 0, 'the original is not changed');
  assert.equal(b.detail.scorecardDetails[0].scorecard.holes[0].firstPuttMeters, 3);
  assert.equal(b.shots.holeShots[1].pinPosition, undefined, 'no pin known: none written');
  const ds = build([b]); assert.equal(ds.shots.filter((s) => s.round_id === 'garmin-trk1').length, 5);
});

t('a round entered without tracking is unchanged', () => {
  const d = trackedDraft(); for (const h of Object.values(d.holes)) delete h.shots;
  const b = F.manualBundle(d); assert.deepEqual(b.shots, { holeShots: [] });
  const ds = build([b]); assert.equal(ds.shots.filter((s) => s.round_id === 'garmin-trk1').length, 0);
  assert.deepEqual(ds.holes.filter((h) => h.round_id === 'garmin-trk1').map((h) => h.strokes), [4, 4]);
});

console.log(`${n} tests passed`);
