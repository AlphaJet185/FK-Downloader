import type { VercelRequest, VercelResponse } from '@vercel/node';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const upload = multer({ dest: 'uploads/' });

export const config = {
  api: {
    bodyParser: false, // needed for multer
  },
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (err) return res.status(500).json({ error: 'Failed to upload cookies' });
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    fs.renameSync(file.path, cookiesPath);
    res.json({ success: true, message: 'Cookies uploaded successfully' });
  });
}
