// FORGE AI – automatische Updates über GitHub Releases
//
// Zwei Arten von Updates:
//  • "app":  nur der App-Code (ca. 1 MB). Wird im Hintergrund geladen und beim nächsten Start eingespielt.
//  • "full": neue Laufzeit (Electron / KI-Motor). Lädt das Setup und installiert es leise im Hintergrund.
//
// Sicherheit: Jede Datei wird per SHA-256 geprüft. Startet eine neue Version nicht sauber,
// wird automatisch die alte wiederhergestellt.
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');

const API = (process.env.FORGE_UPDATE_API || 'https://api.github.com').replace(/\/+$/, '');

const PROTECTED = ['boot.js', 'updater.js'];

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function safeRel(rel) {
  const n = path.normalize(String(rel)).replace(/^([/\\])+/, '');
  if (!n || n.startsWith('..') || path.isAbsolute(n) || /(^|[/\\])node_modules([/\\]|$)/.test(n)) throw new Error('Ungültiger Pfad im Update: ' + rel);
  return n;
}

class Updater extends EventEmitter {
  constructor({ app, log }) {
    super();
    this.app = app;
    this.log = log || (() => {});
    this.appDir = app.getAppPath();
    this.dir = path.join(app.getPath('userData'), 'updates');
    fs.mkdirSync(this.dir, { recursive: true });
    const pkg = readJson(path.join(this.appDir, 'package.json')) || {};
    this.cfg = pkg.forge || {};
    this.repo = process.env.FORGE_UPDATE_REPO || this.cfg.updateRepo || '';
    this.runtime = this.cfg.runtime || '';
    this.version = app.getVersion();
    this.state = { status: 'idle', current: this.version, enabled: !!this.repo && !/OWNER/.test(this.repo) };
    this.timer = null;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', { ...this.state });
  }

  // ---------- Beim Start: wartendes Update einspielen / Rollback ----------
  // Gibt true zurück, wenn die App neu gestartet werden muss.
  applyPendingSync() {
    try {
      // 1) Schutz: Ist die zuletzt eingespielte Version abgestürzt? → zurückrollen
      const appliedPath = path.join(this.dir, 'applied.json');
      const applied = readJson(appliedPath);
      if (applied && applied.version === this.version) {
        applied.attempts = (applied.attempts || 0) + 1;
        if (applied.attempts > 2 && applied.backupDir && fs.existsSync(applied.backupDir)) {
          this.log('error', `Version ${applied.version} startet nicht – stelle ${applied.from} wieder her`);
          this._copyTree(applied.backupDir, this.appDir, applied.files.filter((f) => fs.existsSync(path.join(applied.backupDir, f))));
          fs.rmSync(appliedPath, { force: true });
          fs.writeFileSync(path.join(this.dir, 'skip.json'), JSON.stringify({ version: applied.version }));
          return true;
        }
        fs.writeFileSync(appliedPath, JSON.stringify(applied));
      } else if (applied) {
        fs.rmSync(appliedPath, { force: true });
      }

      // 2) Wartendes App-Update einspielen
      const pendingPath = path.join(this.dir, 'pending.json');
      const pending = readJson(pendingPath);
      if (!pending) return false;
      fs.rmSync(pendingPath, { force: true });
      if (cmpVersion(pending.version, this.version) <= 0 || pending.runtime !== this.runtime || !fs.existsSync(pending.dir)) return false;

      const backupDir = path.join(this.dir, 'backup');
      fs.rmSync(backupDir, { recursive: true, force: true });
      const files = pending.files;
      // Sicherung der aktuellen Dateien
      for (const rel of files) {
        const src = path.join(this.appDir, rel);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(path.join(backupDir, rel)), { recursive: true });
          fs.copyFileSync(src, path.join(backupDir, rel));
        }
      }
      try {
        this._copyTree(pending.dir, this.appDir, files);
      } catch (err) {
        this.log('error', 'Update konnte nicht eingespielt werden, stelle wieder her: ' + err.message);
        this._copyTree(backupDir, this.appDir, files.filter((f) => fs.existsSync(path.join(backupDir, f))));
        return false;
      }
      fs.writeFileSync(appliedPath, JSON.stringify({ version: pending.version, from: this.version, backupDir, files, attempts: 0, notes: pending.notes || '' }));
      this.log('info', `Update auf ${pending.version} eingespielt`);
      return true;
    } catch (err) {
      this.log('error', 'Update-Start fehlgeschlagen: ' + err.message);
      return false;
    }
  }

  // Sofort zurückrollen (z. B. wenn main.js der neuen Version gar nicht lädt)
  rollbackNow() {
    const appliedPath = path.join(this.dir, 'applied.json');
    const applied = readJson(appliedPath);
    if (!applied || applied.version !== this.version || !applied.backupDir || !fs.existsSync(applied.backupDir)) return false;
    this.log('error', `Version ${applied.version} startet nicht – stelle ${applied.from} wieder her`);
    this._copyTree(applied.backupDir, this.appDir, applied.files.filter((f) => fs.existsSync(path.join(applied.backupDir, f))));
    fs.rmSync(appliedPath, { force: true });
    fs.writeFileSync(path.join(this.dir, 'skip.json'), JSON.stringify({ version: applied.version }));
    return true;
  }

  _copyTree(fromDir, toDir, files) {
    for (const rel of files) {
      const dst = path.join(toDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const tmp = dst + '.forge-new';
      fs.copyFileSync(path.join(fromDir, rel), tmp);
      fs.renameSync(tmp, dst);
    }
  }

  // Wird aufgerufen, sobald die App sauber läuft → Update bestätigt
  confirmBoot() {
    const appliedPath = path.join(this.dir, 'applied.json');
    const applied = readJson(appliedPath);
    if (applied && applied.version === this.version) {
      fs.rmSync(appliedPath, { force: true });
      this.set({ justUpdated: { version: this.version, notes: applied.notes || '' } });
    }
    fs.rmSync(path.join(this.dir, 'pending'), { recursive: true, force: true });
  }

  // ---------- Regelmäßig prüfen ----------
  startAuto() {
    if (!this.state.enabled) return;
    setTimeout(() => this.check().catch(() => {}), 8000);
    this.timer = setInterval(() => this.check().catch(() => {}), 4 * 3600 * 1000);
  }

  async _get(url, json = true) {
    const res = await fetch(url, {
      headers: { Accept: json ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'FORGE-AI-Updater' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Update-Server antwortet mit ${res.status}`);
    return json ? res.json() : res;
  }

  async check({ manual = false } = {}) {
    if (!this.state.enabled) {
      this.set({ status: 'disabled' });
      return this.state;
    }
    if (['downloading', 'installing'].includes(this.state.status)) return this.state;
    if (this.state.status === 'ready') return this.state;
    this.set({ status: 'checking', error: null });
    try {
      const rel = await this._get(`${API}/repos/${this.repo}/releases/latest`);
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      const skip = readJson(path.join(this.dir, 'skip.json'));
      if (!latest || cmpVersion(latest, this.version) <= 0 || (skip && skip.version === latest && !manual)) {
        this.set({ status: 'uptodate', latest: latest || this.version, checkedAt: Date.now() });
        return this.state;
      }
      const assets = rel.assets || [];
      const asset = (name) => assets.find((a) => a.name === name);
      const manAsset = asset('update.json');
      if (!manAsset) throw new Error('Release ohne update.json');
      const manifest = await this._get(manAsset.browser_download_url, false).then((r) => r.json());
      const notes = String(manifest.notes || rel.body || '').slice(0, 2000);
      const kind = manifest.runtime === this.runtime && manifest.app ? 'app' : 'full';
      const part = kind === 'app' ? manifest.app : manifest.full;
      if (!part || !asset(part.file)) throw new Error('Update-Datei fehlt im Release');
      this.set({ status: 'downloading', latest, kind, notes, progress: 0 });
      const file = path.join(this.dir, part.file);
      await this._download(asset(part.file).browser_download_url, file, part);
      if (kind === 'app') {
        this._unpackApp(file, latest, manifest, notes);
        this.set({ status: 'ready', progress: 100 });
      } else {
        this.fullInstaller = file;
        this.set({ status: 'ready', progress: 100 });
      }
      this.log('info', `Update ${latest} (${kind}) bereit`);
    } catch (err) {
      this.log('warn', 'Update-Prüfung: ' + err.message);
      this.set({ status: manual ? 'error' : 'idle', error: err.message });
    }
    return this.state;
  }

  async _download(url, dest, part) {
    if (fs.existsSync(dest) && part.sha256 && this._sha(dest) === part.sha256) return;
    const res = await fetch(url, { headers: { 'User-Agent': 'FORGE-AI-Updater', Accept: 'application/octet-stream' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Download antwortet mit ${res.status}`);
    const total = Number(res.headers.get('content-length') || part.size || 0);
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let got = 0;
    let last = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        if (total && Date.now() - last > 400) {
          last = Date.now();
          this.set({ progress: Math.floor((got / total) * 100) });
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (part.sha256 && this._sha(tmp) !== part.sha256) {
      fs.rmSync(tmp, { force: true });
      throw new Error('Prüfsumme stimmt nicht – Update verworfen');
    }
    fs.renameSync(tmp, dest);
  }

  _sha(file) {
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
    fs.closeSync(fd);
    return h.digest('hex');
  }

  _unpackApp(file, version, manifest, notes) {
    const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    if (bundle.version !== version || bundle.runtime !== this.runtime) throw new Error('Update-Paket passt nicht zu dieser Version');
    const dir = path.join(this.dir, 'pending', version);
    fs.rmSync(dir, { recursive: true, force: true });
    const files = [];
    for (const [rel, b64] of Object.entries(bundle.files || {})) {
      const r = safeRel(rel);
      if (PROTECTED.includes(r)) continue; // Startprogramm & Updater nur per Voll-Update
      const dst = path.join(dir, r);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, Buffer.from(b64, 'base64'));
      files.push(r);
    }
    if (!files.includes('main.js') || !files.includes('package.json')) throw new Error('Update-Paket unvollständig');
    fs.writeFileSync(path.join(this.dir, 'pending.json'), JSON.stringify({ version, runtime: this.runtime, dir, files, notes }));
    fs.rmSync(file, { force: true });
  }

  // ---------- Jetzt installieren ----------
  installNow() {
    if (this.state.status !== 'ready') return false;
    if (this.state.kind === 'app') {
      this.app.relaunch();
      this.app.quit();
      return true;
    }
    if (this.fullInstaller && fs.existsSync(this.fullInstaller)) {
      this.set({ status: 'installing' });
      const installDir = path.dirname(process.execPath);
      // Setup leise im Hintergrund – es schließt die App und startet sie danach neu
      spawn(this.fullInstaller, ['/S', `/D=${installDir}`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
      setTimeout(() => this.app.quit(), 500);
      return true;
    }
    return false;
  }
}

module.exports = { Updater, cmpVersion };
