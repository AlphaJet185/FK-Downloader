export async function downloadVideo(url: string, type: string = 'video', itag?: string) {
  try {
    // Call your patched backend
    const apiUrl = `/api/download?url=${encodeURIComponent(url)}${type ? `&type=${type}` : ''}${itag ? `&itag=${itag}` : ''}`;

    // ⚡ Fetch with proper response type
    const res = await fetch(apiUrl);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Download failed');
    }

    // Convert to arrayBuffer first (safer for large streams)
    const buffer = await res.arrayBuffer();
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const downloadUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = downloadUrl;

    // Extract filename from header
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
