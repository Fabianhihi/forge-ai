// FORGE AI – Hauptprozess (Electron)
// Die KI läuft komplett eingebaut auf deinem PC (llama.cpp). Keine Cloud, kein API-Key, kein Extra-Programm.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, utilityProcess, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win = null;
const chats = new Map(); // id -> webContents
let quitting = false;

// ---------- Protokoll (hilft bei der Fehlersuche) ----------
let logFile = null;
function log(level, text) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${text}\n`;
  if (level === 'error') process.stderr.write(line);
  try {
    if (!logFile) logFile = path.join(app.getPath('userData'), 'forge-log.txt');
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, logFile + '.alt');
    fs.appendFileSync(logFile, line);
  } catch {}
}
function readLogTail(n = 80) {
  try {
    return fs.readFileSync(logFile, 'utf8').split('\n').slice(-n).join('\n');
  } catch {
    return '';
  }
}
process.on('uncaughtException', (err) => {
  log('error', 'Hauptprozess: ' + (err && err.stack ? err.stack : err));
  if (!quitting) dialog.showErrorBox('FORGE AI – Fehler', 'Es ist ein Fehler aufgetreten:\n\n' + ((err && err.message) || err) + '\n\nDetails stehen in forge-log.txt (Einstellungen → Fehlerprotokoll).');
});
process.on('unhandledRejection', (err) => log('error', 'Hauptprozess (Promise): ' + (err && err.stack ? err.stack : err)));

// ---------- Updates (eingespielt wird schon in boot.js) ----------
const updater = global.forgeUpdater || new (require('./updater').Updater)({ app, log });
updater.log = log;
updater.on('state', (st) => {
  if (win && !win.isDestroyed()) win.webContents.send('update:update', st);
});

// ---------- KI-Motor läuft in eigenem Prozess ----------
let worker = null;
let workerReady = false;
let lastState = { status: 'detecting', message: 'Starte KI-Motor …', catalog: [], hardware: null, active: null, download: null };
let crashes = 0;
let forceCpu = false;
let notice = null;
let callId = 0;
const calls = new Map();

function broadcastState() {
  if (win && !win.isDestroyed()) win.webContents.send('engine:update', lastState);
}

function startWorker() {
  workerReady = false;
  worker = utilityProcess.fork(path.join(__dirname, 'engine-worker.js'), [], { serviceName: 'FORGE KI-Motor', stdio: 'pipe' });
  const w = worker;
  w.stdout && w.stdout.on('data', (d) => log('info', 'Motor: ' + String(d).trim()));
  w.stderr && w.stderr.on('data', (d) => log('warn', 'Motor: ' + String(d).trim()));
  w.on('message', (msg) => {
    if (w !== worker || !msg) return;
    switch (msg.type) {
      case 'state':
        workerReady = true;
        lastState = { ...msg.state, notice };
        if (msg.state.status === 'ready') crashes = Math.max(0, crashes - 1);
        broadcastState();
        break;
      case 'log':
        log(msg.level || 'info', msg.text);
        break;
      case 'reply': {
        const c = calls.get(msg.id);
        if (c) {
          calls.delete(msg.id);
          msg.error ? c.reject(new Error(msg.error)) : c.resolve(msg.result);
        }
        break;
      }
      case 'chunk':
      case 'chat-done':
      case 'chat-error': {
        const wc = chats.get(msg.id);
        if (!wc || wc.isDestroyed()) break;
        if (msg.type === 'chunk') wc.send('ai:chunk', msg.id, msg.waiting ? { waiting: true } : { text: msg.text });
        else if (msg.type === 'chat-done') wc.send('ai:done', msg.id, msg.result || {});
        else wc.send('ai:error', msg.id, msg.error);
        if (msg.type !== 'chunk') chats.delete(msg.id);
        break;
      }
    }
  });
  w.on('exit', (code) => {
    if (w !== worker) return;
    log(quitting ? 'info' : 'error', `KI-Motor beendet (Code ${code})`);
    for (const c of calls.values()) c.reject(new Error('Der KI-Motor wurde neu gestartet.'));
    calls.clear();
    for (const [id, wc] of chats) if (!wc.isDestroyed()) wc.send('ai:error', id, 'Der KI-Motor ist abgestürzt und wird neu gestartet. Bitte nochmal senden.');
    chats.clear();
    if (quitting) return;
    crashes++;
    const usedGpu = lastState.hardware && lastState.hardware.gpu;
    if (usedGpu && !forceCpu) {
      forceCpu = true;
      notice = 'Deine Grafikkarte hat Probleme gemacht. FORGE nutzt jetzt den Prozessor (langsamer, aber stabil).';
      lastState = { ...lastState, status: 'loading', notice };
    } else {
      lastState = { ...lastState, status: crashes > 3 ? 'error' : 'loading' };
    }
    if (crashes > 3) {
      lastState.error = 'Der KI-Motor ist mehrfach abgestürzt. Probier ein kleineres Modell oder schick mir das Fehlerprotokoll.';
      lastState.errorDetail = readLogTail(40);
      broadcastState();
      return;
    }
    broadcastState();
    setTimeout(startWorker, 800);
  });
  w.postMessage({ type: 'init', dataDir: app.getPath('userData'), forceCpu });
}

function call(method, ...args) {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('KI-Motor läuft nicht'));
    const id = ++callId;
    calls.set(id, { resolve, reject });
    worker.postMessage({ type: 'call', id, method, args });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0a0b0f',
    title: 'FORGE AI',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win.webContents.toggleDevTools();
    if (input.control && input.key.toLowerCase() === 'r') win.webContents.reload();
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  log('info', `FORGE AI ${app.getVersion()} startet · ${process.platform} ${os.release()} · Electron ${process.versions.electron} · ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM`);
  createWindow();
  // Alles automatisch: Hardware erkennen → Modell holen → KI starten
  startWorker();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  if (worker) worker.kill();
});

// ---------- KI-Motor: Befehle aus der Oberfläche ----------
ipcMain.handle('engine:state', () => lastState);
ipcMain.handle('engine:select', (_e, id) => call('select', String(id)));
ipcMain.handle('engine:retry', () => {
  if (crashes > 3 || !worker) {
    crashes = 0;
    forceCpu = true;
    startWorker();
    return null;
  }
  return call('start');
});
ipcMain.handle('engine:cancel', () => call('cancelDownload'));
ipcMain.handle('engine:delete', (_e, id) => call('deleteModel', String(id)));
ipcMain.handle('engine:setCtx', (_e, n) => call('setCtx', Math.max(4096, Math.min(131072, Number(n) || 16384))));
ipcMain.handle('engine:openFolder', () => shell.openPath(path.join(app.getPath('userData'), 'models')));
ipcMain.handle('engine:custom', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Eigenes KI-Modell (GGUF) wählen',
    filters: [{ name: 'GGUF-Modell', extensions: ['gguf'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return false;
  call('useCustom', filePaths[0]);
  return true;
});
ipcMain.handle('log:copy', () => {
  const s = lastState || {};
  const hw = s.hardware || {};
  const text = [
    `FORGE AI ${app.getVersion()} · Windows ${os.release()} · ${process.arch}`,
    `Status: ${s.status} · Modell: ${s.active ? s.active.title + ' ' + s.active.params : '-'}`,
    `Hardware: ${hw.gpu || 'cpu'} ${hw.gpuName || ''} · VRAM ${hw.vramGB || 0} GB · RAM ${hw.ramGB || '?'} GB · CPU erzwungen: ${!!hw.forcedCpu}`,
    `Fehler: ${s.error || '-'}`,
    '',
    readLogTail(60),
  ].join('\n');
  clipboard.writeText(text);
  return true;
});
ipcMain.handle('log:open', () => shell.showItemInFolder(path.join(app.getPath('userData'), 'forge-log.txt')));

// ---------- Updates ----------
ipcMain.handle('update:state', () => updater.state);
ipcMain.handle('update:check', () => updater.check({ manual: true }));
ipcMain.handle('update:install', () => updater.installNow());
ipcMain.on('app:booted', () => {
  updater.confirmBoot();
  updater.startAuto();
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  ramGB: Math.round(os.totalmem() / 1024 ** 3),
}));

// ---------- Chat (Streaming über den KI-Motor) ----------
ipcMain.on('ai:chat', (e, { id, req }) => {
  if (!worker || !workerReady) {
    e.sender.send('ai:error', id, 'Der KI-Motor startet gerade. Versuch es in ein paar Sekunden nochmal.');
    return;
  }
  chats.set(id, e.sender);
  worker.postMessage({ type: 'chat', id, req });
});

ipcMain.on('ai:abort', (_e, id) => {
  if (worker) worker.postMessage({ type: 'abort', id });
});

// ---------- Dateien ----------
ipcMain.handle('file:save', async (_e, { name, data, filters }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name || 'datei.txt'),
    filters: filters && filters.length ? filters : undefined,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, typeof data === 'string' ? data : Buffer.from(data));
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('shell:open', (_e, url) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(url);
});

// ---------- HTML-Vorschau in eigenem, abgeschottetem Fenster ----------
ipcMain.handle('preview:html', (_e, html) => {
  const file = path.join(os.tmpdir(), `forge-preview-${Date.now()}.html`);
  fs.writeFileSync(file, String(html));
  const pw = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'FORGE – Vorschau',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  pw.setMenu(null);
  pw.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  pw.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') pw.webContents.toggleDevTools();
  });
  pw.loadFile(file);
  pw.on('closed', () => fs.rm(file, { force: true }, () => {}));
  return true;
});
