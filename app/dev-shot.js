// Entwickler-Hilfe: INSEL_SHOT=ordner npm start  →  speichert Bilder jedes Zustands mit Beispieldaten.
const fs = require('fs'), path = require('path');
module.exports = win => {
  setTimeout(() => require('electron').app.exit(0), 210000);   // nie hängen bleiben
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
    // Rechtsklick-Menüs: Einträge prüfen, und "Task beenden" an einem echten Programm
    if (process.env.INSEL_REAL) {
      const log2 = t => fs.appendFileSync(path.join(out, 'helper.log'), 'menü: ' + t + '\n');
      try {
        const m = global.inselMenus();
        const labels = t => t.map(x => x.label).filter(Boolean).join(' | ');
        log2('Start: ' + labels(m.start()));
        log2('Insel: ' + labels(m.island()));
        require('child_process').spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
        let note = null;
        for (let k = 0; k < 20 && !note; k++) { await wait(500); note = global.inselWins().find(w => /notepad/i.test(w.exe)); }
        if (!note) log2('Task beenden: kein Editor-Fenster gefunden');
        else {
          await wait(1200);
          const grp = require('electron').ipcMain;
          const all = (global.inselApps ? global.inselApps() : null);
          log2('App: ' + labels(m.app('other', Math.max(0, (all ? all.others : []).findIndex(a => a.wins.includes(note.h))))));
          global.inselHelper({ c: 'kill', h: [note.h] });
          let gone = false;
          for (let k = 0; k < 10 && !gone; k++) { await wait(500); gone = !global.inselWins().some(w => w.h === note.h); }
          log2('Task beenden: ' + (gone ? 'Editor beendet' : 'Editor läuft noch'));
        }
        // Infobereich: ein Testprogramm legt ein Symbol an, ändert danach seinen Text (wie Discord) und schreibt jeden Klick mit
        const trayFile = path.join(out, 'tray.txt'), ps1 = path.join(out, 'trayicon.ps1');
        fs.writeFileSync(ps1, [
          '$ErrorActionPreference = "Stop"',
          'trap { $_ | Out-String | Add-Content -Path ($env:INSEL_TRAYFILE + ".err"); exit 1 }',
          'Write-Output "gestartet"',
          'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
          '$n = New-Object System.Windows.Forms.NotifyIcon',
          '$n.Icon = [System.Drawing.SystemIcons]::Information; $n.Text = "InselTest"; $n.Visible = $true; Write-Output ("sichtbar " + $n.Visible)',
          '$n.add_MouseClick({ param($s, $e) Add-Content -Path $env:INSEL_TRAYFILE -Value ([string]$e.Button) })',
          '$t1 = New-Object System.Windows.Forms.Timer; $t1.Interval = 4000; $t1.add_Tick({ $n.Text = "InselTest 2 neue"; $t1.Stop() }); $t1.Start()',
          '$t2 = New-Object System.Windows.Forms.Timer; $t2.Interval = 45000; $t2.add_Tick({ $n.Visible = $false; [System.Windows.Forms.Application]::Exit() }); $t2.Start()',
          '[System.Windows.Forms.Application]::Run()'].join('\r\n'));
        // windowsHide nur für Programme ohne eigenes Fenster: Windows wendet "versteckt" sonst auch auf deren erstes Fenster an
        const psRun = (file, logName, env, hide = true) => { const fd = fs.openSync(path.join(out, logName), 'a'); const c = require('child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', path.resolve(file)], { env: Object.assign({}, process.env, env || {}), stdio: ['ignore', fd, fd], windowsHide: hide }); c.unref(); return c; };
        const psLog = n => { try { return fs.readFileSync(path.join(out, n), 'utf8').replace(/\s+/g, ' ').trim().slice(0, 400); } catch (_) { return '(keine Ausgabe)'; } };
        psRun(ps1, 'trayicon.log', { INSEL_TRAYFILE: path.resolve(trayFile) });
        let ti = null;
        for (let k = 0; k < 30 && !ti; k++) { await wait(500); ti = (global.inselTray().icons || []).find(x => /InselTest/.test(x.title)); }
        if (!ti) {
          log2('Infobereich: Testsymbol nicht gefunden (' + (global.inselTray().icons || []).map(x => x.title).join(', ') + ')');
          try { log2('Infobereich: Fehler im Testprogramm: ' + fs.readFileSync(trayFile + '.err', 'utf8').replace(/\s+/g, ' ').slice(0, 300)); } catch (_) { log2('Infobereich: Testprogramm ohne Fehler'); }
          global.inselHelper({ c: 'traydiag' }); await wait(800);
          log2('Infobereich: Ausgabe Testprogramm: ' + psLog('trayicon.log'));
        }
        else {
          const id = ti.id;   // Kennung von vor der Textänderung
          await wait(5500);
          const read = () => { try { return fs.readFileSync(trayFile, 'utf8').trim().split(/\r?\n/).join(','); } catch (_) { return '-'; } };
          global.inselHelper({ c: 'tray', id, b: 'left' }); await wait(1500);
          const l = read();
          global.inselHelper({ c: 'tray', id, b: 'right' }); await wait(1500);
          log2('Infobereich: links=' + l + ' danach=' + read());
        }
        // Öffnen mit und Vorschau mehrerer Fenster (Editor mit einer Datei starten, zweite Datei "darauf ziehen")
        const eipc = require('electron').ipcMain;
        const t1 = path.resolve(out, 'insel-eins.txt'), t2 = path.resolve(out, 'insel-zwei.txt');
        fs.writeFileSync(t1, 'eins'); fs.writeFileSync(t2, 'zwei');
        require('child_process').spawn('notepad.exe', [t1], { detached: true, stdio: 'ignore' }).unref();
        const findNote = () => global.inselApps().others.findIndex(a => /notepad/i.test(a.exe || ''));
        let ni = -1;
        for (let k = 0; k < 20 && ni < 0; k++) { await wait(500); ni = findNote(); }
        if (ni < 0) log2('Öffnen mit: kein Editor gefunden');
        else {
          eipc.emit('open-with', {}, { kind: 'other', i: ni, paths: [t2] });
          let titles = '';
          for (let k = 0; k < 20; k++) { await wait(500); ni = findNote(); const g = global.inselApps().others[ni]; if (!g) continue; titles = global.inselWins().filter(w => g.wins.includes(w.h)).map(w => w.title).join(' / '); if (/insel-zwei/.test(titles)) break; }
          log2('Öffnen mit: ' + (/insel-zwei/.test(titles) ? 'ok' : 'fehlt') + ' (' + titles + ')');
          ni = findNote();
          const th = await win.webContents.executeJavaScript(`window.insel.winThumbs('other', ${ni}).then(l => l.length + ' Fenster, ' + l.filter(x => x.data).length + ' mit Bild')`);
          log2('Vorschau: ' + th);
          global.inselRefreshRecent(); await wait(2500);
          log2('Zuletzt: .txt öffnet ' + (global.inselAssoc('.txt') || '?') + ' | Menü Editor: ' + labels(global.inselMenus().app('other', ni)).split(' | ').slice(0, 4).join(' | '));
          global.inselHelper({ c: 'kill', h: global.inselApps().others[ni].wins });
          await wait(1000);
        }
        // Fortschrittsbalken am Symbol (wie bei einem Download)
        psRun(path.join(__dirname, 'test', 'progress.ps1'), 'progress.log', {}, false);
        let pg = null;
        let seenWin = 0;
        for (let k = 0; k < 90 && !pg; k++) { await wait(500); pg = [...global.inselTaskInfo().values()].find(x => x.prog > 0); if (!seenWin && global.inselWins().some(w => /InselFortschritt/.test(w.title))) seenWin = (k + 1) / 2; }
        log2('Fortschritt: Testfenster ' + (seenWin ? 'nach ' + seenWin + ' s' : 'nie') + ' gesehen');
        await wait(1500); pg = [...global.inselTaskInfo().values()].find(x => x.prog > 0) || pg;
        log2('Fortschritt: ' + (pg ? 'Status ' + pg.prog + ', ' + pg.val + ' % (roh ' + pg.raw + ')' : 'nicht empfangen') + ' | Ausgabe: ' + psLog('progress.log') + ' | Fenster: ' + (global.inselWins().some(w => /InselFortschritt/.test(w.title)) ? 'da' : 'fehlt'));
      } catch (e) { log2('Fehler ' + e.message); }
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
    // Häufigkeit: ein Programm aus dem Menü starten, danach muss es oben unter "Häufig verwendet" stehen
    if (process.env.INSEL_REAL) {
      const hlog = t => fs.appendFileSync(path.join(out, 'helper.log'), 'häufig: ' + t + '\n');
      try {
        const list = global.inselStartApps();
        const a = list.find(x => /^(editor|notepad|rechner|calculator|paint)$/i.test(x.name)) || list[Math.min(5, list.length - 1)];
        require('electron').ipcMain.emit('start-launch', {}, a.id);
        await wait(1500);
        await win.webContents.executeJavaScript(`document.querySelector('#island').dataset.state='idle'`); await wait(600);
        await win.webContents.executeJavaScript(`document.querySelector('[data-start]').click()`); await wait(3500);
        const top = await win.webContents.executeJavaScript(`(() => { const g = document.querySelector('#sGrid'); const h = g.querySelectorAll('.s-gh'); if (!h.length) return []; const out = []; for (let el = h[0].nextElementSibling; el && !el.classList.contains('s-gh'); el = el.nextElementSibling) out.push(el.title); return out; })()`);
        fs.writeFileSync(path.join(out, 'start-haeufig.png'), (await win.webContents.capturePage()).toPNG());
        hlog('gestartet=' + a.name + ' oben=' + top.join(', '));
        hlog(top.includes(a.name) ? 'ok' : 'fehlt');
      } catch (e) { hlog('Fehler ' + e.message); }
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
