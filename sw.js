importScripts('config.js');
const CFG = self.FRESS_CONFIG || {};
const VER = CFG.dataVersion || '1';
const SHELL = 'fress-shell-' + VER;
const TILES = 'fress-tiles-v1';
const CONTOUR = 'fress-contour-' + VER;
const CT = Object.assign({
  dir: 'tiles_kerinci', minZ: 10, maxZ: 16,
  west: 101.1972, east: 101.3359, south: -1.7620, north: -1.6054
}, CFG.contour || {});
const PRECACHE_MAX_Z = Math.min(15, CT.maxZ);   // zoom 16 disimpan otomatis saat pernah dilihat
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'data/routes.json', 'data/jalur_trail_kerinci_fress.gpx', 'icons/icon-192.png', 'icons/icon-512.png'];

/* daftar tile kontur zoom minZ..PRECACHE_MAX_Z di dalam batas GeoTIFF */
const tx = (lon, n) => Math.floor((lon + 180) / 360 * n);
const ty = (lat, n) => { const s = Math.sin(lat * Math.PI / 180); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n); };
function contourUrls(){
  const urls = [];
  for (let z = CT.minZ; z <= PRECACHE_MAX_Z; z++) {
    const n = Math.pow(2, z);
    for (let x = tx(CT.west, n); x <= tx(CT.east, n); x++)
      for (let y = ty(CT.north, n); y <= ty(CT.south, n); y++)
        urls.push(`${CT.dir}/${z}/${x}/${y}.png`);
  }
  return urls;
}
async function precacheContour(){
  const c = await caches.open(CONTOUR);
  const urls = contourUrls();
  for (let i = 0; i < urls.length; i += 10) {        // 10 sekaligus; tile yang tidak ada dilewati
    await Promise.all(urls.slice(i, i + 10).map(async u => {
      try { if (!(await c.match(u))) { const r = await fetch(u); if (r.ok) await c.put(u, r); } } catch (e) {}
    }));
  }
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL).then(c => c.addAll(FILES))
      .then(() => precacheContour().catch(() => {}))   // gagal kontur tidak membatalkan instalasi
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => (k.startsWith('fress-shell-') && k !== SHELL) || (k.startsWith('fress-contour-') && k !== CONTOUR)).map(k => caches.delete(k))))
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

  // tile kontur: cache dulu, kalau belum ada ambil dari jaringan lalu simpan
  if (url.pathname.includes('/' + CT.dir + '/')) {
    e.respondWith(caches.open(CONTOUR).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (err) { return Response.error(); }
    }));
    return;
  }

  // aplikasi: ambil dari cache dulu, perbarui di latar belakang
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
    
