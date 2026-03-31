import ytdl from 'ytdl-core';

async function tryUrl(url) {
  try {
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36'
        }
      }
    });
    console.log('got', url, info.videoDetails?.title);
  } catch (e) {
    console.error('yt error for', url, e.message || e);
  }
}

(async () => {
  await tryUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'); // classic
  await tryUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ'); // may fail
})();
