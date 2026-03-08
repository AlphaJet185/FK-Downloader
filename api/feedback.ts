import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, message, email } = req.body;
  if (!type || !message) return res.status(400).json({ error: 'Type and message required' });

  console.log('Feedback:', { type, message, email });

  res.json({ success: true, message: 'Feedback received (logged to console)' });
}
