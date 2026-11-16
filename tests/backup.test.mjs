// Backups: sign-ins and keys are included by default and can be left out for a file that will be shared.
import assert from 'node:assert';
import { backupObject, backupHasSecrets } from '../store.js';
const state = { bundles: [], clubsBundle: {}, settings: {}, corrections: [], manualShots: [], audit: [], journal: {}, weather: {},
  sync: { owner: 'me', repo: 'data', token: 'tok-123' }, cloud: { cfg: { projectId: 'p' }, group: 'g1', auth: { refreshToken: 'r' } }, ai: { provider: 'claude', keys: { claude: 'k' } } };
const full = backupObject(state);
assert.equal(full.sync.token, 'tok-123'); assert.deepEqual(full.cloud, state.cloud); assert.deepEqual(full.ai, state.ai); assert.ok(backupHasSecrets(full));
const safe = backupObject(state, { secrets: false });
assert.equal(safe.sync.token, undefined); assert.equal(safe.cloud, undefined); assert.equal(safe.ai, undefined); assert.ok(!backupHasSecrets(JSON.parse(JSON.stringify(safe))));
assert.ok(!JSON.stringify(safe).includes('tok-123') && !JSON.stringify(safe).includes('"k"'));
console.log('backup: sign-ins included by default, left out on request – passed');
