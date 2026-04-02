import express from "express";
import cors from "cors";
import youtubedl from "youtube-dl-exec";

const app = express();
app.use(cors());

app.get("/download", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true
    });

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      formats: info.formats
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Download failed" });
  }
});

app.listen(3000, () => {
  console.log("Downloader API running on port 3000");
});
