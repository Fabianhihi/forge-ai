// FORGE AI – Hauptprozess (Electron)
// Die KI läuft komplett eingebaut auf deinem PC (llama.cpp). Keine Cloud, kein API-Key, kein Extra-Programm.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, utilityProcess, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const runner = require('./runner');
const checker = require('./checker');
const vision = require('./vision');
runner.registerScheme(); // muss vor app.ready passieren

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
  // Live-Update: kleines App-Update ist fertig geladen → Oberfläche fragen, ob gerade ein guter Moment ist
  if (st.status === 'ready' && st.kind === 'app') {
    const ch = pendingChanges();
    if (ch && win && !win.isDestroyed()) win.webContents.send('update:live', { version: ch.version, restart: ch.restart, engine: ch.engine, notes: st.notes || '' });
  }
});

// Welche Dateien ändert das wartende Update? Danach richtet sich, ob ein Neuladen reicht.
function pendingChanges() {
  try {
    const pending = JSON.parse(fs.readFileSync(path.join(updater.dir, 'pending.json'), 'utf8'));
    const appDir = app.getAppPath();
    const changed = pending.files.filter((rel) => {
      try {
        return !fs.readFileSync(path.join(pending.dir, rel)).equals(fs.readFileSync(path.join(appDir, rel)));
      } catch {
        return true;
      }
    });
    return {
      version: pending.version,
      changed,
      restart: changed.includes('main.js'),
      engine: changed.some((f) => /^(engine|web\.js)/.test(f)),
    };
  } catch {
    return null;
  }
}

let lastUpdateCheck = 0;
function checkForUpdates() {
  if (Date.now() - lastUpdateCheck < 60 * 1000) return;
  lastUpdateCheck = Date.now();
  updater.check().catch(() => {});
}

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
        if (msg.type === 'chunk') wc.send('ai:chunk', msg.id, msg.meta ? msg.meta : msg.waiting ? { waiting: true } : { text: msg.text });
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

// KI-Motor neu starten (z. B. nach einem Update) – zählt nicht als Absturz
function restartWorker() {
  const old = worker;
  worker = null;
  workerReady = false;
  for (const c of calls.values()) c.reject(new Error('Der KI-Motor wird neu gestartet.'));
  calls.clear();
  lastState = { ...lastState, status: 'loading', message: 'KI-Motor wird aktualisiert …' };
  broadcastState();
  if (!old) return startWorker();
  let started = false;
  const go = () => {
    if (!started) {
      started = true;
      startWorker();
    }
  };
  old.once('exit', go); // erst starten, wenn der alte Motor den Grafikspeicher freigegeben hat
  setTimeout(go, 5000);
  try {
    old.kill();
  } catch {
    go();
  }
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
  runner.handleProtocol();
  runner.setLogger(log);
  vision.setLogger(log);
  createWindow();
  // Alles automatisch: Hardware erkennen → Modell holen → KI starten
  startWorker();
  // Eingebautes Python leise im Hintergrund holen (einmalig), damit Python-Programme später sofort starten
  setTimeout(() => runner.prefetchPython(log), Number(process.env.FORGE_PY_DELAY || 45000));
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  runner.stopAll();
  if (worker) worker.kill();
});

// ---------- KI-Motor: Befehle aus der Oberfläche ----------
ipcMain.handle('engine:state', () => lastState);
ipcMain.handle('engine:select', (_e, id) => call('select', String(id)));
ipcMain.handle('engine:setBotModel', (_e, bot, id) => call('setBotModel', String(bot), String(id)));
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
ipcMain.handle('engine:bgDownload', (_e, id) => call('downloadBackground', String(id)));
ipcMain.handle('engine:bgCancel', () => call('cancelBackground'));
ipcMain.handle('engine:storage', () => call('storageInfo'));
ipcMain.handle('engine:freeSpace', (_e, files) => call('freeSpace', Array.isArray(files) ? files.map(String) : []));
ipcMain.handle('engine:preload', (_e, messages) => (workerReady ? call('preload', messages) : false));
ipcMain.handle('engine:delete', (_e, id) => call('deleteModel', String(id)));
ipcMain.handle('engine:setCtx', (_e, n) => call('setCtx', Math.max(4096, Math.min(131072, Number(n) || 16384))));
ipcMain.handle('engine:openFolder', () => shell.openPath(path.join(app.getPath('userData'), 'models')));
ipcMain.handle('engine:custom', async (_e, bot) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Eigenes KI-Modell (GGUF) wählen',
    filters: [{ name: 'GGUF-Modell', extensions: ['gguf'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return false;
  call('useCustom', filePaths[0], bot || null);
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
let liveTimer = null;
ipcMain.on('app:booted', () => {
  updater.confirmBoot();
  setTimeout(() => (updater.state.justUpdated = null), 4000);
  if (!liveTimer) {
    // Alle 5 Minuten und immer, wenn du zu FORGE zurückwechselst, nach Updates schauen
    setTimeout(checkForUpdates, 6000);
    liveTimer = setInterval(checkForUpdates, 5 * 60 * 1000);
    if (win) win.on('focus', checkForUpdates);
  } else if (updater.state.status === 'ready' && updater.state.kind === 'app') {
    updater.set({}); // nach dem Neuladen erneut melden
  }
});

// Update im laufenden Betrieb einspielen – ohne FORGE zu schließen
ipcMain.handle('update:applyLive', () => {
  if (chats.size) return { ok: false, busy: true };
  const ch = pendingChanges();
  if (!ch) return { ok: false };
  if (!updater.applyPendingSync()) return { ok: false };
  log('info', `Live-Update auf ${ch.version} (${ch.restart ? 'Neustart' : ch.engine ? 'Seite + KI-Motor neu' : 'Seite neu'}) · ${ch.changed.join(', ')}`);
  if (ch.restart) {
    // Hauptprogramm hat sich geändert → FORGE startet sich selbst in 2–3 Sekunden neu
    quitting = true;
    app.relaunch();
    setTimeout(() => app.exit(0), 150);
    return { ok: true, restart: true };
  }
  updater.version = ch.version;
  updater.set({ status: 'idle', current: ch.version, latest: ch.version, kind: null });
  if (ch.engine) restartWorker();
  setTimeout(() => win && !win.isDestroyed() && win.webContents.reloadIgnoringCache(), 100);
  return { ok: true };
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

// ---------- Code ausführen (Spiele, Webseiten, Programme) ----------
ipcMain.handle('run:preview', (_e, opts) => runner.createPreview(opts || {}));
ipcMain.handle('run:previewWindow', (_e, url) => {
  if (/^forge-run:\/\//.test(String(url))) runner.openPreviewWindow(url);
});
ipcMain.handle('run:runtimes', (_e, force) => runner.publicRuntimes(!!force));
ipcMain.handle('run:start', async (e, opts) => {
  const id = String(opts.id);
  const send = (type, data) => {
    if (!e.sender.isDestroyed()) e.sender.send('run:event', id, type, data);
  };
  try {
    await runner.start(id, opts, send);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('run:input', (_e, id, text) => runner.input(String(id), String(text)));
ipcMain.handle('run:stop', (_e, id) => runner.stop(String(id)));
ipcMain.handle('run:pip', async (e, id, module) => {
  const send = (type, data) => {
    if (!e.sender.isDestroyed()) e.sender.send('run:event', String(id), type, data);
  };
  try {
    await runner.pipInstall(String(id), String(module), send);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('run:install', (_e, lang) => runner.installRuntime(String(lang)));
// Bilder verstehen (Effizient-Modell + Bild-Encoder über llama.cpp)
ipcMain.handle('vision:describe', async (e, req) => {
  try {
    return await vision.describe(req || {}, call, (st) => {
      if (!e.sender.isDestroyed()) e.sender.send('vision:state', st);
    });
  } catch (err) {
    log('warn', 'Bild: ' + err.message);
    return { error: err.message, code: err.code || null };
  }
});

// Selbstprüfung: Code der KI prüfen, bevor er gestartet wird
ipcMain.handle('run:check', async (_e, spec) => {
  try {
    return await checker.check(spec || {});
  } catch (err) {
    return { problems: [], checked: [], skipped: ['Prüfung fehlgeschlagen: ' + err.message] };
  }
});
ipcMain.handle('run:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Datei zum Ausführen öffnen',
    filters: [
      { name: 'Spiele, Webseiten & Programme', extensions: ['html', 'htm', 'js', 'ts', 'py', 'ps1', 'bat', 'cmd', 'sh', 'java', 'go', 'lua', 'rb', 'php', 'c', 'cpp', 'rs'] },
      { name: 'Alle Dateien', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const p = filePaths[0];
  return { path: p, name: path.basename(p), dir: path.dirname(p) };
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
