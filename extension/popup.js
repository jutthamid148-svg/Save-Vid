/* SaveVid.net — popup logic (classic script, no build step, no deps). */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * CONFIG — the ONE constant to change for a deployed backend.
   * ------------------------------------------------------------------ */
  var API_ORIGIN = 'https://savevid.net';

  var QUICK = [
    { label: '1080p', fid: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]', ext: 'mp4' },
    { label: '720p', fid: 'bestvideo[height<=720]+bestaudio/best[height<=720]', ext: 'mp4' },
    { label: '480p', fid: 'bestvideo[height<=480]+bestaudio/best[height<=480]', ext: 'mp4' },
    { label: '360p', fid: 'bestvideo[height<=360]+bestaudio/best[height<=360]', ext: 'mp4' },
    { label: 'MP3', fid: 'bestaudio', ext: 'mp3', audio: true }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    panel: $('panel'), thumb: $('thumb'), thumbFallback: $('thumbFallback'),
    title: $('title'), submeta: $('submeta'),
    quick: $('quick'), quickGrid: $('quickGrid'),
    formats: $('formats'), videoGrid: $('videoGrid'), audioGrid: $('audioGrid'),
    urlInput: $('urlInput'), goBtn: $('goBtn'),
    status: $('status'), progressWrap: $('progressWrap'),
    progressBar: $('progressBar'), progressText: $('progressText'),
    themeBtn: $('themeBtn')
  };

  var state = { url: '', vid: '', data: null, busy: false };

  /* ---------------------------- URL parsing ---------------------------- */

  function safeUrl(raw) {
    try { return new URL(raw); } catch (_) { return null; }
  }

  // Returns { platform, url, vid } or null.
  function parseUrl(raw) {
    if (!raw) return null;
    var u = safeUrl(String(raw).trim());
    if (!u) return null;
    var host = u.hostname.replace(/^www\./, '').toLowerCase();
    var p = u.pathname, q = u.search, v = null, vid = '';

    if (host === 'youtu.be') {
      vid = p.slice(1).split('/')[0];
      return vid ? { platform: 'youtube', url: 'https://www.youtube.com/watch?v=' + vid, vid: vid } : null;
    }
    if (/youtube\.com$/.test(host)) {
      if (p === '/watch') { vid = u.searchParams.get('v') || ''; }
      else if (p.indexOf('/shorts/') === 0) { vid = p.split('/')[2] || ''; }
      else if (p.indexOf('/embed/') === 0) { vid = p.split('/')[2] || ''; }
      else if (p.indexOf('/live/') === 0) { vid = p.split('/')[2] || ''; }
      else return null;
      if (!/^[\w-]{6,}$/.test(vid)) return null;
      return { platform: 'youtube', url: 'https://www.youtube.com/watch?v=' + vid, vid: vid };
    }
    if (/tiktok\.com$/.test(host)) {
      var m = p.match(/^\/@[^/]+\/video\/(\d+)/) || p.match(/^\/v\/(\d+)/);
      if (!m) return null;
      return { platform: 'tiktok', url: 'https://www.tiktok.com' + p, vid: m[1] };
    }
    if (/instagram\.com$/.test(host)) {
      var im = p.match(/^\/(reel|reels|p|tv|embed)\/([\w-]+)/);
      if (!im) return null;
      return { platform: 'instagram', url: 'https://www.instagram.com/' + im[1] + '/' + im[2] + '/', vid: im[2] };
    }
    if (host === 'fb.watch') {
      return { platform: 'facebook', url: u.href, vid: u.href };
    }
    if (/facebook\.com$/.test(host)) {
      var fm = p.match(/^\/(?:[^/]+\/videos|watch|reel|reels|share|video)\/?(\d+)?/);
      var id = (fm && fm[1]) || u.searchParams.get('v') || '';
      if (!id) return null;
      return { platform: 'facebook', url: 'https://www.facebook.com/watch/?v=' + id, vid: id };
    }
    if (/(^|\.)x\.com$/.test(host) || /twitter\.com$/.test(host)) {
      var xm = p.match(/^\/([^/]+)\/status\/(\d+)/);
      if (!xm) return null;
      return { platform: 'x', url: 'https://x.com' + p, vid: xm[2] };
    }
    if (/soundcloud\.com$/.test(host)) {
      if (!/\/[^/]+\/[^/]+\/?$/.test(p)) return null;
      return { platform: 'soundcloud', url: 'https://soundcloud.com' + p, vid: p };
    }
    if (/vimeo\.com$/.test(host)) {
      var vm = p.match(/\/(\d{6,})/);
      if (!vm) return null;
      return { platform: 'vimeo', url: 'https://vimeo.com/' + vm[1], vid: vm[1] };
    }
    if (/dailymotion\.com$/.test(host)) {
      var dm = p.match(/\/video\/([a-z0-9]+)/i);
      if (!dm) return null;
      return { platform: 'dailymotion', url: 'https://www.dailymotion.com/video/' + dm[1], vid: dm[1] };
    }
    return null;
  }

  /* ------------------------------- UI ---------------------------------- */

  function setStatus(msg, kind) {
    el.status.classList.remove('hidden', 'error', 'ok', 'busy');
    if (!msg) { el.status.classList.add('hidden'); return; }
    el.status.textContent = msg;
    if (kind) el.status.classList.add(kind);
  }

  function setProgress(pct) {
    el.progressWrap.classList.remove('hidden');
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    el.progressBar.style.width = p + '%';
    el.progressText.textContent = p + '%';
  }

  function hideProgress() { el.progressWrap.classList.add('hidden'); }

  function makeButton(row, onClick) {
    var b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    var r = document.createElement('span');
    r.className = 'r';
    r.textContent = row.label || row.fid || 'Format';
    var m = document.createElement('span');
    m.className = 'm';
    var bits = [];
    if (row.ext) bits.push(row.ext.toUpperCase());
    if (row.size) bits.push(row.size);
    if (row.abr) bits.push(row.abr);
    m.textContent = bits.join(' • ') || row.fid || '';
    b.appendChild(r); b.appendChild(m);
    b.addEventListener('click', function () { onClick(row); });
    return b;
  }

  function renderQuick() {
    el.quickGrid.textContent = '';
    QUICK.forEach(function (q) {
      el.quickGrid.appendChild(makeButton(q, function () { startDownload(q, q.label); }));
    });
    el.quick.classList.remove('hidden');
  }

  function renderFormats(data) {
    var v = Array.isArray(data.video) ? data.video : [];
    var a = Array.isArray(data.audio) ? data.audio : [];
    el.videoGrid.textContent = '';
    el.audioGrid.textContent = '';
    v.forEach(function (row) {
      el.videoGrid.appendChild(makeButton(row, function () { startDownload(row, row.label); }));
    });
    a.forEach(function (row) {
      el.audioGrid.appendChild(makeButton(row, function () { startDownload(row, row.label); }));
    });
    if (!v.length && !a.length) {
      setStatus('No formats returned for this link. Try a different link.', 'error');
      el.formats.classList.add('hidden');
      return;
    }
    el.formats.classList.remove('hidden');
  }

  function renderMeta(data) {
    el.title.textContent = data.title || 'Detected video';
    el.submeta.textContent = [data.platform, data.uploader].filter(Boolean).join(' • ') || 'Ready';
    el.thumb.classList.remove('show');
    if (data.thumbnail) {
      el.thumb.src = data.thumbnail;
      el.thumb.classList.add('show');
      el.thumb.onerror = function () { el.thumb.classList.remove('show'); };
    }
    el.panel.classList.remove('hidden');
  }

  /* ----------------------------- Backend ------------------------------- */

  function probe(parsed) {
    if (state.busy) return;
    state.busy = true;
    setStatus('Reading link…', 'busy');
    el.goBtn.disabled = true;

    var body = JSON.stringify({ url: parsed.url, vid: parsed.vid });
    fetch(API_ORIGIN + '/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (res) {
      if (!res.ok) throw new Error('Backend returned HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      state.busy = false;
      el.goBtn.disabled = false;
      state.data = data;
      renderMeta(data);
      renderFormats(data);
      setStatus('Choose a quality to download.', 'ok');
    }).catch(function (err) {
      state.busy = false;
      el.goBtn.disabled = false;
      el.formats.classList.add('hidden');
      setStatus(
        'Could not reach the SaveVid.net backend (' + (err && err.message ? err.message : 'network error') +
        '). Check that ' + API_ORIGIN + ' is running, or paste a link below.',
        'error'
      );
    });
  }

  function filenameFor(row, fallbackLabel) {
    var base = 'savevid-' + (state.vid || 'video').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    var ext = (row.ext || (fallbackLabel === 'MP3' ? 'mp3' : 'mp4')).toLowerCase();
    return base + '-' + String(fallbackLabel || row.label || 'video').replace(/[^\w.]/g, '') + '.' + ext;
  }

  function startDownload(row, label) {
    if (state.busy) return;
    if (!state.url) {
      setStatus('Load a link first.', 'error');
      return;
    }
    state.busy = true;
    setProgress(0);
    setStatus('Downloading ' + (label || row.label || 'file') + '…', 'busy');
    document.querySelectorAll('.btn').forEach(function (b) { b.disabled = true; });

    var name = filenameFor(row, label);
    var streamUrl = API_ORIGIN + '/api/stream?url=' + encodeURIComponent(state.url) +
      '&fid=' + encodeURIComponent(row.fid || '') +
      '&name=' + encodeURIComponent(name);

    fetch(streamUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var len = Number(res.headers.get('Content-Length')) || 0;
        return readWithProgress(res, len).then(function (blob) {
          return { blob: blob, name: name };
        });
      })
      .then(function (out) {
        var objUrl = URL.createObjectURL(out.blob);
        var a = document.createElement('a');
        a.href = objUrl;
        a.download = out.name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          a.remove();
          URL.revokeObjectURL(objUrl);
        }, 4000);
        setProgress(100);
        setStatus('Saved ' + out.name, 'ok');
        done();
      })
      .catch(function (err) {
        setStatus('Download failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
        hideProgress();
        done();
      });

    function done() {
      state.busy = false;
      document.querySelectorAll('.btn').forEach(function (b) { b.disabled = false; });
    }
  }

  function readWithProgress(res, total) {
    if (!res.body || !res.body.getReader || !total) {
      return res.blob();
    }
    var reader = res.body.getReader();
    var chunks = [];
    var received = 0;
    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          return new Blob(chunks);
        }
        chunks.push(r.value);
        received += r.value.length;
        setProgress((received / total) * 100);
        return pump();
      });
    })();
  }

  /* ------------------------------ Wiring -------------------------------- */

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function initTheme() {
    try {
      chrome.storage.local.get(['theme'], function (items) {
        applyTheme(items && items.theme);
      });
    } catch (_) { applyTheme(null); }

    el.themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      if (!cur) {
        cur = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = cur === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { chrome.storage.local.set({ theme: next }); } catch (_) { /* ignore */ }
    });
  }

  function useLink(raw) {
    var parsed = parseUrl(raw);
    if (!parsed) {
      setStatus('That link is not a supported video page. Paste a full video URL.', 'error');
      el.panel.classList.add('hidden');
      el.formats.classList.add('hidden');
      return;
    }
    state.url = parsed.url;
    state.vid = parsed.vid;
    el.urlInput.value = parsed.url;
    setStatus('Link detected: ' + parsed.platform, null);
    probe(parsed);
  }

  function init() {
    initTheme();
    renderQuick();

    el.goBtn.addEventListener('click', function () {
      useLink(el.urlInput.value);
    });
    el.urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); useLink(el.urlInput.value); }
    });

    try {
      chrome.storage.local.get(['lastUrl'], function (items) {
        if (items && items.lastUrl) el.urlInput.value = items.lastUrl;
      });
    } catch (_) { /* ignore */ }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.url) { setStatus('Paste a link below to get started.', null); return; }

      var parsed = parseUrl(tab.url);
      if (!parsed) {
        setStatus('No supported video detected on this page. Paste a link below.', null);
        return;
      }

      state.url = parsed.url;
      state.vid = parsed.vid;
      el.urlInput.value = parsed.url;
      try { chrome.storage.local.set({ lastUrl: parsed.url }); } catch (_) { /* ignore */ }

      // Ask the page for its canonical URL (SPA-safe) before probing.
      askContentForCanonical(tab.id).then(function (canonical) {
        if (canonical && parseUrl(canonical)) {
          var cp = parseUrl(canonical);
          state.url = cp.url;
          state.vid = cp.vid;
          el.urlInput.value = cp.url;
        }
        setStatus('Video detected: ' + parsed.platform, null);
        probe(parseUrl(canonical && parseUrl(canonical) ? canonical : parsed.url));
      });
    });
  }

  function askContentForCanonical(tabId) {
    return new Promise(function (resolve) {
      if (tabId == null) return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, { type: 'savevid:canonical' }, function (res) {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res && res.url ? res.url : null);
        });
      } catch (_) { resolve(null); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
