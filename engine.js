// FORGE AI – eingebauter KI-Motor (llama.cpp über node-llama-cpp)
// Erkennt die Hardware, lädt automatisch das passende Modell herunter und startet die KI.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

const HF = (process.env.FORGE_HF_BASE || 'https://huggingface.co').replace(/\/+$/, '');
const hf = (repo, file) => `${HF}/${repo}/resolve/main/${file}?download=true`;

const CATALOG = [
  {
    id: 'leicht',
    title: 'Leicht',
    params: '3B',
    file: 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf',
    size: 1.93e9,
    desc: 'Für Laptops und PCs ohne starke Grafikkarte. Schnell, aber einfacher.',
    urls: [
      hf('bartowski/Qwen2.5-Coder-3B-Instruct-GGUF', 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-Coder-3B-Instruct-GGUF', 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'standard',
    title: 'Empfohlen',
    params: '7B',
    file: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    size: 4.68e9,
    desc: 'Guter Allrounder für Grafikkarten ab 6 GB oder PCs mit 16 GB RAM.',
    urls: [
      hf('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-Coder-7B-Instruct-GGUF', 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'stark',
    title: 'Stark',
    params: '14B',
    file: 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
    size: 8.99e9,
    desc: 'Deutlich klüger. Für Grafikkarten mit 12 GB oder mehr.',
    urls: [
      hf('bartowski/Qwen2.5-Coder-14B-Instruct-GGUF', 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf'),
      hf('lmstudio-community/Qwen2.5-Coder-14B-Instruct-GGUF', 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf'),
    ],
  },
  {
    id: 'ultra',
    title: 'Ultra',
    params: '30B',
    file: 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf',
    size: 18.6e9,
    desc: 'Das beste lokale Coding-Modell. Für 24 GB Grafikkarten oder 32 GB+ RAM.',
    urls: [
      hf('lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf'),
      hf('unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf'),
    ],
  },
];
// Nur für Tests: kleines Modell per Umgebungsvariable einspielen
if (process.env.FORGE_TEST_MODEL) {
  CATALOG.unshift({ id: 'test', title: 'Test', params: 'tiny', file: 'tiny-test.gguf', size: 84018656, desc: 'Testmodell', urls: [process.env.FORGE_TEST_MODEL] });
}

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

  recommendedId() {
    const hw = this.state.hardware || {};
    const vram = hw.gpu ? hw.vramGB || 0 : 0;
    const ram = hw.ramGB || 8;
    // Ohne passende Grafikkarte ist das kleine Modell deutlich flüssiger
    let id = vram >= 11 ? 'stark' : vram >= 5.5 ? 'standard' : 'leicht';
    void ram;
    const free = this.freeDiskGB();
    const order = ['leicht', 'standard', 'stark'];
    if (free != null) {
      while (order.indexOf(id) > 0 && CATALOG.find((c) => c.id === id).size / GB + 1.5 > free) id = order[order.indexOf(id) - 1];
    }
    return id;
  }

  publicState() {
    const rec = this.state.hardware ? this.recommendedId() : null;
    return {
      ...this.state,
      modelsDir: this.modelsDir,
      ctx: this.config.ctx,
      freeDiskGB: this.freeDiskGB(),
      catalog: CATALOG.filter((c) => c.id !== 'test' || process.env.FORGE_TEST_MODEL).map((c) => ({
        id: c.id,
        title: c.title,
        params: c.params,
        size: c.size,
        desc: c.desc,
        installed: this.isInstalled(c),
        active: !this.config.customPath && this.state.active && this.state.active.id === c.id,
        recommended: c.id === rec,
        downloading: !!(this.state.download && this.state.download.id === c.id),
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
  async start() {
    const run = ++this.runId;
    this.set({ download: null, error: null, errorDetail: null });
    try {
      await this.initLib();
      if (run !== this.runId) return;
      let modelPath;
      let active;
      if (this.config.customPath && fs.existsSync(this.config.customPath)) {
        modelPath = this.config.customPath;
        active = { id: 'custom', title: 'Eigenes Modell', params: path.basename(modelPath, '.gguf') };
      } else {
        this.config.customPath = null;
        let entry = CATALOG.find((c) => c.id === this.config.modelId);
        if (!entry) {
          // Erster Start: nimm ein schon vorhandenes Modell oder wähle passend zur Hardware
          entry = CATALOG.find((c) => c.id === this.recommendedId() && this.isInstalled(c)) || CATALOG.find((c) => this.isInstalled(c)) || CATALOG.find((c) => c.id === this.recommendedId());
          if (process.env.FORGE_TEST_MODEL) entry = CATALOG[0];
          this.config.modelId = entry.id;
          this.saveConfig();
        }
        if (!this.isInstalled(entry)) {
          await this.download(entry, run);
          if (run !== this.runId) return;
        }
        modelPath = this.modelPath(entry);
        active = { id: entry.id, title: entry.title, params: entry.params };
      }
      await this.load(modelPath, active, run);
    } catch (err) {
      if (run !== this.runId) return;
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        this.set({ status: 'idle', message: 'Download abgebrochen.', download: null });
        return;
      }
      this.log('error', 'Start fehlgeschlagen: ' + (err && err.stack ? err.stack : err));
      this.set({ status: 'error', error: friendly(err), errorDetail: String((err && err.stack) || err).slice(0, 2000), message: '', download: null });
      this._rejectReady(new Error(friendly(err)));
      this._newReady();
    }
  }

  async select(id) {
    this.cancelDownload();
    this.config.modelId = id;
    this.config.customPath = null;
    this.saveConfig();
    await this.unload();
    this.start();
  }

  async useCustom(p) {
    this.cancelDownload();
    this.config.customPath = p;
    this.saveConfig();
    await this.unload();
    this.start();
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
    if (this.state.active && this.state.active.id === id && this.state.status !== 'error') return false;
    fs.rmSync(this.modelPath(entry), { force: true });
    fs.rmSync(this.modelPath(entry) + '.part', { force: true });
    this.set({});
    return true;
  }

  cancelDownload() {
    if (this.downloadAbort) this.downloadAbort.abort();
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
    this.grammarCache.clear();
  }

  async load(modelPath, active, run) {
    await this.unload();
    this.runId = run;
    this.set({ status: 'loading', message: 'Starte deine KI …', active, loadProgress: 0, error: null });
    const onLoadProgress = (p) => {
      if (run === this.runId) this.set({ loadProgress: Math.round(p * 100) });
    };
    try {
      this.model = await this.llama.loadModel({ modelPath, gpuLayers: 'auto', onLoadProgress });
    } catch (err) {
      this.log('warn', 'Laden mit GPU fehlgeschlagen, versuche CPU: ' + err.message);
      this.model = await this.llama.loadModel({ modelPath, gpuLayers: 0, onLoadProgress });
    }
    if (run !== this.runId) return;
    const max = Math.max(4096, this.config.ctx || 8192);
    this.context = await this.model.createContext({ contextSize: { min: 4096, max } });
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
      active: { ...active, gpuLayers: this.model.gpuLayers, ctx: this.context.contextSize },
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

  // ---------- Chat ----------
  chat(req, onText, signal) {
    const job = this.queue.then(() => this._chat(req, onText, signal));
    this.queue = job.catch(() => {});
    return job;
  }

  async _chat({ messages, temperature = 0.3, schema, gbnf, maxTokens }, onText, signal) {
    if (this.state.status !== 'ready' || !this.session) {
      if (this.state.status === 'error') throw new Error(this.state.error || 'Die KI konnte nicht starten.');
      if (!['detecting', 'downloading', 'loading'].includes(this.state.status)) throw new Error('NO_MODEL: Es ist noch kein KI-Modell geladen. Wähle eins unter „Modelle“.');
      onText(null, { waiting: true });
      await this.ready;
    }
    if (signal.aborted) return { aborted: true };
    const toItem = (m) =>
      m.role === 'system' ? { type: 'system', text: m.content } : m.role === 'user' ? { type: 'user', text: m.content } : { type: 'model', response: [m.content || ''] };
    const last = messages[messages.length - 1];
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
  if (/out of memory|alloc|VRAM|insufficient/i.test(m)) return 'Nicht genug Speicher für dieses Modell. Wähle ein kleineres Modell.';
  return m;
}

module.exports = { Engine, CATALOG };
