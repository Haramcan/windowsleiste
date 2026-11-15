// Insel-Leiste: Hauptprozess. Ein durchsichtiges, immer sichtbares Fenster zeigt die Insel;
// ein kleiner Helfer (helper/InselHelper.exe) liefert Musik, Lautstärke und offene Fenster.
const { app, BrowserWindow, ipcMain, screen, shell, dialog, Menu, nativeImage, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const os = require('os');

const WIN_W = 820, WIN_H = 500;   // Fenster ist größer als die Insel, der Rest ist durchsichtig
const M = 24;                     // Rand um die Insel (Platz für den Schatten)
const IDLE_W = 232;

let win = null, helper = null, quitting = false;
let cfg = { pins: [], pos: null, locked: false, clear: false, winKey: true, note: '', hideTaskbar: true, glass: 'bild', frames: false, notify: { on: true, off: [] }, notifyApps: [],
            widgets: { clock: { on: false }, calendar: { on: false }, system: { on: false } } };
let lastTray = { t: 'tray', ok: false, icons: [] }, lastMic = { t: 'mic', has: false, muted: false };
let lastWindows = [], lastApps = { pins: [], others: [] }, drag = null, hiddenForFullscreen = false;
const iconCache = new Map();
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');

function loadCfg() {
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))); } catch (_) {}
  if (!Array.isArray(cfg.pins)) cfg.pins = [];
  if (cfg.glass === true) cfg.glass = 'bild';   // früher an/aus; neuer Standard ist das unscharfe Hintergrundbild
  if (!['bild', 'live'].includes(cfg.glass)) cfg.glass = false;
  if (!cfg.notify || !Array.isArray(cfg.notify.off)) cfg.notify = { on: true, off: [] };
  if (!Array.isArray(cfg.notifyApps)) cfg.notifyApps = [];
  if (!cfg.widgets) cfg.widgets = {};
  for (const k of Object.keys(WIDGETS)) if (!cfg.widgets[k]) cfg.widgets[k] = { on: false };
}
function saveCfg() {
  try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (_) {}
}
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// ---------- Position ----------
// pos.cx = Mitte der Insel, pos.y = Oberkante (anchor "top") bzw. Unterkante (anchor "bottom"), in Bildschirmkoordinaten.
function defaultPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { cx: Math.round(wa.x + wa.width / 2), y: wa.y + 12, anchor: 'top' };
}
const offscreen = () => win.setBounds({ x: -30000, y: -30000, width: WIN_W, height: WIN_H });
function applyPos() {
  if (hiddenForFullscreen && !peeking) return offscreen();
  if (!cfg.pos) cfg.pos = defaultPos();
  const p = cfg.pos;
  const disp = screen.getDisplayNearestPoint({ x: p.cx, y: p.y }), d = disp.bounds;
  p.cx = Math.min(Math.max(p.cx, d.x + IDLE_W / 2 + 8), d.x + d.width - IDLE_W / 2 - 8);
  p.y = Math.min(Math.max(p.y, d.y + 4), d.y + d.height - 4);
  const x = Math.round(p.cx - WIN_W / 2);
  const y = Math.round(p.anchor === 'bottom' ? p.y + M - WIN_H : p.y - M);
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
  send('layout', {
    anchor: p.anchor,
    insetL: Math.max(0, d.x - x),
    insetR: Math.max(0, x + WIN_W - (d.x + d.width)),
    win: { x, y, w: WIN_W, h: WIN_H },
    display: { id: String(disp.id), x: d.x, y: d.y, width: d.width, height: d.height }
  });
}

// ---------- Symbole ----------
async function fileIcon(file) {
  if (!file) return '';
  if (iconCache.has(file)) return iconCache.get(file);
  let url = '';
  try { url = (await app.getFileIcon(file, { size: 'large' })).toDataURL(); } catch (_) {}
  iconCache.set(file, url);
  return url;
}
async function pinIcon(pin) {
  if (/\.url$/i.test(pin.path)) {           // z. B. Steam-Verknüpfungen: Symbol steht in der Datei
    try {
      const m = /^IconFile=(.+)$/m.exec(fs.readFileSync(pin.path, 'utf8'));
      if (m && fs.existsSync(m[1].trim())) {
        const img = nativeImage.createFromPath(m[1].trim());
        if (!img.isEmpty()) return img.resize({ width: 48, height: 48 }).toDataURL();
      }
    } catch (_) {}
  }
  return fileIcon(pin.target || pin.path);
}

// ---------- Programme ----------
async function pushApps() {
  const mine = process.execPath.toLowerCase();
  const wins = lastWindows.filter(w => w.exe && w.exe.toLowerCase() !== mine);
  const used = new Set(), pins = [], groups = new Map();
  for (const p of cfg.pins) {
    const t = (p.target || '').toLowerCase();
    const ws = t ? wins.filter(w => w.exe.toLowerCase() === t) : [];
    ws.forEach(w => used.add(w.h));
    pins.push({ name: p.name, icon: await pinIcon(p), wins: ws.map(w => w.h), active: ws.some(w => w.active) });
  }
  for (const w of wins) {
    if (used.has(w.h)) continue;
    const k = w.exe.toLowerCase();
    if (!groups.has(k)) groups.set(k, { exe: w.exe, name: path.win32.basename(w.exe).replace(/\.exe$/i, ''), icon: await fileIcon(w.exe), wins: [], active: false });
    const g = groups.get(k);
    g.wins.push(w.h);
    if (w.active) g.active = true;
  }
  lastApps = { pins, others: [...groups.values()] };
  send('apps', lastApps);
}
function addPins(files) {
  for (const f of files) {
    if (!f || cfg.pins.some(p => p.path.toLowerCase() === f.toLowerCase())) continue;
    let target = '';
    if (/\.exe$/i.test(f)) target = f;
    else if (/\.lnk$/i.test(f)) { try { target = shell.readShortcutLink(f).target || ''; } catch (_) {} }
    cfg.pins.push({ name: path.basename(f).replace(/\.(exe|lnk|url)$/i, ''), path: f, target });
  }
  saveCfg(); pushApps();
}

// ---------- Helfer ----------
function helperPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'helper', 'InselHelper.exe')
                        : path.join(__dirname, 'helper-bin', 'InselHelper.exe');
}
function sendHelper(cmd) { if (helper) { try { helper.stdin.write(JSON.stringify(cmd) + '\n'); } catch (_) {} } }
function startHelper() {
  const file = helperPath();
  if (process.platform !== 'win32' || !fs.existsSync(file)) return;
  helper = spawn(file, [String(process.pid)], { windowsHide: true });
  if (process.env.INSEL_SHOT) {
    const log = t => { try { fs.appendFileSync(path.join(process.env.INSEL_SHOT, 'helper.log'), t + '\n'); } catch (_) {} };
    log('gestartet: ' + file);
    helper.stderr.on('data', d => log('stderr: ' + d));
    helper.on('exit', code => log('beendet mit Code ' + code));
  }
  helper.on('error', () => { helper = null; });
  helper.on('exit', () => { helper = null; if (!quitting) setTimeout(startHelper, 2000); });
  readline.createInterface({ input: helper.stdout }).on('line', line => {
    let ev; try { ev = JSON.parse(line); } catch (_) { return; }
    if (process.env.INSEL_SHOT) { try { fs.appendFileSync(path.join(process.env.INSEL_SHOT, 'helper.log'), 'helper: ' + ev.t + (ev.t === 'error' ? ' ' + ev.m : '') + '\n'); } catch (_) {} }
    if (ev.t === 'windows') { lastWindows = ev.list || []; pushApps(); }
    else if (ev.t === 'tray') { lastTray = ev; send('ev', ev); }
    else if (ev.t === 'mic') { lastMic = ev; send('ev', ev); }
    else if (ev.t === 'winkey') {
      // Auch im Vollbild: Insel hervorholen und ihr Menü öffnen
      if (hiddenForFullscreen && !peeking) { peeking = true; awaySince = 0; applyPos(); send('ev', { t: 'visible', on: true }); }
      send('ev', ev);
    }
    else if (ev.t === 'appicon') { const w = iconWait.get(ev.id); if (w) { iconWait.delete(ev.id); startIcons.set(ev.id, ev.data || ''); w(ev.data || ''); } }
    else if (ev.t === 'hello') { for (const k of Object.keys(widgetWins)) sinkWidget(k); }
    else if (ev.t === 'fullscreen') { if (!process.env.INSEL_SHOT) setHidden(!!ev.on); }   // im Probelauf steuert der Test das selbst
    else if (ev.t === 'notif') {
      const name = ev.app || 'Unbekannt';
      if (!cfg.notifyApps.includes(name)) { cfg.notifyApps.push(name); saveCfg(); send('ev', notifyState()); }
      if (cfg.notify.on && !cfg.notify.off.includes(name)) send('ev', ev);
    }
    else send('ev', ev);
  });
  if (cfg.hideTaskbar) sendHelper({ c: 'taskbar', hide: true });
  if (cfg.frames) sendHelper({ c: 'frames', on: true });
  sendHelper({ c: 'notify', on: !!cfg.notify.on });
  sendHelper({ c: 'winkey', on: !!cfg.winKey });
}
const notifyState = () => ({ t: 'notifyState', on: !!cfg.notify.on, apps: cfg.notifyApps.map(n => ({ name: n, on: !cfg.notify.off.includes(n) })) });

// Bei Vollbild verstecken und danach wieder zeigen.
function setHidden(on) {
  hiddenForFullscreen = on;
  peeking = false; edgeSince = 0; drag = null;
  if (win && !win.isDestroyed()) applyPos();   // schiebt die Insel aus dem Bild oder zurück an ihren Platz
  send('ev', { t: 'visible', on: !on });
}
if (process.env.INSEL_SHOT) global.inselSetHidden = setHidden;

// Vollbild (Spiel, Video): Die Insel ist weg, kommt aber zurück, wenn die Maus kurz am Bildschirmrand bei ihr anstößt.
let peeking = false, edgeSince = 0, awaySince = 0;
setInterval(() => {
  if (!win || win.isDestroyed() || !hiddenForFullscreen || !cfg.pos) return;
  const c = screen.getCursorScreenPoint(), now = Date.now();
  const d = screen.getDisplayNearestPoint({ x: cfg.pos.cx, y: cfg.pos.y }).bounds;
  if (!peeking) {
    const atEdge = cfg.pos.anchor === 'bottom' ? c.y >= d.y + d.height - 2 : c.y <= d.y + 1;
    const near = Math.abs(c.x - cfg.pos.cx) < 220 && c.x >= d.x && c.x < d.x + d.width;
    if (atEdge && near) {
      if (!edgeSince) edgeSince = now;
      else if (now - edgeSince > 300) { peeking = true; awaySince = 0; applyPos(); send('ev', { t: 'visible', on: true }); }
    } else edgeSince = 0;
  } else {
    const b = win.getBounds(), r = islandRect;
    const inside = r && c.x >= b.x + r.left - 40 && c.x <= b.x + r.left + r.width + 40 && c.y >= b.y + r.top - 40 && c.y <= b.y + r.top + r.height + 40;
    if (inside || win.isFocused()) awaySince = 0;
    else if (!awaySince) awaySince = now;
    else if (now - awaySince > 1200) { peeking = false; edgeSince = 0; applyPos(); send('ev', { t: 'visible', on: false }); }
  }
}, 100);

// ---------- Widgets: kleine Glaskarten direkt auf dem Desktop ----------
const WIDGETS = { clock: { w: 232, h: 132 }, calendar: { w: 232, h: 268 }, system: { w: 232, h: 150 } };
const widgetWins = {};
const widgetState = () => Object.keys(WIDGETS).map(k => ({ name: k, on: !!(cfg.widgets[k] && cfg.widgets[k].on) }));
function sinkWidget(name) {
  const w = widgetWins[name];
  if (!w || w.isDestroyed() || process.platform !== 'win32') return;
  try { sendHelper({ c: 'bottom', h: Number(w.getNativeWindowHandle().readBigUInt64LE(0)) }); } catch (_) {}
}
function openWidget(name) {
  if (widgetWins[name] && !widgetWins[name].isDestroyed()) return;
  const size = WIDGETS[name], c = cfg.widgets[name];
  const wa = screen.getPrimaryDisplay().workArea;
  if (typeof c.x !== 'number') {
    const i = Object.keys(WIDGETS).indexOf(name);
    c.x = wa.x + 24; c.y = wa.y + 80 + [0, 290, 140][i];
    if (name === 'calendar') { c.x = wa.x + 24 + 240; c.y = wa.y + 80; }
  }
  const w = new BrowserWindow({
    x: c.x, y: c.y, width: size.w, height: size.h, show: false,
    frame: false, transparent: true, resizable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, fullscreenable: false, maximizable: false, minimizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload-widget.js'), backgroundThrottling: false }
  });
  widgetWins[name] = w;
  w.loadFile(path.join(__dirname, 'renderer', 'widget.html'), { hash: name });
  w.once('ready-to-show', () => { w.showInactive(); sinkWidget(name); });
  w.on('moved', () => { const b = w.getBounds(); c.x = b.x; c.y = b.y; saveCfg(); });
  w.on('closed', () => { delete widgetWins[name]; });
}
function closeWidget(name) { const w = widgetWins[name]; if (w && !w.isDestroyed()) w.destroy(); }

// Auslastung für das System-Widget
let cpuPrev = null;
function sysStats() {
  const t = os.cpus().reduce((a, c) => { const s = c.times; a.idle += s.idle; a.all += s.user + s.nice + s.sys + s.irq + s.idle; return a; }, { idle: 0, all: 0 });
  let cpu = 0;
  if (cpuPrev && t.all > cpuPrev.all) cpu = 1 - (t.idle - cpuPrev.idle) / (t.all - cpuPrev.all);
  cpuPrev = t;
  const total = os.totalmem(), used = total - os.freemem();
  return { cpu: Math.max(0, Math.min(1, cpu)), ram: used / total, ramUsed: used / 2 ** 30, ramTotal: total / 2 ** 30 };
}
setInterval(() => {
  const w = widgetWins.system;
  if (w && !w.isDestroyed()) w.webContents.send('stats', sysStats());
}, 2000);

// ---------- Fenster ----------
// Milchglas: Die Insel selbst darf in der Bildschirmaufnahme nicht auftauchen, sonst spiegelt sie sich im Glas.
// Windows übernimmt das nur zuverlässig, wenn es bei sichtbarem Fenster gesetzt wird (im Probelauf gemessen).
function protect() {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(false);
  win.setContentProtection(false);
  win.setContentProtection(cfg.glass === 'live');
  win.setIgnoreMouseEvents(true, { forward: true });
}
function createWindow() {
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, show: false,
    frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, fullscreenable: false, maximizable: false, minimizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { applyPos(); win.showInactive(); protect(); });
  win.on('blur', () => send('ev', { t: 'blur' }));
  screen.on('display-metrics-changed', applyPos);
  screen.on('display-removed', applyPos);
}

ipcMain.handle('ready', () => {
  setImmediate(() => { applyPos(); pushApps(); send('ev', lastTray); send('ev', lastMic); send('ev', updateState); });
  return { hideTaskbar: !!cfg.hideTaskbar, autostart: app.getLoginItemSettings().openAtLogin, hasHelper: !!helper, margin: M,
           glass: cfg.glass, wall: wallpaperUrl(), locked: !!cfg.locked, clear: !!cfg.clear, winKey: !!cfg.winKey, note: String(cfg.note || ''), frames: !!cfg.frames, notify: notifyState(), widgets: widgetState() };
});

// Milchglas: Die Oberfläche bekommt ein kleines Live-Bild des Bildschirms und zeichnet es unscharf hinter die Insel.
ipcMain.handle('glass-source', async (_e, displayId) => {
  if (cfg.glass !== 'live') return null;
  try {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const s = list.find(x => String(x.display_id) === String(displayId)) || list[0];
    return s ? s.id : null;
  } catch (_) { return null; }
});
ipcMain.on('set-glass', (_e, mode) => {
  cfg.glass = ['bild', 'live'].includes(mode) ? mode : false; saveCfg();
  // nur das Live-Milchglas versteckt die Insel vor Aufnahmen (die Maus ist beim Umschalten über der Insel)
  win.setIgnoreMouseEvents(false); win.setContentProtection(false); win.setContentProtection(cfg.glass === 'live');
});

// Unscharfes Hintergrundbild: Windows legt das aktuelle Bild als Kopie ab; wir verkleinern es stark.
const wallFile = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
let wallCache = { m: -1, url: '' };
function wallpaperUrl() {
  try {
    const m = fs.statSync(wallFile()).mtimeMs;
    if (m !== wallCache.m) {
      const img = nativeImage.createFromBuffer(fs.readFileSync(wallFile()));
      wallCache = { m, url: img.isEmpty() ? '' : 'data:image/jpeg;base64,' + img.resize({ width: 640 }).toJPEG(72).toString('base64') };
    }
  } catch (_) { wallCache = { m: -1, url: '' }; }
  return wallCache.url;
}
setInterval(() => { const before = wallCache.url, now = wallpaperUrl(); if (now !== before) send('ev', { t: 'wall', data: now }); }, 4000);
ipcMain.on('set-winkey', (_e, b) => { cfg.winKey = !!b; saveCfg(); sendHelper({ c: 'winkey', on: cfg.winKey }); });
ipcMain.on('mic-toggle', () => sendHelper({ c: 'micmute' }));
ipcMain.on('snip', () => setTimeout(() => sendHelper({ c: 'snip' }), 350));
ipcMain.on('mixer', (_e, on) => sendHelper({ c: 'mixer', on: !!on }));
ipcMain.on('app-vol', (_e, { name, v }) => sendHelper({ c: 'appvol', name: String(name), v: Math.max(0, Math.min(1, +v || 0)) }));
let noteT = null;
ipcMain.on('note-save', (_e, text) => { cfg.note = String(text || '').slice(0, 20000); clearTimeout(noteT); noteT = setTimeout(saveCfg, 600); });
ipcMain.on('pin-move', (_e, { from, to }) => {
  if (!cfg.pins[from] || to < 0 || to >= cfg.pins.length || from === to) return;
  cfg.pins.splice(to, 0, cfg.pins.splice(from, 1)[0]); saveCfg(); pushApps();
});
ipcMain.on('set-locked', (_e, b) => { cfg.locked = !!b; saveCfg(); });
ipcMain.on('set-clear', (_e, b) => { cfg.clear = !!b; saveCfg(); });

// ---------- Eigenes Startmenü ----------
// Liste aller Programme, wie sie auch das Windows-Startmenü kennt (inklusive Store-Apps).
let startApps = [], startAppsAt = 0, startLoading = null;
const startIcons = new Map(), iconWait = new Map();
function loadStartApps() {
  if (process.platform !== 'win32') return Promise.resolve(startApps);
  if (startLoading) return startLoading;
  startLoading = new Promise(resolve => {
    let out = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Sort-Object Name | ConvertTo-Json -Compress'], { windowsHide: true });
    ps.stdout.on('data', d => { out += d.toString('utf8'); });
    const done = () => {
      try {
        let list = JSON.parse(out); if (!Array.isArray(list)) list = [list];
        const seen = new Set();
        startApps = list.filter(a => a && a.Name && a.AppID && !/uninstall|deinstall|entfernen/i.test(a.Name))
          .filter(a => !seen.has(a.Name) && seen.add(a.Name)).map(a => ({ name: a.Name, id: a.AppID }));
        startAppsAt = Date.now();
      } catch (_) {}
      startLoading = null; resolve(startApps);
    };
    ps.on('error', done); ps.on('close', done);
  });
  return startLoading;
}
ipcMain.handle('start-apps', async () => {
  if (!startApps.length) await loadStartApps();
  else if (Date.now() - startAppsAt > 120000) loadStartApps();
  return startApps;
});
ipcMain.handle('start-icons', async (_e, ids) => {
  const res = {};
  await Promise.all((ids || []).slice(0, 60).map(id => new Promise(resolve => {
    if (startIcons.has(id)) { res[id] = startIcons.get(id); return resolve(); }
    if (!helper) { res[id] = ''; return resolve(); }
    const t = setTimeout(() => { iconWait.delete(id); res[id] = ''; resolve(); }, 4000);
    iconWait.set(id, data => { clearTimeout(t); res[id] = data; resolve(); });
    sendHelper({ c: 'appicon', id });
  })));
  return res;
});
ipcMain.on('start-launch', (_e, id) => {
  if (!startApps.some(a => a.id === id)) return;
  try { spawn('explorer.exe', ['shell:AppsFolder\\' + id], { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
});
ipcMain.on('power', (_e, kind) => {
  const run = (cmd, args) => { try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (_) {} };
  if (kind === 'lock') run('rundll32.exe', ['user32.dll,LockWorkStation']);
  else if (kind === 'restart') { cleanup(); run('shutdown.exe', ['/r', '/t', '0']); }
  else if (kind === 'off') { cleanup(); run('shutdown.exe', ['/s', '/t', '0']); }
});
// Für die Suche braucht die Insel kurz die Tastatur; sonst nimmt sie anderen Fenstern nie den Fokus weg.
ipcMain.on('focus', (_e, b) => {
  if (!win || win.isDestroyed()) return;
  if (b) {
    win.setFocusable(true); win.setIgnoreMouseEvents(false); win.focus();
    try { sendHelper({ c: 'fg', h: Number(win.getNativeWindowHandle().readBigUInt64LE(0)) }); } catch (_) {}
  }
  else { win.blur(); win.setFocusable(false); }
});
ipcMain.on('set-frames', (_e, b) => { cfg.frames = !!b; saveCfg(); sendHelper({ c: 'frames', on: cfg.frames }); });
ipcMain.on('set-theme', (_e, light) => sendHelper({ c: 'theme', light: !!light }));
ipcMain.on('desk-icons', () => sendHelper({ c: 'deskicons' }));
ipcMain.on('wallpaper', async () => {
  const r = await dialog.showOpenDialog({ title: 'Hintergrundbild wählen', properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }] });
  if (!r.canceled && r.filePaths[0]) sendHelper({ c: 'wallpaper', path: r.filePaths[0] });
});
ipcMain.on('tray-click', (_e, { id, b }) => sendHelper({ c: 'tray', id: String(id), b: b === 'right' ? 'right' : 'left' }));
ipcMain.on('set-widget', (_e, { name, on }) => {
  if (!WIDGETS[name]) return;
  cfg.widgets[name].on = !!on; saveCfg();
  if (on) openWidget(name); else closeWidget(name);
});
ipcMain.on('set-notify', (_e, b) => { cfg.notify.on = !!b; saveCfg(); sendHelper({ c: 'notify', on: cfg.notify.on }); send('ev', notifyState()); });
ipcMain.on('set-notify-app', (_e, { name, on }) => {
  cfg.notify.off = cfg.notify.off.filter(n => n !== name);
  if (!on) cfg.notify.off.push(name);
  saveCfg(); send('ev', notifyState());
});
ipcMain.on('ignore', (_e, b) => { if (!drag) win.setIgnoreMouseEvents(!!b, { forward: true }); });

// Sicherheitsnetz: Liegt der Mauszeiger über der Insel, nimmt das Fenster Klicks an, egal was vorher war.
// (Nach einem Vollbild-Spiel kam das Signal der Oberfläche sonst manchmal nicht mehr an.)
let islandRect = null;
ipcMain.on('rect', (_e, r) => { islandRect = r; });
setInterval(() => {
  if (!win || win.isDestroyed() || !win.isVisible() || drag || !islandRect) return;
  const c = screen.getCursorScreenPoint(), b = win.getBounds();
  const x = c.x - b.x, y = c.y - b.y, r = islandRect;
  if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) win.setIgnoreMouseEvents(false);
}, 120);
ipcMain.on('helper', (_e, cmd) => {
  if (cmd && ['media', 'volume', 'mute', 'start'].includes(cmd.c)) sendHelper(cmd);
});
ipcMain.on('app-click', (_e, { kind, i }) => {
  const a = (kind === 'pin' ? lastApps.pins : lastApps.others)[i];
  if (!a) return;
  if (a.wins.length) sendHelper({ c: 'activate', h: a.wins[0] });
  else if (kind === 'pin' && cfg.pins[i]) shell.openPath(cfg.pins[i].path).then(err => { if (err) send('ev', { t: 'toast', m: 'Konnte nicht gestartet werden: ' + cfg.pins[i].name }); });
});
ipcMain.on('app-menu', (_e, { kind, i }) => {
  const items = [];
  if (kind === 'pin' && cfg.pins[i]) items.push({ label: 'Von der Insel lösen', click: () => { cfg.pins.splice(i, 1); saveCfg(); pushApps(); } });
  if (kind === 'other' && lastApps.others[i]) { const exe = lastApps.others[i].exe; items.push({ label: 'An die Insel anheften', click: () => addPins([exe]) }); }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
});
ipcMain.on('pin-add', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Programm oder Spiel anheften',
    properties: ['openFile', 'multiSelections', 'noResolveAliases'],
    filters: [{ name: 'Programme und Verknüpfungen', extensions: ['exe', 'lnk', 'url'] }]
  });
  if (!r.canceled) addPins(r.filePaths);
});
ipcMain.on('set-hide-taskbar', (_e, b) => { cfg.hideTaskbar = !!b; saveCfg(); sendHelper({ c: 'taskbar', hide: cfg.hideTaskbar }); });
ipcMain.on('set-autostart', (_e, b) => { app.setLoginItemSettings({ openAtLogin: !!b }); });
// Aufräumen: alte Taskleiste und Fensterrahmen zurückgeben, Helfer beenden.
function cleanup() {
  if (quitting) return;
  quitting = true;
  sendHelper({ c: 'taskbar', hide: false });
  sendHelper({ c: 'frames', on: false });
  if (helper) { try { helper.stdin.end(); } catch (_) {} }
}
ipcMain.on('quit', () => { cleanup(); setTimeout(() => app.exit(0), 900); });   // sicher beenden, auch wenn etwas hängt

// Verschieben: Das Fenster folgt dem Mauszeiger, die Insel bleibt im Fenster an ihrem Platz.
ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint(), b = win.getBounds();
  drag = { cx: c.x, cy: c.y, x: b.x, y: b.y };
  send('layout', { anchor: cfg.pos.anchor, insetL: 0, insetR: 0 });
});
ipcMain.on('drag-move', () => {
  if (!drag) return;
  const c = screen.getCursorScreenPoint();
  const x = drag.x + c.x - drag.cx, y = drag.y + c.y - drag.cy;
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
  send('winpos', { x, y });
});
ipcMain.on('drag-end', (_e, rect) => {
  if (!drag) return;
  drag = null;
  const b = win.getBounds();
  const top = b.y + rect.top, cx = b.x + rect.left + rect.width / 2;
  const d = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(top) }).bounds;
  const anchor = top + rect.height / 2 > d.y + d.height / 2 ? 'bottom' : 'top';
  cfg.pos = { cx: Math.round(cx), y: Math.round(anchor === 'bottom' ? top + rect.height : top), anchor };
  saveCfg(); applyPos();
});

// ---------- Updates ----------
// Die Insel holt neue Versionen selbst von GitHub; installiert wird per Klick oder beim nächsten Beenden.
let updater = null, updateState = { t: 'update', state: 'idle', version: app.getVersion(), next: '' };
function setUpdate(state, next) { updateState = { t: 'update', state, version: app.getVersion(), next: next || updateState.next }; send('ev', updateState); }
function initUpdates() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true; updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => setUpdate('checking'));
    updater.on('update-available', i => setUpdate('loading', i.version));
    updater.on('update-not-available', () => setUpdate('current'));
    updater.on('update-downloaded', i => setUpdate('ready', i.version));
    updater.on('error', () => setUpdate('error'));
    const check = () => { updater.checkForUpdates().catch(() => setUpdate('error')); };
    setTimeout(check, 8000); setInterval(check, 60 * 60 * 1000);
  } catch (_) { updater = null; }
}
ipcMain.on('update-check', () => { if (updater && updateState.state !== 'loading' && updateState.state !== 'ready') updater.checkForUpdates().catch(() => setUpdate('error')); });
ipcMain.on('update-install', () => {
  if (!updater || updateState.state !== 'ready') return;
  cleanup();
  setTimeout(() => { try { updater.quitAndInstall(true, true); } catch (_) {} setTimeout(() => app.exit(0), 4000); }, 600);
});

// Animationen sollen nie gedrosselt werden, auch wenn die Insel nie den Fokus hat.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    loadCfg(); createWindow(); startHelper(); loadStartApps(); initUpdates();
    // Notausgang: Strg+Umschalt+F12 beendet die Insel immer und holt die alte Taskleiste zurück.
    try { globalShortcut.register('Control+Shift+F12', () => { cleanup(); setTimeout(() => app.exit(0), 900); }); } catch (_) {}
    for (const k of Object.keys(WIDGETS)) if (cfg.widgets[k].on) openWidget(k);
    if (process.env.INSEL_SHOT) require('./dev-shot')(win);   // nur für Entwickler-Bildschirmfotos
  });
  app.on('before-quit', () => {
    cleanup();
  });
  app.on('window-all-closed', () => { if (!win || win.isDestroyed()) app.quit(); });
}
