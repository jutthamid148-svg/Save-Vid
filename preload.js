'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  probe: (url) => ipcRenderer.invoke('probe', url),
  download: (job) => ipcRenderer.invoke('download', job),
  cancel: (jobId) => ipcRenderer.invoke('cancel', jobId),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  defaultDir: () => ipcRenderer.invoke('default-dir'),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  checkYtDlp: () => ipcRenderer.invoke('check-yt-dlp'),

  // ---- AI (Gemini). Note: no method ever returns the API key itself.
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSaveKey: (key) => ipcRenderer.invoke('ai:save-key', key),
  aiClearKey: () => ipcRenderer.invoke('ai:clear-key'),
  aiModels: () => ipcRenderer.invoke('ai:models'),
  aiSetModel: (m) => ipcRenderer.invoke('ai:set-model', m),
  aiRun: (op, payload) => ipcRenderer.invoke('ai:run', { op, payload }),
  transcript: (opts) => ipcRenderer.invoke('transcript', opts),
  saveText: (opts) => ipcRenderer.invoke('ai:save', opts),

  onProgress: (cb) => {
    const l = (_e, p) => cb(p);
    ipcRenderer.on('download:progress', l);
    return () => ipcRenderer.removeListener('download:progress', l);
  },
  onDone: (cb) => {
    const l = (_e, p) => cb(p);
    ipcRenderer.on('download:done', l);
    return () => ipcRenderer.removeListener('download:done', l);
  },
  onError: (cb) => {
    const l = (_e, p) => cb(p);
    ipcRenderer.on('download:error', l);
    return () => ipcRenderer.removeListener('download:error', l);
  }
});
