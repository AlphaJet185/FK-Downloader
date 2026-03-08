import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from 'ytdl-core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url, type, itag } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');

  try {
    const info: any = await ytdl.getInfo(url);
    const formats = info.formats || [];

    let selected = formats.find((f: any) => String(f.itag) === String(itag));
    if (!selected) {
      selected = type === 'audio'
        ? formats.find((f: any) => !f.hasVideo && f.hasAudio)
        : formats.find((f: any) => f.hasVideo);
    }

    if (!selected) return res.status(404).send('Format not found');

    res.json({ downloadUrl: selected.url, title: info.videoDetails?.title });
  } catch (error) {
    console.error('download handler error:', error);
    res.status(500).send('Download failed');
  }
}
