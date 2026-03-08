import express from "express";
import cors from "cors";
import { exec } from "child_process";

const app = express();
app.use(cors());

app.get("/info", (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "URL required" });
  }

  const cmd = `yt-dlp -J "${url}"`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
      return res.status(500).json({ error: "Failed to fetch video info" });
    }

    try {
      const data = JSON.parse(stdout);

      const formats = data.formats.map(f => ({
        itag: f.format_id,
        qualityLabel: f.format_note || f.resolution || "Unknown",
        hasVideo: f.vcodec !== "none",
        hasAudio: f.acodec !== "none",
        mimeType: `${f.vcodec !== "none" ? "video" : "audio"}/${f.ext}`,
        bitrate: f.tbr || f.abr || 0,
        url: f.url
      }));

      res.json({
        id: data.id,
        title: data.title,
        channel: data.uploader,
        duration: data.duration,
        thumbnail: data.thumbnail,
        audioFormats: formats.filter(f => !f.hasVideo && f.hasAudio),
        videoFormats: formats.filter(f => f.hasVideo)
      });

    } catch (e) {
      res.status(500).json({ error: "Parsing failed" });
    }
  });
});

app.listen(3000, () => console.log("Server running on port 3000"));
