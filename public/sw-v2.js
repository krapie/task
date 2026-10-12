const CACHE = 'task-v3'
const PRECACHE = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('push', e => {
  let data = { title: 'Task', body: '' }
  try { data = e.data?.json() ?? data } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/apple-touch-icon.png',
      tag: data.tag ?? 'task',
      data: { url: data.url ?? '/' },
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = e.notification.data?.url ?? '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin))
      if (existing) return existing.focus().then(c => c.navigate(target))
      return clients.openWindow(target)
    })
  )
})

// Same-origin GETs only. Hashed /assets/* never change: cache-first. Page loads: network first, but
// after 3 s fall back to the cached shell so a slow connection shows the app (or its boot screen), not a blank page.
const NAV_TIMEOUT_MS = 3000

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(req, clone))
        }
        return res
      }))
    )
    return
  }

  if (req.mode === 'navigate') {
    const network = fetch(req).then(res => {
      if (res.ok) {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put('/index.html', clone))
      }
      return res
    })
    e.respondWith(
      withTimeout(network, NAV_TIMEOUT_MS).catch(() => caches.match('/index.html').then(hit => hit || network))
    )
  }
})
