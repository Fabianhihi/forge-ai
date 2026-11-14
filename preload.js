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
    custom: () => ipcRenderer.invoke('engine:custom'),
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    onUpdate: (fn) => {
      updateListeners.add(fn);
    },
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    booted: () => ipcRenderer.send('app:booted'),
  },
  copyLog: () => ipcRenderer.invoke('log:copy'),
  openLog: () => ipcRenderer.invoke('log:open'),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  previewHtml: (html) => ipcRenderer.invoke('preview:html', html),
});
