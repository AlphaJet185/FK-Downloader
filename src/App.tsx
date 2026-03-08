import React, { useState } from "react";

function App() {
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<any>(null);

  const getVideo = async () => {
    const res = await fetch("http://localhost:3000/video-info?url=" + encodeURIComponent(url));
    const data = await res.json();
    setVideo(data);
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <input
        className="border p-2 w-full rounded"
        placeholder="Paste YouTube URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button
        className="mt-2 bg-emerald-700 px-4 py-2 rounded hover:bg-emerald-800"
        onClick={getVideo}
      >
        Get Video Info
      </button>

      {video && (
        <div className="mt-4 border p-2 rounded bg-emerald-900">
          <h2 className="text-lg font-bold">{video.title}</h2>
          <p>Channel: {video.channel}</p>
          <p>Views: {video.views}</p>
          <img src={video.thumbnail} width="300" />
        </div>
      )}
    </div>
  );
}

export default App;
