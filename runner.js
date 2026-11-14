// FORGE AI – Code ausführen: Web-Vorschau (Spiele, Webseiten) und Programme in vielen Sprachen
const { protocol, BrowserWindow, shell } = require('electron');
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
      let body = findFile(pv, rel);
      if (body == null) return new Response('Datei nicht gefunden: ' + rel, { status: 404 });
      const ext = (rel.split('.').pop() || '').toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      if (type === 'text/html') {
        let html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + CONSOLE_HOOK) : CONSOLE_HOOK + html;
        body = html;
      }
      return new Response(body, { headers: { 'Content-Type': type + (type.startsWith('text') || type.endsWith('json') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' } });
    } catch (err) {
      return new Response('Fehler: ' + err.message, { status: 500 });
    }
  });
}

function createPreview({ files = {}, entry, baseDir = null }) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  previews.set(id, { files, entry, baseDir });
  while (previews.size > 30) previews.delete(previews.keys().next().value);
  return { id, url: `forge-run://preview/${id}/${encodeURI(entry)}` };
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
    for (const [bin, pre] of L.detect) {
      const v = probe(bin, pre, L.versionArg, L.versionRe);
      if (v) {
        found = { bin, pre, version: v };
        break;
      }
    }
    res[id] = { name: L.name, available: !!found, version: found && found.version, winget: isWin ? L.winget || null : null, url: L.url || null, _cmd: found };
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
  const rt = detectRuntimes()[lang];
  if (!rt || !rt.available) throw new Error(`MISSING:${lang}`);

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
  if (!rt || !rt.available) throw new Error('MISSING:python');
  const pkg = PIP_NAMES[module] || module;
  const c = rt._cmd;
  send('out', { stream: 'info', text: `Installiere ${pkg} …\n` });
  const child = spawn(c.bin, [...c.pre, '-m', 'pip', 'install', '--user', pkg], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
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

module.exports = { registerScheme, handleProtocol, createPreview, openPreviewWindow, publicRuntimes, start, input, stop, stopAll, pipInstall, installRuntime };
