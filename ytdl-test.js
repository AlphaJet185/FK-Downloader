import ytdl from 'ytdl-core';

(async () => {
  const urls = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=KZGWfHdfWQs',
    'https://youtube.com/watch?v=1lrFsXkT_rM'
  ];

  for (const url of urls) {
    try {
      console.log('testing', url);
      const info = await ytdl.getInfo(url);
      console.log('title', info.videoDetails.title);
    } catch (e) {
      console.error('error for', url, e.message || e);
    }
  }
})();