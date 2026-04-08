/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DOWNLOAD_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ElectronSaveDownloadResult {
  canceled: boolean;
  filePath?: string;
  reason?: string;
  metaPath?: string;
  folderPath?: string;
}

interface ElectronDesktopApi {
  readonly isDesktop: boolean;
  saveDownload(fileName: string, data: ArrayBuffer): Promise<ElectronSaveDownloadResult>;
  pickDownloadFolder(defaultPath?: string): Promise<{ canceled: boolean; folderPath?: string }>;
  saveDownloadToFolder(
    folderPath: string,
    fileName: string,
    data: ArrayBuffer,
    meta?: Record<string, unknown>
  ): Promise<ElectronSaveDownloadResult>;
  openExternal(url: string): Promise<void>;
  fileUrl(filePath: string): Promise<string>;
  revealPath(filePath: string): Promise<void>;
  deleteFile(filePath: string): Promise<ElectronSaveDownloadResult>;
}

interface Window {
  electronAPI?: ElectronDesktopApi;
}
