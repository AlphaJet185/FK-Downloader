import { executeYtDlp } from './api/utils.js';

(async () => {
  try {
    const info = await executeYtDlp('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { dumpJson: true, skipDownload: true });
    console.log('got info', info.id);
  } catch (e) {
    console.error('yt-dlp error:', e);
  }
})();