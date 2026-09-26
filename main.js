'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// ---------------------------------------------------------------- yt-dlp path
// Priority: explicit env var -> bundled copy in resources/ -> system PATH.
// Resolved lazily: `app` is not available at module-load time.
let YTDLP = null;
const running = new Map(); // jobId -> { proc, cancelled }

function resolveYtDlp() {
  if (YTDLP) return YTDLP;

  if (process.env.YT_DLP_PATH && fs.existsSync(process.env.YT_DLP_PATH)) {
    YTDLP = process.env.YT_DLP_PATH;
    return YTDLP;
  }

  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, exe));
  candidates.push(path.join(app.getAppPath(), 'resources', exe));

  YTDLP = candidates.find((p) => fs.existsSync(p)) || 'yt-dlp';
  return YTDLP;
}

// ------------------------------------------------------------------- window
function createWindow() {
  nativeTheme.themeSource = 'dark';

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0b0f16',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // External links open in the real browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Kill every in-flight child process on quit so nothing is orphaned.
app.on('before-quit', () => {
  for (const { proc } of running.values()) {
    try { proc.kill(); } catch { /* already gone */ }
  }
});

// ------------------------------------------------------------------ helpers
function ytArgs(url, extra) {
  return ['--no-warnings', '--no-playlist', '--no-check-certificate', ...extra, url];
}

function runYtDlp(args, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveYtDlp(), args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (onLine) onLine(s);
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', (err) => reject(new Error(`yt-dlp launch failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const msg = stderr.split('\n').filter(Boolean).slice(-4).join('\n') || `yt-dlp exited with code ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

// ------------------------------------------------------------- metadata probe
// Returns normalised info: title, thumbnail, duration, uploader, formats.
ipcMain.handle('probe', async (_e, rawUrl) => {
  const url = String(rawUrl || '').trim();
  if (!url) throw new Error('URL is empty');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('That does not look like a valid URL');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Only http/https links are supported');
  }

  const { stdout } = await runYtDlp(
    ytArgs(url, ['-J', '--no-warnings', '--socket-timeout', '20']),
  );

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('Could not read info for this link (unsupported or private)');
  }

  // --no-playlist returns an entry; a playlist URL returns entries array.
  if (Array.isArray(data.entries) && data.entries.length) data = data.entries[0];

  const formats = (data.formats || [])
    .filter((f) => f.url && f.vcodec !== 'none' && f.height)
    .map((f) => ({
      id: f.format_id,
      label: `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''} ${f.ext}${f.filesize ? ` · ${fmtBytes(f.filesize)}` : ''}`,
      height: f.height,
      fps: f.fps || 30,
      ext: f.ext,
      hasAudio: true,
      filesize: f.filesize || f.filesize_approx || null,
      videoOnly: f.vcodec !== 'none' && f.acodec === 'none'
    }))
    .sort((a, b) => b.height - a.height)
    .slice(0, 20);

  return {
    title: data.title || 'Untitled',
    uploader: data.uploader || data.channel || '',
    duration: data.duration || 0,
    thumbnail: data.thumbnail || '',
    platform: detectPlatform(parsed.hostname),
    formats: formats.length ? formats : [{
      id: 'best',
      label: 'Best available',
      height: data.height || 0,
      fps: 30,
      ext: data.ext || 'mp4',
      hasAudio: true,
      filesize: data.filesize || null,
      videoOnly: false
    }]
  };
});

function detectPlatform(host) {
  const h = host.replace(/^www\./, '');
  if (h.includes('youtube') || h === 'youtu.be') return 'YouTube';
  if (h.includes('facebook') || h.includes('fb.watch')) return 'Facebook';
  if (h.includes('instagram')) return 'Instagram';
  if (h.includes('twitter') || h === 'x.com') return 'X';
  if (h.includes('tiktok')) return 'TikTok';
  if (h.includes('soundcloud')) return 'SoundCloud';
  if (h.includes('vimeo') || h.includes('dailymotion')) return 'Other';
  return 'Direct link';
}

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// ----------------------------------------------------------------- download
ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('default-dir', () => path.join(os.homedir(), 'Downloads', 'VidGrab'));

ipcMain.handle('download', async (event, job) => {
  const { jobId, url, formatId, audioOnly, subtitle, outDir, filename } = job;

  const send = (channel, payload) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
  };

  const template = path.join(outDir, (filename || '%(title)s.%(ext)s').replace(/[\\/:*?"<>|]/g, '_'));
  const extra = [
    '-o', template,
    '--newline',
    '--continue',
    '--concurrent-fragments', '4',
    '--retries', '5',
    '--fragment-retries', '5',
    '--no-overwrites'
  ].filter(Boolean);

  if (audioOnly) {
    extra.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (formatId && formatId !== 'best') {
    extra.push('-f', `${formatId}+bestaudio/best`, '--merge-output-format', 'mp4');
  } else {
    extra.push('-f', 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4');
  }

  if (subtitle) {
    extra.push('--write-subs', '--write-auto-subs', '--sub-langs', 'en.*,ur.*,hi.*', '--convert-subs', 'srt');
  }

  const args = [...extra, '--progress-template',
    'download:PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._percent_str)s|%(info._filename)s',
    ...ytArgs(url, [])];

  return new Promise((resolve, reject) => {
    const proc = spawn(resolveYtDlp(), args, { windowsHide: true });
    const jobState = { proc, cancelled: false };
    running.set(jobId, jobState);

    let stderr = '';
    let lastName = '';

    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.stdout.on('data', (d) => {
      const lines = d.toString().split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('PROGRESS|')) continue;
        const [, dl, total, est, pct, name] = line.split('|');
        const downloaded = Number(dl) || 0;
        const size = Number(total) || Number(est) || 0;
        if (name) lastName = name;
        send('download:progress', {
          jobId,
          downloaded,
          total: size,
          percent: size ? Math.min(100, (downloaded / size) * 100) : null,
          text: pct ? pct.trim() : '',
          file: lastName
        });
      }
    });

    proc.on('error', (err) => {
      running.delete(jobId);
      reject(new Error(`Could not start yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      const cancelled = jobState.cancelled;
      running.delete(jobId);
      if (code === 0) {
        send('download:done', { jobId, file: lastName });
        resolve({ ok: true, file: lastName });
      } else if (cancelled) {
        resolve({ ok: false, cancelled: true });
      } else {
        send('download:error', { jobId });
        reject(new Error(stderr.split('\n').filter(Boolean).slice(-3).join('\n') || 'Download failed'));
      }
    });
  });
});

ipcMain.handle('cancel', (_e, jobId) => {
  const job = running.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  try { killTree(job.proc); } catch { /* noop */ }
  return true;
});

function killTree(proc) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
  } else {
    proc.kill('SIGKILL');
  }
}

ipcMain.handle('reveal', (_e, file) => {
  if (file && fs.existsSync(file)) shell.showItemInFolder(file);
});

ipcMain.handle('check-yt-dlp', async () => {
  try {
    const { stdout } = await runYtDlp(['--version']);
    return { ok: true, version: stdout.trim(), path: resolveYtDlp() };
  } catch (e) {
    return { ok: false, error: e.message, path: resolveYtDlp() };
  }
});

// ═══════════════════════════════════════════════════════════════ AI (Gemini)
// Every handler below calls into ai.js, which holds the key in the main
// process only. The renderer sends data in and gets plain JSON back — it
// never sees the key.
const ai = require('./ai');

ipcMain.handle('ai:status', () => ai.status());

ipcMain.handle('ai:save-key', (_e, key) => ai.saveKey(key));

ipcMain.handle('ai:clear-key', () => ai.clearKey());

ipcMain.handle('ai:models', async () => ai.listModels());

ipcMain.handle('ai:set-model', (_e, m) => ai.setModel(m));

// One entry point for every AI feature, so the renderer stays thin.
ipcMain.handle('ai:run', async (_e, { op, payload }) => {
  try {
    return { ok: true, data: await ai.run(op, payload) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------- transcript
// yt-dlp writes the subtitle file; we read it back and strip timing so the
// model sees clean prose rather than a wall of timestamps.
ipcMain.handle('transcript', async (_e, { url, outDir }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidgrab-'));
  const template = path.join(dir, 'subs.%(ext)s');

  try {
    await runYtDlp(
      ytArgs(url, [
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs', 'en.*,ur.*,hi.*',
        '--sub-format', 'vtt',
        '-o', template
      ])
    );
  } catch (e) {
    throw new Error(`Could not fetch subtitles: ${e.message}`);
  }

  const file = fs.readdirSync(dir).find((f) => f.endsWith('.vtt'));
  if (!file) throw new Error('No subtitles are available for this video.');

  const vtt = fs.readFileSync(path.join(dir, file), 'utf8');
  return { text: vttToText(vtt), srt: vttToSrt(vtt) };
});

// Strip WEBVTT metadata, cue timings and tags down to readable dialogue.
function vttToText(vtt) {
  return vtt
    // Drop the header block and any NOTE/STYLE/REGION sections entirely.
    .replace(/^WEBVTT[\s\S]*?(?=\n\n|\n1\n|\r\n\r\n)/i, '')
    .replace(/^(NOTE|STYLE|REGION)[\s\S]*?(?=\n\n|$)/gim, '')
    .replace(/^[\d:.]+\s*-->\s*[\d:.]+.*$/gm, '')
    .replace(/^\d+$/gm, '')
    .replace(/<\/?[cvbi][^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Convert cue timings to SRT so the download flow and the translator share a format.
function vttToSrt(vtt) {
  const out = [];
  let n = 0;

  for (const block of vtt.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at === -1) continue;

    const m = block.match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    const text = lines
      .slice(at + 1)
      .join(' ')
      .replace(/<\/?[cvbi][^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    n += 1;
    out.push(String(n), `${vttTime(m[1])} --> ${vttTime(m[2])}`, text, '');
  }

  return out.join('\n');
}

// "00:01:02.500" -> "00:01:02,500". Cues may omit the hour or use a comma already.
function vttTime(t) {
  const parts = t.trim().replace(',', '.').split(':');
  const [h, m, rest] = parts.length === 3 ? parts : ['0', ...parts];
  const [sec = '0', ms = '0'] = (rest || '0').split('.');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')},${ms.padEnd(3, '0').slice(0, 3)}`;
}

// Save a text artefact next to the download without clobbering existing files.
ipcMain.handle('ai:save', (_e, { dir, name, content }) => {
  let base = path.join(dir, name.replace(/[\\/:*?"<>|]/g, '_'));
  let file = base;
  let i = 1;
  while (fs.existsSync(file)) {
    const dot = base.lastIndexOf('.');
    file = dot > 0
      ? `${base.slice(0, dot)} (${i++})${base.slice(dot)}`
      : `${base} (${i++})`;
  }
  fs.writeFileSync(file, content, 'utf8');
  return file;
});
