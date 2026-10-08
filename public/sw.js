const CACHE = 'bluekite-public-v1';
// Cloudflare serves HTML at extensionless URLs. A cached redirect cannot fulfill
// a navigation request whose redirect mode is manual.
const OFFLINE = '/offline';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE, '/brand/symbol.svg', '/brand/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bluekite-public-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never persist API responses, mail bodies, attachments or credentials on the device.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => await caches.match(OFFLINE) || Response.error()));
    return;
  }
  if (!/^\/(assets|brand|fonts)\//.test(url.pathname) || url.search) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && !response.headers.get('Content-Type')?.includes('text/html')) await cache.put(request, response.clone());
    return response;
  })());
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data?.json() || {}; } catch { /* Always show a visible, private fallback. */ }
    const raw = typeof data.url === 'string' ? data.url : '/';
    let target = '/';
    try { const url = new URL(raw, self.location.origin); if (url.origin === self.location.origin) target = url.pathname + url.search; } catch {}
    await self.registration.showNotification(typeof data.title === 'string' ? data.title.slice(0, 100) : 'Mailroom', {
      body: typeof data.body === 'string' ? data.body.slice(0, 240) : '새 메일이 도착했습니다.',
      icon: '/brand/icon-192.png', badge: '/brand/notification-badge.png',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 80) : 'bluekite-mail',
      data: { url: target },
    });
    const pages = await self.clients.matchAll({ type: 'window' });
    for (const page of pages) page.postMessage({ type: 'mail-arrived' });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    let url = new URL('/', self.location.origin);
    try { const candidate = new URL(event.notification.data?.url || '/', self.location.origin); if (candidate.origin === self.location.origin) url = candidate; } catch {}
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (new URL(client.url).origin === url.origin && 'navigate' in client) { await client.navigate(url.href); await client.focus(); return; }
    }
    await self.clients.openWindow(url.href);
  })());
});
