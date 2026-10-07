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
