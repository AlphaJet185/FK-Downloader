const state = {
  suggestions: [],
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
  detailsThumbnail: document.getElementById("details-thumbnail"),
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

  for (const suggestion of state.suggestions) {
    const item = document.createElement("li");
    item.textContent = suggestion;
    item.addEventListener("click", () => {
      elements.input.value = suggestion;
      state.suggestions = [];
      renderSuggestions();
      void runSearch();
    });
    elements.suggestions.appendChild(item);
  }
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
    const link = document.createElement("a");
    link.className = "format-link";
    link.href = format.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.innerHTML = `<span>${format.qualityLabel || format.mimeType || "Format"}</span><span>${format.contentLength || ""}</span>`;
    list.appendChild(link);
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
  elements.detailsThumbnail.src = details.thumbnail || "";
  elements.detailsThumbnail.alt = details.title || "Video thumbnail";
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
    renderSuggestions();
    return;
  }

  try {
    const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    state.suggestions = Array.isArray(payload) ? payload.slice(0, 6) : [];
    renderSuggestions();
  } catch {
    state.suggestions = [];
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
  if (event.key === "Enter" && !event.repeat) {
    event.preventDefault();
    void runSearch();
  }
});

elements.input.addEventListener("input", () => {
  elements.heroCopy.textContent = "Search for a video to get started.";
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
