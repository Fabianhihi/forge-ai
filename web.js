// FORGE AI – Internet-Zugriff für die Bots: Websuche + Webseiten lesen.
// Ohne API-Key: DuckDuckGo (HTML / Lite), Bing und Wikipedia als Ersatz.
// Läuft im KI-Prozess; nutzt Electrons Netzwerk (Proxy & Zertifikate von Windows), sonst Node-fetch.

let netFetch = null;
try {
  const { net } = require('electron');
  if (net && typeof net.fetch === 'function') netFetch = net.fetch.bind(net);
} catch {}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAX_BYTES = 2 * 1024 * 1024;

// ---------- Hilfen ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', copy: '©', reg: '®', trade: '™', euro: '€', middot: '·', bull: '•', times: '×' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return n ? String.fromCodePoint(n) : m;
      } catch {
        return m;
      }
    }
    return ENT[e] != null ? ENT[e] : ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}
const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

// Nur öffentliche http(s)-Adressen – nichts im eigenen Netzwerk
function safeUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (process.env.FORGE_WEB_TEST) return url.toString(); // nur für automatische Tests (lokaler Server)
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.') && !h.includes(':')) return null;
  if (/^(localhost|0\.0\.0\.0|::1?|.*\.local|.*\.localhost|.*\.internal)$/.test(h)) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:|fe80:)/.test(h)) return null;
  return url.toString();
}

async function fetchText(url, { signal, timeout = 8000, method = 'GET', body, headers = {} } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('Zeitüberschreitung')), timeout);
  const onAbort = () => ac.abort(new Error('Abgebrochen'));
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const opts = {
      method,
      body,
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8', Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', ...headers },
    };
    let res;
    if (netFetch && !process.env.FORGE_WEB_TEST) {
      try {
        res = await netFetch(url, opts);
      } catch (err) {
        // Chromium-Netz blockiert (Proxy/Zertifikat/Richtlinie)? Dann einmal direkt mit Node versuchen
        if (ac.signal.aborted || !/ERR_(BLOCKED|PROXY|TUNNEL|CERT|SSL)/.test(String(err && err.message))) throw err;
        res = await fetch(url, opts);
      }
    } else res = await fetch(url, opts);
    const type = String(res.headers.get('content-type') || '');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (type && !/text\/|json|xml/i.test(type)) throw new Error('Keine Textseite (' + type.split(';')[0] + ')');
    // Größe begrenzen
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    let buf;
    if (reader) {
      const chunks = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        n += value.length;
        if (n > MAX_BYTES) {
          try {
            await reader.cancel();
          } catch {}
          break;
        }
      }
      buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    } else buf = Buffer.from(await res.arrayBuffer());
    let cs = (/charset=([\w-]+)/i.exec(type) || [])[1];
    if (!cs) cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
    let text;
    try {
      text = new TextDecoder(cs || 'utf-8').decode(buf);
    } catch {
      text = buf.toString('utf8');
    }
    return { text, type, url: res.url || url };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// DuckDuckGo-Weiterleitungen (//duckduckgo.com/l/?uddg=…) und Bing-Links (…/ck/a?…&u=a1…) auflösen
function realUrl(href) {
  href = decodeEntities(href || '');
  if (href.startsWith('//')) href = 'https:' + href;
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (/duckduckgo\.com$/.test(u.hostname) && u.searchParams.get('uddg')) return u.searchParams.get('uddg');
    if (/duckduckgo\.com$/.test(u.hostname) && /\/y\.js/.test(u.pathname)) return null; // Werbung
    if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/') && u.searchParams.get('u')) {
      const v = u.searchParams.get('u');
      if (v.startsWith('a1')) return Buffer.from(v.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    }
    return u.toString();
  } catch {
    return null;
  }
}

// ---------- Ergebnis-Parser (einzeln testbar) ----------
function parseDuckHtml(html) {
  const out = [];
  if (/anomaly-modal|bots use DuckDuckGo too/i.test(html)) return out;
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const b of blocks) {
    if (/result--ad\b/.test(b.slice(0, 200))) continue;
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b) || /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!a) continue;
    const url = realUrl(a[1]);
    if (!url) continue;
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(b);
    out.push({ title: stripTags(a[2]), url, snippet: sn ? stripTags(sn[1]) : '' });
  }
  return out;
}

function parseDuckLite(html) {
  const out = [];
  if (/anomaly-modal|bots use DuckDuckGo too/i.test(html)) return out;
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=["']result-link["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/<td[^>]+class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
  let i = 0;
  for (const m of html.matchAll(re)) {
    const url = realUrl(m[1] || m[3]);
    if (url) out.push({ title: stripTags(m[2] || m[4]), url, snippet: snippets[i] || '' });
    i++;
  }
  return out;
}

function parseBing(html) {
  const out = [];
  for (const blk of html.split(/<li[^>]+class="b_algo[^"]*"/i).slice(1)) {
    const b = blk.split(/<\/li>/i)[0];
    const a = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!a) continue;
    const url = realUrl(a[1]);
    if (!url) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(b) || /class="b_caption"[^>]*>([\s\S]*?)<\/div>/i.exec(b);
    out.push({ title: stripTags(a[2]), url, snippet: p ? stripTags(p[1]) : '' });
  }
  return out;
}

function parseWikipedia(json, lang) {
  const list = (json && json.query && json.query.search) || [];
  return list.map((r) => ({
    title: r.title + ' – Wikipedia',
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: stripTags(r.snippet || ''),
  }));
}

// ---------- Websuche ----------
async function search(query, { signal, max = 6, log = () => {} } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return { results: [], engine: null };
  const engines = [
    ['DuckDuckGo', async () => parseDuckHtml((await fetchText(process.env.FORGE_WEB_TEST ? process.env.FORGE_WEB_TEST + '/html/' : 'https://html.duckduckgo.com/html/', { signal, method: 'POST', body: new URLSearchParams({ q, kl: 'de-de' }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/' } })).text)],
    ['DuckDuckGo Lite', async () => parseDuckLite((await fetchText('https://lite.duckduckgo.com/lite/', { signal, method: 'POST', body: new URLSearchParams({ q, kl: 'de-de' }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).text)],
    ['Bing', async () => parseBing((await fetchText('https://www.bing.com/search?setlang=de&q=' + encodeURIComponent(q), { signal })).text)],
    [
      'Wikipedia',
      async () => {
        const res = [];
        for (const lang of ['de', 'en']) {
          const r = await fetchText(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(q)}`, { signal });
          res.push(...parseWikipedia(JSON.parse(r.text), lang));
          if (res.length >= 3) break;
        }
        return res;
      },
    ],
  ];
  const errors = [];
  for (const [name, run] of engines) {
    if (signal && signal.aborted) break;
    try {
      const seen = new Set();
      const results = (await run())
        .filter((r) => r.url && safeUrl(r.url) && r.title)
        .filter((r) => (seen.has(r.url) ? false : seen.add(r.url)))
        .slice(0, max);
      if (results.length) {
        log('info', `Websuche (${name}): ${results.length} Treffer für „${q}“`);
        return { results, engine: name };
      }
      errors.push(name + ': keine Treffer');
    } catch (err) {
      errors.push(name + ': ' + ((err && err.message) || err));
    }
  }
  log('warn', 'Websuche fehlgeschlagen: ' + errors.join(' · '));
  const e = new Error(errors.every((x) => /keine Treffer/.test(x)) ? 'Keine Treffer gefunden.' : 'Das Internet ist gerade nicht erreichbar.');
  e.details = errors;
  throw e;
}

// ---------- Seite lesen: Haupttext ohne Menüs, Werbung, Skripte ----------
function htmlToText(html) {
  let s = String(html);
  const title = stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s) || [])[1] || '');
  const desc = decodeEntities((/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i.exec(s) || [])[1] || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|template|iframe|canvas|head|select|button)\b[\s\S]*?<\/\1>/gi, ' ');
  // Hauptinhalt bevorzugen
  const pick = (tag) => {
    const all = [...s.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((m) => m[1]);
    return all.sort((a, b) => b.length - a.length)[0];
  };
  const main = pick('article') || pick('main') || (/<body[^>]*>([\s\S]*)<\/body>/i.exec(s) || [])[1] || s;
  let t = main.replace(/<(nav|header|footer|aside|form|dialog)\b[\s\S]*?<\/\1>/gi, ' ');
  t = t
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n## ')
    .replace(/<\/(p|div|section|h[1-6]|li|tr|table|ul|ol|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<t[dh]\b[^>]*>/gi, ' | ')
    .replace(/<[^>]*>/g, '');
  t = decodeEntities(t)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l && !/^(- |## )?$/.test(l) && !/^(cookie|akzeptieren|accept all|alle akzeptieren|anmelden|login|teilen|share)\b/i.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { title, description: desc, text: t.trim() };
}

async function readPage(url, { signal, maxChars = 4000 } = {}) {
  const safe = safeUrl(url);
  if (!safe) throw new Error('Diese Adresse darf nicht geöffnet werden.');
  const r = await fetchText(safe, { signal, timeout: 9000 });
  let title = '';
  let text = r.text;
  if (/json/i.test(r.type)) text = r.text.slice(0, maxChars * 2);
  else if (/html|xml/i.test(r.type) || /<html|<body/i.test(r.text.slice(0, 2000))) {
    const p = htmlToText(r.text);
    title = p.title;
    text = (p.description && !p.text.includes(p.description.slice(0, 40)) ? p.description + '\n\n' : '') + p.text;
  }
  text = text.trim();
  if (text.length > maxChars) text = text.slice(0, maxChars).replace(/\s+\S*$/, '') + ' …';
  return { url: r.url || safe, title: title || new URL(safe).hostname, text };
}

function findUrls(text) {
  return [...new Set((String(text).match(/https?:\/\/[^\s<>"'`)\]]+/g) || []).map((u) => u.replace(/[.,;:!?]+$/, '')))].filter(safeUrl);
}

module.exports = { search, readPage, findUrls, htmlToText, parseDuckHtml, parseDuckLite, parseBing, parseWikipedia, safeUrl, realUrl, decodeEntities };
