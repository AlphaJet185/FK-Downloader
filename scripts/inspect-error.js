import { executeYtDlp } from './api/utils.js';

(async () => {
  try {
    await executeYtDlp('https://youtube.com/watch?v=KZGWfHdfWQs', { dumpJson: true, skipDownload: true });
  } catch (e) {
    console.error('caught error', e);
    console.error('message prop:', e.message);
    console.error('toString:', e.toString());
    console.dir(e, { depth: null });
  }
})();