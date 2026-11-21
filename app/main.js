// Insel-Leiste: Hauptprozess. Ein durchsichtiges, immer sichtbares Fenster zeigt die Insel;
// ein kleiner Helfer (helper/InselHelper.exe) liefert Musik, Lautstärke und offene Fenster.
const { app, BrowserWindow, ipcMain, screen, shell, dialog, Menu, nativeImage, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const os = require('os');

const WIN_W = 900, WIN_H = 560;   // Fenster ist größer als die Insel, der Rest ist durchsichtig
const M = 24;                     // Rand um die Insel (Platz für den Schatten)
const IDLE_W = 232;
// Größe der Insel: Alles wird um diesen Faktor vergrößert, das Fenster wächst mit.
const SCALES = [0.85, 1, 1.15, 1.3];
const Z = () => (SCALES.includes(cfg.scale) ? cfg.scale : 1);
const W = () => Math.round(WIN_W * Z()), H = () => Math.round(WIN_H * Z());

let win = null, helper = null, quitting = false;
let cfg = { pins: [], pos: null, usage: {}, autoHide: false, scale: 1, micKey: true, locked: false, clear: false, winKey: true, hideFullscreen: true, note: '', hideTaskbar: true, glass: 'bild', frames: false, notify: { on: true, off: [] }, notifyApps: [],
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
// Kleines Protokoll für die Fehlersuche (wann und warum sich die Insel versteckt hat)
let fullscreenNow = false;
function logLine(text) {
  try {
    const file = path.join(app.getPath('userData'), 'insel.log');
    try { if (fs.statSync(file).size > 200000) fs.renameSync(file, file + '.alt'); } catch (_) {}
    fs.appendFileSync(file, new Date().toISOString() + ' ' + text + '\n');
  } catch (_) {}
}
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// ---------- Position ----------
// pos.cx = Mitte der Insel, pos.y = Oberkante (anchor "top") bzw. Unterkante (anchor "bottom"), in Bildschirmkoordinaten.
function defaultPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { cx: Math.round(wa.x + wa.width / 2), y: wa.y + 12, anchor: 'top' };
}
const offscreen = () => win.setBounds({ x: -30000, y: -30000, width: W(), height: H() });
function applyPos() {
  if (hiddenForFullscreen && !peeking) return offscreen();
  if (!cfg.pos) cfg.pos = defaultPos();
  const p = cfg.pos;
  const disp = screen.getDisplayNearestPoint({ x: p.cx, y: p.y }), d = disp.bounds;
  const z = Z(), idle = IDLE_W * z;
  p.cx = Math.min(Math.max(p.cx, d.x + idle / 2 + 8), d.x + d.width - idle / 2 - 8);
  p.y = Math.min(Math.max(p.y, d.y + 4), d.y + d.height - 4);
  const x = Math.round(p.cx - W() / 2);
  const y = Math.round(p.anchor === 'bottom' ? p.y + M * z - H() : p.y - M * z);
  win.setBounds({ x, y, width: W(), height: H() });
  send('layout', {
    anchor: p.anchor,
    insetL: Math.max(0, d.x - x) / z,
    insetR: Math.max(0, x + W() - (d.x + d.width)) / z,
    z,
    win: { x, y, w: W(), h: H() },
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
// Was die Fenster eines Programms ihrem Taskleisten-Symbol melden
let taskInfo = new Map();
function taskState(wins) {
  const infos = wins.map(h => taskInfo.get(h)).filter(Boolean);
  const p = infos.find(x => x.prog > 0), b = infos.find(x => x.badge);
  return { flash: infos.some(x => x.flash), prog: p ? p.prog : 0, val: p ? p.val : 0, badge: b ? b.badge : '', badgeText: b ? b.badgeText : '' };
}
async function pushApps() {
  const mine = process.execPath.toLowerCase();
  const wins = lastWindows.filter(w => w.exe && w.exe.toLowerCase() !== mine);
  const used = new Set(), pins = [], groups = new Map();
  for (const p of cfg.pins) {
    const t = (p.target || '').toLowerCase();
    const ws = t ? wins.filter(w => w.exe.toLowerCase() === t) : [];
    ws.forEach(w => used.add(w.h));
    pins.push(Object.assign({ name: p.name, icon: await pinIcon(p), wins: ws.map(w => w.h), active: ws.some(w => w.active) }, taskState(ws.map(w => w.h))));
  }
  for (const w of wins) {
    if (used.has(w.h)) continue;
    const k = w.exe.toLowerCase();
    if (!groups.has(k)) groups.set(k, { exe: w.exe, name: path.win32.basename(w.exe).replace(/\.exe$/i, ''), icon: await fileIcon(w.exe), wins: [], active: false });
    const g = groups.get(k);
    g.wins.push(w.h);
    if (w.active) g.active = true;
  }
  for (const g of groups.values()) Object.assign(g, taskState(g.wins));
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
    if (process.env.INSEL_SHOT) { try { fs.appendFileSync(path.join(process.env.INSEL_SHOT, 'helper.log'), 'helper: ' + ev.t + (ev.t === 'error' ? ' ' + ev.m : '') + (ev.err ? ' ' + ev.err : '') + (ev.t === 'traydiag' ? ' ' + JSON.stringify(ev) : '') + '\n'); } catch (_) {} }
    if (ev.t === 'windows') { lastWindows = ev.list || []; pushApps(); }
    else if (ev.t === 'tray') { lastTray = ev; send('ev', ev); }
    else if (ev.t === 'taskinfo') { taskInfo = new Map((ev.list || []).map(x => [x.h, x])); pushApps(); }
    else if (ev.t === 'assoc') { Object.entries(ev.map || {}).forEach(([k, v]) => assocMap.set(k, String(v || '').toLowerCase())); }
    else if (ev.t === 'mic') { lastMic = ev; send('ev', ev); }
    else if (ev.t === 'winkey') onWinKey();
    else if (ev.t === 'search') { if (ev.err) logLine('Dateisuche: ' + ev.err); const w = searchWait.get(ev.id); if (w) { searchWait.delete(ev.id); w(ev.items || []); } }
    else if (ev.t === 'winthumb') { const w = thumbWait.get(ev.h); if (w) { thumbWait.delete(ev.h); w(ev.data || ''); } }
    else if (ev.t === 'media' || ev.t === 'thumb') { if (ev.t === 'media') lastMedia = ev; else lastThumb = ev; send('ev', ev); toWidget('music', ev); }
    else if (ev.t === 'appicon') { const w = iconWait.get(ev.id); if (w) { iconWait.delete(ev.id); startIcons.set(ev.id, ev.data || ''); w(ev.data || ''); } }
    else if (ev.t === 'hello') { for (const k of Object.keys(widgetWins)) sinkWidget(k); sendHelper({ c: 'usage' }); }
    else if (ev.t === 'usage') { winUsage = new Map((ev.list || []).map(u => [String(u.id).toLowerCase(), u])); }
    else if (ev.t === 'fullscreen') {
      logLine('Vollbild ' + (ev.on ? 'an' : 'aus') + (ev.why ? ' (' + ev.why + ')' : ''));
      fullscreenNow = !!ev.on;
      if (!process.env.INSEL_SHOT) updateHidden();   // im Probelauf steuert der Test das selbst
    }
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

// Windows-Taste: Menü der Insel öffnen oder schließen. Auch im Vollbild: Insel vorher hervorholen.
function onWinKey() {
  if (hiddenForFullscreen && !peeking) { peeking = true; awaySince = 0; applyPos(); send('ev', { t: 'visible', on: true }); }
  send('ev', { t: 'winkey' });
}
if (process.env.INSEL_SHOT) global.inselWinKey = onWinKey;

// Verstecken bei Vollbild oder wenn "Automatisch ausblenden" an ist; die Maus am Rand holt die Insel zurück.
const fullHide = () => fullscreenNow && cfg.hideFullscreen !== false;
function updateHidden() { setHidden(fullHide() || !!cfg.autoHide); }
function setHidden(on, force) {
  if (on === hiddenForFullscreen && !force) return;   // nichts geändert: eine geöffnete Insel nicht wegnehmen
  hiddenForFullscreen = on;
  peeking = false; edgeSince = 0; drag = null;
  if (win && !win.isDestroyed()) applyPos();   // schiebt die Insel aus dem Bild oder zurück an ihren Platz
  send('ev', { t: 'visible', on: !on });
}
if (process.env.INSEL_SHOT) {
  global.inselSetHidden = setHidden;
  global.inselFullscreen = on => { fullscreenNow = on; updateHidden(); };
  global.inselPos = () => cfg.pos;
}

// Vollbild (Spiel, Video): Die Insel ist weg, kommt aber zurück, wenn die Maus kurz am Bildschirmrand bei ihr anstößt.
let peeking = false, edgeSince = 0, awaySince = 0, flashUntil = 0;
function peek() { peeking = true; awaySince = 0; applyPos(); send('ev', { t: 'visible', on: true }); }
// Kurz zeigen (Lautstärke, Mitteilung), wenn die Insel nur wegen "Automatisch ausblenden" weg ist – nie über einem Spiel.
ipcMain.on('flash', (_e, ms) => {
  if (!hiddenForFullscreen || fullHide()) return;
  flashUntil = Date.now() + Math.max(0, Math.min(8000, +ms || 0));
  if (!peeking) peek();
});
setInterval(() => {
  if (!win || win.isDestroyed() || !hiddenForFullscreen || !cfg.pos) return;
  const c = screen.getCursorScreenPoint(), now = Date.now();
  const d = screen.getDisplayNearestPoint({ x: cfg.pos.cx, y: cfg.pos.y }).bounds;
  if (!peeking) {
    const auto = !fullHide(), z = Z(), half = 175 * z + 16, bottom = cfg.pos.anchor === 'bottom';
    const atEdge = bottom ? c.y >= d.y + d.height - 2 : c.y <= d.y + 1;
    const near = Math.abs(c.x - cfg.pos.cx) < (auto ? half : 220) && c.x >= d.x && c.x < d.x + d.width;
    // bei "Automatisch ausblenden" reicht es auch, kurz dort zu verweilen, wo die Insel sonst sitzt
    const inZone = auto && Math.abs(c.x - cfg.pos.cx) < half - 6 && (bottom ? c.y >= cfg.pos.y - 56 * z : c.y <= cfg.pos.y + 56 * z) && c.y >= d.y && c.y < d.y + d.height;
    const need = atEdge && near ? (auto ? 120 : 300) : inZone ? 450 : -1;
    if (need >= 0) {
      if (!edgeSince) edgeSince = now;
      else if (now - edgeSince > need) peek();
    } else edgeSince = 0;
  } else {
    const b = win.getBounds(), r = islandRect;
    const inside = r && c.x >= b.x + r.left - 40 && c.x <= b.x + r.left + r.width + 40 && c.y >= b.y + r.top - 40 && c.y <= b.y + r.top + r.height + 40;
    if (inside || win.isFocused() || now < flashUntil) awaySince = 0;
    else if (!awaySince) awaySince = now;
    else if (now - awaySince > 1200) { peeking = false; edgeSince = 0; applyPos(); send('ev', { t: 'visible', on: false }); }
  }
}, 100);

// ---------- Widgets: kleine Glaskarten direkt auf dem Desktop ----------
const WIDGETS = { clock: { w: 232, h: 132 }, calendar: { w: 232, h: 268 }, system: { w: 232, h: 150 }, music: { w: 300, h: 150 }, note: { w: 232, h: 210 } };
let lastMedia = { t: 'media', has: false }, lastThumb = { t: 'thumb', data: '' };
function toWidget(name, data) { const w = widgetWins[name]; if (w && !w.isDestroyed()) w.webContents.send('data', data); }
// Jedes Widget bekommt das Hintergrundbild und seine Lage, damit es dieses unscharf hinter sich zeigen kann.
function widgetGeo(name) {
  const w = widgetWins[name]; if (!w || w.isDestroyed()) return;
  const b = w.getBounds(), d = screen.getDisplayMatching(b).bounds;
  w.webContents.send('data', { t: 'geo', x: d.x - b.x, y: d.y - b.y, w: d.width, h: d.height, wall: cfg.glass ? wallpaperUrl() : '' });
}
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
    c.x = wa.x + 24; c.y = wa.y + 80 + [0, 290, 140, 300, 460][i];
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
  w.webContents.on('did-finish-load', () => {
    widgetGeo(name);
    if (name === 'music') { toWidget(name, lastMedia); toWidget(name, lastThumb); }
    if (name === 'note') toWidget(name, { t: 'note', text: String(cfg.note || '') });
  });
  w.on('move', () => widgetGeo(name));
  w.on('moved', () => { const b = w.getBounds(); c.x = b.x; c.y = b.y; saveCfg(); widgetGeo(name); });
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
    width: W(), height: H(), show: false,
    frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, fullscreenable: false, maximizable: false, minimizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { applyPos(); win.showInactive(); protect(); });
  win.on('blur', () => send('ev', { t: 'blur' }));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(Z()));
  screen.on('display-metrics-changed', applyPos);
  screen.on('display-removed', applyPos);
}

ipcMain.handle('ready', () => {
  setImmediate(() => { applyPos(); pushApps(); send('ev', lastTray); send('ev', lastMic); send('ev', updateState); send('ev', { t: 'visible', on: !(hiddenForFullscreen && !peeking) }); });
  return { hideTaskbar: !!cfg.hideTaskbar, autostart: app.getLoginItemSettings().openAtLogin, hasHelper: !!helper, margin: M,
           glass: cfg.glass, wall: wallpaperUrl(), autoHide: !!cfg.autoHide, scale: Z(), micKey: cfg.micKey !== false, locked: !!cfg.locked, clear: !!cfg.clear, hideFullscreen: cfg.hideFullscreen !== false, winKey: !!cfg.winKey, note: String(cfg.note || ''), frames: !!cfg.frames, notify: notifyState(), widgets: widgetState() };
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
setInterval(() => {
  const before = wallCache.url, now = wallpaperUrl();
  if (now !== before) { send('ev', { t: 'wall', data: now }); Object.keys(widgetWins).forEach(widgetGeo); }
}, 4000);
ipcMain.on('set-hide-fullscreen', (_e, b) => { cfg.hideFullscreen = !!b; saveCfg(); updateHidden(); });
ipcMain.on('set-autohide', (_e, b) => { cfg.autoHide = !!b; saveCfg(); updateHidden(); });

// ---------- Suche im Menü: Einstellungen von Windows, Dateien, Windows-Suche, Web ----------
const SETTINGS = [
  ["Installierte Apps", "Programme hinzufügen oder entfernen", "ms-settings:appsfeatures", "programme hinzufügen entfernen deinstallieren installieren software apps features"],
  ["Programme und Features", "Systemsteuerung · Programm deinstallieren", "control.exe /name Microsoft.ProgramsAndFeatures", "programme deinstallieren entfernen hinzufügen software systemsteuerung"],
  ["Standard-Apps", "Womit Dateien und Links geöffnet werden", "ms-settings:defaultapps", "standardprogramme standard browser öffnen mit dateityp"],
  ["Autostart", "Programme beim Windows-Start", "ms-settings:startupapps", "autostart start programme hochfahren"],
  ["Anzeige", "Auflösung, Skalierung, Hz", "ms-settings:display", "bildschirm monitor auflösung skalierung hz helligkeit anzeige"],
  ["Nachtmodus", "Blaulicht reduzieren", "ms-settings:nightlight", "nachtlicht nachtmodus blaulicht"],
  ["Grafik", "Grafikkarte pro Programm", "ms-settings:display-advancedgraphics", "grafik gpu grafikkarte leistung"],
  ["Sound", "Lautsprecher, Kopfhörer, Mikrofon", "ms-settings:sound", "ton audio lautsprecher mikrofon ausgabe eingabe kopfhörer"],
  ["Lautstärkemixer", "Lautstärke pro App", "ms-settings:apps-volume", "lautstärke mixer"],
  ["Sound (klassisch)", "Wiedergabe- und Aufnahmegeräte", "mmsys.cpl", "sound wiedergabegeräte aufnahmegeräte systemsteuerung"],
  ["Bluetooth & Geräte", "Kopfhörer, Controller koppeln", "ms-settings:bluetooth", "bluetooth geräte koppeln kopfhörer controller"],
  ["Maus", "Zeigergeschwindigkeit, Tasten", "ms-settings:mousetouchpad", "maus zeiger geschwindigkeit mausrad"],
  ["Drucker & Scanner", "Einstellungen", "ms-settings:printers", "drucker scanner drucken"],
  ["WLAN", "Netzwerk & Internet", "ms-settings:network-wifi", "wlan wifi internet netzwerk drahtlos"],
  ["Netzwerk & Internet", "Einstellungen", "ms-settings:network", "netzwerk internet lan ethernet verbindung"],
  ["Netzwerkverbindungen", "Adapter verwalten", "ncpa.cpl", "netzwerkadapter adapter verbindungen ip dns"],
  ["VPN", "Netzwerk & Internet", "ms-settings:network-vpn", "vpn"],
  ["Hintergrund", "Desktop-Hintergrund ändern", "ms-settings:personalization-background", "hintergrund wallpaper desktop bild"],
  ["Farben", "Hell, Dunkel, Akzentfarbe", "ms-settings:colors", "farben dunkel hell modus akzent"],
  ["Designs", "Designs und Desktopsymbole", "ms-settings:themes", "design themes symbole desktopsymbole"],
  ["Sperrbildschirm", "Personalisierung", "ms-settings:lockscreen", "sperrbildschirm"],
  ["Taskleiste (Windows)", "Personalisierung", "ms-settings:taskbar", "taskleiste"],
  ["Benachrichtigungen", "Nicht stören", "ms-settings:notifications", "benachrichtigungen mitteilungen nicht stören fokus"],
  ["Energie", "Energiesparen, Bildschirm aus", "ms-settings:powersleep", "energie strom akku energiesparen standby ruhezustand bildschirm aus"],
  ["Energieoptionen", "Energiesparplan wählen", "powercfg.cpl", "energiesparplan hochleistung energieoptionen"],
  ["Speicher", "Speicherplatz freigeben", "ms-settings:storagesense", "speicher festplatte platz bereinigen speicheroptimierung"],
  ["Windows Update", "Nach Updates suchen", "ms-settings:windowsupdate", "update aktualisieren windows update"],
  ["Datum & Uhrzeit", "Zeit und Sprache", "ms-settings:dateandtime", "datum uhrzeit zeit zeitzone"],
  ["Sprache & Region", "Zeit und Sprache", "ms-settings:regionlanguage", "sprache region tastatur layout"],
  ["Eingabe", "Tastatur, Rechtschreibung", "ms-settings:typing", "tastatur eingabe rechtschreibung"],
  ["Zwischenablage", "Verlauf der Zwischenablage", "ms-settings:clipboard", "zwischenablage kopieren verlauf"],
  ["Multitasking", "Fenster andocken", "ms-settings:multitasking", "fenster andocken snap multitasking"],
  ["Konten", "Deine Infos", "ms-settings:yourinfo", "konto benutzer profilbild"],
  ["Anmeldeoptionen", "Passwort, PIN", "ms-settings:signinoptions", "passwort pin anmelden kennwort"],
  ["Datenschutz & Sicherheit", "Berechtigungen", "ms-settings:privacy", "datenschutz berechtigungen"],
  ["Mikrofon-Zugriff", "Welche Apps das Mikrofon nutzen dürfen", "ms-settings:privacy-microphone", "mikrofon berechtigung zugriff"],
  ["Kamera-Zugriff", "Welche Apps die Kamera nutzen dürfen", "ms-settings:privacy-webcam", "kamera webcam berechtigung zugriff"],
  ["Windows-Sicherheit", "Virenschutz, Firewall", "windowsdefender:", "virenschutz defender sicherheit firewall viren"],
  ["Spielmodus", "Gaming", "ms-settings:gaming-gamemode", "spielmodus gaming spiele"],
  ["Xbox Game Bar", "Aufnahmen, Tastenkürzel", "ms-settings:gaming-gamebar", "game bar aufnahme gaming xbox"],
  ["Info", "PC-Name, Windows-Version", "ms-settings:about", "info system pc name version spezifikationen"],
  ["Wiederherstellung", "PC zurücksetzen", "ms-settings:recovery", "zurücksetzen wiederherstellung neu installieren"],
  ["Optionale Features", "Einstellungen", "ms-settings:optionalfeatures", "features optional"],
  ["Barrierefreiheit", "Lupe, Kontrast, Text", "ms-settings:easeofaccess", "barrierefreiheit lupe kontrast"],
  ["Für Entwickler", "Einstellungen", "ms-settings:developers", "entwickler"],
  ["Systemsteuerung", "Klassische Einstellungen", "control.exe", "systemsteuerung control panel"],
  ["Task-Manager", "Laufende Programme und Prozesse", "taskmgr.exe", "task manager prozesse beenden"],
  ["Geräte-Manager", "Treiber und Hardware", "devmgmt.msc", "geräte manager treiber hardware"],
  ["Datenträgerverwaltung", "Partitionen und Laufwerke", "diskmgmt.msc", "datenträger festplatte partition laufwerk"],
  ["Dienste", "Windows-Dienste", "services.msc", "dienste services"],
  ["Ereignisanzeige", "Fehlerprotokolle", "eventvwr.msc", "ereignisanzeige fehler protokoll log"],
  ["Erweiterte Systemeinstellungen", "Umgebungsvariablen, Leistung", "SystemPropertiesAdvanced.exe", "umgebungsvariablen leistung auslagerungsdatei system eigenschaften"],
  ["Registrierungs-Editor", "Registry", "regedit.exe", "registry regedit registrierung"],
  ["Papierkorb", "Gelöschte Dateien", "explorer.exe shell:RecycleBinFolder", "papierkorb gelöscht"],
  ["Downloads", "Ordner", "explorer.exe shell:Downloads", "downloads heruntergeladen"],
  ["Firewall", "Windows Defender Firewall", "firewall.cpl", "firewall"]
];
ipcMain.handle('settings-list', () => SETTINGS.map(([name, sub, , keys], i) => ({ i, name, sub, keys })));
ipcMain.on('run-setting', (_e, i) => {
  const s = SETTINGS[i]; if (!s) return;
  const target = s[2];
  if (/^(ms-settings|windowsdefender):/.test(target)) { shell.openExternal(target).catch(() => {}); return; }
  try { spawn('cmd.exe', ['/d', '/s', '/c', 'start "" ' + target], { windowsVerbatimArguments: true, windowsHide: true, detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
});
const searchWait = new Map(), fileResults = new Set();
let searchSeq = 0;
ipcMain.handle('search-files', (_e, q) => new Promise(resolve => {
  q = String(q || '').slice(0, 100);
  if (!helper || q.trim().length < 2) return resolve([]);
  const id = ++searchSeq;
  const t = setTimeout(() => { searchWait.delete(id); resolve([]); }, 3000);
  searchWait.set(id, async items => {
    clearTimeout(t);
    const out = [];
    for (const it of items.slice(0, 10)) { fileResults.add(it.path); out.push({ name: it.name, path: it.path, folder: !!it.folder, icon: await fileIcon(it.path) }); }
    resolve(out);
  });
  sendHelper({ c: 'search', id, q });
}));
ipcMain.on('open-file', (_e, p) => { if (fileResults.has(p)) shell.openPath(p); });
ipcMain.on('show-file', (_e, p) => { if (fileResults.has(p)) shell.showItemInFolder(p); });
ipcMain.on('win-search', (_e, q) => sendHelper({ c: 'winsearch', q: String(q || '').slice(0, 200) }));
ipcMain.on('web-search', (_e, q) => { shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(String(q || '').slice(0, 200))).catch(() => {}); });
ipcMain.on('set-scale', (_e, v) => {
  if (!SCALES.includes(v)) return;
  cfg.scale = v; saveCfg(); win.webContents.setZoomFactor(v); applyPos();
});
// Tastenkürzel: Mikrofon stumm schalten, ohne die Insel zu öffnen
const MIC_KEY = 'Control+Shift+F11';
function applyMicKey() {
  try { globalShortcut.unregister(MIC_KEY); if (cfg.micKey !== false) globalShortcut.register(MIC_KEY, () => sendHelper({ c: 'micmute' })); } catch (_) {}
}
ipcMain.on('set-mic-key', (_e, b) => { cfg.micKey = !!b; saveCfg(); applyMicKey(); });
// Vorschaubild des Fensters, wenn die Maus über einem laufenden Programm steht
const thumbWait = new Map();
ipcMain.handle('win-thumb', (_e, { kind, i }) => new Promise(resolve => {
  const a = (kind === 'pin' ? lastApps.pins : lastApps.others)[i];
  if (!a || !a.wins.length || !helper) return resolve(null);
  const h = a.wins[0], w = lastWindows.find(x => x.h === h);
  const info = { title: w ? w.title : a.name, count: a.wins.length, data: '' };
  const t = setTimeout(() => { thumbWait.delete(h); resolve(info); }, 1500);
  thumbWait.set(h, data => { clearTimeout(t); info.data = data; resolve(info); });
  sendHelper({ c: 'winthumb', h });
}));
ipcMain.on('set-winkey', (_e, b) => { cfg.winKey = !!b; saveCfg(); sendHelper({ c: 'winkey', on: cfg.winKey }); });
ipcMain.on('mic-toggle', () => sendHelper({ c: 'micmute' }));
ipcMain.on('snip', () => setTimeout(() => sendHelper({ c: 'snip' }), 350));
ipcMain.on('mixer', (_e, on) => sendHelper({ c: 'mixer', on: !!on }));
ipcMain.on('app-vol', (_e, { name, v }) => sendHelper({ c: 'appvol', name: String(name), v: Math.max(0, Math.min(1, +v || 0)) }));
let noteT = null;
ipcMain.on('note-save', (_e, text) => { cfg.note = String(text || '').slice(0, 20000); clearTimeout(noteT); noteT = setTimeout(saveCfg, 600); toWidget('note', { t: 'note', text: cfg.note }); });
ipcMain.on('widget-media', (_e, a) => { if (['toggle', 'next', 'prev'].includes(a)) sendHelper({ c: 'media', a }); });
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
// Wie oft ein Programm genutzt wird: eigene Starts aus der Insel zählen stark, dazu die Zählung von Windows.
// Kürzlich Genutztes wiegt mehr als lange nicht mehr Genutztes.
let winUsage = new Map();
setInterval(() => sendHelper({ c: 'usage' }), 15 * 60 * 1000);
function usageScore(id) {
  const own = (cfg.usage || {})[id], w = winUsage.get(String(id).toLowerCase());
  const n = (own ? own.n * 5 : 0) + (w ? Math.min(w.n, 200) : 0);
  if (!n) return 0;
  const age = (Date.now() - Math.max(own ? own.last : 0, w ? w.last : 0)) / 864e5;
  return n * (age < 1 ? 2 : age < 7 ? 1.5 : age < 30 ? 1 : 0.5);
}
ipcMain.handle('start-apps', async () => {
  if (!startApps.length) await loadStartApps();
  else if (Date.now() - startAppsAt > 120000) loadStartApps();
  return startApps.map(a => Object.assign({}, a, { score: usageScore(a.id) }));
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
  // mitzählen; nur die 300 meistgenutzten behalten
  const u = cfg.usage || (cfg.usage = {});
  u[id] = { n: ((u[id] && u[id].n) || 0) + 1, last: Date.now() };
  const keys = Object.keys(u);
  if (keys.length > 300) keys.sort((x, y) => u[x].n - u[y].n).slice(0, keys.length - 300).forEach(k => delete u[k]);
  saveCfg();
});
ipcMain.on('power', (_e, kind) => {
  const run = (cmd, args) => { try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (_) {} };
  if (kind === 'lock') run('rundll32.exe', ['user32.dll,LockWorkStation']);
  else if (kind === 'restart') { cleanup(); run('shutdown.exe', ['/r', '/t', '0']); }
  else if (kind === 'off') { cleanup(); run('shutdown.exe', ['/s', '/t', '0']); }
});
// Für die Suche braucht die Insel kurz die Tastatur; sonst nimmt sie anderen Fenstern nie den Fokus weg.
let returnHide = false;
ipcMain.on('focus', (_e, b, restore) => {
  if (!win || win.isDestroyed()) return;
  if (b) {
    returnHide = fullHide();   // Menü wurde über einem Spiel oder Video geöffnet
    win.setFocusable(true); win.setIgnoreMouseEvents(false); win.focus();
    try { sendHelper({ c: 'fg', h: Number(win.getNativeWindowHandle().readBigUInt64LE(0)) }); } catch (_) {}
  }
  else if (restore) {
    // erst das Spiel bzw. vorherige Fenster nach vorn holen, dann die Insel abgeben (ohne Umweg über ein anderes Fenster)
    sendHelper({ c: 'back' });
    setTimeout(() => { if (!win.isDestroyed()) win.setFocusable(false); }, 60);
    if (returnHide) {
      returnHide = false;
      setHidden(true, true);   // sofort aus dem Bild, nicht erst nach der Vollbild-Erkennung
      setTimeout(() => { if (!fullscreenNow) updateHidden(); }, 2500);   // Spiel inzwischen beendet? Dann wieder zeigen
    }
  }
  else { returnHide = false; win.blur(); win.setFocusable(false); }
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
ipcMain.on('rect', (_e, r) => { const z = Z(); islandRect = { left: r.left * z, top: r.top * z, width: r.width * z, height: r.height * z }; });
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
  if (a.wins.length) {
    let h = a.wins[0];
    if (a.wins.length > 1) {
      const act = a.wins.findIndex(x => (lastWindows.find(w => w.h === x) || {}).active);
      if (act >= 0) h = a.wins[(act + 1) % a.wins.length];
    }
    sendHelper({ c: 'activate', h });
  }
  else if (kind === 'pin' && cfg.pins[i]) shell.openPath(cfg.pins[i].path).then(err => { if (err) send('ev', { t: 'toast', m: 'Konnte nicht gestartet werden: ' + cfg.pins[i].name }); });
});
// ---------- Zuletzt geöffnete Dateien pro Programm ----------
const assocMap = new Map();
let recentFiles = [];
function refreshRecent() {
  if (process.platform !== 'win32') return;
  try {
    const dir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
    const items = fs.readdirSync(dir).filter(n => /\.lnk$/i.test(n)).map(n => { const f = path.join(dir, n); try { return { f, m: fs.statSync(f).mtimeMs }; } catch (_) { return null; } })
      .filter(Boolean).sort((a, b) => b.m - a.m).slice(0, 150);
    const out = [];
    for (const it of items) {
      let target = '';
      try { target = shell.readShortcutLink(it.f).target || ''; } catch (_) {}
      const ext = path.win32.extname(target).toLowerCase();
      if (target && ext) out.push({ path: target, ext, m: it.m });
    }
    recentFiles = out;
    const unknown = [...new Set(out.map(x => x.ext))].filter(e => !assocMap.has(e));
    if (unknown.length) sendHelper({ c: 'assoc', exts: unknown });
  } catch (_) {}
}
setInterval(refreshRecent, 60000);
function recentFor(exe) {
  exe = String(exe || '').toLowerCase();
  if (!exe) return [];
  const seen = new Set();
  return recentFiles.filter(r => assocMap.get(r.ext) === exe && !seen.has(r.path.toLowerCase()) && seen.add(r.path.toLowerCase()) && fs.existsSync(r.path)).slice(0, 6);
}

// ---------- Rechtsklick-Menüs wie in der Taskleiste von Windows ----------
function startTarget(target) {   // nur feste Ziele aus diesem Programm, keine Eingaben von außen
  if (/^ms-settings:/.test(target)) { shell.openExternal(target).catch(() => {}); return; }
  try { spawn('cmd.exe', ['/d', '/s', '/c', 'start "" ' + target], { windowsVerbatimArguments: true, windowsHide: true, detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
}
function startAdmin(file) {
  try { spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Start-Process -FilePath '" + String(file).replace(/'/g, "''") + "' -Verb RunAs"], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
}
const combo = (...k) => sendHelper({ c: 'combo', k });   // 0x5B = Windows-Taste
function appFile(kind, i) {   // Datei, mit der sich das Programm neu starten lässt
  if (kind === 'pin') return cfg.pins[i] ? (cfg.pins[i].target || cfg.pins[i].path) : '';
  return lastApps.others[i] ? lastApps.others[i].exe : '';
}
function launchNew(kind, i) {
  if (kind === 'pin' && cfg.pins[i]) { shell.openPath(cfg.pins[i].path); return; }
  const f = appFile(kind, i);
  if (f) try { spawn(f, [], { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
}
function appMenuTemplate(kind, i) {
  const a = (kind === 'pin' ? lastApps.pins : lastApps.others)[i];
  if (!a) return [];
  const file = appFile(kind, i), running = a.wins.length > 0, items = [];
  const recent = /\.exe$/i.test(file) ? recentFor(file) : [];
  if (recent.length) {
    items.push({ label: 'Zuletzt geöffnet', enabled: false });
    recent.forEach(r => items.push({ label: path.win32.basename(r.path), click: () => { try { spawn(file, [r.path], { detached: true, stdio: 'ignore' }).unref(); } catch (_) { shell.openPath(r.path); } } }));
    items.push({ type: 'separator' });
  }
  items.push({ label: a.name || 'Programm', enabled: false });
  items.push({ label: running ? 'Neues Fenster öffnen' : 'Starten', click: () => launchNew(kind, i) });
  if (file && /\.exe$/i.test(file)) items.push({ label: 'Als Administrator ausführen', click: () => startAdmin(file) });
  if (file || (kind === 'pin' && cfg.pins[i])) items.push({ label: 'Dateispeicherort öffnen', click: () => shell.showItemInFolder(file || cfg.pins[i].path) });
  items.push({ type: 'separator' });
  if (kind === 'pin') items.push({ label: 'Von der Insel lösen', click: () => { cfg.pins.splice(i, 1); saveCfg(); pushApps(); } });
  else if (file) items.push({ label: 'An die Insel anheften', click: () => addPins([file]) });
  if (running) {
    items.push({ type: 'separator' });
    items.push({ label: a.wins.length > 1 ? 'Alle ' + a.wins.length + ' Fenster schließen' : 'Fenster schließen', click: () => sendHelper({ c: 'close', h: a.wins }) });
    items.push({ label: 'Task beenden (erzwingen)', click: () => sendHelper({ c: 'kill', h: a.wins }) });
  }
  items.push({ type: 'separator' });
  items.push({ label: 'Task-Manager', click: () => startTarget('taskmgr.exe') });
  return items;
}
// Rechtsklick auf den Start-Knopf: wie Win+X
function startMenuTemplate() {
  return [
    { label: 'Installierte Apps', click: () => startTarget('ms-settings:appsfeatures') },
    { label: 'Energieoptionen', click: () => startTarget('ms-settings:powersleep') },
    { label: 'Ereignisanzeige', click: () => startTarget('eventvwr.msc') },
    { label: 'System', click: () => startTarget('ms-settings:about') },
    { label: 'Geräte-Manager', click: () => startTarget('devmgmt.msc') },
    { label: 'Netzwerkverbindungen', click: () => startTarget('ms-settings:network') },
    { label: 'Datenträgerverwaltung', click: () => startTarget('diskmgmt.msc') },
    { label: 'Computerverwaltung', click: () => startTarget('compmgmt.msc') },
    { label: 'Terminal', click: () => startTarget('wt.exe') },
    { label: 'Terminal (Administrator)', click: () => startAdmin('wt.exe') },
    { type: 'separator' },
    { label: 'Task-Manager', click: () => startTarget('taskmgr.exe') },
    { label: 'Einstellungen', click: () => startTarget('ms-settings:') },
    { label: 'Explorer', click: () => startTarget('explorer.exe') },
    { label: 'Suchen', click: () => send('ev', { t: 'go', s: 'start' }) },
    { label: 'Ausführen', click: () => combo(0x5B, 0x52) },
    { type: 'separator' },
    { label: 'Herunterfahren oder abmelden', submenu: [
      { label: 'Abmelden', click: () => { cleanup(); startTarget('shutdown.exe /l'); } },
      { label: 'Energie sparen', click: () => { try { spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); } catch (_) {} } },
      { label: 'Neu starten', click: () => ipcMain.emit('power', {}, 'restart') },
      { label: 'Herunterfahren', click: () => ipcMain.emit('power', {}, 'off') }
    ] },
    { label: 'Desktop', click: () => combo(0x5B, 0x44) }
  ];
}
// Rechtsklick auf eine freie Stelle der Insel
function islandMenuTemplate() {
  return [
    { label: 'Task-Manager', click: () => startTarget('taskmgr.exe') },
    { label: 'Desktop anzeigen', click: () => combo(0x5B, 0x44) },
    { label: 'Schnelleinstellungen (WLAN, Bluetooth, Akku)', click: () => combo(0x5B, 0x41) },
    { label: 'Mitteilungszentrale', click: () => combo(0x5B, 0x4E) },
    { type: 'separator' },
    { label: 'Position sperren', type: 'checkbox', checked: !!cfg.locked, click: m => { cfg.locked = m.checked; saveCfg(); send('ev', { t: 'cfg', locked: cfg.locked, autoHide: !!cfg.autoHide }); } },
    { label: 'Automatisch ausblenden', type: 'checkbox', checked: !!cfg.autoHide, click: m => { cfg.autoHide = m.checked; saveCfg(); updateHidden(); send('ev', { t: 'cfg', locked: !!cfg.locked, autoHide: cfg.autoHide }); } },
    { label: 'Einstellungen der Insel …', click: () => send('ev', { t: 'go', s: 'settings' }) },
    { label: 'Taskleisten-Einstellungen von Windows', click: () => startTarget('ms-settings:taskbar') },
    { type: 'separator' },
    { label: 'Insel beenden', click: () => { cleanup(); setTimeout(() => app.exit(0), 900); } }
  ];
}
function popupMenu(items) {
  if (!items.length || !win || win.isDestroyed()) return;
  send('ev', { t: 'menu', on: true });   // solange das Menü offen ist, bleibt die Insel aufgeklappt
  Menu.buildFromTemplate(items).popup({ window: win, callback: () => send('ev', { t: 'menu', on: false }) });
}
ipcMain.on('app-menu', (_e, { kind, i }) => popupMenu(appMenuTemplate(kind, i)));
ipcMain.on('start-menu', () => popupMenu(startMenuTemplate()));
ipcMain.on('island-menu', () => popupMenu(islandMenuTemplate()));
ipcMain.on('app-new', (_e, { kind, i }) => launchNew(kind, i));
// Dateien auf ein Programm-Symbol gezogen: mit diesem Programm öffnen
ipcMain.on('open-with', (_e, { kind, i, paths }) => {
  const files = (paths || []).map(String).filter(p => p && fs.existsSync(p)).slice(0, 20);
  if (!files.length) return;
  const file = appFile(kind, i);
  if (/\.exe$/i.test(file)) { try { spawn(file, files, { detached: true, stdio: 'ignore' }).unref(); return; } catch (_) {} }
  files.forEach(f => shell.openPath(f));
});
// Vorschau aller Fenster eines Programms
ipcMain.handle('win-thumbs', async (_e, { kind, i }) => {
  const a = (kind === 'pin' ? lastApps.pins : lastApps.others)[i];
  if (!a || !a.wins.length) return [];
  const one = h => new Promise(resolve => {
    if (!helper) return resolve('');
    const t = setTimeout(() => { thumbWait.delete(h); resolve(''); }, 1500);
    thumbWait.set(h, data => { clearTimeout(t); resolve(data); });
    sendHelper({ c: 'winthumb', h });
  });
  const out = [];
  for (const h of a.wins.slice(0, 6)) { const w = lastWindows.find(x => x.h === h); out.push({ h, title: w ? w.title : a.name, data: await one(h) }); }
  return out;
});
ipcMain.on('win-activate', (_e, h) => { if (lastWindows.some(w => w.h === h)) sendHelper({ c: 'activate', h }); });
ipcMain.on('win-close', (_e, h) => { if (lastWindows.some(w => w.h === h)) sendHelper({ c: 'close', h: [h] }); });
if (process.env.INSEL_SHOT) {
  global.inselMenus = () => ({ app: appMenuTemplate, start: startMenuTemplate, island: islandMenuTemplate });
  global.inselWins = () => lastWindows;
  global.inselApps = () => lastApps;
  global.inselTray = () => lastTray;
  global.inselStartApps = () => startApps;
  global.inselTaskInfo = () => taskInfo;
  global.inselAssoc = ext => assocMap.get(ext);
  global.inselRefreshRecent = refreshRecent;
  global.inselHelper = cmd => sendHelper(cmd);
}
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
  win.setBounds({ x, y, width: W(), height: H() });
  send('winpos', { x, y });
});
ipcMain.on('drag-end', (_e, rect) => {
  if (!drag) return;
  drag = null;
  const b = win.getBounds(), z = Z();
  rect = { top: rect.top * z, left: rect.left * z, width: rect.width * z, height: rect.height * z };
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
    loadCfg(); createWindow(); startHelper(); loadStartApps(); initUpdates(); applyMicKey();
    setTimeout(refreshRecent, 3000);
    if (cfg.autoHide) setHidden(true);
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
