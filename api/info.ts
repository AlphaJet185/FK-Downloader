import type { VercelRequest, VercelResponse } from '@vercel/node';
import youtubedl from 'youtube-dl-exec';

export default async function handler(req: VercelRequest, res: VercelResponse) {

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true
    });

    if (typeof info === 'string') {
      throw new Error('yt-dlp returned an unexpected string payload');
    }

    const formats = (info.formats || []).map((f: any) => ({
      itag: f.format_id,
      qualityLabel: f.format_note || f.format || (f.vcodec !== 'none' ? "Video" : "Audio"),
      bitrate: f.tbr || f.vbr || f.abr || 0,
      mimeType: f.ext ? `${f.vcodec !== 'none' ? 'video' : 'audio'}/${f.ext}` : undefined,
      hasVideo: f.vcodec !== 'none',
      hasAudio: f.acodec !== 'none',
      contentLength: f.filesize || f.filesize_approx
        ? ((Number(f.filesize || f.filesize_approx) / (1024 * 1024)).toFixed(2) + "M")
        : "Unknown",
      url: f.url
    }));

    res.json({
      id: info.id,
      title: info.title,
      channel: info.channel || info.uploader || '',
      duration: Number(info.duration || 0),

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

      thumbnail: info.thumbnails?.at(-1)?.url || info.thumbnail,

      url: info.webpage_url || info.original_url || url
    });

  } catch (error: any) {
    console.error("API error:", error);

    res.status(500).json({
      error: error?.message || "Failed to fetch video details"
    });
  }
}
