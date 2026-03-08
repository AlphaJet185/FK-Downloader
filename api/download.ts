import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from 'ytdl-core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url, type, itag } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');
  if (!ytdl.validateURL(url)) return res.status(400).send('Invalid YouTube URL');

  try {
    const info = await ytdl.getInfo(url);
    const formats = info.formats;

    const itagStr = typeof itag === 'string' ? itag : '';
    const kind = typeof type === 'string' ? type : ''; // could be 'audio' or 'video'

    let selected = itagStr
      ? formats.find((f: any) => f.itag.toString() === itagStr)
      : null;
    if (!selected) {
      if (kind === 'audio') {
        selected = formats.find((f: any) => !f.hasVideo && f.hasAudio);
      } else if (kind === 'video') {
        selected = formats.find((f: any) => f.hasVideo);
      } else {
        // default to highest quality video
        selected = formats.find((f: any) => f.hasVideo) || formats[0];
      }
    }

    if (!selected) return res.status(404).send('Format not found');

    res.json({ downloadUrl: selected.url, title: info.videoDetails.title });
  } catch (error) {
    console.error('download handler error:', error);
    res.status(500).send('Download failed');
  }
}
