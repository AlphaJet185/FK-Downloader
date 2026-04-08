import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FolderOpen,
  Loader2,
  MessageSquare,
  Mic,
  Music,
  Pause,
  Play,
  Radio,
  Search,
  Settings,
  UploadCloud,
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

type ResultSource = 'live' | 'offline-search';

const OFFLINE_MODE_MESSAGE =
  'Recent searches and opened videos stay available. Recognition, preview, downloads, and YouTube links come back when you reconnect.';

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
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

export default function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState('');
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

  const suggestTimeoutRef = useRef<number | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const savedPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [isSavedPreviewPlaying, setIsSavedPreviewPlaying] = useState(false);
  const [isSavedPreviewLoading, setIsSavedPreviewLoading] = useState(false);
  const [savedPreviewCurrentTime, setSavedPreviewCurrentTime] = useState(0);
  const [savedPreviewDuration, setSavedPreviewDuration] = useState(0);

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
    if (!isOffline && status === 'Offline') {
      setStatus('Idle');
    }
  }, [isOffline, status]);

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
  }, [selectedVideo?.id, videoDetails?.previewUrl]);

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

  const handleSearch = async (searchQuery: string = query) => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;

    setIsSearching(true);
    setShowSuggestions(false);
    setSelectedVideo(null);
    setVideoDetails(null);
    setRecognition(null);
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
        setStatus('Offline');
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
        saveOfflineSearchResults(trimmedQuery, [directVideo]);
        await loadVideoDetails(directVideo);
        setStatus('Idle');
        return;
      }

      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`);
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
      saveOfflineSearchResults(trimmedQuery, normalized);
      setStatus('Idle');
    } catch (err: any) {
      setResults([]);
      setStatus('Idle');
      setError(err?.message || 'Failed to search YouTube.');
    } finally {
      setIsSearching(false);
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
      setVideoDetails(null);
      setError(err?.message || 'Failed to load video details.');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleVideoClick = (video: SearchResult) => {
    void loadVideoDetails(video);
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

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;

      const recordedBlob = await new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onerror = () => reject(new Error('Recording failed'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));

        recorder.start();
        window.setTimeout(() => {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }, 8000);
      });

      stream.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;

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
      await handleSearch(recognizedQuery);
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

  const openVideo = (url: string) => {
    if (isOffline) {
      setError('Opening YouTube is unavailable offline.');
      return;
    }

    if (window.electronAPI?.isDesktop) {
      void window.electronAPI.openExternal(url);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
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
      window.setTimeout(() => setStatus('Idle'), 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to change save location.');
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
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.message === DOWNLOAD_CANCELLED_MESSAGE) {
        setStatus('Idle');
        return;
      }

      setError(err?.message || 'Download failed.');
      setStatus('Idle');
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
      return;
    }

    const fastVideoFormat = videoDetails?.videoFormats?.find((format) => format.hasAudio);
    const sourceUrl = videoDetails?.url || url;
    const thumbnail = videoDetails?.thumbnail || selectedVideo?.thumbnail || fallbackThumbnail(selectedVideo?.id || '');

    await runDownload(
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
  };

  const handleFormatDownload = async (format: FormatOption) => {
    if (isOffline) {
      setError('Downloads need an internet connection.');
      return;
    }

    const extension = format.mimeType ? format.mimeType.split('/')[1] : 'file';
    const typeLabel = format.hasVideo ? 'Video' : 'Audio';
    const sourceUrl = videoDetails?.url || selectedVideo?.url || format.url;
    const thumbnail = videoDetails?.thumbnail || selectedVideo?.thumbnail || fallbackThumbnail(selectedVideo?.id || '');
    await runDownload(
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
  };

  const handleSaveOfflineDownload = async () => {
    if (!selectedVideo?.id) {
      return;
    }

    if (isOffline) {
      setError('Saving offline copies needs an internet connection.');
      return;
    }

    if (selectedOfflineDownload) {
      setError('This video is already saved for offline access.');
      return;
    }

    const sourceUrl = videoDetails?.url || selectedVideo.url;
    const preferredFormat = videoDetails?.videoFormats?.find((format) => format.hasAudio);
    const thumbnail = videoDetails?.thumbnail || selectedVideo.thumbnail || fallbackThumbnail(selectedVideo.id);

    await runDownload('offline-download', 'Saving for offline access', async (onProgress) => {
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

    setStatus('Saved offline');
    window.setTimeout(() => setStatus('Idle'), 1500);
  };

  const handleLinkDownload = async (input: string = query) => {
    if (isOffline) {
      setError('Downloads need an internet connection.');
      return;
    }

    const videoId = extractYouTubeVideoId(input.trim());
    if (!videoId) {
      setError('Paste a valid YouTube video link first.');
      return;
    }

    const directUrl = `https://www.youtube.com/watch?v=${videoId}`;
    setShowSuggestions(false);

    await runDownload('link-download', 'Download from pasted link', async (onProgress, signal) => {
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
      window.setTimeout(() => setStatus('Idle'), 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete file.');
    }
  };

  const showingOfflineLibrary = isOffline && !selectedVideo && results.length === 0 && offlineLibrary.length > 0;
  const visibleResults = showingOfflineLibrary ? offlineLibrary : results;
  const showingOfflineSearchResults =
    isOffline && !selectedVideo && resultSource === 'offline-search' && results.length > 0;
  const directInputVideoId = extractYouTubeVideoId(query.trim());
  const canDownloadPastedLink = Boolean(directInputVideoId);
  const showOfflineDownloadsShelf = !selectedVideo && offlineDownloads.length > 0 && (isOffline || visibleResults.length === 0);
  const hasSavedOfflineCopy = Boolean(selectedOfflineDownload);
  const previewSourceUrl = offlinePlaybackUrl || (!isOffline ? videoDetails?.previewUrl || '' : '');
  const selectedThumbnail =
    (selectedVideo && (videoDetails?.thumbnail || selectedVideo.thumbnail || fallbackThumbnail(selectedVideo.id))) ||
    '';

  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-emerald-950 via-zinc-950 to-emerald-900 text-emerald-50 p-6 transition-colors ${
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

      <div className="relative z-10 mx-auto max-w-4xl space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="flex items-center justify-center gap-3 pt-2 text-3xl font-bold text-emerald-400 sm:pt-0 sm:text-4xl">
            <Download className="h-8 w-8 sm:h-10 sm:w-10" />
            FK Downloader
          </h1>
          <p className="text-sm text-emerald-200/60 sm:text-base">
            Search, preview, and open videos without extractor failures.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs font-medium sm:gap-4 sm:text-sm">
            <div
              className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
                isOffline
                  ? 'border-red-500/50 bg-red-900/30 text-red-400'
                  : 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400'
              }`}
            >
              {isOffline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
              {isOffline ? 'Offline Mode' : 'Online Mode'}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-emerald-800/50 bg-zinc-900/50 px-3 py-1 text-emerald-300">
              <Radio className="h-4 w-4" />
              Status: {status}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-emerald-800/30 bg-zinc-900/50 p-4 text-left shadow-lg shadow-black/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  <FolderOpen className="h-4 w-4" />
                  Save location
                </div>
                <p className="mt-1 max-w-2xl break-all text-sm text-emerald-500">
                  {downloadSettings.folderPath || 'You will be asked where to save the first time you download.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleChangeSaveLocation()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-600/50 bg-zinc-950 px-4 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/40"
              >
                <Settings className="h-4 w-4" />
                Change location
              </button>
            </div>
          </div>
        </div>

        <div className="relative z-10">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
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
                    void handleSearch();
                  }
                }}
                placeholder="Paste YouTube URL or search for a video..."
                className="w-full rounded-xl border border-emerald-800/50 bg-zinc-900 px-4 py-3 pl-11 text-sm text-emerald-100 placeholder-emerald-700 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 sm:text-base"
              />
              <Search className="absolute left-4 top-3.5 h-5 w-5 text-emerald-600" />

              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-emerald-800/50 bg-zinc-900 shadow-2xl">
                  {suggestions.map((suggestion, index) => (
                    <li
                      key={`${suggestion}-${index}`}
                      onClick={() => {
                        setQuery(suggestion);
                        void handleSearch(suggestion);
                      }}
                      className="cursor-pointer px-4 py-2 text-sm text-emerald-200 transition-colors hover:bg-emerald-900/40 sm:text-base"
                    >
                      {suggestion}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              onClick={() => void handleSearch()}
              disabled={isSearching}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-zinc-950 transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Search'}
            </button>

            {canDownloadPastedLink && (
              <button
                onClick={() => void handleLinkDownload()}
                disabled={Boolean(downloadState) || isOffline}
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-600/50 bg-emerald-950/40 px-6 py-3 font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloadState?.key === 'link-download' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : isOffline ? (
                  <WifiOff className="h-5 w-5" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
                {isOffline
                  ? 'Needs internet'
                  : downloadState?.key === 'link-download'
                    ? downloadState.phase === 'saving'
                      ? 'Saving...'
                      : 'Downloading...'
                    : 'Download Link'}
              </button>
            )}

            <button
              onClick={() => void handleRecognize()}
              disabled={isRecognizing || isOffline}
              className="flex items-center justify-center gap-2 rounded-xl border border-emerald-700/50 bg-zinc-900 px-6 py-3 font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRecognizing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
              {isOffline ? 'Needs internet' : isRecognizing ? 'Listening...' : 'Recognize'}
            </button>
          </div>
        </div>

        {isOffline && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 px-4 py-4 text-left">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <WifiOff className="h-4 w-4" />
              Offline mode is active
            </div>
            <p className="mt-1 text-sm text-amber-100/80">{OFFLINE_MODE_MESSAGE}</p>
          </div>
        )}

        {recognition && (
          <div className="rounded-2xl border border-emerald-800/30 bg-zinc-900/50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Music className="h-4 w-4" />
              Recognized with Audd
            </div>
            <div className="text-emerald-100">{recognition.artist} - {recognition.title}</div>
            {(recognition.album || recognition.releaseDate) && (
              <div className="mt-1 text-sm text-emerald-500">
                {[recognition.album, recognition.releaseDate].filter(Boolean).join(' • ')}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {downloadState && (
          <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-4">
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

        {!selectedVideo && (showingOfflineLibrary || showingOfflineSearchResults) && (
          <div className="rounded-2xl border border-emerald-800/30 bg-zinc-900/50 px-4 py-4">
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

        {showOfflineDownloadsShelf && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-800/30 bg-zinc-900/50 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                <WifiOff className="h-4 w-4" />
                Offline Downloads
              </div>
              <p className="mt-1 text-sm text-emerald-500">
                These full videos are saved in the browser, so they stay available inside the site even without an
                internet connection.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {offlineDownloads.map((download) => (
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
                    <div className="absolute left-2 top-2 rounded-full border border-emerald-500/40 bg-emerald-950/70 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                      Saved Offline
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="mb-1 line-clamp-2 font-semibold text-emerald-100 transition-colors group-hover:text-emerald-300">
                      {download.title}
                    </h3>
                    <p className="mb-2 flex-1 text-sm text-emerald-600/80">{download.channel}</p>
                    <div className="mt-auto text-xs font-medium text-emerald-500/70">
                      {formatBytes(download.sizeBytes)} saved in browser
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {savedDownloads.length > 0 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-800/30 bg-zinc-900/50 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                <FolderOpen className="h-4 w-4" />
                Saved in app
              </div>
              <p className="mt-1 text-sm text-emerald-500">
                These files are stored in your chosen folder and stay available even when the app is offline.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {savedDownloads.map((download) => (
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
                      {formatBytes(download.sizeBytes)} saved to {download.fileName}
                    </div>
                  </div>
                </button>
              ))}
            </div>
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
                <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
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
                  </div>
                  <div className="border-t border-zinc-800/70 bg-zinc-950 px-4 py-4">
                    <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width]"
                        style={{
                          width: `${savedPreviewDuration > 0 ? (savedPreviewCurrentTime / savedPreviewDuration) * 100 : 0}%`
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-emerald-400">
                        {formatDuration(Math.floor(savedPreviewCurrentTime || 0))}
                      </span>
                      <button
                        type="button"
                        onClick={() => void toggleSavedPreviewPlayback()}
                        disabled={isSavedPreviewLoading}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-80"
                      >
                        {isSavedPreviewLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : isSavedPreviewPlaying ? (
                          <Pause className="h-5 w-5" />
                        ) : (
                          <Play className="ml-0.5 h-5 w-5" />
                        )}
                      </button>
                      <span className="font-mono text-xs text-emerald-400">
                        {formatRemainingDuration(
                          savedPreviewCurrentTime,
                          savedPreviewDuration || selectedSavedDownload.duration || 0
                        )}
                      </span>
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

              <h2 className="mb-2 font-bold text-emerald-100">{selectedSavedDownload.title}</h2>
              <p className="mb-1 text-sm font-medium text-emerald-500">{selectedSavedDownload.channel}</p>
              <p className="font-mono text-xs text-emerald-700">
                Size: {formatBytes(selectedSavedDownload.sizeBytes)}
              </p>
            </div>
          </div>
        )}

        {selectedVideo ? (
          <div className="space-y-6">
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

                      <div className="rounded-xl border border-emerald-800/30 bg-zinc-950/40">
                        <div className="border-b border-emerald-800/30 px-4 py-3 text-sm font-semibold text-emerald-300">
                          Audio
                        </div>
                        <div className="space-y-2 p-3">
                          {(videoDetails?.audioFormats || []).slice(0, 6).map((format) => (
                            <div
                              key={`audio-${format.itag}-${format.url}`}
                              className="flex items-center justify-between gap-3 rounded-lg border border-emerald-900/40 bg-zinc-900/70 px-3 py-3"
                            >
                              <div>
                                <div className="text-sm font-semibold text-emerald-100">
                                  {format.qualityLabel} {format.mimeType ? `(${format.mimeType.split('/')[1]})` : ''}
                                </div>
                                <div className="text-xs text-emerald-500">
                                  {format.contentLength} {format.bitrate ? `• ${Math.round(format.bitrate)} kbps` : ''}
                                </div>
                              </div>
                              <button
                                onClick={() => void handleFormatDownload(format)}
                                disabled={Boolean(downloadState) || isOffline}
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isOffline ? (
                                  'Offline'
                                ) : downloadState?.key === `audio-${format.itag}` ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {downloadState.phase === 'saving' ? 'Saving' : 'Downloading'}
                                  </span>
                                ) : (
                                  'Download'
                                )}
                              </button>
                            </div>
                          ))}
                          {!videoDetails?.audioFormats?.length && (
                            <div className="text-sm text-emerald-500">No audio-only formats found.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-emerald-800/30 bg-zinc-950/40">
                        <div className="border-b border-emerald-800/30 px-4 py-3 text-sm font-semibold text-emerald-300">
                          Video
                        </div>
                        <div className="space-y-2 p-3">
                          {(videoDetails?.videoFormats || []).slice(0, 8).map((format) => (
                            <div
                              key={`video-${format.itag}-${format.url}`}
                              className="flex items-center justify-between gap-3 rounded-lg border border-emerald-900/40 bg-zinc-900/70 px-3 py-3"
                            >
                              <div>
                                <div className="text-sm font-semibold text-emerald-100">
                                  {format.qualityLabel} {format.mimeType ? `(${format.mimeType.split('/')[1]})` : ''}
                                </div>
                                <div className="text-xs text-emerald-500">
                                  {format.contentLength} {format.hasAudio ? '• with audio' : '• video only'}
                                </div>
                              </div>
                              <button
                                onClick={() => void handleFormatDownload(format)}
                                disabled={Boolean(downloadState) || isOffline}
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isOffline ? (
                                  'Offline'
                                ) : downloadState?.key === `video-${format.itag}` ? (
                                  <span className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {downloadState.phase === 'saving' ? 'Saving' : 'Downloading'}
                                  </span>
                                ) : (
                                  'Download'
                                )}
                              </button>
                            </div>
                          ))}
                          {!videoDetails?.videoFormats?.length && (
                            <div className="text-sm text-emerald-500">No video formats found.</div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                          onClick={() => void handleDownload(videoDetails?.url || selectedVideo.url)}
                          disabled={Boolean(downloadState) || isOffline}
                          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isOffline ? (
                            <WifiOff className="h-4 w-4" />
                          ) : downloadState?.key === 'quick-download' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {isOffline
                            ? 'Offline'
                            : downloadState?.key === 'quick-download'
                            ? downloadState.phase === 'saving'
                              ? 'Saving...'
                              : 'Downloading...'
                            : 'Quick Download'}
                        </button>

                        <button
                          onClick={() => void handleSaveOfflineDownload()}
                          disabled={Boolean(downloadState) || isOffline || hasSavedOfflineCopy}
                          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-60"
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
                          onClick={() => openVideo(selectedVideo.url)}
                          disabled={isOffline}
                          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Music className="h-4 w-4" />
                          {isOffline ? 'Offline only' : 'Open on YouTube'}
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
                  <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
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
                        <div className="absolute left-3 top-3 rounded-full border border-emerald-400/40 bg-emerald-950/80 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                          Offline Copy
                        </div>
                      )}
                    </div>
                    <div className="border-t border-zinc-800/70 bg-zinc-950 px-4 py-4">
                      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-[width]"
                          style={{
                            width: `${previewDuration > 0 ? (previewCurrentTime / previewDuration) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs text-emerald-400">
                          {formatDuration(Math.floor(previewCurrentTime || 0))}
                        </span>
                        <button
                          type="button"
                          onClick={() => void togglePreviewPlayback()}
                          disabled={isPreviewLoading}
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-80"
                        >
                          {isPreviewLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : isPreviewPlaying ? (
                            <Pause className="h-5 w-5" />
                          ) : (
                            <Play className="ml-0.5 h-5 w-5" />
                          )}
                        </button>
                        <span className="font-mono text-xs text-emerald-400">
                          {formatRemainingDuration(
                            previewCurrentTime,
                            previewDuration || videoDetails?.duration || selectedVideo.duration || 0
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {!isOffline ? (
                      <button
                        type="button"
                        onClick={() => openVideo(videoDetails?.url || selectedVideo.url)}
                        className="mb-4 block w-full overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg transition-transform hover:-translate-y-1"
                      >
                        <img
                          src={selectedThumbnail}
                          alt={videoDetails?.title || selectedVideo.title}
                          className="h-auto w-full object-contain"
                          onError={(e) => {
                            e.currentTarget.src = fallbackThumbnail(selectedVideo.id);
                          }}
                        />
                      </button>
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
                <h2 className="mb-2 font-bold text-emerald-100">{videoDetails?.title || selectedVideo.title}</h2>
                <p className="mb-1 text-sm font-medium text-emerald-500">{videoDetails?.channel || selectedVideo.channel}</p>
                <p className="font-mono text-xs text-emerald-700">
                  Duration: {formatDuration(videoDetails?.duration || selectedVideo.duration)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

        {visibleResults.length === 0 && !isSearching && !selectedVideo && (
          <div className="py-20 text-center text-emerald-800/50">
            <Search className="mx-auto mb-4 h-16 w-16 opacity-20" />
            <p>{isOffline ? 'Reconnect or search something from your saved history.' : 'Search for a video to get started.'}</p>
          </div>
        )}

        <div className="flex justify-center border-t border-emerald-900/30 pt-12 pb-6">
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
        </div>
      </div>

      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </div>
  );
}
