/* SaveVid.net — defensive content script.
 * Adds no visible UI, touches no page styles or layout. */
(function () {
  'use strict';

  if (window.__savevidLoaded) return;
  window.__savevidLoaded = true;

  var ANCHOR_ID = '__savevid_anchor__';

  // Known per-site selectors for the actual media element, used only as a
  // last-resort hint (we never touch the page, we only read attributes).
  var SELECTORS = {
    youtube: ['meta[itemprop="videoId"]', 'link[rel="canonical"]', 'ytd-watch-flexy video'],
    tiktok: ['link[rel="canonical"]', 'meta[property="og:video"]', 'video'],
    instagram: ['meta[property="og:video"]', 'link[rel="canonical"]', 'video'],
    facebook: ['meta[property="og:video"]', 'link[rel="canonical"]', 'video'],
    x: ['link[rel="canonical"]', 'meta[property="og:url"]'],
    soundcloud: ['link[rel="canonical"]', 'meta[property="og:url"]'],
    vimeo: ['link[rel="canonical"]', 'meta[property="og:url"]'],
    dailymotion: ['link[rel="canonical"]', 'meta[property="og:video"]', 'video']
  };

  function platform() {
    var h = location.hostname.replace(/^www\./, '');
    if (/youtu/.test(h)) return 'youtube';
    if (/tiktok/.test(h)) return 'tiktok';
    if (/instagram/.test(h)) return 'instagram';
    if (/facebook|fb\.watch/.test(h)) return 'facebook';
    if (/(^|\.)x\.com$/.test(h) || /twitter/.test(h)) return 'x';
    if (/soundcloud/.test(h)) return 'soundcloud';
    if (/vimeo/.test(h)) return 'vimeo';
    if (/dailymotion/.test(h)) return 'dailymotion';
    return null;
  }

  function attr(selector, name) {
    try {
      var n = document.querySelector(selector);
      return n ? n.getAttribute(name) : null;
    } catch (_) { return null; }
  }

  function canonicalUrl() {
    var pf = platform();
    var list = SELECTORS[pf] || ['link[rel="canonical"]'];

    var canonical = attr('link[rel="canonical"]', 'href');
    if (canonical) return new URL(canonical, location.href).href;

    var ogUrl = attr('meta[property="og:url"]', 'content');
    if (ogUrl) return new URL(ogUrl, location.href).href;

    var ogVideo = attr('meta[property="og:video:url"]', 'content') ||
      attr('meta[property="og:video"]', 'content');
    if (ogVideo && /^https?:/.test(ogVideo)) return ogVideo;

    // Per-site fallbacks (read-only).
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s === 'link[rel="canonical"]' || s.indexOf('meta') === 0) continue;
      var v = attr(s, 'content') || attr(s, 'src');
      if (v && /^https?:/.test(v)) return v;
    }
    return location.href.split('#')[0];
  }

  /* Offscreen hidden anchor used as a navigation-download fallback. It is
   * positioned off-canvas and carries no styling that could affect layout. */
  function anchor() {
    var a = document.getElementById(ANCHOR_ID);
    if (a) return a;
    a = document.createElement('a');
    a.id = ANCHOR_ID;
    a.setAttribute('aria-hidden', 'true');
    a.tabIndex = -1;
    a.style.cssText =
      'position:absolute!important;left:-99999px!important;top:-99999px!important;' +
      'width:1px!important;height:1px!important;opacity:0!important;' +
      'pointer-events:none!important;display:block!important;';
    a.download = '';
    try {
      (document.body || document.documentElement).appendChild(a);
    } catch (_) { /* ignore */ }
    return a;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'savevid:canonical') {
      try { sendResponse({ url: canonicalUrl(), platform: platform() }); } catch (_) { sendResponse({ url: null }); }
      return false;
    }
    if (msg.type === 'savevid:navigate-download') {
      // Fallback path: hand the browser a real navigation to the media URL.
      try {
        var a = anchor();
        a.href = msg.href || '';
        a.download = msg.name || '';
        a.click();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return false;
    }
    if (msg.type === 'savevid:ping') {
      sendResponse({ ok: true, loaded: !!window.__savevidLoaded });
      return false;
    }
    return false;
  });
})();
