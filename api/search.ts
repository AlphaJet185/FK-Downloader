import type { ApiRequest, ApiResponse } from './types';

interface SearchVideo {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
}

function getStableThumbnail(videoId: string, fallback?: string) {
  if (!videoId) return fallback || '';
  return `/api/thumb?id=${encodeURIComponent(videoId)}`;
}

function parseDuration(text?: string) {
  if (!text) return 0;
  const parts = text
    .split(':')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) return 0;
  return parts.reduce((total, value) => total * 60 + value, 0);
}

function extractInitialData(html: string) {
  const patterns = [
    /var ytInitialData = (\{.*?\});<\/script>/s,
    /window\["ytInitialData"\] = (\{.*?\});<\/script>/s,
    /ytInitialData = (\{.*?\});<\/script>/s
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return JSON.parse(match[1]);
    }
  }

  throw new Error('Unable to parse YouTube search payload');
}

function collectVideoRenderers(node: unknown, results: any[] = []): any[] {
  if (!node || typeof node !== 'object') return results;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, results);
    }
    return results;
  }

  const record = node as Record<string, unknown>;
  if (record.videoRenderer) {
    results.push(record.videoRenderer);
  }

  for (const value of Object.values(record)) {
    collectVideoRenderers(value, results);
  }

  return results;
}

function toSearchVideo(renderer: any): SearchVideo | null {
  const id = renderer?.videoId;
  const title =
    renderer?.title?.runs?.map((run: any) => run?.text).join('') ||
    renderer?.title?.simpleText ||
    '';

  if (!id || !title) return null;

  const channel =
    renderer?.ownerText?.runs?.[0]?.text ||
    renderer?.longBylineText?.runs?.[0]?.text ||
    renderer?.shortBylineText?.runs?.[0]?.text ||
    '';

  const durationText =
    renderer?.lengthText?.simpleText ||
    renderer?.lengthText?.runs?.map((run: any) => run?.text).join('') ||
    '';

  const thumbUrl =
    renderer?.thumbnail?.thumbnails?.at?.(-1)?.url ||
    renderer?.thumbnail?.thumbnails?.[0]?.url ||
    '';

  return {
    id,
    title,
    channel,
    duration: parseDuration(durationText),
    thumbnail: getStableThumbnail(id, thumbUrl),
    url: `https://youtube.com/watch?v=${id}`
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { q } = req.query;
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Query required' });
  }

  const rawPage = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
  const page = Math.max(1, Number.parseInt(String(rawPage || '1'), 10) || 1);
  const pageSize = 10;
  const offset = (page - 1) * pageSize;

  try {
    const response = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`YouTube search request failed with status ${response.status}`);
    }

    const html = await response.text();
    const initialData = extractInitialData(html);
    const renderers = collectVideoRenderers(initialData);
    const videos = renderers
      .map(toSearchVideo)
      .filter((video): video is SearchVideo => Boolean(video))
      .slice(offset, offset + pageSize);

    res.json(videos);
  } catch (err) {
    console.error('search error', err);
    res.status(500).json({ error: 'Search failed' });
  }
}
