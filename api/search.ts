import type { VercelRequest, VercelResponse } from '@vercel/node';
import yts from 'yt-search';

function getStableThumbnail(videoId: string, fallback?: string) {
  if (!videoId) return fallback || '';
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { q } = req.query;
  if (!q || typeof q !== 'string') return res.status(400).json({ error: 'Query required' });

  try {
    const result = await yts(q);
    const videos = (result.videos || []).map((v: any) => ({
      id: v.videoId,
      title: v.title,
      channel: v.author?.name || '',
      duration: v.seconds || 0,
      thumbnail: getStableThumbnail(v.videoId, v.thumbnail),
      url: v.url || ''
    }));
    res.json(videos);
  } catch (err) {
    console.error('search error', err);
    res.status(500).json({ error: 'Search failed' });
  }
}
