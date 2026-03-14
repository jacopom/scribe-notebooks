const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  goBack:    () => ipcRenderer.invoke('nav:back'),
  goForward: () => ipcRenderer.invoke('nav:forward'),
  reload:    () => ipcRenderer.invoke('nav:reload'),
  goHome:    () => ipcRenderer.invoke('nav:home'),
  openLogin: () => ipcRenderer.invoke('open-login'),

  onNavState: (cb) => ipcRenderer.on('nav-state', (_, state) => cb(state)),
  onLoading:  (cb) => ipcRenderer.on('loading',   (_, busy)  => cb(busy)),
});
