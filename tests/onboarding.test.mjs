// Onboarding (first-run plan, part A): who sees the intro, the level-choice mapping, goal preselection, the saved profile and backups. Run: node tests/onboarding.test.mjs
import assert from 'node:assert';
import * as O from '../onboarding.js';
import { backupObject } from '../store.js';
import { readFileSync } from 'node:fs';

const T = '2026-11-16';
// --- level choices map to the agreed starting levels
assert.deepEqual(Object.fromEntries(O.LEVEL_CHOICES.map((x) => [x.key, x.level])), { new: 36, over100: 30, '90s': 24, '80s': 16 });
assert.deepEqual(O.startLevel({ level_choice: '90s' }, null), { level: 24, estimate: true }, 'a level choice is an estimate');
assert.deepEqual(O.startLevel({ level_choice: '90s' }, 12.3), { level: 12.3, estimate: false }, 'a handicap index wins over the estimate');
assert.equal(O.startLevel({}, null), null);
assert.equal(O.startLevel({ level_choice: 'nonsense' }, null), null);

// --- goals: the level each needs, and the one preselected (the next goal below the golfer's level)
assert.equal(O.goalLevel('break90'), 18, 'Break 90 needs about 18 (the plan\'s example)');
assert.equal(O.goalLevel('break100'), 28); assert.equal(O.goalLevel('break80'), 8); assert.equal(O.goalLevel('scratch'), 0); assert.equal(O.goalLevel('enjoy'), null);
const pre = (k) => O.preselectGoal(O.startLevel({ level_choice: k }, null).level);
assert.equal(pre('new'), 'break100'); assert.equal(pre('over100'), 'break100'); assert.equal(pre('90s'), 'break90'); assert.equal(pre('80s'), 'break80');
assert.equal(O.preselectGoal(18.5), 'break90'); assert.equal(O.preselectGoal(18), 'break80', 'strictly below: an 18 is offered Break 80');
assert.equal(O.preselectGoal(12), 'break80'); assert.equal(O.preselectGoal(5), 'scratch'); assert.equal(O.preselectGoal(0), 'enjoy'); assert.equal(O.preselectGoal(-2), 'enjoy');
assert.equal(O.preselectGoal(null), 'break100', 'no level known → the first goal');

// --- handicap parsing
assert.equal(O.parseHandicap('18.4'), 18.4); assert.equal(O.parseHandicap(' 7,25 '), 7.3); assert.equal(O.parseHandicap('+2'), -2); assert.equal(O.parseHandicap('54'), 54);
for (const bad of ['', 'abc', '55', '-11', '1e9', null, undefined]) assert.equal(O.parseHandicap(bad), null, `rejects ${bad}`);

// --- who sees it
const fresh = { settings: { handicaps: [] }, journal: { results: [], sessions: [], notes: [], thoughts: [], wedge: { entries: [] }, draft: null }, rounds: [] };
assert.ok(O.needsOnboarding(fresh), 'a fresh app shows the intro');
assert.ok(!O.needsOnboarding({ ...fresh, settings: { handicaps: [], profile: { onboarded_at: T } } }), 'not after it was done or skipped');
for (const [what, ctx] of [['rounds', { ...fresh, rounds: [{}] }], ['practice results', { ...fresh, journal: { ...fresh.journal, results: [{}] } }], ['a session', { ...fresh, journal: { ...fresh.journal, sessions: [{}] } }],
  ['a round in progress', { ...fresh, journal: { ...fresh.journal, draft: { hole: 3 } } }], ['a game in progress', { ...fresh, journal: { ...fresh.journal, game_draft: {} } }],
  ['a handicap', { ...fresh, settings: { handicaps: [{ date: T, handicap_index: 9 }] } }], ['coach notes', { ...fresh, journal: { ...fresh.journal, notes: [{}] } }]]) {
  assert.ok(!O.needsOnboarding(ctx), `never shown with ${what}`);
  assert.deepEqual(O.markIfHasData(ctx, T), { onboarded_at: T }, `${what}: marked as onboarded silently`);
}
assert.equal(O.markIfHasData(fresh, T), null, 'a fresh app is not marked');
assert.equal(O.markIfHasData({ ...fresh, rounds: [{}], settings: { profile: { onboarded_at: '2026-01-01' } } }, T), null, 'already onboarded: nothing to save');
assert.ok(O.needsOnboarding({}), 'missing fields count as empty');

// --- the profile that is saved
const typed = O.buildProfile({ name: '  Wills  ', hcp: 12.3, level_choice: '80s', goal: 'break80', months: 12, per_week: 3 }, T);
assert.deepEqual(typed, { onboarded_at: T, goal: { key: 'break80', months: 12, set_at: T }, per_week: 3, name: 'Wills' }, 'a typed handicap stores no level choice');
const none = O.buildProfile({ hcp: null, level_choice: '90s' }, T);
assert.deepEqual(none, { onboarded_at: T, goal: { key: 'break90', months: O.DEFAULT_MONTHS, set_at: T }, per_week: O.DEFAULT_PER_WEEK, level_choice: '90s' }, 'no handicap: level choice, preselected goal, defaults');
assert.equal(O.buildProfile({ name: '' }, T).name, undefined, 'the name is optional');
assert.equal(O.buildProfile({ name: 'x'.repeat(80) }, T).name.length, O.NAME_MAX);
assert.equal(O.buildProfile({ months: 7, per_week: 9 }, T).goal.months, O.DEFAULT_MONTHS);
assert.deepEqual(O.skipProfile(T), { onboarded_at: T }, 'skipping stores the date and nothing else');
// a typed handicap goes into the handicap history with today's date, replacing an entry from the same day, in date order
assert.deepEqual(O.handicapEntry(12.3, T), { date: T, handicap_index: 12.3, note: O.HCP_NOTE }); assert.equal(O.handicapEntry(null, T), null);
const hist = O.withHandicap([{ date: '2026-12-01', handicap_index: 11 }, { date: T, handicap_index: 14 }], O.handicapEntry(12.3, T));
assert.deepEqual(hist.map((h) => [h.date, h.handicap_index]), [[T, 12.3], ['2026-12-01', 11]]);
// readProfile cleans old or hand-edited data
assert.deepEqual(O.readProfile({}), {}); assert.deepEqual(O.readProfile({ profile: null }), {});
assert.deepEqual(O.readProfile({ profile: { onboarded_at: T, name: 3, level_choice: 'x', goal: { key: 'nope' }, per_week: 7 } }), { onboarded_at: T, name: '3' });
assert.deepEqual(O.readProfile({ profile: typed }), typed);

// --- saved and restored in a backup (settings travel whole; restoreBackup writes b.settings back)
const state = { bundles: [], clubsBundle: {}, settings: { handicaps: O.withHandicap([], O.handicapEntry(12.3, T)), profile: typed }, corrections: [], manualShots: [], audit: [], journal: {}, weather: {}, sync: {} };
const b = JSON.parse(JSON.stringify(backupObject(state, { secrets: false })));
assert.deepEqual(O.readProfile(b.settings), typed, 'the profile is in a backup without sign-ins');
assert.equal(b.settings.handicaps[0].handicap_index, 12.3);

// --- every intro phrase is in feel.js COPY, and the new module is cached for offline use
const { COPY } = await import('../feel.js');
for (const k of ['skip', 'back', 'next', 'welcome', 'about', 'goal', 'ready', 'replay']) assert.ok(COPY.intro[k], `COPY.intro.${k}`);
for (const g of O.GOALS) assert.ok(COPY.intro.goal.goals[g.key], `goal wording ${g.key}`);
for (const l of O.LEVEL_CHOICES) assert.ok(COPY.intro.about.levels[l.key], `level wording ${l.key}`);
assert.ok(COPY.intro.welcome.brand === 'BreakingPar' && !JSON.stringify(Object.values(COPY.intro).map(String)).includes('GolfIQ'));
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.ok(sw.includes("'onboarding.js'"), 'onboarding.js is in the service-worker SHELL');
console.log('onboarding: level choices, goals, who sees it, profile, handicap entry, backup, wording – passed');
