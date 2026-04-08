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
}

interface ElectronDesktopApi {
  readonly isDesktop: boolean;
  saveDownload(fileName: string, data: ArrayBuffer): Promise<ElectronSaveDownloadResult>;
  openExternal(url: string): Promise<void>;
}

interface Window {
  electronAPI?: ElectronDesktopApi;
}
