import type { ApiRequest, ApiResponse } from './types';
import axios from 'axios';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { q } = req.query;
  if (!q || typeof q !== 'string') return res.json([]);

  try {
    const response = await axios.get(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    res.json(response.data[1] || []);
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
}
