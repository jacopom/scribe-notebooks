const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openLogin: () => ipcRenderer.invoke('open-login'),
});
