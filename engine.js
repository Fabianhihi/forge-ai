// FORGE AI – eingebauter KI-Motor (llama.cpp über node-llama-cpp)
// Erkennt die Hardware, lädt automatisch das passende Modell herunter und startet die KI.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const web = require('./web');

const HF = (process.env.FORGE_HF_BASE || 'https://huggingface.co').replace(/\/+$/, '');
const hf = (repo, file) => `${HF}/${repo}/resolve/main/${file}?download=true`;

const CATALOG = [
  {
    id: 'leicht',
    kind: 'code',
    title: 'Leicht',
    params: '3B',
    file: 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf',
    size: 1.93e9,
    desc: 'Schneller Coder für Laptops und PCs ohne starke Grafikkarte.',
    urls: [
      hf('bartowski/Qwen2.5-Coder-3B-Instruct-GGUF', 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-Coder-3B-Instruct-GGUF', 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'standard',
    kind: 'code',
    title: 'Empfohlen',
    params: '7B',
    file: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    size: 4.68e9,
    desc: 'Guter Coder für Grafikkarten ab 6 GB.',
    urls: [
      hf('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-Coder-7B-Instruct-GGUF', 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'stark',
    kind: 'code',
    title: 'Stark',
    params: '14B',
    file: 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
    size: 8.99e9,
    desc: 'Deutlich klügerer Coder. Für Grafikkarten mit 12 GB oder mehr.',
    urls: [
      hf('bartowski/Qwen2.5-Coder-14B-Instruct-GGUF', 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-Coder-14B-Instruct-GGUF', 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'ultra',
    kind: 'code',
    title: 'Ultra',
    params: '30B',
    file: 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf',
    size: 18.6e9,
    desc: 'Das beste lokale Coding-Modell. Für 24-GB-Grafikkarten oder 32 GB+ RAM (dann langsamer).',
    urls: [
      hf('lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf'),
      hf('unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf'),
    ],
  },
  // ---------- Allround-Modelle für den Chat-Bot ----------
  {
    id: 'chat-leicht',
    kind: 'chat',
    title: 'Leicht',
    params: '3B',
    file: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    size: 1.93e9,
    desc: 'Schneller Allrounder für schwächere PCs.',
    urls: [
      hf('bartowski/Qwen2.5-3B-Instruct-GGUF', 'Qwen2.5-3B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-3B-Instruct-GGUF', 'Qwen2.5-3B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'chat',
    kind: 'chat',
    title: 'Empfohlen',
    params: '7B',
    file: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    size: 4.68e9,
    desc: 'Guter Gesprächspartner für Fragen, Ideen, Texte und Erklärungen.',
    urls: [
      hf('bartowski/Qwen2.5-7B-Instruct-GGUF', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-7B-Instruct-GGUF', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'chat-stark',
    kind: 'chat',
    title: 'Stark',
    params: '14B',
    file: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    size: 8.99e9,
    desc: 'Deutlich klüger, braucht aber eine Grafikkarte mit 12 GB oder mehr.',
    urls: [
      hf('bartowski/Qwen2.5-14B-Instruct-GGUF', 'Qwen2.5-14B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-14B-Instruct-GGUF', 'Qwen2.5-14B-Instruct-Q4_K_M.gguf'),
    ],
  },
];
// Nur für Tests: kleine Modelle per Umgebungsvariable einspielen
if (process.env.FORGE_TEST_MODEL) {
  CATALOG.unshift({ id: 'test', kind: 'code', title: 'Test-Coder', params: 'tiny', file: 'tiny-test.gguf', size: 84018656, desc: 'Testmodell', urls: [process.env.FORGE_TEST_MODEL] });
  CATALOG.unshift({ id: 'test-chat', kind: 'chat', title: 'Test-Chat', params: 'tiny', file: 'tiny-test-chat.gguf', size: 84018656, desc: 'Testmodell', urls: [process.env.FORGE_TEST_MODEL] });
}

// Welche Art Modell braucht welcher Bot?
const BOT_KIND = { chat: 'chat', code: 'code', design: 'code' };
const BOTS = ['chat', 'code', 'design'];

const GB = 1024 ** 3;

class Engine extends EventEmitter {
  constructor({ dataDir, forceCpu = false, log }) {
    super();
    this.forceCpu = forceCpu;
    this.log = log || ((level, text) => console[level === 'error' ? 'error' : 'log'](text));
    this.modelsDir = path.join(dataDir, 'models');
    this.configPath = path.join(dataDir, 'forge-engine.json');
    fs.mkdirSync(this.modelsDir, { recursive: true });
    this.config = { modelId: null, customPath: null, ctx: 8192 };
    try {
      Object.assign(this.config, JSON.parse(fs.readFileSync(this.configPath, 'utf8')));
    } catch {}
    // Ab 1.4: kleinerer Standard-Kontext ist deutlich schneller (außer der Nutzer hat selbst etwas eingestellt)
    if (!this.config.ctxUserSet) this.config.ctx = 8192;
    // Ab 1.7: jeder Bot hat sein eigenes Modell
    const bm = (this.config.botModels = this.config.botModels || {});
    const legacy = this.config.customPath ? 'custom' : this.config.modelId;
    if (bm.code === undefined) bm.code = legacy || null;
    if (bm.design === undefined) bm.design = bm.code;
    if (bm.chat === undefined) bm.chat = null;
    if (!BOTS.includes(this.config.activeBot)) this.config.activeBot = legacy ? 'code' : 'chat';
    // Ab 1.10: Bots teilen sich das vorhandene Modell. Ein eigenes Modell lädt FORGE nur, wenn du es selbst auswählst.
    this.config.botExplicit = this.config.botExplicit || {};
    this.state = { status: 'idle', message: '', error: null, hardware: null, active: null, download: null, loadProgress: 0 };
    this.lib = null;
    this.llama = null;
    this.model = null;
    this.context = null;
    this.session = null;
    this.downloadAbort = null;
    this.runId = 0;
    this.queue = Promise.resolve();
    this.grammarCache = new Map();
    this._newReady();
  }

  _newReady() {
    this._readyDone = false;
    this.ready = new Promise((res, rej) => {
      this._resolveReady = () => {
        this._readyDone = true;
        res();
      };
      this._rejectReady = rej;
    });
    this.ready.catch(() => {});
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch {}
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', this.publicState());
  }

  modelPath(entry) {
    return path.join(this.modelsDir, entry.file);
  }
  isInstalled(entry) {
    try {
      return fs.statSync(this.modelPath(entry)).size > 1e6;
    } catch {
      return false;
    }
  }

  freeDiskGB() {
    try {
      const s = fs.statfsSync(this.modelsDir);
      return (s.bavail * s.bsize) / GB;
    } catch {
      return null;
    }
  }

  recommendedId(kind = 'code') {
    if (process.env.FORGE_TEST_MODEL) return kind === 'chat' ? 'test-chat' : 'test';
    const hw = this.state.hardware || {};
    const vram = hw.gpu ? hw.vramGB || 0 : 0;
    // Ohne passende Grafikkarte ist das kleine Modell deutlich flüssiger
    let level = vram >= 11 ? 2 : vram >= 5.5 ? 1 : 0;
    const ids = kind === 'chat' ? ['chat-leicht', 'chat', 'chat-stark'] : ['leicht', 'standard', 'stark'];
    const free = this.freeDiskGB();
    if (free != null) {
      while (level > 0 && CATALOG.find((c) => c.id === ids[level]).size / GB + 1.5 > free) level--;
    }
    return ids[level];
  }

  // Modell-ID, die ein Bot benutzt (oder 'custom').
  // Regel: Nie extra herunterladen, wenn schon irgendein Modell da ist – außer der Nutzer hat es ausdrücklich gewählt.
  modelIdForBot(bot) {
    const id = this.config.botModels[bot];
    const customOk = () => this.config.customPath && fs.existsSync(this.config.customPath);
    if (id === 'custom' && customOk()) return 'custom';
    const entry = id && CATALOG.find((c) => c.id === id);
    if (entry && (this.isInstalled(entry) || this.config.botExplicit[bot])) return id;
    const kind = BOT_KIND[bot];
    const installed = CATALOG.filter((c) => this.isInstalled(c) && !/^test/.test(c.id) === !process.env.FORGE_TEST_MODEL);
    const rec = this.recommendedId(kind);
    // 1) passendes Modell schon da  2) gerade geladenes Modell  3) irgendein vorhandenes (größtes zuerst)
    const sameKind = installed.filter((c) => c.kind === kind).sort((a, b) => b.size - a.size);
    const pick =
      installed.find((c) => c.id === rec) ||
      sameKind.find((c) => c.size / GB < this.fitLimitGB()) ||
      installed.find((c) => this.loadedPath && this.modelPath(c) === this.loadedPath) ||
      sameKind[0] ||
      installed.filter((c) => c.size / GB < this.fitLimitGB()).sort((a, b) => b.size - a.size)[0] ||
      installed.sort((a, b) => a.size - b.size)[0];
    if (pick) return pick.id;
    if (customOk()) return 'custom';
    // Noch gar nichts da (erster Start): EIN Modell für alles – der Coder kann auch chatten und 3D
    return process.env.FORGE_TEST_MODEL ? rec : this.recommendedId('code');
  }

  // Grobe Grenze, ab der ein Modell auf diesem PC zu langsam wird (VRAM + etwas RAM)
  fitLimitGB() {
    const hw = this.state.hardware || {};
    const vram = hw.gpu ? hw.vramGB || 0 : 0;
    return Math.max(2.5, vram * 1.5 + 1);
  }

  publicState() {
    const hw = !!this.state.hardware;
    const botModels = {};
    for (const b of BOTS) botModels[b] = hw || this.config.botModels[b] ? this.modelIdForBot(b) : null;
    const activeId = this.state.active && this.state.active.id;
    return {
      ...this.state,
      modelsDir: this.modelsDir,
      ctx: this.config.ctx,
      freeDiskGB: this.freeDiskGB(),
      activeBot: this.config.activeBot,
      botModels,
      customName: this.config.customPath ? path.basename(this.config.customPath, '.gguf') : null,
      catalog: CATALOG.map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        params: c.params,
        size: c.size,
        desc: c.desc,
        installed: this.isInstalled(c),
        active: activeId === c.id,
        recommended: hw && c.id === this.recommendedId(c.kind),
        downloading: !!(this.state.download && this.state.download.id === c.id),
        usedBy: BOTS.filter((b) => botModels[b] === c.id),
      })),
    };
  }

  // ---------- Hardware ----------
  async initLib() {
    if (this.llama) return;
    this.set({ status: 'detecting', message: 'Erkenne deine Hardware …', error: null });
    if (!this.lib) this.lib = await import('node-llama-cpp');
    const { getLlama, LlamaLogLevel } = this.lib;
    const opts = { build: 'never', progressLogs: false, logLevel: LlamaLogLevel.error };
    if (!this.forceCpu) {
      try {
        this.llama = await getLlama({ ...opts, gpu: 'auto' });
      } catch (err) {
        this.log('warn', 'GPU-Backend fehlgeschlagen, nutze CPU: ' + err.message);
      }
    }
    if (!this.llama) this.llama = await getLlama({ ...opts, gpu: false });
    this.log('info', `KI-Motor: ${this.llama.gpu || 'cpu'}${this.forceCpu ? ' (CPU erzwungen)' : ''}`);
    let vramGB = 0;
    let gpuName = '';
    if (this.llama.gpu) {
      try {
        vramGB = (await this.llama.getVramState()).total / GB;
      } catch {}
      try {
        gpuName = (await this.llama.getGpuDeviceNames()).join(', ');
      } catch {}
    }
    this.set({
      hardware: {
        gpu: this.llama.gpu || false,
        gpuName,
        vramGB: Math.round(vramGB * 10) / 10,
        ramGB: Math.round(os.totalmem() / GB),
        cpu: (os.cpus()[0] || {}).model || '',
        cores: os.cpus().length,
        forcedCpu: this.forceCpu,
      },
    });
  }

  // ---------- Ablauf: alles automatisch ----------
  async start(bot) {
    if (bot && BOTS.includes(bot) && bot !== this.config.activeBot) {
      this.config.activeBot = bot;
      this.saveConfig();
    }
    const run = ++this.runId;
    this.set({ download: null, error: null, errorDetail: null });
    try {
      await this.initLib();
      if (run !== this.runId) return;
      const activeBot = this.config.activeBot;
      const id = this.modelIdForBot(activeBot);
      // Anderes Modell als das geladene → Wartende sollen auf das neue warten
      const target = id === 'custom' ? this.config.customPath : this.modelPath(CATALOG.find((c) => c.id === id));
      if (target !== this.loadedPath && this._readyDone) this._newReady();
      let modelPath;
      let active;
      if (id === 'custom') {
        modelPath = this.config.customPath;
        active = { id: 'custom', title: 'Eigenes Modell', params: path.basename(modelPath, '.gguf'), bot: activeBot };
      } else {
        const entry = CATALOG.find((c) => c.id === id);
        if (!this.isInstalled(entry)) {
          await this.download(entry, run);
          if (run !== this.runId) return;
        }
        modelPath = this.modelPath(entry);
        active = { id: entry.id, kind: entry.kind, title: entry.title, params: entry.params, bot: activeBot };
      }
      // Gleiches Modell schon geladen? Dann nur den Bot umschalten.
      if (this.model && this.state.status === 'ready' && this.loadedPath === modelPath) {
        this.set({ active: { ...this.state.active, bot: activeBot } });
        return;
      }
      await this.load(modelPath, active, run);
      this.loadedPath = modelPath;
    } catch (err) {
      if (run !== this.runId) return;
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        this.set({ status: 'idle', message: 'Download abgebrochen.', download: null });
        this._rejectReady(new Error('Download abgebrochen.'));
        this._newReady();
        return;
      }
      this.log('error', 'Start fehlgeschlagen: ' + (err && err.stack ? err.stack : err));
      this.set({ status: 'error', error: friendly(err), errorDetail: String((err && err.stack) || err).slice(0, 2000), message: '', download: null });
      this._rejectReady(new Error(friendly(err)));
      this._newReady();
    }
  }

  // Ist für diesen Bot schon das richtige Modell geladen?
  isReadyFor(bot) {
    if (this.state.status !== 'ready' || !this.session) return false;
    const id = this.modelIdForBot(bot);
    const want = id === 'custom' ? this.config.customPath : this.modelPath(CATALOG.find((c) => c.id === id));
    return want === this.loadedPath;
  }

  // Für einen Bot ein Modell festlegen (lädt es bei Bedarf herunter, wenn der Bot gerade aktiv ist)
  async setBotModel(bot, id) {
    if (!BOTS.includes(bot)) return false;
    this.config.botModels[bot] = id;
    this.config.botExplicit[bot] = true; // selbst gewählt → darf auch heruntergeladen werden
    this.saveConfig();
    if (bot === this.config.activeBot || this.state.status === 'idle' || this.state.status === 'error') {
      this.cancelDownload();
      this.start(bot);
    } else this.set({});
    return true;
  }

  // Alt (vor 1.7): Modell für den Coder
  async select(id) {
    return this.setBotModel('code', id);
  }

  async useCustom(p, forBot) {
    this.cancelDownload();
    this.config.customPath = p;
    const bot = BOTS.includes(forBot) ? forBot : this.config.activeBot;
    this.config.botModels[bot] = 'custom';
    this.config.botExplicit[bot] = true;
    this.saveConfig();
    this.start(bot);
  }

  async setCtx(n) {
    this.config.ctx = n;
    this.config.ctxUserSet = true;
    this.saveConfig();
    await this.unload();
    this.start();
  }

  deleteModel(id) {
    const entry = CATALOG.find((c) => c.id === id);
    if (!entry) return false;
    if (this.loadedPath === this.modelPath(entry) || (this.state.download && this.state.download.id === id)) return false;
    fs.rmSync(this.modelPath(entry), { force: true });
    fs.rmSync(this.modelPath(entry) + '.part', { force: true });
    this.set({});
    return true;
  }

  cancelDownload() {
    if (this.downloadAbort) {
      // Abgebrochen → nicht beim nächsten Mal wieder anfangen, stattdessen vorhandenes Modell nutzen
      const id = this.state.download && this.state.download.id;
      for (const b of BOTS) if (id && this.config.botModels[b] === id) this.config.botExplicit[b] = false;
      this.saveConfig();
      this.downloadAbort.abort();
    }
  }

  // ---------- Download mit Fortsetzen ----------
  async download(entry, run) {
    const dest = this.modelPath(entry);
    const part = dest + '.part';
    const free = this.freeDiskGB();
    if (free != null && entry.size / GB + 0.5 > free) {
      throw new Error(`Nicht genug Speicherplatz: ${entry.title}-Modell braucht ${(entry.size / GB).toFixed(1)} GB, frei sind ${free.toFixed(1)} GB.`);
    }
    const ac = new AbortController();
    this.downloadAbort = ac;
    let lastErr;
    try {
      for (const url of entry.urls) {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            await this._downloadOnce(url, part, entry, ac.signal);
            const fd = fs.openSync(part, 'r');
            const magic = Buffer.alloc(4);
            fs.readSync(fd, magic, 0, 4, 0);
            fs.closeSync(fd);
            if (magic.toString() !== 'GGUF') {
              fs.rmSync(part, { force: true });
              throw new Error('Die heruntergeladene Datei ist kein gültiges Modell.');
            }
            fs.renameSync(part, dest);
            this.set({ download: null });
            return;
          } catch (err) {
            if (ac.signal.aborted) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' });
            lastErr = err;
            if (err.fatalForUrl) break;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
      }
      throw lastErr || new Error('Download fehlgeschlagen');
    } finally {
      if (this.downloadAbort === ac) this.downloadAbort = null;
    }
  }

  async _downloadOnce(url, part, entry, signal) {
    let start = 0;
    try {
      start = fs.statSync(part).size;
    } catch {}
    const res = await fetch(url, { headers: start ? { Range: `bytes=${start}-` } : {}, signal, redirect: 'follow' });
    if (res.status === 416) {
      // schon komplett
      return;
    }
    if (!res.ok) {
      const e = new Error(`Download-Server antwortet mit ${res.status}`);
      if (res.status === 404 || res.status === 401 || res.status === 403) e.fatalForUrl = true;
      throw e;
    }
    if (start && res.status !== 206) start = 0;
    const len = Number(res.headers.get('content-length') || 0);
    const total = len ? start + len : entry.size;
    const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
    let received = start;
    let lastEmit = 0;
    let speedBase = { t: Date.now(), b: received };
    let speed = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (now - lastEmit > 300) {
          lastEmit = now;
          const dt = (now - speedBase.t) / 1000;
          if (dt > 1.5) {
            const s = (received - speedBase.b) / dt;
            speed = speed ? speed * 0.6 + s * 0.4 : s;
            speedBase = { t: now, b: received };
          }
          this.set({
            status: 'downloading',
            message: `Lade KI-Modell „${entry.title}“ herunter …`,
            download: { id: entry.id, title: entry.title, params: entry.params, received, total, speed },
          });
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (len && received < total) throw new Error('Download unvollständig');
  }

  // ---------- Modell laden ----------
  async unload() {
    this.runId++;
    if (this._readyDone) this._newReady();
    const s = this.state.status;
    if (s === 'ready' || s === 'loading' || s === 'error') this.set({ status: 'idle', active: null });
    try {
      if (this.session) this.session.dispose({ disposeSequence: true });
    } catch {}
    try {
      if (this.context) await this.context.dispose();
    } catch {}
    try {
      if (this.model) await this.model.dispose();
    } catch {}
    this.session = this.context = this.model = null;
    this.loadedPath = null;
    this.grammarCache.clear();
  }

  async load(modelPath, active, run) {
    await this.unload();
    this.runId = run;
    this.set({ status: 'loading', message: 'Starte deine KI …', active, loadProgress: 0, error: null, memNote: null });
    const onLoadProgress = (p) => {
      if (run === this.runId) this.set({ loadProgress: Math.round(p * 100) });
    };
    const want = Math.max(4096, this.config.ctx || 8192);

    // Wie viele Schichten hat das Modell? (für die Speicher-Stufen unten)
    let totalLayers = null;
    try {
      const insights = await this.lib.GgufInsights.from(await this.lib.readGgufFileInfo(modelPath), this.llama);
      totalLayers = insights.totalLayers;
    } catch {}

    // Speicher-Stufen: so viel wie möglich auf die Grafikkarte, den Rest in den normalen RAM.
    // Ist die Grafikkarte voll (z. B. weil ein Spiel läuft), wird stufenweise mehr in den RAM verlagert,
    // statt mit „zu wenig Speicher“ abzubrechen.
    const steps = [];
    if (this.llama.gpu) {
      steps.push({ label: 'auto', gpuLayers: { fitContext: { contextSize: want } } });
      if (totalLayers) for (const f of [0.85, 0.7, 0.55, 0.4, 0.25, 0.1]) steps.push({ label: Math.round(f * 100) + '%', gpuLayers: Math.max(1, Math.floor(totalLayers * f)) });
    }
    steps.push({ label: 'cpu', gpuLayers: 0 });

    let lastErr = null;
    for (const step of steps) {
      if (run !== this.runId) return;
      for (const fa of [true, 'auto']) {
        let model = null;
        try {
          // Flash Attention spart Grafikspeicher, wenn die Hardware es kann
          model = await this.llama.loadModel({ modelPath, gpuLayers: step.gpuLayers, onLoadProgress, defaultContextFlashAttention: fa });
          if (run !== this.runId) {
            await model.dispose();
            return;
          }
          const context = await model.createContext({
            contextSize: { min: 2048, max: want },
            failedCreationRemedy: { retries: 6, autoContextSizeShrink: 0.2 },
          });
          this.model = model;
          this.context = context;
          break;
        } catch (err) {
          lastErr = err;
          this.log('warn', `Laden (${step.label}, FA ${fa}) fehlgeschlagen: ${err.message}`);
          if (model) await model.dispose().catch(() => {});
          // Fehler, die nichts mit Flash Attention zu tun haben → gleich nächste Stufe
          if (!/flash|attention|unsupported|not supported/i.test(String(err.message))) break;
        }
      }
      if (this.model) break;
    }
    if (!this.model) throw lastErr || new Error('Modell konnte nicht geladen werden');
    if (run !== this.runId) return;

    const onGpu = this.model.gpuLayers;
    const share = totalLayers ? Math.min(100, Math.round((onGpu / totalLayers) * 100)) : onGpu > 0 ? 100 : 0;
    let memNote = null;
    if (this.llama.gpu && share < 100) {
      memNote =
        share === 0
          ? 'Die Grafikkarte war voll – die KI läuft gerade nur im Arbeitsspeicher (langsamer). Schließ Spiele oder andere Programme und starte FORGE neu.'
          : `Wenig Grafikspeicher frei – ${share} % der KI laufen auf der Grafikkarte, der Rest im Arbeitsspeicher (etwas langsamer). Schließ Spiele oder andere Programme für volle Geschwindigkeit.`;
    }
    this.log('info', `Modell geladen: ${onGpu}/${totalLayers || '?'} Schichten auf der Grafikkarte, Kontext ${this.context.contextSize}`);
    this.gpuShare = share;
    this.memNote = memNote;

    // Token-Vorhersage: Wiederholt die KI Teile der Eingabe (Code ändern, 3D-Modell ändern),
    // werden mehrere Token auf einmal geprüft statt einzeln – das Ergebnis bleibt identisch.
    let sequence;
    try {
      sequence = this.context.getSequence({
        tokenPredictor: new this.lib.InputLookupTokenPredictor({ patternLength: { min: 2 }, predictionLength: { max: 8 } }),
      });
    } catch (err) {
      this.log('warn', 'Token-Vorhersage nicht verfügbar: ' + err.message);
      sequence = this.context.getSequence();
    }
    this.session = new this.lib.LlamaChatSession({ contextSequence: sequence, autoDisposeSequence: false });
    if (run !== this.runId) return;
    this.set({
      status: 'ready',
      message: '',
      loadProgress: 100,
      active: { ...active, gpuLayers: this.model.gpuLayers, gpuShare: this.gpuShare, ctx: this.context.contextSize },
      memNote: this.memNote,
    });
    this._resolveReady();
  }

  // ---------- Vorladen: Systemprompt schon mal verarbeiten, damit die erste Antwort sofort startet ----------
  preload(messages) {
    const job = this.queue.then(async () => {
      if (this.state.status !== 'ready' || !this.session) return false;
      const t0 = Date.now();
      const toItem = (m) => (m.role === 'system' ? { type: 'system', text: m.content } : { type: 'user', text: m.content });
      this.session.setChatHistory(messages.map(toItem));
      await this.session.preloadPrompt('');
      this.log('info', `Systemprompt vorgeladen (${Date.now() - t0} ms)`);
      return true;
    });
    this.queue = job.catch(() => {});
    return job.catch((err) => {
      this.log('warn', 'Vorladen fehlgeschlagen: ' + err.message);
      return false;
    });
  }

  // ---------- Internet ----------
  async _grammarFor(schema) {
    const key = JSON.stringify(schema);
    let g = this.grammarCache.get(key);
    if (!g) {
      g = await this.llama.createGrammarForJsonSchema(schema);
      this.grammarCache.set(key, g);
    }
    return g;
  }

  // Kurze Vorab-Frage an die KI: Braucht diese Nachricht eine Websuche? Wenn ja, wonach?
  async _decideSearch(messages, signal) {
    const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const lastText = String(messages[messages.length - 1].content || '');
    const before = messages
      .slice(1, -1)
      .slice(-4)
      .map((m) => `${m.role === 'user' ? 'Nutzer' : 'KI'}: ${String(m.content || '').replace(/```[\s\S]*?```/g, '[Code]').slice(0, 300)}`)
      .join('\n');
    const forced = /\b(such|google|recherchier|im internet|im netz|online nach|web ?such|nachschauen|schau nach)/i.test(lastText);
    this.session.setChatHistory([
      {
        type: 'system',
        text: `Du entscheidest nur, ob für die Antwort eine Internet-Suche nötig ist. Heute ist ${today}.
Suche, wenn die Antwort aktuelle oder genaue Fakten braucht: Nachrichten, Ereignisse, Preise, Wetter, Versionen, Release-Daten, Personen, Firmen, Produkte, Spiele-Updates, Dokumentation zu Bibliotheken/APIs, oder wenn der Nutzer es ausdrücklich will.
Nicht suchen bei: normalem Programmieren, Erklären von Grundlagen, Plaudern, Rechnen, Texten schreiben, 3D-Modelle bauen.
"suche" = kurze Suchanfrage (2–8 Wörter) in der passendsten Sprache.`,
      },
    ]);
    const grammar = await this._grammarFor({
      type: 'object',
      properties: { internet: { type: 'boolean' }, suche: { type: 'string', maxLength: 90 } },
      required: ['internet', 'suche'],
    });
    const out = await this.session.prompt(`${before ? `Bisheriges Gespräch:\n${before}\n\n` : ''}Neue Nachricht: ${lastText.slice(0, 1500)}\n\nAntworte als JSON.`, {
      grammar,
      temperature: 0,
      maxTokens: 80,
      signal,
      stopOnAbortSignal: true,
    });
    let r;
    try {
      r = grammar.parse(out);
    } catch {
      return forced ? lastText.slice(0, 120) : null;
    }
    const q = String((r && r.suche) || '').trim();
    if ((r && r.internet) || forced) return q || lastText.slice(0, 120);
    return null;
  }

  async _webContext(messages, onText, signal) {
    const last = messages[messages.length - 1];
    const ctx = (this.context && this.context.contextSize) || 4096;
    const budget = Math.max(1200, Math.min(9000, (ctx - 2500) * 2)); // Zeichen für Internet-Text
    const urls = web.findUrls(last.content).slice(0, 2);
    const sources = [];
    let block = '';
    try {
      // 1) Links in der Nachricht direkt lesen
      if (urls.length) {
        onText(null, { tool: { phase: 'read', count: urls.length, hosts: urls.map((u) => new URL(u).hostname) } });
        for (const u of urls) {
          try {
            const pg = await web.readPage(u, { signal, maxChars: Math.floor(budget / urls.length) });
            sources.push({ title: pg.title, url: pg.url });
            block += `\n[${sources.length}] ${pg.title} – ${pg.url}\n${pg.text}\n`;
          } catch (err) {
            block += `\n(Die Seite ${u} konnte nicht geladen werden: ${err.message})\n`;
          }
          if (signal.aborted) return null;
        }
      }
      // 2) Sonst: Muss gesucht werden? (Lange Code-Nachrichten brauchen fast nie eine Suche → spart Zeit)
      let query = null;
      const forced = /\b(such|google|recherchier|im internet|im netz|online nach|web ?such|nachschauen|schau nach)/i.test(last.content);
      const codeHeavy = /```/.test(last.content) || last.content.length > 2500;
      if (!urls.length && (forced || !codeHeavy)) {
        query = await this._decideSearch(messages, signal);
        if (signal.aborted) return null;
      }
      if (query) {
        onText(null, { tool: { phase: 'search', query } });
        const { results } = await web.search(query, { signal, log: (l, t) => this.log(l, t) });
        if (signal.aborted) return null;
        // Die besten 2 Seiten öffnen (parallel, mit Zeitlimit)
        const top = results.slice(0, 2);
        onText(null, { tool: { phase: 'read', count: top.length, hosts: top.map((r) => new URL(r.url).hostname), query } });
        const per = Math.floor((budget - 1200) / Math.max(1, top.length));
        const pages = await Promise.all(top.map((r) => web.readPage(r.url, { signal, maxChars: Math.max(600, per) }).catch(() => null)));
        if (signal.aborted) return null;
        results.forEach((r, i) => {
          sources.push({ title: r.title, url: r.url });
          const pg = pages[i];
          block += `\n[${sources.length}] ${r.title} – ${r.url}\n${r.snippet || ''}\n`;
          if (pg && pg.text) block += `Seiteninhalt:\n${pg.text}\n`;
        });
      }
    } catch (err) {
      if (signal.aborted) return null;
      this.log('warn', 'Internet: ' + err.message);
      onText(null, { tool: { phase: 'error', error: err.message } });
      return `\n\n[Hinweis: Die Internet-Suche hat nicht geklappt (${err.message}). Antworte mit deinem eigenen Wissen und sag kurz, dass du gerade nicht nachschauen konntest.]`;
    }
    if (!sources.length && !block) {
      onText(null, { tool: { phase: 'none' } });
      return null;
    }
    onText(null, { sources, tool: { phase: 'answer' } });
    const today = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
    return `\n\n---\nINTERNET-ERGEBNISSE (abgerufen am ${today}):${block.slice(0, budget + 1500)}\n---\nNutze diese Ergebnisse für deine Antwort, wenn sie zur Frage passen. Nenne die genutzten Quellen im Text als [1], [2] usw. Erfinde keine Fakten, die nicht in den Ergebnissen oder deinem sicheren Wissen stehen. Wenn die Ergebnisse nicht passen, sag das ehrlich.`;
  }

  // ---------- Chat ----------
  chat(req, onText, signal) {
    const job = this.queue.then(() => this._chat(req, onText, signal));
    this.queue = job.catch(() => {});
    return job;
  }

  async _chat({ messages, temperature = 0.3, schema, gbnf, maxTokens, bot, web: useWeb }, onText, signal) {
    // Anderer Bot mit anderem Modell? Dann zuerst umschalten (ggf. mit Download).
    if (bot && BOTS.includes(bot)) {
      const aborted = new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      for (let i = 0; i < 4 && !this.isReadyFor(bot); i++) {
        if (this.state.status === 'error' && i > 0) throw new Error(this.state.error || 'Die KI konnte nicht starten.');
        onText(null, { waiting: true, switching: bot });
        if (this.config.activeBot !== bot || !['detecting', 'downloading', 'loading'].includes(this.state.status)) this.start(bot);
        await new Promise((r) => setTimeout(r, 60));
        await Promise.race([this.ready, aborted]);
        if (signal.aborted) return { aborted: true };
      }
      if (this.isReadyFor(bot)) this.config.activeBot = bot;
    }
    if (this.state.status !== 'ready' || !this.session) {
      if (this.state.status === 'error') throw new Error(this.state.error || 'Die KI konnte nicht starten.');
      if (!['detecting', 'downloading', 'loading'].includes(this.state.status)) throw new Error('NO_MODEL: Es ist noch kein KI-Modell geladen. Wähle eins unter „Modelle“.');
      onText(null, { waiting: true });
      await Promise.race([this.ready, new Promise((r) => signal.addEventListener('abort', r, { once: true }))]);
      if (signal.aborted) return { aborted: true };
    }
    if (signal.aborted) return { aborted: true };
    // Nur für automatische Tests: feste Antworten (Datei mit {"Regex": "Antwort"} oder eine Antwort für Reparaturen)
    const testReply = (() => {
      const q = String(messages[messages.length - 1].content || '');
      if (process.env.FORGE_TEST_REPLIES) {
        const map = JSON.parse(fs.readFileSync(process.env.FORGE_TEST_REPLIES, 'utf8'));
        const k = Object.keys(map).find((re) => new RegExp(re, 'u').test(q));
        return k ? map[k] : null;
      }
      if (process.env.FORGE_TEST_REPLY_FILE && /^[🔧🔁🔍]/u.test(q)) return fs.readFileSync(process.env.FORGE_TEST_REPLY_FILE, 'utf8');
      return null;
    })();
    if (testReply != null) {
      const reply = testReply;
      for (let i = 0; i < reply.length; i += 12) {
        onText(reply.slice(i, i + 12));
        await new Promise((r) => setTimeout(r, 5));
      }
      return { aborted: false, tps: 0, tokens: 0 };
    }
    const toItem = (m) =>
      m.role === 'system' ? { type: 'system', text: m.content } : m.role === 'user' ? { type: 'user', text: m.content } : { type: 'model', response: [m.content || ''] };
    let last = messages[messages.length - 1];
    // Internet: erst entscheiden, ob gesucht werden muss, dann Ergebnisse an die Frage hängen
    if (useWeb && !schema && !gbnf && last && last.role === 'user') {
      const extra = await this._webContext(messages, onText, signal);
      if (signal.aborted) return { aborted: true };
      if (extra) last = { ...last, content: last.content + extra };
    }
    this.session.setChatHistory(messages.slice(0, -1).map(toItem));
    let grammar;
    if (schema || gbnf) {
      const key = gbnf || JSON.stringify(schema);
      grammar = this.grammarCache.get(key);
      if (!grammar) {
        grammar = gbnf ? await this.llama.createGrammar({ grammar: gbnf }) : await this.llama.createGrammarForJsonSchema(schema);
        this.grammarCache.set(key, grammar);
      }
    }
    let tokens = 0;
    let tFirst = 0;
    await this.session.prompt(last.content, {
      temperature,
      maxTokens: maxTokens || undefined,
      grammar,
      signal,
      stopOnAbortSignal: true,
      onTextChunk: (t) => onText(t),
      onToken: (toks) => {
        if (!tFirst) tFirst = Date.now();
        tokens += toks.length;
      },
    });
    const secs = tFirst ? (Date.now() - tFirst) / 1000 : 0;
    return { aborted: signal.aborted, tps: secs > 0.2 ? tokens / secs : 0, tokens };
  }
}

function friendly(err) {
  const m = String((err && err.message) || err);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(m)) return 'Keine Internetverbindung für den Modell-Download. Prüfe dein Internet und versuch es nochmal.';
  if (/out of memory|alloc|VRAM|insufficient/i.test(m)) return 'Nicht genug Speicher für dieses Modell. Schließ Spiele oder andere Programme, die die Grafikkarte nutzen, oder wähle ein kleineres Modell.';
  return m;
}

module.exports = { Engine, CATALOG };
