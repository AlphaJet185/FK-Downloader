import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeYtDlp } from './utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url, type, itag } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');

  try {
    const info: any = await executeYtDlp(url, { dumpJson: true, skipDownload: true });
    const formats = info.formats || [];

    let selected = formats.find((f: any) => f.format_id === itag);
    if (!selected) {
      selected = type === 'audio'
        ? formats.find((f: any) => f.vcodec === 'none')
        : formats.find((f: any) => f.vcodec !== 'none');
    }

    if (!selected) return res.status(404).send('Format not found');

    res.json({ downloadUrl: selected.url, title: info.title });
  } catch (error) {
    console.error(error);
    res.status(500).send('Download failed');
  }
}
