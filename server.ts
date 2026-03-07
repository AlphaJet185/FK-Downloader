import express from 'express';
import { createServer as createViteServer } from 'vite';
import http from 'http';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import youtubedl from 'youtube-dl-exec';
import { execFile } from 'child_process';
import os from 'os';

const isLocal = os.platform() === 'win32' || os.platform() === 'darwin' || process.env.USE_BROWSER_COOKIES === 'true';
import Database from 'better-sqlite3';

const app = express();
const PORT = 31337;
const server = http.createServer(app);
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// Initialize Database
const db = new Database('app.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Cookies API Route
app.post('/api/cookies', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    fs.renameSync(req.file.path, cookiesPath);
    workingCookieStrategy = null; // Reset strategy to try cookies.txt
    res.json({ success: true, message: 'Cookies uploaded successfully' });
  } catch (error) {
    console.error('Cookies upload error:', error);
    res.status(500).json({ error: 'Failed to upload cookies' });
  }
});

// Feedback API Route
app.post('/api/feedback', (req, res) => {
  try {
    const { type, message, email } = req.body;
    if (!type || !message) {
      return res.status(400).json({ error: 'Type and message are required' });
    }
    
    const stmt = db.prepare('INSERT INTO feedback (type, message, email) VALUES (?, ?, ?)');
    stmt.run(type, message, email || null);
    
    res.json({ success: true, message: 'Feedback submitted successfully' });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Auto-update yt-dlp on startup
try {
  console.log('Updating yt-dlp...');
  const ytDlpPath = path.resolve(process.cwd(), 'node_modules/youtube-dl-exec/bin/yt-dlp');
  if (fs.existsSync(ytDlpPath)) {
    execFile(ytDlpPath, ['-U'], (error, stdout, stderr) => {
      if (error) {
        console.error('Failed to update yt-dlp:', error);
      } else {
        console.log('yt-dlp updated successfully:\n', stdout);
      }
    });
  } else {
    console.warn('yt-dlp binary not found at', ytDlpPath);
  }
} catch (e) {
  console.error('Failed to update yt-dlp:', e);
}

// AudD API Route for Music Recognition
app.post('/api/recognize', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const apiToken = process.env.AUDD_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ error: 'AUDD_API_TOKEN is not configured in the environment. Please add it to your secrets.' });
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(req.file.path));
    formData.append('api_token', apiToken);

    const response = await axios.post('https://api.audd.io/', formData, {
      headers: formData.getHeaders(),
    });

    fs.unlinkSync(req.file.path);

    res.json(response.data);
  } catch (error: any) {
    console.error('AudD API Error:', error.response?.data || error.message);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to recognize music' });
  }
});

// Helper to execute yt-dlp with fallback strategies
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://www.youtube.com/';

const getBaseArgs = () => ({
  noPlaylist: true,
  noWarnings: true,
  ignoreErrors: true,
  extractorRetries: 10,
  forceIpv4: true,
  jsRuntimes: 'node',
  extractorArgs: 'youtube:player_client=android,player_skip=webpage',
  addHeader: [
    `User-Agent: ${USER_AGENT}`,
    `Referer: ${REFERER}`
  ]
});

let workingCookieStrategy: any = null;

async function executeYtDlp(url: string, extraArgs: any, isDownload = false): Promise<any> {
  const strategies: any[] = [];
  
  if (workingCookieStrategy) {
    strategies.push(workingCookieStrategy);
  }

  // Only try browser cookies if we are local or explicitly enabled
  // On Linux servers, this usually fails or throws "unsupported platform"
  if (isLocal) {
    strategies.push({ cookiesFromBrowser: 'chrome' });
    strategies.push({ cookiesFromBrowser: 'edge' });
    strategies.push({ cookiesFromBrowser: 'firefox' });
    if (os.platform() === 'darwin') {
      strategies.push({ cookiesFromBrowser: 'safari' });
    }
  }

  const cookiesPath = path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    strategies.push({ cookies: cookiesPath });
  }
  
  strategies.push({}); // Fallback to no cookies

  // Deduplicate strategies
  const uniqueStrategies = strategies.filter((v, i, a) => a.findIndex(t => JSON.stringify(t) === JSON.stringify(v)) === i);

  let lastError: any;

  for (const strategy of uniqueStrategies) {
    try {
      const args = { ...getBaseArgs(), ...extraArgs, ...strategy };
      
      if (isDownload) {
        // For download, we just return the process using the first strategy
        // that worked previously (or the first one in the list)
        return youtubedl.exec(url, args);
      } else {
        const result = await youtubedl(url, args);
        workingCookieStrategy = strategy; // Cache the working strategy
        return result;
      }
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || String(error);
      if (
        errorMsg.includes('Sign in to confirm') || 
        errorMsg.includes('could not find') || 
        errorMsg.includes('cookies') ||
        errorMsg.includes('bot') ||
        errorMsg.includes('Authentication')
      ) {
        console.log(`Strategy ${JSON.stringify(strategy)} failed, trying next...`);
        workingCookieStrategy = null;
        continue;
      }
      throw error;
    }
  }

  throw new Error('Authentication required: Please sign in to YouTube or provide a valid cookies.txt file. ' + (lastError?.message || ''));
}

// YouTube Search Route
app.get('/api/search', async (req, res) => {
  let { q } = req.query;
  if (!q || typeof q !== 'string') return res.json([]);

  try {
    const isUrl = q.startsWith('http://') || q.startsWith('https://');
    
    const searchTarget = isUrl ? q : `ytsearch5:${q}`;
    console.log('Searching for:', searchTarget);
    
    try {
      const output = await executeYtDlp(searchTarget, {
        dumpSingleJson: true,
        flatPlaylist: true,
        skipDownload: true
      });
      console.log('Search output keys:', Object.keys(output));
      
      if (isUrl) {
        const v: any = output;
        res.json([{
          id: v.id,
          title: v.title,
          channel: v.uploader,
          duration: v.duration,
          thumbnail: `/api/thumbnail?url=${encodeURIComponent(v.thumbnail || v.thumbnails?.[0]?.url)}`,
          url: v.webpage_url,
        }]);
      } else {
        const entries = (output as any).entries || [];
        console.log('Found entries:', entries.length);
        const formattedResults = entries.map((v: any) => ({
          id: v.id,
          title: v.title,
          channel: v.uploader,
          duration: v.duration,
          thumbnail: `/api/thumbnail?url=${encodeURIComponent(v.thumbnail || v.thumbnails?.[0]?.url)}`,
          url: v.url || v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`,
        }));
        res.json(formattedResults);
      }
    } catch (ytError: any) {
      console.error('yt-dlp search error:', ytError.message || ytError);
      res.json([]);
    }
  } catch (error: any) {
    console.error('Search error:', error.message);
    res.json([]);
  }
});

// Proxy Thumbnail Route
app.get('/api/thumbnail', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    response.data.pipe(res);
  } catch (error) {
    console.error('Thumbnail fetch error:', error);
    res.status(500).send('Failed to fetch thumbnail');
  }
});

// YouTube Suggest Route
app.get('/api/suggest', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const response = await axios.get(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q as string)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    res.json(response.data[1] || []);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// YouTube Info Route for detailed formats
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });

  try {
    console.log('Fetching info for:', url);
    const info: any = await executeYtDlp(url, { dumpJson: true, skipDownload: true });
    
    // Group formats
    const formats = (info.formats || []).map((f: any) => ({
      itag: f.format_id,
      qualityLabel: f.format_note || f.resolution || (f.vcodec !== 'none' ? 'Video' : 'Audio'),
      bitrate: f.tbr || f.abr || f.vbr,
      mimeType: `${f.vcodec !== 'none' ? 'video' : 'audio'}/${f.ext}`,
      hasVideo: f.vcodec !== 'none',
      hasAudio: f.acodec !== 'none',
      contentLength: f.filesize ? (f.filesize / (1024 * 1024)).toFixed(2) + 'M' : 'Unknown',
      url: f.url
    }));

    const audioFormats = formats.filter((f: any) => !f.hasVideo && f.hasAudio).sort((a: any, b: any) => b.bitrate - a.bitrate);
    const videoFormats = formats.filter((f: any) => f.hasVideo).sort((a: any, b: any) => {
      const aRes = parseInt(a.qualityLabel) || 0;
      const bRes = parseInt(b.qualityLabel) || 0;
      return bRes - aRes;
    });

    res.json({
      id: info.id,
      title: info.title,
      channel: info.uploader,
      duration: info.duration,
      thumbnail: `/api/thumbnail?url=${encodeURIComponent(info.thumbnail || info.thumbnails?.[0]?.url)}`,
      url: info.webpage_url,
      audioFormats,
      videoFormats
    });
  } catch (error: any) {
    console.error('Info error:', error.message || error);
    res.status(500).json({ error: error.message || 'Failed to fetch video details' });
  }
});

// Download Route
app.get('/api/download', async (req, res) => {
  const { url, type, itag } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('URL required');

  try {
    const info: any = await executeYtDlp(url, { dumpJson: true, skipDownload: true });
    const title = info.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    let formatId = itag as string;
    let ext = 'mp4';

    if (!formatId) {
      if (type === 'audio') {
        formatId = 'bestaudio';
        ext = 'webm';
      } else {
        formatId = 'best';
      }
    } else {
      const format = info.formats?.find((f: any) => f.format_id === formatId);
      if (format) {
        ext = format.ext || (format.vcodec !== 'none' ? 'mp4' : 'webm');
      }
    }

    res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    
    const dlProcess = await executeYtDlp(url, { format: formatId }, true);
    dlProcess.stdout?.pipe(res);
    
    dlProcess.on('error', (err: any) => {
      console.error('Download process error:', err);
      if (!res.headersSent) res.status(500).send('Download failed');
    });

  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).send('Download failed');
  }
});

// Vite middleware for development
async function startServer() {
  try {
    console.log('Updating yt-dlp to the latest version...');
    await youtubedl('', { update: true } as any);
    console.log('yt-dlp update complete.');
  } catch (err: any) {
    console.error('Failed to update yt-dlp:', err.message || err);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: { server }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
