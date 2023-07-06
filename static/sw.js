const cacheName = 'tasks';

self.addEventListener('install', e => {
  console.log('Caching all assets');

  e.waitUntil(
    caches.delete(cacheName).then(() => {
      console.log('Deleted old cache');
      caches.open(cacheName).then(cache => {
        cache.addAll([
          '/offline.html',
          '/Fonts/Clash Display/ClashDisplay-Bold.otf',
          '/Fonts/Clash Display/ClashDisplay-Semibold.otf',
          '/Fonts/Clash Grotesk/ClashGrotesk-Medium.otf',
        ]);
      });
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method != 'GET')
    return;

  if (navigator.onLine) return;

  e.respondWith((async () => {
    if (e.request.url.includes('/Fonts/Clash'))
      return await caches.match(e.request);
    else return await caches.match('/offline.html');
  })());
});