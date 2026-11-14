// Baut die Update-Dateien für ein Release und lädt sie optional zu GitHub hoch.
//
//   node tools/release.js --out dist-release [--notes "Was ist neu"] [--repo-dir ../forge-ai-repo]
//
// Erzeugt:
//   forge-app-<version>.json.gz   kleines App-Update (nur Code, ca. 1 MB)
//   FORGE-AI-Setup-<version>.exe  volles Setup (falls --setup angegeben)
//   update.json                   Beschreibung für den Updater (Version, Laufzeit, Prüfsummen)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const runtime = pkg.forge && pkg.forge.runtime;
const repo = process.env.FORGE_UPDATE_REPO || (pkg.forge && pkg.forge.updateRepo);
const outDir = path.resolve(opt('out', path.join(ROOT, 'dist-release')));
const notes = opt('notes', `FORGE AI ${version}`);
fs.mkdirSync(outDir, { recursive: true });

// Produktions-package.json (ohne Entwickler-Abhängigkeiten)
const prodPkg = {
  name: pkg.name,
  productName: pkg.productName,
  version,
  description: pkg.description,
  main: 'boot.js',
  license: pkg.license,
  dependencies: pkg.dependencies,
  forge: { ...pkg.forge, updateRepo: repo },
};

const FILES = [
  'main.js',
  'preload.js',
  'engine.js',
  'engine-worker.js',
  'runner.js',
  'renderer/index.html',
  'renderer/styles.css',
  'renderer/hljs.css',
  'renderer/icon.png',
  'renderer/dist/bundle.js',
];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// 1) App-Update-Paket (boot.js und updater.js bleiben bewusst draußen – die ändern sich nur per Voll-Update)
const files = {};
for (const rel of FILES) files[rel] = fs.readFileSync(path.join(ROOT, rel)).toString('base64');
files['package.json'] = Buffer.from(JSON.stringify(prodPkg, null, 2)).toString('base64');
const appName = `forge-app-${version}.json.gz`;
const appBuf = zlib.gzipSync(Buffer.from(JSON.stringify({ version, runtime, files })), { level: 9 });
fs.writeFileSync(path.join(outDir, appName), appBuf);
fs.writeFileSync(path.join(outDir, 'package.prod.json'), JSON.stringify(prodPkg, null, 2));

// 2) Volles Setup (optional)
const manifest = { version, runtime, notes, app: { file: appName, sha256: sha(appBuf), size: appBuf.length } };
const setupSrc = opt('setup');
if (setupSrc) {
  const setupName = `FORGE-AI-Setup-${version}.exe`;
  const dst = path.join(outDir, setupName);
  if (path.resolve(setupSrc) !== dst) fs.copyFileSync(setupSrc, dst);
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(dst));
  manifest.full = { file: setupName, sha256: h.digest('hex'), size: fs.statSync(dst).size };
}
fs.writeFileSync(path.join(outDir, 'update.json'), JSON.stringify(manifest, null, 2));
console.log('Update-Dateien in', outDir);
console.log(JSON.stringify(manifest, null, 2));

// 3) In das GitHub-Repository legen (die GitHub-Automatik macht daraus ein Release)
const repoDir = opt('repo-dir');
if (repoDir) {
  const upd = path.join(repoDir, 'updates');
  fs.mkdirSync(upd, { recursive: true });
  for (const f of fs.readdirSync(upd)) if (/^forge-app-.*\.json\.gz$/.test(f) || /^FORGE-AI-Setup-.*\.exe$/.test(f)) fs.rmSync(path.join(upd, f));
  fs.copyFileSync(path.join(outDir, 'update.json'), path.join(upd, 'update.json'));
  fs.copyFileSync(path.join(outDir, appName), path.join(upd, appName));
  console.log(`Update-Dateien liegen in ${upd}. Jetzt committen und pushen – GitHub erstellt das Release v${version} automatisch.`);
}
