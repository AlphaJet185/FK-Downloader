const DATABASE_NAME = 'fk-offline-media';
const DATABASE_VERSION = 1;
const META_STORE = 'downloads-meta';
const BLOB_STORE = 'downloads-blob';

export interface OfflineDownloadMeta {
  id: string;
  sourceUrl: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: number;
}

interface OfflineDownloadBlobRecord {
  id: string;
  blob: Blob;
}

export interface OfflineDownloadRecord extends OfflineDownloadMeta {
  blob: Blob;
}

function canUseIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        database.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open offline media database.'));
  });
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

export async function listOfflineDownloads() {
  const database = await openDatabase();
  if (!database) {
    return [];
  }

  const transaction = database.transaction(META_STORE, 'readonly');
  const store = transaction.objectStore(META_STORE);
  const entries = await readRequest(store.getAll()) as OfflineDownloadMeta[];
  await waitForTransaction(transaction);
  database.close();

  return entries.sort((left, right) => right.savedAt - left.savedAt);
}

export async function getOfflineDownload(id: string) {
  if (!id) {
    return null;
  }

  const database = await openDatabase();
  if (!database) {
    return null;
  }

  const transaction = database.transaction([META_STORE, BLOB_STORE], 'readonly');
  const metaStore = transaction.objectStore(META_STORE);
  const blobStore = transaction.objectStore(BLOB_STORE);

  const meta = await readRequest(metaStore.get(id)) as OfflineDownloadMeta | undefined;
  const blobRecord = await readRequest(blobStore.get(id)) as OfflineDownloadBlobRecord | undefined;
  await waitForTransaction(transaction);
  database.close();

  if (!meta || !blobRecord?.blob) {
    return null;
  }

  return {
    ...meta,
    blob: blobRecord.blob
  } satisfies OfflineDownloadRecord;
}

export async function saveOfflineDownload(
  meta: Omit<OfflineDownloadMeta, 'savedAt' | 'sizeBytes' | 'mimeType'> & Partial<Pick<OfflineDownloadMeta, 'mimeType'>>,
  blob: Blob
) {
  if (!meta.id) {
    throw new Error('Offline downloads require a stable video id.');
  }

  const database = await openDatabase();
  if (!database) {
    throw new Error('Offline storage is not available in this browser.');
  }

  const savedAt = Date.now();
  const nextMeta: OfflineDownloadMeta = {
    id: meta.id,
    sourceUrl: meta.sourceUrl,
    title: meta.title,
    channel: meta.channel,
    duration: meta.duration,
    thumbnail: meta.thumbnail,
    fileName: meta.fileName,
    mimeType: meta.mimeType || blob.type || 'video/mp4',
    sizeBytes: blob.size,
    savedAt
  };

  const transaction = database.transaction([META_STORE, BLOB_STORE], 'readwrite');
  transaction.objectStore(META_STORE).put(nextMeta);
  transaction.objectStore(BLOB_STORE).put({
    id: meta.id,
    blob
  } satisfies OfflineDownloadBlobRecord);

  await waitForTransaction(transaction);
  database.close();

  return nextMeta;
}

export async function removeOfflineDownload(id: string) {
  if (!id) {
    return;
  }

  const database = await openDatabase();
  if (!database) {
    return;
  }

  const transaction = database.transaction([META_STORE, BLOB_STORE], 'readwrite');
  transaction.objectStore(META_STORE).delete(id);
  transaction.objectStore(BLOB_STORE).delete(id);
  await waitForTransaction(transaction);
  database.close();
}
