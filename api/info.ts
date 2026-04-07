import type { ApiRequest, ApiResponse } from './types';
import { executeYtDlp } from './utils';

function buildQualityLabel(format: any) {
  if (format.vcodec === 'none') {
    if (format.abr || format.tbr) {
      return `${Math.round(format.abr || format.tbr)} kbps`;
    }
    return 'Audio';
  }

  if (format.height) {
    return `${format.height}p`;
  }

  return format.format_note || format.format || 'Video';
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const info = await executeYtDlp(url, {
      dumpSingleJson: true,
      preferFreeFormats: false,
    });

    if (typeof info === 'string') {
      throw new Error('yt-dlp returned an unexpected string payload');
    }

    const formats = (info.formats || [])
    .filter((f: any) => f.ext !== "webm") // ❌ remove webm formats
    .map((f: any) => ({

      itag: f.format_id,
      qualityLabel: f.format_note || f.format || (f.vcodec !== 'none' ? "Video" : "Audio"),
      bitrate: f.tbr || f.vbr || f.abr || 0,
      mimeType: f.ext ? `${f.vcodec !== 'none' ? 'video' : 'audio'}/${f.ext}` : undefined,
      hasVideo: f.vcodec !== 'none',
      hasAudio: f.acodec !== 'none',
      contentLength: f.filesize || f.filesize_approx
        ? ((Number(f.filesize || f.filesize_approx) / (1024 * 1024)).toFixed(2) + "M")
        : "Unknown",
      url: `/api/download?url=${encodeURIComponent(url)}&itag=${f.format_id}`
    }));

    const sourceUrl = info.webpage_url || info.original_url || url;
    const playbackFormats = (info.formats || [])
      .filter((format: any) => format?.url && format.ext !== 'webm')
      .map((format: any) => ({
        itag: String(format.format_id || ''),
        qualityLabel: buildQualityLabel(format),
        bitrate: format.tbr || format.vbr || format.abr || 0,
        mimeType: format.ext
          ? `${format.vcodec !== 'none' ? 'video' : 'audio'}/${format.ext}`
          : undefined,
        hasVideo: format.vcodec !== 'none',
        hasAudio: format.acodec !== 'none',
        height: Number(format.height || 0),
        contentLength:
          format.filesize || format.filesize_approx
            ? `${(Number(format.filesize || format.filesize_approx) / (1024 * 1024)).toFixed(2)}M`
            : 'Unknown',
        url: `/api/download?url=${encodeURIComponent(sourceUrl)}&itag=${encodeURIComponent(String(format.format_id || ''))}`
      }));

    const m4aFormats = uniqueBy(
      playbackFormats
        .filter(
          (format: any) =>
            !format.hasVideo &&
            format.hasAudio &&
            (format.mimeType?.includes('m4a') || format.mimeType?.includes('mp4'))
        )
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)),
      (format: any) => `${Math.round(format.bitrate || 0)}-${format.mimeType || ''}`
    ).map((format: any) => ({
      ...format,
      mimeType: 'audio/mp4',
      url: `/api/download?url=${encodeURIComponent(sourceUrl)}&type=audio&audioFormat=mp4&itag=${encodeURIComponent(format.itag)}`
    }));

    const bestAudioBitrate = m4aFormats[0]?.bitrate || 0;
    const audioFormats = [
      {
        itag: 'mp3',
        qualityLabel: bestAudioBitrate ? `MP3 ${Math.round(bestAudioBitrate)} kbps` : 'MP3',
        bitrate: bestAudioBitrate,
        mimeType: 'audio/mp3',
        hasVideo: false,
        hasAudio: true,
        height: 0,
        contentLength: m4aFormats[0]?.contentLength || 'Unknown',
        url: `/api/download?url=${encodeURIComponent(sourceUrl)}&type=audio&audioFormat=mp3`
      },
      ...m4aFormats
    ];

    const videoFormats = uniqueBy(
      playbackFormats
        .filter((format: any) => format.hasVideo && format.mimeType?.includes('mp4'))
        .sort((a: any, b: any) => {
          const heightDiff = (b.height || 0) - (a.height || 0);
          if (heightDiff !== 0) return heightDiff;
          return (b.bitrate || 0) - (a.bitrate || 0);
        }),
      (format: any) => `${format.height || format.qualityLabel}-${format.mimeType || ''}`
    ).map((format: any) => ({
      ...format,
      url: `/api/download?url=${encodeURIComponent(sourceUrl)}&type=video&itag=${encodeURIComponent(format.itag)}`
    }));

    const previewFormat =
      playbackFormats
        .filter(
          (format: any) =>
            format.hasVideo &&
            format.hasAudio &&
            format.mimeType?.includes('mp4')
        )
        .sort((a: any, b: any) => {
          const heightDiff = (b.height || 0) - (a.height || 0);
          if (heightDiff !== 0) return heightDiff;
          return (b.bitrate || 0) - (a.bitrate || 0);
        })[0] || null;

    res.json({
      id: info.id,
      title: info.title,
      channel: info.channel || info.uploader || '',
      duration: Number(info.duration || 0),
      previewUrl: previewFormat
        ? `/api/download?url=${encodeURIComponent(sourceUrl)}&type=video&itag=${encodeURIComponent(previewFormat.itag)}&preview=1`
        : '',
      audioFormats,
      videoFormats,

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
