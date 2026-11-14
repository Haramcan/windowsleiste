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
    if (!process.env.INSEL_REAL) { win.webContents.send('ev', { t: 'mic', has: true, muted: true }); win.webContents.send('ev', { t: 'mixer', list: [{ pid: 1, name: 'Spotify', level: 0.4, muted: false }, { pid: 2, name: 'chrome', level: 1, muted: false }, { pid: 0, name: 'Systemtöne', level: 0.7, muted: false }] }); }
    if (!process.env.INSEL_REAL) win.webContents.send('ev', { t: 'tray', ok: true, icons: [{ id: 'a', title: 'Discord', icon: dot }, { id: 'b', title: 'Steam', icon: '' }, { id: 'c', title: 'Virenschutz', icon: dot }] });
    if (!process.env.INSEL_REAL) win.webContents.send('ev', { t: 'notifyState', on: true, apps: [{ name: 'Discord', on: true }, { name: 'Mail', on: false }, { name: 'Steam', on: true }] });
    for (const s of ['idle', 'hub', 'music', 'quick', 'look', 'widgets', 'notif', 'mixer', 'notes', 'timer', 'vol', 'start']) {
      await win.webContents.executeJavaScript(s === 'start' ? `document.querySelector('[data-start]').click()` : `document.querySelector('#island').dataset.state='${s}'`);
      await wait(s === 'start' ? 6000 : 900);
      fs.writeFileSync(path.join(out, s + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    // Milchglas-Test: Sieht die Bildschirmaufnahme die Insel selbst? (Soll sie nicht.)
    if (process.env.INSEL_REAL) {
      const probe = `(async () => {
        const v = document.querySelector('#gv');
        if (!v || !v.srcObject) return 'kein Bild';
        document.body.style.background = '#ff00ff';
        await new Promise(r => setTimeout(r, 1500));
        const c = document.createElement('canvas'); c.width = 160; c.height = 90;
        const g = c.getContext('2d'); g.drawImage(v, 0, 0, 160, 90);
        const d = g.getImageData(0, 0, 160, 90).data; let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] > 200) n++;
        document.body.style.background = '';
        return n + ' von 14400 Punkten zeigen die Insel';
      })()`;
      const log = t => fs.appendFileSync(path.join(out, 'helper.log'), 'glas: ' + t + '\n');
      try {
        log('Art beim Start: ' + await win.webContents.executeJavaScript(`document.querySelector('#gi').hidden ? 'kein Hintergrundbild' : 'Hintergrundbild'`));
        await win.webContents.executeJavaScript(`document.querySelector('#tLive').click()`);
        await wait(3000);
        log('Standard: ' + await win.webContents.executeJavaScript(probe));
        win.setIgnoreMouseEvents(false); win.setContentProtection(false); win.setContentProtection(true);
        await wait(800);
        log('ohne Klick-Durchlass: ' + await win.webContents.executeJavaScript(probe));
        win.setIgnoreMouseEvents(true, { forward: true });
        await wait(800);
        log('Durchlass wieder an: ' + await win.webContents.executeJavaScript(probe));
        await win.webContents.executeJavaScript(`document.querySelector('#tLive').click()`);
        await wait(800);
      } catch (e) { log('Fehler ' + e.message); }
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
