import fetch from 'node-fetch';

(async () => {
  const url = 'https://youtube.com/watch?v=1lrFsXkT_rM';
  const endpoint = `https://fk-downloader-bmmt8psbw-purringcoral5041-projects.vercel.app/api/info?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(endpoint);
    console.log('status', res.status, 'ctype', res.headers.get('content-type'));
    const text = await res.text();
    console.log('body', text.slice(0,200));
  } catch (e) {
    console.error('fetch error', e);
  }
})();