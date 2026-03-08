import { useState } from "react";

export default function App() {
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<any>(null);
  const [error, setError] = useState("");

  const getVideo = async () => {
    setError("");
    setVideo(null);
    try {
      const res = await fetch(`http://localhost:3000/video-info?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setVideo(data);
      }
    } catch (err) {
      setError("Failed to fetch video info");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-emerald-950 text-emerald-50 p-4">
      <h1 className="text-3xl font-bold mb-4">FK Downloader - YouTube Info</h1>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Paste YouTube URL"
          className="p-2 rounded text-black w-80"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          onClick={getVideo}
          className="bg-emerald-500 px-4 py-2 rounded hover:bg-emerald-600"
        >
          Get Info
        </button>
      </div>
      {error && <p className="text-red-400 mb-4">{error}</p>}
      {video && (
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">{video.title}</h2>
          <p className="mb-1">Channel: {video.channel}</p>
          <p className="mb-2">Views: {video.views}</p>
          <img src={video.thumbnail} className="rounded shadow-lg mx-auto" />
        </div>
      )}
    </div>
  );
}
