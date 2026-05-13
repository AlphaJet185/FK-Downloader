const state = {
  suggestions: [],
  activeSuggestionIndex: -1,
  results: [],
  loading: false,
  lastSubmittedQuery: "",
  lastSubmitAt: 0,
  currentQuery: "",
  currentPage: 1,
  loadingMore: false,
};

const elements = {
  input: document.getElementById("search-input"),
  pasteButton: document.getElementById("paste-button"),
  searchButton: document.getElementById("search-button"),
  recognizeButton: document.getElementById("recognize-button"),
  suggestions: document.getElementById("suggestions"),
  heroEmpty: document.getElementById("hero-empty"),
  heroCopy: document.getElementById("hero-copy"),
  statusBar: document.getElementById("status-bar"),
  resultsGrid: document.getElementById("results-grid"),
  resultsActions: document.getElementById("results-actions"),
  searchMoreButton: document.getElementById("search-more-button"),
  videoView: document.getElementById("video-view"),
  backButton: document.getElementById("back-button"),
  detailsLoading: document.getElementById("details-loading"),
  detailsPanel: document.getElementById("details-panel"),
  detailsTitle: document.getElementById("details-title"),
  detailsChannel: document.getElementById("details-channel"),
  detailsDuration: document.getElementById("details-duration"),
  detailsPlayer: document.getElementById("details-player"),
  detailsAudioPlayer: document.getElementById("details-audio-player"),
  detailsPreviewCard: document.getElementById("details-preview-card"),
  videoControls: document.getElementById("video-controls"),
  videoSeek: document.getElementById("video-seek"),
  videoPlayToggle: document.getElementById("video-play-toggle"),
  videoBackward: document.getElementById("video-backward"),
  videoForward: document.getElementById("video-forward"),
  videoTime: document.getElementById("video-time"),
  videoFullscreen: document.getElementById("video-fullscreen"),
  detailsThumbnail: document.getElementById("details-thumbnail"),
  detailsPreviewActions: document.getElementById("details-preview-actions"),
  formatGroups: document.getElementById("format-groups"),
};

let suggestTimer = null;
const SEARCH_BUTTON_LABEL = "Search";
const SEARCH_MORE_LABEL = "Search more";

function buttonLoadingMarkup(label) {
  return `<span class="button-loader" aria-hidden="true"></span><span>${label}</span>`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatPlaybackTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }

  return formatDuration(totalSeconds);
}

function extractYouTubeVideoId(input) {
  try {
    const value = input.trim();
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (host.endsWith("youtube.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      return url.searchParams.get("v") || parts[1] || null;
    }
  } catch {
    return null;
  }

  return null;
}

function looksLikeUrl(input) {
  try {
    new URL(input.trim());
    return true;
  } catch {
    return false;
  }
}

function setStatus(message = "", tone = "muted") {
  if (!message) {
    elements.statusBar.hidden = true;
    elements.statusBar.textContent = "";
    elements.statusBar.style.color = "";
    return;
  }

  elements.statusBar.hidden = false;
  elements.statusBar.textContent = message;
  elements.statusBar.style.color =
    tone === "error" ? "#ff9a9a" : tone === "success" ? "#9ff2d2" : "";
}

function renderSuggestions() {
  elements.suggestions.innerHTML = "";
  elements.suggestions.hidden = state.suggestions.length === 0;

  for (const [index, suggestion] of state.suggestions.entries()) {
    const item = document.createElement("li");
    item.textContent = suggestion;
    item.className = index === state.activeSuggestionIndex ? "is-active" : "";
    item.addEventListener("click", () => {
      elements.input.value = suggestion;
      state.suggestions = [];
      state.activeSuggestionIndex = -1;
      renderSuggestions();
      void runSearch();
    });
    elements.suggestions.appendChild(item);
  }
}

function buildPreviewUrl(url) {
  return url.includes("?") ? `${url}&preview=1` : `${url}?preview=1`;
}

function resetDetailsPreview() {
  elements.detailsPlayer.pause();
  elements.detailsPlayer.removeAttribute("src");
  elements.detailsPlayer.load();
  elements.detailsPlayer.hidden = true;
  elements.videoControls.hidden = true;
  elements.videoSeek.value = "0";
  elements.videoSeek.max = "100";
  elements.videoTime.textContent = "0:00 / 0:00";
  elements.videoPlayToggle.textContent = "Play";

  elements.detailsAudioPlayer.pause();
  elements.detailsAudioPlayer.removeAttribute("src");
  elements.detailsAudioPlayer.load();
  elements.detailsAudioPlayer.hidden = true;

  elements.detailsThumbnail.hidden = false;
  elements.detailsPreviewActions.hidden = true;
  elements.detailsPreviewActions.innerHTML = "";
}

function createActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function playFormat(format) {
  const previewUrl = buildPreviewUrl(format.url);
  const mimeType = format.mimeType || "";
  const isAudio = mimeType.startsWith("audio/");
  const player = isAudio ? elements.detailsAudioPlayer : elements.detailsPlayer;
  const otherPlayer = isAudio ? elements.detailsPlayer : elements.detailsAudioPlayer;

  otherPlayer.pause();
  otherPlayer.removeAttribute("src");
  otherPlayer.load();
  otherPlayer.hidden = true;

  player.hidden = false;
  player.src = previewUrl;
  player.load();
  void player.play().catch(() => {});
  elements.detailsThumbnail.hidden = true;
  elements.videoControls.hidden = isAudio;
}

function renderPreviewActions(details) {
  elements.detailsPreviewActions.innerHTML = "";

  if (details.previewUrl) {
    const previewButton = createActionButton(
      "Play preview",
      "primary-button preview-action",
      () => {
        elements.detailsAudioPlayer.pause();
        elements.detailsAudioPlayer.removeAttribute("src");
        elements.detailsAudioPlayer.load();
        elements.detailsAudioPlayer.hidden = true;
        elements.detailsPlayer.hidden = false;
        elements.detailsPlayer.src = details.previewUrl;
        elements.detailsPlayer.load();
        void elements.detailsPlayer.play().catch(() => {});
        elements.detailsThumbnail.hidden = true;
        elements.videoControls.hidden = false;
      },
    );
    elements.detailsPreviewActions.appendChild(previewButton);
  }

  const thumbnailButton = createActionButton(
    "Show thumbnail",
    "ghost-button preview-action",
    () => {
      elements.detailsPlayer.pause();
      elements.detailsPlayer.removeAttribute("src");
      elements.detailsPlayer.load();
      elements.detailsPlayer.hidden = true;
      elements.videoControls.hidden = true;
      elements.detailsAudioPlayer.pause();
      elements.detailsAudioPlayer.removeAttribute("src");
      elements.detailsAudioPlayer.load();
      elements.detailsAudioPlayer.hidden = true;
      elements.detailsThumbnail.hidden = false;
    },
  );
  elements.detailsPreviewActions.appendChild(thumbnailButton);
  elements.detailsPreviewActions.hidden = false;
}

function renderResults() {
  elements.resultsGrid.innerHTML = "";
  elements.resultsGrid.hidden = state.results.length === 0;
  elements.resultsActions.hidden = state.results.length === 0;
  elements.searchMoreButton.innerHTML = SEARCH_MORE_LABEL;
  elements.searchMoreButton.disabled = state.loadingMore;

  for (const result of state.results) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `
      <img src="${result.thumbnail}" alt="">
      <div class="result-copy">
        <h3>${result.title}</h3>
        <p>${result.channel} · ${formatDuration(result.duration)}</p>
      </div>
    `;
    card.addEventListener("click", () => void loadDetails(result));
    elements.resultsGrid.appendChild(card);
  }
}

function appendResults(nextResults) {
  elements.resultsGrid.hidden = nextResults.length === 0 && state.results.length === 0;
  elements.resultsActions.hidden = nextResults.length === 0 && state.results.length === 0;

  for (const result of nextResults) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `
      <img src="${result.thumbnail}" alt="">
      <div class="result-copy">
        <h3>${result.title}</h3>
        <p>${result.channel} · ${formatDuration(result.duration)}</p>
      </div>
    `;
    card.addEventListener("click", () => void loadDetails(result));
    elements.resultsGrid.appendChild(card);
  }
}

function renderFormats(label, formats) {
  const section = document.createElement("section");
  section.className = "format-group";
  section.innerHTML = `<h3>${label}</h3>`;
  const list = document.createElement("div");
  list.className = "format-list";

  for (const format of formats) {
    const card = document.createElement("article");
    card.className = "format-card";

    const meta = document.createElement("div");
    meta.className = "format-card-meta";
    meta.innerHTML = `
      <div>
        <strong>${format.qualityLabel || format.mimeType || "Format"}</strong>
        <span>${format.mimeType || label}</span>
      </div>
      <span>${format.contentLength || ""}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "format-card-actions";

    const playButton = createActionButton(
      "Play",
      "ghost-button format-action",
      () => playFormat(format),
    );

    const downloadLink = document.createElement("a");
    downloadLink.className = "primary-button format-action";
    downloadLink.href = format.url;
    downloadLink.textContent = "Download";

    actions.appendChild(playButton);
    actions.appendChild(downloadLink);
    card.appendChild(meta);
    card.appendChild(actions);
    list.appendChild(card);
  }

  section.appendChild(list);
  return section;
}

function renderDetails(details) {
  elements.videoView.hidden = false;
  elements.detailsLoading.hidden = true;
  elements.detailsPanel.hidden = false;
  elements.resultsGrid.hidden = true;
  elements.resultsActions.hidden = true;
  elements.detailsTitle.textContent = details.title || "";
  elements.detailsChannel.textContent = details.channel || "";
  elements.detailsDuration.textContent = `Duration: ${formatDuration(details.duration)}`;
  resetDetailsPreview();
  elements.detailsThumbnail.src = details.thumbnail || "";
  elements.detailsThumbnail.alt = details.title || "Video thumbnail";
  renderPreviewActions(details);
  elements.formatGroups.innerHTML = "";

  if (details.videoFormats?.length) {
    elements.formatGroups.appendChild(renderFormats("Video", details.videoFormats.slice(0, 4)));
  }

  if (details.audioFormats?.length) {
    elements.formatGroups.appendChild(renderFormats("Audio", details.audioFormats.slice(0, 4)));
  }
}

async function loadDetails(result) {
  setStatus("");
  elements.videoView.hidden = false;
  elements.detailsLoading.hidden = false;
  elements.detailsPanel.hidden = true;
  elements.resultsGrid.hidden = true;
  elements.resultsActions.hidden = true;

  try {
    const response = await fetch(`/api/info?url=${encodeURIComponent(result.url)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load video details.");
    }

    renderDetails(payload);
    setStatus("");
  } catch (error) {
    elements.videoView.hidden = true;
    elements.detailsLoading.hidden = true;
    setStatus(error.message || "Failed to load details.", "error");
  }
}

async function searchByDirectUrl(videoId, originalQuery) {
  const directUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(`/api/oembed?url=${encodeURIComponent(directUrl)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load the pasted link.");
  }

  state.results = [
    {
      id: videoId,
      title: payload.title || originalQuery,
      channel: payload.author_name || "YouTube",
      duration: 0,
      thumbnail: `/api/thumb?id=${encodeURIComponent(videoId)}`,
      url: directUrl,
    },
  ];

  renderResults();
  elements.heroEmpty.hidden = true;
  await loadDetails(state.results[0]);
}

async function runSearch() {
  const query = elements.input.value.trim();
  const now = Date.now();

  if (!query || state.loading) {
    return;
  }

  if (state.lastSubmittedQuery === query && now - state.lastSubmitAt < 800) {
    return;
  }

  state.lastSubmittedQuery = query;
  state.lastSubmitAt = now;
  state.currentQuery = query;
  state.currentPage = 1;
  state.loading = true;
  state.loadingMore = false;
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  clearTimeout(suggestTimer);
  renderSuggestions();
  elements.pasteButton.disabled = true;
  elements.searchButton.disabled = true;
  elements.searchButton.innerHTML = buttonLoadingMarkup(SEARCH_BUTTON_LABEL);
  elements.heroEmpty.hidden = true;
  elements.videoView.hidden = true;
  setStatus("Searching...");

  try {
    const videoId = extractYouTubeVideoId(query);

    if (videoId) {
      await searchByDirectUrl(videoId, query);
    } else {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=1`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Search failed.");
      }

      state.results = Array.isArray(payload) ? payload : [];
      renderResults();

      if (state.results.length === 0) {
        elements.heroEmpty.hidden = false;
        elements.heroCopy.textContent = "No results found.";
        setStatus("Try a different search term.");
      } else {
        setStatus("");
      }
    }
  } catch (error) {
    state.results = [];
    renderResults();
    elements.videoView.hidden = true;
    elements.heroEmpty.hidden = false;
    elements.heroCopy.textContent = "Search for a video to get started.";
    setStatus(error.message || "Search failed.", "error");
  } finally {
    state.loading = false;
    elements.pasteButton.disabled = false;
    elements.searchButton.disabled = false;
    elements.searchButton.innerHTML = SEARCH_BUTTON_LABEL;
  }
}

async function loadMoreResults() {
  if (state.loading || state.loadingMore || !state.currentQuery) {
    return;
  }

  state.loadingMore = true;
  elements.searchMoreButton.disabled = true;
  elements.searchMoreButton.innerHTML = buttonLoadingMarkup(SEARCH_MORE_LABEL);
  setStatus("");

  try {
    const nextPage = state.currentPage + 1;
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(state.currentQuery)}&page=${encodeURIComponent(String(nextPage))}`
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error || "Search failed.");
    }

    const nextResults = Array.isArray(payload) ? payload : [];
    if (nextResults.length === 0) {
      elements.searchMoreButton.innerHTML = "No more videos";
      elements.searchMoreButton.disabled = true;
      return;
    }

    state.currentPage = nextPage;
    state.results = [...state.results, ...nextResults];
    appendResults(nextResults);
    elements.searchMoreButton.innerHTML = SEARCH_MORE_LABEL;
    elements.searchMoreButton.disabled = false;
  } catch (error) {
    elements.searchMoreButton.innerHTML = SEARCH_MORE_LABEL;
    elements.searchMoreButton.disabled = false;
    setStatus(error.message || "Failed to load more videos.", "error");
  } finally {
    state.loadingMore = false;
  }
}

async function loadSuggestions() {
  const query = elements.input.value.trim();

  if (!query || looksLikeUrl(query)) {
    state.suggestions = [];
    state.activeSuggestionIndex = -1;
    renderSuggestions();
    return;
  }

  try {
    const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    state.suggestions = Array.isArray(payload) ? payload.slice(0, 6) : [];
    state.activeSuggestionIndex = state.suggestions.length > 0 ? 0 : -1;
    renderSuggestions();
  } catch {
    state.suggestions = [];
    state.activeSuggestionIndex = -1;
    renderSuggestions();
  }
}

async function pasteFromClipboard() {
  if (state.loading) {
    return;
  }

  if (!navigator.clipboard?.readText) {
    setStatus("Clipboard paste is not available in this browser.", "error");
    return;
  }

  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      setStatus("Clipboard is empty.");
      return;
    }

    elements.input.value = text;
    elements.heroCopy.textContent = "Search for a video to get started.";
    state.suggestions = [];
    renderSuggestions();
    await runSearch();
  } catch {
    setStatus("Clipboard access was blocked by the browser.", "error");
  }
}

elements.pasteButton.addEventListener("click", () => {
  void pasteFromClipboard();
});

elements.searchButton.addEventListener("click", () => {
  void runSearch();
});

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    if (state.suggestions.length === 0) {
      return;
    }
    event.preventDefault();
    state.activeSuggestionIndex =
      state.activeSuggestionIndex < state.suggestions.length - 1
        ? state.activeSuggestionIndex + 1
        : 0;
    elements.input.value = state.suggestions[state.activeSuggestionIndex];
    renderSuggestions();
    return;
  }

  if (event.key === "ArrowUp") {
    if (state.suggestions.length === 0) {
      return;
    }
    event.preventDefault();
    state.activeSuggestionIndex =
      state.activeSuggestionIndex > 0
        ? state.activeSuggestionIndex - 1
        : state.suggestions.length - 1;
    elements.input.value = state.suggestions[state.activeSuggestionIndex];
    renderSuggestions();
    return;
  }

  if (event.key === "Escape") {
    state.suggestions = [];
    state.activeSuggestionIndex = -1;
    renderSuggestions();
    return;
  }

  if (event.key === "Enter" && !event.repeat) {
    event.preventDefault();
    if (state.activeSuggestionIndex >= 0 && state.suggestions[state.activeSuggestionIndex]) {
      elements.input.value = state.suggestions[state.activeSuggestionIndex];
    }
    void runSearch();
  }
});

elements.input.addEventListener("input", () => {
  elements.heroCopy.textContent = "Search for a video to get started.";
  state.activeSuggestionIndex = -1;
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => {
    void loadSuggestions();
  }, 220);
});

elements.recognizeButton.addEventListener("click", () => {
  setStatus("Recognize is not available in the static fallback client.", "error");
});

elements.searchMoreButton.addEventListener("click", () => {
  void loadMoreResults();
});

function syncVideoControls() {
  const duration = Number.isFinite(elements.detailsPlayer.duration)
    ? elements.detailsPlayer.duration
    : 0;
  const currentTime = Number.isFinite(elements.detailsPlayer.currentTime)
    ? elements.detailsPlayer.currentTime
    : 0;

  elements.videoSeek.max = String(duration || 100);
  elements.videoSeek.value = String(Math.min(currentTime, duration || currentTime || 0));
  elements.videoTime.textContent = `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;
  elements.videoPlayToggle.textContent = elements.detailsPlayer.paused ? "Play" : "Pause";
}

elements.videoPlayToggle.addEventListener("click", () => {
  if (!elements.detailsPlayer.src) {
    return;
  }

  if (elements.detailsPlayer.paused) {
    void elements.detailsPlayer.play().catch(() => {});
    return;
  }

  elements.detailsPlayer.pause();
});

elements.videoBackward.addEventListener("click", () => {
  elements.detailsPlayer.currentTime = Math.max(0, elements.detailsPlayer.currentTime - 10);
});

elements.videoForward.addEventListener("click", () => {
  const duration = Number.isFinite(elements.detailsPlayer.duration)
    ? elements.detailsPlayer.duration
    : elements.detailsPlayer.currentTime + 10;
  elements.detailsPlayer.currentTime = Math.min(duration, elements.detailsPlayer.currentTime + 10);
});

elements.videoSeek.addEventListener("input", () => {
  const nextTime = Number(elements.videoSeek.value);
  if (Number.isFinite(nextTime)) {
    elements.detailsPlayer.currentTime = nextTime;
  }
});

elements.videoFullscreen.addEventListener("click", async () => {
  const target = elements.detailsPreviewCard;
  if (!document.fullscreenElement) {
    await target.requestFullscreen?.().catch(() => {});
    return;
  }

  if (document.fullscreenElement === target) {
    await document.exitFullscreen?.().catch(() => {});
  }
});

elements.detailsPlayer.addEventListener("loadedmetadata", syncVideoControls);
elements.detailsPlayer.addEventListener("timeupdate", syncVideoControls);
elements.detailsPlayer.addEventListener("play", syncVideoControls);
elements.detailsPlayer.addEventListener("pause", syncVideoControls);
elements.detailsPlayer.addEventListener("ended", syncVideoControls);

elements.backButton.addEventListener("click", () => {
  elements.videoView.hidden = true;
  elements.detailsLoading.hidden = true;
  elements.resultsGrid.hidden = state.results.length === 0;
  elements.resultsActions.hidden = state.results.length === 0;
  setStatus("");
});

document.addEventListener("click", (event) => {
  if (!elements.suggestions.contains(event.target) && event.target !== elements.input) {
    state.suggestions = [];
    state.activeSuggestionIndex = -1;
    renderSuggestions();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
}
