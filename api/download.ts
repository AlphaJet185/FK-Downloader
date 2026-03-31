import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from 'ytdl-core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url, type, itag } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');
  if (!ytdl.validateURL(url)) return res.status(400).send('Invalid YouTube URL');

  try {
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          // Realistic browser headers help avoid 410 errors
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    });

    const formats = info.formats;
    let selected: any = null;
    const itagStr = typeof itag === 'string' ? itag : '';
    const kind = typeof type === 'string' ? type : '';

    if (itagStr) selected = formats.find((f: any) => f.itag.toString() === itagStr);
    if (!selected) {
      if (kind === 'audio') selected = formats.find((f: any) => !f.hasVideo && f.hasAudio);
      else if (kind === 'video') selected = formats.find((f: any) => f.hasVideo);
      else selected = formats.find((f: any) => f.hasVideo) || formats[0];
    }

    if (!selected) return res.status(404).send('Format not found');

    // Stream directly to avoid 410
    res.setHeader('Content-Disposition', `attachment; filename="${info.videoDetails.title}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');

    const stream = ytdl(url, {
      quality: selected.itag,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    });

    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('Streaming error:', err);
      res.status(500).send('Download failed during streaming');
    });
  } catch (err) {
    console.error('Download handler error:', err);
    res.status(500).send('Download failed');
  }
}
