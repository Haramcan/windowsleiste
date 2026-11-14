const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('insel', {
  ready: () => ipcRenderer.invoke('ready'),
  on: (channel, cb) => { if (['ev', 'apps', 'layout', 'winpos'].includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data)); },
  ignore: b => ipcRenderer.send('ignore', b),
  helper: cmd => ipcRenderer.send('helper', cmd),
  appClick: (kind, i) => ipcRenderer.send('app-click', { kind, i }),
  appMenu: (kind, i) => ipcRenderer.send('app-menu', { kind, i }),
  pinAdd: () => ipcRenderer.send('pin-add'),
  setHideTaskbar: b => ipcRenderer.send('set-hide-taskbar', b),
  setAutostart: b => ipcRenderer.send('set-autostart', b),
  quit: () => ipcRenderer.send('quit'),
  glassSource: displayId => ipcRenderer.invoke('glass-source', displayId),
  setGlass: b => ipcRenderer.send('set-glass', b),
  setFrames: b => ipcRenderer.send('set-frames', b),
  setTheme: light => ipcRenderer.send('set-theme', light),
  deskIcons: () => ipcRenderer.send('desk-icons'),
  wallpaper: () => ipcRenderer.send('wallpaper'),
  setNotify: b => ipcRenderer.send('set-notify', b),
  setNotifyApp: (name, on) => ipcRenderer.send('set-notify-app', { name, on }),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: rect => ipcRenderer.send('drag-end', rect)
});
