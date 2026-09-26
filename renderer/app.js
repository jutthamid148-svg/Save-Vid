'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  url: $('url'), urlbar: $('urlbar'), fetch: $('fetch'), start: $('start'),
  meta: $('meta'), thumb: $('thumb'), thumbSkeleton: $('thumbSkeleton'),
  title: $('title'), platform: $('platform'), uploader: $('uploader'),
  duration: $('duration'), filename: $('filename'),
  controls: $('controls'), format: $('format'), subs: $('subs'),
  outDir: $('outDir'), pickDir: $('pickDir'),
  err: $('err'), errText: $('errText'),
  list: $('list'), empty: $('empty'), count: $('count'),
  clearDone: $('clearDone'), engine: $('engineStatus'), engineText: $('engineText'),
  toasts: $('toasts')
};

let info = null;
const items = new Map();

// ------------------------------------------------------------------ helpers
function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtTime(sec) {
  if (!sec) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

function baseName(name) {
  return String(name || '').split(/[\\/]/).pop();
}

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<i></i><span></span>`;
  t.lastElementChild.textContent = msg;
  el.toasts.append(t);
  setTimeout(() => {
    t.classList.add('out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, 3200);
}

function showErr(msg) {
  if (msg) {
    el.errText.textContent = msg;
    el.err.hidden = false;
  } else {
    el.err.hidden = true;
  }
}

function setLoading(btn, on) {
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

// ---------------------------------------------------------------------- init
(async function init() {
  el.outDir.textContent = await window.api.defaultDir();

  const eng = await window.api.checkYtDlp();
  el.engineText.textContent = eng.ok ? `yt-dlp ${eng.version}` : 'yt-dlp not found';
  el.engine.className = `engine ${eng.ok ? 'ok' : 'bad'}`;
  if (!eng.ok) {
    showErr(`yt-dlp engine unavailable (${eng.path}). Install it or set YT_DLP_PATH.`);
  }

  window.api.onProgress(onProgress);
  window.api.onDone(({ jobId, file }) => {
    finish(jobId, 'done', file);
    toast(`Saved ${baseName(file)}`, 'ok');
  });
  window.api.onError(({ jobId }) => finish(jobId, 'error'));

  el.thumb.addEventListener('load', () => {
    el.thumb.classList.add('ready');
    el.thumbSkeleton.classList.add('gone');
  });
  el.thumb.addEventListener('error', () => {
    el.thumb.classList.add('ready');
    el.thumbSkeleton.classList.add('gone');
  });
})();

// ------------------------------------------------------------------- probing
el.fetch.addEventListener('click', fetchInfo);
el.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchInfo(); });
el.url.addEventListener('input', () => { if (el.err.hidden === false) showErr(''); });

el.url.addEventListener('paste', () => setTimeout(fetchInfo, 120));

async function fetchInfo() {
  const url = el.url.value.trim();
  if (!url) {
    el.urlbar.classList.remove('invalid');
    void el.urlbar.offsetWidth;          // restart the shake
    el.urlbar.classList.add('invalid');
    showErr('Paste a link first.');
    return;
  }

  showErr('');
  el.urlbar.classList.remove('invalid');
  setLoading(el.fetch, true);
  el.start.disabled = true;
  el.meta.hidden = true;
  el.controls.hidden = true;

  try {
    info = await window.api.probe(url);

    el.title.textContent = info.title;
    el.title.title = info.title;
    el.platform.textContent = info.platform;
    el.uploader.textContent = info.uploader;
    el.duration.textContent = fmtTime(info.duration);

    // Thumbnail: restart the shimmer so it is visible on every new fetch.
    el.thumb.classList.remove('ready');
    el.thumbSkeleton.classList.remove('gone');
    el.thumb.src = info.thumbnail || '';

    el.format.replaceChildren(...info.formats.map((f) => {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.label;
      return o;
    }));

    const audioOpt = document.createElement('option');
    audioOpt.value = '__audio';
    audioOpt.textContent = 'Audio only · MP3';
    el.format.append(audioOpt);

    el.filename.value = info.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 90);
    el.meta.hidden = false;
    el.controls.hidden = false;
    el.start.disabled = false;
    el.start.querySelector('.btn-label').textContent = 'Download';
  } catch (e) {
    info = null;
    showErr(e.message);
    el.urlbar.classList.add('invalid');
  } finally {
    setLoading(el.fetch, false);
  }
}

// ------------------------------------------------------------------ download
el.start.addEventListener('click', async () => {
  if (!info) return;

  const jobId = `j${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const formatId = el.format.value;
  const audioOnly = formatId === '__audio';
  const name = `${baseName(el.filename.value || 'video')}${audioOnly ? '.mp3' : '.mp4'}`;

  addItem(jobId, info.title, name);
  el.start.disabled = true;
  el.start.querySelector('.btn-label').textContent = 'Downloading…';

  try {
    const r = await window.api.download({
      jobId,
      url: el.url.value.trim(),
      formatId: audioOnly ? null : formatId,
      audioOnly,
      subtitle: el.subs.checked,
      outDir: el.outDir.textContent,
      filename: name
    });
    if (r.cancelled) finish(jobId, 'cancelled');
    el.start.disabled = false;
    el.start.querySelector('.btn-label').textContent = 'Download';
  } catch {
    finish(jobId, 'error');
    el.start.disabled = false;
    el.start.querySelector('.btn-label').textContent = 'Download';
  }
});

el.pickDir.addEventListener('click', async () => {
  const dir = await window.api.chooseDir();
  if (dir) {
    el.outDir.textContent = dir;
    toast('Output folder updated');
  }
});

el.clearDone.addEventListener('click', () => {
  let removed = 0;
  for (const [id, it] of items) {
    if (['done', 'error', 'cancelled'].includes(it.state)) {
      it.li.style.transition = 'opacity 200ms, transform 200ms';
      it.li.style.opacity = '0';
      it.li.style.transform = 'translateX(16px)';
      setTimeout(() => { it.li.remove(); }, 200);
      items.delete(id);
      removed += 1;
    }
  }
  if (removed) toast(`Cleared ${removed} item${removed > 1 ? 's' : ''}`);
  syncCount();
});

// --------------------------------------------------------------------- queue
function addItem(jobId, title, name) {
  const li = document.createElement('li');
  li.className = 'item';
  li.innerHTML = `
    <div class="item-top">
      <span class="item-name"></span>
      <span class="item-state">queued</span>
    </div>
    <div class="bar"><i></i></div>
    <div class="item-foot">
      <span class="item-meta">Starting…</span>
      <span class="item-actions"></span>
    </div>`;

  const nameEl = li.querySelector('.item-name');
  nameEl.textContent = name;
  nameEl.title = `${title}\n${name}`;

  const actions = li.querySelector('.item-actions');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Stopping…';
    window.api.cancel(jobId);
  });
  actions.append(cancelBtn);

  el.list.append(li);
  items.set(jobId, { title, name, li, state: 'active', cancelBtn });
  syncCount();
  li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function onProgress({ jobId, downloaded, total, percent, text, file }) {
  const it = items.get(jobId);
  if (!it) return;

  const bar = it.li.querySelector('.bar');
  const fill = bar.querySelector('i');
  const state = it.li.querySelector('.item-state');
  const meta = it.li.querySelector('.item-meta');

  state.className = 'item-state active';

  if (percent == null) {
    bar.classList.add('indeterminate');
  } else {
    bar.classList.remove('indeterminate');
    fill.style.width = `${percent.toFixed(1)}%`;
    state.textContent = `${percent.toFixed(0)}%`;
  }

  const bits = [];
  if (text) bits.push(text);
  if (downloaded) bits.push(fmtBytes(downloaded));
  if (total) bits.push(`of ${fmtBytes(total)}`);
  meta.textContent = bits.join('  ·  ') || 'Starting…';

  if (file) {
    const n = baseName(file);
    it.li.querySelector('.item-name').textContent = n;
    it.li.querySelector('.item-name').title = n;
  }
}

function finish(jobId, state, file) {
  const it = items.get(jobId);
  if (!it) return;

  const stateEl = it.li.querySelector('.item-state');
  const bar = it.li.querySelector('.bar');
  const meta = it.li.querySelector('.item-meta');
  const actions = it.li.querySelector('.item-actions');

  it.state = state;
  stateEl.className = `item-state ${state}`;
  bar.classList.remove('indeterminate');

  if (state === 'done') {
    it.li.classList.add('saved');
    stateEl.textContent = 'saved';
    bar.querySelector('i').style.width = '100%';
    meta.textContent = 'Completed';
    it.cancelBtn.remove();

    const open = document.createElement('button');
    open.className = 'btn ghost';
    open.textContent = 'Show';
    open.addEventListener('click', () => window.api.reveal(file));
    actions.append(open);
  } else if (state === 'cancelled') {
    stateEl.textContent = 'cancelled';
    meta.textContent = 'Stopped by you';
    it.cancelBtn.remove();
  } else {
    stateEl.textContent = 'failed';
    meta.textContent = 'Check the message above';
    it.cancelBtn.remove();
  }
}

function syncCount() {
  el.count.textContent = items.size;
  el.count.classList.toggle('has', items.size > 0);
  el.empty.hidden = items.size > 0;
}

// ═══════════════════════════════════════════════════ AI studio (Gemini)
// The key lives in the main process. Everything here deals only with
// structured results, never with credentials.
const aiPanel    = $('aiPanel');
const aiToggle   = $('aiToggle');
const aiBody     = $('aiBody');
const aiSub      = $('aiSub');
const aiModelBadge = $('aiModel');
const aiKeyInput = $('aiKeyInput');
const aiKeySave  = $('aiKeySave');
const aiKeyClear = $('aiKeyClear');
const aiKeyHint  = $('aiKeyHint');
const aiModelBox = $('aiModelBox');
const aiModelSel = $('aiModelSel');
const aiActions  = $('aiActions');
const aiLangBox  = $('aiLangBox');
const aiLangSel  = $('aiLang');
const aiOut      = $('aiOut');
const aiBusy     = $('aiBusy');
const aiBusyText = $('aiBusyText');
const aiResult   = $('aiResult');

let aiReady = false;
let cachedTranscript = null;   // { text, srt } for the current URL

function setAiOpen(open) {
  aiBody.hidden = !open;
  aiToggle.setAttribute('aria-expanded', String(open));
  aiPanel.dataset.state = open ? (aiReady ? 'on' : 'setup') : 'off';
}

aiToggle.addEventListener('click', () => setAiOpen(aiBody.hidden));

// -------------------------------------------------------------- key handling
async function refreshAi() {
  const st = await window.api.aiStatus();
  aiReady = st.configured;

  aiKeyClear.hidden   = !st.configured;
  aiModelBox.hidden   = !st.configured;
  aiActions.hidden    = !st.configured;
  aiLangBox.hidden    = true;
  aiModelBadge.hidden = !st.model;
  if (st.model) aiModelBadge.textContent = st.model;

  aiPanel.dataset.state = aiBody.hidden ? 'off' : (st.configured ? 'on' : 'setup');
  aiSub.textContent = st.configured
    ? (st.model ? 'Ready · ' + st.model : 'Ready')
    : 'Add a Gemini key to unlock summaries, chapters and more';
}

aiKeySave.addEventListener('click', async () => {
  const key = aiKeyInput.value.trim();
  if (!key) { aiKeyHint.textContent = 'Paste your key first.'; aiKeyHint.className = 'ai-hint bad'; return; }

  aiKeySave.disabled = true;
  aiKeyHint.textContent = 'Checking…';
  aiKeyHint.className = 'ai-hint';

  try {
    await window.api.aiSaveKey(key);
    aiKeyInput.value = '';                    // do not linger in the DOM
    aiKeyHint.textContent = 'Key saved. Loading models…';
    await loadModels();
    await refreshAi();
    toast('Gemini connected', 'ok');
  } catch (e) {
    aiKeyHint.textContent = e.message;
    aiKeyHint.className = 'ai-hint bad';
  } finally {
    aiKeySave.disabled = false;
  }
});

aiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') aiKeySave.click(); });

aiKeyClear.addEventListener('click', async () => {
  await window.api.aiClearKey();
  aiModelSel.replaceChildren();
  aiResult.replaceChildren();
  aiOut.hidden = true;
  await refreshAi();
  toast('API key removed');
});

async function loadModels() {
  try {
    const models = await window.api.aiModels();
    const useful = models.filter((m) => !m.includes('embedding') && !m.includes('tts'));
    if (!useful.length) throw new Error('No chat models are available for this key.');

    aiModelSel.replaceChildren(...useful.map((m) => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      return o;
    }));
    await window.api.aiSetModel(useful[0]);
  } catch (e) {
    aiKeyHint.textContent = e.message;
    aiKeyHint.className = 'ai-hint bad';
  }
}

aiModelSel.addEventListener('change', async () => {
  await window.api.aiSetModel(aiModelSel.value);
  await refreshAi();
});

// ------------------------------------------------------------------ helpers
function setAiBusy(on, msg) {
  aiBusy.hidden = !on;
  if (on) {
    aiOut.hidden = false;
    if (msg) aiBusyText.textContent = msg;
  } else {
    aiOut.hidden = !aiResult.childElementCount;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function chips(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => '<span class="ai-tag">' + esc(t) + '</span>').join('');
}

// Cached per URL — fetching subtitles is a separate yt-dlp run, so do it once.
async function getTranscript() {
  if (cachedTranscript) return cachedTranscript;
  setAiBusy(true, 'Fetching subtitles…');
  try {
    cachedTranscript = await window.api.transcript({
      url: el.url.value.trim(),
      outDir: el.outDir.textContent
    });
    if (!cachedTranscript.text) throw new Error('Subtitles are empty for this video.');
    return cachedTranscript;
  } catch (e) {
    setAiBusy(false);
    throw new Error(e.message || 'No subtitles available for this video.');
  }
}

async function saveArtefact(name, content) {
  try {
    const file = await window.api.saveText({ dir: el.outDir.textContent, name, content });
    toast('Saved ' + baseName(file), 'ok');
  } catch { /* saving is a bonus, not the point */ }
}

// ------------------------------------------------------------------- actions
document.querySelectorAll('.ai-act').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const op = btn.dataset.op;
    if (!el.url.value.trim() || !info) { toast('Fetch a video first', 'bad'); return; }

    // The language picker only matters for translation.
    aiLangBox.hidden = op !== 'translate';

    document.querySelectorAll('.ai-act').forEach((b) => { b.disabled = true; });
    aiResult.replaceChildren();

    try {
      if (op === 'summary') await runSummary();
      else if (op === 'advise') await runAdvise();
      else if (op === 'tag') await runTag();
      else if (op === 'translate') await runTranslate();
    } catch (e) {
      setAiBusy(false);
      aiResult.innerHTML = '<p class="ai-fail">' + esc(e.message) + '</p>';
      toast(e.message, 'bad');
    } finally {
      document.querySelectorAll('.ai-act').forEach((b) => { b.disabled = false; });
    }
  });
});

async function runSummary() {
  const tr = await getTranscript();
  setAiBusy(true, 'Reading the transcript…');

  const { ok, data, error } = await window.api.aiRun('summary', {
    title: info.title,
    transcript: tr.text.slice(0, 60000)
  });
  if (!ok) throw new Error(error);

  const chapters = Array.isArray(data.chapters) ? data.chapters : [];
  const points   = Array.isArray(data.keyPoints) ? data.keyPoints : [];

  aiResult.innerHTML = `
    <div class="ai-card">
      <div class="ai-card-head">
        <h4>Summary</h4>
        <span class="ai-chip">${esc(data.sentiment || 'video')} · ${esc(data.language || '—')}</span>
      </div>
      <p class="ai-para">${esc(data.summary || '')}</p>
      ${points.length ? `<ul class="ai-points">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${chapters.length ? `<div class="ai-chapters">
        <h5>Chapters</h5>
        <ol>${chapters.map((c) => `<li><code>${esc(c.t)}</code><span>${esc(c.title)}</span></li>`).join('')}</ol>
      </div>` : ''}
      <div class="ai-card-foot"><button class="btn ghost small" id="aiSaveSummary">Save as .txt</button></div>
    </div>`;

  $('aiSaveSummary').addEventListener('click', () => saveArtefact(
    (info.title || 'video').slice(0, 60) + ' - summary.txt',
    buildSummaryText(data)
  ));
  setAiBusy(false);
}

function buildSummaryText(d) {
  const parts = [d.summary || '', ''];
  if (d.keyPoints?.length) parts.push('KEY POINTS', ...d.keyPoints.map((p) => '• ' + p), '');
  if (d.chapters?.length)  parts.push('CHAPTERS',   ...d.chapters.map((c) => c.t + '  ' + c.title), '');
  parts.push('Generated by VidGrab AI · ' + (d.sentiment || '') + ' · ' + (d.language || ''));
  return parts.join('\n');
}

async function runAdvise() {
  setAiBusy(true, 'Comparing formats…');

  const { ok, data, error } = await window.api.aiRun('advise', {
    title: info.title,
    duration: info.duration,
    formats: info.formats.map((f) => ({ id: f.id, label: f.label, filesize: f.filesize }))
  });
  if (!ok) throw new Error(error);

  aiResult.innerHTML = `
    <div class="ai-card">
      <div class="ai-card-head">
        <h4>Recommended format</h4>
        <span class="ai-chip">${esc(data.bestFor || '')}</span>
      </div>
      <p class="ai-pick">${esc(data.recommendedId)}</p>
      <p class="ai-para">${esc(data.reason || '')}</p>
      <div class="ai-card-foot"><button class="btn primary small" id="aiApplyFormat">Use this format</button></div>
    </div>`;

  $('aiApplyFormat').addEventListener('click', () => {
    el.format.value = data.recommendedId;
    toast('Format selected');
  });
  setAiBusy(false);
}

async function runTag() {
  let transcript = '';
  try {
    transcript = (await getTranscript()).text;
  } catch { /* titles alone are enough to tag */ }

  setAiBusy(true, 'Tagging…');

  const { ok, data, error } = await window.api.aiRun('tag', {
    title: info.title,
    transcript,
    filename: baseName(el.filename.value || 'video') + '.mp4'
  });
  if (!ok) throw new Error(error);

  aiResult.innerHTML = `
    <div class="ai-card">
      <div class="ai-card-head">
        <h4>File tags</h4>
        <span class="ai-chip">${esc(data.category || 'other')} · ${esc(data.mood || '')}</span>
      </div>
      <div class="ai-chips">${chips(data.tags)}</div>
      ${data.topics?.length   ? `<h5 class="ai-h5">Topics</h5><div class="ai-chips">${chips(data.topics)}</div>` : ''}
      ${data.keywords?.length ? `<h5 class="ai-h5">Search keywords</h5><div class="ai-chips">${chips(data.keywords)}</div>` : ''}
      <div class="ai-card-foot">
        <button class="btn ghost small" id="aiCopyTags">Copy</button>
        <button class="btn ghost small" id="aiSaveTags">Save sidecar .json</button>
      </div>
    </div>`;

  $('aiCopyTags').addEventListener('click', async () => {
    await navigator.clipboard.writeText([...(data.tags || []), ...(data.keywords || [])].join(', '));
    toast('Tags copied', 'ok');
  });
  $('aiSaveTags').addEventListener('click', () => saveArtefact(
    (info.title || 'video').slice(0, 60) + ' - tags.json',
    JSON.stringify({ title: info.title, ...data }, null, 2)
  ));
  setAiBusy(false);
}

async function runTranslate() {
  const tr = await getTranscript();
  const target = aiLangSel.value;
  setAiBusy(true, 'Translating to ' + target + '…');

  const { ok, data, error } = await window.api.aiRun('translate', {
    srt: tr.srt,
    targetLanguage: target
  });
  if (!ok) throw new Error(error);

  aiResult.innerHTML = `
    <div class="ai-card">
      <div class="ai-card-head">
        <h4>${esc(target)} subtitles</h4>
        <span class="ai-chip">${data.count} cues</span>
      </div>
      <pre class="ai-srt">${esc(data.srt.slice(0, 2400))}${data.srt.length > 2400 ? '\n…' : ''}</pre>
      <div class="ai-card-foot"><button class="btn primary small" id="aiSaveSrt">Save .srt</button></div>
    </div>`;

  $('aiSaveSrt').addEventListener('click', () => saveArtefact(
    (info.title || 'video').slice(0, 60) + ' - ' + target + '.srt', data.srt
  ));
  setAiBusy(false);
}

// --------------------------------------------------------------- integration
// A new URL invalidates the cached subtitles.
el.url.addEventListener('input', () => { cachedTranscript = null; });
el.fetch.addEventListener('click', () => { cachedTranscript = null; });

(async function initAi() {
  await refreshAi();
  if (aiReady) await loadModels();
})();
