import express from "express";
import cors from "cors";
import youtubedl from "youtube-dl-exec";

const app = express();

app.use(cors());

function normalizeFormats(formats = []) {
  return formats.map((format) => ({
    formatId: format.format_id,
    ext: format.ext,
    quality: format.format_note || format.format || "unknown",
    resolution: format.resolution || null,
    fps: format.fps || null,
    videoCodec: format.vcodec,
    audioCodec: format.acodec,
    hasVideo: format.vcodec !== "none",
    hasAudio: format.acodec !== "none",
    filesize: format.filesize || format.filesize_approx || null,
    directUrl: format.url || null
  }));
}

app.get("/download", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true
    });

    if (typeof info === "string") {
      throw new Error("yt-dlp returned an unexpected string payload");
    }

    const formats = normalizeFormats(info.formats || []);
    const directDownloadUrl =
      info.requested_formats?.[0]?.url ||
      info.requested_downloads?.[0]?.requested_formats?.[0]?.url ||
      formats.find((format) => format.directUrl)?.directUrl ||
      null;

    return res.json({
      title: info.title,
      thumbnail: info.thumbnail || info.thumbnails?.at(-1)?.url || null,
      formats,
      directDownloadUrl
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Download failed" });
  }
});

app.listen(3000, () => {
  console.log("Downloader API running on port 3000");
});
