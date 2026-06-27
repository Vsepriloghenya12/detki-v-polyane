const cacheName = 'detki-v-polyane-v4'
const files = ['/', '/owner', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== cacheName).map(key => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request))
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(cacheName).then(cache => cache.put(event.request, copy))
      }
      return response
    }).catch(async () => (
      await caches.match(event.request) ||
      await caches.match('/')
    )))
    return
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && url.origin === self.location.origin) {
      const copy = response.clone()
      caches.open(cacheName).then(cache => cache.put(event.request, copy))
    }
    return response
  }).catch(() => caches.match('/'))))
})
