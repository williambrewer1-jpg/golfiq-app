// Offline cache for the app shell (code only - your golf data lives in IndexedDB, not here).
const CACHE = 'golfiq-v26';
const SHELL = ['./', 'index.html', 'app.js', 'analytics.js', 'store.js', 'sync.js', 'baseline.js', 'bookmarklet.js', 'features.js', 'pages2.js', 'play.js', 'holemap.js', 'strategy.js', 'bench.js', 'sidegames.js', 'cloud.js', 'compete.js', 'friends.js', 'coach.js', 'progress.js', 'skills.js', 'games.js', 'guided.js', 'feel.js', 'charts.js', 'sessions.js', 'level.js', 'payoff.js', 'journey.js', 'boss.js', 'challenges.js', 'skillstest.js', 'league.js', 'aicoach.js', 'wallpaper.js', 'icons.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const LIB = 'golfiq-lib-v1';   // the chart library (Plotly): fetched the first time a page needs it, then kept across app updates
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => fetch(u, { cache: 'reload' }).then((r) => r.ok ? c.put(u, r) : null)))).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== LIB).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // only the app's own files and the pinned chart library are handled here; every other request (GitHub, weather, maps) goes straight to the network
  if (e.request.method !== 'GET' || (u.origin !== self.location.origin && u.hostname !== 'cdn.jsdelivr.net')) return;
  // network first for our own files (so updates arrive), cache fallback offline; cache first (and kept after the first download) for the pinned Plotly build
  if (u.hostname === 'cdn.jsdelivr.net') { e.respondWith(caches.open(LIB).then(async (c) => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; })); return; }
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
