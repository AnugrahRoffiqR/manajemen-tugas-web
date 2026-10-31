// Service worker: offline shell only. API calls always go to the network (never cached),
// so data is never stale; pages fall back to the cached copy, then to /offline.html.
const VERSION = 'mt-v5';
const SHELL = [
  '/offline.html', '/css/style.css', '/js/theme.js', '/js/api.js', '/js/navbar.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png', '/icons/logotask.png', '/manifest.webmanifest',
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
      fetch(req).catch(async () => {
        const cached = (await caches.match(req)) || (await caches.match('/offline.html'));
        // Vercel cleanUrls redirects /offline.html; browsers reject redirected responses for navigations.
        return cached && cached.redirected
          ? new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: cached.headers })
          : cached;
      })
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
      if (!tab) return self.clients.openWindow(target);
      // navigate() rejects for tabs this worker does not control; fall back to a new window.
      return tab.navigate(target).then((c) => (c || tab).focus()).catch(() => self.clients.openWindow(target));
    })
  );
});
