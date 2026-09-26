# SaveVid.net — Chrome Extension (Manifest V3)

A dependency-free browser extension that adds a **SaveVid.net** panel to YouTube, TikTok,
Instagram, Facebook, X, SoundCloud, Vimeo and Dailymotion. It probes the SaveVid backend
for available formats, then downloads the selected one.

There is **no build step**. Everything is plain ES2020 that Chrome runs natively.

---

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest: permissions, host permissions, service worker, content script, CSP |
| `popup.html` | Popup markup |
| `popup.css` | Popup styles (light/dark via `prefers-color-scheme`) |
| `popup.js` | URL detection, probe call, format grid, streamed download with progress |
| `background.js` | Service worker: context menu, message relay, `chrome.downloads`, session progress |
| `content.js` | Injected at `document_idle`; reports the canonical URL, no page-visible UI |
| `logo.svg` | Brand logo (referenced by the manifest, popup and README) |

---

## Load unpacked

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder (this one)
5. Pin **SaveVid.net** to the toolbar

After any edit to a file in this folder, press the ⟳ reload button on the extension card.

---

## Pointing at a deployed backend

There is exactly **one** thing to change per file:

```js
var API_ORIGIN = 'http://localhost:8899';
```

- `popup.js` → `API_ORIGIN`
- `background.js` → `API_ORIGIN`

`content.js` has no backend constant.

Swap `http://localhost:8899` for your production origin, e.g.

```js
var API_ORIGIN = 'https://savevid.net';
```

`localhost` will **not** work once the extension is loaded on a machine other than the one
running the backend, and it will not work at all against a deployed site.

If the new origin differs from the hosts already listed in `manifest.json`, add it to
`host_permissions` too — the extension cannot `fetch` an origin it has no permission for:

```json
"host_permissions": ["https://api.your-domain.com/*"]
```

---

## Expected backend API

- `POST /api/probe` → `{ url, vid }` in; `{ video: [...], audio: [...], title, thumbnail, uploader, platform }` out
- `GET /api/stream?url=&fid=&name=` → the media bytes (this is what is downloaded)

No API keys or secrets live in this extension. Keep provider credentials server-side.

---

## How the download works

The popup fetches `/api/stream` and reads the response with a `ReadableStream` reader,
reporting a percentage from `Content-Length`, then converts the body to a `Blob`,
wraps it in `URL.createObjectURL`, clicks a temporary `<a download>`, and revokes the URL.
This works in an extension context because the extension holds a host permission for the
backend — a normal web page would be blocked by CORS.

The service worker performs the same flow for context-menu downloads and hands the blob to
`chrome.downloads.download({ saveAs: false })`. It writes progress to `chrome.storage.session`
so state survives the service worker being killed mid-download.

`content.js` only reads metadata and creates a single off-canvas anchor used as a
navigation fallback. It never inserts visible UI, and never modifies page styles or layout.

---

## Use responsibly

SaveVid.net is a general-purpose utility. Only download content you created or have the
rights to. The extension contains no DRM circumvention and no copyrighted material.

---

© SaveVid.net
