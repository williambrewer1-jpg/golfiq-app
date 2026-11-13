// On-device storage (IndexedDB). Raw Garmin bundles in 'raw'; everything else in 'kv'.
// Nothing here ever leaves the phone except via an explicit backup file the user saves.
import { parseRoundBundle, parseClubsBundle } from './analytics.js';

const DB_NAME = 'golfiq', VERSION = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('raw')) d.createObjectStore('raw'); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const kvGet = (k, dflt = null) => tx('kv', 'readonly', (s) => req(s.get(k))).then((v) => (v === undefined ? dflt : v));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => { s.put(v, k); });
export const rawAll = () => tx('raw', 'readonly', (s) => req(s.getAll()));
export const rawPut = (id, b) => tx('raw', 'readwrite', (s) => { s.put(b, id); });
export async function clearAll() { await tx('raw', 'readwrite', (s) => { s.clear(); }); await tx('kv', 'readwrite', (s) => { s.clear(); }); }
export async function requestPersistence() { try { return await navigator.storage?.persist?.(); } catch { return false; } }

export const DEFAULT_SETTINGS = () => ({ clubs: {}, tees: {}, holes: {}, handicaps: [] });
// Things you write yourself (not from Garmin): practice, coach notes, swing thoughts, wedge matrix, timeline markers.
export const DEFAULT_JOURNAL = () => ({ games: [], results: [], sessions: [], notes: [], thoughts: [], wedge: { lengths: ['7:30', '9:00', '10:30'], entries: [] }, markers: [], draft: null });

export async function loadState() {
  const [bundles, clubsBundle, settings, corrections, manualShots, audit, rawmeta, importLog, sync, journal, weather, osm, cloud, elev] = await Promise.all([
    rawAll(), kvGet('clubsBundle', {}), kvGet('settings', DEFAULT_SETTINGS()), kvGet('corrections', []), kvGet('manualShots', []),
    kvGet('audit', []), kvGet('rawmeta', {}), kvGet('importLog', []), kvGet('sync', {}), kvGet('journal', {}), kvGet('weather', {}), kvGet('osm', {}), kvGet('cloud', {}), kvGet('elev', {})]);
  const dj = DEFAULT_JOURNAL();
  return { bundles, clubsBundle, settings: { ...DEFAULT_SETTINGS(), ...settings }, corrections, manualShots, audit, rawmeta, importLog, sync,
    journal: { ...dj, ...journal, wedge: { ...dj.wedge, ...(journal.wedge || {}) } }, weather, osm, cloud, elev };
}

const now = () => new Date().toISOString().slice(0, 19) + 'Z';
async function audit(state, action, entity, key, detail) {
  state.audit.push({ ts: now(), action, entity, entity_key: key, detail }); await kvSet('audit', state.audit);
}

// ---------------------------------------------------------------- hashing / identity
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function bundleId(b) {
  if (b.scorecard_id) return String(b.scorecard_id);
  const d = b.detail || b, c = d.scorecardDetails?.[0]?.scorecard || d.scorecard || d;
  return c?.id !== undefined ? String(c.id) : null;
}
const strip = (b) => { const { fetched_at, payload_sha_basis, ...rest } = b; return rest; };

// ---------------------------------------------------------------- import (files, bookmarklet export, cloud)
export function classify(json) {
  if (json?.golfiq_backup) return 'backup';
  if (json?.golfiq_export) return 'export';
  if (Array.isArray(json)) return 'bundles';
  if (json?.kind === 'clubs' || (json?.clubs && !json?.detail)) return 'clubs';
  if (json?.detail || json?.scorecardDetails || json?.scorecard_id) return 'bundle';
  return 'unknown';
}

export async function mergeBundles(state, bundles, source, remoteShas = {}) {
  const res = { new: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
  for (const raw of bundles) {
    const b = strip(raw), id = bundleId(b);
    if (!id) { res.failed++; res.errors.push('bundle without scorecard id'); continue; }
    b.scorecard_id = id;
    try { parseRoundBundle(b); } catch (e) { res.failed++; res.errors.push(`${id}: ${e.message}`); continue; }
    const h = await sha256(JSON.stringify(b)), prev = state.rawmeta[id];
    if (prev && prev.hash === h) { res.unchanged++; if (remoteShas[id]) prev.remote_sha = remoteShas[id]; continue; }
    await rawPut(id, b);
    state.rawmeta[id] = { hash: h, imported_at: now(), source, remote_sha: remoteShas[id] || prev?.remote_sha || null };
    prev ? res.updated++ : res.new++;
  }
  await kvSet('rawmeta', state.rawmeta);
  state.bundles = await rawAll();
  state.importLog.unshift({ ts: now(), source, ...res, errors: res.errors.slice(0, 20) });
  state.importLog = state.importLog.slice(0, 50);
  await kvSet('importLog', state.importLog);
  await audit(state, 'import', null, null, { source, new: res.new, updated: res.updated, failed: res.failed });
  return res;
}
export async function setClubsBundle(state, cb) {
  const { payload_sha_basis, ...c } = cb; state.clubsBundle = c; await kvSet('clubsBundle', c);
}
export async function importJson(state, json, source) {
  const kind = classify(json);
  if (kind === 'export') {
    if (json.clubs) await setClubsBundle(state, json.clubs);
    return mergeBundles(state, json.rounds || [], source);
  }
  if (kind === 'bundles') return mergeBundles(state, json, source);
  if (kind === 'bundle') return mergeBundles(state, [json], source);
  if (kind === 'clubs') { await setClubsBundle(state, json); return { new: 0, updated: 0, unchanged: 0, failed: 0, errors: [], clubs: true }; }
  throw new Error('Not a Garmin/GolfIQ JSON file');
}

// ---------------------------------------------------------------- backup / restore
export function backupObject(state) {
  return { golfiq_backup: 1, created_at: now(), origin: 'iphone', bundles: state.bundles, clubsBundle: state.clubsBundle,
    settings: state.settings, corrections: state.corrections, manualShots: state.manualShots, audit: state.audit, journal: state.journal, weather: state.weather,
    sync: { ...state.sync, token: undefined } };
}
export async function restoreBackup(state, b) {
  const keepSync = state.sync;
  await clearAll();
  for (const x of b.bundles || []) { const id = bundleId(x); if (id) await rawPut(id, { ...x, scorecard_id: id }); }
  const rawmeta = {};
  for (const x of b.bundles || []) { const id = bundleId(x); if (id) rawmeta[id] = { hash: await sha256(JSON.stringify(strip({ ...x, scorecard_id: id }))), imported_at: now(), source: 'restore' }; }
  await Promise.all([kvSet('clubsBundle', b.clubsBundle || {}), kvSet('settings', { ...DEFAULT_SETTINGS(), ...(b.settings || {}) }),
    kvSet('corrections', b.corrections || []), kvSet('manualShots', b.manualShots || []), kvSet('rawmeta', rawmeta), kvSet('journal', b.journal || {}), kvSet('weather', b.weather || {}),
    kvSet('audit', [...(b.audit || []), { ts: now(), action: 'restore', detail: { origin: b.origin, created_at: b.created_at } }]),
    kvSet('sync', { ...(b.sync || {}), token: keepSync?.token })]);
  Object.assign(state, await loadState());
}

// ---------------------------------------------------------------- corrections & settings (all audited)
export async function addCorrection(state, entity, key, field, value, oldValue = null, reason = '') {
  for (const c of state.corrections) if (c.active && c.entity === entity && c.key === key && c.field === field) c.active = false;
  const id = (state.corrections.reduce((m, c) => Math.max(m, c.id), 0) || 0) + 1;
  state.corrections.push({ id, created_at: now(), entity, key, field, value, old_value: oldValue, reason, active: true });
  await kvSet('corrections', state.corrections);
  await audit(state, 'correction', entity, key, { field, old: oldValue, new: value, reason });
}
export async function revertCorrection(state, id) {
  const c = state.corrections.find((x) => x.id === id); if (!c) return;
  c.active = false; await kvSet('corrections', state.corrections);
  await audit(state, 'revert_correction', c.entity, c.key, { correction_id: id, field: c.field });
}
export async function addManualShot(state, shot, reason) {
  const key = `${shot.round_id}:manual:${shot.hole}:${shot.shot_order}:${Date.now()}`;
  state.manualShots.push({ ...shot, shot_key: key, shot_source: 'MANUAL' }); await kvSet('manualShots', state.manualShots);
  await audit(state, 'add_manual_shot', 'shot', key, { ...shot, reason }); return key;
}
export async function deleteManualShot(state, key) {
  state.manualShots = state.manualShots.filter((s) => s.shot_key !== key); await kvSet('manualShots', state.manualShots);
  await audit(state, 'delete_manual_shot', 'shot', key, null);
}
export async function saveSettings(state, action, key, detail) {
  await kvSet('settings', state.settings); await audit(state, action, 'settings', key, detail);
}
export async function saveSync(state) { await kvSet('sync', state.sync); }

// ---------------------------------------------------------------- demo data removal
export const DEMO_SOURCE = 'SYNTHETIC SAMPLE';
export const demoRoundCount = (state) => state.bundles.filter((b) => b.source === DEMO_SOURCE).length;
const cardOf = (b) => { const d = b.detail || b; return d.scorecardDetails?.[0]?.scorecard || d.scorecard || d; };

// Removes the synthetic demo rounds and everything that came with them (club names, synthetic
// handicap history, course settings, corrections on demo rounds). Your Garmin rounds, your own
// edits and the cloud-sync settings are kept.
export async function removeDemo(state) {
  const demo = state.bundles.filter((b) => b.source === DEMO_SOURCE);
  if (!demo.length) return { rounds: 0, clubs: 0 };
  const ids = demo.map((b) => String(b.scorecard_id)), rids = ids.map((i) => `garmin-${i}`);
  await tx('raw', 'readwrite', (s) => { ids.forEach((i) => s.delete(i)); });
  ids.forEach((i) => delete state.rawmeta[i]);
  await kvSet('rawmeta', state.rawmeta);
  state.bundles = await rawAll();
  // courses only used by demo rounds
  const live = new Set(state.bundles.map((b) => `garmin-${cardOf(b)?.courseGlobalId}`));
  const demoCourses = new Set(demo.map((b) => `garmin-${cardOf(b)?.courseGlobalId}`).filter((c) => !live.has(c)));
  for (const k of Object.keys(state.settings.tees || {})) if (demoCourses.has(k.split('|')[0])) delete state.settings.tees[k];
  for (const k of Object.keys(state.settings.holes || {})) if (demoCourses.has(k.split('|')[0])) delete state.settings.holes[k];
  state.settings.handicaps = (state.settings.handicaps || []).filter((h) => !/synthetic/i.test(h.note || ''));
  await kvSet('settings', state.settings);
  const isDemoKey = (k) => rids.some((r) => k === r || k.startsWith(r + '|') || k.startsWith(r + ':'));
  state.corrections = state.corrections.filter((c) => !isDemoKey(String(c.key)));
  state.manualShots = state.manualShots.filter((m) => !rids.includes(m.round_id));
  await kvSet('corrections', state.corrections); await kvSet('manualShots', state.manualShots);
  // clubs still in use: Garmin club list + clubs on remaining shots + clubs you added yourself
  const used = new Set(parseClubsBundle(state.clubsBundle || {}).map((c) => c.club_id));
  for (const b of state.bundles) for (const h of b.shots?.holeShots || []) for (const sh of h.shots || []) if (sh.clubId) used.add(String(sh.clubId));
  for (const m of state.manualShots) if (m.club_id) used.add(String(m.club_id));
  let clubs = 0;
  for (const [id, o] of Object.entries(state.settings.clubs || {})) if (!used.has(id) && o.source !== 'user') { delete state.settings.clubs[id]; clubs++; }
  await kvSet('settings', state.settings);
  await audit(state, 'remove_demo', null, null, { rounds: ids.length, clubs });
  return { rounds: ids.length, clubs };
}

// ---------------------------------------------------------------- journal, weather and course-map caches
export const saveJournal = (state) => kvSet('journal', state.journal);
// friends (Firebase config, group, sign-in) – kept out of backups like the sync token; terrain heights cache
export const saveCloud = (state) => kvSet('cloud', state.cloud);
export const saveElev = (state) => { const k = Object.keys(state.elev); if (k.length > 60) for (const x of k.slice(0, k.length - 60)) delete state.elev[x]; return kvSet('elev', state.elev); };
export const saveWeather = (state) => kvSet('weather', state.weather);
export const saveOsm = (state) => kvSet('osm', state.osm);
export function addCoachNotes(state, notes, source) {
  const key = (n) => `${n.date}|${n.title}|${n.feedback}`, have = new Set(state.journal.notes.map(key));
  let added = 0;
  for (const n of notes) { if (have.has(key(n))) continue; state.journal.notes.push({ id: `n${Date.now()}${added}`, ...n, source: source || n.source || 'claude', added_at: now() }); have.add(key(n)); added++; }
  return added;
}

// ---------------------------------------------------------------- rounds entered by hand
export async function deleteBundle(state, id) {
  await tx('raw', 'readwrite', (s) => { s.delete(String(id)); });
  delete state.rawmeta[String(id)]; await kvSet('rawmeta', state.rawmeta);
  state.bundles = await rawAll();
  await audit(state, 'delete_manual_round', 'round', `garmin-${id}`, null);
}
