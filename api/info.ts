import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from '@distube/ytdl-core';

export default async function handler(req: VercelRequest, res: VercelResponse) {

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: "URL required" });
  }

  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  try {

    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }
    });

    const formats = info.formats.map((f: any) => ({
      itag: f.itag,
      qualityLabel: f.qualityLabel || f.quality || (f.hasVideo ? "Video" : "Audio"),
      bitrate: f.bitrate,
      mimeType: f.mimeType,
      hasVideo: f.hasVideo,
      hasAudio: f.hasAudio,
      contentLength: f.contentLength
        ? (parseInt(f.contentLength) / (1024 * 1024)).toFixed(2) + "M"
        : "Unknown",
      url: f.url
    }));

    res.json({
      id: info.videoDetails.videoId,
      title: info.videoDetails.title,
      channel: info.videoDetails.author.name,
      duration: parseInt(info.videoDetails.lengthSeconds),

      audioFormats: formats
        .filter(f => !f.hasVideo && f.hasAudio)
        .sort((a,b) => (b.bitrate||0)-(a.bitrate||0)),

      videoFormats: formats
        .filter(f => f.hasVideo)
        .sort((a,b) => {
          const aRes = parseInt(a.qualityLabel) || 0;
          const bRes = parseInt(b.qualityLabel) || 0;
          return bRes - aRes;
        }),

      thumbnail: info.videoDetails.thumbnails.at(-1)?.url,

      url: info.videoDetails.video_url
    });

  } catch (error: any) {
    console.error("API error:", error);

    res.status(500).json({
      error: "YouTube blocked the request. Try another video."
    });
  }
}