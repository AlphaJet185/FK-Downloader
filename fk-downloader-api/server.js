import express from "express";
import cors from "cors";
import youtubedl from "youtube-dl-exec";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("FK Downloader API is running 🚀");
});

app.get("/info", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true
    });

    const formats = (info.formats || []).map(f => ({
      format_id: f.format_id,
      quality: f.format_note || f.height || "audio",
      ext: f.ext,
      url: f.url
    }));

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      formats
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Extraction failed" });
  }
});

app.listen(3000, () => {
  console.log("FK Downloader API running on port 3000");
});
