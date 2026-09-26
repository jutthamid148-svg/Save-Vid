// SaveVid.net service worker.
//
// Strategy, in one line each:
//   navigations  -> network first, cache as fallback (so deploys land, and the
//                   app still opens when the network does not)
//   static css/js-> stale-while-revalidate (instant paint, quiet background update)
//   /api/*       -> never cached, always network (a stale video list is a bug,
//                   and responses are large and per-user)
//   everything else (including googlevideo ranges) -> untouched, straight to network
//
// Bump CACHE when any of these files change, or users keep the old copy forever.

const VERSION = 'v1';
const SHELL = `savevid-shell-${VERSION}`;
const ASSETS = `savevid-assets-${VERSION}`;

const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html',
  '/privacy.html',
  '/terms.html',
  '/dmca.html',
  '/about.html',
  '/contact.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // addAll is atomic: one 404 would reject the whole install and the worker
    // would never activate. Add individually so a single missing optional asset
    // cannot leave the app with no offline support at all.
    await Promise.all(PRECACHE.map((u) => shell.add(u).catch(() => {})));
    const assets = await caches.open(ASSETS);
    await Promise.all(
      ['/styles.css', '/app.js', '/logo.svg', '/manifest.webmanifest']
        .map((u) => assets.add(u).catch(() => {}))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only ever handle our own origin. Range requests to a CDN must go untouched.
  if (url.origin !== self.location.origin) return;

  // Never cache the API: the answers are per-video, large, and go stale in minutes.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/file/')) return;

  // Downloads are triggered by navigating a hidden iframe to /api/stream. Let it
  // pass straight through; intercepting it would break the Content-Disposition.
  if (req.headers.has('range') || req.destination === 'document' && url.pathname === '/api/stream') return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (/\.(?:css|js|svg|png|jpg|webp|woff2)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);

      const network = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      if (hit) { event.waitUntil(network); return hit; }
      const fresh = await network;
      return fresh || Response.error();
    })());
  }
});
