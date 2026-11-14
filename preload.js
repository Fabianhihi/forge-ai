// Sichere Brücke zwischen Oberfläche und Hauptprozess
const { contextBridge, ipcRenderer } = require('electron');

const streams = new Map();
const engineListeners = new Set();

ipcRenderer.on('ai:chunk', (_e, id, data) => {
  const s = streams.get(id);
  if (s) s.onData(data);
});
ipcRenderer.on('ai:done', (_e, id, data) => {
  const s = streams.get(id);
  if (s) {
    streams.delete(id);
    s.resolve(data || {});
  }
});
ipcRenderer.on('ai:error', (_e, id, msg) => {
  const s = streams.get(id);
  if (s) {
    streams.delete(id);
    s.reject(new Error(msg));
  }
});
ipcRenderer.on('engine:update', (_e, st) => {
  for (const fn of engineListeners) fn(st);
});
const updateListeners = new Set();
ipcRenderer.on('update:update', (_e, st) => {
  for (const fn of updateListeners) fn(st);
});
const runListeners = new Set();
ipcRenderer.on('run:event', (_e, id, type, data) => {
  for (const fn of runListeners) fn(id, type, data);
});
const liveListeners = new Set();
ipcRenderer.on('update:live', (_e, info) => {
  for (const fn of liveListeners) fn(info);
});

contextBridge.exposeInMainWorld('forge', {
  info: () => ipcRenderer.invoke('app:info'),
  chat: (id, req, onData) =>
    new Promise((resolve, reject) => {
      streams.set(id, { onData, resolve, reject });
      ipcRenderer.send('ai:chat', { id, req });
    }),
  abort: (id) => ipcRenderer.send('ai:abort', id),
  engine: {
    state: () => ipcRenderer.invoke('engine:state'),
    onUpdate: (fn) => {
      engineListeners.add(fn);
    },
    select: (id) => ipcRenderer.invoke('engine:select', id),
    retry: () => ipcRenderer.invoke('engine:retry'),
    cancel: () => ipcRenderer.invoke('engine:cancel'),
    preload: (messages) => ipcRenderer.invoke('engine:preload', messages),
    remove: (id) => ipcRenderer.invoke('engine:delete', id),
    setCtx: (n) => ipcRenderer.invoke('engine:setCtx', n),
    openFolder: () => ipcRenderer.invoke('engine:openFolder'),
    custom: (bot) => ipcRenderer.invoke('engine:custom', bot),
    setBotModel: (bot, id) => ipcRenderer.invoke('engine:setBotModel', bot, id),
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    onUpdate: (fn) => {
      updateListeners.add(fn);
    },
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onLive: (fn) => {
      liveListeners.add(fn);
    },
    applyLive: () => ipcRenderer.invoke('update:applyLive'),
    booted: () => ipcRenderer.send('app:booted'),
  },
  run: {
    preview: (opts) => ipcRenderer.invoke('run:preview', opts),
    previewWindow: (url) => ipcRenderer.invoke('run:previewWindow', url),
    runtimes: (force) => ipcRenderer.invoke('run:runtimes', force),
    start: (opts) => ipcRenderer.invoke('run:start', opts),
    input: (id, text) => ipcRenderer.invoke('run:input', id, text),
    stop: (id) => ipcRenderer.invoke('run:stop', id),
    pip: (id, module) => ipcRenderer.invoke('run:pip', id, module),
    install: (lang) => ipcRenderer.invoke('run:install', lang),
    openFile: () => ipcRenderer.invoke('run:openFile'),
    onEvent: (fn) => {
      runListeners.add(fn);
    },
  },
  copyLog: () => ipcRenderer.invoke('log:copy'),
  openLog: () => ipcRenderer.invoke('log:open'),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  previewHtml: (html) => ipcRenderer.invoke('preview:html', html),
});
