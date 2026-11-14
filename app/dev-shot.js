// Entwickler-Hilfe: INSEL_SHOT=ordner npm start  →  speichert Bilder jedes Zustands mit Beispieldaten.
const fs = require('fs'), path = require('path');
module.exports = win => {
  setTimeout(() => require('electron').app.exit(0), 70000);   // nie hängen bleiben
  const out = process.env.INSEL_SHOT;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  win.webContents.once('did-finish-load', async () => {
    await wait(process.env.INSEL_REAL ? 6000 : 500);
    const dot = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="10" fill="#4cc2ff"/></svg>');
    if (!process.env.INSEL_REAL) win.webContents.send('apps', { pins: [{ name: 'Dateien', icon: dot, wins: [1], active: false }, { name: 'Spiel', icon: '', wins: [], active: false }], others: [{ name: 'Browser', icon: dot, wins: [2], active: true }] });
    if (!process.env.INSEL_REAL) win.webContents.send('ev', { t: 'media', has: true, title: 'Nachtfahrt', artist: 'Lumen Kollektiv', playing: true, pos: 47, dur: 214 });
    win.webContents.send('ev', { t: 'volume', level: 0.6, muted: false });
    if (!process.env.INSEL_REAL) win.webContents.send('ev', { t: 'tray', ok: true, icons: [{ id: 'a', title: 'Discord', icon: dot }, { id: 'b', title: 'Steam', icon: '' }, { id: 'c', title: 'Virenschutz', icon: dot }] });
    if (!process.env.INSEL_REAL) win.webContents.send('ev', { t: 'notifyState', on: true, apps: [{ name: 'Discord', on: true }, { name: 'Mail', on: false }, { name: 'Steam', on: true }] });
    for (const s of ['idle', 'hub', 'music', 'quick', 'look', 'widgets', 'notif', 'timer', 'vol']) {
      await win.webContents.executeJavaScript(`document.querySelector('#island').dataset.state='${s}'`);
      await wait(900);
      fs.writeFileSync(path.join(out, s + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    // Widgets einmal öffnen und abbilden
    const { ipcMain, BrowserWindow } = require('electron');
    for (const name of ['clock', 'calendar', 'system']) ipcMain.emit('set-widget', {}, { name, on: true });
    await wait(3500);
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === win) continue;
      const kind = new URL(w.webContents.getURL()).hash.slice(1);
      try { fs.writeFileSync(path.join(out, 'widget-' + kind + '.png'), (await w.webContents.capturePage()).toPNG()); } catch (_) {}
    }
    for (const name of ['clock', 'calendar', 'system']) ipcMain.emit('set-widget', {}, { name, on: false });
    ipcMain.emit('quit');
  });
};
