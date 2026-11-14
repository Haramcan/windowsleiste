const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('insel', {
  ready: () => ipcRenderer.invoke('ready'),
  on: (channel, cb) => { if (['ev', 'apps', 'layout'].includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data)); },
  ignore: b => ipcRenderer.send('ignore', b),
  helper: cmd => ipcRenderer.send('helper', cmd),
  appClick: (kind, i) => ipcRenderer.send('app-click', { kind, i }),
  appMenu: (kind, i) => ipcRenderer.send('app-menu', { kind, i }),
  pinAdd: () => ipcRenderer.send('pin-add'),
  setHideTaskbar: b => ipcRenderer.send('set-hide-taskbar', b),
  setAutostart: b => ipcRenderer.send('set-autostart', b),
  quit: () => ipcRenderer.send('quit'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: rect => ipcRenderer.send('drag-end', rect)
});
