const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printApi', {
  getInfo: ()     => ipcRenderer.invoke('print:get-info'),
  execute: (opts) => ipcRenderer.invoke('print:execute', opts),
  cancel:  ()     => ipcRenderer.invoke('print:cancel'),
});
