const SETTINGS_KEY = 'fk-download-settings-v1';
const LIBRARY_KEY = 'fk-download-library-v1';

export interface DownloadSettings {
  folderPath: string;
  promptOnFirstSave: boolean;
}

export interface SavedDownloadRecord {
  id: string;
  sourceId: string;
  sourceUrl: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: number;
}

function getStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createDefaultSettings(): DownloadSettings {
  return {
    folderPath: '',
    promptOnFirstSave: true
  };
}

function readJson<T>(key: string, fallback: T) {
  const storage = getStorage();
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures so downloads keep working.
  }
}

function normalizeRecord(record: Partial<SavedDownloadRecord> | null | undefined): SavedDownloadRecord {
  return {
    id: typeof record?.id === 'string' ? record.id : crypto.randomUUID(),
    sourceId: typeof record?.sourceId === 'string' ? record.sourceId : '',
    sourceUrl: typeof record?.sourceUrl === 'string' ? record.sourceUrl : '',
    title: typeof record?.title === 'string' ? record.title : 'Download',
    channel: typeof record?.channel === 'string' ? record.channel : 'Unknown',
    duration: typeof record?.duration === 'number' && Number.isFinite(record.duration) ? record.duration : 0,
    thumbnail: typeof record?.thumbnail === 'string' ? record.thumbnail : '',
    fileName: typeof record?.fileName === 'string' ? record.fileName : 'download',
    filePath: typeof record?.filePath === 'string' ? record.filePath : '',
    mimeType: typeof record?.mimeType === 'string' ? record.mimeType : 'video/mp4',
    sizeBytes: typeof record?.sizeBytes === 'number' && Number.isFinite(record.sizeBytes) ? record.sizeBytes : 0,
    savedAt: typeof record?.savedAt === 'number' && Number.isFinite(record.savedAt) ? record.savedAt : Date.now()
  };
}

export function getDownloadSettings() {
  return readJson<DownloadSettings>(SETTINGS_KEY, createDefaultSettings());
}

export function setDownloadFolder(folderPath: string) {
  const current = getDownloadSettings();
  const next = {
    ...current,
    folderPath: folderPath.trim(),
    promptOnFirstSave: false
  };

  writeJson(SETTINGS_KEY, next);
  return next;
}

export function shouldPromptForSaveLocation() {
  const settings = getDownloadSettings();
  return settings.promptOnFirstSave || !settings.folderPath;
}

export function markSaveLocationPrompted() {
  const current = getDownloadSettings();
  writeJson(SETTINGS_KEY, {
    ...current,
    promptOnFirstSave: false
  });
}

export function getSavedDownloads() {
  const entries = readJson<Partial<SavedDownloadRecord>[]>(LIBRARY_KEY, []);
  return entries.map(normalizeRecord).sort((left, right) => right.savedAt - left.savedAt);
}

export function upsertSavedDownload(record: SavedDownloadRecord) {
  const current = getSavedDownloads();
  const normalized = normalizeRecord(record);
  const next = [
    normalized,
    ...current.filter((entry) => entry.filePath !== normalized.filePath)
  ].sort((left, right) => right.savedAt - left.savedAt);

  writeJson(LIBRARY_KEY, next);
  return next;
}

export function updateSavedDownload(id: string, patch: Partial<SavedDownloadRecord>) {
  const next = getSavedDownloads().map((entry) =>
    entry.id === id ? normalizeRecord({ ...entry, ...patch, id: entry.id }) : entry
  );

  writeJson(LIBRARY_KEY, next);
  return next;
}

export function removeSavedDownload(id: string) {
  const next = getSavedDownloads().filter((entry) => entry.id !== id);
  writeJson(LIBRARY_KEY, next);
  return next;
}

export function readDownloadBySourceId(sourceId: string) {
  return getSavedDownloads().find((entry) => entry.sourceId === sourceId) || null;
}
