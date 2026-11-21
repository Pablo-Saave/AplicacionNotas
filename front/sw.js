const CACHE_NAME = 'klip-pwa-v18';

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

// Fetch: Stale-While-Revalidate with offline fallback
// Network requests to Supabase always go through (don't cache API calls)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Don't cache Supabase API calls
  const url = new URL(event.request.url);
  if (url.hostname.endsWith('supabase.co')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });

      return cachedResponse || fetchPromise;
    })
  );
});
