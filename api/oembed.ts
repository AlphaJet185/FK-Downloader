import type { ApiRequest, ApiResponse } from './types';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL required' });
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
          Accept: 'application/json'
        }
      }
    );

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to load video from pasted link',
        details: text.slice(0, 300)
      });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to load video from pasted link',
      details: error?.message || 'Unknown error'
    });
  }
}
