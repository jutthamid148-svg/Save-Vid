# SaveVid.net

A fast, free video downloader for YouTube and 8 more platforms. No signup, no
watermark, no limits — paste a link, get a file.

## What is here

| Path | What it is |
| --- | --- |
| `web/` | The site. Static HTML/CSS/JS, installable as a PWA. |
| `server.js` | Zero-dependency backend (`node:http` + built-in `fetch`). Static serving, rate limiting, and the `/api` routes. |
| `api/index.js` | Vercel entry point. Mounts the same handler. |
| `vercel.json` | Routes every non-`/api` path into the function, plus cache and security headers. |
| `extension/` | Chrome MV3 extension (MV3 service worker, `chrome.downloads`). |
| `main.js`, `preload.js`, `ai.js`, `renderer/`, `resources/` | The Electron desktop app. |

## Running locally

```bash
node server.js          # http://localhost:8899
PORT=3000 node server.js
```

`server.js` starts a listener only when it is run directly, so requiring it
never opens a port. That is what lets `api/index.js` reuse it unchanged.

## Deploying

The site is a Vercel project: **https://savevid-sigma.vercel.app**

`vercel.json` rewrites every path that is not under `/api/` into the function
(`/((?!api/).*)`). Static files are served from `web/` by the same handler that
runs locally, so production and local cannot drift, and `robots.txt` and
`sitemap.xml` are generated dynamically rather than going stale.

Everything goes through the function rather than the CDN deliberately: the
download relay at `/api/stream` has to set `Content-Disposition` so the browser
names the saved file, and a Vercel rewrite would strip that header.

One setting matters: `WEB_ROOT` is set in `api/index.js` because `__dirname` is
`/var/task/api` there, not the project root.

Deploy with the CLI from the project root:

```bash
vercel --prod --yes --name savevid
```

`--name` is required here: without it the CLI derives the project name from the
folder path, which contains spaces and capitals, and Vercel rejects it.

## Design notes

- **Zero runtime dependencies.** The backend uses only Node built-ins, so there
  is no install step and no supply chain to audit on a server that fetches URLs
  from strangers.
- **`sw.js` and `manifest.webmanifest` are never cached** at any layer. A long
  `max-age` on the service worker pins every visitor to whichever version first
  fetched it, and a fix on the server would never reach anyone.
- **`/api/` is never cached by the service worker.** Download responses are
  large, unique, and one-shot.
- **The downloader only relays media you have the right to save.** The site
  carries a copyright notice in the footer and every legal page says so.

## Legal

Privacy, Terms, DMCA and About live in `web/` as real pages, not a template, so
they are crawlable and indexable. Cross-links between them are in each footer.
