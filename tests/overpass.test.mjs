// Unit tests for the OpenStreetMap download with fallback servers (features.js overpass). Run: node tests/overpass.test.mjs
import assert from 'node:assert/strict';
import * as F from '../features.js';

let n = 0; const tests = [];
const t = (name, f) => tests.push([name, f]);
const reply = (status, body = { elements: [] }) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fake = (answers) => { const calls = []; const fn = async (url, opt) => { calls.push({ url, opt }); const a = answers[calls.length - 1]; if (a instanceof Error) throw a; return a; }; fn.calls = calls; return fn; };

t('the first server answering is used, and only it is asked', async () => {
  const f = fake([reply(200, { elements: [{ id: 1 }] })]);
  const j = await F.overpass('Q', { fetchFn: f });
  assert.deepEqual(j.elements, [{ id: 1 }]); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, F.OVERPASS_HOSTS[0]); assert.equal(f.calls[0].opt.method, 'POST'); assert.equal(f.calls[0].opt.body, 'data=Q');
});
t('a refusal (406), rate limit (429) or failure moves on to the next server, each asked once', async () => {
  const f = fake([reply(406), reply(429), reply(200, { elements: [{ id: 2 }] })]);
  const j = await F.overpass('Q', { fetchFn: f });
  assert.deepEqual(j.elements, [{ id: 2 }]); assert.deepEqual(f.calls.map((c) => c.url), F.OVERPASS_HOSTS);
});
t('a network error or a reply that is not map data moves on too', async () => {
  const f = fake([new TypeError('Load failed'), reply(200, { remark: 'runtime error' }), reply(200, { elements: [] })]);
  assert.deepEqual((await F.overpass('Q', { fetchFn: f })).elements, []); assert.equal(f.calls.length, 3);
});
t('every server busy: one clear error listing what each said, and no second round of tries', async () => {
  const f = fake([reply(406), reply(504), new TypeError('x')]);
  await assert.rejects(F.overpass('Q', { fetchFn: f }), (e) => e.busy && /map server is busy \(406, 504, offline\)/.test(e.message));
  assert.equal(f.calls.length, F.OVERPASS_HOSTS.length);
});
t('a server that hangs is given up on after the wait and the next one is tried', async () => {
  let k = 0;
  const f = (url, opt) => (k++ === 0 ? new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) : Promise.resolve(reply(200, { elements: [{ id: 3 }] })));
  assert.deepEqual((await F.overpass('Q', { fetchFn: f, waitMs: 20 })).elements, [{ id: 3 }]);
  await assert.rejects(F.overpass('Q', { fetchFn: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))), waitMs: 10, hosts: ['h'] }), /\(timeout\)/);
});
t('a slow server: the next is asked as well after the stagger, the first answer wins and the others are cancelled', async () => {
  const aborted = [], asked = [];
  const f = (url, opt) => { asked.push(url); opt.signal.addEventListener('abort', () => aborted.push(url));
    if (url === F.OVERPASS_HOSTS[0]) return new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    return new Promise((res) => setTimeout(() => res(reply(200, { elements: [{ id: url }] })), url === F.OVERPASS_HOSTS[1] ? 5 : 200)); };
  const tries = [];
  const j = await F.overpass('Q', { fetchFn: f, staggerMs: 20, waitMs: 1000, onTry: (i, n) => tries.push(`${i}/${n}`) });
  assert.deepEqual(j.elements, [{ id: F.OVERPASS_HOSTS[1] }], 'the second server answered first');
  assert.deepEqual(asked, F.OVERPASS_HOSTS.slice(0, 2), 'the third is not asked: the second answered before its turn');
  assert.ok(aborted.includes(F.OVERPASS_HOSTS[0]), 'the slow first server is cancelled'); assert.deepEqual(tries, ['0/3', '1/3']);
});
t('a fast refusal asks the next server straight away, without waiting for the stagger', async () => {
  const t0 = Date.now(), f = fake([reply(406), reply(200, { elements: [] })]);
  await F.overpass('Q', { fetchFn: f, staggerMs: 5000 }); assert.ok(Date.now() - t0 < 1000); assert.equal(f.calls.length, 2);
});
t('the nearby search is a box around you, and courses in its corners (over 40 km) are dropped', () => {
  const q = F.nearbyQuery(-27.47, 153.02), b = F.nearbyBox(-27.47, 153.02);
  assert.ok(!q.includes('around'), q); assert.ok(q.includes(b.map((v) => v.toFixed(5)).join(',')));
  assert.ok(Math.abs((b[2] - b[0]) / 2 * 111320 - 40000) < 1);
  const el = (id, lat, lon) => ({ type: 'way', id, tags: { name: `C${id}` }, center: { lat, lon } });
  const list = F.parseNearby({ elements: [el(1, -27.47, 153.30), el(2, b[2] - 0.001, b[3] - 0.001)] }, -27.47, 153.02);
  assert.deepEqual(list.map((x) => x.name), ['C1'], 'the corner course (about 56 km) is left out');
});
t('the server list: three https servers, the main one first', () => {
  assert.equal(F.OVERPASS_HOSTS.length, 3); assert.ok(F.OVERPASS_HOSTS.every((h) => h.startsWith('https://') && h.endsWith('/api/interpreter')));
  assert.equal(F.OVERPASS_HOSTS[0], 'https://overpass-api.de/api/interpreter');
});

for (const [name, f] of tests) { await f(); n++; console.log('ok', name); }
console.log(`${n} tests passed`);
