// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - package has no callable types
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import os from 'os';

const isLocal = os.platform() === 'win32' || os.platform() === 'darwin' || process.env.USE_BROWSER_COOKIES === 'true';
let workingCookieStrategy: any = null;

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
      const result = await (youtubedl as any)(url, args);
      workingCookieStrategy = strategy;
      return result;
    } catch (error: any) {
      lastError = error;
      const msg = error.message || String(error);
      if (msg.includes('Sign in') || msg.includes('cookies') || msg.includes('Authentication')) {
        workingCookieStrategy = null;
        continue;
      }
      throw error;
    }
  }

  throw new Error('Authentication required: ' + (lastError?.message || ''));
}
