import type { ApiRequest, ApiResponse } from './types';
import axios from 'axios';

function youtubeThumbUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).send('Video id required');
  }

  try {
    const response = await axios.get<ArrayBuffer>(youtubeThumbUrl(id), {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.status(200).send(Buffer.from(response.data));
  } catch (error) {
    console.error('thumbnail proxy error', error);
    res.status(404).send('Thumbnail not found');
  }
}
