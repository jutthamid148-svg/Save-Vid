# SaveVid.net

A fast, free video downloader for YouTube and 8 more platforms. No signup, no
watermark, no limits — paste a link, get a file.

## What is here

| Path | What it is |
| --- | --- |
| `web/` | The site. Static HTML/CSS/JS, installable as a PWA. |
| `server.js` | Zero-dependency backend (`node:http` + built-in `fetch`). Static serving, rate limiting, and the `/api` routes. |
| `api/index.js` | Vercel entry point. Mounts the same handler. |
| `vercel.json` | Routes `/api` and `/file` to the function, everything else to the CDN. |
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

The site is a Vercel project. `vercel.json` sends `/api/*` and `/file/*` to the
serverless function and lets the CDN serve the rest, so no page load touches a
function. One setting matters: `WEB_ROOT` is set in `api/index.js` because
`__dirname` is `/var/task/api` there, not the project root.

Static files in `web/` are also reachable through the function, which is how
`robots.txt` and `sitemap.xml` are generated dynamically.

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
