import React, { useState } from "react";
import { downloadVideo } from "./download";

type SearchVideo = {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
};

type VideoInfo = {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail?: string;
  url: string;
  audioFormats?: Array<{ itag: string; qualityLabel: string }>;
  videoFormats?: Array<{ itag: string; qualityLabel: string }>;
};

function formatDuration(seconds: number) {
  if (!seconds) return "Unknown";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function fallbackThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoInfo | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [error, setError] = useState("");

  const searchVideos = async (nextQuery: string) => {
    const trimmedQuery = nextQuery.trim();
    setQuery(nextQuery);

    if (!trimmedQuery) {
      setResults([]);
      setSelectedVideo(null);
      setError("");
      return;
    }

    setLoadingSearch(true);
    setError("");

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Search failed");
      }

      const normalizedResults = (data as SearchVideo[]).map((video) => ({
        ...video,
        thumbnail: video.thumbnail || fallbackThumbnail(video.id),
      }));

      setResults(normalizedResults);
    } catch (err: any) {
      setResults([]);
      setError(err?.message || "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  };

  const loadVideoInfo = async (video: SearchVideo) => {
    setError("");
    setSelectedVideo({
      id: video.id,
      title: video.title,
      channel: video.channel,
      duration: video.duration,
      thumbnail: video.thumbnail || fallbackThumbnail(video.id),
      url: video.url,
      audioFormats: [],
      videoFormats: [],
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">FK Downloader</h1>
        <p className="mt-2 text-emerald-100">
          Search for a video, preview its details, then download it.
        </p>
      </div>

      <input
        className="w-full rounded border border-emerald-700 bg-emerald-50 p-3 text-black outline-none"
        placeholder="Search videos..."
        value={query}
        onChange={(e) => void searchVideos(e.target.value)}
      />

      {error ? <p className="mt-4 text-red-300">{error}</p> : null}
      {loadingSearch ? <p className="mt-4 text-emerald-100">Searching...</p> : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-4">
          {results.map((video) => (
            <button
              key={video.id}
              type="button"
              onClick={() => void loadVideoInfo(video)}
              className="flex items-start gap-4 rounded border border-emerald-800 bg-emerald-900/60 p-4 text-left transition hover:border-emerald-500"
            >
              <img
                src={video.thumbnail || fallbackThumbnail(video.id)}
                alt={video.title}
                width={160}
                className="rounded object-cover"
                onError={(e) => {
                  const target = e.currentTarget;
                  const fallback = fallbackThumbnail(video.id);
                  if (target.src !== fallback) {
                    target.src = fallback;
                  }
                }}
              />
              <div className="min-w-0">
                <h2 className="line-clamp-2 text-lg font-semibold">{video.title}</h2>
                <p className="mt-1 text-sm text-emerald-100">{video.channel}</p>
                <p className="mt-2 text-xs text-emerald-200">
                  Duration: {formatDuration(video.duration)}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="rounded border border-emerald-800 bg-emerald-900/70 p-4">
          {selectedVideo ? (
            <>
              <img
                src={selectedVideo.thumbnail || fallbackThumbnail(selectedVideo.id)}
                alt={selectedVideo.title}
                className="mb-4 w-full rounded"
                onError={(e) => {
                  e.currentTarget.src = fallbackThumbnail(selectedVideo.id);
                }}
              />
              <h2 className="text-xl font-bold">{selectedVideo.title}</h2>
              <p className="mt-2 text-emerald-100">{selectedVideo.channel}</p>
              <p className="mt-2 text-sm text-emerald-200">
                Duration: {formatDuration(selectedVideo.duration)}
              </p>
              <p className="mt-4 text-sm text-emerald-100">
                Video formats are loaded at download time to avoid extractor errors in production.
              </p>
              <button
                type="button"
                className="mt-4 rounded bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
                onClick={() => void downloadVideo(selectedVideo.url)}
              >
                Download
              </button>
            </>
          ) : (
            <p className="text-emerald-100">
              Select a search result to load its details here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
