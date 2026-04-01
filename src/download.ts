export async function downloadVideo(url: string, _type?: string) {
  try {
    const res = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok || !data?.downloadUrl) {
      throw new Error(data?.error || text || 'Download failed');
    }

    window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
