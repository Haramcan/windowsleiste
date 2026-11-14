const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', { onStats: cb => ipcRenderer.on('stats', (_e, s) => cb(s)) });
