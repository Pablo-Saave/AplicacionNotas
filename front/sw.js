const CACHE_NAME = 'klip-pwa-v21';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './supabase.js',
  './auth.js',
  './manifest.json',
  './public/icon.svg',
  './public/icon-192.png',
  './public/icon-512.png',
  './public/icon-maskable-512.png',
  './public/logo.svg',
  './public/logo-mark.svg',
  './fonts/arimo-400.woff2',
  './fonts/arimo-500.woff2',
  './fonts/arimo-700.woff2'
];

// Install: precache all shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch network-first so installed clients pick up published fixes promptly.
// Cached assets remain available as the offline fallback; Supabase is never cached.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Don't cache Supabase API calls
  const url = new URL(event.request.url);
  if (url.hostname.endsWith('supabase.co')) return;

  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(event.request, { cache: 'no-cache' });
      if (networkResponse?.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }
  })());
});
