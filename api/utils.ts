import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Make sure you put the latest yt-dlp binary in bin/
const binPath = path.resolve('./bin/yt-dlp'); 

function ensureBinary() {
  if (!fs.existsSync(binPath)) {
    throw new Error('yt-dlp binary not found at ' + binPath);
  }
  try { fs.chmodSync(binPath, 0o755); } catch {}
}

function objectToArgs(obj: any): string[] {
  const arr: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const flag = '--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    if (typeof v === 'boolean') {
      if (v) arr.push(flag);
    } else if (Array.isArray(v)) {
      for (const item of v) arr.push(flag, String(item));
    } else arr.push(flag, String(v));
  }
  return arr;
}

function runYtdlp(url: string, args: any): Promise<any> {
  ensureBinary();
  const cliArgs = [...objectToArgs(args), url];
  return new Promise((resolve, reject) => {
    execFile(binPath, cliArgs, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      try { resolve(JSON.parse(stdout)); } 
      catch (e) { reject(e); }
    });
  });
}

export const getBaseArgs = () => ({
  noPlaylist: true,
  noWarnings: true,
  ignoreErrors: true,
  extractorRetries: 10,
  forceIpv4: true,
  noCheckCertificates: true,
  jsRuntimes: 'node',
  addHeader: [
    `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
    `Referer: https://www.youtube.com/`
  ],
  youtubeSkipDashManifest: true
});

export async function executeYtDlp(url: string, extraArgs: any = {}, isDownload = false): Promise<any> {
  const args = { ...getBaseArgs(), ...extraArgs };
  try {
    const result = await runYtdlp(url, args);
    return result;
  } catch (err) {
    console.error('yt-dlp execution failed:', err?.stderr || err);
    throw new Error('Failed to fetch video details from YouTube');
  }
}
