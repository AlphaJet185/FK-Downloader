export async function downloadVideo(url: string, _type?: string) {
  const res = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
  const data = await res.json();

  if (!data.downloadUrl) {
    alert("Download failed");
    return;
  }

  window.open(data.downloadUrl);
}
