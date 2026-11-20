const CACHE_NAME = 'gioco15-pwa-v4';

const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './assets/icon-192.svg',
    './assets/icon-512.svg',
    './css/base.css',
    './css/themes.css',
    './css/components.css',
    './css/modes.css',
    './js/app.js',
    './js/core/board.js',
    './js/core/physics.js',
    './js/core/haptics.js',
    './js/core/storage.js',
    './js/audio/sound-engine.js',
    './js/sensors/gyroscope.js',
    './js/sensors/media.js',
    './js/ai/solver-core.js',
    './js/ai/solver.worker.js',
    './js/ai/solver-client.js',
    './js/modes/daily.js',
    './js/modes/speedsolve.js',
    './js/modes/arcade.js',
    './js/modes/replay.js',
    './js/ui/board-renderer.js',
    './js/ui/drawer.js',
    './js/ui/victory-modal.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((networkRes) => {
                if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
                    const copy = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return networkRes;
            }).catch(() => caches.match('./index.html'));
        })
    );
});
