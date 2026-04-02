import type { ApiRequest, ApiResponse } from './types';
import youtubedl from 'youtube-dl-exec';

function getStableThumbnail(videoId: string, fallback?: string) {
  if (!videoId) return fallback || '';
  return `/api/thumb?id=${encodeURIComponent(videoId)}`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { q } = req.query;
  if (!q || typeof q !== 'string') return res.status(400).json({ error: 'Query required' });

  try {
    const result = await youtubedl(`ytsearch10:${q}`, {
      dumpSingleJson: true,
      flatPlaylist: true,
      skipDownload: true,
      noWarnings: true
    });

    if (typeof result === 'string') {
      throw new Error('yt-dlp returned an unexpected string payload');
    }

    const entries = (result as any).entries || [];

    const videos = entries.map((entry: any) => ({
      id: entry.id || '',
      title: entry.title || '',
      channel: entry.uploader || entry.channel || '',
      duration: Number(entry.duration || 0),
      thumbnail: getStableThumbnail(entry.id || '', entry.thumbnail),
      url: entry.url?.startsWith('http') ? entry.url : `https://youtube.com/watch?v=${entry.id || ''}`
    }));
    res.json(videos);
  } catch (err) {
    console.error('search error', err);
    res.status(500).json({ error: 'Search failed' });
  }
}
