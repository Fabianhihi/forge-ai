// FORGE AI – Startprogramm. Wird bei App-Updates nie ersetzt.
// Spielt wartende Updates ein und stellt die alte Version wieder her, falls eine neue nicht startet.
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Updater } = require('./updater');

function bootLog(level, text) {
  try {
    const f = path.join(app.getPath('userData'), 'forge-log.txt');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${level.toUpperCase()} ${text}\n`);
  } catch {}
}

const updater = new Updater({ app, log: bootLog });
global.forgeUpdater = updater;

if (updater.applyPendingSync()) {
  app.relaunch();
  app.exit(0);
} else {
  try {
    require('./main.js');
  } catch (err) {
    bootLog('error', 'Start fehlgeschlagen: ' + (err && err.stack ? err.stack : err));
    if (updater.rollbackNow()) {
      app.relaunch();
      app.exit(0);
    } else {
      app.whenReady().then(() => {
        dialog.showErrorBox('FORGE AI – Fehler', 'FORGE AI konnte nicht starten:\n\n' + ((err && err.message) || err));
        app.exit(1);
      });
    }
  }
}
