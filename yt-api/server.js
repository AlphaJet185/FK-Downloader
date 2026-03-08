import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();

app.use(cors());
app.use(express.static("public"));

const API_KEY = "AIzaSyB5tmdlHCRUcWhkyhY0bzfIAcm1bjUJMw8";

app.get("/video-info", async (req, res) => {

  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.json({ error: "No URL provided" });
  }

  try {

    const videoId = new URL(videoUrl).searchParams.get("v");

    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${API_KEY}`
    );

    const video = response.data.items[0];

    res.json({
      title: video.snippet.title,
      channel: video.snippet.channelTitle,
      thumbnail: video.snippet.thumbnails.high.url,
      views: video.statistics.viewCount
    });

  } catch (err) {
    res.json({ error: "Failed to fetch video info" });
  }

});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000 🚀");
});
