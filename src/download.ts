export async function downloadVideo(url: string, _type?: string) {
  try {
    const localResponse = await fetch(`/api/download?url=${encodeURIComponent(url)}`);

    const text = await localResponse.text();
    const data = text ? JSON.parse(text) : null;

    if (localResponse.ok && data?.downloadUrl) {
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
      return;
    }
  } catch {}

  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
