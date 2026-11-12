// Offline cache for the app shell (code only - your golf data lives in IndexedDB, not here).
const CACHE = 'golfiq-v4';
const SHELL = ['./', 'index.html', 'app.js', 'analytics.js', 'store.js', 'sync.js', 'baseline.js', 'bookmarklet.js', 'features.js', 'pages2.js', 'icons.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // only the app's own files and the pinned chart library are handled here; every other request (GitHub, weather, maps) goes straight to the network
  if (e.request.method !== 'GET' || (u.origin !== self.location.origin && u.hostname !== 'cdn.jsdelivr.net')) return;
  // network first for our own files (so updates arrive), cache fallback offline; cache first for the pinned Plotly build
  if (u.hostname === 'cdn.jsdelivr.net') { e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request))); return; }
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
