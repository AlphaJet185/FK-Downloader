const DOWNLOAD_API_BASE_URL =
  import.meta.env.VITE_DOWNLOAD_API_BASE_URL?.trim() || '';

export const DOWNLOAD_CANCELLED_MESSAGE = 'Save cancelled.';

export interface DownloadProgress {
  phase: 'starting' | 'downloading' | 'saving';
  receivedBytes: number;
  totalBytes: number | null;
  fileName?: string;
  speedBytesPerSecond?: number | null;
  estimatedRemainingMs?: number | null;
}

type DownloadProgressCallback = (progress: DownloadProgress) => void;

function downloadEndpoint(url: string, type: string) {
  const base = DOWNLOAD_API_BASE_URL || '';
  const params = new URLSearchParams({
    url,
    type
  });

  return `${base}/api/download?${params.toString()}`;
}

function parseJsonSafely(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function inferFileName(downloadUrl: string, response: Response) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  try {
    const url = new URL(downloadUrl, window.location.origin);
    const fallbackName = url.searchParams.get('url') || url.pathname.split('/').pop() || 'download';
    return fallbackName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'download';
  } catch {
    return 'download';
  }
}

async function readResponseBlob(
  response: Response,
  downloadUrl: string,
  onProgress?: DownloadProgressCallback
) {
  const fileName = inferFileName(downloadUrl, response);
  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) || null : null;
  const startedAt = performance.now();

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({
      phase: 'saving',
      receivedBytes: blob.size,
      totalBytes: blob.size || totalBytes,
      fileName,
      speedBytesPerSecond: null,
      estimatedRemainingMs: null
    });
    return { blob, fileName };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      chunks.push(value);
      receivedBytes += value.byteLength;
      const elapsedMs = Math.max(1, performance.now() - startedAt);
      const speedBytesPerSecond = receivedBytes / (elapsedMs / 1000);
      const estimatedRemainingMs =
        totalBytes && receivedBytes < totalBytes && elapsedMs >= 1000 && speedBytesPerSecond > 0
          ? ((totalBytes - receivedBytes) / speedBytesPerSecond) * 1000
          : null;

      onProgress?.({
        phase: 'downloading',
        receivedBytes,
        totalBytes,
        fileName,
        speedBytesPerSecond,
        estimatedRemainingMs
      });
    }
  }

  onProgress?.({
    phase: 'saving',
    receivedBytes,
    totalBytes: totalBytes || receivedBytes,
    fileName,
    speedBytesPerSecond: null,
    estimatedRemainingMs: null
  });

  return {
    blob: new Blob(chunks, {
      type: response.headers.get('content-type') || 'application/octet-stream'
    }),
    fileName
  };
}

async function saveBlob(blob: Blob, fileName: string) {
  if (window.electronAPI?.isDesktop) {
    const result = await window.electronAPI.saveDownload(fileName, await blob.arrayBuffer());
    if (result.canceled) {
      throw new Error(DOWNLOAD_CANCELLED_MESSAGE);
    }
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function startDownload(downloadUrl: string, onProgress?: DownloadProgressCallback) {
  const { blob, fileName } = await fetchDownloadBundle(downloadUrl, onProgress);
  await saveBlob(blob, fileName);
}

async function fetchDownloadBundle(downloadUrl: string, onProgress?: DownloadProgressCallback) {
  onProgress?.({
    phase: 'starting',
    receivedBytes: 0,
    totalBytes: null,
    speedBytesPerSecond: null,
    estimatedRemainingMs: null
  });

  let response: Response;

  try {
    response = await fetch(downloadUrl);
  } catch {
    throw new Error('Download requires an internet connection.');
  }

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok || contentType.includes('application/json')) {
    const text = await response.text();
    const payload = parseJsonSafely(text);
    const message =
      payload?.details
        ? `${payload.error || 'Download failed'}: ${payload.details}`
        : payload?.error || text || 'Download failed';
    throw new Error(message);
  }

  return readResponseBlob(response, downloadUrl, onProgress);
}

export async function downloadVideo(url: string, type = 'video', onProgress?: DownloadProgressCallback) {
  await startDownload(downloadEndpoint(url, type), onProgress);
}

export async function openDownloadUrl(url: string, onProgress?: DownloadProgressCallback) {
  await startDownload(url, onProgress);
}

export async function fetchVideoDownload(url: string, type = 'video', onProgress?: DownloadProgressCallback) {
  return fetchDownloadBundle(downloadEndpoint(url, type), onProgress);
}

export async function fetchDownloadUrl(url: string, onProgress?: DownloadProgressCallback) {
  return fetchDownloadBundle(url, onProgress);
}
