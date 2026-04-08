import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(electronDir, '..');

let mainWindow = null;
let backendControl = null;
let isCleaningUp = false;
let updateCheckTimer = null;

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

function sanitizeFileName(input) {
  return String(input || 'download')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'download';
}

function safeFileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return `file:///${normalized.startsWith('/') ? normalized.slice(1) : normalized}`;
}

async function ensureUniqueFilePath(folderPath, fileName) {
  const baseName = sanitizeFileName(fileName);
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let candidate = path.join(folderPath, baseName);
  let counter = 1;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(folderPath, `${stem} (${counter})${ext}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
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

  ipcMain.handle('electron:pick-download-folder', async (_event, payload) => {
    const defaultPath =
      typeof payload?.defaultPath === 'string' && payload.defaultPath.trim()
        ? payload.defaultPath.trim()
        : app.getPath('downloads');

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose download folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    });

    return {
      canceled,
      folderPath: canceled ? '' : filePaths[0] || ''
    };
  });

  ipcMain.handle('electron:save-download-to-folder', async (_event, payload) => {
    const folderPath =
      typeof payload?.folderPath === 'string' ? path.resolve(payload.folderPath) : '';
    const rawFileName =
      typeof payload?.fileName === 'string' && payload.fileName.trim()
        ? payload.fileName.trim()
        : 'download';

    if (!folderPath) {
      return { canceled: true, reason: 'No folder selected.' };
    }

    await fs.mkdir(folderPath, { recursive: true });
    const filePath = await ensureUniqueFilePath(folderPath, rawFileName);
    await fs.writeFile(filePath, Buffer.from(payload.data));

    const meta = {
      fileName: path.basename(filePath),
      savedAt: Date.now(),
      ...payload?.meta
    };

    await fs.writeFile(`${filePath}.json`, JSON.stringify(meta, null, 2), 'utf8');

    return {
      canceled: false,
      filePath,
      metaPath: `${filePath}.json`
    };
  });

  ipcMain.handle('electron:open-external', async (_event, url) => {
    if (typeof url === 'string' && url.trim()) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('electron:file-url', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return '';
    }

    return safeFileUrl(filePath.trim());
  });

  ipcMain.handle('electron:reveal-path', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return;
    }

    await shell.showItemInFolder(path.resolve(filePath));
  });

  ipcMain.handle('electron:delete-file', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { canceled: true, reason: 'No file path provided.' };
    }

    const resolvedPath = path.resolve(filePath);
    const sidecarPath = `${resolvedPath}.json`;

    try {
      await fs.rm(resolvedPath, { force: true });
    } catch (error) {
      return {
        canceled: true,
        reason: error instanceof Error ? error.message : String(error)
      };
    }

    await fs.rm(sidecarPath, { force: true }).catch(() => undefined);

    return {
      canceled: false,
      filePath: resolvedPath
    };
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

function registerAutoUpdateHandlers() {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on('update-available', () => {
    if (mainWindow) {
      void dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['OK'],
        title: 'FK Downloader',
        message: 'A new version is being downloaded in the background.'
      });
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const options = {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'FK Downloader',
      message: 'Update ready to install',
      detail: 'Restart the app to finish installing the latest version from GitHub.'
    };

    const response = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);

    if (response.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (error) => {
    console.error('auto-updater error', error);
  });
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
  registerAutoUpdateHandlers();

  try {
    await createMainWindow();
    if (app.isPackaged) {
      updateCheckTimer = setTimeout(() => {
        autoUpdater.checkForUpdates().catch((error) => {
          console.error('auto-updater check failed', error);
        });
      }, 5000);
    }
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
