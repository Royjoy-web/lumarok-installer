// ============================================
// LUMAROK — sw.js
// Service Worker — offline support
// ============================================

const CACHE_NAME = 'lumarok-v11-refactor';
const ASSETS = [
  '/',
  './index.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Foundation
  './js/telemetry/trace.js',
  './js/core/store.js',
  './js/core/retry.js',
  './js/core/network-monitor.js',
  './js/core/state-guardian.js',
  './js/core/queue.js',
  // Originals
  './js/api.js',
  './js/auth.js',
  './js/app.js',
  './js/biometric.js',
  './js/router.js',
  './js/skeleton.js',
  './js/roles.js',
  './js/homestatus.js',
  './js/quickadd.js',
  './js/scanner.js',
  // Engines
  './js/provisioning/ble.js',
  './js/provisioning/wifi.js',
  './js/provisioning/fsm.js',
  './js/commissioning/engine.js',
  './js/onboarding/workflow.js',
  './js/onboarding/workflow-hardened.js',
  './js/diagnostics/pipeline.js',
  './js/diagnostics/deployment.js',
  './js/sync/channel.js',
  './js/installer.js',
  './js/compat.js',
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
