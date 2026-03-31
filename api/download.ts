// download.ts (frontend)
export async function downloadVideo(url: string, type: string = 'video', itag?: string) {
  try {
    // Build the serverless function URL
    const apiUrl = `/api/download?url=${encodeURIComponent(url)}${type ? `&type=${type}` : ''}${itag ? `&itag=${itag}` : ''}`;

    // Fetch the serverless function to get the streamed video
    const res = await fetch(apiUrl);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Download failed');
    }

    // Convert the response to a blob
    const blob = await res.blob();

    // Create a temporary link and click it to start download
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;

    // Extract filename from content-disposition or fallback
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

    console.log('Download started:', filename);
  } catch (err: any) {
    console.error('Download error:', err);
    alert(`Download failed: ${err.message}`);
  }
}

