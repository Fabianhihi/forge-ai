// FORGE AI – Selbstprüfung: Code der KI prüfen, bevor du ihn startest.
// Python: Syntax, unbekannte Namen, fehlende Module (pyflakes, führt nichts aus).
// JavaScript/TypeScript: Syntax. HTML: Syntax der Skripte + kurzer unsichtbarer Testlauf mit Klicks und Tasten.
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const runner = require('./runner');

const CHECK_DIR = path.join(os.tmpdir(), 'forge-check');
const VENDOR = path.join(__dirname, 'vendor');
const NODE = process.execPath; // Electron als Node

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(bin, args, { cwd, env, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const cp = spawn(bin, args, { cwd, env, windowsHide: true });
    const t = setTimeout(() => {
      try {
        cp.kill();
      } catch {}
    }, timeout);
    cp.stdout.on('data', (d) => (out += d));
    cp.stderr.on('data', (d) => (err += d));
    const fin = (code, e) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ code, out, err: e ? e.message : err });
    };
    cp.on('error', (e) => fin(-1, e));
    cp.on('close', (code) => fin(code));
  });
}

const lastJson = (s) => {
  const line = String(s).trim().split('\n').reverse().find((l) => l.trim().startsWith('['));
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
};

// ---------- Python ----------
const PY_CHECK = String.raw`
import sys, os, json, ast, importlib.util
vendor = sys.argv[1]
sys.path.insert(1, vendor)
res = []
try:
    from pyflakes import api
except Exception as e:
    print(json.dumps([{"file": "", "line": 0, "msg": "Prüfer nicht verfügbar: %s" % e, "kind": "skip"}]))
    sys.exit(0)
ERR = {"UndefinedName", "UndefinedLocal", "UndefinedExport", "DuplicateArgument", "ReturnOutsideFunction",
       "YieldOutsideFunction", "ContinueOutsideLoop", "BreakOutsideLoop", "DefaultExceptNotLast",
       "TwoStarredExpressions", "TooManyExpressionsInStarredAssignment", "PercentFormatMissingArgument",
       "PercentFormatPositionalCountMismatch", "PercentFormatExpectedMapping", "PercentFormatExpectedSequence",
       "StringDotFormatMissingArgument", "ForwardAnnotationSyntaxError", "InvalidPrintSyntax", "RaiseNotImplemented"}
cur = {"f": ""}
class R:
    def unexpectedError(self, filename, msg):
        res.append({"file": cur["f"], "line": 0, "msg": str(msg), "kind": "error"})
    def syntaxError(self, filename, msg, lineno, offset, text):
        t = (text or "").strip()
        res.append({"file": cur["f"], "line": lineno or 0, "msg": "SyntaxError: %s%s" % (msg, (" → " + t) if t else ""), "kind": "error"})
    def flake(self, m):
        name = type(m).__name__
        if name in ERR:
            res.append({"file": cur["f"], "line": m.lineno, "msg": m.message % m.message_args, "kind": "error", "type": name})
seen = set()
local = {os.path.splitext(f)[0] for f in os.listdir(".")}
for f in sys.argv[2:]:
    cur["f"] = f
    try:
        code = open(f, encoding="utf-8").read()
    except Exception as e:
        continue
    api.check(code, f, R())
    try:
        tree = ast.parse(code)
    except SyntaxError:
        continue
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        for n in names:
            top = n.split(".")[0]
            if top in seen or top in local:
                continue
            seen.add(top)
            try:
                found = importlib.util.find_spec(top) is not None
            except Exception:
                found = True
            if not found:
                res.append({"file": f, "line": getattr(node, "lineno", 0), "msg": "Modul '%s' ist nicht installiert" % top, "kind": "missing", "module": top})
print(json.dumps(res))
`;

async function checkPython(dir, pyFiles) {
  const rt = runner.detectRuntimes().python;
  const c = rt && rt._cmd;
  if (!c) {
    if (rt && rt.auto) runner.ensurePython().catch(() => {}); // fürs nächste Mal vorbereiten
    return { skipped: 'Python wird gerade eingerichtet' };
  }
  fs.writeFileSync(path.join(dir, '_forge_check.py'), PY_CHECK);
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', ...(c.forge ? { PYTHONNOUSERSITE: '1' } : {}) };
  const r = await run(c.bin, [...c.pre, '_forge_check.py', VENDOR, ...pyFiles], { cwd: dir, env, timeout: 30000 });
  const list = lastJson(r.out);
  if (!list) return { skipped: 'Python-Prüfung fehlgeschlagen: ' + (r.err || r.out).trim().split('\n').pop() };
  if (list.some((p) => p.kind === 'skip')) return { skipped: list[0].msg };
  return { problems: list };
}

// ---------- JavaScript / TypeScript (nur Syntax, nichts wird ausgeführt) ----------
const JS_CHECK = String.raw`
const vm = require('vm');
const fs = require('fs');
let strip = null;
try { strip = require('module').stripTypeScriptTypes; } catch {}
const out = [];
for (const s of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) {
  let code = s.code;
  const name = '__forge_' + s.n + (s.module ? '.mjs' : '.js');
  try {
    if (s.ts) {
      if (!strip) continue;
      code = strip(code, { mode: 'transform' });
    }
    const isModule = s.module || /^\s*(import\s+[\w{*'"]|import\s*\(|export\s)/m.test(code);
    if (isModule) {
      if (!vm.SourceTextModule) continue;
      new vm.SourceTextModule(code, { identifier: name });
    } else new vm.Script(code, { filename: name });
  } catch (e) {
    const isSyntax = e && (e.name === 'SyntaxError' || e.code === 'ERR_INVALID_TYPESCRIPT_SYNTAX');
    if (!isSyntax) continue;
    const m = String(e.stack || '').match(/__forge_\d+\.m?js:(\d+)/) || String(e.message).match(/\((\d+):\d+\)/);
    out.push({ file: s.file, line: (m ? +m[1] : 0) + (s.offset || 0), msg: 'SyntaxError: ' + String(e.message).split('\n')[0], kind: 'error' });
  }
}
console.log(JSON.stringify(out));
`;

async function checkJs(dir, sources) {
  if (!sources.length) return { problems: [] };
  fs.writeFileSync(path.join(dir, '_forge_jscheck.js'), JS_CHECK);
  fs.writeFileSync(path.join(dir, '_forge_sources.json'), JSON.stringify(sources.map((s, n) => ({ ...s, n }))));
  const r = await run(NODE, ['--experimental-vm-modules', '--no-warnings', '_forge_jscheck.js', '_forge_sources.json'], {
    cwd: dir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 20000,
  });
  const list = lastJson(r.out);
  if (!list) return { skipped: 'JavaScript-Prüfung fehlgeschlagen' };
  return { problems: list };
}

// Inline-Skripte aus HTML holen (mit Zeilenversatz für richtige Zeilennummern)
function htmlScripts(file, html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '';
    if (type && !/^(module|text\/javascript|application\/javascript|javascript)$/i.test(type)) continue;
    const before = html.slice(0, m.index + m[0].indexOf('>') + 1);
    const offset = (before.match(/\n/g) || []).length;
    if (m[2].trim()) out.push({ file, code: m[2], module: /^module$/i.test(type), offset });
  }
  return out;
}

// ---------- HTML: unsichtbarer Testlauf ----------
async function smokeWeb(files, entry, ms = 3500) {
  const { id, url } = runner.createPreview({ files, entry, test: true });
  const problems = [];
  const seen = new Set();
  const add = (msg, line, file) => {
    const key = msg + '|' + line;
    if (seen.has(key) || problems.length >= 8) return;
    seen.add(key);
    problems.push({ file: file || entry, line: line || 0, msg, kind: 'error' });
  };
  const w = new BrowserWindow({
    show: false,
    width: 960,
    height: 720,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  try {
    const wc = w.webContents;
    wc.setAudioMuted(true);
    wc.setFrameRate(30);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, u) => {
      if (!String(u).startsWith('forge-run://')) e.preventDefault();
    });
    wc.on('console-message', (e, ...a) => {
      // Electron 35+: Daten im Event-Objekt, ältere Versionen: einzelne Argumente
      const level = e && e.level !== undefined ? e.level : a[0];
      const message = e && e.message !== undefined ? e.message : a[1];
      const line = e && e.lineNumber !== undefined ? e.lineNumber : a[2];
      const src = e && e.sourceId !== undefined ? e.sourceId : a[3];
      if (!(level === 'error' || level === 3)) return;
      if (/favicon|Failed to load resource/i.test(message)) return; // fehlende Dateien melden wir selbst
      const file = String(src || '').startsWith('forge-run://') ? decodeURIComponent(String(src).split('/').slice(4).join('/')) : entry;
      add(String(message).replace(/^Uncaught\s+/, ''), line, file);
    });
    wc.on('render-process-gone', (_e, d) => add('Die Seite ist abgestürzt (' + (d && d.reason) + ')', 0));
    let loaded = true;
    await Promise.race([
      w.loadURL(url).catch((err) => {
        loaded = false;
        add('Seite konnte nicht geladen werden: ' + err.message, 0);
      }),
      sleep(8000),
    ]);
    if (loaded && !w.isDestroyed()) {
      await sleep(700);
      // Wie ein Spieler: klicken und ein paar typische Tasten drücken
      const send = (ev) => {
        try {
          if (!w.isDestroyed()) wc.sendInputEvent(ev);
        } catch {}
      };
      send({ type: 'mouseMove', x: 480, y: 360 });
      send({ type: 'mouseDown', x: 480, y: 360, button: 'left', clickCount: 1 });
      send({ type: 'mouseUp', x: 480, y: 360, button: 'left', clickCount: 1 });
      for (const key of ['Space', 'Enter', 'Right', 'Up', 'Left', 'W', 'D', 'Down', 'S', 'A']) {
        await sleep(110);
        send({ type: 'keyDown', keyCode: key });
        if (key.length === 1) send({ type: 'char', keyCode: key.toLowerCase() });
        await sleep(60);
        send({ type: 'keyUp', keyCode: key });
      }
      await sleep(Math.max(500, ms - 2600));
    }
    const pv = runner.previewInfo(id);
    if (pv && pv.missing) for (const f of pv.missing) add(`Datei „${f}“ fehlt (Bilder/Sounds müssen im Code erzeugt werden)`, 0);
  } finally {
    if (!w.isDestroyed()) w.destroy();
    runner.dropPreview(id);
  }
  return { problems };
}

// ---------- Hauptfunktion ----------
// spec: { kind: 'python'|'javascript'|'typescript'|'web', files: {name: code}, entry }
async function check(spec) {
  const files = spec.files || {};
  const dir = path.join(CHECK_DIR, Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dir, { recursive: true });
  const result = { problems: [], checked: [], skipped: [] };
  const merge = (r, label) => {
    if (r.skipped) result.skipped.push(r.skipped);
    else result.checked.push(label);
    if (r.problems) result.problems.push(...r.problems);
  };
  try {
    for (const [name, content] of Object.entries(files)) {
      const safe = path.basename(name).replace(/[^\w.\- ]+/g, '_');
      if (safe && !safe.startsWith('_forge_')) fs.writeFileSync(path.join(dir, safe), content);
    }
    const names = Object.keys(files).map((n) => path.basename(n));
    if (spec.kind === 'python') {
      merge(await checkPython(dir, names.filter((n) => /\.py$/i.test(n))), 'Syntax & Namen');
    } else if (spec.kind === 'javascript' || spec.kind === 'typescript') {
      const src = names.filter((n) => /\.(m?js|cjs|ts|mts)$/i.test(n)).map((n) => ({ file: n, code: files[n] || files[Object.keys(files).find((k) => path.basename(k) === n)], ts: /\.m?ts$/i.test(n), module: /\.m(js|ts)$/i.test(n) }));
      merge(await checkJs(dir, src), 'Syntax');
    } else if (spec.kind === 'web') {
      const src = [];
      for (const [n, c] of Object.entries(files)) {
        const b = path.basename(n);
        if (/\.html?$/i.test(b)) src.push(...htmlScripts(b, String(c)));
        else if (/\.m?js$/i.test(b)) src.push({ file: b, code: String(c), module: /\.mjs$/i.test(b) });
      }
      const syn = await checkJs(dir, src);
      merge(syn, 'Syntax');
      // Testlauf nur, wenn die Syntax stimmt (sonst ist der Fehler schon klar)
      if (!syn.problems || !syn.problems.length) merge(await smokeWeb(files, spec.entry || 'index.html', spec.ms || 3500), 'Testlauf');
    }
  } catch (err) {
    result.skipped.push('Prüfung fehlgeschlagen: ' + err.message);
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
  return result;
}

module.exports = { check, htmlScripts };
