// FORGE AI – Code ausführen: Web-Vorschau (Spiele, Webseiten) und Programme in vielen Sprachen
const { app, protocol, BrowserWindow, shell, net } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const isWin = process.platform === 'win32';
const RUN_DIR = path.join(os.tmpdir(), 'forge-run');

// ======================================================================
//                     Web-Vorschau über forge-run://
// ======================================================================
const previews = new Map(); // id -> { files: {name: content}, entry, baseDir }

// Leitet console.log & Fehler aus der Vorschau an FORGE weiter (für die Konsole)
const CONSOLE_HOOK = `<script>(()=>{const s=(t,a)=>{try{parent.postMessage({__forge:1,type:t,text:a.map(x=>{if(typeof x==='string')return x;try{return JSON.stringify(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};for(const k of ['log','info','warn','error']){const o=console[k].bind(console);console[k]=(...a)=>{s(k,a);o(...a)}}addEventListener('error',e=>s('error',[(e.message||'Fehler')+(e.lineno?' (Zeile '+e.lineno+')':'')]));addEventListener('unhandledrejection',e=>s('error',[String(e.reason)]));addEventListener('load',()=>s('ready',['']));})();</script>`;

const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', wasm: 'application/wasm', txt: 'text/plain', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
};

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'forge-run', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

function findFile(pv, rel) {
  const want = rel.replace(/^\.?\/+/, '');
  if (pv.files[want] != null) return pv.files[want];
  const lower = want.toLowerCase();
  for (const [name, content] of Object.entries(pv.files)) if (name.toLowerCase() === lower) return content;
  const base = path.basename(lower);
  for (const [name, content] of Object.entries(pv.files)) if (path.basename(name).toLowerCase() === base) return content;
  if (pv.baseDir) {
    const p = path.resolve(pv.baseDir, want);
    if (p.startsWith(path.resolve(pv.baseDir)) && fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p);
  }
  return null;
}

function handleProtocol() {
  protocol.handle('forge-run', (req) => {
    try {
      const u = new URL(req.url);
      const [, id, ...rest] = decodeURIComponent(u.pathname).split('/');
      const pv = previews.get(id);
      if (!pv) return new Response('Diese Vorschau gibt es nicht mehr.', { status: 404 });
      const rel = rest.join('/') || pv.entry;
      // Eingebaute Bibliotheken für Spiele: three.js + forge3d + Modelle vom 3D-Designer
      if (rel.startsWith('__forge/')) return serveForgeLib(pv, rel.slice(8));
      let body = findFile(pv, rel);
      if (body == null) {
        if (pv.missing && !/favicon\.ico$/i.test(rel)) pv.missing.add(rel);
        return new Response('Datei nicht gefunden: ' + rel, { status: 404 });
      }
      const ext = (rel.split('.').pop() || '').toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      if (type === 'text/html') {
        let html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
        const hook = importMap(id) + (pv.test ? TEST_HOOK + CONSOLE_HOOK : CONSOLE_HOOK);
        // Ganz vorne in <head> einfügen (Import-Map muss vor allen Modul-Skripten stehen)
        if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + hook);
        else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => m + '<head>' + hook + '</head>');
        else if (/<!doctype[^>]*>/i.test(html)) html = html.replace(/<!doctype[^>]*>/i, (m) => m + hook);
        else html = hook + html;
        body = html;
      }
      return new Response(body, { headers: { 'Content-Type': type + (type.startsWith('text') || type.endsWith('json') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' } });
    } catch (err) {
      return new Response('Fehler: ' + err.message, { status: 500 });
    }
  });
}

// ---------- three.js & forge3d für Spiele (offline, ohne CDN) ----------
const VENDOR = path.join(__dirname, 'vendor');
const LIB_TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
function importMap(id) {
  const b = `/${id}/__forge/`;
  return `<script type="importmap">${JSON.stringify({
    imports: { three: b + 'three/three.module.js', 'three/addons/': b + 'three/addons/', 'three/examples/jsm/': b + 'three/addons/', forge3d: b + 'forge3d/forge3d.js' },
  })}</script>`;
}
function serveForgeLib(pv, rel) {
  const headers = (t) => ({ 'Content-Type': t, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
  // Modelle dieses Chats
  const m = /^forge3d\/models\/(.+)\.json$/.exec(rel);
  if (m) {
    const models = pv.models || {};
    const key = decodeURIComponent(m[1]).toLowerCase();
    const found = Object.keys(models).find((k) => k.toLowerCase() === key);
    if (!found) {
      if (pv.missing) pv.missing.add('Modell „' + key + '“');
      return new Response('{}', { status: 404, headers: headers(LIB_TYPES['.json']) });
    }
    return new Response(JSON.stringify(models[found]), { headers: headers(LIB_TYPES['.json']) });
  }
  if (rel === 'forge3d/models/index.json') return new Response(JSON.stringify(Object.keys(pv.models || {})), { headers: headers(LIB_TYPES['.json']) });
  const file = path.resolve(VENDOR, rel);
  if (!file.startsWith(VENDOR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('nicht gefunden', { status: 404 });
  return new Response(fs.readFileSync(file), { headers: headers(LIB_TYPES[path.extname(file)] || 'application/octet-stream') });
}

// Testlauf der Selbstprüfung: keine Popups, keine neuen Fenster
const TEST_HOOK = `<script>(()=>{window.alert=()=>{};window.confirm=()=>true;window.prompt=(m,d)=>d||'';window.open=()=>null;})();</script>`;

function createPreview({ files = {}, entry, baseDir = null, test = false, models = null }) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  previews.set(id, { files, entry, baseDir, test, models: models || {}, missing: test ? new Set() : null });
  while (previews.size > 30) previews.delete(previews.keys().next().value);
  return { id, url: `forge-run://preview/${id}/${encodeURI(entry)}` };
}

function previewInfo(id) {
  return previews.get(id) || null;
}
function dropPreview(id) {
  previews.delete(id);
}

function openPreviewWindow(url) {
  const w = new BrowserWindow({
    width: 1100,
    height: 780,
    title: 'FORGE – Vorschau',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  w.setMenu(null);
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') w.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') w.setFullScreen(!w.isFullScreen());
  });
  w.loadURL(url);
}

// ======================================================================
//                       Programme in vielen Sprachen
// ======================================================================
const NODE = { bin: process.execPath, pre: [], env: { ELECTRON_RUN_AS_NODE: '1' } };

const LANGS = {
  javascript: { name: 'JavaScript (Node.js)', ext: 'js', builtin: true, cmd: () => NODE },
  typescript: { name: 'TypeScript', ext: 'ts', builtin: true, cmd: () => NODE },
  python: {
    name: 'Python',
    ext: 'py',
    detect: isWin
      ? [['py', ['-3']], ['python', []], ['python3', []]]
      : [['python3', []], ['python', []]],
    versionArg: '--version',
    versionRe: /Python 3\.\d+/,
    args: ['-u'],
    env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    winget: 'Python.Python.3.12',
    url: 'https://www.python.org/downloads/',
  },
  powershell: { name: 'PowerShell', ext: 'ps1', winOnly: true, builtin: true, cmd: () => ({ bin: 'powershell.exe', pre: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] }) },
  batch: { name: 'Batch (CMD)', ext: 'bat', winOnly: true, builtin: true, cmd: () => ({ bin: 'cmd.exe', pre: ['/d', '/c'] }) },
  bash: { name: 'Bash', ext: 'sh', detect: [['bash', []]], versionArg: '--version', versionRe: /bash/i, url: 'https://git-scm.com/downloads' },
  java: { name: 'Java', ext: 'java', detect: [['java', []]], versionArg: '-version', versionRe: /version|openjdk/i, winget: 'EclipseAdoptium.Temurin.21.JDK', url: 'https://adoptium.net/' },
  go: { name: 'Go', ext: 'go', detect: [['go', []]], versionArg: 'version', versionRe: /go version/i, pre: ['run'], winget: 'GoLang.Go', url: 'https://go.dev/dl/' },
  lua: { name: 'Lua', ext: 'lua', detect: [['lua', []], ['lua54', []]], versionArg: '-v', versionRe: /Lua/i, url: 'https://luabinaries.sourceforge.net/' },
  ruby: { name: 'Ruby', ext: 'rb', detect: [['ruby', []]], versionArg: '--version', versionRe: /ruby/i, url: 'https://rubyinstaller.org/' },
  php: { name: 'PHP', ext: 'php', detect: [['php', []]], versionArg: '--version', versionRe: /PHP/i, url: 'https://windows.php.net/download/' },
  cpp: { name: 'C++', ext: 'cpp', detect: [['g++', []], ['clang++', []]], versionArg: '--version', versionRe: /g\+\+|clang|gcc/i, compile: true, url: 'https://winlibs.com/' },
  c: { name: 'C', ext: 'c', detect: [['gcc', []], ['clang', []]], versionArg: '--version', versionRe: /gcc|clang/i, compile: true, url: 'https://winlibs.com/' },
  rust: { name: 'Rust', ext: 'rs', detect: [['rustc', []]], versionArg: '--version', versionRe: /rustc/i, compile: true, winget: 'Rustlang.Rustup', url: 'https://rustup.rs/' },
};

let runtimeCache = null;

function probe(bin, pre, arg, re) {
  try {
    const r = spawnSync(bin, [...pre, arg], { encoding: 'utf8', timeout: 6000, windowsHide: true });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.error || !re.test(out)) return null;
    return out.split('\n').find((l) => re.test(l)).trim().slice(0, 60);
  } catch {
    return null;
  }
}

function detectRuntimes(force = false) {
  if (runtimeCache && !force) return runtimeCache;
  const res = {};
  for (const [id, L] of Object.entries(LANGS)) {
    if (L.winOnly && !isWin) continue;
    if (L.builtin) {
      res[id] = { name: L.name, available: true, builtin: true };
      continue;
    }
    let found = null;
    if (id === 'python' && forgePythonReady()) found = { bin: pyExe(), pre: [], version: 'FORGE-Python (eingebaut)', forge: true };
    for (const [bin, pre] of found ? [] : L.detect) {
      const v = probe(bin, pre, L.versionArg, L.versionRe);
      if (v) {
        found = { bin, pre, version: v };
        break;
      }
    }
    res[id] = { name: L.name, available: !!found, version: found && found.version, winget: isWin ? L.winget || null : null, url: L.url || null, _cmd: found };
    // Python fehlt? Kein Problem: FORGE holt sein eingebautes Python automatisch
    if (id === 'python' && !found && pythonPackSupported()) Object.assign(res[id], { available: true, auto: true, version: 'FORGE-Python (wird automatisch eingerichtet)' });
  }
  runtimeCache = res;
  return res;
}

function publicRuntimes(force) {
  const r = detectRuntimes(force);
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    const { _cmd, ...rest } = v;
    out[k] = rest;
  }
  return out;
}

const procs = new Map(); // id -> child

function safeName(n, fallback) {
  const b = path.basename(String(n || '')).replace(/[^\w.\- ]+/g, '_');
  return b && b !== '.' && b !== '..' ? b : fallback;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (isWin) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

// Startet ein Programm. send(type, data) schickt Ausgaben an die Oberfläche.
async function start(id, { lang, files = {}, entry, cwd }, send) {
  const L = LANGS[lang];
  if (!L) throw new Error('Diese Sprache kann FORGE (noch) nicht ausführen: ' + lang);
  let rt = detectRuntimes()[lang];
  if (!rt || !rt.available) throw new Error(`MISSING:${lang}`);
  if (rt.auto) {
    // Eingebautes Python einmalig einrichten (läuft sonst schon im Hintergrund nach dem Start)
    send('out', { stream: 'info', text: 'Richte das eingebaute Python ein (nur beim ersten Mal, ca. 1 Minute) …\n' });
    try {
      await ensurePython((st) => send('prep', st));
    } catch (err) {
      runtimeCache = null;
      throw new Error(`MISSING:${lang}`);
    }
    runtimeCache = null;
    rt = detectRuntimes()[lang];
    if (!rt || !rt._cmd) throw new Error(`MISSING:${lang}`);
    send('out', { stream: 'info', text: '✓ Python ist bereit (mit pygame, numpy, pillow, requests).\n' });
  }

  // Dateien in einen eigenen Arbeitsordner schreiben (oder im Ordner der geöffneten Datei laufen)
  let dir = cwd;
  let entryPath;
  if (!dir) {
    dir = path.join(RUN_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const p = path.join(dir, safeName(name, 'datei.txt'));
      fs.writeFileSync(p, content);
    }
    entryPath = path.join(dir, safeName(entry, 'main.' + L.ext));
    if (!fs.existsSync(entryPath)) fs.writeFileSync(entryPath, Object.values(files)[0] || '');
  } else {
    entryPath = path.join(dir, entry);
  }

  const env = { ...process.env, ...(L.env || {}) };
  if (rt._cmd && rt._cmd.forge) Object.assign(env, { PYTHONNOUSERSITE: '1', PYGAME_HIDE_SUPPORT_PROMPT: '1' });
  let bin;
  let args;
  if (L.builtin) {
    const c = L.cmd();
    bin = c.bin;
    args = [...c.pre, entryPath];
    Object.assign(env, c.env || {});
  } else if (L.compile) {
    // Erst kompilieren, dann starten
    const c = rt._cmd;
    const exe = path.join(dir, 'programm' + (isWin ? '.exe' : ''));
    const cargs = lang === 'rust' ? ['-O', entryPath, '-o', exe] : [entryPath, '-O1', '-o', exe, ...(lang === 'cpp' ? ['-std=c++17'] : [])];
    send('out', { stream: 'info', text: `Kompiliere mit ${c.bin} …\n` });
    const ok = await new Promise((resolve) => {
      const cp = spawn(c.bin, [...c.pre, ...cargs], { cwd: dir, env, windowsHide: true });
      cp.stdout.on('data', (d) => send('out', { stream: 'stdout', text: String(d) }));
      cp.stderr.on('data', (d) => send('out', { stream: 'stderr', text: String(d) }));
      cp.on('error', (e) => {
        send('out', { stream: 'stderr', text: e.message + '\n' });
        resolve(false);
      });
      cp.on('close', (code) => resolve(code === 0));
    });
    if (!ok) {
      send('exit', { code: 1, compileFailed: true });
      return;
    }
    bin = exe;
    args = [];
  } else {
    const c = rt._cmd;
    bin = c.bin;
    args = [...c.pre, ...(L.pre || []), ...(L.args || []), entryPath];
  }

  const child = spawn(bin, args, { cwd: dir, env, windowsHide: true, detached: !isWin });
  procs.set(id, child);
  child.stdout.on('data', (d) => send('out', { stream: 'stdout', text: String(d) }));
  child.stderr.on('data', (d) => send('out', { stream: 'stderr', text: String(d) }));
  child.on('error', (e) => send('out', { stream: 'stderr', text: e.message + '\n' }));
  child.on('close', (code, signal) => {
    procs.delete(id);
    send('exit', { code, signal });
  });
}

function input(id, text) {
  const c = procs.get(id);
  if (c && c.stdin.writable) c.stdin.write(text + '\n');
}

function stop(id) {
  killTree(procs.get(id));
}

function stopAll() {
  for (const c of procs.values()) killTree(c);
}

// Fehlendes Python-Paket nachinstallieren (z. B. pygame)
const PIP_NAMES = { cv2: 'opencv-python', PIL: 'pillow', yaml: 'pyyaml', sklearn: 'scikit-learn', bs4: 'beautifulsoup4', dotenv: 'python-dotenv' };
async function pipInstall(id, module, send) {
  const rt = detectRuntimes().python;
  if (!rt || !rt.available || !rt._cmd) throw new Error('MISSING:python');
  const pkg = PIP_NAMES[module] || module;
  const c = rt._cmd;
  send('out', { stream: 'info', text: `Installiere ${pkg} automatisch …\n` });
  const where = c.forge ? [] : ['--user']; // eingebautes Python: direkt in seinen eigenen Ordner
  const child = spawn(c.bin, [...c.pre, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', ...where, pkg], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...(c.forge ? { PYTHONNOUSERSITE: '1' } : {}) },
  });
  procs.set(id, child);
  child.stdout.on('data', (d) => send('out', { stream: 'stdout', text: String(d) }));
  child.stderr.on('data', (d) => send('out', { stream: 'stderr', text: String(d) }));
  child.on('close', (code) => {
    procs.delete(id);
    send('exit', { code, pip: pkg });
  });
}

// Fehlende Sprache über winget in einem sichtbaren Fenster installieren
function installRuntime(lang) {
  const L = LANGS[lang];
  if (!L) return false;
  if (isWin && L.winget) {
    // Sichtbares Fenster, damit man sieht, was installiert wird
    const cmd = `start "FORGE Installation" cmd.exe /k "winget install -e --id ${L.winget} & echo. & echo Fertig - du kannst dieses Fenster schliessen und in FORGE nochmal auf Ausfuehren klicken."`;
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    runtimeCache = null;
    return true;
  }
  if (L.url) shell.openExternal(L.url);
  runtimeCache = null;
  return true;
}

// ======================================================================
//        FORGE-Python: eingebautes Python mit pygame, numpy, pillow, requests
// ======================================================================
// Wird von GitHub (Release „python-N“ im FORGE-Repo) einmal automatisch geholt – ohne Installation, ohne Admin.
const PY_PACK = { tag: 'python-2', file: 'forge-python-win64.zip', info: 'forge-python-win64.json' };
let pyJob = null;
const pyWatchers = new Set();
let pyLog = () => {};

function pythonPackSupported() {
  return isWin || !!process.env.FORGE_PY_URL;
}
function pyRoot() {
  return path.join(app.getPath('userData'), 'runtimes', 'python');
}
function pyExe() {
  return isWin ? path.join(pyRoot(), 'python', 'python.exe') : path.join(pyRoot(), 'python', 'bin', 'python3');
}
function forgePythonReady() {
  if (!pythonPackSupported()) return false;
  try {
    const ok = JSON.parse(fs.readFileSync(path.join(pyRoot(), 'ok.json'), 'utf8'));
    return ok.tag === PY_PACK.tag && fs.existsSync(pyExe());
  } catch {
    return false;
  }
}
function packBase() {
  if (process.env.FORGE_PY_URL) return process.env.FORGE_PY_URL.replace(/\/+$/, '');
  let repo = process.env.FORGE_UPDATE_REPO;
  if (!repo) {
    try {
      repo = require(path.join(app.getAppPath(), 'package.json')).forge.updateRepo;
    } catch {}
  }
  return `https://github.com/${repo || 'Fabianhihi/forge-ai'}/releases/download/${PY_PACK.tag}`;
}

async function getJson(url) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return res.json();
}

async function downloadTo(url, dest, size, onPct) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden von Python`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  const out = fs.createWriteStream(dest);
  const hash = crypto.createHash('sha256');
  const reader = res.body.getReader();
  let got = 0;
  let last = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      got += buf.length;
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== last) onPct((last = pct));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  return hash.digest('hex');
}

// Entpacken ohne die App einzufrieren (Windows hat tar.exe eingebaut, sonst PowerShell)
async function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tries = isWin
    ? [
        [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dest]],
        ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]],
      ]
    : [['unzip', ['-oq', zip, '-d', dest]]];
  let lastErr = null;
  for (const [bin, args] of tries) {
    const r = await new Promise((resolve) => {
      let err = '';
      const cp = spawn(bin, args, { windowsHide: true });
      cp.stderr.on('data', (d) => (err += d).length > 2000 && (err = err.slice(-1000)));
      cp.on('error', (e) => resolve({ ok: false, err: e.message }));
      cp.on('close', (code) => resolve({ ok: code === 0, err: err.trim().slice(-300) || 'Code ' + code }));
    });
    if (r.ok) return;
    lastErr = r.err;
  }
  throw new Error('Entpacken fehlgeschlagen: ' + lastErr);
}

// Eingebautes Python bereitstellen (einmalig). onState({ phase, pct }) für die Anzeige.
function ensurePython(onState) {
  if (forgePythonReady()) return Promise.resolve(pyExe());
  if (onState) pyWatchers.add(onState);
  const emit = (st) => {
    for (const w of pyWatchers) {
      try {
        w(st);
      } catch {}
    }
  };
  if (!pyJob) {
    pyJob = (async () => {
      const root = pyRoot();
      fs.mkdirSync(root, { recursive: true });
      const base = packBase();
      pyLog('info', 'FORGE-Python: lade von ' + base);
      emit({ phase: 'download', pct: 0 });
      const info = await getJson(`${base}/${PY_PACK.info}`);
      const zip = path.join(root, 'download.zip');
      let sha = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          sha = await downloadTo(`${base}/${info.file || PY_PACK.file}`, zip, info.size, (pct) => emit({ phase: 'download', pct }));
          if (!info.sha256 || sha === info.sha256) break;
          throw new Error('Prüfsumme stimmt nicht');
        } catch (err) {
          if (attempt === 2) throw err;
          pyLog('warn', 'FORGE-Python: neuer Versuch – ' + err.message);
        }
      }
      emit({ phase: 'extract', pct: 100 });
      const staging = path.join(root, 'neu');
      fs.rmSync(staging, { recursive: true, force: true });
      await extractZip(zip, staging);
      const old = path.join(root, 'python');
      fs.rmSync(old, { recursive: true, force: true });
      fs.renameSync(path.join(staging, 'python'), old);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(zip, { force: true });
      if (!fs.existsSync(pyExe())) throw new Error('python.exe fehlt im Paket');
      fs.writeFileSync(path.join(root, 'ok.json'), JSON.stringify({ tag: PY_PACK.tag, sha256: sha, at: new Date().toISOString() }));
      runtimeCache = null;
      pyLog('info', 'FORGE-Python bereit: ' + pyExe());
      emit({ phase: 'ready', pct: 100 });
      return pyExe();
    })()
      .catch((err) => {
        pyLog('warn', 'FORGE-Python fehlgeschlagen: ' + err.message);
        emit({ phase: 'error', error: err.message });
        throw err;
      })
      .finally(() => {
        pyJob = null;
        pyWatchers.clear();
      });
  }
  return pyJob;
}

// Nach dem Start im Hintergrund vorbereiten, damit Python-Code später sofort läuft
function prefetchPython(log) {
  if (log) pyLog = log;
  if (!pythonPackSupported() || forgePythonReady()) return;
  ensurePython().catch(() => {});
}

function setLogger(log) {
  if (log) pyLog = log;
}

module.exports = { getJson, downloadTo, extractZip, detectRuntimes, previewInfo, dropPreview, ensurePython, registerScheme, handleProtocol, createPreview, openPreviewWindow, publicRuntimes, start, input, stop, stopAll, pipInstall, installRuntime, prefetchPython, forgePythonReady, setLogger };
