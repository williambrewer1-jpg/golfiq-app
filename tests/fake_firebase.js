// A small in-memory fake of the Firebase REST APIs GolfIQ uses (anonymous sign-in and Firestore documents, queries).
// Used by Node tests (via require) and injected into the browser for Playwright tests. Enforces the score-size rule from SETUP_FRIENDS.md.
(function (root) {
  function makeFakeFirebase(opts = {}) {
    const docs = new Map(), log = [], uids = []; let n = 0, ids = 0;
    const listChildren = (coll) => [...docs.keys()].filter((k) => k.startsWith(coll + '/') && !k.slice(coll.length + 1).includes('/'));
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const out = (path) => ({ name: `projects/p/databases/(default)/documents/${path}`, fields: docs.get(path) });
    const strip = (url) => decodeURIComponent(url.split('/documents/')[1] || '').split('?')[0];
    async function fetch(url, init = {}) {
      const method = (init.method || 'GET').toUpperCase(), body = init.body && typeof init.body === 'string' && init.body[0] === '{' ? JSON.parse(init.body) : null; log.push([method, url]);
      if (url.includes('accounts:signUp')) { const i = ++n; uids.push(`uid-${i}`); return json(200, { idToken: `tok-${i}`, refreshToken: `ref-${i}`, localId: `uid-${i}`, expiresIn: '3600' }); }
      if (url.includes('securetoken.googleapis.com')) return json(200, { id_token: `tok-r${++n}`, refresh_token: 'ref-r', user_id: uids[uids.length - 1] || 'uid-1', expires_in: '3600' });
      if (!url.includes('firestore.googleapis.com')) return json(404, {});
      // opts.rules = 'old': the security rules from before kudos and duels, so those paths are refused
      const newPath = (p) => /\/(kudos|duels)(\/|$)/.test('/' + p);
      if (opts.rules === 'old' && method === 'POST' && url.includes(':runQuery') && ['kudos', 'duels'].includes(body?.structuredQuery?.from?.[0]?.collectionId)) return json(403, { error: { message: 'rules: kudos/duels not allowed' } });
      if (opts.rules === 'old' && newPath(strip(url))) return json(403, { error: { message: 'rules: kudos/duels not allowed' } });
      if (method === 'POST' && url.includes(':runQuery')) {
        const parent = strip(url.split(':runQuery')[0] + '/documents/' + decodeURIComponent(url.split('/documents/')[1].split(':runQuery')[0])), q = body.structuredQuery, f = q.where.fieldFilter, want = Object.values(f.value)[0];
        const coll = `${parent}/${q.from[0].collectionId}`, hits = listChildren(coll).filter((k) => { const v = docs.get(k)[f.field.fieldPath]; return v && Object.values(v)[0] === want; });
        return json(200, hits.length ? hits.map((k) => ({ document: out(k) })) : [{ readTime: 'x' }]);
      }
      const path = strip(url);
      if (method === 'GET') { if (docs.has(path)) return json(200, out(path)); const kids = listChildren(path); return kids.length ? json(200, { documents: kids.map(out) }) : /\/[^/]+\/[^/]+$/.test(path) && path.split('/').length % 2 === 0 ? json(200, {}) : json(404, { error: { message: 'not found' } }); }
      if (method === 'POST') {
        if (/\/scores$/.test(path) && Object.keys(body.fields).length > (opts.maxScoreFields || 20)) return json(403, { error: { message: 'rules: score too large' } });
        const id = `auto${++ids}`; docs.set(`${path}/${id}`, body.fields); return json(200, out(`${path}/${id}`));
      }
      if (method === 'PATCH' && /\/kudos\/[^/]+$/.test(path)) {      // the kudos rules: at most 8 fields, the document id is score_id + '_' + from_uid, and there is no update
        const f = body.fields, id = path.split('/').pop(), sid = f.score_id?.stringValue, fu = f.from_uid?.stringValue;
        if (Object.keys(f).length > 8 || !sid || id !== `${sid}_${fu}` || docs.has(path)) return json(403, { error: { message: 'rules: kudos not allowed' } });
      }
      if (method === 'PATCH') { const mask = [...new URL(url).searchParams.getAll('updateMask.fieldPaths')]; docs.set(path, mask.length ? { ...(docs.get(path) || {}), ...Object.fromEntries(mask.map((m) => [m, body.fields[m]])) } : body.fields); return json(200, out(path)); }
      if (method === 'DELETE') { docs.delete(path); return json(200, {}); }
      return json(400, {});
    }
    // seed helpers: write a plain object as Firestore fields
    const encv = (v) => (v === null || v === undefined ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(encv) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encv(x)])) } });
    const put = (path, obj) => docs.set(path, Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, encv(x)])));
    const decv = (v) => (!v || 'nullValue' in v ? null : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'stringValue' in v ? v.stringValue : 'arrayValue' in v ? (v.arrayValue.values || []).map(decv) : null);
    const read = (coll) => listChildren(coll).map((k) => Object.fromEntries(Object.entries(docs.get(k)).map(([f, v]) => [f, decv(v)])));
    return { fetch, put, read, docs, log };
  }
  root.makeFakeFirebase = makeFakeFirebase; if (typeof module !== 'undefined') module.exports = { makeFakeFirebase };
})(typeof globalThis !== 'undefined' ? globalThis : this);
