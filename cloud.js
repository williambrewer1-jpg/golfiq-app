// Friends features through the user's own Firebase project (free Spark plan), using the plain REST APIs –
// no SDK, nothing to install. Only game scores, nicknames, group names and live side-game scorecards are sent;
// rounds, shots and everything else stay on the phone.
//   Auth:      anonymous sign-in (Identity Toolkit REST), token refreshed automatically
//   Database:  Cloud Firestore REST; security rules (in SETUP_FRIENDS.md) limit reads/writes to group members
let fetchFn = (...a) => fetch(...a);
export const setFetch = (f) => { fetchFn = f; };

const now = () => Date.now();
export const ready = (cfg) => !!(cfg?.apiKey && cfg?.projectId);
const base = (cfg) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents`;

// ------------------------------------------------------------------ auth
export async function signIn(cfg) {
  if (cfg.auth?.idToken && cfg.auth.exp > now() + 60000) return cfg.auth;
  let r, j;
  if (cfg.auth?.refreshToken) {
    r = await fetchFn(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(cfg.auth.refreshToken)}` });
    j = await r.json();
    if (r.ok) { cfg.auth = { idToken: j.id_token, refreshToken: j.refresh_token, uid: j.user_id, exp: now() + Number(j.expires_in || 3600) * 1000 }; return cfg.auth; }
  }
  r = await fetchFn(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(cfg.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  j = await r.json();
  if (!r.ok) throw new Error(`Firebase sign-in failed: ${j?.error?.message || r.status}. Is Anonymous sign-in enabled in Authentication → Sign-in method?`);
  cfg.auth = { idToken: j.idToken, refreshToken: j.refreshToken, uid: j.localId, exp: now() + Number(j.expiresIn || 3600) * 1000 };
  return cfg.auth;
}

// ------------------------------------------------------------------ Firestore value encoding
export function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
export function dec(v) {
  if (!v || 'nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
const docOut = (d) => ({ id: d.name.split('/').pop(), ...dec({ mapValue: { fields: d.fields || {} } }) });

async function call(cfg, method, url, body) {
  const a = await signIn(cfg);
  const r = await fetchFn(url, { method, headers: { Authorization: `Bearer ${a.idToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404 && method === 'GET') return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(r.status === 403 ? 'Not allowed – check the Firestore rules, or rejoin the group.' : `Firebase: ${j?.error?.message || r.status}`); e.status = r.status; throw e; }
  return j;
}
export async function getDoc(cfg, path) { const j = await call(cfg, 'GET', `${base(cfg)}/${path}`); return j ? docOut(j) : null; }
// set (create or overwrite); with fields given, only those field paths are written (others kept)
export async function setDoc(cfg, path, obj, fields = null) {
  const mask = fields ? fields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&') : '';
  return docOut(await call(cfg, 'PATCH', `${base(cfg)}/${path}${mask ? `?${mask}` : ''}`, { fields: enc(obj).mapValue.fields }));
}
export async function addDoc(cfg, coll, obj) { return docOut(await call(cfg, 'POST', `${base(cfg)}/${coll}`, { fields: enc(obj).mapValue.fields })); }
export async function deleteDoc(cfg, path) { await call(cfg, 'DELETE', `${base(cfg)}/${path}`); }
export async function listDocs(cfg, coll) { const j = await call(cfg, 'GET', `${base(cfg)}/${coll}?pageSize=300`); return (j?.documents || []).map(docOut); }
export async function queryEq(cfg, parent, collectionId, field, value) {
  const j = await call(cfg, 'POST', `${base(cfg)}/${parent}:runQuery`, { structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } }, limit: 1000 } });
  return (j || []).filter((x) => x.document).map((x) => docOut(x.document));
}

// ------------------------------------------------------------------ groups
const CODE = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newCode = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => CODE[b % CODE.length]).join('');
export async function createGroup(cfg, name, nick) {
  const a = await signIn(cfg), code = newCode();
  await setDoc(cfg, `groups/${code}`, { name, owner: a.uid, created: new Date().toISOString() });
  await setDoc(cfg, `groups/${code}/members/${a.uid}`, { nick, joined: new Date().toISOString() });
  return code;
}
export async function joinGroup(cfg, code, nick) {
  const a = await signIn(cfg), g = await getDoc(cfg, `groups/${code}`);
  if (!g) throw new Error('No group with that code.');
  await setDoc(cfg, `groups/${code}/members/${a.uid}`, { nick, joined: new Date().toISOString() });
  return g;
}
export const members = (cfg, code) => listDocs(cfg, `groups/${code}/members`);
export async function postScore(cfg, code, s) { const a = await signIn(cfg); return addDoc(cfg, `groups/${code}/scores`, { ...s, uid: a.uid }); }
export const scoresWhere = (cfg, code, field, value) => queryEq(cfg, `groups/${code}`, 'scores', field, value);

// best score per player for one game (ties: earliest)
export function board(scores, better = 'higher') {
  const best = new Map();
  for (const s of scores) {
    const cur = best.get(s.uid), b = better === 'lower' ? s.score < (cur?.score ?? Infinity) : s.score > (cur?.score ?? -Infinity);
    if (!cur || b || (s.score === cur.score && s.date < cur.date)) best.set(s.uid, s);
  }
  return [...best.values()].sort((x, y) => (better === 'lower' ? x.score - y.score : y.score - x.score) || x.date.localeCompare(y.date));
}

// ------------------------------------------------------------------ kudos (kudos.js): one document per person per score; read by ISO week like the scores
export const kudosWhere = (cfg, code, week) => queryEq(cfg, `groups/${code}`, 'kudos', 'week', week);
export const giveKudos = (cfg, code, doc) => setDoc(cfg, `groups/${code}/kudos/${doc.score_id}_${doc.from_uid}`, doc);
export const takeKudos = (cfg, code, scoreId, uid) => deleteDoc(cfg, `groups/${code}/kudos/${scoreId}_${uid}`);

// ------------------------------------------------------------------ live side games
export async function createLive(cfg, code, game) { const id = newCode(6); const a = await signIn(cfg); await setDoc(cfg, `groups/${code}/live/${id}`, { ...game, owner: a.uid, updated: new Date().toISOString() }); return id; }
export const getLive = (cfg, code, id) => getDoc(cfg, `groups/${code}/live/${id}`);
// Firestore field paths: a key that isn't a plain identifier (e.g. a user id starting with a digit) must be quoted in backticks
export const seg = (k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `\`${String(k).replace(/[`\\]/g, (c) => `\\${c}`)}\``);
// write only the given players' scorecards (and claims), so two phones never overwrite each other's players
export async function pushLive(cfg, code, id, scores, pids, extra = {}) {
  const obj = { scores: Object.fromEntries(pids.map((p) => [p, scores[p] || {}])), updated: new Date().toISOString(), ...extra };
  const fields = [...pids.map((p) => `scores.${seg(p)}`), 'updated', ...Object.keys(extra).flatMap((k) => (k === 'claims' ? Object.keys(extra.claims).map((p) => `claims.${seg(p)}`) : [k]))];
  return setDoc(cfg, `groups/${code}/live/${id}`, obj, fields);
}
export const listLive = (cfg, code) => listDocs(cfg, `groups/${code}/live`);

// invite links carry the (public) Firebase web config + group code, so friends don't type anything
export const inviteLink = (cfg, code, name, href) => `${href.split('#')[0]}#join=${btoa(unescape(encodeURIComponent(JSON.stringify({ k: cfg.apiKey, p: cfg.projectId, g: code, n: name }))))}`;
export function parseInvite(hash) {
  const m = /join=([A-Za-z0-9+/=]+)/.exec(hash || ''); if (!m) return null;
  try { const j = JSON.parse(decodeURIComponent(escape(atob(m[1])))); return j.k && j.p && j.g ? { apiKey: j.k, projectId: j.p, group: j.g, groupName: j.n || '' } : null; } catch { return null; }
}
// RULES_VERSION goes up whenever the rules change, so Settings and SETUP_FRIENDS.md can say what changed. 2 = kudos and duels paths added.
export const RULES_VERSION = 2;
export const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function member(g) { return signedIn() && exists(/databases/$(db)/documents/groups/$(g)/members/$(request.auth.uid)); }
    match /groups/{g} {
      allow get: if signedIn();
      allow create: if signedIn() && request.resource.data.owner == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.owner == request.auth.uid;
      match /members/{uid} {
        allow read: if member(g);
        allow create, update: if signedIn() && uid == request.auth.uid && request.resource.data.nick is string && request.resource.data.nick.size() <= 30;
        allow delete: if signedIn() && uid == request.auth.uid;
      }
      match /scores/{id} {
        allow read: if member(g);
        allow create: if member(g) && request.resource.data.uid == request.auth.uid && request.resource.data.size() <= 20;
        allow delete: if member(g) && resource.data.uid == request.auth.uid;
      }
      match /live/{id} {
        allow read, create, update: if member(g);
        allow delete: if member(g) && resource.data.owner == request.auth.uid;
      }
      match /kudos/{id} {
        allow read: if member(g);
        allow create: if member(g) && request.resource.data.from_uid == request.auth.uid && id == request.resource.data.score_id + '_' + request.auth.uid && request.resource.data.size() <= 8;
        allow delete: if member(g) && resource.data.from_uid == request.auth.uid;
      }
      match /duels/{id} {
        allow read: if member(g);
        allow create: if member(g) && request.resource.data.from_uid == request.auth.uid && request.resource.data.size() <= 20;
        allow update: if member(g) && (resource.data.from_uid == request.auth.uid || resource.data.to_uid == request.auth.uid);
        allow delete: if member(g) && resource.data.from_uid == request.auth.uid;
      }
    }
  }
}`;
