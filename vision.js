// FORGE AI – Bilder verstehen.
// Das Effizient-Modell (Qwen3.5) kann Bilder sehen, wenn man ihm seinen Bild-Encoder (mmproj) gibt.
// FORGEs KI-Motor kann das (noch) nicht, darum benutzt FORGE dafür kurz llama-mtmd-cli von llama.cpp:
// KI pausieren → Bild ansehen → Beschreibung → KI wieder starten. Alles lokal, nichts geht ins Internet.
const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const runner = require('./runner');

const VISION_PACK = { tag: 'vision-1', file: 'forge-vision-win64.zip', info: 'forge-vision-win64.json' };
const isWin = process.platform === 'win32';
let log = () => {};
let packJob = null;

function root() {
  return path.join(app.getPath('userData'), 'runtimes', 'vision');
}
function exe() {
  return path.join(root(), 'vision', isWin ? 'llama-mtmd-cli.exe' : 'llama-mtmd-cli');
}
function packReady() {
  try {
    const ok = JSON.parse(fs.readFileSync(path.join(root(), 'ok.json'), 'utf8'));
    return ok.tag === VISION_PACK.tag && fs.existsSync(exe());
  } catch {
    return false;
  }
}
function base() {
  if (process.env.FORGE_VISION_URL) return process.env.FORGE_VISION_URL.replace(/\/+$/, '');
  let repo = process.env.FORGE_UPDATE_REPO;
  if (!repo) {
    try {
      repo = require(path.join(app.getAppPath(), 'package.json')).forge.updateRepo;
    } catch {}
  }
  return `https://github.com/${repo || 'Fabianhihi/forge-ai'}/releases/download/${VISION_PACK.tag}`;
}

async function ensurePack(onState) {
  if (packReady()) return exe();
  if (!isWin && !process.env.FORGE_VISION_URL) throw new Error('Bild-Verständnis gibt es nur unter Windows.');
  if (!packJob) {
    packJob = (async () => {
      fs.mkdirSync(root(), { recursive: true });
      const info = await runner.getJson(`${base()}/${VISION_PACK.info}`);
      const zip = path.join(root(), 'download.zip');
      onState({ phase: 'pack', pct: 0 });
      const sha = await runner.downloadTo(`${base()}/${info.file || VISION_PACK.file}`, zip, info.size, (pct) => onState({ phase: 'pack', pct }));
      if (info.sha256 && sha !== info.sha256) throw new Error('Prüfsumme des Bild-Pakets stimmt nicht');
      const staging = path.join(root(), 'neu');
      fs.rmSync(staging, { recursive: true, force: true });
      await runner.extractZip(zip, staging);
      fs.rmSync(path.join(root(), 'vision'), { recursive: true, force: true });
      fs.renameSync(path.join(staging, 'vision'), path.join(root(), 'vision'));
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(zip, { force: true });
      if (!isWin) fs.chmodSync(exe(), 0o755);
      fs.writeFileSync(path.join(root(), 'ok.json'), JSON.stringify({ tag: VISION_PACK.tag, at: new Date().toISOString() }));
      log('info', 'Vision-Paket bereit');
      return exe();
    })().finally(() => (packJob = null));
  }
  return packJob;
}

// Großen Bild-Encoder mit Fortsetzen laden (nur beim ersten Bild nötig)
async function ensureMmproj(dir, v, onState) {
  const dest = path.join(dir, v.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  const part = dest + '.part';
  for (let attempt = 1; attempt <= 3; attempt++) {
    let have = 0;
    try {
      have = fs.statSync(part).size;
    } catch {}
    try {
      const res = await net.fetch(v.url, { headers: have ? { Range: `bytes=${have}-` } : {}, cache: 'no-store' });
      if (!(res.ok || res.status === 206)) throw new Error('HTTP ' + res.status);
      if (have && res.status !== 206) have = 0;
      const total = have + (Number(res.headers.get('content-length')) || v.size);
      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      const reader = res.body.getReader();
      let got = have;
      let last = -1;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        got += value.length;
        const pct = Math.floor((got / total) * 100);
        if (pct !== last) onState({ phase: 'mmproj', pct: (last = pct) });
      }
      await new Promise((r) => out.end(r));
      fs.renameSync(part, dest);
      return dest;
    } catch (err) {
      log('warn', `Bild-Encoder laden (Versuch ${attempt}): ${err.message}`);
      if (attempt === 3) throw new Error('Der Bild-Encoder konnte nicht geladen werden: ' + err.message);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

function runCli(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const cp = spawn(bin, args, { windowsHide: true, cwd: path.dirname(bin) });
    const t = setTimeout(() => {
      try {
        cp.kill();
      } catch {}
    }, timeoutMs);
    cp.stdout.on('data', (d) => (out += d));
    cp.stderr.on('data', (d) => (err = (err + d).slice(-8000)));
    cp.on('error', (e) => {
      clearTimeout(t);
      resolve({ code: -1, out, err: e.message });
    });
    cp.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out, err });
    });
  });
}

// Antwort säubern: Gedanken (<think>) und Log-Reste entfernen
function cleanOutput(s) {
  let t = String(s || '');
  if (t.includes('</think>')) t = t.slice(t.lastIndexOf('</think>') + 8);
  t = t.replace(/<think>[\s\S]*$/, '');
  return t
    .split('\n')
    .filter((l) => !/^(llama_|ggml_|clip_|load_|print_info|main:|mtmd|encoding image|image (decoded|slice)|decoding image|common_|build:|system_info|sampler|generate:)/i.test(l.trim()))
    .join('\n')
    .trim();
}

const PROMPT = {
  model3d: `Sieh dir das Bild genau an. Beschreibe das Hauptobjekt so, dass man es als 3D-Modell aus einfachen Grundformen (Quader, Zylinder, Kugel, Kegel) nachbauen kann. Antworte auf Deutsch in genau diesem Format:
OBJEKT: was es ist (ein Satz)
STIL: z. B. Roblox, Minecraft, Lego, Cartoon, realistisch, Lowpoly
PROPORTIONEN: Höhe x Breite x Tiefe in Metern (geschätzt)
TEILE:
- Teilname – Form – Größe – Position (oben/unten/links/rechts/vorne/hinten) – Farbe als Hex-Code
(alle wichtigen Teile, von unten nach oben, 6 bis 20 Zeilen)
BESONDERHEITEN: Gesicht, Muster, Waffen, Accessoires, Symmetrie`,
  chat: `Beschreibe dieses Bild genau auf Deutsch: was zu sehen ist, alle Texte und Zahlen wörtlich, Farben, Aufbau. Wenn es Code, eine Fehlermeldung oder eine Benutzeroberfläche zeigt, schreib den Text vollständig ab.`,
};

// Bild beschreiben. imageData: data:-URL (PNG/JPEG). mode: 'model3d' | 'chat'. call(): RPC zum KI-Motor.
async function describe({ imageData, mode = 'model3d', question = '' }, call, onState = () => {}) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(imageData || ''));
  if (!m) throw new Error('Das Bild konnte nicht gelesen werden.');
  const tmp = path.join(os.tmpdir(), 'forge-bild-' + crypto.randomBytes(4).toString('hex') + '.' + (m[1].toLowerCase() === 'png' ? 'png' : 'jpg'));
  fs.writeFileSync(tmp, Buffer.from(m[2], 'base64'));
  const prompt = (PROMPT[mode] || PROMPT.chat) + (question ? `\nFrage dazu: ${question}` : '');
  let suspended = false;
  try {
    let bin;
    let args;
    if (process.env.FORGE_VISION_CMD) {
      // Nur für automatische Tests
      bin = process.env.FORGE_VISION_CMD;
      args = ['--image', tmp, '-p', prompt];
    } else {
      const vm = await call('visionModel');
      if (!vm || !vm.path) throw Object.assign(new Error('Bilder verstehen kann nur das Effizient-Modell (Qwen3.5 9B). Lade es im Modell-Menü.'), { code: 'NO_VISION_MODEL' });
      onState({ phase: 'prepare' });
      bin = await ensurePack(onState);
      const mmproj = await ensureMmproj(vm.dir, vm.mmproj, onState);
      args = ['-m', vm.path, '--mmproj', mmproj, '--image', tmp, '-p', prompt, '-n', '1600', '--temp', '0.2', '-c', '6144', '-ngl', '99'];
    }
    onState({ phase: 'look' });
    await call('suspend', 'Die KI schaut sich ein Bild an …');
    suspended = true;
    let r = await runCli(bin, args, 240000);
    if (r.code !== 0 && !process.env.FORGE_VISION_CMD) {
      log('warn', 'Bild auf der Grafikkarte fehlgeschlagen, versuche es mit dem Prozessor: ' + r.err.split('\n').slice(-3).join(' | '));
      onState({ phase: 'look', cpu: true });
      r = await runCli(bin, args.map((a, i) => (args[i - 1] === '-ngl' ? '0' : a)), 420000);
    }
    const text = cleanOutput(r.out);
    if (!text) throw new Error('Die KI konnte das Bild nicht lesen. ' + (r.err || '').trim().split('\n').slice(-2).join(' '));
    log('info', `Bild beschrieben (${text.length} Zeichen)`);
    return { text };
  } finally {
    fs.rm(tmp, { force: true }, () => {});
    if (suspended) await call('resume').catch(() => {});
  }
}

function setLogger(fn) {
  if (fn) log = fn;
}

module.exports = { describe, setLogger, cleanOutput, packReady };
