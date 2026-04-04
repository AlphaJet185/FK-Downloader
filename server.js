import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import youtubedl from "youtube-dl-exec";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.static("public"));

const API_KEY = process.env.YOUTUBE_API_KEY;

function firstArrayValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeVideoUrl(input) {
  if (!input || typeof input !== "string") return "";
  return input.trim();
}

function normalizeFormats(formats = []) {
  return formats
    .filter((format) => format?.url)
    .map((format) => ({
      formatId: format.format_id || "",
      ext: format.ext || "",
      quality:
        format.format_note ||
        format.height ||
        (format.vcodec === "none" ? "audio" : "video"),
      url: format.url,
      acodec: format.acodec || "",
      vcodec: format.vcodec || "",
      filesize: format.filesize || format.filesize_approx || null,
    }));
}

function pickDirectDownloadUrl(info) {
  const formats = normalizeFormats(info?.formats || []);

  const progressive = formats.find(
    (format) =>
      format.url &&
      format.vcodec &&
      format.vcodec !== "none" &&
      format.acodec &&
      format.acodec !== "none",
  );

  if (progressive?.url) return progressive.url;

  const videoOnly = formats.find(
    (format) => format.url && format.vcodec && format.vcodec !== "none",
  );

  if (videoOnly?.url) return videoOnly.url;

  const audioOnly = formats.find(
    (format) => format.url && format.acodec && format.acodec !== "none",
  );

  return audioOnly?.url || "";
}

app.get("/video-info", async (req, res) => {
  const rawUrl = firstArrayValue(req.query.url);
  const url = normalizeVideoUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  try {
    const videoId = new URL(url).searchParams.get("v");
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${API_KEY}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const video = data.items[0];
    return res.json({
      title: video.snippet.title,
      channel: video.snippet.channelTitle,
      thumbnail: video.snippet.thumbnails.high.url,
      views: video.statistics.viewCount,
      published: video.snippet.publishedAt,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Something went wrong", details: err.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "local-downloader" });
});

app.get("/api/download", async (req, res) => {
  const rawUrl = firstArrayValue(req.query.url);
  const url = normalizeVideoUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    });

    if (!info || typeof info === "string") {
      throw new Error("yt-dlp returned an unexpected payload");
    }

    const formats = normalizeFormats(info.formats || []);
    const downloadUrl = pickDirectDownloadUrl(info);

    if (!downloadUrl) {
      throw new Error("No downloadable format URL returned");
    }

    return res.json({
      title: info.title || "download",
      thumbnail: info.thumbnail || "",
      duration: Number(info.duration || 0),
      uploader: info.uploader || "",
      formats,
      downloadUrl,
    });
  } catch (error) {
    console.error("download error", error);
    return res.status(500).json({
      error: "Download failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
