// Entwickler-Hilfe: INSEL_SHOT=ordner npm start  →  speichert Bilder jedes Zustands mit Beispieldaten.
const fs = require('fs'), path = require('path');
module.exports = win => {
  setTimeout(() => require('electron').app.exit(0), 170000);   // nie hängen bleiben
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
    // Klick-Test mit echter Maus: Geht die Insel auf, und kommt ein Klick an? Einmal normal, einmal nach Verstecken und Wiederzeigen.
    if (process.env.INSEL_REAL) {
      const { spawn } = require('child_process');
      const log = t => fs.appendFileSync(path.join(out, 'helper.log'), 'klick: ' + t + '\n');
      const js = code => win.webContents.executeJavaScript(code);
      const mouse = (x, y, click) => new Promise(done => {
        const file = path.join(out, 'maus.ps1');
        fs.writeFileSync(file, [
          'Add-Type -Name U -Namespace W -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e);\'',
          '[W.U]::SetCursorPos(' + Math.round(x - 3) + ',' + Math.round(y) + ') | Out-Null', 'Start-Sleep -Milliseconds 150',
          '[W.U]::SetCursorPos(' + Math.round(x) + ',' + Math.round(y) + ') | Out-Null', 'Start-Sleep -Milliseconds 900',
          click ? '[W.U]::mouse_event(2,0,0,0,[System.UIntPtr]::Zero); Start-Sleep -Milliseconds 70; [W.U]::mouse_event(4,0,0,0,[System.UIntPtr]::Zero)' : '',
          'Start-Sleep -Milliseconds 700'].join('\r\n'));
        const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
        p.on('close', done); p.on('error', done);
      });
      const center = async sel => { const r = await js(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); const b = win.getBounds(); return [b.x + r[0], b.y + r[1]]; };
      const state = () => js(`document.querySelector('#island').dataset.state`);
      const round = async label => {
        try {
          await mouse(40, 600, false);
          const before = await state();
          let p = await center('#island'); await mouse(p[0], p[1], false);
          const hover = await state();
          p = await center('.chip[data-go="quick"]'); await mouse(p[0], p[1], true);
          const click = await state();
          await mouse(40, 600, false); await wait(900);
          log(label + ': vorher=' + before + ' hover=' + hover + ' klick=' + click + ' danach=' + await state());
        } catch (e) { log(label + ': Fehler ' + e.message); }
      };
      await round('normal');
      global.inselSetHidden(true); await wait(2500); global.inselSetHidden(false); await wait(1500);
      await round('nach Vollbild');
      // Windows-Taste im Vollbild: Das Menü muss aufgehen und offen bleiben, auch wenn die Insel danach als sichtbar gemeldet wird.
      try {
        global.inselSetHidden(true); await wait(1500);
        global.inselWinKey(); await wait(1200);
        const s1 = await state();
        global.inselSetHidden(false); await wait(1500);
        const s2 = await state();
        global.inselWinKey(); await wait(900);
        log('Windows-Taste im Vollbild: offen=' + s1 + ' bleibt=' + s2 + ' zweiter Druck=' + await state());
      } catch (e) { log('Windows-Taste: Fehler ' + e.message); }
      // Zurück ins Spiel: Beim Schließen per Windows-Taste muss die Insel sofort aus dem Bild.
      try {
        global.inselFullscreen(true); await wait(1200);
        global.inselWinKey(); await wait(1500);
        const open = await state(), focused = win.isFocused();
        global.inselWinKey(); await wait(250);
        const gone = win.getBounds().x < -10000;
        log('Zurück ins Spiel: offen=' + open + ' Fokus=' + focused + ' sofort versteckt=' + gone);
        global.inselFullscreen(false); await wait(1500);
      } catch (e) { log('Zurück ins Spiel: Fehler ' + e.message); }
      // Automatisch ausblenden: weg, kommt mit der Maus am Rand zurück, verschwindet wieder
      try {
        const { ipcMain, screen } = require('electron');
        ipcMain.emit('set-autohide', {}, true); await wait(800);
        const h1 = win.getBounds().x < -10000;
        const pos = global.inselPos(), d = screen.getDisplayNearestPoint({ x: pos.cx, y: pos.y }).bounds;
        await mouse(pos.cx, pos.anchor === 'bottom' ? d.y + d.height - 1 : d.y, false);
        const h2 = win.getBounds().x < -10000;
        await mouse(40, 600, false); await wait(1200);
        const h3 = win.getBounds().x < -10000;
        log('Automatisch ausblenden: versteckt=' + h1 + ' Rand=' + (h2 ? 'versteckt' : 'sichtbar') + ' weg=' + (h3 ? 'versteckt' : 'sichtbar'));
        ipcMain.emit('set-autohide', {}, false); await wait(800);
      } catch (e) { log('Automatisch ausblenden: Fehler ' + e.message); }
      await js(`document.querySelector('#island').dataset.state='idle'`);
    }
    for (const s of ['idle', 'hub', 'music', 'quick', 'look', 'widgets', 'notif', 'settings', 'cal', 'mixer', 'notes', 'vol', 'start']) {
      await win.webContents.executeJavaScript(s === 'start' ? `document.querySelector('[data-start]').click()` : `document.querySelector('#island').dataset.state='${s}'`);
      await wait(s === 'start' ? 6000 : 900);
      fs.writeFileSync(path.join(out, s + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    // Suche im Menü (das Menü ist nach der Bilderreihe offen)
    for (const q of ['deinstallieren', 'programme hinzufügen', 'editor']) {
      try {
        await win.webContents.executeJavaScript(`(() => { const s = document.querySelector('#sSearch'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input')); })()`);
        await wait(3500);
        if (q === 'deinstallieren') fs.writeFileSync(path.join(out, 'search.png'), (await win.webContents.capturePage()).toPNG());
        const labels = await win.webContents.executeJavaScript(`[...document.querySelectorAll('#sList .s-sec, #sList .s-row b')].map(b => b.textContent).join(' | ')`);
        fs.appendFileSync(path.join(out, 'helper.log'), 'suche: ' + q + ': ' + labels + '\n');
      } catch (e) { fs.appendFileSync(path.join(out, 'helper.log'), 'suche: Fehler ' + e.message + '\n'); }
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
    for (const name of ['clock', 'calendar', 'system', 'music', 'note']) ipcMain.emit('set-widget', {}, { name, on: true });
    await wait(3500);
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === win) continue;
      const kind = new URL(w.webContents.getURL()).hash.slice(1);
      try { fs.writeFileSync(path.join(out, 'widget-' + kind + '.png'), (await w.webContents.capturePage()).toPNG()); } catch (_) {}
    }
    for (const name of ['clock', 'calendar', 'system', 'music', 'note']) ipcMain.emit('set-widget', {}, { name, on: false });
    ipcMain.emit('quit');
  });
};
