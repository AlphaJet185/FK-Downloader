const DOWNLOAD_API_BASE_URL =
  import.meta.env.VITE_DOWNLOAD_API_BASE_URL?.trim() || '';

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
    window.open(downloadEndpoint(url, _type || 'video'), '_blank', 'noopener,noreferrer');
    return;
  } catch {}

  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function openDownloadUrl(url: string) {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {}
}
