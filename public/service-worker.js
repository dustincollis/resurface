// Resurface service worker — caches app shell for offline reading
// Strategy: cache-first for static assets, network-first for API calls.
// Bundle reports are persisted to localStorage separately by the frontend.

const CACHE_NAME = 'resurface-shell-v1';

// App shell assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Remove old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Let Supabase API calls go through network-only (they require auth)
  if (
    url.hostname.includes('supabase') ||
    url.pathname.startsWith('/functions/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/')
  ) {
    return; // Let the browser handle it normally
  }

  // For navigation requests (HTML), serve from cache with network fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/index.html').then((cached) => cached ?? new Response('Offline', { status: 503 }))
      )
    );
    return;
  }

  // For static assets (JS/CSS/images), cache-first
  if (
    url.pathname.match(/\.(js|css|png|svg|ico|woff2?|ttf)$/) ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
