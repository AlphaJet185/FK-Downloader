import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// path to our bundled yt-dlp binary
const binPath = path.resolve(__dirname, '..', 'bin', 'yt-dlp');

const isLocal = os.platform() === 'win32' || os.platform() === 'darwin' || process.env.USE_BROWSER_COOKIES === 'true';
let workingCookieStrategy: any = null;

function ensureBinary() {
  if (!fs.existsSync(binPath)) {
    throw new Error('yt-dlp binary not found at ' + binPath);
  }
  // make sure executable bit is set
  try {
    fs.chmodSync(binPath, 0o755);
  } catch {}
}

function objectToArgs(obj: any): string[] {
  const arr: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const flag = '--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    if (typeof v === 'boolean') {
      if (v) arr.push(flag);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        arr.push(flag, String(item));
      }
    } else {
      arr.push(flag, String(v));
    }
  }
  return arr;
}

function runYtdlp(url: string, args: any): Promise<any> {
  ensureBinary();
  const cliArgs = [...objectToArgs(args), url];
  return new Promise((resolve, reject) => {
    execFile(binPath, cliArgs, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      try {
        const r = JSON.parse(stdout);
        resolve(r);
      } catch (e) {
        reject(e);
      }
    });
  });
}

export const getBaseArgs = () => ({
  noPlaylist: true,
  noWarnings: true,
  ignoreErrors: true,
  extractorRetries: 10,
  forceIpv4: true,
  jsRuntimes: 'node',
  extractorArgs: 'youtube:player_client=android,player_skip=webpage',
  addHeader: [
    `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
    `Referer: https://www.youtube.com/`
  ]
});

export async function executeYtDlp(url: string, extraArgs: any = {}, isDownload = false): Promise<any> {
  const strategies: any[] = [];
  if (workingCookieStrategy) strategies.push(workingCookieStrategy);

  if (isLocal) {
    strategies.push({ cookiesFromBrowser: 'edge' });
    strategies.push({ cookiesFromBrowser: 'chrome' });
    strategies.push({ cookiesFromBrowser: 'firefox' });
    if (os.platform() === 'darwin') strategies.push({ cookiesFromBrowser: 'safari' });
  }

  const cookiesPath = path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(cookiesPath)) strategies.push({ cookies: cookiesPath });

  strategies.push({}); // fallback

  const uniqueStrategies = strategies.filter((v, i, a) => a.findIndex(t => JSON.stringify(t) === JSON.stringify(v)) === i);

  let lastError: any;
  for (const strategy of uniqueStrategies) {
    try {
      const args = { ...getBaseArgs(), ...extraArgs, ...strategy };
      const result = await runYtdlp(url, args);
      workingCookieStrategy = strategy;
      return result;
    } catch (error: any) {
      lastError = error;
      const msg = (error.message || String(error)).toLowerCase();
      if (
        msg.includes('sign in') ||
        msg.includes('authentication') ||
        msg.includes('cookie')
      ) {
        workingCookieStrategy = null;
        continue;
      }
      throw error;
    }
  }

  throw new Error('Authentication required: ' + (lastError?.message || ''));
}
