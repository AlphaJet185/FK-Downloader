import { execFile } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import youtubedl from 'youtube-dl-exec';

const binPath = path.resolve('./bin/yt-dlp');
const tempDir = path.resolve('.tmp', 'yt-dlp');
const ytDlpHeaders = [
  'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Referer: https://www.youtube.com/'
];

function objectToArgs(obj: any): string[] {
  const arr: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const flag = '--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    if (typeof v === 'boolean') {
      if (v) arr.push(flag);
    } else if (Array.isArray(v)) {
      for (const item of v) arr.push(flag, String(item));
    } else if (v !== undefined && v !== null && v !== '') {
      arr.push(flag, String(v));
    }
  }
  return arr;
}

function parseYtDlpOutput(stdout: string): any {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  return trimmed;
}

function formatYtDlpError(err: any) {
  const lines = [err?.stderr, err?.stdout, err?.message]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);

  const message = lines.find((line) => line.startsWith('ERROR:')) || lines.at(-1) || 'yt-dlp failed';
  return new Error(message.replace(/^ERROR:\s*/, ''));
}

function runYtdlp(command: string, prefixArgs: string[], url: string, args: any): Promise<any> {
  const cliArgs = [...prefixArgs, ...objectToArgs(args), url];

  return new Promise((resolve, reject) => {
    execFile(
      command,
      cliArgs,
      {
        maxBuffer: 50 * 1024 * 1024,
        env: {
          ...process.env,
          TEMP: tempDir,
          TMP: tempDir
        }
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          return reject(err);
        }

        try {
          resolve(parseYtDlpOutput(stdout));
        } catch (parseErr: any) {
          parseErr.stdout = stdout;
          parseErr.stderr = stderr;
          reject(parseErr);
        }
      }
    );
  });
}

export const getBaseArgs = () => ({
  noPlaylist: true,
  noWarnings: true,
  extractorRetries: 10,
  forceIpv4: true,
  noCheckCertificates: true,
  addHeader: ytDlpHeaders,
  youtubeSkipDashManifest: true
});

async function runRepoYtDlp(url: string, args: any) {
  await fsp.mkdir(tempDir, { recursive: true });

  const candidates: Array<[string, string[]]> = process.platform === 'win32'
    ? [
        ['py', ['-3', binPath]],
        ['python', [binPath]]
      ]
    : [
        [binPath, []],
        ['python3', [binPath]],
        ['python', [binPath]]
      ];

  let lastError: any = null;

  for (const [command, prefixArgs] of candidates) {
    try {
      return await runYtdlp(command, prefixArgs, url, args);
    } catch (err: any) {
      lastError = err;
      if (err?.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  throw lastError || new Error('Unable to find a Python runtime for yt-dlp');
}

export async function executeYtDlp(url: string, extraArgs: any = {}): Promise<any> {
  const args = { ...getBaseArgs(), ...extraArgs };

  try {
    if (fs.existsSync(binPath)) {
      return await runRepoYtDlp(url, args);
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error('repo yt-dlp execution failed:', err?.stderr || err);
      throw formatYtDlpError(err);
    }
  }

  try {
    return await youtubedl(url, args);
  } catch (err: any) {
    console.error('youtube-dl-exec fallback failed:', err?.stderr || err);
    throw formatYtDlpError(err);
  }
}
