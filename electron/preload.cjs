// Preload (sandboxed, context-isolated): exposes a tiny, explicit API as window.wargamerDesktop.
// The page uses it only to show desktop info and to start/stop classroom hosting.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let info = {};
try {
  info = ipcRenderer.sendSync('wg:info') ?? {};
} catch {
  /* main not ready — keep defaults */
}

contextBridge.exposeInMainWorld('wargamerDesktop', {
  isDesktop: true,
  version: String(info.version ?? ''),
  platform: String(info.platform ?? ''),
  arch: String(info.arch ?? ''),
  electron: String(info.electron ?? ''),
  dataDir: String(info.dataDir ?? ''),
  lan: {
    status: () => ipcRenderer.invoke('wg:lan-status'),
    start: () => ipcRenderer.invoke('wg:lan-start'),
    stop: () => ipcRenderer.invoke('wg:lan-stop'),
  },
  openDataFolder: () => ipcRenderer.invoke('wg:open-data'),
  openGuide: () => ipcRenderer.invoke('wg:open-guide'),
});
