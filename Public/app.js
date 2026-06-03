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
  selectedResult: null,
  embedCurrentTime: 0,
  embedPlaying: false,
};

const elements = {
  input: document.getElementById("search-input"),
  pasteButton: document.getElementById("paste-button"),
  searchButton: document.getElementById("search-button"),
  heroSettings: document.querySelector(".hero-settings"),
  settingsPanel: document.getElementById("settings-panel"),
  settingsClose: document.getElementById("settings-close"),
  customAccentInput: document.getElementById("custom-accent-input"),
  customAccentValue: document.getElementById("custom-accent-value"),
  customAccentClear: document.getElementById("custom-accent-clear"),
  openSearchButton: document.getElementById("open-search-button"),
  openSavedButton: document.getElementById("open-saved-button"),
  feedbackButton: document.getElementById("feedback-button"),
  changeLocationButton: document.getElementById("change-location-button"),
  saveLocationText: document.getElementById("save-location-text"),
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
  detailsEmbed: document.getElementById("details-embed"),
  detailsPlayer: document.getElementById("details-player"),
  detailsAudioPlayer: document.getElementById("details-audio-player"),
  detailsPreviewCard: document.getElementById("details-preview-card"),
  videoControls: document.getElementById("video-controls"),
  videoSeek: document.getElementById("video-seek"),
  videoPlayToggle: document.getElementById("video-play-toggle"),
  videoPrevious: document.getElementById("video-previous"),
  videoBackward: document.getElementById("video-backward"),
  videoForward: document.getElementById("video-forward"),
  videoNext: document.getElementById("video-next"),
  videoTime: document.getElementById("video-time"),
  videoFullscreen: document.getElementById("video-fullscreen"),
  detailsThumbnail: document.getElementById("details-thumbnail"),
  detailsPreviewActions: document.getElementById("details-preview-actions"),
  formatGroups: document.getElementById("format-groups"),
};

let suggestTimer = null;
const SEARCH_BUTTON_LABEL = "Search";
const SEARCH_MORE_LABEL = "Search more";
const SEARCH_PAGE_SIZE = 30;
const MAX_SEARCH_PAGE = 3;
const THEME_STORAGE_KEY = "fk-downloader-theme";
const CUSTOM_ACCENT_STORAGE_KEY = "fk-downloader-custom-accent";
const DEFAULT_THEME = "rose";
const THEME_CHOICES = ["rose", "coral", "orchid", "violet", "sky", "cobalt", "amber", "sunset"];

function normalizeHexColor(value) {
  const hex = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toLowerCase()}`;
  }

  return "";
}

function hexToRgba(hex, alpha) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return "";
  }

  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buttonLoadingMarkup(label) {
  return `<span class="button-loader" aria-hidden="true"></span><span>${label}</span>`;
}

function setTheme(theme) {
  const nextTheme = THEME_CHOICES.includes(theme) ? theme : DEFAULT_THEME;
  document.body.dataset.theme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.themeChoice === nextTheme);
  });
  syncCustomAccent();
}

function syncCustomAccent() {
  const customAccent = normalizeHexColor(localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY));
  if (customAccent) {
    document.body.style.setProperty("--accent", customAccent);
    document.body.style.setProperty("--border", hexToRgba(customAccent, 0.28));
    if (elements.customAccentInput) {
      elements.customAccentInput.value = customAccent;
    }
    if (elements.customAccentValue) {
      elements.customAccentValue.textContent = customAccent;
    }
    return;
  }

  document.body.style.removeProperty("--accent");
  document.body.style.removeProperty("--border");
  if (elements.customAccentInput) {
    elements.customAccentInput.value = normalizeHexColor("#f472b6");
  }
  if (elements.customAccentValue) {
    elements.customAccentValue.textContent = "#f472b6";
  }
}

function setCustomAccent(value) {
  const nextAccent = normalizeHexColor(value);
  if (!nextAccent) {
    return;
  }

  localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, nextAccent);
  syncCustomAccent();
}

function clearCustomAccent() {
  localStorage.removeItem(CUSTOM_ACCENT_STORAGE_KEY);
  syncCustomAccent();
}

function openSettings() {
  elements.settingsPanel.hidden = false;
  document.body.classList.add("settings-open");
}

function closeSettings() {
  elements.settingsPanel.hidden = true;
  document.body.classList.remove("settings-open");
}

function updateSavedLocationText() {
  if (!elements.saveLocationText) {
    return;
  }

  const storedPath = localStorage.getItem("fk-saved-folder-path") || "";
  elements.saveLocationText.textContent = storedPath || "No folder selected yet. Desktop downloads will prompt the first time.";
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

function youtubeEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${encodeURIComponent(
    videoId
  )}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
}

function sendYouTubeCommand(func, args = []) {
  elements.detailsEmbed.contentWindow?.postMessage(
    JSON.stringify({
      event: "command",
      func,
      args,
    }),
    "*",
  );
}

function syncEmbedListening() {
  elements.detailsEmbed.contentWindow?.postMessage(
    JSON.stringify({
      event: "listening",
      id: "fk-local-embed-player",
    }),
    "*",
  );
  sendYouTubeCommand("getCurrentTime");
  sendYouTubeCommand("getPlayerState");
}

window.addEventListener("message", (event) => {
  if (!String(event.origin).includes("youtube.com")) {
    return;
  }

  let payload = event.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return;
    }
  }

  if (payload?.event !== "infoDelivery" || !payload.info) {
    return;
  }

  if (typeof payload.info.currentTime === "number") {
    state.embedCurrentTime = payload.info.currentTime;
  }

  if (typeof payload.info.playerState === "number") {
    state.embedPlaying = payload.info.playerState === 1;
    elements.videoPlayToggle.classList.toggle("is-playing", state.embedPlaying);
    elements.videoPlayToggle.textContent = state.embedPlaying ? "❚❚" : "▶";
  }
});

window.setInterval(() => {
  if (!elements.detailsEmbed.hidden) {
    sendYouTubeCommand("getCurrentTime");
    sendYouTubeCommand("getPlayerState");
  }
}, 1000);

function resetDetailsPreview() {
  elements.detailsEmbed.removeAttribute("src");
  elements.detailsEmbed.hidden = true;
  state.embedCurrentTime = 0;
  state.embedPlaying = false;

  elements.detailsPlayer.pause();
  elements.detailsPlayer.removeAttribute("src");
  elements.detailsPlayer.load();
  elements.detailsPlayer.hidden = true;
  elements.videoSeek.value = "0";
  elements.videoSeek.max = "100";
  elements.videoTime.textContent = "0:00 / 0:00";
  elements.videoPlayToggle.textContent = "▶";
  elements.videoPlayToggle.classList.remove("is-playing");

  elements.detailsAudioPlayer.pause();
  elements.detailsAudioPlayer.removeAttribute("src");
  elements.detailsAudioPlayer.load();
  elements.detailsAudioPlayer.hidden = true;

  elements.detailsThumbnail.hidden = false;
  elements.detailsPreviewActions.hidden = true;
  elements.detailsPreviewActions.innerHTML = "";
  updatePreviewChromeVisibility();
}

function createActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function getFormatLabel(format, fallbackLabel) {
  if (format.qualityLabel) return format.qualityLabel;
  if (format.bitrate) return `${format.bitrate}k`;

  return format.mimeType || fallbackLabel || "Format";
}

function getFormatContainer(format) {
  const subtype = format.mimeType?.split("/")?.[1]?.split(";")?.[0]?.trim()?.toLowerCase();

  if (!subtype) return "";
  if (subtype === "mpeg") return "mp3";
  if (subtype === "x-m4a") return "m4a";

  return subtype;
}

function getFormatCodecBadges(format) {
  const container = getFormatContainer(format);
  const codecMatch = format.mimeType?.match(/codecs="([^"]+)"/i);
  const codecs = codecMatch?.[1]
    ?.split(",")
    .map((codec) => codec.trim().split(".")[0])
    .filter(Boolean);

  return [container, ...(codecs || [])].filter((value, index, values) => value && values.indexOf(value) === index);
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
  elements.detailsEmbed.hidden = true;
  elements.detailsThumbnail.hidden = true;
  updatePreviewChromeVisibility();
}

function renderPreviewActions(details) {
  elements.detailsPreviewActions.innerHTML = "";
  const bestAudio = details.audioFormats?.[0] || null;
  const bestVideo = details.videoFormats?.[0] || null;

  if (!bestAudio && !bestVideo) {
    elements.detailsPreviewActions.hidden = true;
    return;
  }

  const title = document.createElement("div");
  title.className = "preview-actions-title";
  title.textContent = "Quick downloads";
  elements.detailsPreviewActions.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "preview-actions-grid";

  const createDownloadAction = (format, label, tone = "ghost") => {
    if (!format?.url) {
      return null;
    }

    const link = document.createElement("a");
    link.className = `${tone === "primary" ? "primary-button" : "ghost-button"} preview-action-link`;
    link.href = format.url;
    link.download = "";
    link.rel = "noopener";
    link.innerHTML = `
      <span>${label}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"></path>
      </svg>
    `;
    return link;
  };

  const audioButton = createDownloadAction(bestAudio, bestAudio.qualityLabel?.startsWith("MP3") ? bestAudio.qualityLabel : "Download MP3", "primary");
  const videoButton = createDownloadAction(bestVideo, bestVideo.qualityLabel?.includes("p") ? `Download ${bestVideo.qualityLabel}` : "Download MP4");

  if (audioButton) actions.appendChild(audioButton);
  if (videoButton) actions.appendChild(videoButton);

  elements.detailsPreviewActions.appendChild(actions);
  elements.detailsPreviewActions.hidden = false;
}

function renderResults() {
  elements.resultsGrid.innerHTML = "";
  elements.resultsGrid.hidden = state.results.length === 0;
  elements.resultsActions.hidden = state.results.length === 0;
  const canLoadMore = state.currentQuery && state.currentPage < MAX_SEARCH_PAGE && state.results.length >= SEARCH_PAGE_SIZE;
  elements.searchMoreButton.innerHTML = canLoadMore ? SEARCH_MORE_LABEL : "No more videos";
  elements.searchMoreButton.disabled = state.loadingMore || !canLoadMore;

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
  const canLoadMore = state.currentQuery && state.currentPage < MAX_SEARCH_PAGE && nextResults.length >= SEARCH_PAGE_SIZE;
  elements.searchMoreButton.innerHTML = canLoadMore ? SEARCH_MORE_LABEL : "No more videos";
  elements.searchMoreButton.disabled = state.loadingMore || !canLoadMore;

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
  section.innerHTML = `<h3>${label === "Audio" ? "♫" : "▣"} ${label}</h3>`;
  const list = document.createElement("div");
  list.className = "format-list";

  for (const format of formats) {
    const row = document.createElement("article");
    row.className = "format-row";

    const meta = document.createElement("div");
    meta.className = "format-row-meta";
    const badges = getFormatCodecBadges(format)
      .map((badge) => `<span class="format-badge ${badge === "av01" ? "format-badge-warn" : ""}">${badge}</span>`)
      .join("");
    meta.innerHTML = `
      <strong>${getFormatLabel(format, label)}${format.hasAudio && label === "Video" ? " ♫" : ""}</strong>
      <div class="format-badges">${badges || `<span class="format-badge">${label.toLowerCase()}</span>`}</div>
    `;

    const size = document.createElement("div");
    size.className = "format-row-size";
    size.textContent = format.contentLength || "Unknown";

    const downloadLink = document.createElement("a");
    downloadLink.className = "primary-button format-action";
    downloadLink.href = format.url;
    downloadLink.download = "";
    downloadLink.rel = "noopener";
    downloadLink.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"></path>
      </svg>
      <span>Download</span>
    `;

    row.appendChild(meta);
    row.appendChild(size);
    row.appendChild(downloadLink);
    list.appendChild(row);
  }

  section.appendChild(list);
  return section;
}

function renderDetails(details) {
  state.selectedResult = state.selectedResult ? { ...state.selectedResult, ...details } : details;
  elements.videoView.hidden = false;
  elements.detailsLoading.hidden = true;
  elements.detailsPanel.hidden = false;
  elements.resultsGrid.hidden = true;
  elements.resultsActions.hidden = true;
  elements.detailsTitle.textContent = details.title || "";
  elements.detailsChannel.textContent = details.channel || "";
  elements.detailsDuration.textContent = `Duration: ${formatDuration(details.duration)}`;
  resetDetailsPreview();
  elements.detailsEmbed.src = youtubeEmbedUrl(details.id || extractYouTubeVideoId(details.url || ""));
  elements.detailsEmbed.hidden = false;
  elements.detailsEmbed.addEventListener("load", syncEmbedListening, { once: true });
  elements.detailsThumbnail.hidden = true;
  elements.detailsThumbnail.src = details.thumbnail || "";
  elements.detailsThumbnail.alt = details.title || "Video thumbnail";
  renderPreviewActions(details);
  elements.formatGroups.innerHTML = "";
  updatePreviewChromeVisibility();

  if (details.detailsWarning) {
    const warning = document.createElement("div");
    warning.className = "details-warning";
    warning.textContent = details.detailsWarning;
    elements.formatGroups.appendChild(warning);
    return;
  }

  if (details.videoFormats?.length) {
    elements.formatGroups.appendChild(renderFormats("Video", details.videoFormats));
  }

  if (details.audioFormats?.length) {
    elements.formatGroups.appendChild(renderFormats("Audio", details.audioFormats));
  }
}

async function loadDetails(result) {
  state.selectedResult = result;
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

    renderDetails({ ...payload, id: payload?.id || result.id });
    setStatus("");
  } catch (error) {
    renderDetails({
      ...result,
      id: result.id,
      title: result.title,
      channel: result.channel,
      duration: result.duration || 0,
      thumbnail: result.thumbnail,
      url: result.url,
      audioFormats: [],
      videoFormats: [],
      detailsWarning: "Download options could not be loaded right now. You can still play the video in the app.",
    });
    setStatus("Download options are unavailable right now.", "muted");
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
    elements.heroCopy.textContent = "Paste a YouTube URL or type a title above. Results, previews, and download choices appear here.";
    setStatus(error.message || "Search failed.", "error");
  } finally {
    state.loading = false;
    elements.pasteButton.disabled = false;
    elements.searchButton.disabled = false;
    elements.searchButton.innerHTML = SEARCH_BUTTON_LABEL;
  }
}

async function loadMoreResults() {
  if (state.loading || state.loadingMore || !state.currentQuery || state.currentPage >= MAX_SEARCH_PAGE) {
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
    elements.heroCopy.textContent = "Paste a YouTube URL or type a title above. Results, previews, and download choices appear here.";
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

elements.heroSettings?.addEventListener("click", () => {
  openSettings();
});

elements.settingsClose?.addEventListener("click", () => {
  closeSettings();
});

document.querySelectorAll("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
});

elements.customAccentInput?.addEventListener("input", () => {
  setCustomAccent(elements.customAccentInput.value);
});

elements.customAccentClear?.addEventListener("click", () => {
  clearCustomAccent();
});

elements.openSearchButton?.addEventListener("click", () => {
  closeSettings();
  elements.input.focus();
});

elements.openSavedButton?.addEventListener("click", () => {
  closeSettings();
  setStatus("Open the saved files section on the main page.");
});

elements.feedbackButton?.addEventListener("click", () => {
  closeSettings();
  setStatus("Feedback is handled from the main page in this static client.", "muted");
});

elements.changeLocationButton?.addEventListener("click", () => {
  const nextPath = window.prompt("Enter a save folder path", localStorage.getItem("fk-saved-folder-path") || "");
  if (nextPath === null) {
    return;
  }

  localStorage.setItem("fk-saved-folder-path", nextPath.trim());
  updateSavedLocationText();
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
    state.suggestions = [];
    state.activeSuggestionIndex = -1;
    renderSuggestions();
    elements.input.blur();
    void runSearch();
  }
});

elements.input.addEventListener("input", () => {
  elements.heroCopy.textContent = "Paste a YouTube URL or type a title above. Results, previews, and download choices appear here.";
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
  if (!elements.detailsEmbed.hidden) {
    elements.videoSeek.max = "100";
    elements.videoSeek.value = "0";
    elements.videoTime.textContent = "";
    elements.videoPlayToggle.textContent = state.embedPlaying ? "❚❚" : "▶";
    elements.videoPlayToggle.classList.toggle("is-playing", state.embedPlaying);
    return;
  }

  const duration = Number.isFinite(elements.detailsPlayer.duration)
    ? elements.detailsPlayer.duration
    : 0;
  const currentTime = Number.isFinite(elements.detailsPlayer.currentTime)
    ? elements.detailsPlayer.currentTime
    : 0;

  elements.videoSeek.max = String(duration || 100);
  elements.videoSeek.value = String(Math.min(currentTime, duration || currentTime || 0));
  elements.videoTime.textContent = `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;
  elements.videoPlayToggle.textContent = elements.detailsPlayer.paused ? "▶" : "❚❚";
  elements.videoPlayToggle.classList.toggle("is-playing", !elements.detailsPlayer.paused);
}

function updatePreviewChromeVisibility() {
  const usingEmbed = !elements.detailsEmbed.hidden;
  const usingVideo = !elements.detailsPlayer.hidden;
  const usingAudio = !elements.detailsAudioPlayer.hidden;
  const showCustomChrome = usingVideo && !usingEmbed && !usingAudio;

  elements.videoControls.hidden = !showCustomChrome;
  elements.videoFullscreen.hidden = !showCustomChrome;
}

elements.videoPlayToggle.addEventListener("click", () => {
  if (!elements.detailsEmbed.hidden) {
    sendYouTubeCommand(state.embedPlaying ? "pauseVideo" : "playVideo");
    state.embedPlaying = !state.embedPlaying;
    syncVideoControls();
    return;
  }

  if (!elements.detailsPlayer.src) {
    return;
  }

  if (elements.detailsPlayer.paused) {
    void elements.detailsPlayer.play().catch(() => {});
    return;
  }

  elements.detailsPlayer.pause();
});

elements.videoPrevious.addEventListener("click", () => {
  const currentIndex = state.selectedResult
    ? state.results.findIndex((result) => result.id === state.selectedResult.id)
    : -1;
  if (currentIndex > 0) {
    void loadDetails(state.results[currentIndex - 1]);
  }
});

elements.videoBackward.addEventListener("click", () => {
  if (!elements.detailsEmbed.hidden) {
    state.embedCurrentTime = Math.max(0, state.embedCurrentTime - 10);
    sendYouTubeCommand("seekTo", [state.embedCurrentTime, true]);
    return;
  }

  elements.detailsPlayer.currentTime = Math.max(0, elements.detailsPlayer.currentTime - 10);
});

elements.videoForward.addEventListener("click", () => {
  if (!elements.detailsEmbed.hidden) {
    state.embedCurrentTime = Math.max(0, state.embedCurrentTime + 10);
    sendYouTubeCommand("seekTo", [state.embedCurrentTime, true]);
    return;
  }

  const duration = Number.isFinite(elements.detailsPlayer.duration)
    ? elements.detailsPlayer.duration
    : elements.detailsPlayer.currentTime + 10;
  elements.detailsPlayer.currentTime = Math.min(duration, elements.detailsPlayer.currentTime + 10);
});

elements.videoNext.addEventListener("click", () => {
  const currentIndex = state.selectedResult
    ? state.results.findIndex((result) => result.id === state.selectedResult.id)
    : -1;
  if (currentIndex >= 0 && currentIndex < state.results.length - 1) {
    void loadDetails(state.results[currentIndex + 1]);
  }
});

elements.videoSeek.addEventListener("input", () => {
  if (!elements.detailsEmbed.hidden) {
    return;
  }

  const nextTime = Number(elements.videoSeek.value);
  if (Number.isFinite(nextTime)) {
    elements.detailsPlayer.currentTime = nextTime;
  }
});

elements.videoFullscreen.addEventListener("click", async () => {
  const target = !elements.detailsEmbed.hidden ? elements.detailsEmbed : elements.detailsPreviewCard;
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

setTheme(localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME);
updateSavedLocationText();
closeSettings();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
}
