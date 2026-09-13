/* Service worker : coquille hors-ligne + données en cache (stale-while-revalidate), API réseau seulement. */
const VERSION = 'v202609132057';
const SHELL = ['./', './index.html', './css/style.css', './js/config.js', './js/icons.js', './js/forecast.js', './js/app.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) {
    // tuiles de carte : cache opportuniste ; API météo : réseau
    if (/tile\.openstreetmap\.org|arcgisonline|opentopomap/.test(url.host)) e.respondWith(cacheFirst(e.request, 'tiles'));
    return;
  }
  e.respondWith(staleWhileRevalidate(e.request));
});
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const key = new Request(req.url.replace(/\?v=[^&]*/, ''));
  const cached = await cache.match(key);
  const net = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
  return cached || (await net) || new Response('Hors ligne', { status: 503 });
}
async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req); if (hit) return hit;
  try { const res = await fetch(req); if (res.ok) { cache.put(req, res.clone()); trim(cache, 600); } return res; } catch (e) { return new Response('', { status: 503 }); }
}
async function trim(cache, max) { const keys = await cache.keys(); if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k))); }
