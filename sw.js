/* Service worker : coquille hors-ligne, données en cache (stale-while-revalidate, clés versionnées),
   tuiles OSM en cache avec expiration ; API météo et imagerie Esri toujours en réseau. */
const VERSION = 'v202609132104';
const SHELL = ['./', './index.html', './css/style.css', './js/config.js', './js/icons.js', './js/forecast.js', './js/app.js',
  './vendor/leaflet/leaflet.min.js', './vendor/leaflet/leaflet.min.css', './vendor/leaflet/images/layers.png', './vendor/leaflet/images/layers-2x.png',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const TILE_MAX_AGE = 7 * 24 * 3600 * 1000, TILE_MAX = 600, PAGE_MAX = 80;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== 'tiles').map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) {
    if (/(^|\.)tile\.openstreetmap\.org$|opentopomap\.org$/.test(url.host)) e.respondWith(tileCache(e.request));
    return; // Open-Meteo, Esri, Commons, Flickr : réseau
  }
  if (e.request.mode === 'navigate') { e.respondWith(navigate(e.request)); return; }
  e.respondWith(staleWhileRevalidate(e.request));
});
async function navigate(req) {
  try { const res = await fetch(req); if (res.ok) { const c = await caches.open(VERSION); if (/\/s\/[^/]+\.html$/.test(new URL(req.url).pathname)) { c.put(req, res.clone()); trim(c, PAGE_MAX, /\/s\//); } } return res; }
  catch (e) { const c = await caches.open(VERSION); return (await c.match(req)) || (await c.match('./index.html')) || new Response('Hors ligne', { status: 503 }); }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);           // clé complète, paramètre ?v= inclus : une version = une entrée
  const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await net) || new Response('Hors ligne', { status: 503 });
}
async function tileCache(req) {
  const cache = await caches.open('tiles');
  const hit = await cache.match(req);
  if (hit) {
    const t = Date.parse(hit.headers.get('date') || hit.headers.get('sw-date') || 0);
    if (!t || Date.now() - t < TILE_MAX_AGE) return hit;   // respect d'une durée de vie bornée
  }
  try {
    const res = await fetch(req);
    if (res.ok) { const copy = new Response(await res.clone().arrayBuffer(), { headers: { 'content-type': res.headers.get('content-type') || 'image/png', 'sw-date': new Date().toUTCString() } }); cache.put(req, copy); trim(cache, TILE_MAX); }
    return res;
  } catch (e) { return hit || new Response('', { status: 503 }); }
}
async function trim(cache, max, only) {
  let keys = await cache.keys(); if (only) keys = keys.filter((k) => only.test(k.url));
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}
