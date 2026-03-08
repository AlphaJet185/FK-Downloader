import { executeYtDlp } from './api/utils.ts';

console.log('running tests');

async function test(url: string) {
  console.log('testing', url);
  try {
    const info = await executeYtDlp(url, { dumpJson: true, skipDownload: true });
    console.log('success', url, '->', info?.id);
  } catch (e: any) {
    console.error('yt-dlp error for', url, ':', e);
    console.error('message prop:', e?.message);
    console.error('toString:', e?.toString());
    console.error('stack:', e?.stack);
  }
}

(async () => {
  await test('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await test('https://youtube.com/watch?v=KZGWfHdfWQs');
  console.log('tests done');
})();