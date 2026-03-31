import { downloadVideo } from './download.ts';

const searchInput = document.getElementById('search') as HTMLInputElement;
const resultsContainer = document.getElementById('results') as HTMLDivElement;

function renderResults(videos: any[]) {
  resultsContainer.innerHTML = '';

  videos.forEach(video => {
    const html = `
      <div class="video-item" style="margin-bottom:16px; border-bottom:1px solid #ccc; padding-bottom:8px;">
        <img src="${video.thumbnail}" alt="${video.title}" style="width:120px; display:block; margin-bottom:4px;">
        <h3>${video.title}</h3>
        <p style="font-size:12px;">Channel: ${video.channel}</p>
        <button class="download-btn" data-url="${video.url}" data-type="video">Download</button>
      </div>
    `;
    resultsContainer.insertAdjacentHTML('beforeend', html);
  });

  document.querySelectorAll<HTMLButtonElement>('.download-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const videoUrl = btn.dataset.url;
      if (!videoUrl) return alert('Video URL missing');
      await downloadVideo(videoUrl, btn.dataset.type || 'video');
    });
  });
}

searchInput.addEventListener('input', async () => {
  const query = searchInput.value.trim();
  if (!query) {
    resultsContainer.innerHTML = '';
    return;
  }

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');

    const videos = await res.json();
    renderResults(videos);
  } catch (err: any) {
    console.error('Search error:', err);
    resultsContainer.innerHTML = `<p style="color:red;">Search failed: ${err.message}</p>`;
  }
});
