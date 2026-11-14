// Insel-Leiste: Hauptprozess. Ein durchsichtiges, immer sichtbares Fenster zeigt die Insel;
// ein kleiner Helfer (helper/InselHelper.exe) liefert Musik, Lautstärke und offene Fenster.
const { app, BrowserWindow, ipcMain, screen, shell, dialog, Menu, nativeImage, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const os = require('os');

const WIN_W = 820, WIN_H = 380;   // Fenster ist größer als die Insel, der Rest ist durchsichtig
const M = 24;                     // Rand um die Insel (Platz für den Schatten)
const IDLE_W = 232;

let win = null, helper = null, quitting = false;
let cfg = { pins: [], pos: null, hideTaskbar: true, glass: true, frames: false, notify: { on: true, off: [] }, notifyApps: [],
            widgets: { clock: { on: false }, calendar: { on: false }, system: { on: false } } };
let lastTray = { t: 'tray', ok: false, icons: [] };
let lastWindows = [], lastApps = { pins: [], others: [] }, drag = null, hiddenForFullscreen = false;
const iconCache = new Map();
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');

function loadCfg() {
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))); } catch (_) {}
  if (!Array.isArray(cfg.pins)) cfg.pins = [];
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
function applyPos() {
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
    else if (ev.t === 'hello') { for (const k of Object.keys(widgetWins)) sinkWidget(k); }
    else if (ev.t === 'fullscreen') {
      if (process.env.INSEL_SHOT) return;   // im Probelauf immer sichtbar bleiben
      hiddenForFullscreen = !!ev.on;
      if (win && !win.isDestroyed()) { if (ev.on) win.hide(); else { win.showInactive(); protect(); } }
      send('ev', { t: 'visible', on: !ev.on });
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
}
const notifyState = () => ({ t: 'notifyState', on: !!cfg.notify.on, apps: cfg.notifyApps.map(n => ({ name: n, on: !cfg.notify.off.includes(n) })) });

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
  win.setContentProtection(!!cfg.glass);
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
  win.once('ready-to-show', () => { applyPos(); if (!hiddenForFullscreen) win.showInactive(); protect(); });
  screen.on('display-metrics-changed', applyPos);
  screen.on('display-removed', applyPos);
}

ipcMain.handle('ready', () => {
  setImmediate(() => { applyPos(); pushApps(); send('ev', lastTray); });
  return { hideTaskbar: !!cfg.hideTaskbar, autostart: app.getLoginItemSettings().openAtLogin, hasHelper: !!helper, margin: M,
           glass: !!cfg.glass, frames: !!cfg.frames, notify: notifyState(), widgets: widgetState() };
});

// Milchglas: Die Oberfläche bekommt ein kleines Live-Bild des Bildschirms und zeichnet es unscharf hinter die Insel.
ipcMain.handle('glass-source', async (_e, displayId) => {
  if (!cfg.glass) return null;
  try {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const s = list.find(x => String(x.display_id) === String(displayId)) || list[0];
    return s ? s.id : null;
  } catch (_) { return null; }
});
ipcMain.on('set-glass', (_e, b) => { cfg.glass = !!b; saveCfg(); win.setContentProtection(cfg.glass); });   // Maus ist dabei über der Insel
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

// Animationen sollen nie gedrosselt werden, auch wenn die Insel nie den Fokus hat.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    loadCfg(); createWindow(); startHelper();
    for (const k of Object.keys(WIDGETS)) if (cfg.widgets[k].on) openWidget(k);
    if (process.env.INSEL_SHOT) require('./dev-shot')(win);   // nur für Entwickler-Bildschirmfotos
  });
  app.on('before-quit', () => {
    cleanup();
  });
  app.on('window-all-closed', () => { if (!win || win.isDestroyed()) app.quit(); });
}
