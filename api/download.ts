import type { ApiRequest, ApiResponse } from './types';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { executeYtDlp } from './utils';

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

async function cleanupDirectory(dirPath: string) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.error('cleanup error:', error);
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { url } = req.query;
  const rawType = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
  const rawItag = Array.isArray(req.query.itag) ? req.query.itag[0] : req.query.itag;
  const rawAudioFormat = Array.isArray(req.query.audioFormat)
    ? req.query.audioFormat[0]
    : req.query.audioFormat;
  const rawPreview = Array.isArray(req.query.preview) ? req.query.preview[0] : req.query.preview;
  const type = rawType === 'audio' ? 'audio' : 'video';
  const itag = typeof rawItag === 'string' ? rawItag.trim() : '';
  const audioFormat = rawAudioFormat === 'mp3' ? 'mp3' : 'mp4';
  const isPreview = rawPreview === '1';

  if (!url || typeof url !== 'string') {
    return res.status(400).send('URL required');
  }

  try {
    const info = await executeYtDlp(url, {
      dumpSingleJson: true,
      preferFreeFormats: false
    });

    if (typeof info === 'string') {
      throw new Error('yt-dlp returned an unexpected string payload');
    }

    const selectedFormat = pickRequestedFormat(info, type, itag);
    const canStreamDirectly =
      !!selectedFormat?.url &&
      ((type === 'audio' && audioFormat === 'mp4') ||
        (type === 'video' &&
          selectedFormat?.acodec &&
          selectedFormat.acodec !== 'none'));

    if (canStreamDirectly) {
      const ext = selectedFormat?.ext || (type === 'audio' ? 'm4a' : 'mp4');
      const fileName = `${sanitizeFileName(info.title || 'download')}.${ext}`;
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0'
      };

      const requestedRange =
        typeof req.headers?.range === 'string' ? req.headers.range : undefined;

      if (requestedRange) {
        headers.Range = requestedRange;
      }

      const upstreamResponse = await fetch(selectedFormat.url, { headers });

      if (!upstreamResponse.ok) {
        throw new Error(`Media request failed with status ${upstreamResponse.status}`);
      }

      if (upstreamResponse.status === 206 && typeof res.status === 'function') {
        res.status(206);
      }

      res.setHeader(
        'Content-Type',
        upstreamResponse.headers.get('content-type') || downloadContentType(ext)
      );

      if (!isPreview) {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${fileName.replace(/"/g, '')}"`
        );
      }

      const contentLength = upstreamResponse.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentRange = upstreamResponse.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      const acceptRanges = upstreamResponse.headers.get('accept-ranges');
      if (acceptRanges) {
        res.setHeader('Accept-Ranges', acceptRanges);
      } else if (isPreview) {
        res.setHeader('Accept-Ranges', 'bytes');
      }

      const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
      return res.send(buffer);
    }

    const tempDir = path.join(
      os.tmpdir(),
      `fk-downloader-api-${Date.now()}-${crypto.randomUUID()}`
    );
    const outputTemplate = path.join(tempDir, 'download.%(ext)s');

    await fsp.mkdir(tempDir, { recursive: true });

    let formatSelector = '';

    if (type === 'audio') {
      formatSelector = itag ? itag : 'bestaudio[ext=m4a]/bestaudio';
    } else if (selectedFormat?.acodec && selectedFormat.acodec !== 'none') {
      formatSelector = itag || 'best[ext=mp4]/best';
    } else if (itag) {
      formatSelector = `${itag}+bestaudio[ext=m4a]/${itag}+bestaudio/${itag}`;
    } else {
      formatSelector = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]';
    }

    const downloadOptions: Record<string, any> = {
      output: outputTemplate,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: false,
      format: formatSelector
    };

    if (type === 'video') {
      downloadOptions.mergeOutputFormat = 'mp4';
    }

    if (type === 'audio' && audioFormat === 'mp3') {
      downloadOptions.extractAudio = true;
      downloadOptions.audioFormat = 'mp3';
      downloadOptions.audioQuality = '0';
    }

    await executeYtDlp(url, downloadOptions);

    const downloadedFiles = (await fsp.readdir(tempDir))
      .filter((fileName) => !fileName.endsWith('.part'))
      .map((fileName) => path.join(tempDir, fileName));

    const targetFile = downloadedFiles[0];

    if (!targetFile) {
      await cleanupDirectory(tempDir);
      throw new Error('Download file was not created');
    }

    const ext = path.extname(targetFile).slice(1) || (type === 'audio' ? audioFormat : 'mp4');
    const fileName = `${sanitizeFileName(info.title || 'download')}.${ext}`;
    const stat = await fsp.stat(targetFile);

    res.setHeader('Content-Type', downloadContentType(ext));

    if (!isPreview) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName.replace(/"/g, '')}"`
      );
    }

    res.setHeader('Content-Length', String(stat.size));

    const stream = fs.createReadStream(targetFile);

    stream.on('error', async (error) => {
      console.error('stream error:', error);
      if (!res.headersSent) {
        res.status(500).send('Download failed');
      }
      await cleanupDirectory(tempDir);
    });

    res.on('close', () => {
      void cleanupDirectory(tempDir);
    });

    return stream.pipe(res as any);

  } catch (err) {
    console.error('yt-dlp error:', err);
    return res.status(500).send('Download failed');
  }
}
