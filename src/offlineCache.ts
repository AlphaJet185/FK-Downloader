const STORAGE_KEY = 'fk-offline-cache-v1';
const MAX_RECENT_SEARCHES = 10;
const MAX_RECENT_VIDEOS = 24;
const MAX_RESULTS_PER_SEARCH = 10;

export interface OfflineSearchResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
}

export interface OfflineFormatOption {
  itag: string;
  qualityLabel: string;
  bitrate: number;
  mimeType?: string;
  hasVideo: boolean;
  hasAudio: boolean;
  contentLength: string;
  url: string;
}

export interface OfflineVideoDetails {
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
  previewUrl?: string;
  audioFormats: OfflineFormatOption[];
  videoFormats: OfflineFormatOption[];
}

interface CachedSearchEntry {
  query: string;
  results: OfflineSearchResult[];
  savedAt: number;
}

interface CachedVideoEntry {
  id: string;
  url: string;
  result: OfflineSearchResult;
  details: OfflineVideoDetails | null;
  savedAt: number;
}

interface OfflineCachePayload {
  recentSearches: CachedSearchEntry[];
  recentVideos: CachedVideoEntry[];
}

function createEmptyCache(): OfflineCachePayload {
  return {
    recentSearches: [],
    recentVideos: []
  };
}

function getStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeText(value = '') {
  return value.trim().toLowerCase();
}

function toStringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function toNumberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeResult(result: Partial<OfflineSearchResult> | null | undefined): OfflineSearchResult {
  return {
    id: toStringValue(result?.id),
    title: toStringValue(result?.title, 'YouTube Video'),
    channel: toStringValue(result?.channel, 'YouTube'),
    duration: toNumberValue(result?.duration),
    thumbnail: toStringValue(result?.thumbnail),
    url: toStringValue(result?.url)
  };
}

function sanitizeFormat(format: Partial<OfflineFormatOption> | null | undefined): OfflineFormatOption {
  return {
    itag: toStringValue(format?.itag),
    qualityLabel: toStringValue(format?.qualityLabel, 'Unknown'),
    bitrate: toNumberValue(format?.bitrate),
    mimeType: toStringValue(format?.mimeType) || undefined,
    hasVideo: Boolean(format?.hasVideo),
    hasAudio: Boolean(format?.hasAudio),
    contentLength: toStringValue(format?.contentLength, 'Unknown'),
    url: toStringValue(format?.url)
  };
}

function sanitizeDetails(details: Partial<OfflineVideoDetails> | null | undefined): OfflineVideoDetails | null {
  if (!details) {
    return null;
  }

  return {
    title: toStringValue(details.title, 'YouTube Video'),
    channel: toStringValue(details.channel, 'YouTube'),
    duration: toNumberValue(details.duration),
    thumbnail: toStringValue(details.thumbnail),
    url: toStringValue(details.url),
    previewUrl: toStringValue(details.previewUrl) || undefined,
    audioFormats: Array.isArray(details.audioFormats) ? details.audioFormats.map(sanitizeFormat) : [],
    videoFormats: Array.isArray(details.videoFormats) ? details.videoFormats.map(sanitizeFormat) : []
  };
}

function readCache(): OfflineCachePayload {
  const storage = getStorage();
  if (!storage) {
    return createEmptyCache();
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyCache();
    }

    const parsed = JSON.parse(raw) as Partial<OfflineCachePayload>;

    const recentSearches = Array.isArray(parsed?.recentSearches)
      ? parsed.recentSearches.map((entry) => ({
          query: toStringValue(entry?.query),
          results: Array.isArray(entry?.results) ? entry.results.map(sanitizeResult) : [],
          savedAt: toNumberValue(entry?.savedAt, Date.now())
        }))
      : [];

    const recentVideos = Array.isArray(parsed?.recentVideos)
      ? parsed.recentVideos.map((entry) => ({
          id: toStringValue(entry?.id),
          url: toStringValue(entry?.url),
          result: sanitizeResult(entry?.result),
          details: sanitizeDetails(entry?.details),
          savedAt: toNumberValue(entry?.savedAt, Date.now())
        }))
      : [];

    return {
      recentSearches,
      recentVideos
    };
  } catch {
    return createEmptyCache();
  }
}

function writeCache(cache: OfflineCachePayload) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures so the main experience keeps working.
  }
}

function matchVideoEntry(entry: CachedVideoEntry, id: string, url: string) {
  const normalizedEntryId = normalizeText(entry.id || entry.result.id);
  const normalizedEntryUrl = normalizeText(entry.url || entry.result.url);

  return (id && normalizedEntryId === id) || (url && normalizedEntryUrl === url);
}

function upsertRecentVideo(
  recentVideos: CachedVideoEntry[],
  result: OfflineSearchResult,
  details: OfflineVideoDetails | null
) {
  const sanitizedResult = sanitizeResult(result);
  const sanitizedDetails = sanitizeDetails(details);
  const normalizedId = normalizeText(sanitizedResult.id);
  const normalizedUrl = normalizeText(sanitizedResult.url);
  const existing = recentVideos.find((entry) => matchVideoEntry(entry, normalizedId, normalizedUrl));

  const nextEntry: CachedVideoEntry = {
    id: sanitizedResult.id,
    url: sanitizedResult.url,
    result: sanitizedResult,
    details: sanitizedDetails || existing?.details || null,
    savedAt: Date.now()
  };

  return [
    nextEntry,
    ...recentVideos.filter((entry) => !matchVideoEntry(entry, normalizedId, normalizedUrl))
  ].slice(0, MAX_RECENT_VIDEOS);
}

function matchesResult(result: OfflineSearchResult, normalizedQuery: string) {
  const haystack = [
    result.title,
    result.channel,
    result.url,
    result.id
  ]
    .map(normalizeText)
    .join(' ');

  return haystack.includes(normalizedQuery);
}

export function saveOfflineSearchResults(query: string, results: OfflineSearchResult[]) {
  const trimmedQuery = query.trim();
  const sanitizedResults = results.map(sanitizeResult).slice(0, MAX_RESULTS_PER_SEARCH);

  if (!trimmedQuery || sanitizedResults.length === 0) {
    return;
  }

  const cache = readCache();
  cache.recentSearches = [
    {
      query: trimmedQuery,
      results: sanitizedResults,
      savedAt: Date.now()
    },
    ...cache.recentSearches.filter((entry) => normalizeText(entry.query) !== normalizeText(trimmedQuery))
  ].slice(0, MAX_RECENT_SEARCHES);

  writeCache(cache);
}

export function saveOfflineVideo(result: OfflineSearchResult, details: OfflineVideoDetails | null) {
  const sanitizedResult = sanitizeResult(result);

  if (!sanitizedResult.id && !sanitizedResult.url) {
    return;
  }

  const cache = readCache();
  cache.recentVideos = upsertRecentVideo(cache.recentVideos, sanitizedResult, details);
  writeCache(cache);
}

export function getRecentOfflineVideos() {
  return readCache().recentVideos.map((entry) => entry.result);
}

export function searchOfflineCache(query: string) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const cache = readCache();
  const exactSearch = cache.recentSearches.find(
    (entry) => normalizeText(entry.query) === normalizedQuery
  );

  if (exactSearch) {
    return exactSearch.results;
  }

  const matches: OfflineSearchResult[] = [];
  const seen = new Set<string>();
  const addMatch = (result: OfflineSearchResult) => {
    const key = normalizeText(result.id || result.url || `${result.title}-${result.channel}`);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    matches.push(result);
  };

  for (const entry of cache.recentVideos) {
    if (matchesResult(entry.result, normalizedQuery)) {
      addMatch(entry.result);
    }
  }

  for (const entry of cache.recentSearches) {
    if (normalizeText(entry.query).includes(normalizedQuery)) {
      entry.results.forEach(addMatch);
      continue;
    }

    entry.results
      .filter((result) => matchesResult(result, normalizedQuery))
      .forEach(addMatch);
  }

  return matches.slice(0, MAX_RESULTS_PER_SEARCH);
}

export function getOfflineSuggestions(query: string) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const cache = readCache();
  const candidates = [
    ...cache.recentSearches.map((entry) => entry.query),
    ...cache.recentVideos.map((entry) => entry.result.title),
    ...cache.recentVideos.map((entry) => `${entry.result.channel} - ${entry.result.title}`)
  ];

  const suggestions: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const trimmedCandidate = candidate.trim();
    const normalizedCandidate = normalizeText(trimmedCandidate);

    if (
      !trimmedCandidate ||
      !normalizedCandidate.includes(normalizedQuery) ||
      seen.has(normalizedCandidate)
    ) {
      continue;
    }

    seen.add(normalizedCandidate);
    suggestions.push(trimmedCandidate);

    if (suggestions.length >= 6) {
      break;
    }
  }

  return suggestions;
}

export function getOfflineVideoEntry(video: Pick<OfflineSearchResult, 'id' | 'url'>) {
  const cache = readCache();
  const normalizedId = normalizeText(video.id);
  const normalizedUrl = normalizeText(video.url);

  const match = cache.recentVideos.find((entry) => matchVideoEntry(entry, normalizedId, normalizedUrl));
  if (!match) {
    return null;
  }

  return {
    result: match.result,
    details: match.details
  };
}
