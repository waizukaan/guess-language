// Uygulama kabuğunu önbelleğe alır; ses dosyalarına dokunmaz
// (iOS Safari, service worker üzerinden gelen seste ileri-geri sarmayı bozabiliyor).
const CACHE = 'dil-tahmin-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'languages.json', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('.mp3')) return;

  // Önce ağ, olmazsa önbellek: güncellemeler hemen görünür, bağlantı kopunca kabuk yine açılır
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
