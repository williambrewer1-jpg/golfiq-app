// Cloud sync: read the files the GitHub Actions job writes to your PRIVATE data repo.
// Uses a fine-grained, read-only token stored only on this phone.
import { mergeBundles, setClubsBundle, saveSync } from './store.js';

function api(cfg, path) {
  const p = [cfg.path || 'data', path].filter(Boolean).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${p}?ref=${encodeURIComponent(cfg.branch || 'main')}`;
}
async function getRaw(cfg, path) {
  const r = await fetch(api(cfg, path), { headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' });
  if (r.status === 404) throw new Error(`Not found: ${path} (has the sync job run yet? are owner/repo right?)`);
  if (r.status === 401 || r.status === 403) throw new Error(`GitHub refused access (${r.status}). Check the token has read access to this repo and hasn't expired.`);
  if (!r.ok) throw new Error(`GitHub error ${r.status} for ${path}`);
  return r.json();
}

export async function syncFromGitHub(state, progress = () => {}) {
  const cfg = state.sync || {};
  if (!cfg.owner || !cfg.repo || !cfg.token) throw new Error('Set up cloud sync in Settings first');
  progress('Reading index…');
  const idx = await getRaw(cfg, 'index.json');
  const want = idx.rounds || {}, local = state.rawmeta || {};
  const todo = Object.keys(want).filter((id) => local[id]?.remote_sha !== want[id]);
  const bundles = [];
  let done = 0;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      bundles.push(await getRaw(cfg, `rounds/scorecard_${id}.json`));
      progress(`Downloaded ${++done}/${todo.length} rounds`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (idx.clubs_sha && idx.clubs_sha !== cfg.clubs_sha) {
    await setClubsBundle(state, await getRaw(cfg, 'clubs_latest.json'));
    cfg.clubs_sha = idx.clubs_sha;
  }
  const res = await mergeBundles(state, bundles, 'cloud sync', want);
  cfg.last_sync = new Date().toISOString(); cfg.last_job = idx.job || null;
  state.sync = cfg; await saveSync(state);
  return { ...res, job: idx.job || null, remote_rounds: Object.keys(want).length };
}

// A Fernet key (32 random bytes, url-safe base64) for the GOLFIQ_STATE_KEY secret.
export function newStateKey() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
}
