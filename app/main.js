// Insel-Leiste: Hauptprozess. Ein durchsichtiges, immer sichtbares Fenster zeigt die Insel;
// ein kleiner Helfer (helper/InselHelper.exe) liefert Musik, Lautstärke und offene Fenster.
const { app, BrowserWindow, ipcMain, screen, shell, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

const WIN_W = 820, WIN_H = 380;   // Fenster ist größer als die Insel, der Rest ist durchsichtig
const M = 24;                     // Rand um die Insel (Platz für den Schatten)
const IDLE_W = 232;

let win = null, helper = null, quitting = false;
let cfg = { pins: [], pos: null, hideTaskbar: false };
let lastWindows = [], lastApps = { pins: [], others: [] }, drag = null, hiddenForFullscreen = false;
const iconCache = new Map();
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');

function loadCfg() {
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))); } catch (_) {}
  if (!Array.isArray(cfg.pins)) cfg.pins = [];
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
  const d = screen.getDisplayNearestPoint({ x: p.cx, y: p.y }).bounds;
  p.cx = Math.min(Math.max(p.cx, d.x + IDLE_W / 2 + 8), d.x + d.width - IDLE_W / 2 - 8);
  p.y = Math.min(Math.max(p.y, d.y + 4), d.y + d.height - 4);
  const x = Math.round(p.cx - WIN_W / 2);
  const y = Math.round(p.anchor === 'bottom' ? p.y + M - WIN_H : p.y - M);
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
  send('layout', {
    anchor: p.anchor,
    insetL: Math.max(0, d.x - x),
    insetR: Math.max(0, x + WIN_W - (d.x + d.width))
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
    if (!groups.has(k)) groups.set(k, { exe: w.exe, name: w.title, icon: await fileIcon(w.exe), wins: [], active: false });
    const g = groups.get(k);
    g.wins.push(w.h);
    if (w.active) { g.active = true; g.name = w.title; }
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
  helper.on('error', () => { helper = null; });
  helper.on('exit', () => { helper = null; if (!quitting) setTimeout(startHelper, 2000); });
  readline.createInterface({ input: helper.stdout }).on('line', line => {
    let ev; try { ev = JSON.parse(line); } catch (_) { return; }
    if (ev.t === 'windows') { lastWindows = ev.list || []; pushApps(); }
    else if (ev.t === 'fullscreen') {
      hiddenForFullscreen = !!ev.on;
      if (win && !win.isDestroyed()) { if (ev.on) win.hide(); else win.showInactive(); }
    }
    else send('ev', ev);
  });
  if (cfg.hideTaskbar) sendHelper({ c: 'taskbar', hide: true });
}

// ---------- Fenster ----------
function createWindow() {
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, show: false,
    frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, fullscreenable: false, maximizable: false, minimizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { applyPos(); if (!hiddenForFullscreen) win.showInactive(); });
  screen.on('display-metrics-changed', applyPos);
  screen.on('display-removed', applyPos);
}

ipcMain.handle('ready', () => {
  setImmediate(() => { applyPos(); pushApps(); });
  return { hideTaskbar: !!cfg.hideTaskbar, autostart: app.getLoginItemSettings().openAtLogin, hasHelper: !!helper, margin: M };
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
ipcMain.on('quit', () => app.quit());

// Verschieben: Das Fenster folgt dem Mauszeiger, die Insel bleibt im Fenster an ihrem Platz.
ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint(), b = win.getBounds();
  drag = { cx: c.x, cy: c.y, x: b.x, y: b.y };
  send('layout', { anchor: cfg.pos.anchor, insetL: 0, insetR: 0 });
});
ipcMain.on('drag-move', () => {
  if (!drag) return;
  const c = screen.getCursorScreenPoint();
  win.setBounds({ x: drag.x + c.x - drag.cx, y: drag.y + c.y - drag.cy, width: WIN_W, height: WIN_H });
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

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    loadCfg(); createWindow(); startHelper();
    if (process.env.INSEL_SHOT) require('./dev-shot')(win);   // nur für Entwickler-Bildschirmfotos
  });
  app.on('before-quit', () => {
    quitting = true;
    sendHelper({ c: 'taskbar', hide: false });
    if (helper) { try { helper.stdin.end(); } catch (_) {} }
  });
  app.on('window-all-closed', () => app.quit());
}
