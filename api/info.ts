import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from 'ytdl-core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });

  try {
    const info:any = await ytdl.getInfo(url);
    const vd = info.videoDetails;
    const formats = (info.formats || []).map((f: any) => ({
      itag: f.itag,
      qualityLabel: f.qualityLabel || f.quality || '',
      bitrate: f.bitrate || f.audioBitrate || 0,
      mimeType: f.mimeType || (f.container ? `${f.hasVideo?'video':'audio'}/${f.container}` : ''),
      hasVideo: !!f.hasVideo,
      hasAudio: !!f.hasAudio,
      contentLength: f.contentLength ? (parseInt(f.contentLength) / (1024 * 1024)).toFixed(2) + 'M' : 'Unknown',
      url: f.url
    }));

    res.json({
      id: vd.videoId,
      title: vd.title,
      channel: vd.author?.name || vd.author?.channel_url || '',
      duration: parseInt(vd.lengthSeconds || '0'),
      audioFormats: formats.filter(f => !f.hasVideo && f.hasAudio).sort((a,b) => (b.bitrate||0)-(a.bitrate||0)),
      videoFormats: formats.filter(f => f.hasVideo).sort((a,b) => (parseInt(b.qualityLabel)||0)-(parseInt(a.qualityLabel)||0)),
      thumbnail: vd.thumbnails?.[0]?.url,
      url: vd.video_url || vd.watchUrl
    });
  } catch (error: any) {
    console.error('info handler error:', error);
    const msg = error?.message || String(error) || 'Failed to fetch video details';
    res.status(500).json({ error: msg });
  }
}
