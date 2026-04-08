import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(electronDir, '..');

let mainWindow = null;
let backendControl = null;
let isCleaningUp = false;

function resolveServerAppRoot() {
  return app.isPackaged ? app.getAppPath() : appRoot;
}

function resolveWindowIconPath() {
  return app.isPackaged
    ? path.join(resolveServerAppRoot(), 'public', 'favicon.ico')
    : path.join(appRoot, 'static', 'favicon.ico');
}

function resolveEnvFilePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, '.env.local')
    : path.join(appRoot, '.env.local');
}

function resolveYtDlpPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'yt-dlp')
    : path.join(appRoot, 'bin', 'yt-dlp');
}

async function ensureBackend() {
  if (backendControl) {
    return backendControl;
  }

  process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
  process.env.PORT = '0';
  process.env.FK_APP_ROOT = resolveServerAppRoot();
  process.env.FK_RUNTIME_DIR = path.join(app.getPath('userData'), 'runtime');
  process.env.FK_ENV_FILE = resolveEnvFilePath();
  process.env.FK_YT_DLP_PATH = resolveYtDlpPath();

  const { startServer } = await import('../server.js');
  backendControl = await startServer({
    port: 0,
    host: '127.0.0.1'
  });

  return backendControl;
}

function registerIpcHandlers() {
  ipcMain.handle('electron:save-download', async (_event, payload) => {
    const fileName =
      typeof payload?.fileName === 'string' && payload.fileName.trim()
        ? path.basename(payload.fileName.trim())
        : 'download';
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), fileName)
    });

    if (canceled || !filePath) {
      return { canceled: true };
    }

    await fs.writeFile(filePath, Buffer.from(payload.data));
    return {
      canceled: false,
      filePath
    };
  });

  ipcMain.handle('electron:open-external', async (_event, url) => {
    if (typeof url === 'string' && url.trim()) {
      await shell.openExternal(url);
    }
  });
}

async function createMainWindow() {
  const backend = await ensureBackend();
  const baseUrl = `http://${backend.host}:${backend.port}`;

  const window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1080,
    minHeight: 760,
    title: 'FK Downloader',
    autoHideMenuBar: true,
    backgroundColor: '#050b09',
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: path.join(electronDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url === baseUrl || url.startsWith(`${baseUrl}/`)) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  await window.loadURL(baseUrl);

  if (!app.isPackaged) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow = window;
}

async function shutdownBackend() {
  if (!backendControl) {
    return;
  }

  const currentBackend = backendControl;
  backendControl = null;
  await currentBackend.close();
}

app.on('before-quit', (event) => {
  if (isCleaningUp) {
    return;
  }

  event.preventDefault();
  isCleaningUp = true;
  void shutdownBackend().finally(() => {
    app.quit();
  });
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.alphajet.fkdownloader');
  registerIpcHandlers();

  try {
    await createMainWindow();
  } catch (error) {
    dialog.showErrorBox(
      'FK Downloader',
      error instanceof Error ? error.message : String(error)
    );
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
