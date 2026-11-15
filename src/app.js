// FORGE AI – Oberfläche
import { Marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import { BOTS, systemPromptFor, model3dSystemPrompt, MODEL_GRAMMAR, DETAIL_LEVELS, DETAIL_TOKENS, parseModelText, modelToText, examplesFor, modelSource } from './prompts.js';
import { Viewer3D, extractJson, normalizeModel, snapFloatingParts } from './viewer3d.js';

const forge = window.forge;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- Icons ----------
const I = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8Z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7Z"/><path d="M14 3v4h4"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4Z"/></svg>',
  cube: '<svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7Z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>',
};

// ---------- Speicher ----------
function load(key, def) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? def;
  } catch {
    return def;
  }
}
function store(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    toast('Speicher voll – alte Chats löschen hilft.', 'err');
  }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DEFAULTS = {
  aiName: 'FORGE',
  temperature: 0.3,
  web: true,
};

const S = {
  building: {},
  settings: { ...DEFAULTS, ...load('forge.settings', {}) },
  convs: load('forge.convs', []),
  models: load('forge.models', []),
  mode: 'code',
  convId: null,
  modelId: null,
  engine: null,
  busy: false,
  streamId: null,
  attachments: [],
  detail: 2,
  styles: new Set(),
  viewer: null,
};
const saveSettings = () => store('forge.settings', S.settings);
const saveConvs = () => store('forge.convs', S.convs.slice(0, 200));
const saveModels = () => store('forge.models', S.models.slice(0, 150));

// ---------- Toasts ----------
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// ---------- Markdown ----------
const EXT = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', html: 'html', css: 'css', json: 'json',
  java: 'java', kotlin: 'kt', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', cs: 'cs', rust: 'rs', go: 'go',
  lua: 'lua', bash: 'sh', sh: 'sh', shell: 'sh', powershell: 'ps1', ps1: 'ps1', bat: 'bat', batch: 'bat', cmd: 'bat',
  sql: 'sql', yaml: 'yml', yml: 'yml', xml: 'xml', markdown: 'md', md: 'md', php: 'php', ruby: 'rb', swift: 'swift',
  gdscript: 'gd', glsl: 'glsl', hlsl: 'hlsl', toml: 'toml', ini: 'ini', jsx: 'jsx', tsx: 'tsx', vue: 'vue', svg: 'svg',
  mcfunction: 'mcfunction', groovy: 'gradle', gradle: 'gradle',
};
const LANG_OF_EXT = { py: 'python', js: 'javascript', ts: 'typescript', html: 'html', css: 'css', json: 'json', java: 'java', kt: 'kotlin', c: 'c', cpp: 'cpp', h: 'cpp', cs: 'csharp', rs: 'rust', go: 'go', lua: 'lua', sh: 'bash', ps1: 'powershell', sql: 'sql', yml: 'yaml', yaml: 'yaml', xml: 'xml', md: 'markdown', php: 'php', rb: 'ruby', gd: 'gdscript', glsl: 'glsl', toml: 'toml', gradle: 'groovy' };

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    code({ text, lang }) {
      const raw = String(lang || '').trim();
      let l = raw.split(/[\s:{]/)[0].toLowerCase();
      if (l === 'forge3d' || (/^name\s*:/i.test(text.trim()) && /\|\s*#[0-9a-f]{3,6}\s*\|/i.test(text))) {
        const m = parseModelText(text);
        const sw = m.parts.slice(0, 8).map((p) => `<i style="background:${esc(p.color)}"></i>`).join('');
        return `<div class="model-card"><div class="mc-icon">◆</div><div class="mc-info"><b>${esc(m.name)}</b><span>${m.parts.length} Teile <span class="mc-sw">${sw}</span></span></div>
<div class="mc-actions"><button class="btn sm primary" data-act="open3d">In 3D öffnen</button><button class="btn sm ghost" data-act="copy">${I.copy}</button></div>
<pre hidden><code>${esc(text)}</code></pre></div>`;
      }
      if (l === 'forge-modell' || l === 'forge-model') {
        const o = parseOrder(text);
        const conv = currentConv();
        const done = conv && conv.models && conv.models[o.key];
        const st = S.building[o.key];
        const status = st ? `<span class="spinner"></span> ${esc(st)}` : done ? `✓ gebaut – ${done.parts.length} Teile` : 'wird gebaut, sobald die Antwort fertig ist';
        return `<div class="model-card order" data-order="${esc(o.key)}"><div class="mc-icon">🧊</div><div class="mc-info"><b>3D-Modell „${esc(o.key)}“ vom 3D-Designer</b><span>${esc(o.description.slice(0, 120))}</span><span class="mc-status">${status}</span></div>
<div class="mc-actions">${done ? `<button class="btn sm ghost" data-act="openorder" data-key="${esc(o.key)}">Ansehen</button><button class="btn sm ghost" data-act="rebuildorder" data-key="${esc(o.key)}">Neu bauen</button>` : ''}</div></div>`;
      }
      const fileHint = (raw.match(/([\w\-./\\]+\.[a-z0-9]{1,8})/i) || [])[1] || '';
      let html;
      try {
        html = l && hljs.getLanguage(l) ? hljs.highlight(text, { language: l, ignoreIllegals: true }).value : esc(text);
      } catch {
        html = esc(text);
      }
      const kind = runKind(l, text, fileHint);
      return `<div class="codeblock" data-lang="${esc(l)}" data-file="${esc(fileHint)}">
<div class="cb-head"><span class="cb-lang">${esc(l || 'code')}</span><span class="cb-file"></span><div class="cb-actions">
${kind ? `<button class="run" data-act="run">${I.play}${kind === 'web' || kind === 'webjs' ? 'Öffnen' : 'Ausführen'}</button>` : ''}
<button data-act="copy">${I.copy}Kopieren</button><button data-act="save">${I.save}Speichern</button></div></div>
<pre><code class="hljs">${html}</code></pre></div>`;
    },
    html({ text }) {
      return esc(text);
    },
    link({ href, text }) {
      const safe = /^https?:\/\//i.test(href || '') ? href : '#';
      return `<a href="${esc(safe)}" target="_blank">${text}</a>`;
    },
    image({ text }) {
      return esc(text || '');
    },
  },
});

function decorateCodeblocks(root) {
  for (const cb of $$('.codeblock', root)) {
    let file = cb.dataset.file;
    if (!file) {
      const prev = cb.previousElementSibling;
      if (prev && /^(P|H\d|LI)$/.test(prev.tagName)) {
        const m = prev.textContent.trim().match(/([\w\-./\\]+\.[a-z0-9]{1,10})\s*:?\s*\)?$/i);
        if (m) file = m[1];
      }
    }
    if (file) {
      cb.dataset.file = file;
      $('.cb-file', cb).textContent = file;
    }
  }
}

// ---------- KI-Motor (eingebaut) ----------
const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round((b || 0) / 1e6) + ' MB');
const gpuLabel = (hw) => (!hw ? '' : !hw.gpu ? 'CPU' : { vulkan: 'Grafikkarte', cuda: 'CUDA', metal: 'Metal' }[hw.gpu] || hw.gpu);
const activeLabel = () => {
  const a = S.engine && S.engine.active;
  return a ? `${a.kind === 'chat' ? 'Chat' : a.id === 'custom' ? 'Eigenes' : 'Coder'} ${a.title} · ${a.params}` : '– kein Modell –';
};
const dlPct = (d) => (d && d.total ? Math.floor((d.received / d.total) * 100) : 0);

function onEngine(st) {
  const wasReady = S.engine && S.engine.status === 'ready';
  if (st.notice && (!S.engine || S.engine.notice !== st.notice)) toast(st.notice, 'err');
  if (st.memNote && st.status === 'ready' && (!S.engine || S.engine.memNote !== st.memNote)) toast(st.memNote);
  const prevUp = S.engine && S.engine.upgradeReady;
  S.engine = st;
  if (st.upgradeReady && (!prevUp || prevUp.at !== st.upgradeReady.at)) toast(`🚀 ${st.upgradeReady.title} (${st.upgradeReady.params}) ist bereit – ${st.upgradeReady.bots && st.upgradeReady.bots.includes('chat') ? 'alle Bots benutzen' : 'Coder und 3D-Designer benutzen'} es ab jetzt.`, 'ok');
  if (S.waitingAi && S.waitingAi.m.waiting) fillAi(S.waitingAi.el, S.waitingAi.m, false, true);
  renderUpgrade();
  renderStatus();
  updateModelLabels();
  renderEngineOverlay();
  if (st.status === 'ready' && !wasReady && S.setupShown) {
    toast(`${S.settings.aiName} ist bereit!`, 'ok');
  }
  if (st.status === 'ready' && !wasReady) {
    const ab = BOTS[st.activeBot] ? st.activeBot : 'code';
    forge.engine.preload([{ role: 'system', content: systemPromptFor(ab, S.settings.aiName, { web: S.settings.web }) }]).catch(() => {});
  }
}

// ---------- Speicherplatz: eigene Dateien von FORGE aufräumen ----------
let storageBusy = false;
function refreshStorage() {
  if (storageBusy) return;
  storageBusy = true;
  forge.engine
    .storage()
    .then((info) => {
      S.storage = { ...info, at: Date.now() };
      renderUpgrade();
    })
    .catch(() => {})
    .finally(() => (storageBusy = false));
}
function fileLabel(it) {
  if (it.part) return `Halber Download „${it.title}“`;
  return `Modell „${it.title}“`;
}
// Was kann für den Download des neuen Modells weg? Erst halbe Downloads, dann Modelle, die das neue ersetzt.
function cleanupPlan(bg) {
  const info = S.storage;
  if (!info || Date.now() - info.at > 60000) return null;
  const target = S.engine.catalog.find((c) => c.id === bg.id) || {};
  const replaces = (id) => {
    const c = S.engine.catalog.find((x) => x.id === id);
    if (!c) return false;
    const bots = target.bots || ['code', 'design'];
    return (c.usedBy || []).every((b) => bots.includes(b));
  };
  const cands = info.items
    .filter((it) => it.removable && it.id !== bg.id && (it.part || !it.usedByBot || replaces(it.id)))
    .sort((a, b) => b.part - a.part || b.bytes - a.bytes);
  const needGB = bg.nospace.needGB;
  const freeGB = info.free != null ? info.free : bg.nospace.freeGB;
  const files = [];
  let freed = 0;
  for (const it of cands) {
    if (freeGB + freed / 1024 ** 3 >= needGB + 0.3) break;
    files.push({ file: it.file, bytes: it.bytes, label: fileLabel(it) + (it.part ? '' : ' (wird ersetzt)') });
    freed += it.bytes;
  }
  return { files, needGB, freeGB, freedGB: freed / 1024 ** 3 };
}
// Nach dem Wechsel: Modelle, die kein Bot mehr benutzt, und halbe Downloads
function oldModels() {
  const info = S.storage;
  const since = (S.engine.upgradeReady && S.engine.upgradeReady.at) || 0;
  if (!info || info.at < since + 1500) {
    refreshStorage();
    return [];
  }
  const bgId = S.engine.bgDownload && S.engine.bgDownload.id;
  return info.items.filter((it) => it.removable && !it.usedByBot && it.id !== bgId).map((it) => ({ file: it.file, bytes: it.bytes, label: fileLabel(it) }));
}

// ---------- Profi-Modell (Qwen3.6): Angebot + Hintergrund-Download ----------
const fmtGB = (b) => (b / 1e9).toFixed(1).replace('.', ',');
function renderUpgrade() {
  const st = S.engine;
  const bar = $('#upgradeBar');
  if (!st || !st.catalog) return (bar.hidden = true);
  const bg = st.bgDownload;
  // Sparsames Modell (passt komplett auf die Grafikkarte) wird einmal automatisch geholt
  const auto = st.catalog.find((c) => c.upgrade && c.autoUpgrade && !c.installed);
  // Läuft noch der große Profi-Download aus 1.12? Für den sparsamen Coder stoppen (Teil bleibt gespeichert)
  if (auto && bg && bg.id !== auto.id && !bg.error && !localStorage.getItem('forge.upgrade.switched.' + auto.id)) {
    localStorage.setItem('forge.upgrade.switched.' + auto.id, '1');
    localStorage.setItem('forge.upgrade.dismissed', bg.id);
    forge.engine.bgCancel().then(() => setTimeout(() => forge.engine.bgDownload(auto.id), 800));
    toast(`Großer Download gestoppt – du bekommst stattdessen den sparsamen Coder (${fmtGB(auto.size)} GB), der fast keinen Arbeitsspeicher braucht.`);
    return;
  }
  const up = auto || null;
  let html = '';
  if (bg && bg.error && bg.nospace) {
    // Zu wenig Platz: zeigen, was FORGE selbst löschen kann
    const plan = cleanupPlan(bg);
    if (!plan) {
      refreshStorage();
      html = `<div class="ub-title">⚠ Zu wenig Speicherplatz</div><div class="ub-text">Prüfe, was FORGE aufräumen kann …</div>`;
    } else {
      const list = plan.files.map((f) => `<li>${esc(f.label)} <span>${fmtGB(f.bytes)} GB</span></li>`).join('');
      const missing = Math.max(0, plan.needGB - plan.freeGB - plan.freedGB);
      html = `<div class="ub-title">⚠ Zu wenig Speicherplatz</div><div class="ub-text">Für den neuen Coder fehlen ${String((plan.needGB - plan.freeGB).toFixed(1)).replace('.', ',')} GB.${
        plan.files.length ? ' FORGE kann diese eigenen Dateien löschen:' : ''
      }</div>${list ? `<ul class="ub-list">${list}</ul>` : ''}${
        missing > 0.05 ? `<div class="ub-text">Danach fehlen immer noch ${String(missing.toFixed(1)).replace('.', ',')} GB – lösche bitte noch andere Dateien auf dem Laufwerk und klick dann auf „Nochmal“.</div>` : ''
      }<div class="ub-actions">${plan.files.length && missing <= 0.05 ? `<button class="btn sm primary" data-up="clean">Platz schaffen &amp; weiterladen</button>` : ''}<button class="btn sm${plan.files.length && missing <= 0.05 ? ' ghost' : ' primary'}" data-up="start">Nochmal</button><button class="btn sm ghost" data-up="cancel">Abbrechen</button></div>`;
    }
  } else if (bg && bg.error) {
    html = `<div class="ub-title">⚠ Download vom neuen Coder unterbrochen</div><div class="ub-text">${esc(bg.error)}</div><div class="ub-actions"><button class="btn sm primary" data-up="start">Weiter laden</button><button class="btn sm ghost" data-up="cancel">Abbrechen</button></div>`;
  } else if (!bg && st.upgradeReady && oldModels().length && localStorage.getItem('forge.cleanup.done') !== String(st.upgradeReady.at)) {
    const old = oldModels();
    const total = old.reduce((n, f) => n + f.bytes, 0);
    html = `<div class="ub-title">🧹 Alte Modelle aufräumen?</div><div class="ub-text">Diese Dateien braucht FORGE nicht mehr:</div><ul class="ub-list">${old
      .map((f) => `<li>${esc(f.label)} <span>${fmtGB(f.bytes)} GB</span></li>`)
      .join('')}</ul><div class="ub-actions"><button class="btn sm primary" data-up="cleanold">Löschen (${fmtGB(total)} GB frei)</button><button class="btn sm ghost" data-up="keepold">Behalten</button></div>`;
  } else if (bg) {
    const pct = dlPct(bg);
    const left = bg.speed > 0 ? Math.max(1, Math.round((bg.total - bg.received) / bg.speed / 60)) : null;
    const nm = (st.catalog.find((c) => c.id === bg.id) || {}).title || 'neuen Coder';
    html = `<div class="ub-title">🚀 Lade den ${esc(nm)}-Coder (${esc(bg.params || '')}) … ${pct} %</div><div class="ub-prog"><i style="width:${pct}%"></i></div><div class="ub-text">${fmtGB(bg.received || 0)} von ${fmtGB(bg.total || 0)} GB${left ? ` · noch ca. ${left} min` : ''}<br>Du kannst währenddessen ganz normal weiterarbeiten.</div><div class="ub-actions"><button class="btn sm ghost" data-up="cancel">Abbrechen</button></div>`;
  } else if (up && !up.installed && localStorage.getItem('forge.upgrade.dismissed') !== up.id) {
    // Einmal automatisch starten (der Nutzer hat sich das stärkere Modell gewünscht), danach nur noch anbieten
    if (st.status === 'ready' && !localStorage.getItem('forge.upgrade.auto.' + up.id)) {
      localStorage.setItem('forge.upgrade.auto.' + up.id, '1');
      forge.engine.bgDownload(up.id);
    }
    html = `<div class="ub-title">🚀 Neuer Coder verfügbar: ${esc(up.title)} (${esc(up.params)})</div><div class="ub-text">Besserer Code, läuft komplett auf der Grafikkarte und braucht kaum Arbeitsspeicher. Einmal ${fmtGB(up.size)} GB laden, im Hintergrund.</div><div class="ub-actions"><button class="btn sm primary" data-up="start">Im Hintergrund laden</button><button class="btn sm ghost" data-up="later">Später</button></div>`;
  }
  bar.hidden = !html;
  if (bar.dataset.html !== html) {
    bar.dataset.html = html;
    bar.innerHTML = html;
  }
}
$('#upgradeBar').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-up]');
  if (!b) return;
  const bgId = S.engine.bgDownload && S.engine.bgDownload.id;
  const up = S.engine.catalog.find((c) => c.id === bgId) || S.engine.catalog.find((c) => c.upgrade && c.autoUpgrade && !c.installed);
  if (b.dataset.up === 'start' && up) {
    localStorage.removeItem('forge.upgrade.dismissed');
    S.storage = null;
    const r = await forge.engine.bgDownload(up.id);
    if (r && r.ok === false) toast(r.error || 'Download konnte nicht starten', 'err');
  } else if (b.dataset.up === 'cancel') {
    if (up) localStorage.setItem('forge.upgrade.dismissed', up.id);
    forge.engine.bgCancel();
    toast('Download abgebrochen – der bisher geladene Teil bleibt gespeichert. Du kannst ihn später im Modell-Menü fortsetzen.');
  } else if (b.dataset.up === 'clean' && up) {
    const plan = cleanupPlan(S.engine.bgDownload);
    if (!plan) return;
    b.disabled = true;
    const r = await forge.engine.freeSpace(plan.files.map((f) => f.file));
    toast(`🧹 ${fmtGB(r.freedGB * 1024 ** 3)} GB frei gemacht – lade weiter …`, 'ok');
    S.storage = null;
    forge.engine.bgDownload(up.id);
  } else if (b.dataset.up === 'cleanold') {
    const old = oldModels();
    b.disabled = true;
    const r = await forge.engine.freeSpace(old.map((f) => f.file));
    localStorage.setItem('forge.cleanup.done', String(S.engine.upgradeReady && S.engine.upgradeReady.at));
    toast(`🧹 ${fmtGB(r.freedGB * 1024 ** 3)} GB frei gemacht.`, 'ok');
    S.storage = null;
    renderUpgrade();
  } else if (b.dataset.up === 'keepold') {
    localStorage.setItem('forge.cleanup.done', String(S.engine.upgradeReady && S.engine.upgradeReady.at));
    renderUpgrade();
  } else if (b.dataset.up === 'later' && up) {
    localStorage.setItem('forge.upgrade.dismissed', up.id);
    renderUpgrade();
  }
});

function renderStatus() {
  const st = S.engine;
  const el = $('#statusBtn');
  el.classList.remove('on', 'off', 'busy');
  let text;
  switch (st.status) {
    case 'ready': {
      el.classList.add('on');
      const share = st.active.gpuShare;
      const where = st.hardware && st.hardware.gpu && share != null && share < 100 ? (share === 0 ? 'RAM' : `Grafikkarte ${share} %`) : gpuLabel(st.hardware);
      text = `Bereit · ${(BOTS[st.active.bot] || BOTS.code).name} ${st.active.params} · ${where}`;
      break;
    }
    case 'downloading':
      el.classList.add('busy');
      text = `Lade Modell … ${dlPct(st.download)} %`;
      break;
    case 'paused':
      el.classList.add('busy');
      text = '👁 Schaut sich ein Bild an …';
      break;
    case 'loading':
      el.classList.add('busy');
      text = `KI startet … ${st.loadProgress || 0} %`;
      break;
    case 'detecting':
      el.classList.add('busy');
      text = 'Erkenne Hardware …';
      break;
    case 'error':
      el.classList.add('off');
      text = 'Fehler – hier klicken';
      break;
    default:
      el.classList.add('off');
      text = 'Kein Modell aktiv';
  }
  $('#statusText').textContent = text;
}

function updateModelLabels() {
  const m = activeLabel();
  $('#codeModelChip').textContent = m;
  $('#hintModel').textContent = m;
  $('#brandName').textContent = (S.settings.aiName || 'FORGE').toUpperCase() + ' AI';
  $('#heroName').textContent = (S.settings.aiName || 'FORGE').toUpperCase();
  document.title = (S.settings.aiName || 'FORGE') + ' AI';
}

// ======================================================================
//                               CODE-MODUS
// ======================================================================
const botOf = (conv) => (conv && BOTS[conv.bot] ? conv.bot : S.newBot || 'chat');
S.newBot = BOTS[S.settings.lastBot] ? S.settings.lastBot : 'chat';

function renderSuggestions() {
  const bot = BOTS[botOf(currentConv())];
  $('#botPicker').innerHTML = Object.values(BOTS)
    .map(
      (b) => `<button class="bot-card ${b.id === bot.id ? 'active' : ''}" data-bot="${b.id}" style="--bot:${b.color}">
        <span class="bot-ic">${b.icon}</span><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></button>`
    )
    .join('');
  $('#suggestions').innerHTML = bot.suggestions
    .map(([t, p], i) => `<div class="sugg" data-i="${i}" style="--bot:${bot.color}"><b>${esc(t)}</b><span>${esc(p.length > 82 ? p.slice(0, 80) + '…' : p)}</span></div>`)
    .join('');
  $('#heroSub').textContent = `${bot.name}: ${bot.desc}. Läuft komplett auf deinem PC.`;
}
$('#suggestions').addEventListener('click', (e) => {
  const el = e.target.closest('.sugg');
  if (!el) return;
  $('#input').value = BOTS[botOf(currentConv())].suggestions[+el.dataset.i][1];
  autosize();
  sendMessage();
});
$('#botPicker').addEventListener('click', (e) => {
  const b = e.target.closest('.bot-card');
  if (b) setBot(b.dataset.bot);
});

// Bot für den aktuellen (oder neuen) Chat wählen
function setBot(id) {
  if (!BOTS[id]) return;
  const conv = currentConv();
  if (conv) {
    conv.bot = id;
    saveConvs();
  }
  S.newBot = id;
  S.settings.lastBot = id;
  saveSettings();
  renderSuggestions();
  renderBotChip();
  renderSideList();
  $('#input').placeholder = `Schreib dem ${BOTS[id].name} … (Enter = senden, Shift+Enter = neue Zeile)`;
  $('#input').focus();
}

function renderBotChip() {
  const b = BOTS[botOf(currentConv())];
  $('#botChip').innerHTML = `<span class="bot-dot" style="background:${b.color}"></span>${esc(b.name)}<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;
  $('#botMenu').innerHTML = Object.values(BOTS)
    .map((x) => `<button data-bot="${x.id}" class="${x.id === b.id ? 'active' : ''}"><span class="bot-dot" style="background:${x.color}"></span><b>${esc(x.name)}</b><span>${esc(x.desc)}</span></button>`)
    .join('');
  document.documentElement.style.setProperty('--bot-color', b.color);
}
$('#botChip').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#botMenu').hidden = !$('#botMenu').hidden;
});
$('#botMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bot]');
  if (!b) return;
  $('#botMenu').hidden = true;
  setBot(b.dataset.bot);
});
document.addEventListener('click', () => ($('#botMenu').hidden = true));

const currentConv = () => S.convs.find((c) => c.id === S.convId) || null;

function newConv() {
  const c = { id: uid(), title: 'Neuer Chat', messages: [], updated: Date.now(), bot: S.newBot || 'chat' };
  S.convs.unshift(c);
  S.convId = c.id;
  return c;
}

function openConv(id) {
  if (S.busy) stopStream();
  S.convId = id;
  renderConversation();
  renderSideList();
}

function renderSideList() {
  const list = $('#sideList');
  if (S.mode === 'code') {
    $('#listLabel').textContent = 'Chats';
    $('#newBtnText').textContent = 'Neuer Chat';
    if (!S.convs.length) {
      list.innerHTML = '<div class="side-empty">Noch keine Chats</div>';
      return;
    }
    list.innerHTML = S.convs
      .map(
        (c) => `<div class="side-item ${c.id === S.convId ? 'active' : ''}" data-id="${c.id}" title="${esc(BOTS[c.bot || 'code'].name)}"><span class="bot-dot" style="background:${BOTS[c.bot || 'code'].color}"></span><span class="t">${esc(c.title)}</span><button class="del" title="Löschen">${I.trash}</button></div>`
      )
      .join('');
  } else {
    $('#listLabel').textContent = 'Meine Modelle';
    $('#newBtnText').textContent = 'Neues Modell';
    if (!S.models.length) {
      list.innerHTML = '<div class="side-empty">Noch keine Modelle</div>';
      return;
    }
    list.innerHTML = S.models
      .map((m) => {
        const col = m.model?.parts?.[0]?.color || '#888';
        return `<div class="side-item ${m.id === S.modelId ? 'active' : ''}" data-id="${m.id}"><span class="sw" style="background:${esc(col)}"></span><span class="t">${esc(m.name)}</span><button class="del" title="Löschen">${I.trash}</button></div>`;
      })
      .join('');
  }
}

$('#sideList').addEventListener('click', (e) => {
  const item = e.target.closest('.side-item');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.closest('.del')) {
    if (S.mode === 'code') {
      S.convs = S.convs.filter((c) => c.id !== id);
      saveConvs();
      if (S.convId === id) S.convId = null;
      renderConversation();
    } else {
      S.models = S.models.filter((m) => m.id !== id);
      saveModels();
      if (S.modelId === id) S.modelId = null;
    }
    renderSideList();
    return;
  }
  if (S.mode === 'code') openConv(id);
  else openSavedModel(id);
});

function renderConversation() {
  const conv = currentConv();
  const box = $('#messages');
  box.innerHTML = '';
  $('#welcome').hidden = !!(conv && conv.messages.length);
  $('#chatTitle').textContent = conv ? conv.title : 'Neuer Chat';
  if (conv && !conv.bot) conv.bot = 'code'; // Chats aus älteren Versionen gehörten zum Coder
  if (conv && conv.bot) S.newBot = conv.bot;
  renderBotChip();
  renderSuggestions();
  $('#input').placeholder = `Schreib dem ${BOTS[botOf(conv)].name} … (Enter = senden, Shift+Enter = neue Zeile)`;
  if (!conv) return;
  conv.messages.forEach((m, i) => box.appendChild(m.role === 'user' ? userEl(m) : aiEl(m, i === conv.messages.length - 1)));
  scrollBottom(true);
}

function userEl(m) {
  const d = document.createElement('div');
  d.className = 'msg user';
  if (m.auto) {
    d.classList.add('auto');
    const err = m.content.replace(/^[\s\S]*?```\n?/, '').replace(/```[\s\S]*$/, '').trim();
    d.innerHTML =
      m.kind === 'check'
        ? `<div><div class="bubble"><b>🔍 Selbstprüfung${m.attempt ? ` (Runde ${m.attempt}/${MAX_CHECK})` : ''}</b><span>Vor dem Start wurden Fehler gefunden – die KI behebt sie selbst.</span><details><summary>Gefundene Fehler</summary><pre>${esc(err.slice(-1500))}</pre></details></div></div>`
        : `<div><div class="bubble"><b>🔧 Automatische Reparatur${m.attempt ? ` (Versuch ${m.attempt}/${MAX_REPAIR})` : ''}</b><span>Beim Ausführen kam ein Fehler – die KI behebt ihn selbst.</span><details><summary>Fehlermeldung</summary><pre>${esc(err.slice(-1500))}</pre></details></div></div>`;
    return d;
  }
  const imgs = (m.files || []).filter((f) => f.image && f.thumb).map((f) => `<img src="${f.thumb}" alt="${esc(f.name)}" title="${esc(f.name)}">`).join('');
  const files = (m.files || []).filter((f) => !f.image).map((f) => `<span class="file-pill">${esc(f.name)}</span>`).join('');
  const seen = (m.files || []).filter((f) => f.image).map((f) => (f.description ? `<details class="vision-note"><summary>👁 So hat die KI „${esc(f.name)}“ gesehen</summary>${esc(f.description)}</details>` : f.visionError ? `<div class="vision-note">⚠ Bild nicht verstanden: ${esc(f.visionError)}</div>` : '')).join('');
  d.innerHTML = `<div>${imgs ? `<div class="msg-imgs">${imgs}</div>` : ''}${m.content || !imgs ? `<div class="bubble">${esc(m.content) || '<span class="muted">(nur Dateien)</span>'}</div>` : ''}${files ? `<div class="files">${files}</div>` : ''}${seen}</div>`;
  return d;
}

function aiEl(m, isLast) {
  const d = document.createElement('div');
  d.className = 'msg ai';
  const b = BOTS[m.bot] || BOTS[botOf(currentConv())];
  d.innerHTML = `<div class="avatar" style="background:${b.color}" title="${esc(b.name)}">${b.icon}</div><div class="body"></div>`;
  fillAi(d, m, true, isLast);
  return d;
}

function fillAi(el, m, final, isLast) {
  const body = $('.body', el);
  let html = '';
  if (m.thinking) html += `<details class="think"><summary>Gedankengang</summary><div>${esc(m.thinking)}</div></details>`;
  if (m.thought) {
    const words = m.thought.trim().split(/\s+/).length;
    const live = !final && !m.content;
    html += `<details class="thought"${live ? ' open' : ''}><summary>${live ? '<span class="spinner"></span>💭 Denkt nach …' : '💭 Gedankengang'} <span class="muted">(${words} Wörter)</span></summary><div class="thought-body">${esc(live ? m.thought.slice(-1500) : m.thought.slice(-8000))}</div></details>`;
  }
  if (m.tool && m.tool.phase === 'error') html += `<div class="web-status err">🌐 Internet gerade nicht erreichbar – Antwort ohne Suche</div>`;
  if (m.content) html += `<div class="md ${final ? '' : 'cursor'}">${md.parse(m.content)}</div>`;
  else if (!final && m.tool && webText(m.tool)) html += `<div class="web-status"><span class="spinner"></span>${esc(webText(m.tool))}</div>`;
  else if (!final && m.waiting) html += `<div class="waiting"><span class="spinner"></span>${esc(waitingText(m))}</div>`;
  else if (!final) html += `<div class="typing"><i></i><i></i><i></i></div>`;
  if (m.error) {
    html += `<div class="err-box">${esc(m.error.replace('NO_MODEL: ', ''))}<div><button class="btn sm" data-act="setup">KI-Modelle öffnen</button></div></div>`;
  }
  if (final && m.check) html += checkHtml(m);
  if (m.sources && m.sources.length && (m.content || final)) {
    html += `<div class="sources"><span class="lbl">🌐 Quellen</span>${m.sources
      .slice(0, 8)
      .map((src, i) => {
        let host = '';
        try {
          host = new URL(src.url).hostname.replace(/^www\./, '');
        } catch {}
        return `<button data-act="src" data-url="${esc(src.url)}" title="${esc(src.title)}\n${esc(src.url)}"><b>${i + 1}</b><span>${esc(src.title)}</span><i>${esc(host)}</i></button>`;
      })
      .join('')}</div>`;
  }
  if (final && (m.content || m.error)) {
    const activeId = S.engine && S.engine.active && S.engine.active.id;
    const slow = isLast && m.tps && m.tps < 6 && activeId && activeId !== 'leicht' && activeId !== 'test';
    html += `<div class="msg-meta"><button data-act="copyall">${I.copy}Kopieren</button>${
      isLast ? `<button data-act="regen">${I.redo}Neu generieren</button>` : ''
    }${slow ? `<button data-act="setup" class="speed-tip" title="Ein kleineres Modell antwortet deutlich schneller">⚡ Zu langsam? Schnelleres Modell wählen</button>` : ''}<span class="sep"></span><span>${esc(m.model || '')}${m.tps ? ` · ${m.tps.toFixed(1).replace('.', ',')} Token/s` : ''}${m.stopped ? ' · gestoppt' : ''}</span></div>`;
  }
  body.innerHTML = html;
  decorateCodeblocks(body);
}

function webText(t) {
  if (t.phase === 'search') return `Sucht im Internet: „${t.query}“ …`;
  if (t.phase === 'read') return `Liest ${t.count === 1 ? 'eine Seite' : t.count + ' Seiten'}${t.hosts && t.hosts.length ? ` (${t.hosts.join(', ')})` : ''} …`;
  if (t.phase === 'answer') return 'Schreibt die Antwort …';
  return '';
}

function waitingText(m) {
  if (m.visionText) return m.visionText;
  const st = S.engine || {};
  const b = BOTS[m.bot] || BOTS.chat;
  if (st.status === 'downloading' && st.download) return `Lade das KI-Modell ${st.download.title} (${st.download.params}) … ${dlPct(st.download)} % (nur einmal nötig)`;
  if (st.status === 'paused') return 'Die KI schaut sich gerade ein Bild an … gleich geht es weiter.';
  if (st.status === 'loading') return `Wechsle zum ${b.name}-Modell … ${st.loadProgress || 0} %`;
  if (m.switching) return `Wechsle zum ${b.name} …`;
  return "Deine KI startet noch … gleich geht's los.";
}

let renderPending = false;
let lastRenderAt = 0;
const finished = new WeakSet();
function scheduleRender(el, m) {
  if (renderPending) return;
  renderPending = true;
  const wait = Math.max(0, 70 - (performance.now() - lastRenderAt));
  setTimeout(() => requestAnimationFrame(() => {
    renderPending = false;
    lastRenderAt = performance.now();
    if (finished.has(m)) return;
    const stick = nearBottom();
    fillAi(el, m, false, true);
    if (stick) scrollBottom();
  }), wait);
}

function nearBottom() {
  const s = $('#scroller');
  return s.scrollHeight - s.scrollTop - s.clientHeight < 120;
}
function scrollBottom(force) {
  const s = $('#scroller');
  if (force || nearBottom()) s.scrollTop = s.scrollHeight;
}

function toPlain(m) {
  let c = m.content || '';
  if (m.files && m.files.length) {
    c +=
      '\n\n' +
      m.files
        .map((f) => {
          if (f.image)
            return f.description
              ? `Bild **${f.name}** (FORGE hat es sich für dich angesehen – so sieht es aus):\n${f.description}${f.palette && f.palette.length ? `\nHauptfarben: ${f.palette.join(' ')}` : ''}`
              : `Bild **${f.name}** (konnte nicht angesehen werden: ${f.visionError || 'unbekannt'})`;
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          return `Datei **${f.name}**:\n\`\`\`${LANG_OF_EXT[ext] || ''}\n${f.content}\n\`\`\``;
        })
        .join('\n\n');
  }
  return { role: m.role, content: c };
}

function setBusy(on) {
  S.busy = on;
  $('#sendBtn').classList.toggle('busy', on);
  $('#sendBtn').title = on ? 'Stoppen (Esc)' : 'Senden';
  $('#gen3dBtn').disabled = on;
  $('#edit3dBtn').disabled = on;
}

function stopStream() {
  if (S.streamId) forge.abort(S.streamId);
}

let pendingImages = [];
async function sendMessage(regenerate = false, preset = null) {
  if (S.busy) return null;
  pendingImages = [];
  const input = $('#input');
  const text = preset ? preset.text : input.value.trim();
  let conv = currentConv();
  if (preset) {
    if (!conv) return null;
    conv.messages.push(preset.auto ? { role: 'user', content: text, auto: true, kind: preset.kind || 'repair', attempt: preset.attempt || 0 } : { role: 'user', content: text });
  } else if (!regenerate) {
    if (!text && !S.attachments.length) return null;
    if (!conv) conv = newConv();
    pendingImages = S.attachments.filter((a) => a.image).map((a) => a.image);
    const um = {
      role: 'user',
      content: text,
      files: S.attachments.map((a) => (a.image ? { name: a.name, image: true, thumb: a.image.thumb, palette: a.image.palette } : { name: a.name, content: a.content })),
    };
    conv.messages.push(um);
    if (conv.messages.length === 1) conv.title = (text || um.files[0]?.name || 'Chat').replace(/\s+/g, ' ').slice(0, 52);
    input.value = '';
    S.attachments = [];
    renderAttachments();
    autosize();
  } else {
    if (!conv) return null;
    while (conv.messages.length && conv.messages[conv.messages.length - 1].role === 'assistant') conv.messages.pop();
    if (!conv.messages.length) return null;
  }
  conv.updated = Date.now();
  S.convs = [conv, ...S.convs.filter((c) => c.id !== conv.id)];

  const bot = botOf(conv);
  conv.bot = bot;
  const ai = { role: 'assistant', content: '', model: activeLabel(), bot };
  conv.messages.push(ai);
  renderConversation();
  renderSideList();
  const el = $('#messages').lastElementChild;
  scrollBottom(true);

  // Angehängte Bilder: von der KI ansehen lassen, Beschreibung bleibt an der Nachricht
  const um = conv.messages[conv.messages.length - 2];
  if (pendingImages.length && um && um.files) {
    setBusy(true);
    const imgFiles = um.files.filter((f) => f.image && !f.description);
    for (let i = 0; i < imgFiles.length && i < pendingImages.length; i++) {
      ai.waiting = true;
      const r = await describeImage(pendingImages[i], bot === 'design' ? 'model3d' : 'chat', um.content, (t) => {
        ai.visionText = t;
        fillAi(el, ai, false, true);
      });
      if (r && r.text) imgFiles[i].description = r.text;
      else {
        imgFiles[i].description = null;
        imgFiles[i].visionError = (r && r.error) || 'unbekannter Fehler';
        toast('Bild: ' + imgFiles[i].visionError, 'err');
      }
    }
    delete ai.visionText;
    ai.waiting = false;
    setBusy(false);
    saveConvs();
    // Nutzer-Nachricht neu zeichnen (zeigt jetzt, wie die KI das Bild gesehen hat)
    const uel = el.previousElementSibling;
    if (uel && uel.classList.contains('user')) uel.replaceWith(userEl(um));
  }
  pendingImages = [];
  const msgs = conv.messages.slice(0, -1).map(toPlain);
  if (bot === 'design' && msgs.length) {
    // Passende Bauplan-Beispiele unsichtbar an die Frage hängen (z. B. bei „Roblox-Charakter“)
    const last = msgs[msgs.length - 1];
    const ex = examplesFor(String(last.content), false);
    if (ex.length) last.content += `\n\n(Hinweis für dich: So sieht ein gutes Modell im FORGE-Format für so etwas aus. Nutze die Baupläne genauso.\n\`\`\`forge3d\n${ex.join('\n\`\`\`\n\`\`\`forge3d\n')}\n\`\`\`)`;
  }
  const req = {
    messages: [{ role: 'system', content: systemPromptFor(bot, S.settings.aiName, { web: S.settings.web }) }, ...msgs],
    temperature: bot === 'chat' ? Math.max(0.6, +S.settings.temperature) : +S.settings.temperature,
    bot,
    web: !!S.settings.web,
    think: S.settings.think || 'short',
  };
  S.waitingAi = { el, m: ai };
  setBusy(true);
  const id = uid();
  S.streamId = id;
  try {
    const res = await forge.chat(id, req, (d) => {
      if (d.waiting) {
        ai.waiting = true;
        if (d.switching) ai.switching = d.switching;
      }
      if (d.tool) {
        ai.waiting = false;
        ai.tool = d.tool;
      }
      if (d.sources) ai.sources = d.sources;
      if (d.thought) {
        ai.waiting = false;
        ai.thought = ((ai.thought || '') + d.thought).slice(-30000);
        ai.thinking = true;
      }
      if (d.text && ai.thinking) ai.thinking = false;
      if (d.text) {
        ai.waiting = false;
        ai.content += d.text;
      }
      scheduleRender(el, ai);
    });
    if (res && res.aborted) ai.stopped = true;
    if (res && res.tps) ai.tps = S.lastTps = res.tps;
    ai.model = activeLabel();
  } catch (err) {
    ai.error = err.message;
  } finally {
    delete ai.waiting;
    delete ai.switching;
    if (ai.tool && ai.tool.phase !== 'error') delete ai.tool;
    S.waitingAi = null;
    finished.add(ai);
    S.streamId = null;
    setBusy(false);
    renderPending = false;
    fillAi(el, ai, true, true);
    saveConvs();
    if (nearBottom()) scrollBottom(true);
  }
  // Bestellte 3D-Modelle vom 3D-Designer bauen lassen
  if (!ai.error && !ai.stopped && ai.content && bot !== 'design' && /```forge-modell/i.test(ai.content)) await buildOrders(conv, ai, el);
  // Selbstprüfung: Fehler finden, bevor der Nutzer startet – und gleich beheben lassen
  if (!ai.error && !ai.stopped && ai.content && bot !== 'design' && S.settings.selfCheck !== false) {
    const fixed = await selfCheck(conv, ai, el, (preset && preset.checkRound) || 0);
    if (fixed) return fixed;
  }
  return { conv, ai, el };
}

// Klicks in Nachrichten (Kopieren, Speichern, Vorschau …)
$('#messages').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'setup') return openModels();
  if (act === 'src') return forge.openExternal(btn.dataset.url);
  if (act === 'openorder') {
    const m = convModels()[btn.dataset.key];
    if (!m) return;
    setMode('3d');
    showModel(normalizeModel(m));
    return;
  }
  if (act === 'rebuildorder') {
    const conv = currentConv();
    const msgEl = btn.closest('.msg');
    const idx = $$('#messages > .msg').indexOf(msgEl);
    const m = conv && conv.messages[idx];
    if (!m || S.busy) return;
    return buildOrders(conv, m, msgEl, btn.dataset.key);
  }
  if (act === 'fixcheck') {
    const conv = currentConv();
    const msgEl = btn.closest('.msg');
    const idx = $$('#messages > .msg').indexOf(msgEl);
    const m = conv && conv.messages[idx];
    if (!m || !m.check || S.busy) return;
    m.check.fixing = true;
    fillAi(msgEl, m, true, idx === conv.messages.length - 1);
    return fixCheckProblems(m, Math.min((m.check.round || 0) + 1, MAX_CHECK));
  }
  if (act === 'regen') return sendMessage(true);
  if (act === 'copyall') {
    const conv = currentConv();
    const msgEl = btn.closest('.msg');
    const idx = $$('#messages > .msg').indexOf(msgEl);
    const m = conv && conv.messages[idx];
    if (m) await copyText(m.content);
    return flash(btn);
  }
  const cb = btn.closest('.codeblock') || btn.closest('.model-card');
  if (!cb) return;
  const code = $('code', cb).textContent;
  if (act === 'copy') {
    await copyText(code);
    flash(btn);
  } else if (act === 'save') {
    const lang = cb.dataset.lang;
    const name = cb.dataset.file ? cb.dataset.file.split(/[\\/]/).pop() : `code.${EXT[lang] || 'txt'}`;
    const r = await forge.saveFile({ name, data: code });
    if (r.ok) toast('Gespeichert: ' + r.path, 'ok');
    else if (r.error) toast(r.error, 'err');
  } else if (act === 'open3d') {
    try {
      const parsed = parseModelText(code);
      const m = finishModel(parsed, code).model;
      setMode('3d');
      showModel(m);
      saveToLibrary(m, '(aus dem Chat)');
      toast(`„${m.name}“ im 3D-Modus geöffnet`, 'ok');
    } catch (err) {
      toast('Modell konnte nicht geöffnet werden: ' + err.message, 'err');
    }
  } else if (act === 'run') {
    runFromBlock(cb);
  } else if (act === 'preview') {
    let html = code;
    if (cb.dataset.lang === 'svg' || (/^\s*<svg/i.test(code) && !/<html/i.test(code))) {
      html = `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body></html>`;
    }
    forge.previewHtml(html);
  }
});

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
function flash(btn) {
  const old = btn.innerHTML;
  btn.innerHTML = I.check + 'Kopiert';
  setTimeout(() => (btn.innerHTML = old), 1300);
}

// Eingabe
function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 260) + 'px';
}
$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});
$('#sendBtn').addEventListener('click', () => (S.busy ? stopStream() : sendMessage()));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#settings').hidden) closeSettings();
    else if (S.busy) stopStream();
  }
});

// ---------- Bilder: verkleinern, Vorschau, Hauptfarben ----------
function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geöffnet werden'));
    img.src = url;
  });
}
function drawScaled(img, max, bg) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { c, ctx };
}
// Hauptfarben (ohne Hintergrund): grob einteilen, zählen, ähnliche zusammenfassen
function imagePalette(img) {
  const { c, ctx } = drawScaled(img, 72, null);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px = (x, y) => {
    const i = (y * c.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  };
  const border = [];
  for (let x = 0; x < c.width; x++) border.push(px(x, 0), px(x, c.height - 1));
  for (let y = 0; y < c.height; y++) border.push(px(0, y), px(c.width - 1, y));
  const opaque = border.filter((p) => p[3] > 128);
  const bg = opaque.length > border.length * 0.6 ? opaque.reduce((a, p) => [a[0] + p[0] / opaque.length, a[1] + p[1] / opaque.length, a[2] + p[2] / opaque.length], [0, 0, 0]) : null;
  const bgUniform = bg && opaque.filter((p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < 40).length > opaque.length * 0.7;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    if (bgUniform && Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < 42) continue;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }
  const cols = [...buckets.values()].map((e) => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n] })).sort((a, b) => b.n - a.n);
  const total = cols.reduce((n, x) => n + x.n, 0) || 1;
  const out = [];
  for (const x of cols) {
    if (x.n / total < 0.02 || out.length >= 6) break;
    if (out.some((o) => Math.hypot(o[0] - x.c[0], o[1] - x.c[1], o[2] - x.c[2]) < 55)) continue;
    out.push(x.c);
  }
  return out.map((c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
}
async function prepareImage(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} ist zu groß (max. 25 MB)`);
  const img = await readImage(file);
  const big = drawScaled(img, 896, '#ffffff').c.toDataURL('image/jpeg', 0.9);
  const thumb = drawScaled(img, 240, '#ffffff').c.toDataURL('image/jpeg', 0.78);
  return { name: file.name || 'Bild', dataUrl: big, thumb, palette: imagePalette(img) };
}
// Fortschritt beim ersten Bild (Bild-Paket + Bild-Encoder einmalig laden)
let visionListener = null;
forge.vision.onState((st) => visionListener && visionListener(st));
function visionText(st) {
  if (st.phase === 'pack') return `Lade Bild-Verständnis … ${st.pct || 0} % (nur beim ersten Bild)`;
  if (st.phase === 'mmproj') return `Lade Bild-Encoder … ${st.pct || 0} % (nur beim ersten Bild, 0,9 GB)`;
  if (st.phase === 'look') return st.cpu ? '👁 Schaut sich das Bild an (auf dem Prozessor, dauert etwas) …' : '👁 Die KI schaut sich das Bild an …';
  return '👁 Bereite Bild-Verständnis vor …';
}
async function describeImage(image, mode, question, onText) {
  visionListener = (st) => onText(visionText(st));
  onText(visionText({ phase: 'prepare' }));
  try {
    return await forge.vision.describe({ imageData: image.dataUrl, mode, question });
  } finally {
    visionListener = null;
  }
}

// Dateien anhängen
const MAX_FILE = 300 * 1024;
async function addFiles(fileList) {
  for (const f of fileList) {
    if (/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type)) {
      try {
        const im = await prepareImage(f);
        S.attachments.push({ name: im.name, image: im });
      } catch (err) {
        toast(err.message, 'err');
      }
      continue;
    }
    if (f.size > MAX_FILE) {
      toast(`${f.name} ist zu groß (max. 300 KB)`, 'err');
      continue;
    }
    const text = await f.text();
    if (text.includes('\u0000')) {
      toast(`${f.name} ist keine Textdatei`, 'err');
      continue;
    }
    S.attachments.push({ name: f.name, content: text });
  }
  renderAttachments();
}
function renderAttachments() {
  $('#attachList').innerHTML = S.attachments
    .map((a, i) => `<span class="file-pill${a.image ? ' img' : ''}">${a.image ? `<img src="${a.image.thumb}" alt="">` : ''}${esc(a.name)}<button data-i="${i}" title="Entfernen">${I.x}</button></span>`)
    .join('');
}
$('#attachList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  S.attachments.splice(+b.dataset.i, 1);
  renderAttachments();
});
$('#attachBtn').addEventListener('click', () => $('#fileInput').click());

// Internet-Suche an/aus
function renderWebBtn() {
  const on = !!S.settings.web;
  $('#webBtn').classList.toggle('on', on);
  $('#webBtn').title = on ? 'Internet-Suche: AN – die KI sucht selbst im Netz, wenn es nötig ist (klicken zum Ausschalten)' : 'Internet-Suche: AUS – die KI antwortet nur mit ihrem eigenen Wissen (klicken zum Einschalten)';
}
$('#webBtn').addEventListener('click', () => {
  S.settings.web = !S.settings.web;
  saveSettings();
  renderWebBtn();
  toast(S.settings.web ? '🌐 Internet-Suche an' : 'Internet-Suche aus – alles bleibt offline', 'ok');
});
renderWebBtn();
$('#fileInput').addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});
const cv = $('#codeView');
let dragDepth = 0;
cv.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  cv.classList.add('dragging');
});
cv.addEventListener('dragover', (e) => e.preventDefault());
cv.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    cv.classList.remove('dragging');
  }
});
cv.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  cv.classList.remove('dragging');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

// ======================================================================
//              AUSFÜHREN: Spiele, Webseiten & Programme
// ======================================================================
const LANG_ALIAS = {
  html: 'web', htm: 'web', svg: 'web',
  javascript: 'javascript', js: 'javascript', node: 'javascript', mjs: 'javascript', jsx: null,
  typescript: 'typescript', ts: 'typescript',
  python: 'python', py: 'python', python3: 'python',
  powershell: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  bat: 'batch', batch: 'batch', cmd: 'batch',
  bash: 'bash', sh: 'bash', shell: 'bash',
  java: 'java', go: 'go', golang: 'go', lua: 'lua', ruby: 'ruby', rb: 'ruby', php: 'php',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', rust: 'rust', rs: 'rust',
};
const EXT_LANG = { html: 'web', htm: 'web', svg: 'web', js: 'javascript', mjs: 'javascript', ts: 'typescript', py: 'python', ps1: 'powershell', bat: 'batch', cmd: 'batch', sh: 'bash', java: 'java', go: 'go', lua: 'lua', rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp', cc: 'cpp', rs: 'rust' };
const LANG_EXT = { javascript: 'js', typescript: 'ts', python: 'py', powershell: 'ps1', batch: 'bat', bash: 'sh', java: 'java', go: 'go', lua: 'lua', ruby: 'rb', php: 'php', c: 'c', cpp: 'cpp', rust: 'rs' };
const LANG_NAME = { web: 'HTML', webjs: 'JavaScript', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', powershell: 'PowerShell', batch: 'Batch', bash: 'Bash', java: 'Java', go: 'Go', lua: 'Lua', ruby: 'Ruby', php: 'PHP', c: 'C', cpp: 'C++', rust: 'Rust' };

// Was für eine Art Code ist das – und kann FORGE ihn ausführen?
function runKind(lang, text, file) {
  let k = LANG_ALIAS[lang];
  if (k === undefined && file) k = EXT_LANG[(file.split('.').pop() || '').toLowerCase()];
  if (!k) return null;
  if (k === 'web') return /<(html|body|svg|canvas|div|script|h1|p|button|style)/i.test(text) ? 'web' : null;
  // Browser-JavaScript (mit document/canvas) läuft in der Vorschau statt in Node
  if (k === 'javascript' && /\b(document\.|window\.|getElementById|querySelector|requestAnimationFrame|getContext\()/.test(text)) return 'webjs';
  return k;
}

const RUN = { id: null, mode: null, spec: null, url: null, errs: 0, runtimes: null, errText: '', origin: null };

function rpShow(mode, lang, title) {
  RUN.mode = mode;
  $('#runPanel').hidden = false;
  $('#runPanel').classList.toggle('proc', mode !== 'web');
  $('#rpLang').textContent = LANG_NAME[lang] || lang;
  $('#rpTitle').textContent = title || '';
  $('#rpFrame').hidden = mode !== 'web';
  $('#rpWindow').hidden = mode !== 'web';
  $('#rpStop').hidden = mode === 'web';
  $('#rpIn').hidden = mode === 'web';
  $('#rpMsg').hidden = true;
  rpClear();
  const w = load('forge.rpWidth', 0);
  if (w) $('#runPanel').style.width = w + 'px';
}

function rpStatus(t, cls = '') {
  const el = $('#rpStatus');
  el.textContent = t;
  el.className = 'rp-status ' + cls;
}

function rpClear() {
  $('#rpOut').innerHTML = '';
  RUN.errs = 0;
  $('#rpErrs').textContent = '';
}

let rpPending = [];
let rpFlushT = null;
function rpWrite(stream, text) {
  text = String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  if (!text) return;
  rpPending.push([stream, text]);
  if (stream === 'stderr' || stream === 'error') {
    RUN.errText = (RUN.errText + text + (stream === 'error' ? '\n' : '')).slice(-6000);
    if (RUN.mode === 'web') scheduleWebFailure();
    RUN.errs++;
    $('#rpErrs').textContent = `${RUN.errs} Fehler`;
    if (RUN.mode === 'web') $('#runPanel').classList.add('con-open');
  }
  if (!rpFlushT) rpFlushT = setTimeout(rpFlush, 40);
}
function rpFlush() {
  rpFlushT = null;
  const out = $('#rpOut');
  const stick = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  const frag = document.createDocumentFragment();
  for (const [stream, text] of rpPending) {
    const sp = document.createElement('span');
    sp.className = 'o-' + stream;
    sp.textContent = stream === 'log' || stream === 'info' || stream === 'warn' || stream === 'error' ? text + '\n' : text;
    frag.appendChild(sp);
  }
  rpPending = [];
  out.appendChild(frag);
  while (out.childNodes.length > 3000) out.removeChild(out.firstChild);
  if (stick) out.scrollTop = out.scrollHeight;
}

// Alle Codeblöcke einer Antwort einsammeln – so funktionieren auch Projekte mit mehreren Dateien
function filesFromMessage(cb) {
  const msg = cb.closest('.msg');
  const files = {};
  for (const other of $$('.codeblock', msg)) {
    if (other.dataset.file) files[other.dataset.file.split(/[\\/]/).pop()] = $('code', other).textContent;
  }
  return files;
}

// Aus einem Codeblock (plus den anderen Dateien der Antwort) ein startbares Paket machen
function specFromBlock(cb) {
  const code = $('code', cb).textContent;
  const lang = cb.dataset.lang;
  const file = cb.dataset.file ? cb.dataset.file.split(/[\\/]/).pop() : '';
  const kind = runKind(lang, code, file);
  if (!kind) return null;
  const files = filesFromMessage(cb);
  if (kind === 'web') {
    let entry = file || 'index.html';
    let html = code;
    if (/^\s*<svg/i.test(code) && !/<html/i.test(code)) {
      html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body></html>`;
      entry = 'index.html';
    }
    files[entry] = html;
    return { kind, file, lines: code.split('\n').length, spec: { files, entry, models: convModels() } };
  }
  if (kind === 'webjs') {
    const js = file || 'main.js';
    files[js] = code;
    if (!files['index.html']) {
      files['index.html'] = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#111;color:#eee;font-family:system-ui,sans-serif}canvas{display:block}</style></head><body><canvas id="canvas" width="800" height="600"></canvas><canvas id="game" width="800" height="600" style="display:none"></canvas><script src="${js}"></script></body></html>`;
    }
    return { kind, file, lines: code.split('\n').length, spec: { files, entry: 'index.html', models: convModels() } };
  }
  const entry = file || 'main.' + LANG_EXT[kind];
  files[entry] = code;
  return { kind, file, lines: code.split('\n').length, spec: { lang: kind, files, entry } };
}

// Modelle des aktuellen Chats für Spiele bereitstellen
function convModels() {
  const c = currentConv();
  return (c && c.models) || {};
}

function runFromBlock(cb, attempt = 0) {
  const conv0 = currentConv();
  RUN.origin = conv0 ? { convId: conv0.id, attempt, file: cb.dataset.file || '', lang: cb.dataset.lang || '' } : null;
  RUN.pipTried = new Set();
  const s = specFromBlock(cb);
  if (!s) return toast('Diesen Code kann FORGE nicht direkt ausführen.', 'err');
  const title = (conv0 && conv0.title) || s.file || LANG_NAME[s.kind];
  if (s.kind === 'web' || s.kind === 'webjs') return runWeb(s.spec, title, s.kind);
  runProgram(s.spec, title);
}

// ======================================================================
//        Coder bestellt 3D-Modelle beim 3D-Designer
// ======================================================================
const modelKey = (n) =>
  String(n || 'modell')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9äöüß_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'modell';

function parseOrder(text) {
  const get = (k) => (new RegExp('^\\s*(?:' + k + ')\\s*:\\s*(.+)$', 'im').exec(text) || [])[1] || '';
  const name = get('name');
  let description = get('beschreibung|description|was|aussehen');
  if (!description) description = text.replace(/^\s*name\s*:.*$/im, '').trim();
  return { key: modelKey(name || description.split(/\s+/)[0]), name: name || description.split(/\s+/)[0], description: description.slice(0, 600), style: get('stil|style'), size: get('größe|groesse|hoehe|höhe|size') };
}

function ordersIn(content) {
  const out = [];
  const re = /```forge-modell?\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(content))) {
    const o = parseOrder(m[1]);
    if (!out.some((x) => x.key === o.key)) out.push(o);
  }
  return out.slice(0, 6);
}

// Ein Modell ohne den 3D-Tab bauen (gleiche Qualität: Baupläne, Beispiele, Andocken)
async function buildModelHeadless(order, onLine) {
  const shots = [];
  for (const ex of examplesFor(order.description + ' ' + order.style)) {
    shots.push({ role: 'user', content: `Baue dieses 3D-Modell: ${ex.split('\n')[0].replace(/^name:\s*/, '')}` });
    shots.push({ role: 'assistant', content: ex });
  }
  const userMsg = `Baue dieses 3D-Modell: ${order.description}\n${order.style ? `Stil: ${order.style}\n` : ''}${DETAIL_LEVELS[2]}\nDas Modell wird in einem Spiel benutzt: Es steht auf dem Boden (y = 0) und schaut nach vorne (+z).\nWenn ein Bauplan (template) passt, fang damit an und ergänze danach Details, die genau an den angegebenen Punkten sitzen.`;
  let maxTokens = DETAIL_TOKENS[2] || 1800;
  const dbgMax = Number(load('forge.debugMaxTokens', 0)); // nur für Tests
  if (dbgMax) maxTokens = Math.min(maxTokens, dbgMax);
  let text = '';
  const res = await forge.chat(
    uid(),
    { messages: [{ role: 'system', content: model3dSystemPrompt() }, ...shots, { role: 'user', content: userMsg }], temperature: 0.45, gbnf: MODEL_GRAMMAR, maxTokens, bot: 'design' },
    (d) => {
      if (d.text) {
        text += d.text;
        if (onLine && d.text.includes('\n')) onLine(text.split('\n').filter((l) => l.includes('|')).length);
      }
    }
  );
  if (res && res.aborted) return null;
  let raw = parseModelText(text);
  if (!raw.parts.length) return null;
  if (!raw.name || raw.name === 'Modell') raw.name = order.name;
  return finishModel(raw, text).model;
}

// Nach einer Coder-Antwort: bestellte Modelle bauen (bevor geprüft oder gestartet wird)
async function buildOrders(conv, ai, el, force = null) {
  const orders = ordersIn(ai.content).filter((o) => force ? o.key === force : !(conv.models && conv.models[o.key]));
  if (!orders.length) return;
  conv.models = conv.models || {};
  const redraw = () => el.isConnected && fillAi(el, ai, true, conv.messages[conv.messages.length - 1] === ai);
  for (const o of orders) {
    S.building[o.key] = 'Der 3D-Designer baut das Modell …';
    redraw();
    try {
      const m = await buildModelHeadless(o, (n) => {
        S.building[o.key] = `Der 3D-Designer baut das Modell … ${n} Teile`;
        redraw();
      });
      if (m) {
        conv.models[o.key] = { ...m, name: m.name || o.name };
        saveToLibrary(m, `Für den Coder: ${o.description}`);
      } else toast(`Modell „${o.key}“ konnte nicht gebaut werden – das Spiel nutzt einen Platzhalter.`, 'err');
    } catch (err) {
      toast(`Modell „${o.key}“: ${err.message || err}`, 'err');
    }
    delete S.building[o.key];
    saveConvs();
    redraw();
  }
}

// ======================================================================
//        Selbstprüfung: Code prüfen, bevor er gestartet wird
// ======================================================================
const MAX_CHECK = 2;
const CHECKABLE = { python: 'python', javascript: 'javascript', typescript: 'typescript', web: 'web', webjs: 'web' };

// Welche Codeblöcke einer Antwort sind „richtige“ Programme? (mit Dateinamen oder groß genug – keine Schnipsel)
function checkSpecs(el) {
  const out = [];
  const seen = new Set();
  const blocks = $$('.codeblock', el);
  for (const cb of blocks) {
    const s = specFromBlock(cb);
    if (!s || !CHECKABLE[s.kind]) continue;
    const ck = CHECKABLE[s.kind];
    if (!s.file && s.lines < 8) continue;
    const key = ck === 'web' ? 'web|' + s.spec.entry + '|' + (s.file || s.lines) : ck;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: ck, files: s.spec.files, entry: s.spec.entry, models: s.spec.models });
  }
  return out;
}

// Fehlermeldungen für Menschen (die KI bekommt das Original)
function problemText(p) {
  let m = String(p.msg);
  m = m
    .replace(/^undefined name '(.+)'$/, '„$1“ ist nirgends definiert')
    .replace(/^local variable '(.+)' defined .* referenced before assignment$/, '„$1“ wird benutzt, bevor es einen Wert hat')
    .replace(/^(\w*Error): (.+) is not defined$/, '$1: „$2“ ist nicht definiert')
    .replace(/^'return' outside function$/, '„return“ steht außerhalb einer Funktion');
  return `${p.file ? p.file : ''}${p.line ? ' Zeile ' + p.line : ''}${p.file || p.line ? ': ' : ''}${m}`;
}

async function selfCheck(conv, ai, el, round) {
  const specs = checkSpecs(el);
  if (!specs.length) return null;
  ai.check = { status: 'running', round };
  fillAi(el, ai, true, true);
  const errors = [];
  const missing = [];
  const checked = new Set();
  const skipped = new Set();
  for (const spec of specs) {
    const r = await forge.run.check(spec);
    (r.checked || []).forEach((c) => checked.add(c));
    (r.skipped || []).forEach((c) => skipped.add(c));
    for (const p of r.problems || []) (p.kind === 'missing' ? missing : errors).push(p);
  }
  ai.check = { status: errors.length ? 'problems' : checked.size ? 'ok' : 'skipped', errors, missing, checked: [...checked], skipped: [...skipped], round };
  const auto = errors.length && S.settings.autoFix !== false && round < MAX_CHECK && currentConv() && currentConv().id === conv.id && !S.busy;
  if (auto) ai.check.fixing = true;
  saveConvs();
  if (el.isConnected) fillAi(el, ai, true, conv.messages[conv.messages.length - 1] === ai);
  if (!auto) return null;
  return fixCheckProblems(ai, round + 1);
}

function fixCheckProblems(ai, round) {
  const list = (ai.check.errors || [])
    .slice(0, 12)
    .map((p) => `${p.file || 'Code'}${p.line ? ' Zeile ' + p.line : ''}: ${p.msg}`)
    .join('\n');
  const text = `🔍 Selbstprüfung: In deinem Code wurden Fehler gefunden, bevor er gestartet wurde:\n\`\`\`\n${list}\n\`\`\`\nBehebe genau diese Fehler und gib den KOMPLETTEN korrigierten Code aus (alle Dateien, gleiche Dateinamen).`;
  return sendMessage(false, { text, auto: true, kind: 'check', attempt: round, checkRound: round });
}

function checkHtml(m) {
  const c = m.check;
  if (!c) return '';
  if (c.status === 'running') return `<div class="selfcheck run"><span class="spinner"></span>🔍 Prüft den Code, bevor du ihn startest (Syntax, Namen, Testlauf) …</div>`;
  const miss = c.missing && c.missing.length ? `<div class="check-miss">📦 ${esc([...new Set(c.missing.map((p) => p.module))].join(', '))} wird beim ersten Start automatisch installiert.</div>` : '';
  if (c.status === 'ok') return `<div class="selfcheck ok">✓ Selbstprüfung bestanden <span>· ${esc(c.checked.join(', '))}</span>${miss}</div>`;
  if (c.status === 'skipped') return c.skipped.length ? `<div class="selfcheck muted">Nicht geprüft: ${esc(c.skipped.join(' · '))}</div>` : '';
  const items = c.errors
    .slice(0, 8)
    .map((p) => `<li>${esc(problemText(p))}</li>`)
    .join('');
  return `<div class="selfcheck bad"><b>⚠ Selbstprüfung: ${c.errors.length} ${c.errors.length === 1 ? 'Fehler' : 'Fehler'} gefunden – noch bevor du startest</b><ul>${items}</ul>${
    c.fixing ? '<div class="check-next">🔧 Die KI behebt das automatisch – siehe unten ↓</div>' : '<button class="btn sm primary" data-act="fixcheck">🔧 Von der KI beheben lassen</button>'
  }${miss}</div>`;
}

async function runWeb(spec, title, lang = 'web') {
  stopRun();
  resetRunErrors();
  RUN.spec = { kind: 'web', spec, title, lang };
  const { url } = await forge.run.preview(spec);
  RUN.url = url;
  rpShow('web', lang, title);
  rpStatus('lädt …');
  $('#rpFrame').src = url;
  setTimeout(() => $('#rpFrame').focus(), 300);
}

async function getRuntimes(force) {
  if (!RUN.runtimes || force) RUN.runtimes = await forge.run.runtimes(!!force);
  return RUN.runtimes;
}

function confirmBox(title, html, ok = 'OK', withRemember = false) {
  return new Promise((resolve) => {
    $('#confirmBody').innerHTML = `<h2>${esc(title)}</h2>${html}
      ${withRemember ? '<label class="remember"><input type="checkbox" id="cfRemember"> Nicht mehr fragen</label>' : ''}
      <div class="actions"><button class="btn ghost" data-c="0">Abbrechen</button><button class="btn primary" data-c="1">${esc(ok)}</button></div>`;
    $('#confirm').hidden = false;
    const done = (v) => {
      const rem = withRemember && $('#cfRemember') && $('#cfRemember').checked;
      $('#confirm').hidden = true;
      resolve(v ? { ok: true, remember: rem } : null);
    };
    $('#confirmBody').onclick = (e) => {
      const b = e.target.closest('[data-c]');
      if (b) done(b.dataset.c === '1');
    };
  });
}

async function runProgram(spec, title, rerun = false) {
  const rts = await getRuntimes();
  const rt = rts[spec.lang];
  stopRun();
  resetRunErrors();
  RUN.spec = { kind: 'proc', spec, title };
  rpShow('proc', spec.lang, title);
  if (!rt || !rt.available) return showMissing(spec.lang, rt);
  if (!S.settings.runTrusted && !rerun && !(RUN.origin && RUN.origin.attempt)) {
    const r = await confirmBox(
      'Programm ausführen?',
      `<p>Dieser ${esc(LANG_NAME[spec.lang])}-Code läuft direkt auf deinem PC – wie jedes andere Programm. Führe nur Code aus, dem du vertraust. Spiele und Webseiten (HTML) laufen dagegen abgeschottet in der Vorschau.</p>`,
      'Ausführen',
      true
    );
    if (!r) {
      rpStatus('abgebrochen');
      return;
    }
    if (r.remember) {
      S.settings.runTrusted = true;
      saveSettings();
    }
  }
  const id = uid();
  RUN.id = id;
  rpStatus('läuft …', 'run');
  $('#rpInput').disabled = false;
  $('#rpInput').focus();
  const res = await forge.run.start({ id, ...spec });
  if (!res.ok) {
    RUN.id = null;
    if (res.error.startsWith('MISSING:')) return showMissing(spec.lang, rt);
    rpWrite('stderr', res.error + '\n');
    rpStatus('Fehler', 'err');
  }
}

function showMissing(lang, rt) {
  const name = LANG_NAME[lang] || lang;
  $('#rpMsg').hidden = false;
  $('#rpMsg').innerHTML = `<div class="rp-missing"><div class="rp-big">🧩</div><h3>${esc(name)} ist auf deinem PC nicht installiert</h3>
    <p>Damit FORGE ${esc(name)}-Code ausführen kann, muss ${esc(name)} einmal installiert werden.${rt && rt.winget ? ' Mit einem Klick geht das automatisch über Windows (winget).' : ''}</p>
    <div class="actions" style="justify-content:center">
      ${rt && rt.winget ? `<button class="btn primary" data-m="install">${esc(name)} installieren</button>` : rt && rt.url ? `<button class="btn primary" data-m="install">Download-Seite öffnen</button>` : ''}
      <button class="btn" data-m="recheck">Nochmal prüfen</button>
    </div>
    ${RUN.origin && lang !== 'python' ? `<div class="actions" style="justify-content:center;margin-top:10px"><button class="btn primary" data-m="rewrite">🔁 Ohne Installation: von der KI in Python/HTML umschreiben lassen</button></div>` : ''}
    <p class="muted small">Tipp: HTML, JavaScript und Python laufen in FORGE immer sofort – ohne Installation.</p></div>`;
  rpStatus('fehlt', 'err');
  $('#rpMsg').onclick = async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'rewrite') {
      if (S.busy) return toast('Die KI schreibt gerade noch – versuch es gleich nochmal.', 'err');
      const o = RUN.origin;
      const res = await sendMessage(false, { text: `🔁 ${name} ist auf meinem PC nicht installiert. Schreib das Programm bitte so um, dass es in FORGE ohne Installation läuft – als Python-Programm oder, wenn es eine Oberfläche/ein Spiel ist, als eine HTML-Datei. Gib den kompletten Code aus.` });
      runAnswer(res, { ...o, file: '', lang: '' }, 0);
    } else if (b.dataset.m === 'install') {
      await forge.run.install(lang);
      toast('Installation gestartet – danach auf „Nochmal prüfen“ klicken', 'ok');
    } else {
      b.disabled = true;
      b.textContent = 'Prüfe …';
      const rts = await getRuntimes(true);
      if (rts[lang] && rts[lang].available) {
        toast(`${name} gefunden!`, 'ok');
        runProgram(RUN.spec.spec, RUN.spec.title);
      } else {
        b.disabled = false;
        b.textContent = 'Nochmal prüfen';
        toast(`${name} noch nicht gefunden. Nach der Installation hilft manchmal ein Neustart von FORGE.`, 'err');
      }
    }
  };
}

function stopRun() {
  if (RUN.id) forge.run.stop(RUN.id);
  RUN.id = null;
  if (RUN.mode === 'web') $('#rpFrame').src = 'about:blank';
}

forge.run.onEvent((id, type, data) => {
  if (id !== RUN.id) return;
  if (type === 'prep') {
    if (data.phase === 'download') rpStatus(`Python wird eingerichtet … ${data.pct || 0} %`, 'run');
    else if (data.phase === 'extract') rpStatus('Python wird entpackt …', 'run');
    else if (data.phase === 'ready') rpStatus('läuft …', 'run');
  } else if (type === 'out') {
    rpWrite(data.stream, data.text);
    // Fehlendes Python-Paket? Automatisch installieren und neu starten (einmal pro Paket)
    const m = data.stream === 'stderr' && /No module named '([\w.]+)'/.exec(data.text);
    if (m && RUN.spec && RUN.spec.spec && RUN.spec.spec.lang === 'python') autoPip(m[1].split('.')[0]);
  } else if (type === 'exit') {
    RUN.id = null;
    $('#rpInput').disabled = true;
    if (data.pip) {
      if (data.code === 0) {
        rpWrite('info', `\n✓ ${data.pip} installiert – starte das Programm neu …\n`);
        setTimeout(() => runProgram(RUN.spec.spec, RUN.spec.title, true), 600);
      } else {
        rpWrite('stderr', `\nInstallation von ${data.pip} fehlgeschlagen.\n`);
        runFailed();
      }
      return;
    }
    if (RUN.pipPending) return; // gleich kommt die automatische Installation
    const ok = data.code === 0;
    rpStatus(data.compileFailed ? 'Kompilieren fehlgeschlagen' : ok ? 'fertig' : RUN.userStop ? 'gestoppt' : `beendet (Code ${data.code ?? data.signal})`, ok ? 'ok' : 'err');
    rpWrite('info', `\n— Programm beendet${ok ? '' : ' mit Code ' + (data.code ?? data.signal)} —\n`);
    if (ok) S.repairCount = 0;
    else if (!RUN.userStop && (RUN.errText.trim() || data.compileFailed)) runFailed();
  }
});

function resetRunErrors() {
  RUN.errText = '';
  RUN.userStop = false;
  RUN.failed = false;
  RUN.pipPending = null;
  clearTimeout(RUN.webFailT);
}

// Fehlendes Python-Modul automatisch nachinstallieren (ohne Nachfrage)
function autoPip(module) {
  RUN.pipTried = RUN.pipTried || new Set();
  if (RUN.pipPending || RUN.pipTried.has(module) || ['tkinter', 'turtle', '_tkinter'].includes(module)) return;
  RUN.pipTried.add(module);
  RUN.pipPending = module;
  const runId = RUN.id;
  const go = async () => {
    if (RUN.id === runId && runId) await forge.run.stop(runId);
    const id = uid();
    RUN.id = id;
    RUN.errText = '';
    rpStatus(`installiere ${module} …`, 'run');
    const r = await forge.run.pip(id, module);
    RUN.pipPending = null;
    if (!r.ok) {
      rpWrite('stderr', r.error + '\n');
      runFailed();
    }
  };
  setTimeout(go, 150);
}

// Web-Vorschau: Fehler sammeln und kurz danach als „fehlgeschlagen“ werten
function scheduleWebFailure() {
  if (RUN.failed || RUN.webFailT) return;
  RUN.webFailT = setTimeout(() => {
    RUN.webFailT = null;
    if (RUN.mode === 'web' && RUN.errText.trim()) runFailed();
  }, 2500);
}

// ---------- Automatische Reparatur: Fehler zurück an die KI, korrigierten Code neu starten ----------
const MAX_REPAIR = 2;
function runFailed() {
  if (RUN.failed) return;
  RUN.failed = true;
  const o = RUN.origin;
  const conv = currentConv();
  const canRepair = o && conv && conv.id === o.convId && botOf(conv) !== 'chat';
  if (!canRepair) return;
  const attempt = (o.attempt || 0) + 1;
  if (S.settings.autoFix !== false && attempt <= MAX_REPAIR && !S.busy) {
    rpWrite('info', `\n🔧 Die KI repariert den Fehler automatisch (Versuch ${attempt}/${MAX_REPAIR}) …\n`);
    rpStatus('KI repariert …', 'run');
    repairWithAi(attempt);
  } else offerRepair(attempt);
}

function offerRepair(attempt) {
  rpFlush();
  if ($('#rpOut .repair-offer')) return;
  const b = document.createElement('button');
  b.className = 'btn sm primary repair-offer';
  b.textContent = '🔧 Fehler von der KI beheben lassen';
  b.onclick = () => {
    b.remove();
    repairWithAi(Math.min(attempt, MAX_REPAIR));
  };
  $('#rpOut').appendChild(b);
  $('#rpOut').scrollTop = $('#rpOut').scrollHeight;
}

async function repairWithAi(attempt) {
  if (S.busy) return toast('Die KI schreibt gerade noch – versuch es gleich nochmal.', 'err');
  const o = RUN.origin || {};
  const err = RUN.errText.trim().split('\n').slice(-40).join('\n').slice(-3000) || '(keine Fehlermeldung, Programm ist abgestürzt)';
  const where = o.file ? ` von **${o.file}**` : '';
  const text = `🔧 Beim Ausführen${where} kam dieser Fehler:\n\`\`\`\n${err}\n\`\`\`\nFinde die Ursache, behebe sie und gib den KOMPLETTEN korrigierten Code aus.`;
  const res = await sendMessage(false, { text, attempt, auto: true });
  runAnswer(res, o, attempt);
}

// Code aus einer KI-Antwort gleich starten (nach Reparatur oder Umschreiben)
function runAnswer(res, o, attempt) {
  if (!res || !res.ai || res.ai.error || res.ai.stopped) return;
  const blocks = $$('.codeblock', res.el).filter((cb) => runKind(cb.dataset.lang, $('code', cb).textContent, cb.dataset.file ? cb.dataset.file.split(/[\\/]/).pop() : ''));
  const same = blocks.find((cb) => o.file && cb.dataset.file === o.file) || blocks.find((cb) => o.lang && cb.dataset.lang === o.lang) || blocks[0];
  if (same) {
    toast(attempt ? `🔧 Korrigierter Code – starte neu (Versuch ${attempt}/${MAX_REPAIR})` : '▶ Starte den neuen Code …', 'ok');
    runFromBlock(same, attempt);
  }
}

// Meldungen aus der Vorschau (console.log, Fehler)
window.addEventListener('message', (e) => {
  if (!e.data || !e.data.__forge || e.source !== $('#rpFrame').contentWindow) return;
  if (e.data.type === 'ready') return rpStatus('läuft', 'ok');
  rpWrite(e.data.type, e.data.text);
});
$('#rpFrame').addEventListener('load', () => {
  if (RUN.mode === 'web' && $('#rpFrame').src !== 'about:blank') rpStatus('läuft', 'ok');
});

$('#rpIn').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#rpInput').value;
  if (!RUN.id) return;
  forge.run.input(RUN.id, v);
  rpWrite('input', v + '\n');
  $('#rpInput').value = '';
});
$('#rpClear').addEventListener('click', rpClear);
$('#rpConHead').addEventListener('click', (e) => {
  if (e.target.closest('button') || RUN.mode !== 'web') return;
  $('#runPanel').classList.toggle('con-open');
});
$('#rpRestart').addEventListener('click', () => {
  const r = RUN.spec;
  if (!r) return;
  if (r.kind === 'web') runWeb(r.spec, r.title, r.lang);
  else runProgram(r.spec, r.title);
});
$('#rpStop').addEventListener('click', () => {
  RUN.userStop = true;
  if (RUN.id) forge.run.stop(RUN.id);
});
$('#rpClose').addEventListener('click', () => {
  stopRun();
  $('#runPanel').hidden = true;
  $('#runPanel').classList.remove('max', 'con-open');
});
$('#rpFull').addEventListener('click', () => {
  if (RUN.mode === 'web') {
    const f = $('#rpFrame');
    if (f.requestFullscreen) f.requestFullscreen().catch(() => $('#runPanel').classList.toggle('max'));
  } else $('#runPanel').classList.toggle('max');
});
$('#rpWindow').addEventListener('click', () => RUN.url && forge.run.previewWindow(RUN.url));
$('#rpOpen').addEventListener('click', async () => {
  const f = await forge.run.openFile();
  if (!f) return;
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const kind = EXT_LANG[ext];
  if (!kind) return toast('Diesen Dateityp kann FORGE nicht ausführen.', 'err');
  if (kind === 'web') return runWeb({ files: {}, entry: f.name, baseDir: f.dir }, f.name);
  runProgram({ lang: kind, files: {}, entry: f.name, cwd: f.dir }, f.name);
});
// Panel-Breite mit der Maus ändern
$('#rpDrag').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const panel = $('#runPanel');
  const total = $('#codeView').clientWidth;
  document.body.classList.add('resizing');
  const move = (ev) => {
    const right = $('#codeView').getBoundingClientRect().right;
    const w = Math.min(Math.max(right - ev.clientX, 320), total - 380);
    panel.style.width = w + 'px';
  };
  const up = () => {
    document.body.classList.remove('resizing');
    store('forge.rpWidth', parseInt(panel.style.width, 10));
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
});

// ======================================================================
//                                3D-MODUS
// ======================================================================
const STYLES = ['Low-Poly', 'Sci-Fi', 'Mittelalter', 'Cartoon', 'Steampunk', 'Realistisch'];
const EXAMPLES3D = [
  'Ein Kampf-Mech mit zwei Schulterkanonen und leuchtendem Cockpit',
  'Eine mittelalterliche Burg mit vier Türmen und Tor',
  'Ein kleines Raumschiff mit Triebwerken und Flügeln',
  'Ein Schwert mit leuchtender blauer Klinge',
  'Ein Baum mit dicker Krone und Pilzen am Stamm',
  'Ein Sportwagen in Rot',
];

function init3DPanel() {
  $('#styleChips').innerHTML = STYLES.map((s) => `<button class="chip-t" data-s="${s}">${s}</button>`).join('');
  $('#styleChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-t');
    if (!b) return;
    const s = b.dataset.s;
    if (S.styles.has(s)) S.styles.delete(s);
    else S.styles.add(s);
    b.classList.toggle('on', S.styles.has(s));
  });
  $('#examples3d').innerHTML = EXAMPLES3D.map((x) => `<button class="ex">${esc(x)}</button>`).join('');
  $('#examples3d').addEventListener('click', (e) => {
    const b = e.target.closest('.ex');
    if (!b) return;
    $('#prompt3d').value = b.textContent;
    generate3D();
  });
  $('#detailSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.detail = +b.dataset.v;
    $$('#detailSeg button').forEach((x) => x.classList.toggle('active', x === b));
  });
  $('#gen3dBtn').addEventListener('click', () => generate3D());
  $('#prompt3d').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate3D();
  });
  $('#edit3dBtn').addEventListener('click', () => {
    const t = $('#edit3d').value.trim();
    if (t) generate3D(t);
  });
  $('#edit3d').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const t = $('#edit3d').value.trim();
      if (t) generate3D(t);
    }
  });

  // Werkzeuge
  $('#tRotate').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('active');
    e.currentTarget.classList.toggle('active', on);
    ensureViewer().setAutoRotate(on);
  });
  $('#tWire').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('active');
    e.currentTarget.classList.toggle('active', on);
    ensureViewer().setWireframe(on);
  });
  $('#tGrid').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('active');
    e.currentTarget.classList.toggle('active', on);
    ensureViewer().setGrid(on);
  });
  $('#tFrame').addEventListener('click', () => ensureViewer().frame());
  $('#tShot').addEventListener('click', async () => {
    const v = ensureViewer();
    if (!v.model) return toast('Erst ein Modell erzeugen', 'err');
    const url = v.screenshot();
    const bin = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
    const r = await forge.saveFile({ name: fileBase() + '.png', data: bin, filters: [{ name: 'PNG-Bild', extensions: ['png'] }] });
    if (r.ok) toast('Screenshot gespeichert', 'ok');
  });

  // Export
  $('#vpExport').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-exp]');
    if (!b) return;
    const v = ensureViewer();
    if (!v.model) return toast('Erst ein Modell erzeugen', 'err');
    const kind = b.dataset.exp;
    try {
      let data;
      let filters;
      if (kind === 'glb') {
        data = await v.toGLB();
        filters = [{ name: 'glTF Binary', extensions: ['glb'] }];
      } else if (kind === 'stl') {
        data = v.toSTL();
        filters = [{ name: 'STL', extensions: ['stl'] }];
      } else if (kind === 'obj') {
        data = v.toOBJ();
        filters = [{ name: 'Wavefront OBJ', extensions: ['obj'] }];
      } else {
        data = JSON.stringify(v.model, null, 2);
        filters = [{ name: 'FORGE-Modell (JSON)', extensions: ['json'] }];
      }
      const r = await forge.saveFile({ name: `${fileBase()}.${kind}`, data, filters });
      if (r.ok) toast(`${kind.toUpperCase()} gespeichert`, 'ok');
      else if (r.error) toast(r.error, 'err');
    } catch (err) {
      toast('Export fehlgeschlagen: ' + err.message, 'err');
    }
  });
  $('#importJsonBtn').addEventListener('click', () => $('#importJson').click());
  $('#importJson').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const model = normalizeModel(JSON.parse(await f.text()));
      showModel(model);
      saveToLibrary(model, '(importiert)');
      toast('Modell geladen', 'ok');
    } catch (err) {
      toast('Konnte Datei nicht laden: ' + err.message, 'err');
    }
  });

  // Teile-Liste: Hover hebt Teil hervor
  $('#partsList').addEventListener('mouseover', (e) => {
    const p = e.target.closest('.part');
    if (p && S.viewer) S.viewer.highlight(+p.dataset.i);
  });
  $('#partsList').addEventListener('mouseleave', () => S.viewer && S.viewer.highlight(null));
}

function fileBase() {
  const n = S.viewer?.model?.name || 'modell';
  return n.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').toLowerCase() || 'modell';
}

function ensureViewer() {
  if (!S.viewer) S.viewer = new Viewer3D($('#viewport'));
  return S.viewer;
}

// Fertiges KI-Modell: säubern, lose Teile andocken, Quelltext (mit Bauplänen) für spätere Änderungen merken
function finishModel(raw, text) {
  let m = normalizeModel(raw);
  const snap = snapFloatingParts(m);
  m = snap.model;
  if (text) m.source = modelSource(m, text);
  return { model: m, moved: snap.moved };
}

function showModel(model, keepCamera = false) {
  const v = ensureViewer();
  v.setModel(model, { keepCamera });
  $('#vpEmpty').hidden = true;
  $('#vpTitle').textContent = model.name;
  $('#editBox').hidden = false;
  $('#partsBox').hidden = false;
  const total = model.parts.reduce((n, p) => n + (p.mirrorX ? 2 : 1), 0);
  $('#partCount').textContent = `(${total})`;
  $('#partsList').innerHTML = model.parts
    .map(
      (p, i) =>
        `<div class="part" data-i="${i}"><span class="sw" style="background:${esc(p.color)}"></span><span class="n">${esc(p.name)}${p.mirrorX ? ' ×2' : ''}</span><span class="k">${esc(p.shape)}</span></div>`
    )
    .join('');
}

function saveToLibrary(model, prompt) {
  const entry = { id: uid(), name: model.name, prompt, model, updated: Date.now() };
  S.models.unshift(entry);
  S.modelId = entry.id;
  saveModels();
  renderSideList();
}

function openSavedModel(id) {
  const m = S.models.find((x) => x.id === id);
  if (!m) return;
  S.modelId = id;
  try {
    showModel(normalizeModel(m.model));
  } catch (err) {
    toast(err.message, 'err');
  }
  if (m.prompt && !m.prompt.startsWith('(')) $('#prompt3d').value = m.prompt;
  renderSideList();
}

function newModel() {
  S.modelId = null;
  if (S.viewer) S.viewer.clear();
  $('#vpEmpty').hidden = false;
  $('#vpTitle').textContent = '';
  $('#editBox').hidden = true;
  $('#partsBox').hidden = true;
  $('#prompt3d').value = '';
  $('#prompt3d').focus();
  renderSideList();
}

// ---------- 3D: Bild nachbauen ----------
async function setImg3d(file) {
  try {
    S.img3d = await prepareImage(file);
    renderImg3d();
    toast('📷 Bild geladen – klick auf „Modell erzeugen“, die KI baut es nach.', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}
function renderImg3d() {
  const im = S.img3d;
  $('#img3dBtn').hidden = !!im;
  $('#img3dPrev').hidden = !im;
  $('#refImg').hidden = !im;
  if (!im) return;
  $('#img3dPrev img').src = im.thumb;
  $('#img3dPrev b').textContent = im.name;
  $('#img3dPrev span').innerHTML = `Die KI baut das Bild nach <span class="pal">${im.palette.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
  $('#refImg').src = im.thumb;
}
$('#img3dBtn').addEventListener('click', () => $('#img3dInput').click());
$('#img3dInput').addEventListener('change', (e) => {
  if (e.target.files[0]) setImg3d(e.target.files[0]);
  e.target.value = '';
});
$('#img3dDel').addEventListener('click', () => {
  S.img3d = null;
  renderImg3d();
});
{
  const v3 = $('#view3d');
  v3.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      $('#img3dBox').classList.add('drop');
    }
  });
  v3.addEventListener('dragleave', (e) => {
    if (!v3.contains(e.relatedTarget)) $('#img3dBox').classList.remove('drop');
  });
  v3.addEventListener('drop', (e) => {
    $('#img3dBox').classList.remove('drop');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    setImg3d(f);
  });
  // Strg+V: Bild aus der Zwischenablage (3D-Tab → nachbauen, Chat → anhängen)
  document.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData ? e.clipboardData.files : [])].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    if (S.mode === '3d') setImg3d(f);
    else addFiles([f]);
  });
}

async function generate3D(editInstruction) {
  if (S.busy) return;
  let prompt = $('#prompt3d').value.trim();
  const image = !editInstruction ? S.img3d : null;
  if (!editInstruction && !prompt && !image) {
    $('#prompt3d').focus();
    return toast('Beschreib zuerst, was gebaut werden soll – oder gib der KI ein Bild', 'err');
  }
  const viewer = ensureViewer();
  const before = editInstruction ? viewer.model : null;
  let userMsg;
  let maxTokens;
  // Beispiele passend zur Anfrage (z. B. Roblox-Figur → Figur-Beispiel) als echte Gesprächsrunden
  const shots = [];
  if (editInstruction) {
    if (!before) return;
    const src = before.source || modelToText(before);
    userMsg = `Hier ist das aktuelle Modell:\n${src}\n\nÄnderungswunsch: ${editInstruction}\n\nGib das KOMPLETTE geänderte Modell im FORGE-Format zurück (alle Zeilen, auch die unveränderten). template-Zeilen bleiben template-Zeilen – ändere dort nur die Werte.`;
    maxTokens = Math.min(6000, 400 + src.split('\n').length * 70);
  } else {
    const styles = [...S.styles].join(', ');
    // Bild? Erst ansehen lassen, dann nach der Beschreibung bauen
    let picture = '';
    if (image) {
      setBusy(true);
      $('#gen3dStatus').hidden = false;
      $('#genPlan').textContent = '';
      const r = await describeImage(image, 'model3d', prompt, (t) => ($('#genText').textContent = t));
      setBusy(false);
      if (r && r.text) picture = r.text;
      else {
        toast('Bild: ' + ((r && r.error) || 'konnte nicht angesehen werden'), 'err');
        if (!prompt) {
          $('#gen3dStatus').hidden = true;
          return;
        }
      }
    }
    for (const ex of examplesFor(picture + ' ' + prompt + ' ' + styles)) {
      shots.push({ role: 'user', content: `Baue dieses 3D-Modell: ${ex.split('\n')[0].replace(/^name:\s*/, '')}` });
      shots.push({ role: 'assistant', content: ex });
    }
    userMsg = picture
      ? `Baue dieses 3D-Modell nach einem Bild nach. So sieht das Bild aus (FORGE hat es sich angesehen):\n${picture}\nHauptfarben im Bild: ${image.palette.join(' ')}\n${prompt ? `Wunsch dazu: ${prompt}\n` : ''}${styles ? `Stil: ${styles}\n` : ''}${DETAIL_LEVELS[S.detail]}\nHalte dich genau an Teile, Proportionen und Farben aus der Beschreibung. Wenn ein Bauplan (template) passt (Figur, Auto, Haus, Tier …), fang damit an und nimm die Farben aus dem Bild.`
      : `Baue dieses 3D-Modell: ${prompt}\n${styles ? `Stil: ${styles}\n` : ''}${DETAIL_LEVELS[S.detail]}\nWenn ein Bauplan (template) passt, fang damit an und ergänze danach Details, die genau an den angegebenen Punkten sitzen.`;
    if (picture) $('#genPlan').textContent = '👁 ' + (picture.split('\n').find((l) => /OBJEKT/i.test(l)) || picture.split('\n')[0]).replace(/^OBJEKT:\s*/i, '');
    if (!prompt) prompt = 'Nach Bild: ' + image.name;
    maxTokens = DETAIL_TOKENS[S.detail] || 1800;
  }

  const dbgMax = Number(load('forge.debugMaxTokens', 0)); // nur für Tests
  if (dbgMax) maxTokens = Math.min(maxTokens, dbgMax);

  setBusy(true);
  $('#gen3dStatus').hidden = false;
  $('#genText').textContent = editInstruction ? 'Ändere Modell …' : 'Baue das Modell …';
  if (!image) $('#genPlan').textContent = '';

  // Live-Aufbau: Jedes fertige Teil erscheint sofort in der 3D-Ansicht
  let text = '';
  let shown = 0;
  let framed = !!editInstruction;
  let lastDraw = 0;
  const t0 = performance.now();
  const drawLive = (force) => {
    const now = performance.now();
    if (!force && now - lastDraw < 180) return;
    const done = text.slice(0, text.lastIndexOf('\n') + 1);
    const live = parseModelText(done);
    if (live.parts.length === shown && !force) return;
    if (!live.parts.length) return;
    lastDraw = now;
    shown = live.parts.length;
    try {
      const m = normalizeModel(live);
      showModel(m, framed);
      if (!framed && shown >= 3) {
        viewer.frame();
        framed = true;
      }
    } catch {}
    $('#genText').textContent = `Baue Teile … ${shown}`;
  };

  try {
    const id = uid();
    S.streamId = id;
    const res = await forge.chat(
      id,
      {
        messages: [
          { role: 'system', content: model3dSystemPrompt() },
          ...shots,
          { role: 'user', content: userMsg },
        ],
        temperature: 0.45,
        gbnf: MODEL_GRAMMAR,
        maxTokens,
        bot: 'design',
      },
      (d) => {
        if (d.waiting) $('#genText').textContent = 'KI startet noch …';
        if (d.text) {
          text += d.text;
          if (d.text.includes('\n')) drawLive(false);
        }
      }
    );
    if (res && res.aborted && !text.trim()) {
      toast('Abgebrochen');
      return;
    }
    let raw = parseModelText(text);
    let src = text;
    if (!raw.parts.length) {
      raw = extractJson(text) || raw; // Notfall: falls doch JSON kommt
      src = null;
    }
    const { model: m, moved } = finishModel(raw, src);
    showModel(m, true);
    if (!editInstruction) viewer.frame();
    saveToLibrary(m, editInstruction ? `${prompt} → ${editInstruction}` : prompt);
    if (editInstruction) $('#edit3d').value = '';
    const secs = Math.max(1, Math.round((performance.now() - t0) / 1000));
    toast(`„${m.name}“ fertig – ${m.parts.length} Teile in ${secs} s${moved ? ` · ${moved} lose Teile angedockt` : ''}`, 'ok');
  } catch (err) {
    if (before) showModel(before, true);
    toast(err.message.replace('NO_MODEL: ', ''), 'err');
    if (/NO_MODEL/.test(err.message)) openModels();
  } finally {
    S.streamId = null;
    setBusy(false);
    $('#gen3dStatus').hidden = true;
  }
}

// ======================================================================
//                              Modus & Navigation
// ======================================================================
function setMode(mode) {
  S.mode = mode;
  $$('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#codeView').classList.toggle('active', mode === 'code');
  $('#view3d').classList.toggle('active', mode === '3d');
  if (mode === '3d') ensureViewer();
  renderSideList();
}
$$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#newBtn').addEventListener('click', () => {
  if (S.mode === 'code') {
    if (S.busy) stopStream();
    S.convId = null;
    renderConversation();
    renderSideList();
    $('#input').focus();
  } else newModel();
});
$('#statusBtn').addEventListener('click', () => openModels());
$('#codeModelChip').addEventListener('click', () => openModels());
$('#settingsBtn').addEventListener('click', () => openSettings());

// ======================================================================
//              Automatische Einrichtung & KI-Modelle verwalten
// ======================================================================
S.modelsOpen = false;
S.setupShown = false;
let doneTimer = null;

function hwLine(hw) {
  if (!hw) return '';
  const parts = [];
  if (hw.gpu && hw.gpuName) parts.push(`${esc(hw.gpuName)} · ${String(hw.vramGB).replace('.', ',')} GB VRAM`);
  else parts.push('Keine passende Grafikkarte gefunden, nutze den Prozessor');
  parts.push(`${hw.ramGB} GB RAM`);
  return parts.join(' · ');
}

function etaText(d) {
  if (!d || !d.speed || !d.total) return '';
  const sec = (d.total - d.received) / d.speed;
  if (sec < 60) return 'noch wenige Sekunden';
  const min = Math.round(sec / 60);
  return min < 60 ? `noch ca. ${min} Min.` : `noch ca. ${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

function stepRow(state, title, sub, extra = '') {
  const icon = state === 'done' ? `<span class="st done">${I.check}</span>` : state === 'run' ? '<span class="st run"><span class="spinner"></span></span>' : '<span class="st wait"></span>';
  return `<div class="srow ${state}">${icon}<div class="sbody"><div class="stitle">${title}</div>${sub ? `<div class="ssub">${sub}</div>` : ''}${extra}</div></div>`;
}

function renderEngineOverlay() {
  const st = S.engine;
  if (!st) return;
  const anyInstalled = st.catalog.some((c) => c.installed);
  const firstRun = S.setupShown || (!anyInstalled && st.status !== 'ready');
  const busy = ['detecting', 'downloading', 'loading'].includes(st.status);

  if (S.modelsOpen) {
    $('#setup').hidden = false;
    renderModels();
    return;
  }
  if (st.status === 'error' || (st.status === 'idle' && !st.active && !busy)) {
    $('#setup').hidden = false;
    if (st.status === 'error') renderError();
    else renderModels();
    return;
  }
  if (firstRun && (busy || (st.status === 'ready' && S.setupShown))) {
    S.setupShown = true;
    $('#setup').hidden = false;
    renderAutoSetup();
    if (st.status === 'ready' && !doneTimer) {
      doneTimer = setTimeout(() => {
        S.setupShown = false;
        doneTimer = null;
        if (!S.modelsOpen) $('#setup').hidden = true;
        $('#input').focus();
      }, 1600);
    }
    return;
  }
  $('#setup').hidden = true;
}

function renderAutoSetup() {
  const st = S.engine;
  const d = st.download;
  const order = ['detecting', 'downloading', 'loading', 'ready'];
  const at = order.indexOf(st.status);
  const hwState = at > 0 ? 'done' : 'run';
  const entry = st.catalog.find((c) => (d ? c.id === d.id : st.active ? c.id === st.active.id : c.recommended));
  const dlState = at > 1 ? 'done' : st.status === 'downloading' ? 'run' : 'wait';
  const loadState = st.status === 'ready' ? 'done' : st.status === 'loading' ? 'run' : 'wait';
  const dlExtra =
    st.status === 'downloading' && d
      ? `<div class="progress big"><div style="width:${dlPct(d)}%"></div></div>
         <div class="pstat"><span>${fmtSize(d.received)} / ${fmtSize(d.total)}</span><span>${d.speed ? fmtSize(d.speed) + '/s · ' : ''}${etaText(d)}</span></div>`
      : '';
  const loadExtra = st.status === 'loading' ? `<div class="progress big"><div style="width:${st.loadProgress || 0}%"></div></div>` : '';
  $('#setupBody').innerHTML = `
    <div class="auto-head">
      <svg class="auto-logo" viewBox="0 0 48 48"><defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ff5e1a"/></linearGradient></defs><path d="M24 3 42 13.5v21L24 45 6 34.5v-21Z" fill="none" stroke="url(#lg2)" stroke-width="3" stroke-linejoin="round"/><path d="M24 12c3 5 8 8 8 14a8 8 0 0 1-16 0c0-3 1.5-5 3-6.5 0 3 1.5 4.5 3 5 0-5 2-8.5 2-12.5Z" fill="url(#lg2)"/></svg>
      <div>
        <h2>${st.status === 'ready' ? `${esc(S.settings.aiName)} ist bereit!` : `${esc(S.settings.aiName)} wird eingerichtet`}</h2>
        <p>${st.status === 'ready' ? 'Viel Spaß! Ab jetzt läuft alles offline auf deinem PC.' : 'Das passiert nur beim ersten Start und läuft ganz automatisch. Du musst nichts tun.'}</p>
      </div>
    </div>
    <div class="steps-v">
      ${stepRow(hwState, 'Hardware erkennen', st.hardware ? hwLine(st.hardware) : 'Prüfe Grafikkarte und Arbeitsspeicher …')}
      ${stepRow(dlState, 'KI-Modell herunterladen', entry ? `<b>${esc(entry.title)}</b> (${esc(entry.params)}) · ${fmtSize(entry.size)} · passend zu deinem PC ausgewählt` : 'Wähle das passende Modell …', dlExtra)}
      ${stepRow(loadState, 'KI starten', st.status === 'loading' ? 'Lade das Modell in den Speicher …' : st.status === 'ready' ? 'Läuft!' : '')}
    </div>
    <div class="actions between">
      <span class="muted small">Tipp: Du kannst die App während des Downloads offen lassen. Bricht er ab, geht's beim nächsten Start weiter.</span>
      ${st.status === 'downloading' ? '<button class="btn sm ghost" data-a="models">Anderes Modell</button>' : ''}
    </div>`;
}

function renderError() {
  const st = S.engine;
  $('#setupBody').innerHTML = `
    <h2>Da ist was schiefgelaufen</h2>
    <div class="err-box">${esc(st.error || 'Unbekannter Fehler')}</div>
    ${st.hardware ? `<p class="small" style="margin-top:12px">${hwLine(st.hardware)}</p>` : ''}
    ${st.errorDetail ? `<details class="err-detail"><summary>Technische Details</summary><pre>${esc(st.errorDetail)}</pre></details>` : ''}
    <div class="notice small">Wenn es nicht klappt: Klick auf <b>„Fehlerbericht kopieren“</b> und füg ihn im Chat mit Claude ein (Strg+V).</div>
    <div class="actions between">
      <button class="btn ghost" data-a="copylog">Fehlerbericht kopieren</button>
      <div style="display:flex;gap:8px">
        ${S.update && S.update.status === 'ready' ? `<button class="btn primary" data-a="installupd">Update ${esc(S.update.latest)} installieren</button>` : ''}
        <button class="btn" data-a="models">Anderes Modell wählen</button>
        <button class="btn primary" data-a="retry">Nochmal versuchen</button>
      </div>
    </div>`;
}

function renderModels() {
  const st = S.engine;
  if (!st) return;
  const hw = st.hardware;
  const tab = BOTS[S.modelsTab] ? S.modelsTab : BOTS[st.activeBot] ? st.activeBot : 'chat';
  S.modelsTab = tab;
  const kind = tab === 'chat' ? 'chat' : 'code';
  const current = st.botModels ? st.botModels[tab] : null;
  const tabs = Object.values(BOTS)
    .map((b) => {
      const mid = st.botModels && st.botModels[b.id];
      const e = st.catalog.find((c) => c.id === mid);
      const sub = mid === 'custom' ? 'Eigenes Modell' : e ? `${e.title} · ${e.params}${e.installed ? '' : ' (noch nicht geladen)'}` : '–';
      return `<button class="bot-tab ${b.id === tab ? 'active' : ''}" data-a="tab" data-id="${b.id}" style="--bot:${b.color}"><span class="bot-ic">${b.icon}</span><b>${esc(b.name)}</b><span>${esc(sub)}</span></button>`;
    })
    .join('');
  // Passende Modelle + alles, was schon auf dem PC liegt (Bots dürfen sich Modelle teilen)
  const cards = st.catalog
    .filter((c) => c.kind === kind || c.installed || c.id === current)
    .sort((a, b) => (b.id === current) - (a.id === current) || b.installed - a.installed)
    .map((c) => {
      let actions;
      const isCurrent = c.id === current;
      if (c.downloading) {
        const d = st.download;
        actions = `<div class="progress"><div style="width:${dlPct(d)}%"></div></div>
          <div class="pstat"><span>${fmtSize(d.received)} / ${fmtSize(d.total)}</span><span>${etaText(d)}</span></div>
          <button class="btn sm" data-a="cancel">Abbrechen</button>`;
      } else if (isCurrent) {
        actions = `<button class="btn sm" disabled>${c.active ? 'Läuft gerade' : c.installed ? 'Ausgewählt' : 'Ausgewählt – lädt beim ersten Benutzen'}</button>`;
      } else if (c.installed) {
        actions = `<div class="row-btns"><button class="btn sm primary" data-a="use" data-id="${c.id}">Für ${esc(BOTS[tab].name)} verwenden</button>${
          c.active || c.usedBy.length ? '' : `<button class="btn sm ghost" data-a="del" data-id="${c.id}" title="Vom PC löschen">${I.trash}</button>`
        }</div>`;
      } else if (c.upgrade && st.bgDownload && st.bgDownload.id === c.id) {
        actions = `<span class="muted small">🚀 Lädt im Hintergrund … ${dlPct(st.bgDownload)} %</span>`;
      } else if (c.upgrade) {
        actions = `<button class="btn sm primary" data-a="use" data-id="${c.id}">🚀 Im Hintergrund laden (${fmtGB(c.size)} GB)</button>`;
      } else {
        actions = `<button class="btn sm" data-a="use" data-id="${c.id}">${I.save} Optional: herunterladen &amp; verwenden</button>`;
      }
      const used = c.usedBy.filter((b) => b !== tab).map((b) => BOTS[b].name);
      return `<div class="mcard ${c.recommended ? 'rec' : ''} ${isCurrent ? 'act' : ''}">
        ${isCurrent ? '<span class="tag on">Ausgewählt</span>' : c.recommended ? '<span class="tag">Passt zu deinem PC</span>' : ''}
        <div class="title">${esc(c.title)} <span class="muted">· ${esc(c.params)}</span></div>
        <div class="id">${fmtSize(c.size)}${c.installed ? ' · auf deinem PC' : ''}${used.length ? ' · auch für ' + esc(used.join(', ')) : ''}</div>
        <div class="req">${esc(c.desc)}</div>
        ${actions}
      </div>`;
    })
    .join('');
  $('#setupBody').innerHTML = `
    <h2>Bots &amp; KI-Modelle</h2>
    <p>${hw ? hwLine(hw) : ''}${st.freeDiskGB != null ? ` · ${String(Math.round(st.freeDiskGB))} GB frei` : ''}</p>
    <div class="bot-tabs">${tabs}</div>
    ${st.status === 'idle' && !st.active ? '<div class="notice">Wähle ein Modell, damit deine KI starten kann.</div>' : ''}
    ${st.catalog.some((c) => c.installed) ? `<div class="notice small">✅ Alle Bots benutzen automatisch ein Modell, das schon auf deinem PC ist – es muss nichts extra heruntergeladen werden. Ein Spezial-Modell für den ${esc(BOTS[tab].name)} kannst du hier optional laden.</div>` : ''}
    ${current === 'custom' ? `<div class="notice">Der ${esc(BOTS[tab].name)} benutzt dein eigenes Modell <b>${esc(st.customName || '')}</b>.</div>` : ''}
    ${st.notice ? `<div class="notice">${esc(st.notice)}</div>` : ''}
    ${st.memNote ? `<div class="notice">${esc(st.memNote)}</div>` : ''}
    ${st.status === 'ready' ? `<div class="notice small">⚡ Gerade geladen: <b>${esc(activeLabel())}</b> auf ${st.hardware && st.hardware.gpu ? 'der Grafikkarte' : 'dem Prozessor'}${S.lastTps ? ` · zuletzt <b>${S.lastTps.toFixed(1).replace('.', ',')} Token/s</b>` : ''}. Es passt immer nur ein Modell gleichzeitig auf die Grafikkarte – beim Bot-Wechsel tauscht FORGE es automatisch.</div>` : ''}
    <div class="model-cards">${cards}</div>
    <div class="actions between">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm ghost" data-a="custom">Eigene GGUF-Datei für ${esc(BOTS[tab].name)}</button>
        <button class="btn sm ghost" data-a="folder">Modell-Ordner</button>
        <button class="btn sm ghost" data-a="copylog">Fehlerbericht kopieren</button>
      </div>
      ${st.active || st.status === 'downloading' || st.status === 'loading' ? '<button class="btn" data-a="close">Schließen</button>' : ''}
    </div>`;
}

function openModels(tab) {
  if (tab) S.modelsTab = tab;
  S.modelsOpen = true;
  renderEngineOverlay();
}
function closeModels() {
  S.modelsOpen = false;
  renderEngineOverlay();
}

$('#setupBody').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  const id = b.dataset.id;
  if (a === 'close') closeModels();
  else if (a === 'models') openModels();
  else if (a === 'retry') forge.engine.retry();
  else if (a === 'installupd') forge.update.install();
  else if (a === 'copylog') {
    await forge.copyLog();
    toast('Fehlerbericht kopiert – jetzt im Chat mit Strg+V einfügen', 'ok');
  } else if (a === 'openlog') forge.openLog();
  else if (a === 'cancel') forge.engine.cancel();
  else if (a === 'folder') forge.engine.openFolder();
  else if (a === 'tab') {
    S.modelsTab = id;
    renderModels();
  } else if (a === 'custom') {
    if (await forge.engine.custom(S.modelsTab)) closeModels();
  } else if (a === 'use') {
    const bot = S.modelsTab || 'chat';
    await forge.engine.setBotModel(bot, id);
    toast(`${BOTS[bot].name} benutzt jetzt ${S.engine.catalog.find((c) => c.id === id)?.title || id}`, 'ok');
    S.engine = await forge.engine.state();
    renderModels();
  } else if (a === 'del') {
    if (b.dataset.confirm) {
      if (await forge.engine.remove(id)) toast('Modell gelöscht', 'ok');
      S.engine = await forge.engine.state();
      renderModels();
    } else {
      b.dataset.confirm = '1';
      b.innerHTML = 'Wirklich?';
    }
  }
});

// ======================================================================
//                                 Updates
// ======================================================================
function updateStatusText(u) {
  if (!u || !u.enabled) return 'automatische Updates noch nicht eingerichtet';
  switch (u.status) {
    case 'checking':
      return 'suche nach Updates …';
    case 'downloading':
      return `lade Version ${u.latest} … ${u.progress || 0} %`;
    case 'ready':
      return `Version ${u.latest} ist bereit`;
    case 'installing':
      return 'installiere Update …';
    case 'uptodate':
      return 'aktuell';
    case 'error':
      return 'Fehler: ' + (u.error || '');
    default:
      return 'automatisch';
  }
}

function renderUpdate(u) {
  S.update = u;
  const bar = $('#updateBar');
  if (u.status === 'downloading') {
    bar.hidden = false;
    bar.innerHTML = `<div class="ub-row">${I.save}<span>Update ${esc(u.latest)} wird geladen … ${u.progress || 0} %</span></div><div class="progress"><div style="width:${u.progress || 0}%"></div></div>`;
  } else if (u.status === 'ready' && S.liveCountdown) {
    // Countdown läuft gerade (siehe Live-Update unten)
  } else if (u.status === 'ready') {
    bar.hidden = false;
    bar.innerHTML = `<div class="ub-row">${I.redo}<span><b>Update ${esc(u.latest)}</b> ist bereit</span></div>
      <button class="btn sm primary wide" data-u="${u.kind === 'app' ? 'live' : 'install'}">${u.kind === 'app' ? 'Jetzt einspielen' : 'Jetzt aktualisieren'}</button>
      ${u.kind === 'app' ? '<div class="ub-hint">Läuft ohne Neustart – dein Chat bleibt offen.</div>' : ''}`;
  } else if (u.status === 'installing') {
    bar.hidden = false;
    bar.innerHTML = `<div class="ub-row"><span class="spinner"></span><span>Update wird installiert … FORGE startet gleich neu.</span></div>`;
  } else bar.hidden = true;
  if (u.justUpdated && !S.shownJustUpdated) {
    S.shownJustUpdated = true;
    showUpdateCelebration(u.justUpdated);
  }
  const st = $('#updStatus');
  if (st) st.value = `Version ${u.current} · ${updateStatusText(u)}`;
  if (S.engine && S.engine.status === 'error' && !$('#setup').hidden) renderError();
}

// Nach einem automatischen Update: Gratulation mit Konfetti
function showUpdateCelebration({ version, notes }) {
  const ov = document.createElement('div');
  ov.className = 'overlay celebrate';
  const colors = ['#ffb347', '#ff5e1a', '#3ddc84', '#36e0ff', '#ffd23f', '#ff6bcb', '#9b8cff'];
  let confetti = '';
  for (let i = 0; i < 90; i++) {
    const c = colors[i % colors.length];
    const left = Math.random() * 100;
    const delay = Math.random() * 1.6;
    const dur = 2.6 + Math.random() * 2.2;
    const rot = Math.floor(Math.random() * 360);
    const w = 6 + Math.random() * 7;
    confetti += `<i style="left:${left}%;background:${c};width:${w}px;height:${w * 1.6}px;animation-delay:${delay}s;animation-duration:${dur}s;transform:rotate(${rot}deg)"></i>`;
  }
  const lines = String(notes || '').split('\n').map((l) => l.trim()).filter(Boolean);
  ov.innerHTML = `<div class="confetti">${confetti}</div>
    <div class="modal celebrate-modal">
      <div class="party">🎉</div>
      <h2>${esc(lines[0] || 'Gratulation, es funktioniert!')}</h2>
      <p>${esc(S.settings.aiName)} AI hat sich gerade <b>ganz von selbst</b> auf <b>Version ${esc(version)}</b> aktualisiert – ohne neue Installation.</p>
      ${lines.length > 1 ? `<ul>${lines.slice(1).map((l) => `<li>${esc(l.replace(/^[-•*]\s*/, ''))}</li>`).join('')}</ul>` : ''}
      <button class="btn primary big">Mega, danke!</button>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  $('button', ov).addEventListener('click', close);
  ov.addEventListener('mousedown', (e) => e.target === ov && close());
}

$('#updateBar').addEventListener('click', (e) => {
  if (e.target.closest('[data-u="install"]')) forge.update.install();
  if (e.target.closest('[data-u="live"]') || e.target.closest('[data-u="now"]')) applyLiveNow();
  if (e.target.closest('[data-u="later"]')) {
    stopLiveCountdown();
    S.liveDeferredUntil = Date.now() + 10 * 60 * 1000; // in 10 Minuten wieder fragen
    setTimeout(() => S.live && scheduleLive(S.live), 10 * 60 * 1000 + 500);
    if (S.update) renderUpdate(S.update);
  }
});

// ---------- Live-Updates: einspielen, ohne FORGE zu schließen ----------
function scheduleLive(info) {
  S.live = info;
  if (S.liveDeferredUntil && Date.now() < S.liveDeferredUntil) return;
  if (S.liveCountdown) return;
  // Nicht mitten in einer Antwort oder einem 3D-Modell unterbrechen
  if (S.busy) {
    clearTimeout(S.liveWait);
    S.liveWait = setTimeout(() => scheduleLive(info), 2000);
    return;
  }
  let left = 6;
  const bar = $('#updateBar');
  const draw = () => {
    bar.hidden = false;
    bar.innerHTML = `<div class="ub-row">⚡<span><b>Update ${esc(info.version)}</b> wird in ${left} s eingespielt${info.restart ? ' (FORGE startet kurz neu)' : ''}</span></div>
      <div class="row-btns"><button class="btn sm primary" data-u="now">Jetzt</button><button class="btn sm ghost" data-u="later">Später</button></div>`;
  };
  draw();
  S.liveCountdown = setInterval(() => {
    if (S.busy) {
      stopLiveCountdown();
      return scheduleLive(info);
    }
    left--;
    if (left <= 0) applyLiveNow();
    else draw();
  }, 1000);
}

function stopLiveCountdown() {
  clearInterval(S.liveCountdown);
  S.liveCountdown = null;
}

async function applyLiveNow() {
  stopLiveCountdown();
  if (S.busy) return scheduleLive(S.live || { version: (S.update && S.update.latest) || '' });
  saveResume();
  const bar = $('#updateBar');
  bar.hidden = false;
  bar.innerHTML = `<div class="ub-row"><span class="spinner"></span><span>Update wird eingespielt …</span></div>`;
  const r = await forge.update.applyLive();
  if (!r || !r.ok) {
    localStorage.removeItem('forge.resume');
    if (r && r.busy) return setTimeout(() => scheduleLive(S.live), 2000);
    if (S.update) renderUpdate(S.update);
  }
}

// Was gerade offen ist, merken – nach dem Neuladen geht es genau dort weiter
function saveResume() {
  store('forge.resume', {
    t: Date.now(),
    mode: S.mode,
    convId: S.convId,
    modelId: S.modelId,
    input: $('#input').value,
    prompt3d: $('#prompt3d').value,
    edit3d: $('#edit3d').value,
    detail: S.detail,
    styles: [...S.styles],
  });
}

function restoreResume() {
  const r = load('forge.resume', null);
  localStorage.removeItem('forge.resume');
  if (!r || Date.now() - r.t > 3 * 60 * 1000) return;
  if (r.convId && S.convs.some((c) => c.id === r.convId)) {
    S.convId = r.convId;
    renderConversation();
  }
  $('#input').value = r.input || '';
  autosize();
  $('#prompt3d').value = r.prompt3d || '';
  $('#edit3d').value = r.edit3d || '';
  if (r.detail) $$('#detailSeg button').forEach((b) => b.classList.toggle('active', +b.dataset.v === r.detail)), (S.detail = r.detail);
  for (const st of r.styles || []) {
    S.styles.add(st);
    const chip = $(`#styleChips [data-s="${CSS.escape(st)}"]`);
    if (chip) chip.classList.add('on');
  }
  if (r.mode === '3d') {
    setMode('3d');
    if (r.modelId && S.models.some((m) => m.id === r.modelId)) openSavedModel(r.modelId);
  }
  renderSideList();
}

// ======================================================================
//                               Einstellungen
// ======================================================================
function openSettings() {
  const st = S.settings;
  const ctx = (S.engine && S.engine.ctx) || 8192;
  $('#settingsBody').innerHTML = `
    <h2>Einstellungen</h2>
    <p>Alles bleibt auf deinem PC.</p>
    <div class="field"><label>Name deiner KI</label><input id="sName" maxlength="24" value="${esc(st.aiName)}"></div>
    <div class="two">
      <div class="field"><label>💭 Nachdenken vor dem Antworten <span class="hint" style="display:inline">(Qwen3.5/3.6-Modelle)</span></label><select id="sThink"><option value="off" ${st.think === 'off' ? 'selected' : ''}>Aus – am schnellsten</option><option value="short" ${!st.think || st.think === 'short' ? 'selected' : ''}>Kurz – guter Mittelweg (empfohlen)</option><option value="deep" ${st.think === 'deep' ? 'selected' : ''}>Gründlich – langsamer, beste Ergebnisse</option></select></div>
      <div class="field"><label>Kreativität: <span id="tVal">${String(st.temperature).replace('.', ',')}</span></label><input id="sTemp" type="range" min="0" max="1.2" step="0.05" value="${st.temperature}"><span class="hint">Niedrig = genauer Code, hoch = kreativer</span></div>
      <div class="field"><label>Gedächtnis (Kontext)</label><select id="sCtx">${[4096, 8192, 16384, 32768]
        .map((n) => `<option value="${n}" ${n === ctx ? 'selected' : ''}>${n.toLocaleString('de-DE')} Token${n === 8192 ? ' (empfohlen)' : n === 4096 ? ' (spart Speicher)' : ''}</option>`)
        .join('')}</select><span class="hint">Mehr = längere Chats, braucht mehr Speicher</span></div>
    </div>
    <div class="field"><label>KI-Modell</label><div class="edit-row"><input value="${esc(activeLabel())}" disabled><button class="btn" data-a="models">Ändern</button></div></div>
    <div class="field checks">
      <label class="check"><input type="checkbox" id="sSelfCheck" ${st.selfCheck !== false ? 'checked' : ''}> 🔍 Selbstprüfung: Die KI prüft ihren Code (Syntax, Namen, kurzer Testlauf), bevor du ihn startest</label>
      <label class="check"><input type="checkbox" id="sAutoFix" ${st.autoFix !== false ? 'checked' : ''}> 🔧 Automatische Reparatur: Wenn Code beim Ausführen abstürzt, behebt die KI den Fehler selbst und startet neu (bis zu ${MAX_REPAIR}×)</label>
      <label class="check"><input type="checkbox" id="sWeb" ${st.web ? 'checked' : ''}> 🌐 Internet-Suche: Die KI darf selbst im Netz nachschauen</label>
      <label class="check"><input type="checkbox" id="sTrust" ${st.runTrusted ? 'checked' : ''}> Programme ohne Nachfrage ausführen</label>
    </div>
    <div class="field"><label>Updates</label><div class="edit-row"><input id="updStatus" value="${esc(S.update ? `Version ${S.update.current} · ${updateStatusText(S.update)}` : '')}" disabled><button class="btn" data-a="checkupd">Nach Updates suchen</button></div></div>
    <div class="actions between">
      <button class="btn danger" data-a="wipe">Alle Chats löschen</button>
      <div style="display:flex;gap:8px">
        <button class="btn ghost" data-a="cancel">Abbrechen</button>
        <button class="btn primary" data-a="save">Speichern</button>
      </div>
    </div>`;
  $('#settings').hidden = false;
  $('#sTemp').addEventListener('input', (e) => ($('#tVal').textContent = String(e.target.value).replace('.', ',')));
}
function closeSettings() {
  $('#settings').hidden = true;
}
$('#settingsBody').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'cancel') closeSettings();
  else if (a === 'checkupd') {
    b.disabled = true;
    const u = await forge.update.check();
    b.disabled = false;
    renderUpdate(u);
    if (u.status === 'uptodate') toast('Du hast schon die neueste Version.', 'ok');
    else if (u.status === 'disabled' || !u.enabled) toast('Automatische Updates sind in dieser Version noch nicht eingerichtet.', 'err');
    else if (u.status === 'error') toast('Update-Suche fehlgeschlagen: ' + u.error, 'err');
  } else if (a === 'models') {
    closeSettings();
    openModels();
  } else if (a === 'wipe') {
    if (b.dataset.confirm) {
      S.convs = [];
      S.convId = null;
      saveConvs();
      renderConversation();
      renderSideList();
      toast('Alle Chats gelöscht', 'ok');
      closeSettings();
    } else {
      b.dataset.confirm = '1';
      b.textContent = 'Wirklich löschen?';
    }
  } else if (a === 'save') {
    const st = S.settings;
    st.aiName = $('#sName').value.trim().slice(0, 24) || 'FORGE';
    st.temperature = +$('#sTemp').value;
    st.autoFix = $('#sAutoFix').checked;
    st.think = $('#sThink').value;
    st.selfCheck = $('#sSelfCheck').checked;
    st.web = $('#sWeb').checked;
    st.runTrusted = $('#sTrust').checked;
    saveSettings();
    renderWebBtn();
    const ctx = +$('#sCtx').value;
    if (S.engine && ctx !== S.engine.ctx) forge.engine.setCtx(ctx);
    closeSettings();
    updateModelLabels();
    toast('Gespeichert', 'ok');
  }
});
$('#settings').addEventListener('mousedown', (e) => {
  if (e.target.id === 'settings') closeSettings();
});
$('#setup').addEventListener('mousedown', (e) => {
  if (e.target.id === 'setup' && S.modelsOpen && S.engine && (S.engine.active || S.engine.status !== 'idle')) closeModels();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modelsOpen) closeModels();
});

// ======================================================================
//                                  Start
// ======================================================================
async function boot() {
  updateModelLabels();
  renderSuggestions();
  init3DPanel();
  renderConversation();
  renderSideList();
  forge.engine.onUpdate(onEngine);
  onEngine(await forge.engine.state());
  restoreResume();
  forge.update.onUpdate(renderUpdate);
  forge.update.onLive(scheduleLive);
  renderUpdate(await forge.update.state());
  forge.update.booted();
  $('#input').focus();
}
boot();
