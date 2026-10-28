// Service worker: offline shell only. API calls always go to the network (never cached),
// so data is never stale; pages fall back to the cached copy, then to /offline.html.
const VERSION = 'mt-v1';
const SHELL = [
  '/offline.html', '/css/style.css', '/js/theme.js', '/js/api.js', '/js/navbar.js',
  '/favicon.svg', '/icons/icon-192.png', '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(req)) || caches.match('/offline.html'))
    );
    return;
  }
  // Static assets: network first so deploys show up immediately, cache as fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// Clicking a browser notification focuses an open tab (or opens one) at the target URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/tasks';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const tab = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) return tab.navigate(target).then((c) => (c || tab).focus());
      return self.clients.openWindow(target);
    })
  );
});
