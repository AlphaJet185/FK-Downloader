import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  saveDownload(fileName, data) {
    return ipcRenderer.invoke('electron:save-download', {
      fileName,
      data
    });
  },
  pickDownloadFolder(defaultPath) {
    return ipcRenderer.invoke('electron:pick-download-folder', { defaultPath });
  },
  saveDownloadToFolder(folderPath, fileName, data, meta) {
    return ipcRenderer.invoke('electron:save-download-to-folder', {
      folderPath,
      fileName,
      data,
      meta
    });
  },
  openExternal(url) {
    return ipcRenderer.invoke('electron:open-external', url);
  },
  fileUrl(filePath) {
    return ipcRenderer.invoke('electron:file-url', filePath);
  },
  revealPath(filePath) {
    return ipcRenderer.invoke('electron:reveal-path', filePath);
  },
  deleteFile(filePath) {
    return ipcRenderer.invoke('electron:delete-file', filePath);
  }
});
