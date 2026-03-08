import fetch from 'node-fetch';

async function check(url) {
  const encoded = encodeURIComponent(url);
  const endpoint = `https://fk-downloader-bmmt8psbw-purringcoral5041-projects.vercel.app/api/info?url=${encoded}`;
  try {
    const res = await fetch(endpoint);
    console.log('url', url, 'status', res.status, 'headers', res.headers.get('content-type'));
    const text = await res.text();
    console.log('body start', text.slice(0,100));
    if (text.length > 100) console.log('body continued...', text.slice(100));
  } catch (e) {
    console.error('fetch error', e);
  }
}

(async () => {
  await check('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await check('https://youtube.com/watch?v=KZGWfHdfWQs');
  await check('https://youtube.com/watch?v=1lrFsXkT_rM');
})();