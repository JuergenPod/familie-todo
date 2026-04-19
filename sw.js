// Service worker: cache-first app shell, network-first version.json, never cache GitHub API.
// Bump APP_VERSION in lockstep with version.json when releasing.

const APP_VERSION = '1.0.0';
const CACHE_NAME = `familie-todo-v${APP_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './icons/icon.svg',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './js/app.js',
  './js/config.js',
  './js/store.js',
  './js/github.js',
  './js/sync.js',
  './js/ui.js',
  './js/theme.js',
  './js/timer.js',
  './js/dnd.js',
  './js/points.js',
  './js/calendar.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL).catch(() => {
      // Best-effort: precache whatever is reachable; missing files during dev won't break install.
      return Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)));
    })),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache GitHub API calls.
  if (url.hostname === 'api.github.com') return;

  // Network-first for version.json (freshness matters for update detection).
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => caches.match(req)),
    );
    return;
  }

  // Cache-first for same-origin shell assets.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        }),
      ),
    );
  }
});
