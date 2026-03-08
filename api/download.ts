import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeYtDlp } from './utils';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url, type, itag } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');

  try {
    const info: any = await executeYtDlp(url, { dumpJson: true, skipDownload: true });
    const title = info.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    let formatId = itag as string;
    let ext = 'mp4';
    if (!formatId) {
      if (type === 'audio') { formatId = 'bestaudio'; ext = 'webm'; } 
      else { formatId = 'best'; }
    }

    res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    const dlProcess = await executeYtDlp(url, { format: formatId }, true);
    dlProcess.stdout?.pipe(res);
    dlProcess.on('error', (err: any) => { console.error(err); if (!res.headersSent) res.status(500).send('Download failed'); });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).send('Download failed');
  }
}
