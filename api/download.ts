import type { ApiRequest, ApiResponse } from './types';
import youtubedl from 'youtube-dl-exec';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).send('URL required');
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true
    });

    if (typeof info === 'string') {
      throw new Error('yt-dlp returned an unexpected string payload');
    }

    const downloadUrl =
      info.requested_formats?.[0]?.url ??
      info.requested_downloads?.[0]?.requested_formats?.[0]?.url ??
      info.formats?.[0]?.url;

    if (!downloadUrl) {
      throw new Error('No downloadable format URL returned by yt-dlp');
    }

    res.json({
      title: info.title,
      downloadUrl
    });

  } catch (err) {
    console.error('yt-dlp error:', err);
    res.status(500).send('Download failed');
  }
}
