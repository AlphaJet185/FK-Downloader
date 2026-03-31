export async function downloadVideo(url: string, type: string = 'video', itag?: string) {
  try {
    const apiUrl = `/api/download?url=${encodeURIComponent(url)}${type ? `&type=${type}` : ''}${itag ? `&itag=${itag}` : ''}`;

    const res = await fetch(apiUrl);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Download failed');
    }

    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = downloadUrl;

    const disposition = res.headers.get('Content-Disposition');
    let filename = 'video.mp4';
    if (disposition && disposition.includes('filename=')) {
      filename = disposition.split('filename=')[1].replace(/"/g, '');
    }
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);
  } catch (err: any) {
    console.error('Download error:', err);
    alert(`Download failed: ${err.message}`);
  }
}
