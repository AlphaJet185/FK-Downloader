import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  MessageSquare,
  Mic,
  Music,
  Radio,
  Search,
  UploadCloud,
  Wifi,
  WifiOff
} from 'lucide-react';
import { FeedbackModal } from './Components/FeedbackModal';
import { downloadVideo, openDownloadUrl } from './download';

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
  audioFormats: FormatOption[];
  videoFormats: FormatOption[];
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
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
    const url = new URL(input.trim());
    const hostname = url.hostname.replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] || null;
    }

    if (
      hostname === 'youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com'
    ) {
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts[0] === 'shorts' || pathParts[0] === 'embed') {
        return pathParts[1] || null;
      }
    }

    return null;
  } catch {
    return null;
  }
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

  const suggestTimeoutRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

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
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    if (suggestTimeoutRef.current) {
      window.clearTimeout(suggestTimeoutRef.current);
    }

    suggestTimeoutRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
        const text = await res.text();
        const data = parseJsonSafely(text);
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]);
      }
    }, 250);

    return () => {
      if (suggestTimeoutRef.current) {
        window.clearTimeout(suggestTimeoutRef.current);
      }
    };
  }, [query]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop?.();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
      const res = await fetch(`/api/info?url=${encodeURIComponent(video.url)}`);
      const text = await res.text();
      const payload = parseJsonSafely(text);

      if (!payload && text.trim().startsWith('<')) {
        throw new Error('Video details API returned HTML instead of JSON.');
      }

      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load video details.');
      }

      setVideoDetails({
        title: payload?.title || video.title,
        channel: payload?.channel || payload?.uploader || video.channel,
        duration: Number(payload?.duration || video.duration || 0),
        thumbnail: payload?.thumbnail || video.thumbnail || fallbackThumbnail(video.id),
        url: payload?.url || video.url,
        audioFormats: Array.isArray(payload?.audioFormats) ? payload.audioFormats : [],
        videoFormats: Array.isArray(payload?.videoFormats) ? payload.videoFormats : []
      });
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
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = async (url: string) => {
    await downloadVideo(url);
  };

  const handleFormatDownload = async (format: FormatOption) => {
    await openDownloadUrl(format.url);
  };

  const copyVideoLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied');
      window.setTimeout(() => setStatus('Idle'), 1500);
    } catch {
      setStatus('Copy failed');
      window.setTimeout(() => setStatus('Idle'), 1500);
    }
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
        </div>

        <div className="relative z-10">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(true);
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

            <button
              onClick={() => void handleRecognize()}
              disabled={isRecognizing}
              className="flex items-center justify-center gap-2 rounded-xl border border-emerald-700/50 bg-zinc-900 px-6 py-3 font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30 disabled:opacity-50"
            >
              {isRecognizing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
              {isRecognizing ? 'Listening...' : 'Recognize'}
            </button>
          </div>
        </div>

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
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-500"
                              >
                                Download
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
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-500"
                              >
                                Download
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
                          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30"
                        >
                          <Download className="h-4 w-4" />
                          Quick Download
                        </button>

                        <button
                          onClick={() => openVideo(selectedVideo.url)}
                          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30"
                        >
                          <Music className="h-4 w-4" />
                          Open on YouTube
                        </button>

                        <button
                          onClick={() => void copyVideoLink(selectedVideo.url)}
                          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-zinc-900 px-4 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/30"
                        >
                          <Copy className="h-4 w-4" />
                          Copy Link
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="w-full bg-zinc-950/50 p-6 text-center md:w-80">
                <div className="mb-4 overflow-hidden rounded-xl border border-zinc-800/50 bg-black shadow-lg">
                  <img
                    src={videoDetails?.thumbnail || selectedVideo.thumbnail || fallbackThumbnail(selectedVideo.id)}
                    alt={videoDetails?.title || selectedVideo.title}
                    className="h-auto w-full object-contain"
                    onError={(e) => {
                      e.currentTarget.src = fallbackThumbnail(selectedVideo.id);
                    }}
                  />
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {results.map((result) => (
              <div
                key={result.id}
                onClick={() => handleVideoClick(result)}
                className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 transition-all hover:-translate-y-1 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)]"
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
              </div>
            ))}
          </div>
        )}

        {results.length === 0 && !isSearching && !selectedVideo && (
          <div className="py-20 text-center text-emerald-800/50">
            <Search className="mx-auto mb-4 h-16 w-16 opacity-20" />
            <p>Search for a video to get started.</p>
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
