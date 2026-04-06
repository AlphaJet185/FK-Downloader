const DOWNLOAD_API_BASE_URL =
  import.meta.env.VITE_DOWNLOAD_API_BASE_URL?.trim() || '';

function triggerDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadEndpoint(url: string, type: string) {
  const base = DOWNLOAD_API_BASE_URL || '';
  const params = new URLSearchParams({
    url,
    type
  });

  return `${base}/api/download?${params.toString()}`;
}

export async function downloadVideo(url: string, _type?: string) {
  try {
    triggerDownload(downloadEndpoint(url, _type || 'video'));
    return;
  } catch {}

  try {
    triggerDownload(url);
  } catch {
    window.location.assign(url);
  }
}

export async function openDownloadUrl(url: string) {
  try {
    triggerDownload(url);
  } catch {
    window.location.assign(url);
  }
}
