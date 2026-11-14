// FORGE AI – KI-Motor in eigenem Prozess.
// Stürzt der Grafiktreiber oder der Motor ab, bleibt die App offen und startet ihn neu.
const { Engine } = require('./engine');

const port = process.parentPort;
const aborts = new Map();
let engine = null;

const post = (msg) => {
  try {
    port.postMessage(msg);
  } catch {}
};

process.on('uncaughtException', (err) => post({ type: 'log', level: 'error', text: 'Worker: ' + (err && err.stack ? err.stack : err) }));
process.on('unhandledRejection', (err) => post({ type: 'log', level: 'error', text: 'Worker (Promise): ' + (err && err.stack ? err.stack : err) }));

port.on('message', async (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') {
    engine = new Engine({ dataDir: msg.dataDir, forceCpu: !!msg.forceCpu, log: (level, text) => post({ type: 'log', level, text }) });
    engine.on('state', (state) => post({ type: 'state', state }));
    post({ type: 'state', state: engine.publicState() });
    engine.start();
    return;
  }
  if (!engine) return;
  if (msg.type === 'call') {
    try {
      const result = await engine[msg.method](...(msg.args || []));
      post({ type: 'reply', id: msg.id, result: result === undefined ? null : result });
    } catch (err) {
      post({ type: 'reply', id: msg.id, error: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type === 'chat') {
    const ac = new AbortController();
    aborts.set(msg.id, ac);
    try {
      const result = await engine.chat(
        msg.req,
        (text, meta) => {
          if (meta && meta.waiting) post({ type: 'chunk', id: msg.id, waiting: true });
          else if (text) post({ type: 'chunk', id: msg.id, text });
        },
        ac.signal
      );
      post({ type: 'chat-done', id: msg.id, result: result || {} });
    } catch (err) {
      if (ac.signal.aborted) post({ type: 'chat-done', id: msg.id, result: { aborted: true } });
      else post({ type: 'chat-error', id: msg.id, error: String((err && err.message) || err) });
    } finally {
      aborts.delete(msg.id);
    }
    return;
  }
  if (msg.type === 'abort') {
    const ac = aborts.get(msg.id);
    if (ac) ac.abort();
    return;
  }
  // Nur für Tests: Absturz simulieren
  if (msg.type === 'crash' && process.env.FORGE_TEST_CRASH) process.crash();
});
