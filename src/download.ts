const WORKER_BASE_URL = 'https://fk-downloader.falih-m.workers.dev';
const DEFAULT_SERVICE = 'gemini';

function workerDownloadUrl(url: string) {
  const params = new URLSearchParams({
    url,
    service: DEFAULT_SERVICE
  });

  return `${WORKER_BASE_URL}/?${params.toString()}`;
}

export async function downloadVideo(url: string, _type?: string) {
  try {
    window.open(workerDownloadUrl(url), '_blank', 'noopener,noreferrer');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
