import type { VercelRequest, VercelResponse } from '@vercel/node';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'app.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, message, email } = req.body;
  if (!type || !message) return res.status(400).json({ error: 'Type and message are required' });

  try {
    const stmt = db.prepare('INSERT INTO feedback (type, message, email) VALUES (?, ?, ?)');
    stmt.run(type, message, email || null);
    res.json({ success: true, message: 'Feedback submitted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
}
