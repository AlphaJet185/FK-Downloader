import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from 'ytdl-core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url, type, itag } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');
  if (!ytdl.validateURL(url)) return res.status(400).send('Invalid YouTube URL');

  try {
    const info = await ytdl.getInfo(url);
    const formats = info.formats;

    let selected: any = null;
    const itagStr = typeof itag === 'string' ? itag : '';
    const kind = typeof type === 'string' ? type : '';

    if (itagStr) {
      selected = formats.find((f: any) => f.itag.toString() === itagStr);
    }
    if (!selected) {
      if (kind === 'audio') selected = formats.find((f: any) => !f.hasVideo && f.hasAudio);
      else if (kind === 'video') selected = formats.find((f: any) => f.hasVideo);
      else selected = formats.find((f: any) => f.hasVideo) || formats[0];
    }
    if (!selected) return res.status(404).send('Format not found');

    // Set headers
    res.setHeader('Content-Disposition', `attachment; filename="${info.videoDetails.title}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');

    // Stream the video through the server
    ytdl(url, { quality: selected.itag }).pipe(res);

  } catch (error) {
    console.error('download handler error:', error);
    res.status(500).send('Download failed');
  }
}
