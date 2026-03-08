import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeYtDlp } from './utils';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });

  try {
    const info: any = await executeYtDlp(url, { dumpJson: true, skipDownload: true });
    const formats = (info.formats || []).map((f: any) => ({
      itag: f.format_id,
      qualityLabel: f.format_note || f.resolution || (f.vcodec !== 'none' ? 'Video' : 'Audio'),
      bitrate: f.tbr || f.abr || f.vbr,
      mimeType: `${f.vcodec !== 'none' ? 'video' : 'audio'}/${f.ext}`,
      hasVideo: f.vcodec !== 'none',
      hasAudio: f.acodec !== 'none',
      contentLength: f.filesize ? (f.filesize / (1024 * 1024)).toFixed(2) + 'M' : 'Unknown',
      url: f.url,
    }));

    res.json({
      id: info.id,
      title: info.title,
      channel: info.uploader,
      duration: info.duration,
      audioFormats: formats.filter(f => !f.hasVideo && f.hasAudio).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)),
      videoFormats: formats.filter(f => f.hasVideo).sort((a, b) => parseInt(b.qualityLabel) - parseInt(a.qualityLabel)),
      thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
      url: info.webpage_url,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to fetch video details' });
  }
}
