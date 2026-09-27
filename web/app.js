'use strict';

/* ══════════════════════════════════════════════════════ theme toggle */
const root    = document.documentElement;
const toggle  = document.getElementById('themeToggle');
const knob    = toggle.querySelector('span');
const THEME_KEY = 'loader-theme';

function setTheme(mode) {
  const dark = mode === 'dark';
  root.classList.toggle('dark', dark);
  toggle.setAttribute('aria-checked', String(dark));
  knob.style.transform = dark ? 'translateX(20px)' : 'translateX(0)';
}

const saved = localStorage.getItem(THEME_KEY);
if (saved) {
  setTheme(saved);
} else {
  setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

toggle.addEventListener('click', () => {
  const next = root.classList.contains('dark') ? 'light' : 'dark';
  setTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

/* ═══════════════════════════════════════════════════════ mobile menu */
const menuBtn   = document.getElementById('menuBtn');
const mobileNav = document.getElementById('mobileNav');
const menuIcon  = document.getElementById('menuIcon');

function closeMenu() {
  mobileNav.classList.add('hidden');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuIcon.setAttribute('d', 'M4 7h16M4 12h16M4 17h16');
}

menuBtn.addEventListener('click', () => {
  const opening = mobileNav.classList.contains('hidden');
  mobileNav.classList.toggle('hidden');
  menuBtn.setAttribute('aria-expanded', String(opening));
  menuIcon.setAttribute('d', opening ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16');
});

// Any nav tap closes the sheet; a click outside closes it too.
mobileNav.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
document.addEventListener('click', (e) => {
  if (!mobileNav.classList.contains('hidden')
      && !mobileNav.contains(e.target)
      && !menuBtn.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

/* ══════════════════════════════════════════════ header on scroll */
const header = document.getElementById('siteHeader');

function onScroll() {
  const scrolled = window.scrollY > 8;
  header.classList.toggle('border-slate-200/70', scrolled);
  header.classList.toggle('dark:border-white/10', scrolled);
  header.classList.toggle('shadow-sm', scrolled);
  header.style.background = scrolled
    ? (root.classList.contains('dark') ? 'rgba(7,11,18,.85)' : 'rgba(255,255,255,.85)')
    : '';
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ══════════════════════════════════════════════════════ mode tab strip ═══
   Video / MP3 / Playlist are the same input box pointed at a different tool,
   so switching is a matter of re-picking the format and re-running the probe
   rather than a navigation. The indicator's geometry is measured from the
   live DOM instead of hard-coded, because tab labels change width with the
   viewport and a fixed offset would drift out of alignment on a phone.   */
const modeTabs = document.getElementById('modeTabs');
const segInd   = modeTabs && modeTabs.querySelector('.seg-ind');

// What each tab means, expressed as the two controls it drives. A tab with no
// distinct meaning would be a label that lies, so playlist shares the video
// tab's format and only changes what the probe is asked for.
const MODES = {
  video:    { format: 'mp4',  quality: 'best' },
  audio:    { format: 'mp3',  quality: 'best' },
  playlist: { format: 'mp4',  quality: 'best' }
};

function moveIndicator(tab) {
  if (!segInd || !tab) return;
  segInd.style.setProperty('--seg-w', tab.offsetWidth + 'px');
  segInd.style.setProperty('--seg-x', (tab.offsetLeft - 4) + 'px');
}

function setMode(mode, opts) {
  const m = MODES[mode] || MODES.video;
  fmtSel.value = m.format;
  if (qtySel) qtySel.value = m.quality;

  if (modeTabs) {
    for (const t of modeTabs.querySelectorAll('.seg-tab')) {
      const on = t.dataset.mode === mode;
      t.setAttribute('aria-selected', String(on));
      if (on) moveIndicator(t);
    }
  }

  // The bottom bar mirrors the strip rather than owning the state: both are
  // driven from setMode so they cannot disagree about which mode is live.
  if (bnav) {
    for (const b of bnav.querySelectorAll('.bnav')) {
      const on = b.dataset.mode === mode;
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  // Re-probe only if there is something to re-probe. Switching tab on an
  // empty box should not fire a request or flash the panel.
  if (!opts || !opts.silent) {
    const v = input.value.trim();
    if (looksLikeUrl(v)) probe(v);
  }
  updateEstimate();
}

if (modeTabs) {
  modeTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.seg-tab');
    if (tab) setMode(tab.dataset.mode);
  });

  // Arrow keys, because a tablist that only responds to a pointer is not a
  // tablist to anyone using a keyboard or a switch device.
  modeTabs.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const tabs = [...modeTabs.querySelectorAll('.seg-tab')];
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = tabs[(i + keys[e.key] + tabs.length) % tabs.length];
    next.focus();
    setMode(next.dataset.mode);
  });

  // The first measurement happens after layout; the rest on resize. Measuring
  // in the same tick as the listener registration would read a zero height.
  const measure = () => moveIndicator(modeTabs.querySelector('[aria-selected="true"]'));
  requestAnimationFrame(measure);
  addEventListener('resize', measure, { passive: true });

  // A late webfont changes the label widths under the indicator.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measure).catch(() => {});
  }
}

/* The bottom bar is a second control surface for the same three modes. It
   exists on phones because the top of the screen is a stretch for a thumb,
   and it is hidden from md up where the strip sits right above the input. */
const bnav = document.getElementById('bottomNav');

if (bnav) {
  bnav.addEventListener('click', (e) => {
    const b = e.target.closest('.bnav');
    if (!b) return;

    if (b.dataset.mode) {
      setMode(b.dataset.mode);
      // Bring the input back into view: picking MP3 from the bottom bar while
      // scrolled deep into the page should show the control it just changed.
      const el = document.getElementById('dlCard');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (b.dataset.nav) {
      // "settings" is handled in the capture phase above, by the sheet.
      if (b.dataset.nav === 'settings') return;
      const target = document.getElementById(b.dataset.nav);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

/* ═════════════════════════════════════════════════ highlights carousel ═══
   The track is a native scroll-snap container, so this only has to (a) build
   the dots and (b) read the scroll position back to highlight the right one.
   Reading position off scrollLeft rather than driving a transform means the
   dots cannot desync from the cards: there is no separate animated state to
   fall out of step with the finger.                                     */
const hiTrack = document.getElementById('hiTrack');
const hiDots  = document.getElementById('hiDots');

if (hiTrack && hiDots) {
  const cards = [...hiTrack.querySelectorAll('.hcard')];

  // One dot per card, plus a "trailing" dot so the last one is reachable
  // rather than being stranded in the middle of the row.
  const dots = [];
  for (let i = 0; i < cards.length + 1; i++) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'hdot';
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-label', `Go to highlight ${i + 1}`);
    d.addEventListener('click', () => {
      const left = i < cards.length ? cards[i].offsetLeft - 20 : hiTrack.scrollWidth;
      hiTrack.scrollTo({ left, behavior: 'smooth' });
    });
    hiDots.appendChild(d);
    dots.push(d);
  }

  function activeDot() {
    // The card nearest the left edge is the one the user is looking at; the
    // threshold is half a card so the dot flips at the midpoint of a swipe
    // rather than only once a card is fully settled.
    const edge = hiTrack.scrollLeft + hiTrack.clientWidth * 0.4;
    let n = 0;
    for (let i = 0; i < cards.length; i++) if (cards[i].offsetLeft <= edge) n = i;
    if (hiTrack.scrollLeft + hiTrack.clientWidth >= hiTrack.scrollWidth - 8) n = cards.length;
    return n;
  }

  let dotN = -1;
  function paintDots() {
    const n = activeDot();
    if (n === dotN) return;
    dotN = n;
    dots.forEach((d, i) => {
      d.classList.toggle('on', i === n);
      d.setAttribute('aria-selected', String(i === n));
    });
  }

  hiTrack.addEventListener('scroll', paintDots, { passive: true });
  paintDots();

  /* Auto-advance. Opt-in, remembered, and it stops the moment the user does
     anything at all -- a timer that keeps running under a finger is the
     reason sliders get abandoned. It also pauses off-screen, because an
     offscreen carousel animating is pure battery. */
  const autoBtn = document.getElementById('hiAuto');
  const autoIcon = document.getElementById('hiAutoIcon');
  const PLAY = '<path d="M8 5.2v13.6a.8.8 0 0 0 1.22.68l10.2-6.8a.8.8 0 0 0 0-1.36L9.22 4.52A.8.8 0 0 0 8 5.2Z"/>';
  const PAUSE = '<rect x="7" y="5" width="3.6" height="14" rx="1.1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.1"/>';
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

  let timer = null;
  let wanted = false;

  // Read once per session. A slider the user has deliberately paused should
  // not silently resume on the next page load in the same tab.
  let saved = null;
  try { saved = sessionStorage.getItem('lf:hiAuto'); } catch { /* private mode */ }
  if (saved === '1' && !REDUCED.matches) wanted = true;

  function stop() {
    wanted = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (autoBtn) {
      autoBtn.setAttribute('aria-pressed', 'false');
      if (autoIcon) autoIcon.innerHTML = PLAY;
    }
    try { sessionStorage.setItem('lf:hiAuto', '0'); } catch { /* private mode */ }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      const atEnd = hiTrack.scrollLeft + hiTrack.clientWidth >= hiTrack.scrollWidth - 8;
      if (atEnd) hiTrack.scrollTo({ left: 0, behavior: 'smooth' });
      else {
        const n = activeDot();
        const next = cards[Math.min(n + 1, cards.length - 1)];
        hiTrack.scrollTo({ left: next.offsetLeft - 20, behavior: 'smooth' });
      }
    }, 4200);
  }

  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      if (timer) return stop();
      if (REDUCED.matches) return;      // honour the OS setting, don't argue
      wanted = true;
      autoBtn.setAttribute('aria-pressed', 'true');
      if (autoIcon) autoIcon.innerHTML = PAUSE;
      try { sessionStorage.setItem('lf:hiAuto', '1'); } catch { /* private mode */ }
      start();
    });
  }

  // Any real interaction cancels it.
  for (const ev of ['touchstart', 'pointerdown', 'wheel']) {
    hiTrack.addEventListener(ev, () => { if (wanted) stop(); }, { passive: true });
  }
  hiDots.addEventListener('click', () => { if (wanted) stop(); });

  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting && timer) { clearInterval(timer); timer = null; }
        else if (en.isIntersecting && wanted && !timer) start();
      }
    }, { threshold: 0.25 }).observe(hiTrack);
  }

  if (wanted) {
    autoBtn.setAttribute('aria-pressed', 'true');
    if (autoIcon) autoIcon.innerHTML = PAUSE;
    start();
  }

  // The settings sheet drives the same two functions rather than keeping its
  // own copy of the preference, so the sheet switch and the on-carousel
  // button cannot end up showing different things.
  window.savevidAuto = {
    start, stop,
    on: () => wanted,
    blocked: () => REDUCED.matches
  };
}

/* ═══════════════════════════════════════════════════════ settings sheet */
const sheet = document.getElementById('settings');

if (sheet) {
  const setThemeBtn = document.getElementById('setTheme');
  const setAutoBtn  = document.getElementById('setAuto');
  let lastFocus = null;
  let closing = false;

  function paintSwitches() {
    // aria-checked is the single source of truth: the switch's colour is
    // styled off it, so there is nothing for the two to disagree about.
    if (setThemeBtn) setThemeBtn.setAttribute('aria-checked', String(root.classList.contains('dark')));
    if (setAutoBtn)  setAutoBtn.setAttribute('aria-checked', String(!!(window.savevidAuto && window.savevidAuto.on())));
  }

  function openSheet() {
    closing = false;
    lastFocus = document.activeElement;
    paintSwitches();
    sheet.classList.remove('hidden', 'closing');
    document.body.classList.add('sheet-open');
    // Focus the close button, not the panel: a dialog that focuses its own
    // container reads the whole thing out on some screen readers.
    const close = sheet.querySelector('[data-sheet-close]:not(.sheet-scrim)');
    if (close) close.focus();
  }

  function closeSheet() {
    if (closing) return;
    closing = true;
    document.body.classList.remove('sheet-open');
    const hide = () => { sheet.classList.add('hidden'); sheet.classList.remove('closing'); closing = false; };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) hide();
    else { sheet.classList.add('closing'); setTimeout(hide, 200); }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Anything with this attribute dismisses: the scrim, the X, and a future
  // "Done" button, without each of them re-implementing the close.
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) closeSheet();
  });

  // A modal dialog that leaks focus to the page behind it is not modal.
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last  = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  if (setThemeBtn) {
    setThemeBtn.addEventListener('click', () => {
      setTheme(root.classList.contains('dark') ? 'light' : 'dark');
      localStorage.setItem(THEME_KEY, root.classList.contains('dark') ? 'dark' : 'light');
      paintSwitches();
    });
  }

  if (setAutoBtn) {
    setAutoBtn.addEventListener('click', () => {
      const a = window.savevidAuto;
      if (!a) return;
      // Reduced motion is not a preference to override from a settings panel:
      // the switch stays off and says why.
      if (a.blocked()) return;
      a.on() ? a.stop() : a.start();
      paintSwitches();
    });
  }

  // The bottom bar's Settings tab opens the sheet. Everything else there
  // scrolls to an anchor, so this is the one target that is not an id.
  if (bnav) {
    bnav.addEventListener('click', (e) => {
      const b = e.target.closest('.bnav');
      if (b && b.dataset.nav === 'settings') { e.stopPropagation(); openSheet(); }
    }, true);
  }

  window.savevidSheet = { open: openSheet, close: closeSheet, paint: paintSwitches };
}

/* ═════════════════════════════════════════════════ scroll reveals */
const revealEls = document.querySelectorAll('.reveal');

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  revealEls.forEach((n) => io.observe(n));
} else {
  revealEls.forEach((n) => n.classList.add('in'));
}

/* ═══════════════════════════════════════════ counting stat numbers */
function animateCount(el) {
  const target = Number(el.dataset.count) || 0;
  const suffix = el.dataset.suffix || '';

  if (target === 0) { el.textContent = '0'; return; }

  const dur = 1400;
  const t0 = performance.now();

  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);          // easeOutCubic
    const val = Math.round(target * eased);
    el.textContent = val.toLocaleString('en-US') + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const statNums = document.querySelectorAll('.stat-num');
if ('IntersectionObserver' in window) {
  const sio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      animateCount(e.target);
      sio.unobserve(e.target);
    }
  }, { threshold: 0.5 });
  statNums.forEach((n) => sio.observe(n));
} else {
  statNums.forEach(animateCount);
}

/* ═══════════════════════════════════════════════════ active nav link */
const navLinks = document.querySelectorAll('.nav-link[href^="#"]');
const sections = [...navLinks]
  .map((a) => document.querySelector(a.getAttribute('href')))
  .filter(Boolean);

function highlightNav() {
  const y = window.scrollY + 140;
  let current = sections[0];
  for (const s of sections) if (s.offsetTop <= y) current = s;

  navLinks.forEach((a) => {
    a.classList.toggle('is-active', a.getAttribute('href') === `#${current.id}`);
  });
}
window.addEventListener('scroll', highlightNav, { passive: true });
highlightNav();

/* ══════════════════════════════════════════════════════ downloader */
const input    = document.getElementById('urlInput');
const btn      = document.getElementById('dlBtn');
const label    = document.getElementById('dlLabel');
const fmtSel   = document.getElementById('format');
const qtySel   = document.getElementById('quality');
const barWrap  = document.getElementById('progress');
const bar      = document.getElementById('progressBar');
const barText  = document.getElementById('progressText');
const barPct   = document.getElementById('progressPct');
const errBox   = document.getElementById('dlError');
const card     = document.getElementById('dlCard');
const pasteBtn = document.getElementById('pasteBtn');

// select chevrons tilt on open
for (const [sel, chev] of [[fmtSel, 'fmtChevron'], [qtySel, 'qtyChevron']]) {
  const c = document.getElementById(chev);
  sel.addEventListener('focus', () => { c.style.transform = 'translateY(-50%) rotate(180deg)'; });
  sel.addEventListener('blur',  () => { c.style.transform = 'translateY(-50%) rotate(0deg)'; });
}

function showError(msg) {
  if (msg) {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
    card.classList.add('!border-rose-400');
    setTimeout(() => card.classList.remove('!border-rose-400'), 600);
  } else {
    errBox.classList.add('hidden');
  }
}

function resetProgress() {
  bar.style.width = '0%';
  barPct.textContent = '0%';
  barWrap.classList.add('hidden');
}

function validUrl(v) {
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol);
  } catch {
    return false;
  }
}

// Paste button — clipboard API, with a graceful fallback message.
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      input.value = text.trim();
      showError('');
      input.focus();
    } else {
      showError('Your clipboard is empty.');
    }
  } catch {
    showError('Clipboard access was blocked. Paste with Ctrl+V instead.');
    input.focus();
  }
});


/* ═══════════════════════════════════════════════════════════════ toast */
// Small transient notice. `kind` is 'ok' | 'bad' or omitted for neutral.
function showToast(msg, kind) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }

  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  host.appendChild(t);

  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

/* ═════════════════════════════════════════════════════════════ misc */
/* ══════════════════════════════════════════════ ultra-fast paste → download
   Paste (or focus the box) and the whole flow runs itself: read the clipboard,
   detect the platform, probe the real formats, render one-click options, and
   start the transfer. No Enter key, no Download click. */

const mediaPanel = document.getElementById('mediaPanel');
const optSkeleton = document.getElementById('optSkeleton');
const optList    = document.getElementById('optList');
const optVideo   = document.getElementById('optVideo');
const optAudio   = document.getElementById('optAudio');
const platTag    = document.getElementById('platTag');
const platName   = document.getElementById('platName');
const metaTitle  = document.getElementById('metaTitle');
const metaBy     = document.getElementById('metaBy');
const metaDur    = document.getElementById('metaDur');
const thumb      = document.getElementById('thumb');
const thumbDur   = document.getElementById('thumbDur');
const thumbWrap  = document.getElementById('thumbWrap');
const metaReset  = document.getElementById('metaReset');

// A link we can act on: scheme, host and a path. Checked before any network
// call so a typo never costs a round trip.
const URL_RE = /^https?:\/\/[\w-]+(\.[\w-]+)+(?::\d{2,5})?(?:[/?#]\S*)?$/i;
const looksLikeUrl = (v) => URL_RE.test(v.trim());

// Pull the 11-character YouTube id straight out of the pasted text with a
// regex, before any network call. The server uses it to skip URL parsing and
// go directly to the InnerTube player call. Returns null for every other site.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function ytIdOf(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get('v')
      || (u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?]+)/) || [])[1];
  }
  return id && YT_ID.test(id) ? id : null;
}

let probeToken = 0;    // guards against a slow probe landing after a newer one
let downloading = false;

// Reuse the last probe when the user re-pastes the same video.

// ------------------------------------------------------------------ helpers
function fmtSize(n) {
  if (!n || !isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtDuration(sec) {
  if (!sec) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
           : `${m}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------- estimated file size
   The probe already returns a real byte count for every format, so the
   estimate is a lookup rather than a guess at bitrate. A number the server
   gave us beats a plausible-looking formula, and a wrong one is worse than
   no number at all. Anything with no size attached shows nothing.        */
let probeData = null;

function updateEstimate() {
  const row  = document.getElementById('estRow');
  const cell = document.getElementById('estSize');
  if (!row || !cell) return;

  if (!probeData) { row.classList.add('hidden'); row.classList.remove('flex'); return; }

  const audio = fmtSel && AUDIO_EXTS.has(fmtSel.value);
  const pool  = audio ? (probeData.audio || []) : (probeData.video || []);

  // "Best" means the first row the server ranked highest; a named quality
  // means the one whose label starts with that height. Matching on the label
  // rather than on a stored id keeps this working for every platform, since
  // only YouTube uses the numeric ids the format strings name.
  let hit = null;
  if (qtySel && qtySel.value !== 'best') {
    hit = pool.find((o) => (o.label || '').startsWith(qtySel.value)) || null;
  }
  hit = hit || pool[0] || null;

  if (!hit || !hit.size) { row.classList.add('hidden'); row.classList.remove('flex'); return; }

  cell.textContent = fmtSize(hit.size);
  row.classList.remove('hidden');
  row.classList.add('flex');
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'flac']);

if (fmtSel) fmtSel.addEventListener('change', updateEstimate);
if (qtySel) qtySel.addEventListener('change', updateEstimate);

// Instant client-side platform guess so the tag appears before the probe does.
const CLIENT_PLATFORMS = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube', '#FF0000'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.watch$/, 'Facebook', '#0866FF'],
  [/(^|\.)instagram\.com$/, 'Instagram', '#E4405F'],
  [/(^|\.)tiktok\.com$/, 'TikTok', '#000000'],
  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X', '#000000'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud', '#FF5500'],
  [/(^|\.)vimeo\.com$/, 'Vimeo', '#1AB7EA'],
  [/(^|\.)dailymotion\.com$|(^|\.)dai\.ly$/, 'Dailymotion', '#0066DC'],
  [/(^|\.)reddit\.com$/, 'Reddit', '#FF4500'],
  [/(^|\.)pinterest\./, 'Pinterest', '#E60023']
];

function guessPlatform(raw) {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    for (const [re, name, colour] of CLIENT_PLATFORMS) {
      if (re.test(host)) return { name, colour };
    }
  } catch { /* fall through */ }
  return { name: 'Direct link', colour: '#2f6bff' };
}

function showSkeleton() {
  mediaPanel.classList.remove('hidden');
  optSkeleton.classList.remove('hidden');
  optList.classList.add('hidden');
  optSkeleton.querySelectorAll('.skel-row').forEach((r, i) => {
    r.style.animationDelay = `${i * 120}ms`;
  });
}

function hideSkeleton() {
  optSkeleton.classList.add('hidden');
  optList.classList.remove('hidden');
}

function hidePanel() {
  mediaPanel.classList.add('hidden');
  optList.classList.add('hidden');
  optSkeleton.classList.add('hidden');
  thumbWrap.classList.add('hidden');
  probeData = null;
  updateEstimate();
}

// ------------------------------------------------------------- option cards
function optionButton(o) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'opt';
  b.dataset.id = o.id;
  b.dataset.ext = o.ext || '';
  b.dataset.kind = o.kind;
  b._option = o;
  b.innerHTML = `
    <span class="opt-top">
      <span class="opt-label">${escHtml(o.label)}</span>
      <span class="opt-size">${fmtSize(o.size)}</span>
    </span>
    <span class="opt-bar"><i></i></span>
    <span class="opt-go">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v10.5m0 0 3.8-3.8M12 14l-3.8-3.8M4 16.5v2.2A2.3 2.3 0 0 0 6.3 21h11.4a2.3 2.3 0 0 0 2.3-2.3v-2.2"/></svg>
      <span>${o.kind === 'audio' ? 'Get audio' : 'Download'}</span>
    </span>`;
  b.addEventListener('click', () => startDownload(o, b));
  return b;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* A filename safe on every OS we hand a file to: Windows rejects < > : " / \ |
   ? * and a fixed set of reserved names, macOS and Linux dislike a leading
   dot, and a control character in a name is a question nobody should have to
   answer. The extension is appended by the server, so it is not written here. */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
const ILLEGAL_CHARS = /[<>:"/\\|?*]/g;

function safeFileName(raw, ext) {
  let name = String(raw || '')
    .replace(CONTROL_CHARS, '')
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    // Reserved on Windows regardless of extension: CON, PRN, AUX, NUL, COM1-9,
    // LPT1-9. Naming a download "CON.mp4" silently writes to nowhere.
    .replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i, '_$2')
    .slice(0, 120)
    .trim();

  if (!name) name = 'savevid';
  if (ext) name = name + '.' + String(ext).replace(/[^a-z0-9]/gi, '');
  return name;
}

function renderOptions(meta) {
  // The server contract is a shape, not a promise: a cached entry from an
  // older deploy, a truncated response, or a new platform without a colour all
  // land here. Every field is read defensively so a malformed payload paints a
  // sparse card instead of throwing and leaving a half-drawn panel behind.
  const plat = meta.platform || {};
  platName.textContent = plat.name || 'Video';
  platTag.style.background = plat.colour || '#2f6bff';
  metaTitle.textContent = meta.title || 'Untitled video';
  metaBy.textContent = meta.uploader || '';
  metaDur.textContent = fmtDuration(meta.duration);

  // Same duration as a chip over the still. The text next to the platform tag
  // is the authoritative one; this is the glanceable duplicate a video app
  // puts on the poster itself.
  if (thumbDur) thumbDur.textContent = meta.duration ? fmtDuration(meta.duration) : '';

  if (meta.thumbnail) {
    thumb.src = meta.thumbnail;
    thumbWrap.classList.remove('hidden');
  } else {
    thumbWrap.classList.add('hidden');
  }

  optVideo.replaceChildren(...(meta.video || []).map(optionButton));
  optAudio.replaceChildren(...(meta.audio || []).map(optionButton));

  probeData = meta;
  updateEstimate();

  hideSkeleton();
}

// ------------------------------------------------------------------- probe
async function probe(raw) {
  const token = ++probeToken;

  // Show the tag on the client immediately — the network call is the slow part.
  const guess = guessPlatform(raw);
  platName.textContent = guess.name;
  platTag.style.background = guess.colour;
  metaTitle.textContent = 'Fetching video details…';
  metaBy.textContent = '';
  metaDur.textContent = '';
  thumbWrap.classList.add('hidden');
  showSkeleton();

  // Reveal the panel right away so the eye does not wait on the network.
  mediaPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  btn.disabled = true;
  btn.classList.add('opacity-70', 'cursor-wait');
  label.textContent = 'Fetching…';

  try {
    // Session cache: a re-paste of the same link paints instantly, no request.
    const hit = sessionCache.get(raw);
    if (hit) {
      if (token !== probeToken) return;
      renderOptions(hit);
      label.textContent = 'Download';
      btn.disabled = false;
      btn.classList.remove('opacity-70', 'cursor-wait');
      return;
    }

    // Two requests at once. The quick one paints title + thumbnail as soon as
    // oEmbed answers (well under a second) while the probe is still running,
    // so the panel is never blank while we wait on the format list.
    const vid = ytIdOf(raw);
    const quick = vid
      ? fetch('/api/quick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: raw, vid })
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      : Promise.resolve(null);

    quick.then((q) => {
      if (!q || !q.quick || token !== probeToken) return;
      if (metaTitle.textContent !== 'Fetching video details…') return;  // probe won
      metaTitle.textContent = q.title || metaTitle.textContent;
      metaBy.textContent = q.uploader || '';
      if (q.thumbnail) { thumb.src = q.thumbnail; thumbWrap.classList.remove('hidden'); }
    });

    const res = await fetch('/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: raw, vid })
    });
    // A non-2xx here is a real failure -- a misrouted or crashed backend, not
    // an empty result. Handing `{}` to renderOptions used to throw on
    // meta.platform.name and blank the panel with an unhandled TypeError;
    // it now reports the actual status to the user.
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body && body.error) || `The server returned ${res.status}. Try again in a moment.`);
    }
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('The server sent back something unreadable.');
    if (data.error) throw new Error(data.error);
    if (token !== probeToken) return;          // a newer paste already won

    sessionCache.set(raw, data);
    renderOptions(data);
    label.textContent = 'Download';
  } catch (e) {
    if (token !== probeToken) return;
    hidePanel();
    showError(e.message || 'Could not read this link. Check it and try again.');
  } finally {
    if (token === probeToken) {
      btn.disabled = false;
      btn.classList.remove('opacity-70', 'cursor-wait');
    }
  }
}

// Tiny LRU over sessionStorage. Survives a reload within the tab, so the
// second visit to a link is instant too.
const sessionCache = (() => {
  const LIMIT = 20;
  const KEY = 'lf:probe';
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const write = (o) => { try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch { /* quota */ } };

  return {
    get(url) {
      const o = read();
      const v = o[url];
      if (!v) return null;
      if (Date.now() > v.exp) { delete o[url]; write(o); return null; }
      return v.data;
    },
    set(url, data) {
      const o = read();
      const keys = Object.keys(o);
      if (keys.length >= LIMIT) delete o[keys[0]];
      o[url] = { exp: Date.now() + 15 * 60 * 1000, data };
      write(o);
    }
  };
})();

// --------------------------------------------------------------- clipboard
// The paste permission prompt only appears on a real user gesture, so this is
// called from click/focus handlers — never from a timer.
async function autoPaste() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return false;
    if (input.value.trim() === text.trim()) return false;

    input.value = text.trim();
    showError('');
    if (looksLikeUrl(text)) probe(text.trim());
    return true;
  } catch {
    return false;    // denied or empty — the user can still paste manually
  }
}

pasteBtn.addEventListener('click', async () => {
  const got = await autoPaste();
  if (!got && !looksLikeUrl(input.value)) {
    showError('Clipboard blocked. Paste with Ctrl+V instead.');
    input.focus();
  }
});

// Focusing the field is the natural moment to offer the clipboard.
let lastFocusValue = '';
input.addEventListener('focus', () => { lastFocusValue = input.value; });
input.addEventListener('click', autoPaste);

// ------------------------------------------------------------------ trigger
// Typing or pasting a valid link runs the whole flow on its own.
let debounce = null;

function onUrlChange() {
  if (!errBox.classList.contains('hidden')) showError('');

  const v = input.value.trim();
  if (!looksLikeUrl(v)) {
    clearTimeout(debounce);
    if (!downloading) {
      btn.disabled = false;
      btn.classList.remove('opacity-70', 'cursor-wait');
      label.textContent = 'Download';
    }
    hidePanel();
    return;
  }

  clearTimeout(debounce);
  // No delay: a pasted link is already complete, so fetch on the same tick.
  // The only debounce is one frame, which lets a "paste" event settle first.
  debounce = setTimeout(() => probe(v), 0);
}

input.addEventListener('input', onUrlChange);
input.addEventListener('paste', () => setTimeout(onUrlChange, 0));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onUrlChange(); });

// The Download button still works: it probes if needed, else starts the best.
btn.addEventListener('click', () => {
  const v = input.value.trim();
  if (!looksLikeUrl(v)) {
    showError('Please paste a video link first.');
    input.focus();
    return;
  }
  if (optVideo.childElementCount) startDownload(firstOption(), null);
  else probe(v);
});

function firstOption() {
  const v = optVideo.querySelector('.opt');
  return v ? v._option : null;
}

metaReset.addEventListener('click', () => {
  probeToken += 1;
  input.value = '';
  hidePanel();
  resetProgress();
  input.focus();
});

// ----------------------------------------------------------------- download
function startDownload(option, buttonEl) {
  if (!option || downloading) return;

  const url = input.value.trim();
  if (!looksLikeUrl(url)) {
    showError('That link is not valid. Check it and try again.');
    input.focus();
    return;
  }

  downloading = true;
  showError('');
  resetProgress();
  barWrap.classList.remove('hidden');
  barText.textContent = 'Starting…';
  label.textContent = 'Downloading…';
  btn.disabled = true;
  btn.classList.add('opacity-70', 'cursor-wait');

  if (buttonEl) {
    buttonEl.classList.add('busy');
    buttonEl.querySelector('.opt-bar i').style.width = '0%';
  }

  // Path A: the row came back from the fast probe carrying a real CDN url, and
  // that format is one the server can relay. Ask the server to hand it over
  // with an attachment header so the browser saves it with a proper name.
  if (option.src && option.fid) return streamDownload(option, buttonEl);

  // Path B: no url on the row (an audio transcode, or a non-YouTube link), so
  // the server has to do the work and report progress as it goes.
  return relayDownload(option, buttonEl);
}

// Pull the file straight from the CDN: no proxy, no server bandwidth, and the
// browser shows its own download UI.
// Point a hidden iframe at the server's download URL. The server answers
// with Content-Disposition: attachment, which is the one signal every browser
// (Chrome, Chrome for Android, Safari, Firefox) treats as "save this, do not
// display it". Because it is a navigation rather than a fetch, the browser
// takes ownership of the transfer immediately: it appears in the download
// manager, keeps working if the tab is closed, and no new tab ever opens.
function streamDownload(option, buttonEl) {
  const url = input.value.trim();

  const qs = new URLSearchParams({
    url,
    fid: option.fid || '',
    name: safeFileName(option.label, option.ext)
  });

  // Reuse a single frame: browsers throttle concurrent navigations per frame,
  // and a stale frame is a leak.
  let frame = document.getElementById('dlFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'dlFrame';
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'download';
    document.body.appendChild(frame);
  }

  // Show the user something the moment they click. We cannot observe the
  // transfer -- it now belongs to the browser -- so this toast is the honest
  // signal: the download was handed over.
  showToast('Downloading started…', 'ok');
  label.textContent = 'Download started';
  barWrap.classList.remove('hidden');
  bar.style.width = '35%';
  barPct.textContent = '';
  barText.textContent = 'Downloading — see your browser downloads.';

  // The empty # about:blank is a deliberate no-op that commits the previous
  // navigation, so a second click on the same format is not swallowed by the
  // browser's "same document" check.
  frame.src = 'about:blank';
  setTimeout(() => { frame.src = '/api/stream?' + qs.toString(); }, 0);

  downloading = false;
  if (buttonEl) buttonEl.classList.remove('busy');
  btn.disabled = false;
  btn.classList.remove('opacity-70', 'cursor-wait');
}

function relayDownload(option, buttonEl) {
  barText.textContent = 'Starting…';

  // Path C: no usable direct link, so the server streams it and reports real
  // progress as server-sent events.
  fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: input.value.trim(),
      format: option.kind === 'audio' ? option.id : 'mp4',
      quality: option.kind === 'audio' ? 'best' : option.id
    })
  })
    .then(async (res) => {
      if (!res.ok || !res.body) throw new Error(`Server replied ${res.status}.`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let failed = null;

      const frame = (raw2) => {
        const type = raw2.match(/^event:\s*(.+)$/m)?.[1];
        const payload = raw2.match(/^data:\s*(.*)$/m)?.[1];
        if (!type || payload === undefined) return;
        let d;
        try { d = JSON.parse(payload); } catch { return; }

        if (type === 'progress') {
          const pct = d.percent;
          if (pct != null) {
            bar.style.width = `${pct.toFixed(0)}%`;
            barPct.textContent = `${pct.toFixed(0)}%`;
            if (buttonEl) buttonEl.querySelector('.opt-bar i').style.width = `${pct.toFixed(0)}%`;
          }
          barText.textContent = d.text || `Downloading… ${pct ? pct.toFixed(0) : '0'}%`;
        } else if (type === 'done') {
          bar.style.width = '100%';
          barPct.textContent = '100%';
          if (buttonEl) buttonEl.querySelector('.opt-bar i').style.width = '100%';
          barText.textContent = 'Done — saving your file…';
          showToast('Download complete', 'ok');
          if (d.url) {
            // A hidden anchor keeps this in the same tab: no popup, no new page.
            const a = document.createElement('a');
            a.href = d.url;
            a.download = d.name || '';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        } else if (type === 'error') {
          failed = d.message || 'The download failed.';
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          frame(buf.slice(0, cut));
          buf = buf.slice(cut + 2);
        }
      }
      if (buf.trim()) frame(buf);
      if (failed) throw new Error(failed);
    })
    .catch((e) => {
      showError(e.message || 'The download failed. Please try again.');
      resetProgress();
    })
    .finally(() => endDownload(buttonEl));
}

// Shared teardown for both paths.
function endDownload(buttonEl) {
  downloading = false;
  btn.disabled = false;
  btn.classList.remove('opacity-70', 'cursor-wait');
  label.textContent = 'Download';
  if (buttonEl) buttonEl.classList.remove('busy');
  setTimeout(() => { if (!downloading) resetProgress(); }, 3000);
}


// Abort an in-flight transfer if the user clears the box.


/* ═══════════════════════════════════════════════════════ PWA install ═══
   The banner only appears once the browser has actually said the app is
   installable. On Firefox and desktop Safari no such event ever fires, so
   showing an "Install" button there would be a button that does nothing. */
(function setupInstall() {
  const bar = document.getElementById('installBar');
  const btn = document.getElementById('installBtn');
  const close = document.getElementById('installClose');
  if (!bar || !btn || !close) return;

  const KEY = 'savevid.install.dismissed';
  let deferred = null;

  // Respect a previous dismissal. A banner the user has already said no to is
  // worse than no banner at all.
  try { if (localStorage.getItem(KEY) === '1') return; } catch { /* private mode */ }

  function show() { bar.classList.remove('hidden'); bar.classList.add('flex'); }

  close.addEventListener('click', () => {
    bar.classList.add('hidden');
    bar.classList.remove('flex');
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // keep the event so we can fire it on click
    deferred = e;
    show();
  });

  btn.addEventListener('click', async () => {
    if (!deferred) return;
    bar.classList.add('hidden');
    bar.classList.remove('flex');
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* dismissed */ }
    deferred = null;
  });

  // Once installed there is nothing left to prompt for.
  window.addEventListener('appinstalled', () => {
    bar.classList.add('hidden');
    bar.classList.remove('flex');
    deferred = null;
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
  });

  // iOS and iPadOS never fire beforeinstallprompt, but the app is still
  // installable by hand. Show the banner with instructions instead of a button
  // that would do nothing.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;

  if (isIOS && !standalone) {
    bar.classList.add('is-ios');
    const p = bar.querySelector('p');
    if (p) p.textContent = 'Tap the Share button, then “Add to Home Screen”.';
    show();
  }
})();


/* ══════════════════════════════════════════════════════ AdSense loader ═══
   Three reasons this is lazy rather than in the <head>:
     1. A blocking ad script in the head delays first paint, which is a direct
        Core Web Vitals penalty.
     2. Impressions served before a user has seen the page are the fastest route
        to invalid-traffic flags.
     3. If the network blocks the ad host, a blocking script stalls the page.
   It waits for load plus a short idle period, and only then does it touch the
   network at all. */
(function setupAds() {
  const client = window.adsenseClient;
  const slots = document.querySelectorAll('.ad-slot');
  if (!client || !slots.length) return;

  // A publisher id of all zeros means "not configured yet". Loading it would
  // produce no ads and a console error on every page.
  if (!client || client.startsWith('ca-pub-0000')) return;

  // Each slot needs its own ad unit id. Pushing a bare {} registers the ad
  // script but never fills a slot, so the loader would sit there holding an
  // empty grey box forever. The publisher id alone is not enough.
  slots.forEach((slot) => {
    const id = slot.dataset.adClient;
    if (!id || !/^\d{10,}$/.test(id)) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({
        google_ad_client: client,
        ad_slot: id
      });
    } catch { /* one bad slot must not stop the rest */ }
  });

  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;

    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + client;
    s.onerror = () => { loaded = false; };
    document.head.appendChild(s);

    // Drop the grey placeholder once a creative is actually in the slot.
    slots.forEach((slot) => {
      const obs = new MutationObserver(() => {
        if (slot.querySelector('iframe')) {
          slot.classList.add('is-filled');
          obs.disconnect();
        }
      });
      obs.observe(slot, { childList: true, subtree: true });
    });
  }

  // requestIdleCallback where available, with a timeout so it still fires on a
  // slow device that never reports idle.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(load, { timeout: 2500 });
  } else {
    setTimeout(load, 1800);
  }
})();


/* ══════════════════════════════════════════════════ share_target + PWA ═══
   The manifest declares a share_target, so Android's share sheet opens
   SaveVid.net with the shared link already in the query string. */
(function handleShareTarget() {
  const q = new URLSearchParams(location.search);
  const shared = q.get('url') || q.get('text') || q.get('title');
  if (!shared) return;

  const match = shared.match(/https?:\/\/\S+/i);
  if (!match) return;

  const input = document.getElementById('urlInput');
  if (!input) return;

  input.value = match[0];
  // Clean the address bar so a refresh does not re-trigger the same lookup.
  history.replaceState(null, '', location.pathname + location.hash);

  input.dispatchEvent(new Event('input', { bubbles: true }));
  const btn = document.getElementById('dlBtn');
  if (btn) btn.click();
})();
