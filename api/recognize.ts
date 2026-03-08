import type { VercelRequest, VercelResponse } from '@vercel/node';
import multer from 'multer';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';

const upload = multer({ dest: '/tmp' });

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  upload.single('audio')(req as any, res as any, async (err: any) => {
    if (err) return res.status(500).json({ error: 'Failed to upload file' });
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No audio file provided' });

    const apiToken = process.env.AUDD_API_TOKEN;
    if (!apiToken) return res.status(500).json({ error: 'AUDD_API_TOKEN not set' });

    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(file.path));
      formData.append('api_token', apiToken);

      const response = await axios.post('https://api.audd.io/', formData, {
        headers: formData.getHeaders(),
      });

      fs.unlinkSync(file.path);
      res.json(response.data);
    } catch (error: any) {
      console.error(error);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(500).json({ error: 'Failed to recognize music' });
    }
  });
}
