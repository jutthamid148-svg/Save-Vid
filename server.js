'use strict';

/* ══════════════════════════════════════════════════════════════════════
   loader.fo backend — zero dependencies (Node's http + fetch only).

   Serves the static site in ./web and adds the /api routes the AI panel
   needs. The Gemini key lives in config.json next to this file and is
   NEVER sent to the browser: the page can only ask for results.

   Run:  node server.js          (defaults to port 8899)
          PORT=3000 node server.js
   ══════════════════════════════════════════════════════════════════════ */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

// Locally, __dirname is the project root and web/ is a child of it. On Vercel
// the entry file is api/index.js, so __dirname is /var/task/api and web/ is a
// sibling two levels up. api/index.js sets WEB_ROOT rather than making every
// function here aware of which host it is running on.
const WEB = process.env.WEB_ROOT
  ? path.join(process.env.WEB_ROOT, 'web')
  : path.join(__dirname, 'web');
const CONFIG = process.env.WEB_ROOT
  ? path.join(process.env.WEB_ROOT, 'config.json')
  : path.join(__dirname, 'config.json');
const PORT = Number(process.env.PORT) || 8899;
const GEM = 'https://generativelanguage.googleapis.com/v1beta';

const PREFERRED = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

// ------------------------------------------------------------------ config
let config = { key: null, model: null };

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    config = {
      key: typeof raw.key === 'string' && raw.key ? raw.key : null,
      model: typeof raw.model === 'string' && raw.model ? raw.model : null
    };
  } catch { /* no config yet — the UI collects the key */ }
  return config;
}

function saveConfig() {
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2), 'utf8');
  try { fs.chmodSync(CONFIG, 0o600); } catch { /* Windows ACLs differ */ }
}

loadConfig();

// ---------------------------------------------------------------- yt-dlp
// The same bundled engine the desktop app uses. Transcripts come from here.
// A 17MB Windows binary is checked in for the Electron build but is useless in
// a Linux serverless function, so this resolves to a bare command name there and
// only calls that run (the transcript routes) fail -- the download routes use
// the InnerTube relay in this file and never touch yt-dlp.
const YTDLP = (() => {
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const here = path.join(__dirname, 'resources', exe);
  return fs.existsSync(here) ? here : exe;
})();

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => reject(new Error(`yt-dlp failed to start: ${e.message}`)));
    proc.on('close', (code) => (code === 0
      ? resolve(out)
      : reject(new Error(err.split('\n').filter(Boolean).slice(-3).join('\n') || `yt-dlp exited ${code}`))));
  });
}

// ---------------------------------------------------------------- helpers
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8'
};

// `headers` exists because writeHead replaces the whole header set: anything
// set earlier with setHeader is discarded. Callers serving cacheable files
// have to pass Cache-Control in here or it silently falls back to no-store.
function send(res, code, body, type = 'application/json; charset=utf-8', headers) {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(headers || {})
  });
  res.end(body);
}

function json(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(headers || {})
  });
  res.end(body);
}

function readBody(req, limit = 1_500_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

async function callGemini(model, body) {
  if (!config.key) throw new Error('No API key saved. Add one in the AI panel first.');

  const res = await fetch(
    `${GEM}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.key)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const text = await res.text();

  if (!res.ok) {
    let msg = `Gemini error ${res.status}`;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || msg;
      if (/API key not valid/i.test(msg)) msg = 'That API key was rejected by Google. Check it and try again.';
      if (/PERMISSION_DENIED/i.test(text)) msg = 'This key is valid but the Generative Language API is not enabled for it. Enable it in Google Cloud Console, then try again.';
      if (/RESOURCE_EXHAUSTED|429/.test(text)) msg = 'Gemini quota exceeded. Check your billing and rate limits.';
    } catch { /* keep the status message */ }
    throw new Error(msg);
  }
  return JSON.parse(text);
}

function readText(j) {
  const parts = j?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('').trim()
    : '';
}

// Recover JSON even when the model wraps it in prose or a code fence.
function readJson(j) {
  const raw = readText(j);
  if (!raw) throw new Error('The model returned an empty response.');

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('[') >= 0 && body.indexOf('[') < body.indexOf('{') ? body.indexOf('[') : body.indexOf('{');
  const close = body.lastIndexOf(']') > body.lastIndexOf('}') ? body.lastIndexOf(']') : body.lastIndexOf('}');

  if (start === -1 || close <= start) throw new Error('The model did not return JSON.');
  return JSON.parse(body.slice(start, close + 1));
}

const genConfig = (systemText, temperature = 0.3) => ({
  systemInstruction: { parts: [{ text: systemText }] },
  temperature,
  topP: 0.95
});

async function resolveModel() {
  if (config.model) return config.model;

  const available = await listModels();
  for (const want of PREFERRED) if (available.includes(want)) { config.model = want; saveConfig(); return want; }

  const fallback = available.find((m) => m.includes('flash')) || available[0];
  if (!fallback) throw new Error('This API key has no usable text models.');
  config.model = fallback;
  saveConfig();
  return fallback;
}

async function listModels() {
  if (!config.key) throw new Error('No API key saved. Add one in the AI panel first.');

  const res = await fetch(`${GEM}/models?key=${encodeURIComponent(config.key)}`);
  const text = await res.text();
  if (!res.ok) {
    let msg = `Could not reach Gemini (HTTP ${res.status})`;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || msg;
      if (/API key not valid/i.test(msg)) msg = 'That API key was rejected by Google. Check it and try again.';
      if (/PERMISSION_DENIED/i.test(text)) msg = 'This key is valid but the Generative Language API is not enabled for it. Enable it in Google Cloud Console, then try again.';
      if (/RESOURCE_EXHAUSTED|429/.test(text)) msg = 'Gemini quota exceeded. Check your billing and rate limits.';
    } catch { /* keep fallback */ }
    throw new Error(msg);
  }

  return JSON.parse(text).models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((m) => !/embedding|tts|imagen/.test(m))
    .sort();
}

// ------------------------------------------------------------- format probe
// Returns one entry per quality the site actually offers, so the advisor can
// only ever recommend something the dropdown can select.
const QUALITIES = ['2160', '1440', '1080', '720', '480', '360'];

async function probeFormats(url) {
  let raw;
  try {
    raw = await runYtDlp(['--no-warnings', '--no-playlist', '--no-check-certificate',
      '--socket-timeout', '20', '-J', url]);
  } catch (e) {
    throw new Error(`Could not read formats: ${e.message}`);
  }

  let info;
  try { info = JSON.parse(raw); } catch { throw new Error('Could not read formats for this link.'); }
  if (Array.isArray(info.entries) && info.entries.length) info = info.entries[0];

  // Smallest file per height wins — that is the sane pick for a given rung.
  const best = new Map();
  for (const f of info.formats || []) {
    if (!f || f.vcodec === 'none' || !f.height) continue;
    const q = String(f.height);
    const size = f.filesize || f.filesize_approx || Infinity;
    if (!best.has(q) || size < best.get(q).size) best.set(q, { id: q, size, ext: f.ext });
  }

  const formats = QUALITIES
    .filter((q) => best.has(q))
    .map((q) => ({
      id: best.get(q).id,
      label: `${q}p ${best.get(q).ext}`,
      filesize: best.get(q).size === Infinity ? null : best.get(q).size
    }));

  if (!formats.length) formats.push({ id: 'best', label: 'Best available', filesize: info.filesize || null });

  return { formats, title: info.title || '', duration: info.duration || 0 };
}

// -------------------------------------------------------------- transcript
async function fetchTranscript(url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loaderfo-'));
  const template = path.join(dir, 'subs.%(ext)s');

  try {
    await runYtDlp([
      '--no-warnings', '--no-playlist', '--no-check-certificate', '--skip-download',
      '--write-subs', '--write-auto-subs', '--sub-langs', 'en.*,ur.*,hi.*',
      '--sub-format', 'vtt', '-o', template, url
    ]);
  } catch (e) {
    throw new Error(`Could not fetch subtitles: ${e.message}`);
  }

  const file = fs.readdirSync(dir).find((f) => f.endsWith('.vtt'));
  if (!file) throw new Error('No subtitles are available for this video.');

  const vtt = fs.readFileSync(path.join(dir, file), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { text: vttToText(vtt), srt: vttToSrt(vtt) };
}

function vttToText(vtt) {
  return vtt
    .replace(/^WEBVTT[\s\S]*?(?=\n\n|\r\n\r\n)/i, '')
    .replace(/^(NOTE|STYLE|REGION)[\s\S]*?(?=\n\n|$)/gim, '')
    .replace(/^[\d:.]+\s*-->\s*[\d:.]+.*$/gm, '')
    .replace(/^\d+$/gm, '')
    .replace(/<\/?[cvbi][^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .join(' ').replace(/\s+/g, ' ').trim();
}

function vttToSrt(vtt) {
  const out = [];
  let n = 0;

  for (const block of vtt.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at === -1) continue;

    const m = block.match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    const text = lines.slice(at + 1).join(' ')
      .replace(/<\/?[cvbi][^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();
    if (!text) continue;

    n += 1;
    out.push(String(n), `${vttTime(m[1])} --> ${vttTime(m[2])}`, text, '');
  }
  return out.join('\n');
}

function vttTime(t) {
  const parts = t.trim().replace(',', '.').split(':');
  const [h, m, rest] = parts.length === 3 ? parts : ['0', ...parts];
  const [sec = '0', ms = '0'] = (rest || '0').split('.');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')},${ms.padEnd(3, '0').slice(0, 3)}`;
}

// -------------------------------------------------------------- operations
const OPS = {
  async summary({ title, transcript }) {
    const prompt = `Summarise the video transcript below.

Title: ${title}

Return ONLY valid JSON with this exact shape:
{
  "summary": "2-4 sentences capturing what the video is about",
  "keyPoints": ["5-8 short bullet strings, each under 90 characters"],
  "chapters": [{ "t": "MM:SS or HH:MM:SS", "title": "short chapter name under 45 characters" }],
  "sentiment": "one of: informational, entertainment, tutorial, review, music, other",
  "language": "spoken language code you detect, e.g. en, ur, hi"
}

Rules:
- Chapters must be in chronological order and cover the whole video.
- Base the summary ONLY on the transcript. If it is too short, return empty arrays rather than inventing content.
- Timestamps must reflect where the topic actually changes.

TRANSCRIPT:
"""
${transcript}
"""`;

    const model = await resolveModel();
    return readJson(await callGemini(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: genConfig(
        'You are a precise video analyst. You never fabricate facts. You always answer with raw valid JSON and no commentary.', 0.25)
    }));
  },

  async translate({ srt, targetLanguage }) {
    const cues = srt.split(/\r?\n\r?\n/).map((c) => c.trim()).filter(Boolean);
    if (!cues.length) throw new Error('No subtitles found to translate.');

    const CHUNK = 60;
    const out = [];

    for (let i = 0; i < cues.length; i += CHUNK) {
      const slice = cues.slice(i, i + CHUNK);
      const numbered = slice
        .map((c, n) => `[${i + n + 1}]\n${c.replace(/^\d+\r?\n/, '')}`)
        .join('\n\n');

      const prompt = `Translate the numbered subtitle cues into ${targetLanguage}.

Keep every [n] index exactly as it is. Translate only the spoken text — leave
timestamps and structure untouched. Preserve line breaks within a cue. Keep
the tone natural and match the original meaning; do not add or drop content.

Return ONLY a JSON array of strings, one per cue, in the same order:
["first translation", "second translation"]

CUES:
${numbered}`;

      const model = await resolveModel();
      const arr = readJson(await callGemini(model, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: genConfig(
          'You are a subtitle translator. You preserve structure exactly and return raw JSON only.', 0.2)
      }));
      if (!Array.isArray(arr)) throw new Error('Unexpected translation shape.');
      out.push(...arr.map((s) => String(s)));
    }

    const lines = [];
    for (let i = 0; i < cues.length; i += 1) {
      const body = cues[i].split(/\r?\n/);
      const time = body.find((l) => l.includes('-->')) || '00:00:00,000 --> 00:00:01,000';
      lines.push(String(i + 1), time, out[i] || '', '');
    }
    return { srt: lines.join('\n'), count: out.filter(Boolean).length };
  },

  async tag({ title, transcript, filename }) {
    const prompt = `Tag this downloaded media file for a searchable library.

Filename: ${filename}
Title: ${title}

${transcript ? `Transcript:\n"""\n${transcript.slice(0, 12000)}\n"""` : 'No transcript available — tag from the title and filename only.'}

Return ONLY valid JSON:
{
  "tags": ["5-10 lowercase tags, single words or short phrases"],
  "category": "one of: music, tutorial, lecture, news, entertainment, gaming, sports, documentary, interview, vlog, other",
  "topics": ["3-5 broader subject areas"],
  "mood": "one of: calm, energetic, serious, humorous, dark, inspirational",
  "keywords": ["6-10 words for full-text search"]
}`;

    const model = await resolveModel();
    return readJson(await callGemini(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: genConfig('You are a media librarian. You answer with raw JSON only.', 0.4)
    }));
  },

  async advise({ title, duration, formats }) {
    const rows = formats
      .map((f) => `- id=${f.id} · ${f.label} · ${f.filesize ? Math.round(f.filesize / 1048576) + ' MB' : 'size unknown'}`)
      .join('\n');

    const prompt = `A user is about to download this video. Pick the best format for them.

Title: ${title}
Duration: ${Math.round((duration || 0) / 60)} minutes
Available formats:
${rows}

Return ONLY valid JSON:
{
  "recommendedId": "the format id you picked — must be one of the ids above",
  "reason": "one short sentence explaining the trade-off",
  "bestFor": "e.g. offline viewing, slow connection, archiving"
}

Weigh quality against file size and length. Long videos favour smaller files.`;

    const model = await resolveModel();
    const data = readJson(await callGemini(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: genConfig('You are a video encoding specialist. You answer with raw JSON only.', 0.2)
    }));

    // Never hand the browser an id the dropdown does not contain.
    if (!formats.some((f) => f.id === data.recommendedId)) {
      data.recommendedId = formats[0]?.id || '';
      data.reason = 'Picked the highest quality available.';
    }
    return data;
  }
};

// ------------------------------------------------------------------ download
// The site streams this response, so progress is real rather than simulated.
// yt-dlp prints one "PROGRESS|" line per update; we forward those as SSE and
// finally hand the browser a URL to save from.
const DL_DIR = path.join(os.tmpdir(), 'loaderfo-dl');

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function streamDownload(res, url, format, quality) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  fs.mkdirSync(DL_DIR, { recursive: true });
  const template = path.join(DL_DIR, '%(title).80s [%(id)s].%(ext)s');

  const args = [
    '--no-warnings', '--no-playlist', '--no-check-certificate',
    '--newline', '--continue', '--concurrent-fragments', '4',
    '--retries', '5', '--fragment-retries', '5', '--no-overwrites',
    '-o', template
  ];

  if (format === 'mp3' || format === 'wav') {
    args.push('-x', '--audio-format', format, '--audio-quality', '0');
  } else if (quality && quality !== 'best') {
    args.push('-f', `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`,
      '--merge-output-format', 'mp4');
  } else {
    args.push('-f', 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4');
  }

  args.push(
    '--progress-template',
    'download:PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._percent_str)s|%(info._filename)s',
    url
  );

  const proc = spawn(YTDLP, args, { windowsHide: true });
  let stderr = '';
  let file = '';
  let finished = false;

  // A browser tab closing is normal, not a failure. Let the transfer finish on
  // disk (--continue means a retry resumes it) instead of killing the process.
  res.on('close', () => {
    if (finished) return;
    proc.stdout.removeAllListeners('data');
    proc.stderr.removeAllListeners('data');
  });

  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  proc.stdout.on('data', (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      if (!line.startsWith('PROGRESS|')) continue;
      const [, dl, total, est, pct, name] = line.split('|');
      if (name) file = name;
      const downloaded = Number(dl) || 0;
      const size = Number(total) || Number(est) || 0;
      sse(res, 'progress', {
        downloaded,
        total: size,
        percent: size ? Math.min(100, (downloaded / size) * 100) : null,
        text: (pct || '').trim()
      });
    }
  });

  proc.on('error', (e) => {
    if (finished) return;
    finished = true;
    sse(res, 'error', { message: `Could not start yt-dlp: ${e.message}` });
    res.end();
  });

  proc.on('close', (code) => {
    if (finished) return;
    finished = true;
    if (code === 0) {
      sse(res, 'done', { name: file, url: file ? `/file/${encodeURIComponent(path.basename(file))}` : '' });
    } else {
      sse(res, 'error', {
        message: stderr.split('\n').filter(Boolean).slice(-3).join('\n') || `yt-dlp exited ${code}`
      });
    }
    res.end();
  });
}

function serveFile(res, name) {
  // Reject anything that is not a plain filename inside the download folder.
  if (name !== path.basename(name)) { send(res, 400, 'Bad name', 'text/plain'); return; }
  const file = path.join(DL_DIR, name);
  if (!file.startsWith(DL_DIR) || !fs.existsSync(file)) { send(res, 404, 'Not found', 'text/plain'); return; }
  // Force a save dialog rather than inline playback, and offer the real name.
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.mp4' ? 'video/mp4' : ext === '.mp3' ? 'audio/mpeg'
    : ext === '.wav' ? 'audio/wav' : ext === '.webm' ? 'video/webm'
    : ext === '.m4a' ? 'audio/mp4' : ext === '.flac' ? 'audio/flac'
    : 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': fs.statSync(file).size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

// --------------------------------------------------------------------- cache
// In-memory LRU with a TTL. Probing the same link twice in a session should
// cost nothing, so this is the difference between ~8s and instant.
const CACHE_MAX = 500;
const TTL_PROBE = 30 * 60 * 1000;
// A googlevideo url dies long before the format list does. Any probe older
// than this has urls that will 403, so it must be re-resolved.      // format lists go stale slowly
const TTL_LINKS = 10 * 60 * 1000;
// Keep a probe only while the urls it carries are still fetchable.
const TTL_PROBE_LINKS = 4 * 60 * 1000;      // CDN links expire, so keep these short

const cache = new Map();               // key -> { value, expires, kind }

function cacheGet(key, kind) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.kind !== kind) return undefined;
  if (Date.now() > hit.expires) { cache.delete(key); return undefined; }

  // Refresh recency so the LRU eviction below drops genuinely cold entries.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, kind, value, ttl) {
  cache.set(key, { value, kind, expires: Date.now() + ttl });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return value;
}

// -------------------------------------------------------------- coalescing
// Two visitors pasting the same link should trigger one probe, not two. The
// second caller awaits the first caller's promise.
const inflight = new Map();

function once(key, kind, ttl, fn) {
  const hit = cacheGet(key, kind);
  if (hit !== undefined) return Promise.resolve(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = Promise.resolve()
    .then(fn)
    .then((value) => cacheSet(key, kind, value, ttl))
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

// Normalise a URL so the same video behind different share URLs shares a cache
// slot. "youtu.be/ID", "watch?v=ID" and "watch?v=ID&t=30" must all hit one key.
function cacheKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (/youtu\.be$/.test(host)) return `yt:${u.pathname.slice(1)}`;
    if (host.includes('youtube.com')) {
      const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/) || [])[1];
      if (id) return `yt:${id}`;
    }
    return `${host}${u.pathname}${u.searchParams.toString()}`;
  } catch {
    return String(url);
  }
}

// ------------------------------------------------------------------ metadata
// The paste-to-options flow needs this: platform, title and the real format
// list before the user picks anything.
const PLATFORMS = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/, 'YouTube', '#FF0000'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$/, 'Facebook', '#0866FF'],
  [/(^|\.)instagram\.com$/, 'Instagram', '#E4405F'],
  [/(^|\.)tiktok\.com$/, 'TikTok', '#000000'],
  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X', '#000000'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud', '#FF5500'],
  [/(^|\.)vimeo\.com$/, 'Vimeo', '#1AB7EA'],
  [/(^|\.)dailymotion\.com$|(^|\.)dai\.ly$/, 'Dailymotion', '#0066DC'],
  [/(^|\.)reddit\.com$/, 'Reddit', '#FF4500'],
  [/(^|\.)pinterest\.(com|ca)$/, 'Pinterest', '#E60023']
];

function detectPlatform(hostname) {
  const h = String(hostname || '').toLowerCase();
  for (const [re, name, colour] of PLATFORMS) if (re.test(h)) return { name, colour };
  return { name: 'Direct link', colour: '#2f6bff' };
}

const fmtBytes = (n) => {
  if (!n || !isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

// ------------------------------------------------------------ InnerTube path
// yt-dlp needs 8-30s because it has to solve the player challenge and probe
// every format. For YouTube we can skip all of that: the public InnerTube
// player endpoint, called as the ANDROID client, hands back plain un-ciphered
// CDN urls in under 2s. No key parameter -- supplying a stale one is what
// makes YouTube answer 400 FAILED_PRECONDITION.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function videoIdOf(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return ID_RE.test(id) ? id : null;
    }
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      const id = u.searchParams.get('v')
        || (u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?]+)/) || [])[1];
      return id && ID_RE.test(id) ? id : null;
    }
  } catch { /* not a URL we understand */ }
  return null;
}

const INNERTUBE_BODY = (videoId) => JSON.stringify({
  context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en', androidSdkVersion: 34 } },
  videoId,
  contentCheckOk: true,
  racyCheckOk: true
});

const INNERTUBE_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  'X-YouTube-Client-Name': '3',
  'X-YouTube-Client-Version': '20.10.38',
  Accept: '*/*'
};

async function innertubePlayer(videoId) {
  const ctl = AbortSignal.timeout(8000);
  const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: INNERTUBE_HEADERS,
    body: INNERTUBE_BODY(videoId),
    signal: ctl
  });
  if (!res.ok) throw new Error(`InnerTube replied ${res.status}`);
  const j = await res.json();
  const status = j?.playabilityStatus?.status || '';
  if (status && status !== 'OK') {
    const why = j.playabilityStatus?.reason || status;
    throw new Error(/private/i.test(why) ? 'This video is private.'
      : /age|confirm/i.test(why) ? 'This video is age-restricted.'
      : 'This video cannot be played.');
  }
  return j;
}

// oEmbed is ~0.8s and gives a clean title/author/thumbnail, but no formats.
// Running it alongside InnerTube means the slower of the two (~2s) is the
// whole cost instead of their sum.
function oEmbed(videoId) {
  return fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, {
    headers: { 'User-Agent': INNERTUBE_HEADERS['User-Agent'] },
    signal: AbortSignal.timeout(5000)
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

// Turn InnerTube's format list into the same shape the UI already renders.
function innertubeToMeta(player, oe, url, videoId) {
  const details = player.videoDetails || {};
  const adaptive = [
    ...(player.streamingData?.formats || []),
    ...(player.streamingData?.adaptiveFormats || [])
  ];

  const byHeight = new Map();
  const audioFormats = [];
  for (const f of adaptive) {
    if (!f || !f.url) continue;                       // ciphered formats are useless to us
    const isAudioOnly = !f.height || /audio/.test(f.mimeType || '');
    if (isAudioOnly) { audioFormats.push(f); continue; }
    const size = f.contentLength ? Number(f.contentLength) : Infinity;
    const cur = byHeight.get(f.height);
    if (!cur || size < cur.size) {
      byHeight.set(f.height, { size, fps: f.fps || 30, url: f.url, itag: f.itag, ext: 'mp4' });
    }
  }

  const LABEL = {
    2160: '4K Ultra HD', 1440: '2K QHD', 1080: 'Full HD', 720: 'HD',
    480: 'SD', 360: 'Low', 240: 'Very low', 144: 'Very low'
  };

  const video = [...byHeight.entries()]
    .map(([q, v]) => ({
      kind: 'video',
      id: String(q),
      fid: String(v.itag),
      label: `${LABEL[q] || q + 'p'} · ${q}p`,
      size: v.size === Infinity ? null : v.size,
      ext: v.ext,
      src: v.size === Infinity ? null : v.url
    }))
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (!video.length) throw new Error('No downloadable formats for this video.');

  const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  const secs = Number(details.lengthSeconds || 0);
  const audio = ['mp3', 'wav'].map((ext) => {
    const bps = ext === 'wav' ? 1411000 : 320000;
    return {
      kind: 'audio',
      id: ext,
      fid: null,                                  // audio needs a real transcode
      label: ext === 'mp3' ? 'MP3 · 320 kbps' : 'WAV · lossless',
      size: secs ? Math.round((bps * secs) / 8) : null,
      ext,
      src: null
    };
  });

  return {
    title: details.title || oe?.title || 'Untitled',
    uploader: details.author || oe?.author_name || '',
    duration: secs,
    thumbnail: (details.thumbnail?.thumbnails || []).slice(-1)[0]?.url
      || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    platform: detectPlatform(new URL(url).hostname),
    video,
    audio,
    fast: true
  };
}

// Fast YouTube probe: InnerTube + oEmbed concurrently, yt-dlp only as the
// fallback (age-gated videos, live streams, anything the fast path rejects).
async function probeFastYT(url, videoId) {
  const [player, oe] = await Promise.all([
    innertubePlayer(videoId),
    oEmbed(videoId)
  ]);
  return innertubeToMeta(player, oe, url, videoId);
}

async function probeMetadata(url) {
  // YouTube first: ~2s via InnerTube. Everything else, or a failure, falls
  // through to yt-dlp.
  const ytId = videoIdOf(url);
  if (ytId) {
    try {
      return await probeFastYT(url, ytId);
    } catch (e) {
      console.warn(`[fast] InnerTube failed for ${ytId} (${e.message}); using yt-dlp`);
    }
  }

  let raw;
  try {
    // --no-check-formats is the single biggest win here: without it yt-dlp
    // HTTP-probes all 50+ formats and a probe takes ~30s instead of ~8s.
    raw = await runYtDlp(['--no-warnings', '--no-playlist', '--no-check-certificate',
      '--no-check-formats', '--socket-timeout', '15', '-J', url]);
  } catch (e) {
    throw new Error(`Could not read this link: ${e.message}`);
  }

  let info;
  try { info = JSON.parse(raw); } catch { throw new Error('This link is not supported.'); }
  if (Array.isArray(info.entries) && info.entries.length) info = info.entries[0];

  // One row per height: the smallest file at that height is the sane pick.
  const byHeight = new Map();
  const audioFormats = [];

  for (const f of info.formats || []) {
    if (!f) continue;

    if (f.vcodec === 'none' && f.acodec && f.acodec !== 'none') {
      audioFormats.push(f);
      continue;
    }
    if (f.vcodec === 'none' || !f.height) continue;

    const q = String(f.height);
    const size = f.filesize || f.filesize_approx || Infinity;
    const cur = byHeight.get(q);
    if (!cur || size < cur.size) byHeight.set(q, { size, ext: f.ext, fps: f.fps || 30, id: f.format_id, url: f.url });
  }

  const LABEL = {
    2160: '4K Ultra HD', 1440: '2K QHD', 1080: 'Full HD', 720: 'HD',
    480: 'SD', 360: 'Low', 240: 'Very low', 144: 'Very low'
  };

  // Keep the direct CDN url on each row so the browser can fetch the bytes
  // itself instead of the server proxying every megabyte.
  const video = [...byHeight.entries()]
    .map(([q, v]) => ({
      kind: 'video',
      id: q,
      fid: v.id,
      label: `${LABEL[q] || q + 'p'} · ${q}p`,
      size: v.size === Infinity ? null : v.size,
      ext: v.ext,
      src: v.size === Infinity ? null : v.url
    }))
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (!video.length) {
    video.push({ kind: 'video', id: 'best', fid: 'best', label: 'Best available', size: info.filesize || null, ext: info.ext || 'mp4', src: null });
  }

  // Best audio-only stream, for a direct MP3/WebM hand-off where the source
  // already is audio. Anything needing a transcode still goes through yt-dlp.
  const bestAudio = audioFormats
    .filter((f) => f.url)
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

  const secs = info.duration || 0;
  const audio = ['mp3', 'wav'].map((ext) => {
    const bps = ext === 'wav' ? 1411000 : 320000;              // 320 kbps MP3, CD-quality WAV
    const direct = ext === 'mp3' && bestAudio && /webm|opus/.test(bestAudio.ext || '');
    return {
      kind: 'audio',
      id: ext,
      fid: direct ? bestAudio.format_id : null,
      label: ext === 'mp3' ? 'MP3 · 320 kbps' : 'WAV · lossless',
      size: direct ? (bestAudio.filesize || bestAudio.filesize_approx || null)
                   : (secs ? Math.round((bps * secs) / 8) : null),
      ext: direct ? (bestAudio.ext || 'webm') : ext,
      src: direct ? bestAudio.url : null
    };
  });

  return {
    title: info.title || 'Untitled',
    uploader: info.uploader || info.channel || '',
    duration: secs,
    thumbnail: info.thumbnail || '',
    platform: detectPlatform(new URL(url).hostname),
    video,
    audio
  };
}

// ------------------------------------------------------------------ direct
// Hand the browser the CDN url so the bytes never touch this process. The
// server becomes a metadata service instead of a bandwidth bottleneck.
async function directUrl(url, fid) {
  if (!fid) return null;
  // Short TTL on purpose: we are about to hand the caller a CDN url, and a
  // cached url that has expired turns into a 403 for the user.
  const probe = await once(cacheKey(url), 'probe', TTL_PROBE_LINKS, () => probeMetadata(url));

  const all = [...(probe.video || []), ...(probe.audio || [])];
  const row = all.find((r) => r.fid === fid);
  if (!row || !row.src) return null;

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  const host = new URL(row.src).hostname;

  const res = await fetch(row.src, {
    method: 'GET',
    headers: { Referer: `${new URL(url).origin}/`, 'User-Agent': ua, Range: 'bytes=0-0' }
  }).catch(() => null);

  if (!res) throw new Error('The source host did not respond.');
  const ok = res.status === 200 || res.status === 206;
  if (!ok && res.status === 403) {
    throw new Error('This source blocks direct downloads. Using the server relay instead.');
  }
  if (!ok) throw new Error(`The source host replied ${res.status}.`);

  return { url: row.src, name: safeFilename(probe.title, row.ext), host };
}

function safeFilename(title, ext) {
  let base = String(title || 'video')
    .replace(/[\/:*?"<>| -]/g, ' ')
    .replace(/s+/g, ' ')
    .trim()
    .slice(0, 76) || 'video';

  // The title may already carry its own extension (a resolved format name
  // does). Strip it before adding one back, or you get 'video.mp4.mp4'.
  const hadExt = /.[A-Za-z0-9]{1,5}$/.test(base);
  base = base.replace(/.[A-Za-z0-9]{1,5}$/, '') || 'video';

  // With no extension anywhere left we genuinely do not know the type, and
  // mp4 is the only sane guess for a video row.
  const suffix = ext || (hadExt ? '' : 'mp4');
  return suffix ? `${base}.${suffix}` : base;
}

// The browser fetches the CDN url itself, so it needs permission to do so.
// The origin list is deliberately empty: a downloader is meant to be called
// from anywhere, and the server holds no credentials to protect.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const EXPOSED = 'Content-Disposition, Content-Length, Content-Type, Accept-Ranges';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Expose-Headers', EXPOSED);
  res.setHeader('Timing-Allow-Origin', ALLOW_ORIGIN);
}


// Googlevideo refuses a bare full-file GET (403) but happily serves an explicit
// Range covering the whole file. Asking for "0-<total-1>" gets us the entire
// body in one response, which is what we want to relay.
async function cdnFullStream(url, total, referer) {
  return fetch(url, {
    method: 'GET',
    headers: {
      ...(total ? { Range: `bytes=0-${total - 1}` } : {}),
      Referer: referer,
      'User-Agent': UA_DESKTOP
    },
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });
}

// ------------------------------------------------------------- direct relay
// Everything needed to turn a CDN url into a saved file, with nothing written
// to disk: correct filename header, real content type, byte-exact length, and
// a pass-through of the range so a resume or a second click still works.
// googlevideo will not return more than this in a single request; anything
// larger must be fetched in pieces.
// googlevideo caps a single ranged GET at a few hundred KB: anything larger
// earns a 403. Measured on a live CDN url: 256KB accepted, 512KB rejected.
// The relay therefore walks the file in 256KB pieces and concatenates them.
const CHUNK = 4 * 1024 * 1024;

// Floor for the adaptive walk above. Below this the per-request overhead starts
// to dominate and the CDN is refusing the url for some other reason.
const MIN_CHUNK = 64 * 1024;
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function streamDirect(res, url, fid, wantName) {
  const key = cacheKey(url) + '|' + fid;
  let row = cacheGet(key, 'direct');

  // Reuse a direct link we already validated, otherwise resolve the format.
  // This happens before any header is written, so a bad format still produces a
  // clean JSON error the client can show rather than a truncated 200.
  if (!row) {
    const fresh = await directUrl(url, fid);
    if (!fresh || !fresh.url) throw new Error('This format has no direct link. Try another quality.');
    cacheSet(key, 'direct', fresh, TTL_LINKS);
    row = fresh;
  }

  const filename = safeFilename(row.name || wantName || 'video', null);
  const origin = new URL(url).origin;
  const referer = `${origin}/`;

  // One 1-byte probe tells us the true total length and proves the CDN will
  // serve this format at all. Everything that can fail happens here, before we
  // commit to a 200.
  const probe = await fetch(row.url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0', Referer: referer, 'User-Agent': UA_DESKTOP },
    signal: AbortSignal.timeout(10000)
  }).catch(() => null);

  if (!probe) throw new Error('The video source did not respond. Try again.');
  if (!probe.ok) {
    await probe.body?.cancel().catch(() => {});
    if (probe.status === 403) throw new Error('The video source refused this format. Try another quality.');
    throw new Error(`The video source replied ${probe.status}.`);
  }

  const cr = probe.headers.get('content-range') || '';
  const total = Number((cr.split('/')[1] || '').trim()) || null;
  const ctype = probe.headers.get('content-type') || 'application/octet-stream';
  await probe.body?.cancel().catch(() => {});

  // Force a save with a readable name. filename* is the RFC 5987 form and is
  // what actually survives non-ASCII titles.
  const headers = {
    'Content-Type': ctype,
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': total ? String(total) : null,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
  res.writeHead(200, headers);

  // googlevideo does not impose a fixed byte cap -- a live sweep answered 206
  // for ranges up to 64MB in one request. What it does impose is a request
  // rate, and over-stepping it earns a 403 that looks exactly like a size
  // rejection. So the walk is adaptive in both directions: we hold one window
  // and retry it with backoff, and only halve once retries are exhausted. The
  // client still sees a single continuous stream with an honest
  // Content-Length, because every piece is a normal 206 written in order.
  if (!total) { res.destroy(); return; }

  let sent = 0;
  let closed = false;
  let window = CHUNK;
  let strikes = 0;
  res.on('close', () => { closed = true; });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    while (sent < total && !closed) {
      const end = Math.min(sent + window - 1, total - 1);
      let part = null;

      // Same offset, same window: a 403 here is the CDN asking us to slow
      // down, not telling us the range is too wide, so back off and ask again.
      for (let attempt = 0; attempt < 4; attempt++) {
        part = await fetch(row.url, {
          method: 'GET',
          headers: { Range: `bytes=${sent}-${end}`, Referer: referer, 'User-Agent': UA_DESKTOP },
          signal: AbortSignal.timeout(60_000)
        }).catch(() => null);

        if (part && part.status !== 403 && part.status !== 429) break;
        if (part) part.body?.cancel().catch(() => {});
        part = null;
        await sleep(400 * (attempt + 1));
      }

      if (!part) {
        // Still refused after the backoff, so the window really is beyond what
        // the CDN will serve in one request. Halve and retry the same offset.
        if (window <= MIN_CHUNK) { res.destroy(); return; }
        window = Math.max(MIN_CHUNK, window >> 1);
        strikes++;
        if (strikes > 8) { res.destroy(); return; }
        continue;
      }

      if (!part.ok || !part.body) {
        // A mid-file CDN hiccup is not worth surfacing: the status line is long
        // gone. Closing tells the client the file is incomplete, which is
        // exactly true.
        res.destroy();
        return;
      }

      strikes = 0;
      const reader = part.body.getReader();
      let got = 0;
      let partFailed = false;
      for (;;) {
        let step;
        try {
          step = await reader.read();
        } catch {
          // The CDN dropped the connection part-way through this piece. Abandon
          // the piece and retry from the same offset -- never advance `sent`
          // with a partial count, or every later byte would be shifted.
          partFailed = true;
          break;
        }
        if (step.done) break;
        got += step.value.length;
        if (!res.write(step.value)) {
          await new Promise((r) => res.once('drain', r));
          if (closed) { reader.cancel().catch(() => {}); return; }
        }
      }
      if (partFailed) {
        reader.cancel().catch(() => {});
        await sleep(300);
        if (++strikes > 12) { res.destroy(); return; }
        continue;
      }
      sent += got;
    }
    if (!closed) res.end();
  } catch {
    if (!closed) { try { res.destroy(); } catch { /* already gone */ } }
  }
}

// ----------------------------------------------------------------- routing
async function api(req, res, route) {
  // --- download. Streamed progress over SSE so the bar is real, not a fake.
  if (route === '/api/download') {
    const { url, format, quality } = await readBody(req);
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('A valid video URL is required.');
    return streamDownload(res, String(url), format, quality);
  }

  // --- direct download. This is the one path that can both set a filename and
  // keep the bytes off our disk: the CDN response is piped straight through, so
  // the server is a relay, not a store. Content-Disposition is the only thing
  // that forces Chrome/Safari/Firefox to save instead of play inline, and only
  // a server can set it -- googlevideo sends no CORS and no such header.
  if (route === '/api/stream' && req.method === 'POST') {
    const { url, fid, name } = await readBody(req);
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('A valid video URL is required.');
    return streamDirect(res, String(url), String(fid || ''), name);
  }

  // --- the same relay, reached by iframe navigation instead of fetch. The
  // browser cannot send a body on a navigation, so the parameters ride in the
  // query string and no CORS preflight is involved.
  if (route === '/api/stream' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const target = q.get('url') || '';
    if (!/^https?:\/\//.test(target)) throw new Error('A valid video URL is required.');
    return streamDirect(res, target, q.get('fid') || '', q.get('name') || '');
  }

  // --- config
  if (route === '/api/status') {
    return json(res, 200, { configured: Boolean(config.key), model: config.model });
  }

  if (route === '/api/key') {
    const { key } = await readBody(req);
    const k = String(key || '').trim();
    if (k && !/^AIza[0-9A-Za-z_-]{35,}$/.test(k)) {
      return json(res, 400, { error: 'That does not look like a Google AI Studio key (expected to start with "AIza").' });
    }
    config.key = k || null;
    config.model = null;
    if (k) saveConfig();
    return json(res, 200, { configured: Boolean(config.key), model: config.model });
  }

  if (route === '/api/models') {
    return json(res, 200, { models: await listModels() });
  }

  if (route === '/api/model') {
    const { model } = await readBody(req);
    config.model = String(model || '').trim() || null;
    saveConfig();
    return json(res, 200, { model: config.model });
  }

  // --- metadata, drives the options panel right after a paste
  if (route === '/api/probe') {
    const { url, vid } = await readBody(req);
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('A valid video URL is required.');
    const raw = String(url);
    const key = cacheKey(raw);
    const wasCached = cacheGet(key, 'probe') !== undefined;
    // The client extracts the 11-char YouTube id by regex before it calls us,
    // so the server can skip re-parsing. Trust it only when it agrees with the
    // URL we were actually given.
    const clientId = ID_RE.test(String(vid || '')) ? String(vid) : null;
    const serverId = videoIdOf(raw);
    if (clientId && serverId && clientId !== serverId) {
      throw new Error('The link does not match the detected video id.');
    }
    const ytId = serverId || clientId;
    const data = await once(key, 'probe', TTL_PROBE,
      () => (ytId ? probeFastYT(raw, ytId).catch(() => probeMetadata(raw)) : probeMetadata(raw)));
    return json(res, 200, data, { 'X-Cache': wasCached ? 'HIT' : 'MISS' });
  }

  // --- direct CDN link, so the browser pulls the bytes itself
  // --- title/thumbnail only. oEmbed answers in well under a second while
  // InnerTube can take several, so the client paints the header from this and
  // fills the format list in when /api/probe returns.
  if (route === '/api/quick') {
    const { url, vid } = await readBody(req);
    const ytId = ID_RE.test(String(vid || '')) ? String(vid) : videoIdOf(String(url || ''));
    if (!ytId) return json(res, 200, { quick: false });
    const key = 'quick:' + ytId;
    const wasCached = cacheGet(key, 'probe') !== undefined;
    const data = await once(key, 'probe', TTL_PROBE, async () => {
      const oe = await oEmbed(ytId);
      if (!oe) return { quick: false };
      return {
        quick: true,
        title: oe.title || '',
        uploader: oe.author_name || '',
        thumbnail: oe.thumbnail_url || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
        duration: 0,
        platform: detectPlatform('youtube.com'),
        video: [],
        audio: []
      };
    });
    return json(res, 200, data, { 'X-Cache': wasCached ? 'HIT' : 'MISS' });
  }

  if (route === '/api/direct') {
    const { url, fid } = await readBody(req);
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('A valid video URL is required.');
    const hit = cacheGet(cacheKey(url) + '|' + fid, 'direct');
    if (hit) return json(res, 200, hit, { 'X-Cache': 'HIT' });
    const fresh = await directUrl(String(url), String(fid || ''));
    if (fresh) cacheSet(cacheKey(url) + '|' + fid, 'direct', fresh, TTL_LINKS);
    return json(res, 200, fresh || { url: null, reason: 'No direct link for this format.' });
  }

  // --- format list, used by the "recommend a quality" advisor
  if (route === '/api/formats') {
    const { url } = await readBody(req);
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('A valid video URL is required.');
    return json(res, 200, await probeFormats(String(url)));
  }

  // --- transcript
  if (route === '/api/transcript') {
    const { url } = await readBody(req);
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('A valid video URL is required.');
    return json(res, 200, await fetchTranscript(String(url)));
  }

  // --- AI operations
  if (route === '/api/ai') {
    const { op, payload } = await readBody(req);
    const fn = OPS[op];
    if (!fn) return json(res, 400, { error: `Unknown AI operation: ${op}` });
    return json(res, 200, { data: await fn(payload || {}) });
  }

  return json(res, 404, { error: 'Unknown endpoint.' });
}

// The canonical origin. Canonical tags, sitemap and robots all read from here
// so the generated SEO files can never drift out of sync with the pages.
const SITE = process.env.SITE_ORIGIN || 'https://savevid-sigma.vercel.app';

// Long-lived caching for static assets, but never for HTML -- html is the file a
// deploy changes, and a cached copy hides a broken deploy from everyone.
const STATIC_MAXAGE = {
  '.css': 604800, '.js': 604800, '.svg': 604800, '.png': 604800, '.jpg': 2592000, '.woff2': 31536000
};

// Two files must never be held for a week. sw.js is the service worker itself:
// a long max-age pins users to whichever version first fetched it, and a fix
// shipped to the server would never reach anyone. The manifest is the install
// prompt, which breaks the same way. Both revalidate every time.
const NEVER_CACHE = new Set(['/sw.js', '/manifest.webmanifest']);

// ---------------------------------------------------------------------------
// Rate limiting. A fixed window per IP is enough here: the goal is to stop a
// scraper hammering /api/probe, not to meter real users precisely. The relay is
// the heaviest route this server runs, so it gets the tightest bucket.
const RATE = { windowMs: 60000, api: 30, stream: 12, static: 300 };
const hits = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (now > e.reset) hits.delete(ip);
}, RATE.windowMs).unref();

function rateKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  return ip;
}

function rateLimit(req, res, bucket) {
  const now = Date.now();
  const ip = rateKey(req);
  let e = hits.get(ip);
  if (!e || now > e.reset) { e = { n: 0, reset: now + RATE.windowMs }; hits.set(ip, e); }
  e.n++;
  res.setHeader('X-RateLimit-Limit', RATE[bucket]);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE[bucket] - e.n));
  res.setHeader('X-RateLimit-Reset', Math.ceil(e.reset / 1000));
  if (e.n > RATE[bucket]) {
    json(res, 429, { error: 'Too many requests. Please wait a moment and try again.' },
      { 'Retry-After': String(Math.ceil((e.reset - now) / 1000)) });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// SEO files, generated rather than hand-written so the origin, the lastmod dates
// and the page list stay in lockstep with the site itself.
const SEO_PAGES = [
  { loc: '/',             pri: '1.0', freq: 'weekly'  },
  { loc: '/about.html',   pri: '0.6', freq: 'monthly' },
  { loc: '/privacy.html', pri: '0.4', freq: 'yearly'  },
  { loc: '/terms.html',   pri: '0.4', freq: 'yearly'  },
  { loc: '/dmca.html',    pri: '0.4', freq: 'monthly' },
  { loc: '/contact.html', pri: '0.5', freq: 'monthly' }
];

function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = SEO_PAGES.map((p) => [
    '  <url>',
    `    <loc>${SITE}${p.loc}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${p.freq}</changefreq>`,
    `    <priority>${p.pri}</priority>`,
    '  </url>'
  ].join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/* ads.txt is AdSense's own authorization file. It is not optional and not
   something to hand-write as a static file: the host in the first column must
   match the account, and a mismatch is silently treated as unauthorized
   inventory, which shows up as zero ads rather than as an error. It sits here
   next to robots.txt for the same reason -- the site origin changes whenever
   the real domain does, and neither file should need editing by hand. */
const ADSENSE_PUBLISHER = 'pub-7335602358317571';
const ADSENSE_SUBDIRECTORY = 'f08c47fec0942fa0';

function adsTxt() {
  return [
    '# ads.txt for SaveVid.net',
    '# Authorized Digital Sellers. Managed by Google AdSense.',
    '# Format: <exchange>, <publisher ID>, DIRECT|RESELLER, <cert or tag>',
    '# https://support.google.com/adsense/answer/1346295',
    '',
    `google.com, ${ADSENSE_PUBLISHER}, DIRECT, ${ADSENSE_SUBDIRECTORY}`,
    ''
  ].join('\n');
}

function robotsTxt() {
  return [
    '# SaveVid.net',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /file/',
    '',
    '# Ad crawlers need explicit access to verify an AdSense account.',
    'User-agent: Mediapartners-Google',
    'Allow: /',
    'User-agent: AdsBot-Google',
    'Allow: /',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    ''
  ].join('\n');
}

// The canonical origin. Canonical tags, sitemap and robots all read from here
// so the generated SEO files can never drift out of sync with the pages.
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(WEB, rel);

  // Refuse anything that escapes the web folder.
  if (!file.startsWith(WEB)) { send(res, 403, 'Forbidden', 'text/plain'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      if (path.extname(file) === '.html') {
        send(res, 404,
          '<!doctype html><meta charset=utf-8><title>Page not found - SaveVid.net</title>'
          + '<meta name=robots content=noindex><body style="font:16px system-ui;padding:3rem;text-align:center">'
          + '<h1>404</h1><p>That page does not exist.</p><p><a href="/">Back to SaveVid.net</a></p>',
          'text/html; charset=utf-8');
        return;
      }
      send(res, 404, 'Not found', 'text/plain');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    send(res, 200, buf, MIME[ext] || 'application/octet-stream', {
      'Cache-Control': NEVER_CACHE.has(urlPath) ? 'no-cache'
        : STATIC_MAXAGE[ext] ? `public, max-age=${STATIC_MAXAGE[ext]}`
        : 'no-cache'
    });
  });
}

// Exported as a bare (req, res) function so this file can be mounted two ways:
// `node server.js` for local work, and api/index.js on Vercel, which calls the
// handler per invocation and manages the socket itself. The split is guarded on
// require.main so an import never opens a port.
async function handler(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (urlPath === '/robots.txt')  { send(res, 200, robotsTxt(), MIME['.txt']); return; }
  if (urlPath === '/ads.txt')     { send(res, 200, adsTxt(), MIME['.txt']); return; }
  if (urlPath === '/sitemap.xml') { send(res, 200, sitemapXml(), MIME['.xml']); return; }

  if (urlPath.startsWith('/api/')) {
    const bucket = urlPath.startsWith('/api/stream') ? 'stream' : 'api';
    if (!rateLimit(req, res, bucket)) return;
  } else if (!rateLimit(req, res, 'static')) {
    return;
  }

  if (urlPath.startsWith('/file/')) {
    return serveFile(res, decodeURIComponent(urlPath.slice(6)));
  }

  if (urlPath.startsWith('/api/')) {
    try {
      await api(req, res, urlPath);
    } catch (e) {
      // A streaming route may already have sent headers before it failed. Once
      // the body is committed the only honest move is to cut the connection;
      // writing a JSON error would throw ERR_HTTP_HEADERS_SENT.
      if (res.headersSent) {
        if (!res.writableEnded) res.destroy();
        return;
      }
      json(res, 200, { error: e.message });
    }
    return;
  }
  serveStatic(req, res, urlPath);
}

module.exports = handler;

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    const where = config.key ? ` (Gemini: ${config.model || 'auto'})` : ' (no API key yet)';
    console.log(`SaveVid.net running at http://localhost:${PORT}${where}`);
  });
}
