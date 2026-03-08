import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from 'ytdl-core';

// note: fs import removed since it was unused


export default async function handler(req: VercelRequest, res: VercelResponse) {

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: "URL required" });
  }

  // validate incoming URL to avoid ytdl-core throwing
  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    // ⚡ Get video info using ytdl-core
    const info = await ytdl.getInfo(url);

    const formats = info.formats.map((f: any) => ({
      itag: f.itag,
      qualityLabel: f.qualityLabel || f.quality || (f.hasVideo ? 'Video' : 'Audio'),
      bitrate: f.bitrate,
      mimeType: f.mimeType,
      hasVideo: f.hasVideo,
      hasAudio: f.hasAudio,
      contentLength: f.contentLength ? (parseInt(f.contentLength) / (1024 * 1024)).toFixed(2) + 'M' : 'Unknown',
      url: f.url
    }));

    res.json({
      id: info.videoDetails.videoId,
      title: info.videoDetails.title,
      channel: info.videoDetails.author.name,
      duration: parseInt(info.videoDetails.lengthSeconds),
      audioFormats: formats.filter(f => !f.hasVideo && f.hasAudio).sort((a,b) => (b.bitrate||0)-(a.bitrate||0)),
      videoFormats: formats.filter(f => f.hasVideo).sort((a,b) => {
        const aRes = parseInt(a.qualityLabel) || 0;
        const bRes = parseInt(b.qualityLabel) || 0;
        return bRes - aRes;
      }),
      thumbnail: info.videoDetails.thumbnails[0]?.url,
      url: info.videoDetails.video_url
    });

  } catch (error: any) {
    console.error('Handler error:', error);
    console.error('Error stack:', error.stack);

    let errorMessage = 'Failed to fetch video details';
    let statusCode: number | null = null;

    // some errors come through as JSON-stringified messages
    if (error.statusCode && typeof error.statusCode === 'number') {
      statusCode = error.statusCode;
    } else if (error.message) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed && typeof parsed.statusCode === 'number') {
          statusCode = parsed.statusCode;
        }
      } catch {
        // ignore parse failure
      }
    }

    if (statusCode) {
      if (statusCode === 410) {
        errorMessage = 'Video is unavailable or deleted';
      } else if (statusCode === 403) {
        errorMessage = 'Video is private or age-restricted';
      } else {
        errorMessage = `Video error: HTTP ${statusCode}`;
      }
    } else if (error.message) {
      // fallback to any human-readable message
      errorMessage = error.message;
    }

    res.status(500).json({ error: errorMessage });
  }
}
 