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

// v2: styles.css went from hand-written 14.5KB to 43.9KB compiled Tailwind.
// Not a routine bump. A v1 client holding the old stylesheet would serve it
// stale-while-revalidate on first paint, and that old file contains none of the
// compiled utility classes the new HTML depends on -- the CDN script it used to
// pull them in is gone. The page would render completely unstyled until the
// revalidate landed. Bumping VERSION drops those caches outright.
// v4: the mobile app shell (glass panels, mode tabs, highlight carousel).
// v5: app.js changed on the download path -- the duplicate streamDownload
// pointed at a route the server does not serve, and the filename sanitizer
// mangled every name. Both are inside a stale-while-revalidated cache, so
// without this bump a returning visitor keeps clicking a download that
// silently does nothing.
// v7: the mobile redesign. index.html gains the bottom nav, the carousel
// autoplay toggle and the play/duration overlay on the preview thumbnail; the
// Vimeo marquee path is replaced with a valid one; app.js drives the bottom
// nav from setMode so it cannot disagree with the tab strip.
// v8: the supported-platforms grid. index.html replaces the platform marquee
// with eight brand-badge cards, relabels the bottom nav to Downloader /
// Formats / Sites / Settings and adds the settings sheet; app.js gains the
// sheet wiring. All three sit behind stale-while-revalidate, so without this
// bump a returning visitor gets the new stylesheet against the old markup.
// v9: the platform icons were sized off a dead `.plat-ico` selector, so the
// SVGs fell back to the 300x150 replaced-element default and blew past their
// badges; the class is now `.pl-ico`. The highlights carousel gets a negative-
// margin gutter so its cards end inside the box instead of bleeding to the
// section edge, the Facebook tile is the official #1877F2, and the TikTok/X
// badges flip their mark polarity per theme. index.html and styles.css both
// changed, so the bump is required.
// v10: the highlights carousel stops showing stats and now shows the site's own
// platform logos, one card per supported site, reusing the .plat-card markup from
// the grid below so the brand tint and light/dark mark polarity stay in sync.
// index.html changed, so the bump is required.
const VERSION = 'v10';
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
