/* SaveVid.net — MV3 service worker. Classic script, no build step, no deps. */
'use strict';

/* ------------------------------------------------------------------ *
 * CONFIG — the ONE constant to change for a deployed backend.
 * ------------------------------------------------------------------ */
var API_ORIGIN = 'https://savevid.net';

var MENU_ID = 'savevid-download';
var SESSION_KEY = 'savevidProgress';

function store(key, value) {
  try {
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.set({ [key]: value });
      return;
    }
  } catch (_) { /* fall through */ }
  try { chrome.storage.local.set({ [key]: value }); } catch (_) { /* ignore */ }
}

function clearStore(key) {
  try {
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(key);
      return;
    }
  } catch (_) { /* fall through */ }
  try { chrome.storage.local.remove(key); } catch (_) { /* ignore */ }
}

function sessionGet(key) {
  return new Promise(function (resolve) {
    try {
      var area = (chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
      area.get([key], function (items) { resolve(items ? items[key] : null); });
    } catch (_) { resolve(null); }
  });
}

/* ---------------------------- context menu ---------------------------- */

function createMenu() {
  if (!chrome.contextMenus) return;
  try { chrome.contextMenus.removeAll(function () { /* noop */ }); } catch (_) { /* noop */ }
  try {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Download with SaveVid.net',
      contexts: ['video', 'link']
    });
  } catch (_) { /* already exists */ }
}

chrome.runtime.onInstalled.addListener(function (details) {
  createMenu();
  if (details && details.reason === 'install') {
    store(SESSION_KEY, { state: 'installed', at: Date.now() });
  }
});

chrome.runtime.onStartup.addListener(function () { createMenu(); });

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (!info || info.menuItemId !== MENU_ID) return;
    var raw = info.srcUrl || info.linkUrl || (tab && tab.url) || '';
    var url = info.mediaSrcUrl || raw;
    store(SESSION_KEY, { state: 'queued', url: url, at: Date.now() });
    // Open the popup's flow by opening a small window is not possible for an
    // action popup, so we probe here and download the best available format.
    probeAndDownload(url, 'Best available').catch(function () { /* surfaced in popup */ });
  });
}

/* ------------------------------ messaging ----------------------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  if (msg.type === 'download') {
    doDownload(msg.url, msg.fid, msg.name)
      .then(function (info) { sendResponse({ ok: true, info: info }); })
      .catch(function (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : 'download failed' });
      });
    return true; // async
  }
  if (msg.type === 'probe') {
    fetch(API_ORIGIN + '/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: msg.url, vid: msg.vid || '' })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { sendResponse({ ok: true, data: d }); })
      .catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
    return true;
  }
  if (msg.type === 'progress') {
    store(SESSION_KEY, msg.payload || {});
    sendResponse({ ok: true });
  }
  return false;
});

/* ------------------------------ downloads ----------------------------- */

function streamUrl(url, fid, name) {
  return API_ORIGIN + '/api/stream?url=' + encodeURIComponent(url) +
    '&fid=' + encodeURIComponent(fid || '') +
    '&name=' + encodeURIComponent(name || 'savevid-download');
}

function safeName(name) {
  return String(name || 'savevid-download').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function doDownload(url, fid, name) {
  if (!url) return Promise.reject(new Error('missing url'));
  var filename = safeName(name);
  var progress = { state: 'downloading', url: url, name: filename, at: Date.now() };
  store(SESSION_KEY, progress);

  return fetch(streamUrl(url, fid, filename))
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var len = Number(res.headers.get('Content-Length')) || 0;
      if (!res.body || !res.body.getReader || !len) {
        return res.blob();
      }
      var reader = res.body.getReader();
      var chunks = [];
      var got = 0;
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(chunks);
          chunks.push(r.value);
          got += r.value.length;
          store(SESSION_KEY, {
            state: 'downloading', url: url, name: filename,
            received: got, total: len, pct: Math.round((got / len) * 100)
          });
          return pump();
        });
      })();
    })
    .then(function (blob) {
      var objUrl = URL.createObjectURL(blob);
      return new Promise(function (resolve) {
        chrome.downloads.download({ url: objUrl, saveAs: false, filename: filename }, function (id) {
          // Revoke only after Chrome has picked the blob up.
          setTimeout(function () { URL.revokeObjectURL(objUrl); }, 60000);
          if (chrome.runtime.lastError) {
            clearStore(SESSION_KEY);
            resolve({ id: null, name: filename, bytes: blob.size });
            return;
          }
          store(SESSION_KEY, { state: 'saved', downloadId: id, name: filename, bytes: blob.size, at: Date.now() });
          resolve({ id: id, name: filename, bytes: blob.size });
        });
      });
    })
    .catch(function (err) {
      store(SESSION_KEY, { state: 'error', url: url, name: filename, error: String(err && err.message) });
      throw err;
    });
}

function probeAndDownload(url, label) {
  return fetch(API_ORIGIN + '/api/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url, vid: '' })
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var row = (Array.isArray(data.video) && data.video[0]) ||
        (Array.isArray(data.audio) && data.audio[0]);
      if (!row) throw new Error('no formats available');
      var ext = (row.ext || 'mp4').toLowerCase();
      var name = safeName((data.title || 'savevid') + '.' + ext);
      return doDownload(url, row.fid, name);
    });
}

/* ------------------------- download bookkeeping ----------------------- */

if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener(function (delta) {
    if (!delta || !delta.state) return;
    sessionGet(SESSION_KEY).then(function (cur) {
      if (!cur || !cur.downloadId || cur.downloadId !== delta.id) return;
      var next = Object.assign({}, cur, { state: String(delta.state.current), at: Date.now() });
      store(SESSION_KEY, next);
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        clearStore(SESSION_KEY);
      }
    });
  });
}

// Safe no-op: the popup is declared in the manifest, so onClicked never fires.
// If it ever does (e.g. a future headless mode), just open the popup source.
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(function () {
    store(SESSION_KEY, { state: 'clicked', at: Date.now() });
  });
}
