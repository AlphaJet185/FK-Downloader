import ytdl from 'ytdl-core';

async function tryUrl(url) {
  try {
    const info = await ytdl.getInfo(url);
    console.log('got', url, info.videoDetails?.title);
  } catch (e) {
    console.error('yt error for', url, e.message || e);
  }
}

(async () => {
  await tryUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await tryUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
})();