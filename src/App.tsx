import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Clock3,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDriveDownload,
  Headphones,
  LayoutGrid,
  Loader2,
  Mic,
  MessageSquare,
  Maximize2,
  Music,
  Info,
  Pause,
  Play,
  Radio,
  Search,
  Settings,
  Sparkles,
  UploadCloud,
  Youtube,
  Video,
  MonitorSmartphone,
  Wifi,
  WifiOff
} from 'lucide-react';
import { FeedbackModal } from './Components/FeedbackModal';
import {
  DOWNLOAD_CANCELLED_MESSAGE,
  downloadVideo,
  fetchDownloadUrl,
  fetchVideoDownload,
  openDownloadUrl,
  type DownloadProgress
} from './download';
import {
  getOfflineSuggestions,
  getOfflineVideoEntry,
  getRecentOfflineVideos,
  saveOfflineSearchResults,
  saveOfflineVideo,
  searchOfflineCache
} from './offlineCache';
import {
  getOfflineDownload,
  listOfflineDownloads,
  saveOfflineDownload,
  type OfflineDownloadMeta,
  type OfflineDownloadRecord
} from './offlineMedia';
import {
  getDownloadSettings,
  getSavedDownloads,
  markSaveLocationPrompted,
  removeSavedDownload,
  setDownloadFolder,
  upsertSavedDownload,
  type SavedDownloadRecord
} from './downloadLibrary';

interface SearchResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
}

type SelectedVideo = SearchResult;

interface RecognitionResult {
  artist: string;
  title: string;
  album?: string;
  releaseDate?: string;
}

interface FormatOption {
  itag: string;
  qualityLabel: string;
  bitrate: number;
  mimeType?: string;
  hasVideo: boolean;
  hasAudio: boolean;
  contentLength: string;
  url: string;
}

interface VideoDetails {
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
  previewUrl?: string;
  audioFormats: FormatOption[];
  videoFormats: FormatOption[];
}

interface DownloadState extends DownloadProgress {
  key: string;
  label: string;
}

type ToastTone = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

type ResultSource = 'live' | 'offline-search';
type AppView = 'home' | 'settings';
type LibraryFilter = 'all' | 'saved' | 'offline';
type LibrarySort = 'newest' | 'size' | 'title';
type ThemeChoice = 'emerald' | 'ocean' | 'violet' | 'sunset';

const OFFLINE_MODE_MESSAGE =
  'Recent searches and opened videos stay available. Preview, downloads, and YouTube links come back when you reconnect.';
const SEARCH_PAGE_SIZE = 30;
const MAX_SEARCH_PAGE = 3;
const THEME_STORAGE_KEY = 'fk-downloader-theme';
const THEME_OPTIONS: Array<{ id: ThemeChoice; label: string; swatch: string; rootClass: string }> = [
  {
    id: 'emerald',
    label: 'Emerald',
    swatch: 'bg-emerald-400',
    rootClass: 'from-emerald-950 via-zinc-950 to-emerald-900 text-emerald-50'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    swatch: 'bg-cyan-400',
    rootClass: 'from-cyan-950 via-zinc-950 to-blue-950 text-cyan-50'
  },
  {
    id: 'violet',
    label: 'Violet',
    swatch: 'bg-violet-400',
    rootClass: 'from-violet-950 via-zinc-950 to-fuchsia-950 text-violet-50'
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatch: 'bg-orange-400',
    rootClass: 'from-orange-950 via-zinc-950 to-rose-950 text-orange-50'
  }
];

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatRemainingDuration(currentTime: number, totalTime: number) {
  const remaining = Math.max(0, Math.floor(totalTime || 0) - Math.floor(currentTime || 0));
  return `-${formatDuration(remaining)}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseApproxSize(sizeLabel: string) {
  const match = sizeLabel.trim().match(/^([\d.]+)\s*([KMG]?)(?:B)?$/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }

  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    '': 1,
    K: 1024,
    M: 1024 * 1024,
    G: 1024 * 1024 * 1024
  };

  return Math.round(value * (multipliers[unit] || 1));
}

function formatRelativeTime(timestamp: number) {
  const delta = Date.now() - timestamp;

  if (delta < 60_000) {
    return 'just now';
  }

  if (delta < 3_600_000) {
    return `${Math.max(1, Math.floor(delta / 60_000))} min ago`;
  }

  if (delta < 86_400_000) {
    return `${Math.max(1, Math.floor(delta / 3_600_000))} hr ago`;
  }

  return `${Math.max(1, Math.floor(delta / 86_400_000))} day ago`;
}

function getQualityRank(label: string) {
  const matchedHeight = label.match(/(\d{3,4})p/i);
  if (matchedHeight) {
    return Number(matchedHeight[1]);
  }

  const normalized = label.toLowerCase();
  if (normalized.includes('high')) return 720;
  if (normalized.includes('medium')) return 480;
  if (normalized.includes('low')) return 360;
  return 0;
}

function getFormatFileType(format: FormatOption) {
  const mimeSubtype = format.mimeType?.split('/')[1]?.split(';')[0]?.trim().toLowerCase();

  if (!mimeSubtype) {
    return '';
  }

  if (mimeSubtype === 'mp4' || mimeSubtype === 'm4a') {
    return 'mp4a';
  }

  if (mimeSubtype === 'mpeg' || mimeSubtype === 'mp3') {
    return 'mp3';
  }

  return mimeSubtype;
}

function getFormatLabel(format: FormatOption) {
  if (format.hasVideo) {
    return format.qualityLabel || getFormatFileType(format) || 'video';
  }

  return getFormatFileType(format).toUpperCase() || 'AUDIO';
}

function getFormatContainer(format: FormatOption) {
  const subtype = format.mimeType?.split('/')[1]?.split(';')[0]?.trim().toLowerCase();

  if (!subtype) return '';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-m4a') return 'm4a';

  return subtype;
}

function getFormatCodecBadges(format: FormatOption) {
  const container = getFormatContainer(format);
  const codecMatch = format.mimeType?.match(/codecs="([^"]+)"/i);
  const codecs = codecMatch?.[1]
    ?.split(',')
    .map((codec) => codec.trim().split('.')[0])
    .filter(Boolean);

  return [container, ...(codecs || [])].filter((value, index, values) => value && values.indexOf(value) === index);
}

function clampPlaybackTime(nextTime: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, nextTime);
  }

  return Math.min(Math.max(0, nextTime), duration);
}

function formatRemainingEstimate(remainingMs: number | null | undefined) {
  if (!remainingMs || remainingMs <= 0) {
    return null;
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds} sec remaining`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds > 0 ? `${minutes} min ${seconds} sec remaining` : `${minutes} min remaining`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours} hr ${remainingMinutes} min remaining`
    : `${hours} hr remaining`;
}

function downloadPhaseLabel(phase: DownloadProgress['phase']) {
  switch (phase) {
    case 'downloading':
      return 'Downloading file...';
    case 'saving':
      return 'Finalizing file...';
    default:
      return 'Preparing download...';
  }
}

function fallbackThumbnail(videoId: string) {
  return `/api/thumb?id=${encodeURIComponent(videoId)}`;
}

function youtubeEmbedUrl(videoId: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `https://www.youtube.com/embed/${encodeURIComponent(
    videoId
  )}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
}

function parseJsonSafely(text: string) {
  if (!text) return null;

  const trimmed = text.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractYouTubeVideoId(input: string) {
  try {
    const trimmed = input.trim();
    const url = new URL(trimmed);
    const hostname = url.hostname.replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] || null;
    }

    if (
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com' ||
      hostname === 'youtube-nocookie.com'
    ) {
      const watchId = url.searchParams.get('v');
      if (watchId) {
        return watchId;
      }

      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      if (
        pathParts[0] === 'shorts' ||
        pathParts[0] === 'embed' ||
        pathParts[0] === 'live' ||
        pathParts[0] === 'v' ||
        pathParts[0] === 'e'
      ) {
        return pathParts[1] || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function looksLikeUrl(input: string) {
  try {
    new URL(input.trim());
    return true;
  } catch {
    return false;
  }
}

function toSearchResultFromOfflineDownload(download: OfflineDownloadMeta): SearchResult {
  return {
    id: download.id,
    title: download.title,
    channel: download.channel,
    duration: download.duration,
    thumbnail: download.thumbnail,
    url: download.sourceUrl
  };
}

function OfflineCopyBadge({ className = '' }: { className?: string }) {
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-950/80 px-2 py-1 text-[11px] font-semibold text-emerald-200 shadow-lg ${className}`}
    >
      Offline Copy
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMoreResults, setIsLoadingMoreResults] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('home');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState('');
  const [detailsWarning, setDetailsWarning] = useState('');
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [videoDetails, setVideoDetails] = useState<VideoDetails | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [downloadState, setDownloadState] = useState<DownloadState | null>(null);
  const [offlineLibrary, setOfflineLibrary] = useState<SearchResult[]>(() => getRecentOfflineVideos());
  const [resultSource, setResultSource] = useState<ResultSource>('live');
  const [offlineDownloads, setOfflineDownloads] = useState<OfflineDownloadMeta[]>([]);
  const [selectedOfflineDownload, setSelectedOfflineDownload] = useState<OfflineDownloadRecord | null>(null);
  const [offlinePlaybackUrl, setOfflinePlaybackUrl] = useState('');
  const [downloadSettings, setDownloadSettings] = useState(() => getDownloadSettings());
  const [savedDownloads, setSavedDownloads] = useState<SavedDownloadRecord[]>(() => getSavedDownloads());
  const [selectedSavedDownload, setSelectedSavedDownload] = useState<SavedDownloadRecord | null>(null);
  const [savedPlaybackUrl, setSavedPlaybackUrl] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [librarySort, setLibrarySort] = useState<LibrarySort>('newest');
  const [settingsThumbnailCount, setSettingsThumbnailCount] = useState(12);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_OPTIONS.some((option) => option.id === storedTheme) ? (storedTheme as ThemeChoice) : 'emerald';
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const suggestTimeoutRef = useRef<number | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const savedFilesSectionRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const savedPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const embedFrameRef = useRef<HTMLIFrameElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const savedPreviewPanelRef = useRef<HTMLDivElement | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [embedCurrentTime, setEmbedCurrentTime] = useState(0);
  const [isEmbedPlaying, setIsEmbedPlaying] = useState(false);
  const [isSavedPreviewPlaying, setIsSavedPreviewPlaying] = useState(false);
  const [isSavedPreviewLoading, setIsSavedPreviewLoading] = useState(false);
  const [savedPreviewCurrentTime, setSavedPreviewCurrentTime] = useState(0);
  const [savedPreviewDuration, setSavedPreviewDuration] = useState(0);
  const activeTheme = THEME_OPTIONS.find((option) => option.id === themeChoice) || THEME_OPTIONS[0];

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeChoice;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeChoice);
  }, [themeChoice]);

  useEffect(() => {
    if (!isOffline && status === 'Offline') {
      setStatus('Idle');
    }
  }, [isOffline, status]);

  useEffect(() => {
    setSettingsThumbnailCount((current) => Math.min(Math.max(12, current), Math.max(12, offlineLibrary.length)));
  }, [offlineLibrary.length]);

  useEffect(() => {
    let active = true;

    void listOfflineDownloads()
      .then((downloads) => {
        if (active) {
          setOfflineDownloads(downloads);
        }
      })
      .catch(() => {
        if (active) {
          setOfflineDownloads([]);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      suggestAbortRef.current?.abort();
      setSuggestions([]);
      return;
    }

    if (looksLikeUrl(trimmedQuery)) {
      suggestAbortRef.current?.abort();
      setSuggestions([]);
      return;
    }

    if (isOffline) {
      suggestAbortRef.current?.abort();
      const offlineSuggestions = getOfflineSuggestions(trimmedQuery);
      setSuggestions(offlineSuggestions);
      setShowSuggestions(offlineSuggestions.length > 0);
      return;
    }

    if (suggestTimeoutRef.current) {
      window.clearTimeout(suggestTimeoutRef.current);
    }

    suggestAbortRef.current?.abort();

    suggestTimeoutRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      suggestAbortRef.current = controller;

      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal
        });
        const text = await res.text();
        const data = parseJsonSafely(text);
        if (query.trim() !== trimmedQuery) {
          return;
        }

        const nextSuggestions = Array.isArray(data) ? data : [];
        setSuggestions(nextSuggestions);
        setShowSuggestions(nextSuggestions.length > 0);
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          return;
        }

        if (query.trim() === trimmedQuery) {
          setSuggestions([]);
        }
      }
    }, 250);

    return () => {
      if (suggestTimeoutRef.current) {
        window.clearTimeout(suggestTimeoutRef.current);
      }
      suggestAbortRef.current?.abort();
    };
  }, [isOffline, query]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop?.();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      previewVideoRef.current?.pause();
      savedPreviewVideoRef.current?.pause();
      downloadAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!selectedVideo?.id) {
      setSelectedOfflineDownload(null);
      return () => {
        active = false;
      };
    }

    void getOfflineDownload(selectedVideo.id)
      .then((download) => {
        if (active) {
          setSelectedOfflineDownload(download);
        }
      })
      .catch(() => {
        if (active) {
          setSelectedOfflineDownload(null);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedVideo?.id]);

  useEffect(() => {
    if (!selectedOfflineDownload?.blob) {
      setOfflinePlaybackUrl('');
      return;
    }

    const objectUrl = URL.createObjectURL(selectedOfflineDownload.blob);
    setOfflinePlaybackUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedOfflineDownload]);

  useEffect(() => {
    let active = true;

    if (!selectedSavedDownload?.filePath || !window.electronAPI?.isDesktop) {
      setSavedPlaybackUrl('');
      return () => {
        active = false;
      };
    }

    void window.electronAPI.fileUrl(selectedSavedDownload.filePath).then((url) => {
      if (active) {
        setSavedPlaybackUrl(url);
      }
    });

    return () => {
      active = false;
    };
  }, [selectedSavedDownload]);

  useEffect(() => {
    if (previewVideoRef.current) {
      previewVideoRef.current.pause();
      previewVideoRef.current.currentTime = 0;
    }
    setIsPreviewPlaying(false);
    setIsPreviewLoading(false);
    setPreviewCurrentTime(0);
    setPreviewDuration(0);
    setEmbedCurrentTime(0);
    setIsEmbedPlaying(false);
  }, [selectedVideo?.id, videoDetails?.previewUrl]);

  useEffect(() => {
    const handleEmbedMessage = (event: MessageEvent) => {
      if (!String(event.origin).includes('youtube.com')) {
        return;
      }

      const payload = typeof event.data === 'string' ? parseJsonSafely(event.data) : event.data;
      const info = payload?.info;

      if (payload?.event !== 'infoDelivery' || !info) {
        return;
      }

      if (typeof info.currentTime === 'number') {
        setEmbedCurrentTime(info.currentTime);
      }

      if (typeof info.playerState === 'number') {
        setIsEmbedPlaying(info.playerState === 1);
      }
    };

    window.addEventListener('message', handleEmbedMessage);
    return () => window.removeEventListener('message', handleEmbedMessage);
  }, []);

  useEffect(() => {
    const directPreviewSource = offlinePlaybackUrl || (!isOffline ? videoDetails?.previewUrl || '' : '');

    if (directPreviewSource || isOffline || !selectedVideo) {
      return;
    }

    const timer = window.setInterval(() => {
      sendYouTubeCommand('getCurrentTime');
      sendYouTubeCommand('getPlayerState');
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isOffline, offlinePlaybackUrl, selectedVideo?.id, videoDetails?.previewUrl]);

  useEffect(() => {
    if (savedPreviewVideoRef.current) {
      savedPreviewVideoRef.current.pause();
      savedPreviewVideoRef.current.currentTime = 0;
    }
    setIsSavedPreviewPlaying(false);
    setIsSavedPreviewLoading(false);
    setSavedPreviewCurrentTime(0);
    setSavedPreviewDuration(0);
  }, [selectedSavedDownload?.id, savedPlaybackUrl]);

  const handleSearch = async (searchQuery: string = query, options?: { preserveRecognition?: boolean }) => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;

    setIsSearching(true);
    setShowSuggestions(false);
    setSelectedVideo(null);
    setVideoDetails(null);
    setSearchPage(1);
    setActiveSearchQuery('');
    setHasMoreResults(false);
    if (!options?.preserveRecognition) {
      setRecognition(null);
    }
    setError('');
    setStatus('Searching');

    try {
      const videoId = extractYouTubeVideoId(trimmedQuery);

      if (isOffline) {
        if (videoId) {
          const directUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const cachedVideo = getOfflineVideoEntry({ id: videoId, url: directUrl });

          if (!cachedVideo) {
            throw new Error("You're offline. Open this video online once to save it for offline mode.");
          }

          const cachedResult: SearchResult = {
            ...cachedVideo.result,
            thumbnail: cachedVideo.result.thumbnail || fallbackThumbnail(videoId),
            url: cachedVideo.result.url || directUrl
          };

          setResults([cachedResult]);
          setResultSource('offline-search');
          setHasMoreResults(false);
          setSelectedVideo(cachedResult);

          if (cachedVideo.details) {
            setVideoDetails({
              ...cachedVideo.details,
              thumbnail: cachedVideo.details.thumbnail || cachedResult.thumbnail,
              url: cachedVideo.details.url || cachedResult.url
            });
          } else {
            setVideoDetails(null);
            setError("This video is in your offline history, but its format list wasn't cached yet.");
          }

          setStatus('Offline');
          pushToast('info', 'Offline result loaded', 'Opened a saved video from your local history.');
          return;
        }

        const cachedResults = searchOfflineCache(trimmedQuery).map((result) => ({
          ...result,
          thumbnail: result.thumbnail || fallbackThumbnail(result.id)
        }));

        if (!cachedResults.length) {
          throw new Error("You're offline. Search works with your saved history until you're back online.");
        }

        setResults(cachedResults);
        setResultSource('offline-search');
        setHasMoreResults(false);
        setStatus('Offline');
        pushToast('info', 'Offline search results', `${cachedResults.length} saved result${cachedResults.length === 1 ? '' : 's'} found.`);
        return;
      }

      if (videoId) {
        const directUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const oembedResponse = await fetch(
          `/api/oembed?url=${encodeURIComponent(directUrl)}`
        );

        const oembedText = await oembedResponse.text();
        const oembedPayload = parseJsonSafely(oembedText);

        if (!oembedResponse.ok) {
          throw new Error(oembedPayload?.error || 'Failed to load video from pasted link.');
        }

        if (!oembedPayload) {
          throw new Error('Video info response was not valid JSON.');
        }

        const oembed = oembedPayload;
        const directVideo: SearchResult = {
          id: videoId,
          title: oembed.title || 'YouTube Video',
          channel: oembed.author_name || 'YouTube',
          duration: 0,
          thumbnail: fallbackThumbnail(videoId),
          url: directUrl
        };

        setResults([directVideo]);
        setResultSource('live');
        setHasMoreResults(false);
        saveOfflineSearchResults(trimmedQuery, [directVideo]);
        await loadVideoDetails(directVideo);
        setStatus('Idle');
        pushToast('success', 'Video loaded', 'Direct YouTube link opened successfully.');
        return;
      }

      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}&page=1`);
      const text = await res.text();
      const data = parseJsonSafely(text);

      if (!data && text.trim().startsWith('<')) {
        throw new Error('Search API returned HTML instead of JSON.');
      }

      if (!res.ok) {
        throw new Error(data?.error || 'Search failed');
      }

      const resultsArray = Array.isArray(data) ? data : data?.results || [];

      const normalized = (resultsArray as SearchResult[]).map((result) => ({
        ...result,
        thumbnail: result.thumbnail || fallbackThumbnail(result.id)
      }));

      setResults(normalized);
      setResultSource('live');
      setActiveSearchQuery(trimmedQuery);
      setSearchPage(1);
      setHasMoreResults(normalized.length >= SEARCH_PAGE_SIZE && MAX_SEARCH_PAGE > 1);
      saveOfflineSearchResults(trimmedQuery, normalized);
      setStatus('Idle');
      pushToast(
        'info',
        normalized.length > 0 ? 'Search complete' : 'No results found',
        normalized.length > 0 ? `${normalized.length} video${normalized.length === 1 ? '' : 's'} loaded.` : 'Try a different keyword or paste a direct link.'
      );
    } catch (err: any) {
      setResults([]);
      setHasMoreResults(false);
      setStatus('Idle');
      setError(err?.message || 'Failed to search YouTube.');
      pushToast('error', 'Search failed', err?.message || 'Try again in a moment.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadMoreResults = async () => {
    const trimmedQuery = activeSearchQuery.trim();
    if (!trimmedQuery || isOffline || isSearching || isLoadingMoreResults || !hasMoreResults || searchPage >= MAX_SEARCH_PAGE) {
      return;
    }

    setIsLoadingMoreResults(true);
    setError('');

    try {
      const nextPage = searchPage + 1;
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(trimmedQuery)}&page=${encodeURIComponent(String(nextPage))}`
      );
      const text = await res.text();
      const data = parseJsonSafely(text);

      if (!data && text.trim().startsWith('<')) {
        throw new Error('Search API returned HTML instead of JSON.');
      }

      if (!res.ok) {
        throw new Error(data?.error || 'Search failed');
      }

      const resultsArray = Array.isArray(data) ? data : data?.results || [];
      const normalized = (resultsArray as SearchResult[]).map((result) => ({
        ...result,
        thumbnail: result.thumbnail || fallbackThumbnail(result.id)
      }));

      if (!normalized.length) {
        setHasMoreResults(false);
        pushToast('info', 'No more results', 'Try a different keyword for more videos.');
        return;
      }

      setResults((currentResults) => {
        const existingIds = new Set(currentResults.map((result) => result.id));
        const nextResults = normalized.filter((result) => !existingIds.has(result.id));
        const mergedResults = [...currentResults, ...nextResults];
        saveOfflineSearchResults(trimmedQuery, mergedResults);
        return mergedResults;
      });
      setSearchPage(nextPage);
      setHasMoreResults(normalized.length >= SEARCH_PAGE_SIZE && nextPage < MAX_SEARCH_PAGE);
    } catch (err: any) {
      setError(err?.message || 'Failed to load more videos.');
      pushToast('error', 'Load more failed', err?.message || 'Try again in a moment.');
    } finally {
      setIsLoadingMoreResults(false);
    }
  };

  const loadVideoDetails = async (video: SearchResult) => {
    setSelectedVideo({
      ...video,
      thumbnail: video.thumbnail || fallbackThumbnail(video.id)
    });
    setVideoDetails(null);
    setIsLoadingDetails(true);
    setError('');
    setDetailsWarning('');

    try {
      if (isOffline) {
        const cachedVideo = getOfflineVideoEntry(video);

        if (!cachedVideo) {
          throw new Error("You're offline. This video's details aren't cached yet.");
        }

        const cachedResult: SearchResult = {
          ...cachedVideo.result,
          thumbnail: cachedVideo.result.thumbnail || video.thumbnail || fallbackThumbnail(video.id),
          url: cachedVideo.result.url || video.url
        };

        setSelectedVideo(cachedResult);

        if (!cachedVideo.details) {
          throw new Error("You're offline. This video was saved, but its format list wasn't cached yet.");
        }

        setVideoDetails({
          ...cachedVideo.details,
          thumbnail: cachedVideo.details.thumbnail || cachedResult.thumbnail,
          url: cachedVideo.details.url || cachedResult.url
        });
        setStatus('Offline');
        return;
      }

      const res = await fetch(`/api/info?url=${encodeURIComponent(video.url)}`);
      const text = await res.text();
      const payload = parseJsonSafely(text);

      if (!payload && text.trim().startsWith('<')) {
        throw new Error('Video details API returned HTML instead of JSON.');
      }

      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load video details.');
      }

      const nextDetails: VideoDetails = {
        title: payload?.title || video.title,
        channel: payload?.channel || payload?.uploader || video.channel,
        duration: Number(payload?.duration || video.duration || 0),
        thumbnail: payload?.thumbnail || video.thumbnail || fallbackThumbnail(video.id),
        url: payload?.url || video.url,
        previewUrl: payload?.previewUrl || '',
        audioFormats: Array.isArray(payload?.audioFormats) ? payload.audioFormats : [],
        videoFormats: Array.isArray(payload?.videoFormats) ? payload.videoFormats : []
      };

      setVideoDetails(nextDetails);
      saveOfflineVideo(
        {
          ...video,
          thumbnail: nextDetails.thumbnail || video.thumbnail || fallbackThumbnail(video.id),
          url: nextDetails.url || video.url
        },
        nextDetails
      );
      setOfflineLibrary(getRecentOfflineVideos());
    } catch (err: any) {
      setVideoDetails({
        title: video.title,
        channel: video.channel,
        duration: Number(video.duration || 0),
        thumbnail: video.thumbnail || fallbackThumbnail(video.id),
        url: video.url,
        previewUrl: '',
        audioFormats: [],
        videoFormats: []
      });
      setDetailsWarning('Download options could not be loaded right now. You can still play the video in the app.');
      pushToast('info', 'Playing in app', 'Download options are unavailable right now.');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleVideoClick = (video: SearchResult) => {
    void loadVideoDetails(video);
  };

  const recordRecognitionBlob = async (stream: MediaStream, durationMs = 8000) => {
    const supportedMimeType = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

    const chunks: BlobPart[] = [];
    const recorder = supportedMimeType
      ? new MediaRecorder(stream, { mimeType: supportedMimeType })
      : new MediaRecorder(stream);
    const recordedMimeType = recorder.mimeType || supportedMimeType || 'audio/webm';

    mediaRecorderRef.current = recorder;

    const recordedBlob = await new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => reject(new Error('Recording failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recordedMimeType }));

      recorder.start();
      window.setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, durationMs);
    });

    mediaRecorderRef.current = null;
    return recordedBlob;
  };

  const submitRecognitionBlob = async (recordedBlob: Blob) => {
    setStatus('Recognizing');

    const formData = new FormData();
    formData.append('audio', recordedBlob, 'recognition.webm');

    const res = await fetch('/api/recognize', {
      method: 'POST',
      body: formData
    });

    const recognizeText = await res.text();
    const payload = parseJsonSafely(recognizeText);

    if (!payload && recognizeText.trim().startsWith('<')) {
      throw new Error('Recognition API returned HTML instead of JSON.');
    }

    if (!res.ok) {
      throw new Error(payload?.error || 'Recognition failed');
    }

    const match = payload?.result;
    if (!match?.title) {
      throw new Error('No song match found');
    }

    const recognized: RecognitionResult = {
      artist: match.artist || 'Unknown Artist',
      title: match.title,
      album: match.album,
      releaseDate: match.release_date
    };

    const recognizedQuery = `${recognized.artist} - ${recognized.title}`;
    setRecognition(recognized);
    setQuery(recognizedQuery);
    setStatus('Match found');
    await handleSearch(recognizedQuery, { preserveRecognition: true });
  };

  const handleRecognize = async () => {
    if (isOffline) {
      setError('Recognition needs an internet connection.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recognition is not supported in this browser.');
      return;
    }

    setIsRecognizing(true);
    setError('');
    setStatus('Listening');
    setShowSuggestions(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recordedBlob = await recordRecognitionBlob(stream);

      stream.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      await submitRecognitionBlob(recordedBlob);
    } catch (err: any) {
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setRecognition(null);
      setStatus('Idle');
      setError(err?.message || 'Failed to recognize music.');
    } finally {
      setIsRecognizing(false);
      window.setTimeout(() => setStatus('Idle'), 1500);
    }
  };

  const handleRecognizeCurrentVideo = async () => {
    if (isOffline) {
      setError('Recognition from video needs an internet connection.');
      return;
    }

    const player = previewVideoRef.current;
    if (!player || !previewSourceUrl) {
      setError('Play an online preview first to recognize from it.');
      return;
    }

    const captureStream =
      'captureStream' in player
        ? (player as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.()
        : undefined;

    if (!captureStream || captureStream.getAudioTracks().length === 0) {
      setError('This browser cannot capture audio from the current preview. Use microphone recognize instead.');
      return;
    }

    setIsRecognizing(true);
    setError('');
    setStatus('Listening to preview');
    setShowSuggestions(false);

    const shouldResumeAfter = player.paused;

    try {
      if (player.paused) {
        setIsPreviewLoading(true);
        await player.play();
      }

      const audioStream = new MediaStream(captureStream.getAudioTracks());
      const recordedBlob = await recordRecognitionBlob(audioStream, 7000);
      audioStream.getTracks().forEach((track) => track.stop());

      if (shouldResumeAfter) {
        player.pause();
        setIsPreviewPlaying(false);
        setIsPreviewLoading(false);
      }

      await submitRecognitionBlob(recordedBlob);
    } catch (err: any) {
      mediaRecorderRef.current = null;
      setRecognition(null);
      setStatus('Idle');
      setError(err?.message || 'Failed to recognize from current video.');
    } finally {
      setIsRecognizing(false);
      window.setTimeout(() => setStatus('Idle'), 1500);
    }
  };

  const ensureDownloadFolder = async () => {
    if (!window.electronAPI?.isDesktop) {
      return '';
    }

    const currentSettings = getDownloadSettings();
    if (currentSettings.folderPath) {
      setDownloadSettings(currentSettings);
      return currentSettings.folderPath;
    }

    const result = await window.electronAPI.pickDownloadFolder();
    if (result.canceled || !result.folderPath) {
      markSaveLocationPrompted();
      throw new Error(DOWNLOAD_CANCELLED_MESSAGE);
    }

    const nextSettings = setDownloadFolder(result.folderPath);
    setDownloadSettings(nextSettings);
    return result.folderPath;
  };

  const persistSavedDownload = async (
    bundle: { blob: Blob; fileName: string },
    meta: Omit<SavedDownloadRecord, 'id' | 'filePath' | 'savedAt' | 'sizeBytes'>
  ) => {
    const folderPath = await ensureDownloadFolder();
    if (!folderPath) {
      throw new Error('Choose a save folder before downloading.');
    }

    if (!window.electronAPI?.isDesktop) {
      throw new Error('Saving in the app is only available in the desktop app.');
    }

    const saveResult = await window.electronAPI.saveDownloadToFolder(
      folderPath,
      bundle.fileName,
      await bundle.blob.arrayBuffer(),
      meta
    );

    if (saveResult.canceled || !saveResult.filePath) {
      throw new Error(DOWNLOAD_CANCELLED_MESSAGE);
    }

    const nextRecord: SavedDownloadRecord = {
      id: crypto.randomUUID(),
      sourceId: meta.sourceId,
      sourceUrl: meta.sourceUrl,
      title: meta.title,
      channel: meta.channel,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      fileName: saveResult.filePath.split(/[\\/]/).pop() || bundle.fileName,
      filePath: saveResult.filePath,
      mimeType: meta.mimeType,
      sizeBytes: bundle.blob.size,
      savedAt: Date.now()
    };

    const nextLibrary = upsertSavedDownload(nextRecord);
    setSavedDownloads(nextLibrary);
    setSelectedSavedDownload(nextRecord);
    return nextRecord;
  };

  const handleChangeSaveLocation = async () => {
    if (!window.electronAPI?.isDesktop) {
      setError('Changing save location is only available in the desktop app.');
      pushToast('info', 'Desktop only', 'Open the desktop app to change the save folder.');
      return;
    }

    try {
      const result = await window.electronAPI.pickDownloadFolder(downloadSettings.folderPath || undefined);
      if (result.canceled || !result.folderPath) {
        return;
      }

      const nextSettings = setDownloadFolder(result.folderPath);
      setDownloadSettings(nextSettings);
      setStatus('Save location updated');
      pushToast('success', 'Save location updated', result.folderPath);
      window.setTimeout(() => setStatus('Idle'), 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to change save location.');
      pushToast('error', 'Could not update location', err?.message || 'Pick a different folder and try again.');
    }
  };

  const runDownload = async (
    key: string,
    label: string,
    task: (onProgress: (progress: DownloadProgress) => void, signal: AbortSignal) => Promise<void>
  ) => {
    setError('');
    setStatus('Preparing download');
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setDownloadState({
      key,
      label,
      phase: 'starting',
      receivedBytes: 0,
      totalBytes: null
    });

    try {
      await task((progress) => {
        setDownloadState({
          key,
          label,
          ...progress
        });

        if (progress.phase === 'downloading') {
          setStatus('Downloading');
        } else if (progress.phase === 'saving') {
          setStatus('Finalizing');
        } else {
          setStatus('Preparing download');
        }
      }, controller.signal);

      setStatus('Download ready');
      window.setTimeout(() => setStatus('Idle'), 1500);
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.message === DOWNLOAD_CANCELLED_MESSAGE) {
        setStatus('Idle');
        pushToast('info', 'Download cancelled');
        return false;
      }

      setError(err?.message || 'Download failed.');
      pushToast('error', 'Download failed', err?.message || 'Something went wrong during the transfer.');
      setStatus('Idle');
      return false;
    } finally {
      setDownloadState(null);
      downloadAbortRef.current = null;
    }
  };

  const handleCancelDownload = () => {
    downloadAbortRef.current?.abort();
  };

  const handleDownload = async (url: string) => {
    if (isOffline) {
      setError('Downloads need an internet connection.');
      pushToast('error', 'Download blocked', 'Connect to the internet to save this file.');
      return;
    }

    const fastVideoFormat = videoDetails?.videoFormats?.find((format) => format.hasAudio);
    const sourceUrl = videoDetails?.url || url;
    const thumbnail = videoDetails?.thumbnail || selectedVideo?.thumbnail || fallbackThumbnail(selectedVideo?.id || '');

    const finished = await runDownload(
      'quick-download',
      fastVideoFormat
        ? `Quick download ${fastVideoFormat.qualityLabel}`
        : 'Quick download',
      async (onProgress, signal) => {
        if (fastVideoFormat) {
          const bundle = await fetchDownloadUrl(fastVideoFormat.url, onProgress, { signal });
          await persistSavedDownload(bundle, {
            sourceId: selectedVideo?.id || sourceUrl,
            sourceUrl,
            title: videoDetails?.title || selectedVideo?.title || 'Download',
            channel: videoDetails?.channel || selectedVideo?.channel || 'YouTube',
            duration: videoDetails?.duration || selectedVideo?.duration || 0,
            thumbnail,
            fileName: bundle.fileName,
            mimeType: bundle.blob.type || 'video/mp4'
          });
          return;
        }

        const bundle = await fetchVideoDownload(sourceUrl, 'video', onProgress, { signal });
        await persistSavedDownload(bundle, {
          sourceId: selectedVideo?.id || sourceUrl,
          sourceUrl,
          title: videoDetails?.title || selectedVideo?.title || 'Download',
          channel: videoDetails?.channel || selectedVideo?.channel || 'YouTube',
          duration: videoDetails?.duration || selectedVideo?.duration || 0,
          thumbnail,
          fileName: bundle.fileName,
          mimeType: bundle.blob.type || 'video/mp4'
        });
      }
    );

    if (finished) {
      pushToast('success', 'Saved to library', videoDetails?.title || selectedVideo?.title || 'Your download finished.');
    }
  };

  const handleFormatDownload = async (format: FormatOption) => {
    if (isOffline) {
      setError('Downloads need an internet connection.');
      pushToast('error', 'Download blocked', 'Connect to the internet to save this format.');
      return;
    }

    const extension = format.mimeType ? format.mimeType.split('/')[1] : 'file';
    const typeLabel = format.hasVideo ? 'Video' : 'Audio';
    const sourceUrl = videoDetails?.url || selectedVideo?.url || format.url;
    const thumbnail = videoDetails?.thumbnail || selectedVideo?.thumbnail || fallbackThumbnail(selectedVideo?.id || '');
    const finished = await runDownload(
      `${typeLabel.toLowerCase()}-${format.itag}`,
      `${typeLabel} ${format.qualityLabel} (${extension})`,
      async (onProgress, signal) => {
        const bundle = await fetchDownloadUrl(format.url, onProgress, { signal });
        await persistSavedDownload(bundle, {
          sourceId: selectedVideo?.id || sourceUrl,
          sourceUrl,
          title: videoDetails?.title || selectedVideo?.title || 'Download',
          channel: videoDetails?.channel || selectedVideo?.channel || 'YouTube',
          duration: videoDetails?.duration || selectedVideo?.duration || 0,
          thumbnail,
          fileName: bundle.fileName,
          mimeType: bundle.blob.type || format.mimeType || 'application/octet-stream'
        });
      }
    );

    if (finished) {
      pushToast('success', 'Format saved', `${typeLabel} ${getFormatLabel(format)} added to your library.`);
    }
  };

  const handleSaveOfflineDownload = async () => {
    if (!selectedVideo?.id) {
      return;
    }

    if (isOffline) {
      setError('Saving offline copies needs an internet connection.');
      pushToast('error', 'Offline save blocked', 'Reconnect to save a browser copy.');
      return;
    }

    if (selectedOfflineDownload) {
      setError('This video is already saved for offline access.');
      pushToast('info', 'Already saved', 'This video is already available offline.');
      return;
    }

    const sourceUrl = videoDetails?.url || selectedVideo.url;
    const preferredFormat = videoDetails?.videoFormats?.find((format) => format.hasAudio);
    const thumbnail = videoDetails?.thumbnail || selectedVideo.thumbnail || fallbackThumbnail(selectedVideo.id);

    const finished = await runDownload('offline-download', 'Saving for offline access', async (onProgress) => {
      const bundle = preferredFormat
        ? await fetchDownloadUrl(preferredFormat.url, onProgress)
        : await fetchVideoDownload(sourceUrl, 'video', onProgress);

      await saveOfflineDownload(
        {
          id: selectedVideo.id,
          sourceUrl,
          title: videoDetails?.title || selectedVideo.title,
          channel: videoDetails?.channel || selectedVideo.channel,
          duration: videoDetails?.duration || selectedVideo.duration,
          thumbnail,
          fileName: bundle.fileName,
          mimeType: bundle.blob.type || 'video/mp4'
        },
        bundle.blob
      );

      const [downloads, savedDownload] = await Promise.all([
        listOfflineDownloads(),
        getOfflineDownload(selectedVideo.id)
      ]);

      setOfflineDownloads(downloads);
      setSelectedOfflineDownload(savedDownload);
    });

    if (finished) {
      setStatus('Saved offline');
      pushToast('success', 'Offline copy ready', 'You can now open this video in the browser without internet.');
      window.setTimeout(() => setStatus('Idle'), 1500);
    }
  };

  const handleLinkDownload = async (input: string = query) => {
    if (isOffline) {
      setError('Downloads need an internet connection.');
      pushToast('error', 'Download blocked', 'Reconnect before downloading a pasted link.');
      return;
    }

    const videoId = extractYouTubeVideoId(input.trim());
    if (!videoId) {
      setError('Paste a valid YouTube video link first.');
      pushToast('info', 'Need a link', 'Paste a YouTube URL to start a direct download.');
      return;
    }

    const directUrl = `https://www.youtube.com/watch?v=${videoId}`;
    setShowSuggestions(false);

    const finished = await runDownload('link-download', 'Download from pasted link', async (onProgress, signal) => {
      const bundle = await fetchVideoDownload(directUrl, 'video', onProgress, { signal });
      await persistSavedDownload(bundle, {
        sourceId: videoId,
        sourceUrl: directUrl,
        title: videoDetails?.title || directUrl,
        channel: videoDetails?.channel || 'YouTube',
        duration: videoDetails?.duration || 0,
        thumbnail: videoDetails?.thumbnail || fallbackThumbnail(videoId),
        fileName: bundle.fileName,
        mimeType: bundle.blob.type || 'video/mp4'
      });
    });

    if (finished) {
      pushToast('success', 'Link saved', 'The pasted video link has been added to your library.');
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const clipboardText = (await navigator.clipboard.readText()).trim();

      if (!clipboardText) {
        setError('Clipboard is empty.');
        pushToast('info', 'Clipboard empty', 'Copy a link first, then try pasting again.');
        return;
      }

      setError('');
      setQuery(clipboardText);
      setShowSuggestions(!looksLikeUrl(clipboardText));
      setStatus('Clipboard ready');
      pushToast('success', 'Pasted from clipboard', 'Your link was inserted into the search bar.');
      void handleSearch(clipboardText);
    } catch {
      setError('Clipboard access was blocked. Paste the link manually if needed.');
      pushToast('error', 'Clipboard blocked', 'Paste the link manually and try again.');
    }
  };

  const updatePreviewPosition = (nextTime: number) => {
    const player = previewVideoRef.current;
    if (!player) return;

    const duration = player.duration || videoDetails?.duration || selectedVideo?.duration || 0;
    const clampedTime = clampPlaybackTime(nextTime, duration);
    player.currentTime = clampedTime;
    setPreviewCurrentTime(clampedTime);
    setPreviewDuration(duration);
  };

  const updateSavedPreviewPosition = (nextTime: number) => {
    const player = savedPreviewVideoRef.current;
    if (!player) return;

    const duration = player.duration || selectedSavedDownload?.duration || 0;
    const clampedTime = clampPlaybackTime(nextTime, duration);
    player.currentTime = clampedTime;
    setSavedPreviewCurrentTime(clampedTime);
    setSavedPreviewDuration(duration);
  };

  const jumpPreviewBy = (deltaSeconds: number) => {
    const player = previewVideoRef.current;
    if (!player) return;

    updatePreviewPosition((player.currentTime || 0) + deltaSeconds);
  };

  const sendYouTubeCommand = (func: string, args: unknown[] = []) => {
    embedFrameRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args
      }),
      '*'
    );
  };

  const handleEmbedReady = () => {
    embedFrameRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: 'listening',
        id: 'fk-embed-player'
      }),
      '*'
    );
    sendYouTubeCommand('getCurrentTime');
    sendYouTubeCommand('getPlayerState');
  };

  const toggleEmbedPlayback = () => {
    sendYouTubeCommand(isEmbedPlaying ? 'pauseVideo' : 'playVideo');
    setIsEmbedPlaying((current) => !current);
  };

  const jumpEmbedBy = (deltaSeconds: number) => {
    const nextTime = Math.max(0, embedCurrentTime + deltaSeconds);
    setEmbedCurrentTime(nextTime);
    sendYouTubeCommand('seekTo', [nextTime, true]);
  };

  const toggleFullscreen = async (target: HTMLElement | null) => {
    if (!target) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await target.requestFullscreen();
    } catch {
      setError('Fullscreen is not available in this browser.');
    }
  };

  const handlePreviewScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    updatePreviewPosition(Number(event.target.value));
  };

  const handleSavedPreviewScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateSavedPreviewPosition(Number(event.target.value));
  };

  const togglePreviewPlayback = async () => {
    if (isOffline && !offlinePlaybackUrl) {
      setError('Preview playback needs an internet connection.');
      return;
    }

    const player = previewVideoRef.current;
    if (!player) return;

    if (player.paused) {
      setIsPreviewLoading(true);
      try {
        await player.play();
      } catch {
        setIsPreviewPlaying(false);
        setIsPreviewLoading(false);
      }
      return;
    }

    player.pause();
    setIsPreviewPlaying(false);
    setIsPreviewLoading(false);
  };

  const handlePreviewTimeUpdate = () => {
    const player = previewVideoRef.current;
    if (!player) return;

    setPreviewCurrentTime(player.currentTime || 0);
    setPreviewDuration(player.duration || videoDetails?.duration || selectedVideo?.duration || 0);
  };

  const handlePreviewMetadata = () => {
    const player = previewVideoRef.current;
    if (!player) return;

    setPreviewDuration(player.duration || videoDetails?.duration || selectedVideo?.duration || 0);
  };

  const handlePreviewPlaying = () => {
    setIsPreviewPlaying(true);
    setIsPreviewLoading(false);
  };

  const handlePreviewPause = () => {
    setIsPreviewPlaying(false);
    setIsPreviewLoading(false);
  };

  const handlePreviousVideo = () => {
    if (!previousVideo) {
      return;
    }

    void loadVideoDetails(previousVideo);
  };

  const handleNextVideo = () => {
    if (!nextVideo) {
      return;
    }

    void loadVideoDetails(nextVideo);
  };

  const handleSavedPreviewTimeUpdate = () => {
    const player = savedPreviewVideoRef.current;
    if (!player) return;

    setSavedPreviewCurrentTime(player.currentTime || 0);
    setSavedPreviewDuration(player.duration || selectedSavedDownload?.duration || 0);
  };

  const handleSavedPreviewMetadata = () => {
    const player = savedPreviewVideoRef.current;
    if (!player) return;

    setSavedPreviewDuration(player.duration || selectedSavedDownload?.duration || 0);
  };

  const handleSavedPreviewPlaying = () => {
    setIsSavedPreviewPlaying(true);
    setIsSavedPreviewLoading(false);
  };

  const handleSavedPreviewPause = () => {
    setIsSavedPreviewPlaying(false);
    setIsSavedPreviewLoading(false);
  };

  const handlePreviousSavedDownload = () => {
    if (!previousSavedDownload) {
      return;
    }

    handleSavedDownloadClick(previousSavedDownload);
  };

  const handleNextSavedDownload = () => {
    if (!nextSavedDownload) {
      return;
    }

    handleSavedDownloadClick(nextSavedDownload);
  };

  const toggleSavedPreviewPlayback = async () => {
    const player = savedPreviewVideoRef.current;
    if (!player) return;

    if (player.paused) {
      setIsSavedPreviewLoading(true);
      try {
        await player.play();
      } catch {
        setIsSavedPreviewPlaying(false);
        setIsSavedPreviewLoading(false);
      }
      return;
    }

    player.pause();
    setIsSavedPreviewPlaying(false);
    setIsSavedPreviewLoading(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const text = e.dataTransfer.getData('text');
    if (text) {
      setQuery(text);
      void handleSearch(text);
    }
  };

  const handleOfflineDownloadClick = (download: OfflineDownloadMeta) => {
    const result = toSearchResultFromOfflineDownload(download);

    setError('');
    setShowSuggestions(false);

    if (isOffline) {
      setSelectedVideo(result);
      setVideoDetails({
        title: download.title,
        channel: download.channel,
        duration: download.duration,
        thumbnail: download.thumbnail,
        url: download.sourceUrl,
        previewUrl: '',
        audioFormats: [],
        videoFormats: []
      });
      setStatus('Offline');
      return;
    }

    void loadVideoDetails(result);
  };

  const handleSavedDownloadClick = (download: SavedDownloadRecord) => {
    setSelectedSavedDownload(download);
    setSavedPreviewCurrentTime(0);
    setSavedPreviewDuration(0);
    setIsSavedPreviewPlaying(false);
    setIsSavedPreviewLoading(false);
    setStatus('Saved library');
  };

  const handleDeleteSavedDownload = async () => {
    if (!selectedSavedDownload) {
      return;
    }

    const confirmDelete = window.confirm(
      `Delete "${selectedSavedDownload.title}" from the app and your device?`
    );

    if (!confirmDelete) {
      return;
    }

    try {
      if (window.electronAPI?.isDesktop) {
        const result = await window.electronAPI.deleteFile(selectedSavedDownload.filePath);
        if (result.canceled) {
          throw new Error(result.reason || 'Failed to delete file.');
        }
      }

      const nextLibrary = removeSavedDownload(selectedSavedDownload.id);
      setSavedDownloads(nextLibrary);
      setSelectedSavedDownload(null);
      setSavedPlaybackUrl('');
      setStatus('File deleted');
      pushToast('success', 'File deleted', selectedSavedDownload.title);
      window.setTimeout(() => setStatus('Idle'), 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete file.');
      pushToast('error', 'Delete failed', err?.message || 'The file could not be removed.');
    }
  };

  const showingOfflineLibrary = isOffline && !selectedVideo && results.length === 0 && offlineLibrary.length > 0;
  const visibleResults = showingOfflineLibrary ? offlineLibrary : results;
  const showingOfflineSearchResults =
    isOffline && !selectedVideo && resultSource === 'offline-search' && results.length > 0;
  const directInputVideoId = extractYouTubeVideoId(query.trim());
  const directInputHost = looksLikeUrl(query.trim()) ? new URL(query.trim()).hostname.replace(/^www\./, '') : '';
  const directInputThumbnail = directInputVideoId ? fallbackThumbnail(directInputVideoId) : '';
  const canDownloadPastedLink = Boolean(directInputVideoId);
  const showOfflineDownloadsShelf = !selectedVideo && offlineDownloads.length > 0 && (isOffline || visibleResults.length === 0);
  const hasSavedOfflineCopy = Boolean(selectedOfflineDownload);
  const previewSourceUrl = offlinePlaybackUrl || (!isOffline ? videoDetails?.previewUrl || '' : '');
  const shouldMarkVisibleResultsAsOfflineCopy = showingOfflineLibrary || showingOfflineSearchResults;
  const isDesktopApp = Boolean(window.electronAPI?.isDesktop);
  const selectedThumbnail =
    (selectedVideo && (videoDetails?.thumbnail || selectedVideo.thumbnail || fallbackThumbnail(selectedVideo.id))) ||
    '';
  const selectedVideoIndex = selectedVideo
    ? visibleResults.findIndex((result) => result.id === selectedVideo.id)
    : -1;
  const previousVideo = selectedVideoIndex > 0 ? visibleResults[selectedVideoIndex - 1] : null;
  const nextVideo =
    selectedVideoIndex >= 0 && selectedVideoIndex < visibleResults.length - 1
      ? visibleResults[selectedVideoIndex + 1]
      : null;
  const normalizedLibraryQuery = libraryQuery.trim().toLowerCase();
  const filteredOfflineDownloads = offlineDownloads.filter((download) => {
    if (!normalizedLibraryQuery) {
      return true;
    }

    return [download.title, download.channel, download.fileName].some((value) =>
      value.toLowerCase().includes(normalizedLibraryQuery)
    );
  });
  const filteredSavedDownloads = savedDownloads.filter((download) => {
    if (!normalizedLibraryQuery) {
      return true;
    }

    return [download.title, download.channel, download.fileName, download.filePath].some((value) =>
      value.toLowerCase().includes(normalizedLibraryQuery)
    );
  });
  const sortByMode = <T extends OfflineDownloadMeta | SavedDownloadRecord>(items: T[]): T[] => {
    const next = [...items];

    next.sort((left, right) => {
      if (librarySort === 'size') {
        return right.sizeBytes - left.sizeBytes;
      }

      if (librarySort === 'title') {
        return left.title.localeCompare(right.title);
      }

      return right.savedAt - left.savedAt;
    });

    return next;
  };
  const visibleOfflineDownloads: OfflineDownloadMeta[] = sortByMode(filteredOfflineDownloads);
  const visibleSavedDownloads: SavedDownloadRecord[] = sortByMode(filteredSavedDownloads);
  const selectedSavedDownloadIndex = selectedSavedDownload
    ? visibleSavedDownloads.findIndex((download) => download.id === selectedSavedDownload.id)
    : -1;
  const previousSavedDownload =
    selectedSavedDownloadIndex > 0 ? visibleSavedDownloads[selectedSavedDownloadIndex - 1] : null;
  const nextSavedDownload =
    selectedSavedDownloadIndex >= 0 && selectedSavedDownloadIndex < visibleSavedDownloads.length - 1
      ? visibleSavedDownloads[selectedSavedDownloadIndex + 1]
      : null;
  const shouldShowOfflineSection = showOfflineDownloadsShelf && (libraryFilter === 'all' || libraryFilter === 'offline');
  const shouldShowSavedSection = savedDownloads.length > 0 && (libraryFilter === 'all' || libraryFilter === 'saved');
  const totalOfflineSize = offlineDownloads.reduce((sum, download) => sum + download.sizeBytes, 0);
  const totalSavedSize = savedDownloads.reduce((sum, download) => sum + download.sizeBytes, 0);
  const settingsRecentVideos = offlineLibrary.slice(0, settingsThumbnailCount);
  const shouldShowHomeEmptyState = activeView === 'home' && !selectedVideo && visibleResults.length === 0 && !isSearching;
  const recommendedAudioFormat = [...(videoDetails?.audioFormats || [])].sort((left, right) => {
    const sizeDelta = (parseApproxSize(right.contentLength) || 0) - (parseApproxSize(left.contentLength) || 0);
    if (sizeDelta !== 0) {
      return sizeDelta;
    }

    return right.bitrate - left.bitrate;
  })[0];
  const recommendedVideoFormat = [...(videoDetails?.videoFormats || [])].sort((left, right) => {
    const qualityDelta = getQualityRank(right.qualityLabel) - getQualityRank(left.qualityLabel);
    if (qualityDelta !== 0) {
      return qualityDelta;
    }

    return (parseApproxSize(right.contentLength) || 0) - (parseApproxSize(left.contentLength) || 0);
  })[0];
  const recommendedPortableFormat =
    videoDetails?.videoFormats?.find((format) => format.hasAudio && getQualityRank(format.qualityLabel) >= 720) ||
    videoDetails?.videoFormats?.find((format) => format.hasAudio) ||
    recommendedVideoFormat ||
    null;
  const plannerStorageEstimate =
    selectedOfflineDownload?.sizeBytes ||
    parseApproxSize(recommendedPortableFormat?.contentLength || '') ||
    parseApproxSize(recommendedAudioFormat?.contentLength || '');

  const openSavedFilesView = () => {
    setActiveView('home');
    setSelectedVideo(null);
    setShowSuggestions(false);
    window.setTimeout(() => {
      savedFilesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const pushToast = (tone: ToastTone, title: string, description?: string) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, tone, title, description }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  };

  const dismissToast = (id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  return (
    <div
      className={`min-h-screen w-full bg-gradient-to-br px-4 py-4 transition-colors sm:px-6 lg:px-8 ${activeTheme.rootClass} ${
        isDragging ? 'ring-4 ring-emerald-500 ring-inset bg-emerald-900/20' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm pointer-events-none">
          <div className="text-center text-emerald-400 animate-pulse">
            <UploadCloud className="mx-auto mb-4 h-24 w-24" />
            <h2 className="text-3xl font-bold">Drop a URL to search</h2>
          </div>
        </div>
      )}

      <main className="relative z-10 mx-auto flex w-full max-w-[1560px] flex-col gap-8 lg:gap-10">
        <header className="relative pt-4">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10">
            {activeView === 'home' && (
              <>
                <section className="relative overflow-hidden rounded-[2.25rem] border border-emerald-700/30 bg-gradient-to-br from-emerald-950/50 via-zinc-950/90 to-zinc-950/80 px-6 py-12 shadow-[0_30px_90px_rgba(0,0,0,0.35)] sm:px-10 lg:px-20 lg:py-16">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(16,185,129,0.12),transparent_30%),radial-gradient(circle_at_92%_10%,rgba(20,184,166,0.08),transparent_26%)]" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowSuggestions(false);
                      setActiveView('settings');
                    }}
                    className="absolute right-5 top-5 z-10 inline-flex items-center justify-center gap-2 rounded-[1.4rem] border border-emerald-700/35 bg-zinc-950/45 px-4 py-3 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-950/45 sm:right-8 sm:top-8 sm:text-base"
                  >
                    <Settings className="h-5 w-5" />
                    Settings
                  </button>

                  <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] text-emerald-200">
                      <Download className="h-4 w-4" />
                      Fast, ad-free downloads
                    </div>

                    <h1 className="mt-7 max-w-5xl text-4xl font-black tracking-tight text-white sm:text-6xl lg:text-7xl">
                      FK Downloader: The Fast, Ad-Free Way to Save Media
                    </h1>

                    <p className="mt-6 max-w-3xl text-lg font-semibold leading-8 text-emerald-100/65 sm:text-xl">
                      Search or paste a YouTube link, preview in-app, then choose MP3 or MP4 without ads, popups,
                      or extra pages.
                    </p>

                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                      <div className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200">
                        MP4
                      </div>
                      <div className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200">
                        MP3
                      </div>
                      <div className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200">
                        Fast search
                      </div>
                      <div className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200">
                        In-app player
                      </div>
                    </div>

                    <div className="mt-8 grid w-full max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[1.25rem] border border-emerald-700/40 bg-emerald-950/30 px-4 text-sm font-bold text-emerald-200">
                        {isOffline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
                        {isOffline ? 'Offline' : 'Online'}
                      </div>
                      <div className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[1.25rem] border border-white/10 bg-white/7 px-4 text-sm font-bold text-emerald-100/70">
                        <Radio className="h-4 w-4 text-emerald-300" />
                        {status}
                      </div>
                      <div className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[1.25rem] border border-white/10 bg-white/7 px-4 text-sm font-bold text-emerald-100/70">
                        <FolderOpen className="h-4 w-4 text-emerald-300" />
                        {savedDownloads.length} saved
                      </div>
                      <div className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[1.25rem] border border-white/10 bg-white/7 px-4 text-sm font-bold text-emerald-100/70">
                        <WifiOff className="h-4 w-4 text-emerald-300" />
                        {offlineDownloads.length} offline
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  aria-labelledby="start-search-heading"
                  className="rounded-[2rem] border border-emerald-400/45 bg-zinc-950/55 p-5 shadow-[0_0_0_1px_rgba(52,211,153,0.12),0_20px_80px_rgba(16,185,129,0.16)] lg:p-7"
                >
                  <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 id="start-search-heading" className="text-xl font-black text-emerald-50 sm:text-2xl">
                        Start here
                      </h2>
                      <p className="mt-1 text-sm font-semibold text-emerald-300/80">
                        Paste a link or search a title. This is the main action.
                      </p>
                    </div>
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-500">MP3 / MP4 ready</div>
                  </div>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
                    <div className="min-w-0 flex-1">
                      <div className="relative">
                        <label htmlFor="search-input" className="sr-only">
                          Paste a YouTube URL or search for a video
                        </label>
                        <input
                          id="search-input"
                          ref={searchInputRef}
                          type="text"
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            setShowSuggestions(!looksLikeUrl(e.target.value));
                          }}
                          onFocus={() => {
                            if (query.trim() && !looksLikeUrl(query) && suggestions.length > 0) {
                              setShowSuggestions(true);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              setShowSuggestions(false);
                              setSuggestions([]);
                              suggestAbortRef.current?.abort();
                              searchInputRef.current?.blur();
                              void handleSearch();
                            }
                          }}
                          placeholder="Paste YouTube URL or search for a video..."
                          aria-label="Search videos or paste a YouTube URL"
                          aria-describedby="search-help"
                          className="h-16 w-full rounded-[1.35rem] border border-emerald-700/35 bg-black/70 px-5 pl-14 text-[15px] text-emerald-100 placeholder-emerald-600/80 outline-none transition-[border-color,box-shadow,background-color] focus:border-emerald-500/55 focus:bg-zinc-950 focus:ring-2 focus:ring-emerald-500/20 sm:h-[72px] sm:text-[17px]"
                        />
                        <Search className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-emerald-400/90" />
                        <p id="search-help" className="sr-only">
                          Press Enter to search.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 lg:w-[470px] xl:w-[500px]">
                      <button
                        type="button"
                        onClick={() => void handlePasteClipboard()}
                        aria-label="Paste a link from the clipboard"
                        className="inline-flex min-h-[64px] items-center justify-center gap-2 rounded-[1.35rem] border border-white/10 bg-white/5 px-5 py-3 text-base font-bold text-emerald-100 transition-colors hover:bg-white/10 sm:min-h-[72px]"
                      >
                        <Clipboard className="h-5 w-5" />
                        Paste
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSearch()}
                        disabled={isSearching}
                        aria-label="Search videos"
                        className="inline-flex min-h-[64px] items-center justify-center rounded-[1.35rem] bg-emerald-500 px-5 py-3 text-base font-bold text-zinc-950 shadow-[0_18px_35px_rgba(16,185,129,0.22)] transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[72px]"
                      >
                        {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Search'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRecognize()}
                        disabled={isRecognizing || isOffline}
                        aria-label="Recognize music"
                        className="inline-flex min-h-[64px] items-center justify-center gap-2 rounded-[1.35rem] border border-emerald-600/35 bg-zinc-950/70 px-5 py-3 text-base font-bold text-emerald-200 transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[72px]"
                      >
                        {isRecognizing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
                        Recognize
                      </button>
                    </div>
                  </div>

                  {showSuggestions && suggestions.length > 0 && (
                    <ul className="mt-3 max-h-64 w-full overflow-y-auto rounded-[1.5rem] border border-emerald-800/35 bg-zinc-950/95 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
                      {suggestions.map((suggestion, index) => (
                        <li
                          key={`${suggestion}-${index}`}
                          onClick={() => {
                            setQuery(suggestion);
                            void handleSearch(suggestion);
                          }}
                          className="cursor-pointer px-5 py-3 text-sm text-emerald-100/85 transition-colors hover:bg-emerald-900/35 sm:text-base"
                        >
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

              </>
            )}
          </div>
        </header>

        {activeView === 'settings' && (
          <div className="rounded-[2rem] border border-emerald-800/40 bg-zinc-900/60 p-4 shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-6">
            <div className="flex flex-col gap-3 border-b border-emerald-800/30 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('home');
                    window.setTimeout(() => searchInputRef.current?.focus(), 60);
                  }}
                  className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-800/40 bg-zinc-950/70 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/25"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to search
                </button>
                <h2 className="text-xl font-bold text-emerald-100 sm:text-2xl">Settings</h2>
                <p className="mt-1 max-w-2xl text-sm text-emerald-500">
                  Keep downloads simple: choose a color, check saved items, and set an optional save folder.
                </p>
              </div>
              <div className="inline-flex w-fit items-center rounded-full border border-emerald-800/50 bg-zinc-950/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                {isDesktopApp ? 'Desktop app' : 'Browser mode'}
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <section className="rounded-[1.75rem] border border-emerald-800/30 bg-zinc-900/45 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur sm:p-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  <Info className="h-4 w-4" />
                  How to use
                </h3>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl border border-emerald-800/25 bg-black/20 p-4">
                    <h4 className="text-sm font-semibold text-emerald-100">FAQ</h4>
                    <div className="mt-3 grid gap-3">
                      <div>
                        <div className="text-xs font-semibold text-emerald-200">What do I paste here?</div>
                        <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                          Paste a YouTube URL or search with keywords to find the video you want.
                        </p>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-emerald-200">Can I keep it offline?</div>
                        <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                          Yes. Save a local copy or keep a browser copy for offline access later.
                        </p>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-emerald-200">Is it mobile-friendly?</div>
                        <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                          The input and action buttons resize to fit smaller screens and browser zoom.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-800/25 bg-black/20 p-4">
                    <h4 className="text-sm font-semibold text-emerald-100">How it works</h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-emerald-800/20 bg-black/15 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-500">Step 1</div>
                        <div className="mt-2 text-sm font-semibold text-emerald-100">Open Home</div>
                        <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                          Use the search bar at the top for the fastest path.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-emerald-800/20 bg-black/15 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-500">Step 2</div>
                        <div className="mt-2 text-sm font-semibold text-emerald-100">Search or paste</div>
                        <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                          Use the input and let the suggestions panel guide you.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-emerald-800/20 bg-black/15 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-500">Step 3</div>
                        <div className="mt-2 text-sm font-semibold text-emerald-100">Save or play offline</div>
                        <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                          Download, keep a browser copy, or preview immediately.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-emerald-800/30 bg-zinc-900/45 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur sm:p-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  <FolderOpen className="h-4 w-4" />
                  Saved files & app setup
                </h3>
                <div className="mt-4 rounded-3xl border border-emerald-800/30 bg-zinc-950/45 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                    <Sparkles className="h-4 w-4" />
                    Color theme
                  </div>
                  <p className="mt-2 text-xs leading-5 text-emerald-100/60">
                    Pick a stronger accent for different screens and devices.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {THEME_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setThemeChoice(option.id)}
                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors ${
                          themeChoice === option.id
                            ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100'
                            : 'border-emerald-800/30 bg-black/20 text-emerald-100/70 hover:bg-emerald-900/20'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full ${option.swatch}`} />
                          {option.label}
                        </span>
                        {themeChoice === option.id && <CheckCircle2 className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-800/30 bg-zinc-950/60 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-600">Save folder</div>
                    <div className="mt-2 text-lg font-semibold text-emerald-100">
                      {downloadSettings.folderPath ? 'Configured' : 'Local only'}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-emerald-100/60">
                      {downloadSettings.folderPath
                        ? 'Desktop downloads will use your chosen folder.'
                        : 'Browser copies stay local until you choose a folder on desktop.'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-800/30 bg-zinc-950/60 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-600">Saved files</div>
                    <div className="mt-2 text-lg font-semibold text-emerald-100">{savedDownloads.length}</div>
                    <p className="mt-2 text-xs leading-5 text-emerald-100/60">Files you saved to a local folder.</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-800/30 bg-zinc-950/60 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-600">Browser copies</div>
                    <div className="mt-2 text-lg font-semibold text-emerald-100">{offlineDownloads.length}</div>
                    <p className="mt-2 text-xs leading-5 text-emerald-100/60">Browser-stored copies for quick reopening.</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-800/30 bg-zinc-950/60 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-600">Recent videos</div>
                    <div className="mt-2 text-lg font-semibold text-emerald-100">{offlineLibrary.length}</div>
                    <p className="mt-2 text-xs leading-5 text-emerald-100/60">Recent videos available from local history.</p>
                  </div>
                </div>

                <div className="mt-5 rounded-3xl border border-emerald-800/30 bg-zinc-950/45 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                    <FolderOpen className="h-4 w-4" />
                    Save location
                  </div>
                  <p className="mt-3 break-all text-sm leading-6 text-emerald-500">
                    {downloadSettings.folderPath || 'No folder selected yet. Desktop downloads will prompt the first time.'}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-emerald-100/60">
                    Browser copies are convenient but can disappear if browser data is cleared. Desktop mode can also write to a chosen folder.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleChangeSaveLocation()}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-600/50 bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/40"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Change location
                  </button>
                </div>

                <div className="mt-5 rounded-3xl border border-emerald-800/30 bg-zinc-950/45 p-5">
                  <div className="text-sm font-semibold text-emerald-200">App actions</div>
                  <div className="mt-4 flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('home');
                        window.setTimeout(() => searchInputRef.current?.focus(), 60);
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-800/40 bg-zinc-950/80 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/25"
                    >
                      <Search className="h-4 w-4" />
                      Open search
                    </button>
                    <button
                      type="button"
                      onClick={openSavedFilesView}
                      disabled={savedDownloads.length === 0}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-700/50 bg-zinc-950/80 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Open saved files
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsFeedbackOpen(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30"
                    >
                      <MessageSquare className="h-4 w-4" />
                      Send feedback
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {activeView === 'settings' && (
          <div className="fixed inset-x-4 bottom-4 z-40 sm:hidden">
            <button
              type="button"
              onClick={() => {
                setActiveView('home');
                window.setTimeout(() => searchInputRef.current?.focus(), 60);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-700/50 bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(16,185,129,0.28)]"
            >
              <Search className="h-4 w-4" />
              Open search
            </button>
          </div>
        )}

        {activeView !== 'settings' && (
          <>
        {isOffline && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 px-5 py-4 text-left">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <WifiOff className="h-4 w-4" />
              Offline mode is active
            </div>
            <p className="mt-1 text-sm text-amber-100/80">{OFFLINE_MODE_MESSAGE}</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {downloadState && (
          <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-5" role="status" aria-live="polite" aria-atomic="true">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {downloadPhaseLabel(downloadState.phase)}
                </div>
                <div className="mt-1 text-sm text-emerald-400">{downloadState.label}</div>
              </div>
              <button
                type="button"
                onClick={handleCancelDownload}
                className="inline-flex items-center justify-center rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-900/40"
              >
                Cancel
              </button>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-900/70">
              <div
                className={`h-full rounded-full bg-emerald-500 ${
                  downloadState.totalBytes ? 'transition-[width] duration-200' : 'w-1/3 animate-pulse'
                }`}
                style={
                  downloadState.totalBytes
                    ? {
                        width: `${Math.max(
                          6,
                          Math.min(100, (downloadState.receivedBytes / downloadState.totalBytes) * 100)
                        )}%`
                      }
                    : undefined
                }
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-emerald-500">
              <span>
                {formatBytes(downloadState.receivedBytes)}
                {downloadState.totalBytes ? ` / ${formatBytes(downloadState.totalBytes)}` : ''}
              </span>
              <span>
                {downloadState.phase === 'downloading' && downloadState.estimatedRemainingMs
                  ? formatRemainingEstimate(downloadState.estimatedRemainingMs)
                  : downloadState.totalBytes
                    ? `${Math.min(100, Math.round((downloadState.receivedBytes / downloadState.totalBytes) * 100))}%`
                    : 'Working...'}
              </span>
            </div>
            {downloadState.phase === 'downloading' && downloadState.speedBytesPerSecond ? (
              <div className="mt-1 text-xs text-emerald-600">
                Speed: {formatBytes(downloadState.speedBytesPerSecond)}/s
              </div>
            ) : null}
          </div>
        )}

        {!shouldShowHomeEmptyState && (
          <>
        {!selectedVideo && (showingOfflineLibrary || showingOfflineSearchResults) && (
          <div className="rounded-2xl border border-emerald-800/30 bg-zinc-900/50 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
              <WifiOff className="h-4 w-4" />
              {showingOfflineLibrary ? 'Recent cached videos' : 'Offline search results'}
            </div>
            <p className="mt-1 text-sm text-emerald-500">
              {showingOfflineLibrary
                ? 'These videos were opened while you were online, so you can still browse them now.'
                : 'These matches came from your saved history because the app is offline.'}
            </p>
          </div>
        )}

        {!selectedVideo && (savedDownloads.length > 0 || offlineDownloads.length > 0) && (
          <div className="rounded-[1.25rem] border border-emerald-800/30 bg-zinc-900/55 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.16)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  <LayoutGrid className="h-4 w-4" />
                  Library
                </div>
                <p className="mt-1 text-sm text-emerald-100/65">
                  Search, filter, and sort your saved items.
                </p>
              </div>

              <div className="w-full max-w-lg">
                <div className="relative">
                  <Search className="absolute left-4 top-3.5 h-4 w-4 text-emerald-600" />
                  <input
                    type="text"
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder="Find in saved files and offline copies..."
                    className="w-full rounded-2xl border border-emerald-800/50 bg-zinc-950/70 px-4 py-3 pl-11 text-sm text-emerald-100 placeholder-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setLibraryFilter('all')}
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    libraryFilter === 'all'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-emerald-100/80'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryFilter('saved')}
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    libraryFilter === 'saved'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-emerald-100/80'
                  }`}
                >
                  Saved files
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryFilter('offline')}
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    libraryFilter === 'offline'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-emerald-100/80'
                  }`}
                >
                  Offline copies
                </button>
              </div>

              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setLibrarySort('newest')}
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    librarySort === 'newest'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-emerald-100/80'
                  }`}
                >
                  Newest
                </button>
                <button
                  type="button"
                  onClick={() => setLibrarySort('size')}
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    librarySort === 'size'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-emerald-100/80'
                  }`}
                >
                  Largest
                </button>
                <button
                  type="button"
                  onClick={() => setLibrarySort('title')}
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    librarySort === 'title'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-emerald-100/80'
                  }`}
                >
                  A-Z
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-emerald-100/65">
              <div>{visibleSavedDownloads.length} saved files</div>
              <div>{visibleOfflineDownloads.length} offline copies</div>
              <div>{offlineLibrary.length} cached history items</div>
            </div>
          </div>
        )}

        {shouldShowOfflineSection && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {visibleOfflineDownloads.map((download) => (
                <button
                  type="button"
                  key={`offline-${download.id}`}
                  onClick={() => handleOfflineDownloadClick(download)}
                  className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 text-left transition-all hover:-translate-y-1 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                >
                  <div className="relative aspect-video bg-zinc-950">
                    <img
                      src={download.thumbnail || fallbackThumbnail(download.id)}
                      alt={download.title}
                      className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                      onError={(e) => {
                        e.currentTarget.src = fallbackThumbnail(download.id);
                      }}
                    />
                    <div className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-1 font-mono text-xs text-emerald-400">
                      {formatDuration(download.duration)}
                    </div>
                    <OfflineCopyBadge className="absolute left-2 top-2" />
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="mb-1 line-clamp-2 font-semibold text-emerald-100 transition-colors group-hover:text-emerald-300">
                      {download.title}
                    </h3>
                    <p className="mb-2 flex-1 text-sm text-emerald-600/80">{download.channel}</p>
                    <div className="mt-auto text-xs font-medium text-emerald-500/70">
                      {formatBytes(download.sizeBytes)} saved in browser â€¢ {formatRelativeTime(download.savedAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {visibleOfflineDownloads.length === 0 && (
              <div className="rounded-2xl border border-dashed border-emerald-800/40 bg-zinc-950/30 px-4 py-6 text-sm text-emerald-400">
                No offline downloads matched "{libraryQuery}".
              </div>
            )}
          </div>
        )}

        {shouldShowSavedSection && (
          <div ref={savedFilesSectionRef} className="space-y-6">
            <div className="rounded-2xl border border-emerald-800/30 bg-zinc-900/50 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                <FolderOpen className="h-4 w-4" />
                Saved in app
              </div>
              <p className="mt-1 text-sm text-emerald-500">
                These files are stored in your chosen folder and stay available even when the app is offline.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {visibleSavedDownloads.map((download) => (
                <button
                  type="button"
                  key={`saved-${download.id}`}
                  onClick={() => handleSavedDownloadClick(download)}
                  className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 text-left transition-all hover:-translate-y-1 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                >
                  <div className="relative aspect-video bg-zinc-950">
                    <img
                      src={download.thumbnail || fallbackThumbnail(download.sourceId || download.id)}
                      alt={download.title}
                      className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                      onError={(e) => {
                        e.currentTarget.src = fallbackThumbnail(download.sourceId || download.id);
                      }}
                    />
                    <div className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-1 font-mono text-xs text-emerald-400">
                      {formatDuration(download.duration)}
                    </div>
                    <div className="absolute left-2 top-2 rounded-full border border-emerald-500/40 bg-emerald-950/70 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                      In App
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="mb-1 line-clamp-2 font-semibold text-emerald-100 transition-colors group-hover:text-emerald-300">
                      {download.title}
                    </h3>
                    <p className="mb-2 flex-1 text-sm text-emerald-600/80">{download.channel}</p>
                    <div className="mt-auto text-xs font-medium text-emerald-500/70">
                      {formatBytes(download.sizeBytes)} â€¢ {download.fileName} â€¢ {formatRelativeTime(download.savedAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {visibleSavedDownloads.length === 0 && (
              <div className="rounded-2xl border border-dashed border-emerald-800/40 bg-zinc-950/30 px-4 py-6 text-sm text-emerald-400">
                No saved files matched "{libraryQuery}".
              </div>
            )}
          </div>
        )}

        {selectedSavedDownload && (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-emerald-800/30 bg-zinc-900/50 md:flex-row">
              <div className="flex-1 border-b border-emerald-800/30 p-6 md:border-b-0 md:border-r">
              <div className="mb-4 flex items-center gap-2 font-semibold text-emerald-300">
                <FolderOpen className="h-4 w-4" />
                Saved File
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-800/30 bg-zinc-950/40 p-4">
                  <h3 className="text-lg font-semibold text-emerald-100">{selectedSavedDownload.title}</h3>
                  <p className="mt-1 text-sm text-emerald-500">{selectedSavedDownload.channel}</p>
                  <p className="mt-2 text-xs text-emerald-700 break-all">{selectedSavedDownload.filePath}</p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void window.electronAPI?.revealPath(selectedSavedDownload.filePath)}
                    className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Show in folder
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleChangeSaveLocation()}
                    className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30"
                  >
                    <Settings className="h-4 w-4" />
                    Change location
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDeleteSavedDownload()}
                    className="flex items-center justify-center gap-2 rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-200 transition-colors hover:bg-red-900/40"
                  >
                    Delete file
                  </button>
                </div>
              </div>
            </div>

            <div className="w-full bg-zinc-950/50 p-6 text-center md:w-80">
              {savedPlaybackUrl ? (
                <div ref={savedPreviewPanelRef} className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
                  <div className="relative">
                    <video
                      ref={savedPreviewVideoRef}
                      src={savedPlaybackUrl}
                      poster={selectedSavedDownload.thumbnail || fallbackThumbnail(selectedSavedDownload.sourceId || selectedSavedDownload.id)}
                      className="aspect-video w-full bg-black object-contain"
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={handleSavedPreviewMetadata}
                      onTimeUpdate={handleSavedPreviewTimeUpdate}
                      onPlay={() => setIsSavedPreviewLoading(true)}
                      onWaiting={() => setIsSavedPreviewLoading(true)}
                      onPlaying={handleSavedPreviewPlaying}
                      onPause={handleSavedPreviewPause}
                      onEnded={() => {
                        setIsSavedPreviewPlaying(false);
                        setIsSavedPreviewLoading(false);
                      }}
                      onError={() => {
                        setIsSavedPreviewPlaying(false);
                        setIsSavedPreviewLoading(false);
                      }}
                    />
                    {isSavedPreviewLoading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-emerald-200">
                        <Loader2 className="h-7 w-7 animate-spin" />
                        <span className="text-sm font-medium">Loading file...</span>
                      </div>
                    )}
                    <OfflineCopyBadge className="absolute left-3 top-3" />
                  </div>
                  <div className="border-t border-zinc-800/70 bg-zinc-950 px-4 py-4">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(savedPreviewDuration || selectedSavedDownload.duration || 0, 0)}
                      step={1}
                      value={Math.min(savedPreviewCurrentTime, savedPreviewDuration || selectedSavedDownload.duration || 0)}
                      onChange={handleSavedPreviewScrub}
                      className="mb-3 h-1.5 w-full cursor-pointer accent-emerald-500"
                    />
                    <div className="mb-3 flex items-center justify-between text-[11px] font-mono text-emerald-400">
                      <span>{formatDuration(Math.floor(savedPreviewCurrentTime || 0))}</span>
                      <span>
                        {formatRemainingDuration(
                          savedPreviewCurrentTime,
                          savedPreviewDuration || selectedSavedDownload.duration || 0
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg bg-zinc-900/75 px-3 py-3">
                      <button
                        type="button"
                        onClick={handlePreviousSavedDownload}
                        disabled={!previousSavedDownload}
                        className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="Previous saved preview"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleSavedPreviewPlayback()}
                        disabled={isSavedPreviewLoading}
                        className="inline-flex min-h-[40px] min-w-[86px] items-center justify-center rounded-lg bg-emerald-500 px-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-80"
                        aria-label={isSavedPreviewPlaying ? 'Pause saved preview' : 'Play saved preview'}
                      >
                        {isSavedPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isSavedPreviewPlaying ? 'Pause' : 'Play'}
                      </button>
                      <button
                        type="button"
                        onClick={handleNextSavedDownload}
                        disabled={!nextSavedDownload}
                        className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="Next saved preview"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
                  <img
                    src={selectedSavedDownload.thumbnail || fallbackThumbnail(selectedSavedDownload.sourceId || selectedSavedDownload.id)}
                    alt={selectedSavedDownload.title}
                    className="h-auto w-full object-contain"
                    onError={(e) => {
                      e.currentTarget.src = fallbackThumbnail(selectedSavedDownload.sourceId || selectedSavedDownload.id);
                    }}
                  />
                </div>
              )}

              <div className="mb-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviousSavedDownload}
                  disabled={!previousSavedDownload}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={handleNextSavedDownload}
                  disabled={!nextSavedDownload}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <h2 className="mb-2 font-bold text-emerald-100">{selectedSavedDownload.title}</h2>
              <p className="mb-1 text-sm font-medium text-emerald-500">{selectedSavedDownload.channel}</p>
              <p className="font-mono text-xs text-emerald-700">
                Size: {formatBytes(selectedSavedDownload.sizeBytes)}
              </p>
            </div>
          </div>
        )}

        {selectedVideo ? (
          <div className="space-y-8">
            <button
              onClick={() => setSelectedVideo(null)}
              className="flex items-center gap-2 font-medium text-emerald-400 transition-colors hover:text-emerald-300"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to results
            </button>

            <div className="flex flex-col overflow-hidden rounded-2xl border border-emerald-800/30 bg-zinc-900/50 md:flex-row">
              <div className="flex-1 border-b border-emerald-800/30 p-6 md:border-b-0 md:border-r">
                <div className="mb-4 flex items-center gap-2 font-semibold text-emerald-300">
                  <Music className="h-4 w-4" />
                  Available Formats
                </div>

                <div className="space-y-4">
                  {isLoadingDetails ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-300">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading available formats...
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {isOffline && (
                        <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/80">
                          Saved format info stays visible offline, but preview playback, downloads, and YouTube open are
                          paused until the connection comes back.
                        </div>
                      )}
                      {detailsWarning && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/85">
                          {detailsWarning}
                        </div>
                      )}

                      {!detailsWarning && (
                      <div className="rounded-2xl border border-emerald-700/25 bg-emerald-950/20 p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                              <Sparkles className="h-4 w-4" />
                              Download planner
                            </h2>
                            <p className="mt-1 max-w-2xl text-sm leading-6 text-emerald-100/65">
                              Quick picks for the best local save and offline copy.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs font-semibold">
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-emerald-100/80">
                              {hasSavedOfflineCopy ? 'Offline copy ready' : 'No offline copy yet'}
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-emerald-100/80">
                              {savedDownloads.some((item) => item.sourceId === selectedVideo.id)
                                ? 'Saved in app'
                                : 'Not in saved library'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                              <Video className="h-4 w-4" />
                              Best video
                            </h3>
                            <div className="mt-2 text-lg font-semibold text-white">
                              {recommendedPortableFormat?.qualityLabel || 'Waiting for formats'}
                            </div>
                            <div className="mt-1 text-sm text-emerald-100/60">
                              {recommendedPortableFormat?.contentLength || 'Size unknown'}
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                              <Headphones className="h-4 w-4" />
                              Best audio
                            </h3>
                            <div className="mt-2 text-lg font-semibold text-white">
                              {recommendedAudioFormat ? getFormatLabel(recommendedAudioFormat) : 'Waiting for formats'}
                            </div>
                            <div className="mt-1 text-sm text-emerald-100/60">
                              {recommendedAudioFormat?.contentLength || 'Size unknown'}
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                              <HardDriveDownload className="h-4 w-4" />
                              Storage estimate
                            </h3>
                            <div className="mt-2 text-lg font-semibold text-white">
                              {plannerStorageEstimate ? formatBytes(plannerStorageEstimate) : 'Unknown'}
                            </div>
                            <div className="mt-1 text-sm text-emerald-100/60">
                              Enough for preview, offline save, or quick local download
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => void handleDownload(videoDetails?.url || selectedVideo.url)}
                            disabled={Boolean(downloadState) || isOffline}
                            aria-label="Save the best portable version"
                            className="flex min-h-[48px] items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-400/10 px-4 py-3 text-left transition-colors hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div>
                              <div className="text-sm font-semibold text-white">Save best portable version</div>
                              <div className="mt-1 text-xs text-emerald-100/65">
                                Recommended for local playback and sharing
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-emerald-200">Download</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleSaveOfflineDownload()}
                            disabled={Boolean(downloadState) || isOffline || hasSavedOfflineCopy}
                            aria-label="Keep an offline app copy"
                            className="flex min-h-[48px] items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div>
                              <div className="text-sm font-semibold text-white">Keep an offline app copy</div>
                              <div className="mt-1 text-xs text-emerald-100/65">
                                Best when you want playback even without internet
                              </div>
                            </div>
                            <WifiOff className="h-5 w-5 text-emerald-200" />
                          </button>
                        </div>
                      </div>
                      )}

                      {!detailsWarning && (
                      <div className="overflow-hidden rounded-xl border border-emerald-800/30 bg-zinc-950/40">
                        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(4.5rem,0.55fr)_minmax(7.25rem,0.8fr)] border-b border-emerald-800/30 bg-zinc-950/80 px-3 py-3 text-sm font-bold text-emerald-100">
                          <div className="col-span-3 flex items-center gap-2">
                            <Music className="h-4 w-4" />
                            Audio
                          </div>
                        </div>
                        <div className="divide-y divide-emerald-900/35">
                          {(videoDetails?.audioFormats || []).map((format) => (
                            <div
                              key={`audio-${format.itag}-${format.url}`}
                              className="grid min-h-[68px] grid-cols-[minmax(0,1.1fr)_minmax(4.5rem,0.55fr)_minmax(7.25rem,0.8fr)] items-center gap-3 bg-zinc-900/45 px-3 py-2 text-center transition-colors hover:bg-zinc-900/80"
                            >
                              <div className="text-left">
                                <div className="text-sm font-semibold text-emerald-100 sm:text-base">
                                  {getFormatLabel(format)}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {getFormatCodecBadges(format).map((badge) => (
                                    <span
                                      key={`${format.itag}-${badge}`}
                                      className="rounded bg-emerald-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-zinc-950"
                                    >
                                      {badge}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="text-sm font-medium text-emerald-100/80 sm:text-base">
                                {format.contentLength || 'Unknown'}
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleFormatDownload(format)}
                                disabled={Boolean(downloadState) || isOffline}
                                aria-label={`Download audio format ${getFormatLabel(format)}`}
                                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
                              >
                                {isOffline ? (
                                  'Offline'
                                ) : downloadState?.key === `audio-${format.itag}` ? (
                                  downloadState.phase === 'saving' ? 'Saving' : 'Downloading'
                                ) : (
                                  <>
                                    <Download className="h-4 w-4" />
                                    Download
                                  </>
                                )}
                              </button>
                            </div>
                          ))}
                          {!videoDetails?.audioFormats?.length && (
                            <div className="px-3 py-4 text-sm text-emerald-500">No audio-only formats found.</div>
                          )}
                        </div>

                        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(4.5rem,0.55fr)_minmax(7.25rem,0.8fr)] border-y border-emerald-800/30 bg-zinc-950/80 px-3 py-3 text-sm font-bold text-emerald-100">
                          <div className="col-span-3 flex items-center gap-2">
                            <Video className="h-4 w-4" />
                            Video
                          </div>
                        </div>
                        <div className="divide-y divide-emerald-900/35">
                          {(videoDetails?.videoFormats || []).map((format) => (
                            <div
                              key={`video-${format.itag}-${format.url}`}
                              className="grid min-h-[68px] grid-cols-[minmax(0,1.1fr)_minmax(4.5rem,0.55fr)_minmax(7.25rem,0.8fr)] items-center gap-3 bg-zinc-900/45 px-3 py-2 text-center transition-colors hover:bg-zinc-900/80"
                            >
                              <div className="text-left">
                                <div className="text-sm font-semibold text-emerald-100 sm:text-base">
                                  {getFormatLabel(format)}
                                  {format.hasAudio ? <span className="ml-1 text-emerald-300">♪</span> : null}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {getFormatCodecBadges(format).map((badge) => (
                                    <span
                                      key={`${format.itag}-${badge}`}
                                      className={`rounded px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ${
                                        badge === 'av01' ? 'bg-orange-500' : 'bg-emerald-500'
                                      }`}
                                    >
                                      {badge}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="text-sm font-medium text-emerald-100/80 sm:text-base">
                                {format.contentLength || 'Unknown'}
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleFormatDownload(format)}
                                disabled={Boolean(downloadState) || isOffline}
                                aria-label={`Download video format ${getFormatLabel(format)}`}
                                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
                              >
                                {isOffline ? (
                                  'Offline'
                                ) : downloadState?.key === `video-${format.itag}` ? (
                                  downloadState.phase === 'saving' ? 'Saving' : 'Downloading'
                                ) : (
                                  <>
                                    <Download className="h-4 w-4" />
                                    Download
                                  </>
                                )}
                              </button>
                            </div>
                          ))}
                          {!videoDetails?.videoFormats?.length && (
                            <div className="px-3 py-4 text-sm text-emerald-500">No video formats found.</div>
                          )}
                        </div>
                      </div>
                      )}

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => void handleDownload(videoDetails?.url || selectedVideo.url)}
                          disabled={Boolean(downloadState) || isOffline || Boolean(detailsWarning)}
                          className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isOffline
                            ? 'Offline'
                            : downloadState?.key === 'quick-download'
                              ? downloadState.phase === 'saving'
                                ? 'Saving...'
                                : 'Downloading...'
                              : 'Download Now'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleSaveOfflineDownload()}
                          disabled={Boolean(downloadState) || isOffline || hasSavedOfflineCopy || Boolean(detailsWarning)}
                          className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {downloadState?.key === 'offline-download' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <WifiOff className="h-4 w-4" />
                          )}
                          {hasSavedOfflineCopy
                            ? 'Saved Offline'
                            : downloadState?.key === 'offline-download'
                              ? downloadState.phase === 'saving'
                                ? 'Finishing Save...'
                                : 'Saving Offline...'
                              : isOffline
                                ? 'Needs internet'
                                : 'Save Offline'}
                        </button>

                        <button
                          type="button"
                          onClick={() => previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                          disabled={isOffline}
                          className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Play className="h-4 w-4" />
                          {isOffline ? 'Offline only' : 'Play in app'}
                        </button>
                      </div>

                      {hasSavedOfflineCopy && (
                        <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
                          Saved in browser for offline access: {formatBytes(selectedOfflineDownload?.sizeBytes || 0)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="w-full bg-zinc-950/50 p-6 text-center md:w-80">
                {previewSourceUrl ? (
                  <div ref={previewPanelRef} className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
                    <div className="relative">
                      <video
                        ref={previewVideoRef}
                        src={previewSourceUrl}
                        poster={videoDetails?.thumbnail || selectedVideo.thumbnail || fallbackThumbnail(selectedVideo.id)}
                        className="aspect-video w-full bg-black object-contain"
                        playsInline
                        preload="none"
                        onLoadedMetadata={handlePreviewMetadata}
                        onTimeUpdate={handlePreviewTimeUpdate}
                        onPlay={() => setIsPreviewLoading(true)}
                        onWaiting={() => setIsPreviewLoading(true)}
                        onPlaying={handlePreviewPlaying}
                        onPause={handlePreviewPause}
                        onEnded={() => {
                          setIsPreviewPlaying(false);
                          setIsPreviewLoading(false);
                        }}
                        onError={() => {
                          setIsPreviewPlaying(false);
                          setIsPreviewLoading(false);
                        }}
                      />
                      {isPreviewLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-emerald-200">
                          <Loader2 className="h-7 w-7 animate-spin" />
                          <span className="text-sm font-medium">Loading preview...</span>
                        </div>
                      )}
                      {offlinePlaybackUrl && (
                        <OfflineCopyBadge className="absolute left-3 top-3" />
                      )}
                      <button
                        type="button"
                        onClick={() => void toggleFullscreen(previewPanelRef.current)}
                        className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/85"
                        aria-label="Fullscreen preview"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="border-t border-zinc-800/70 bg-zinc-950 px-4 py-4">
                      <input
                        type="range"
                        min={0}
                        max={Math.max(previewDuration || videoDetails?.duration || selectedVideo.duration || 0, 0)}
                        step={1}
                        value={Math.min(previewCurrentTime, previewDuration || videoDetails?.duration || selectedVideo.duration || 0)}
                        onChange={handlePreviewScrub}
                        className="mb-3 h-1.5 w-full cursor-pointer accent-emerald-500"
                      />
                      <div className="mb-3 flex items-center justify-between text-[11px] font-mono text-emerald-400">
                        <span>{formatDuration(Math.floor(previewCurrentTime || 0))}</span>
                        <span>
                          {formatRemainingDuration(
                            previewCurrentTime,
                            previewDuration || videoDetails?.duration || selectedVideo.duration || 0
                          )}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg bg-zinc-900/75 px-3 py-3">
                        <button
                          type="button"
                          onClick={handlePreviousVideo}
                          disabled={!previousVideo}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label="Previous preview"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          onClick={() => jumpPreviewBy(-10)}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800"
                          aria-label="Back 10 seconds"
                        >
                          -10s
                        </button>
                        <button
                          type="button"
                          onClick={() => void togglePreviewPlayback()}
                          disabled={isPreviewLoading}
                          className="inline-flex min-h-[40px] min-w-[86px] items-center justify-center rounded-lg bg-emerald-500 px-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-80"
                          aria-label={isPreviewPlaying ? 'Pause preview' : 'Play preview'}
                        >
                          {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isPreviewPlaying ? 'Pause' : 'Play'}
                        </button>
                        <button
                          type="button"
                          onClick={() => jumpPreviewBy(10)}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800"
                          aria-label="Forward 10 seconds"
                        >
                          +10s
                        </button>
                        <button
                          type="button"
                          onClick={handleNextVideo}
                          disabled={!nextVideo}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label="Next preview"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {!isOffline ? (
                      <div ref={previewPanelRef} className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
                        <div className="relative">
                          <iframe
                            ref={embedFrameRef}
                            title={`Play ${videoDetails?.title || selectedVideo.title}`}
                            src={youtubeEmbedUrl(selectedVideo.id)}
                            className="aspect-video w-full bg-black"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            onLoad={handleEmbedReady}
                          />
                          <button
                            type="button"
                            onClick={() => void toggleFullscreen(previewPanelRef.current)}
                            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/85"
                            aria-label="Fullscreen player"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="border-t border-zinc-800/70 bg-zinc-950 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg bg-zinc-900/75 px-3 py-3">
                            <button
                              type="button"
                              onClick={handlePreviousVideo}
                              disabled={!previousVideo}
                              className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                              aria-label="Previous video"
                            >
                              Prev
                            </button>
                            <button
                              type="button"
                              onClick={() => jumpEmbedBy(-10)}
                              className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800"
                              aria-label="Back 10 seconds"
                            >
                              -10s
                            </button>
                            <button
                              type="button"
                              onClick={toggleEmbedPlayback}
                              className="inline-flex min-h-[40px] min-w-[86px] items-center justify-center rounded-lg bg-emerald-500 px-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-emerald-400"
                              aria-label={isEmbedPlaying ? 'Pause video' : 'Play video'}
                            >
                              {isEmbedPlaying ? 'Pause' : 'Play'}
                            </button>
                            <button
                              type="button"
                              onClick={() => jumpEmbedBy(10)}
                              className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800"
                              aria-label="Forward 10 seconds"
                            >
                              +10s
                            </button>
                            <button
                              type="button"
                              onClick={handleNextVideo}
                              disabled={!nextVideo}
                              className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                              aria-label="Next video"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
                        <img
                          src={selectedThumbnail}
                          alt={videoDetails?.title || selectedVideo.title}
                          className="h-auto w-full object-contain"
                          onError={(e) => {
                            e.currentTarget.src = fallbackThumbnail(selectedVideo.id);
                          }}
                        />
                        <div className="border-t border-zinc-800/70 bg-zinc-950 px-4 py-3 text-sm text-emerald-500">
                          Preview is unavailable offline.
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="mb-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handlePreviousVideo}
                    disabled={!previousVideo}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={handleNextVideo}
                    disabled={!nextVideo}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <h2 className="mb-2 font-bold text-emerald-100">{videoDetails?.title || selectedVideo.title}</h2>
                <p className="mb-1 text-sm font-medium text-emerald-500">{videoDetails?.channel || selectedVideo.channel}</p>
                <p className="font-mono text-xs text-emerald-700">
                  Duration: {formatDuration(videoDetails?.duration || selectedVideo.duration)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
            {visibleResults.map((result) => (
              <button
                type="button"
                key={result.id}
                onClick={() => handleVideoClick(result)}
                className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 text-left transition-all hover:-translate-y-1 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)]"
              >
                <div className="relative aspect-video bg-zinc-950">
                  <img
                    src={result.thumbnail || fallbackThumbnail(result.id)}
                    alt={result.title}
                    className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                    onError={(e) => {
                      e.currentTarget.src = fallbackThumbnail(result.id);
                    }}
                  />
                  <div className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-1 font-mono text-xs text-emerald-400">
                    {formatDuration(result.duration)}
                  </div>
                  {shouldMarkVisibleResultsAsOfflineCopy && <OfflineCopyBadge className="absolute left-2 top-2" />}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <h3 className="mb-1 line-clamp-2 font-semibold text-emerald-100 transition-colors group-hover:text-emerald-300">
                    {result.title}
                  </h3>
                  <p className="mb-2 flex-1 text-sm text-emerald-600/80">{result.channel}</p>
                  <div className="mt-auto text-xs font-medium text-emerald-500/50">Click to preview options</div>
                </div>
              </button>
            ))}
          </div>
        )}
        {!selectedVideo && activeSearchQuery && resultSource === 'live' && visibleResults.length > 0 && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => void handleLoadMoreResults()}
              disabled={isOffline || isSearching || isLoadingMoreResults || !hasMoreResults || searchPage >= MAX_SEARCH_PAGE}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-emerald-700/50 bg-zinc-900 px-5 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingMoreResults ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more...
                </>
              ) : hasMoreResults && searchPage < MAX_SEARCH_PAGE ? (
                'Load more'
              ) : (
                'No more videos'
              )}
            </button>
          </div>
        )}
          </>
        )}

        {shouldShowHomeEmptyState && (
          <section className="mt-20 flex min-h-[calc(100vh-22rem)] flex-1 items-center justify-center sm:mt-28 lg:mt-36">
            <div className="flex max-w-3xl flex-col items-center gap-6 rounded-[2rem] border border-emerald-800/25 bg-zinc-950/35 p-6 text-center shadow-[0_18px_60px_rgba(0,0,0,0.22)] sm:p-8">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-2xl" />
                <Search className="relative h-20 w-20 text-emerald-500/10 sm:h-24 sm:w-24" strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-2xl font-black text-emerald-50 sm:text-3xl">
                  {isOffline ? 'Offline mode is ready' : 'Search first, download second'}
                </h2>
                <p className="mt-3 text-base leading-7 text-emerald-100/60 sm:text-lg">
                  {isOffline
                    ? 'Reconnect to search online, or use recent videos and saved browser copies.'
                    : 'Paste a YouTube URL or type a title in the search box above. Results, previews, and download choices appear here.'}
                </p>
              </div>
              <div className="grid w-full gap-3 text-left sm:grid-cols-3">
                <div className="rounded-2xl border border-emerald-800/25 bg-black/20 p-4">
                  <div className="text-sm font-bold text-emerald-100">1. Search</div>
                  <p className="mt-1 text-xs leading-5 text-emerald-100/55">Use the focused input above as the starting point.</p>
                </div>
                <div className="rounded-2xl border border-emerald-800/25 bg-black/20 p-4">
                  <div className="text-sm font-bold text-emerald-100">2. Preview</div>
                  <p className="mt-1 text-xs leading-5 text-emerald-100/55">Play the result in the app before choosing a file.</p>
                </div>
                <div className="rounded-2xl border border-emerald-800/25 bg-black/20 p-4">
                  <div className="text-sm font-bold text-emerald-100">3. Download</div>
                  <p className="mt-1 text-xs leading-5 text-emerald-100/55">Pick MP3 or MP4 from the available options.</p>
                </div>
              </div>
            </div>
          </section>
        )}

        <div
          className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 sm:right-6 sm:top-6"
          aria-live="polite"
          aria-atomic="true"
        >
          {toasts.map((toast) => {
            const toneStyles =
              toast.tone === 'success'
                ? 'border-emerald-500/35 bg-emerald-950/90 text-emerald-100'
                : toast.tone === 'error'
                  ? 'border-red-500/35 bg-red-950/90 text-red-100'
                  : 'border-sky-500/35 bg-sky-950/90 text-sky-100';
            const toneIcon =
              toast.tone === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              ) : toast.tone === 'error' ? (
                <AlertTriangle className="h-4 w-4 text-red-300" />
              ) : (
                <Info className="h-4 w-4 text-sky-300" />
              );

            return (
              <div
                key={toast.id}
                className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-[0_20px_45px_rgba(0,0,0,0.35)] backdrop-blur ${toneStyles}`}
              >
                <div className="flex items-start gap-3">
                  {toneIcon}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{toast.title}</div>
                    {toast.description ? <div className="mt-1 text-xs leading-5 opacity-80">{toast.description}</div> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-white/75 transition-colors hover:bg-white/10"
                    aria-label={`Dismiss ${toast.title}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>

          </>
        )}

        <footer className="space-y-6 border-t border-emerald-900/30 pt-10 pb-6">
          <div className="flex flex-col gap-4 rounded-[1.5rem] border border-emerald-800/25 bg-zinc-900/45 p-4 text-sm text-emerald-100/70 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-emerald-100">Need help or want to read the fine print?</div>
              <p className="mt-1 max-w-2xl leading-6">
                FK Downloader is built for personal use. Respect content rights, keep your downloads local, and
                verify that you have permission to save media where needed.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <a
                href="#privacy"
                className="rounded-full border border-emerald-700/35 bg-black/20 px-3 py-1.5 text-emerald-200 transition-colors hover:bg-black/35"
              >
                Privacy Policy
              </a>
              <a
                href="#terms"
                className="rounded-full border border-emerald-700/35 bg-black/20 px-3 py-1.5 text-emerald-200 transition-colors hover:bg-black/35"
              >
                Terms of Service
              </a>
              <a
                href="https://github.com/AlphaJet185/FK-Downloader/issues"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-emerald-700/35 bg-black/20 px-3 py-1.5 text-emerald-200 transition-colors hover:bg-black/35"
              >
                Contact / Support
              </a>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section id="privacy" className="rounded-[1.5rem] border border-emerald-800/25 bg-black/20 p-5">
              <div className="text-sm font-semibold text-emerald-100">Privacy Policy</div>
              <p className="mt-2 text-sm leading-6 text-emerald-100/65">
                Search terms, saved downloads, and offline metadata may be stored locally in your browser or app to
                make the downloader faster and keep your library available.
              </p>
            </section>

            <section id="terms" className="rounded-[1.5rem] border border-emerald-800/25 bg-black/20 p-5">
              <div className="text-sm font-semibold text-emerald-100">Terms of Service</div>
              <p className="mt-2 text-sm leading-6 text-emerald-100/65">
                Use the tool responsibly and only for content you have rights or permission to save. Availability of
                formats depends on the source video and connection quality.
              </p>
            </section>
          </div>

          <button
            onClick={() => setIsFeedbackOpen(true)}
            className="group fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-indigo-500 p-3 text-white shadow-lg transition-all hover:-translate-y-1 hover:bg-indigo-600 hover:shadow-indigo-500/25"
            aria-label="Send Feedback"
          >
            <MessageSquare className="h-6 w-6" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap font-medium transition-all duration-300 ease-in-out group-hover:max-w-xs">
              Feedback
            </span>
          </button>
        </footer>
      </main>

      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </div>
  );
}


