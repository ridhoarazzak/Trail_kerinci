importScripts('config.js');
const CFG = self.FRESS_CONFIG || {};
const VER = CFG.dataVersion || '1';
const SHELL = 'fress-shell-' + VER;
const TILES = 'fress-tiles-v1';
const CONTOUR_FILE = (CFG.contour && CFG.contour.file) || 'kontur_kerinci.png';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'data/routes.json', 'data/jalur_trail_kerinci_fress.gpx', CONTOUR_FILE,
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => (k.startsWith('fress-shell-') && k !== SHELL) || k.startsWith('fress-contour-')).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache, max){
  const ks = await cache.keys();
  for (let i = 0; i < ks.length - max; i++) await cache.delete(ks[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ubin peta dasar: simpan otomatis saat pernah dilihat
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); trim(c, 1500); }
        return res;
      } catch (err) { return Response.error(); }
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // aplikasi (termasuk PNG kontur): ambil dari cache dulu, perbarui di latar belakang
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') return (await c.match('index.html')) || Response.error();
    return Response.error();
  }));
});
