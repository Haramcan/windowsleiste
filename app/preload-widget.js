const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  onStats: cb => ipcRenderer.on('stats', (_e, s) => cb(s)),
  onData: cb => ipcRenderer.on('data', (_e, d) => cb(d)),
  media: a => ipcRenderer.send('widget-media', a)
});
