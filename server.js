const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // npm install node-fetch@2
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static("public"));

const API_KEY = process.env.YOUTUBE_API_KEY;

app.get("/video-info", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  try {
    // Extract video ID
    const videoId = new URL(url).searchParams.get("v");

    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${API_KEY}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const video = data.items[0];
    res.json({
      title: video.snippet.title,
      channel: video.snippet.channelTitle,
      thumbnail: video.snippet.thumbnails.high.url,
      views: video.statistics.viewCount,
      published: video.snippet.publishedAt,
    });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong", details: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
