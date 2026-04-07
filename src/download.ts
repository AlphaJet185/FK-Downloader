const DOWNLOAD_API_BASE_URL =
  import.meta.env.VITE_DOWNLOAD_API_BASE_URL?.trim() || '';

export interface DownloadProgress {
  phase: 'starting' | 'downloading' | 'saving';
  receivedBytes: number;
  totalBytes: number | null;
  fileName?: string;
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

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({
      phase: 'saving',
      receivedBytes: blob.size,
      totalBytes: blob.size || totalBytes,
      fileName
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
      onProgress?.({
        phase: 'downloading',
        receivedBytes,
        totalBytes,
        fileName
      });
    }
  }

  onProgress?.({
    phase: 'saving',
    receivedBytes,
    totalBytes: totalBytes || receivedBytes,
    fileName
  });

  return {
    blob: new Blob(chunks, {
      type: response.headers.get('content-type') || 'application/octet-stream'
    }),
    fileName
  };
}

function saveBlob(blob: Blob, fileName: string) {
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
  onProgress?.({
    phase: 'starting',
    receivedBytes: 0,
    totalBytes: null
  });

  const response = await fetch(downloadUrl);
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

  const { blob, fileName } = await readResponseBlob(response, downloadUrl, onProgress);
  saveBlob(blob, fileName);
}

export async function downloadVideo(url: string, type = 'video', onProgress?: DownloadProgressCallback) {
  await startDownload(downloadEndpoint(url, type), onProgress);
}

export async function openDownloadUrl(url: string, onProgress?: DownloadProgressCallback) {
  await startDownload(url, onProgress);
}
