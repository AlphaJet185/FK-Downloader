import type { ApiRequest, ApiResponse } from './types';
import youtubedl from 'youtube-dl-exec';

function sanitizeFileName(input: string) {
  return input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'download';
}

function pickRequestedFormat(info: any, type: 'audio' | 'video', itag: string) {
  const formats = Array.isArray(info?.formats)
    ? info.formats.filter((format: any) => format?.url && format?.ext !== 'webm')
    : [];

  if (itag) {
    return formats.find((format: any) => String(format.format_id) === itag) || null;
  }

  if (type === 'audio') {
    return (
      formats
        .filter((format: any) => format.vcodec === 'none' && format.acodec !== 'none')
        .sort(
          (a: any, b: any) =>
            (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0)
        )[0] || null
    );
  }

  return (
    formats
      .filter(
        (format: any) =>
          format.vcodec !== 'none' &&
          format.acodec !== 'none' &&
          format.ext === 'mp4'
      )
      .sort(
        (a: any, b: any) =>
          (b.height || 0) - (a.height || 0) ||
          (b.tbr || 0) - (a.tbr || 0)
      )[0] ||
    formats
      .filter(
        (format: any) => format.vcodec !== 'none' && format.acodec !== 'none'
      )
      .sort(
        (a: any, b: any) =>
          (b.height || 0) - (a.height || 0) ||
          (b.tbr || 0) - (a.tbr || 0)
      )[0] ||
    null
  );
}

function downloadContentType(ext: string) {
  switch (ext.toLowerCase()) {
    case 'mp4':
      return 'video/mp4';
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/opus';
    case 'wav':
      return 'audio/wav';
    default:
      return 'application/octet-stream';
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { url } = req.query;
  const rawType = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
  const rawItag = Array.isArray(req.query.itag) ? req.query.itag[0] : req.query.itag;
  const type = rawType === 'audio' ? 'audio' : 'video';
  const itag = typeof rawItag === 'string' ? rawItag.trim() : '';

  if (!url || typeof url !== 'string') {
    return res.status(400).send('URL required');
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: false
    });

    if (typeof info === 'string') {
      throw new Error('yt-dlp returned an unexpected string payload');
    }

    const selectedFormat = pickRequestedFormat(info, type, itag);
    const downloadUrl = selectedFormat?.url;

    if (!downloadUrl) {
      throw new Error('No downloadable format URL returned by yt-dlp');
    }

    const upstreamResponse = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!upstreamResponse.ok) {
      throw new Error(`Media request failed with status ${upstreamResponse.status}`);
    }

    const ext = selectedFormat?.ext || (type === 'audio' ? 'm4a' : 'mp4');
    const fileName = `${sanitizeFileName(info.title || 'download')}.${ext}`;
    const contentType =
      upstreamResponse.headers.get('content-type') || downloadContentType(ext);
    const contentLength = upstreamResponse.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName.replace(/"/g, '')}"`
    );

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    return res.send(buffer);

  } catch (err) {
    console.error('yt-dlp error:', err);
    res.status(500).send('Download failed');
  }
}
