// front-end search.ts
import { downloadVideo } from './download.ts'; // adjust path if needed

// Grab elements from the DOM
const searchInput = document.getElementById('search') as HTMLInputElement;
const resultsContainer = document.getElementById('results') as HTMLDivElement;

// Helper to render search results
function renderResults(videos: any[]) {
  resultsContainer.innerHTML = ''; // clear previous results

  videos.forEach(video => {
    const html = `
      <div class="video-item" style="margin-bottom: 16px; border-bottom: 1px solid #ccc; padding-bottom: 8px;">
        <img src="${video.thumbnail}" alt="${video.title}" style="width:120px; height:auto; display:block; margin-bottom:4px;">
        <h3 style="margin:4px 0;">${video.title}</h3>
        <p style="margin:2px 0; font-size:12px;">Channel: ${video.channel}</p>
        <button 
          class="download-btn" 
          data-url="${video.url}" 
          data-type="video"
        >
          Download
        </button>
      </div>
    `;
    resultsContainer.insertAdjacentHTML('beforeend', html);
  });

  // ⚡ Add click handlers for download buttons
  document.querySelectorAll<HTMLButtonElement>('.download-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const videoUrl = btn.dataset.url;
      if (!videoUrl) return alert('Video URL missing');

      const type = btn.dataset.type || 'video';
      await downloadVideo(videoUrl, type);
    });
  });
}

// Listen for input in the search box
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
