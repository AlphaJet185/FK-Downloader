import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  saveDownload(fileName, data) {
    return ipcRenderer.invoke('electron:save-download', {
      fileName,
      data
    });
  },
  openExternal(url) {
    return ipcRenderer.invoke('electron:open-external', url);
  }
});
