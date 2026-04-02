export const WORKER_BASE_URL = 'https://fk-downloader.falih-m.workers.dev';

export function workerUrl(path: string, params?: Record<string, string>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${WORKER_BASE_URL}${normalizedPath}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}
