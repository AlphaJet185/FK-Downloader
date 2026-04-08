const VERSION = 'fk-offline-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const CACHEABLE_API_PATHS = [
  '/api/search',
  '/api/info',
  '/api/oembed',
  '/api/suggest',
  '/api/thumb'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/favicon.ico']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function shouldCacheResponse(response) {
  return response && (response.ok || response.type === 'opaque');
}

function isCacheableApiRequest(url) {
  return CACHEABLE_API_PATHS.some((pathName) => url.pathname.startsWith(pathName));
}

function offlineJson(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function navigationFallback() {
  const cache = await caches.open(SHELL_CACHE);
  return (
    (await cache.match('/')) ||
    (await cache.match('/index.html')) ||
    new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    })
  );
}

async function networkFirst(request, cacheName, fallbackFactory) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (shouldCacheResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    return fallbackFactory ? fallbackFactory() : Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (shouldCacheResponse(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await networkPromise) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, navigationFallback));
    return;
  }

  if (url.pathname.startsWith('/api/download')) {
    return;
  }

  if (isCacheableApiRequest(url)) {
    if (url.pathname.startsWith('/api/thumb')) {
      event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
      return;
    }

    event.respondWith(
      networkFirst(request, DATA_CACHE, () =>
        offlineJson('Offline and no cached data is available for this request yet.')
      )
    );
    return;
  }

  const destination = request.destination;
  if (
    destination === 'script' ||
    destination === 'style' ||
    destination === 'image' ||
    destination === 'font' ||
    destination === 'document' ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
