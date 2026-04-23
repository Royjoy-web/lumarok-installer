// ============================================
// LUMAROK — sw.js
// Service Worker — offline support
// ============================================

const CACHE_NAME = 'lumarok-v8';
const ASSETS = [
  '/',
  './index.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/api.js',
  './js/auth.js',
  './js/dashboard.js',
  './js/app.js',
  './js/setup.js',
  './js/batch1.js',
  './js/batch2.js',
  './js/batch3.js',
  './js/batch4.js',
  './js/quickadd.js',
  './js/biometric.js',
  './js/scanner.js'
];

// Install — cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', e => {
  // Don't cache API calls
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
