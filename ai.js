'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Gemini integration for VidGrab.

   Design rules:
   • The API key lives only in the MAIN process. It is never sent over IPC,
     never written to the renderer, and never bundled into the app.
   • It is stored in Electron's userData/settings.json (outside asar) so a
     rebuild never wipes it and it never ends up in a repo or a screenshot.
   • All calls go through fetch() in Node — no SDK dependency, no bundler.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEN_TIMEOUT = 120000;

// Preferred order: best reasoning-to-cost ratio first. If the account cannot
// access one, `listModels` probing falls through to whatever is available.
const PREFERRED = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

// ------------------------------------------------------------------ settings
let settings = { key: null, model: null, history: [] };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = {
      key: typeof raw.key === 'string' ? raw.key : null,
      model: typeof raw.model === 'string' ? raw.model : null,
      history: Array.isArray(raw.history) ? raw.history.slice(0, 200) : []
    };
  } catch {
    settings = { key: null, model: null, history: [] };
  }
  return settings;
}

function saveSettings() {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  // Best-effort: keep the key off other accounts on a shared machine.
  try { fs.chmodSync(file, 0o600); } catch { /* Windows: ACLs differ, ignore */ }
}

loadSettings();

// ------------------------------------------------------------------- request
async function callGemini(model, body, signal) {
  if (!settings.key) throw new Error('No API key saved. Add one in Settings first.');

  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  const text = await res.text();

  if (!res.ok) {
    let msg = `Gemini error ${res.status}`;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || msg;
    } catch { /* non-JSON body: keep the status message */ }
    throw new Error(msg);
  }

  return JSON.parse(text);
}

// Pull plain text out of the response, tolerating multi-part candidates.
function readText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('').trim();
}

// Some prompts ask for JSON. Recover the object even if the model wrapped it
// in prose or a code fence.
function readJson(json) {
  const raw = readText(json);
  if (!raw) throw new Error('The model returned an empty response.');

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');

  if (start === -1 || end <= start) throw new Error('The model did not return JSON.');
  return JSON.parse(body.slice(start, end + 1));
}

function genConfig(systemText, temperature = 0.3) {
  return {
    systemInstruction: { parts: [{ text: systemText }] },
    temperature,
    topP: 0.95
  };
}

function remember(entry) {
  settings.history.unshift({ ...entry, at: Date.now() });
  settings.history = settings.history.slice(0, 200);
  saveSettings();
}

// ---------------------------------------------------------------- operations
/* Every operation takes a transcript (or metadata) and returns structured
   data. Prompts ask for strict JSON so the renderer never parses prose. */

const OPS = {
  // ---- 1. summary + chapters ------------------------------------------------
  async summary({ title, transcript, language = 'English' }) {
    const prompt = `Summarise the video transcript below.

Title: ${title}

Return ONLY valid JSON with this exact shape:
{
  "summary": "2-4 sentences capturing what the video is about",
  "keyPoints": ["5-8 short bullet strings, each under 90 characters"],
  "chapters": [
    { "t": "MM:SS or HH:MM:SS", "title": "short chapter name under 45 characters" }
  ],
  "sentiment": "one of: informational, entertainment, tutorial, review, music, other",
  "language": "spoken language code you detect, e.g. en, ur, hi"
}

Rules:
- Chapters must be in chronological order and cover the whole video.
- Base the summary ONLY on the transcript. If it is too short to summarise,
  return empty arrays rather than inventing content.
- Timestamps must reflect where the topic actually changes.

TRANSCRIPT:
"""
${transcript}
"""`;

    const model = await resolveModel();
    const data = readJson(await callGemini(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: genConfig(
        'You are a precise video analyst. You never fabricate facts. You always answer with raw valid JSON and no commentary.',
        0.25
      )
    }));

    remember({ op: 'summary', model, title });
    return data;
  },

  // ---- 2. subtitle translation ---------------------------------------------
  async translate({ srt, targetLanguage }) {
    // SRT files are long; chunk on caption boundaries so we never split a cue.
    const cues = srt
      .split(/\r?\n\r?\n/)
      .map((c) => c.trim())
      .filter(Boolean);

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
      const json = await callGemini(model, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: genConfig(
          'You are a subtitle translator. You preserve structure exactly and return raw JSON only.',
          0.2
        )
      });

      const arr = readJson(json);
      if (!Array.isArray(arr)) throw new Error('Unexpected translation shape.');
      out.push(...arr.map((s) => String(s)));
    }

    // Reassemble SRT, renumbering so indices stay sequential.
    const lines = [];
    for (let i = 0; i < cues.length; i += 1) {
      const body = cues[i].split(/\r?\n/);
      const time = body.find((l) => l.includes('-->')) || '00:00:00,000 --> 00:00:01,000';
      lines.push(String(i + 1), time, out[i] || '', '');
    }

    remember({ op: 'translate', model, targetLanguage });
    return { srt: lines.join('\n'), count: out.filter(Boolean).length };
  },

  // ---- 3. auto-tagging ------------------------------------------------------
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
    const data = readJson(await callGemini(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: genConfig('You are a media librarian. You answer with raw JSON only.', 0.4)
    }));

    remember({ op: 'tag', model, title });
    return data;
  },

  // ---- 4. smart format advisor ---------------------------------------------
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

    // Never hand the renderer an id the dropdown does not contain.
    if (!formats.some((f) => f.id === data.recommendedId)) {
      data.recommendedId = formats[0]?.id || '';
      data.reason = 'Picked the highest quality available.';
    }

    remember({ op: 'advise', model, title });
    return data;
  }
};

// -------------------------------------------------------------------- models
// Pick the best model this key can actually reach. Cached after the first probe.
let resolvedModel = null;

async function resolveModel() {
  if (resolvedModel) return resolvedModel;

  if (settings.model) {
    resolvedModel = settings.model;
    return resolvedModel;
  }

  // Probe our preferred list, then fall back to whatever flash model exists.
  const available = await listModels();
  for (const want of PREFERRED) {
    if (available.includes(want)) {
      resolvedModel = want;
      return want;
    }
  }
  const anyFlash = available.find((m) => m.includes('flash'));
  resolvedModel = anyFlash || available[0];
  if (!resolvedModel) throw new Error('This API key has no usable text models.');

  settings.model = resolvedModel;
  saveSettings();
  return resolvedModel;
}

async function listModels() {
  if (!settings.key) throw new Error('No API key saved. Add one in Settings first.');

  const res = await fetch(`${BASE}/models?key=${encodeURIComponent(settings.key)}`);
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

  return JSON.parse(text)
    .models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((m) => !m.includes('embedding') && !m.includes('tts') && !m.includes('imagen'))
    .sort();
}

module.exports = {
  listModels,
  run: (op, payload) => {
    const fn = OPS[op];
    if (!fn) throw new Error(`Unknown AI operation: ${op}`);
    return fn(payload || {});
  },
  status: () => ({
    configured: Boolean(settings.key),
    model: resolvedModel || settings.model || null,
    history: settings.history.slice(0, 20)
  }),
  saveKey: (key) => {
    const k = String(key || '').trim();
    // Fail fast on obvious mistakes so the user gets a clear message.
    if (k && !/^AIza[0-9A-Za-z_-]{35,}$/.test(k)) {
      throw new Error('That does not look like a Google AI Studio key (expected to start with "AIza").');
    }
    settings.key = k || null;
    settings.model = null;
    resolvedModel = null;
    saveSettings();
    return module.exports.status();
  },
  setModel: (m) => {
    settings.model = String(m || '').trim() || null;
    resolvedModel = settings.model;
    saveSettings();
    return module.exports.status();
  },
  clearKey: () => {
    settings.key = null;
    settings.model = null;
    resolvedModel = null;
    saveSettings();
    return module.exports.status();
  }
};
