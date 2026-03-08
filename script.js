// ----------------------------
// FK Downloader Frontend Script
// ----------------------------

// DOM elements
const urlInput = document.getElementById('url');
const fetchInfoBtn = document.getElementById('fetchInfo');
const downloadBtn = document.getElementById('download');
const suggestionInput = document.getElementById('suggestInput');
const suggestionsList = document.getElementById('suggestions');
const videoInfoDiv = document.getElementById('videoInfo');
const formatSelect = document.getElementById('formatSelect');

// ----------------------------
// Fetch Video Info
// ----------------------------
async function fetchVideoInfo() {
  const url = urlInput.value.trim();
  if (!url) return alert('Enter a video URL');

  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    // Show basic info
    videoInfoDiv.innerHTML = `
      <img src="${data.thumbnail}" alt="Thumbnail" width="180" />
      <h3>${data.title}</h3>
      <p>Channel: ${data.channel} | Duration: ${data.duration}s</p>
    `;

    // Fill format options
    formatSelect.innerHTML = '';
    const allFormats = [...data.videoFormats, ...data.audioFormats];
    allFormats.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.itag;
      opt.text = `${f.qualityLabel} | ${f.mimeType} | ${f.contentLength}`;
      formatSelect.appendChild(opt);
    });

  } catch (err) {
    console.error(err);
    alert('Failed to fetch video info');
  }
}

// ----------------------------
// Download Video/Audio
// ----------------------------
async function downloadVideo() {
  const url = urlInput.value.trim();
  const itag = formatSelect.value;

  if (!url) return alert('Enter a video URL');
  if (!itag) return alert('Select a format');

  try {
    const res = await fetch(`/api/download?url=${encodeURIComponent(url)}&itag=${itag}`);
    const data = await res.json();
    if (!data.downloadUrl) return alert('Download URL not found');

    // Trigger browser download
    const a = document.createElement('a');
    a.href = data.downloadUrl;
    a.download = data.title || 'video';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

  } catch (err) {
    console.error(err);
    alert('Download failed');
  }
}

// ----------------------------
// Google Suggestions for search
// ----------------------------
let suggestionTimeout;
async function fetchSuggestions() {
  const q = suggestionInput.value.trim();
  if (!q) {
    suggestionsList.innerHTML = '';
    return;
  }

  clearTimeout(suggestionTimeout);
  suggestionTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
      const suggestions = await res.json();
      suggestionsList.innerHTML = suggestions
        .map(s => `<li class="suggest-item">${s}</li>`)
        .join('');

      // Click to fill input
      document.querySelectorAll('.suggest-item').forEach(el => {
        el.addEventListener('click', () => {
          suggestionInput.value = el.textContent;
          suggestionsList.innerHTML = '';
        });
      });

    } catch (err) {
      console.error(err);
      suggestionsList.innerHTML = '';
    }
  }, 300);
}

// ----------------------------
// Event Listeners
// ----------------------------
fetchInfoBtn.addEventListener('click', fetchVideoInfo);
downloadBtn.addEventListener('click', downloadVideo);
suggestionInput.addEventListener('input', fetchSuggestions);
