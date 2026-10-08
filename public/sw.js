// Service worker : le jeu fonctionne hors connexion une fois chargé.
// La version est remplacée à chaque build, ce qui renouvelle le cache.
const CACHE = 'usine-__VERSION__';
const SHELL = ['./', 'index.html', 'boot.js?v=__VERSION__', 'app.js?v=__VERSION__', 'styles.css?v=__VERSION__', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (url.origin !== self.location.origin && !isFont) return;
  // Le numéro de version sert à chercher les mises à jour : toujours depuis le réseau.
  if (url.pathname.endsWith('version.json')) return;

  // La page de diagnostic n'est jamais interceptée.
  if (url.pathname.endsWith('diag.html')) return;

  if (req.mode === 'navigate') {
    // Page : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
    e.respondWith(
      fetch(req.url, { cache: 'no-cache' }).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('index.html', copy));
        return res;
      }).catch(() => caches.match('index.html')),
    );
    return;
  }

  // Fichiers : cache d'abord, puis réseau (et mise en cache).
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
