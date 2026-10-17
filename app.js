(() => {
'use strict';
const CFG = self.FRESS_CONFIG || {};
const $ = (s) => document.querySelector(s);
const COLORS = ['#e4572e', '#0f9d8a', '#7c3aed']; // Utama, Bangunrejo, Blok E (urutan di GPX)
const DARK = matchMedia('(prefers-color-scheme: dark)').matches;
const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
};

/* ---------- geometri ---------- */
const LAT0 = -1.67;
const MX = 111320 * Math.cos(LAT0 * Math.PI / 180), MY = 110574;
const toM = (p) => [p[1] * MX, p[0] * MY];           // [lat,lon] -> meter lokal
const fmtKm = (m) => (m / 1000).toFixed(1).replace('.', ',') + ' km';
const fmtM = (m) => m >= 1000 ? fmtKm(m) : Math.round(m) + ' m';

function project(pt, a, b){                           // titik terdekat pada segmen a-b (meter lokal)
  const dx = b[0]-a[0], dy = b[1]-a[1], l2 = dx*dx + dy*dy;
  let t = l2 ? ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0]+t*dx, y = a[1]+t*dy;
  return { t, dist: Math.hypot(pt[0]-x, pt[1]-y) };
}

/* ---------- data ---------- */
let tracks = [], waypoints = [];

function prepTrack(t, i){
  t.color = COLORS[i % COLORS.length];
  t.short = t.name.split(':')[0];
  t.m = t.points.map(toM);
  t.cum = [0];
  for (let k = 1; k < t.m.length; k++)
    t.cum.push(t.cum[k-1] + Math.hypot(t.m[k][0]-t.m[k-1][0], t.m[k][1]-t.m[k-1][1]));
  t.len = t.cum[t.cum.length-1];
  t.gaps = new Set(t.gap_index);
}
function locate(track, latlon){                       // {along, off, seg}
  const p = toM(latlon);
  let best = { off: Infinity, along: 0, seg: 0 };
  for (let k = 0; k < track.m.length - 1; k++) {
    const r = project(p, track.m[k], track.m[k+1]);
    if (r.dist < best.off) best = { off: r.dist, along: track.cum[k] + r.t * (track.cum[k+1]-track.cum[k]), seg: k };
  }
  return best;
}
function trackFor(w){
  const n = w.route.toLowerCase();
  return tracks.find(t => t.short.toLowerCase().includes(n.replace('jalur ', ''))) || tracks[0];
}

/* ---------- proyeksi Web Mercator ---------- */
const wx = (lon) => (lon + 180) / 360;
const wy = (lat) => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const unx = (x) => x * 360 - 180;
const uny = (y) => { const n = Math.PI - 2 * Math.PI * y; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

/* ---------- peta ---------- */
const cv = $('#map'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const view = { cx: 0.5, cy: 0.5, z: 12 };
let tilesOn = store.get('tiles') !== '0';           // peta dasar aktif secara default
let contourOn = store.get('contour') !== '0';       // kontur aktif secara default
let sel = null;           // waypoint terpilih
let me = null;            // {lat, lon, acc}
const tileCache = new Map();

/* lapisan kontur (tile XYZ hasil gdal2tiles --xyz; set tms:true di config.js kalau y terbalik) */
const CT = Object.assign({
  dir: 'tiles_kerinci', minZ: 10, maxZ: 16, opacity: 0.8, tms: false,
  west: 101.1972, east: 101.3359, south: -1.7620, north: -1.6054
}, CFG.contour || {});
const ctCache = new Map();

const scale = () => 256 * Math.pow(2, view.z);
const sx = (lon) => (wx(lon) - view.cx) * scale() + W / 2;
const sy = (lat) => (wy(lat) - view.cy) * scale() + H / 2;

function resize(){
  const r = cv.parentElement.getBoundingClientRect();
  if (!r.width || !r.height) return;
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  draw();
}

function fit(){
  if (!tracks.length || !W) return;
  let a = 90, b = -90, c = 180, d = -180;
  tracks.forEach(t => t.points.forEach(p => { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); }));
  waypoints.forEach(w => { a = Math.min(a, w.lat); b = Math.max(b, w.lat); c = Math.min(c, w.lon); d = Math.max(d, w.lon); });
  const x0 = wx(c), x1 = wx(d), y0 = wy(b), y1 = wy(a);
  view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
  const pad = 56;
  const zx = Math.log2((W - pad*2) / 256 / (x1 - x0)), zy = Math.log2((H - pad*2 - 110) / 256 / (y1 - y0));
  view.z = Math.max(8, Math.min(zx, zy));
  view.cy -= 55 / scale();   // sisakan ruang untuk legenda di atas
  draw();
}

function getTile(z, x, y){
  const k = z + '/' + x + '/' + y;
  let t = tileCache.get(k);
  if (t) return t.ok ? t.img : null;
  const img = new Image();
  t = { img, ok: false };
  img.crossOrigin = 'anonymous';
  img.onload = () => { t.ok = true; schedule(); };
  img.src = `https://tile.openstreetmap.org/${k}.png`;
  tileCache.set(k, t);
  if (tileCache.size > 300) tileCache.delete(tileCache.keys().next().value);
  return null;
}

function drawTiles(){
  const zi = Math.max(5, Math.min(17, Math.round(view.z)));
  const n = Math.pow(2, zi), ts = 256 * Math.pow(2, view.z) / n;
  const x0 = Math.floor((view.cx - W / 2 / scale()) * n), x1 = Math.floor((view.cx + W / 2 / scale()) * n);
  const y0 = Math.floor((view.cy - H / 2 / scale()) * n), y1 = Math.floor((view.cy + H / 2 / scale()) * n);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 60) return;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= n) continue;
    const img = getTile(zi, ((x % n) + n) % n, y);
    if (img) ctx.drawImage(img, (x / n - view.cx) * scale() + W / 2, (y / n - view.cy) * scale() + H / 2, ts + 0.5, ts + 0.5);
  }
}

/* ---------- kontur: tile lokal, hanya dimuat di dalam batas GeoTIFF ---------- */
function getContour(z, x, y){
  const k = z + '/' + x + '/' + y;
  let t = ctCache.get(k);
  if (t) return t.ok ? t.img : null;
  const img = new Image();
  t = { img, ok: false };
  img.onload = () => { t.ok = true; schedule(); };
  img.onerror = () => { t.err = true; };            // tile kosong/tidak ada: lewati saja
  const yy = CT.tms ? (Math.pow(2, z) - 1 - y) : y;
  img.src = `${CT.dir}/${z}/${x}/${yy}.png`;
  ctCache.set(k, t);
  if (ctCache.size > 300) ctCache.delete(ctCache.keys().next().value);
  return null;
}

function drawContour(){
  const zi = Math.max(CT.minZ, Math.min(CT.maxZ, Math.round(view.z)));
  const n = Math.pow(2, zi), ts = scale() / n;
  const x0 = Math.max(Math.floor(wx(CT.west) * n), Math.floor((view.cx - W / 2 / scale()) * n));
  const x1 = Math.min(Math.floor(wx(CT.east) * n), Math.floor((view.cx + W / 2 / scale()) * n));
  const y0 = Math.max(Math.floor(wy(CT.north) * n), Math.floor((view.cy - H / 2 / scale()) * n));
  const y1 = Math.min(Math.floor(wy(CT.south) * n), Math.floor((view.cy + H / 2 / scale()) * n));
  if (x1 < x0 || y1 < y0 || (x1 - x0 + 1) * (y1 - y0 + 1) > 80) return;
  ctx.globalAlpha = CT.opacity;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const img = getContour(zi, x, y);
    if (img) ctx.drawImage(img, (x / n - view.cx) * scale() + W / 2, (y / n - view.cy) * scale() + H / 2, ts + 0.5, ts + 0.5);
  }
  ctx.globalAlpha = 1;
}

function drawGrid(){
  const lonSpan = W / scale() * 360, step = [0.002,0.005,0.01,0.02,0.05,0.1].find(s => lonSpan / s < 5) || 0.1;
  ctx.lineWidth = 1; ctx.strokeStyle = DARK ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)';
  ctx.fillStyle = DARK ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.4)'; ctx.font = '10px system-ui';
  const lonL = unx(view.cx - W / 2 / scale()), lonR = unx(view.cx + W / 2 / scale());
  const latT = uny(view.cy - H / 2 / scale()), latB = uny(view.cy + H / 2 / scale());
  ctx.beginPath();
  for (let lo = Math.ceil(lonL / step) * step; lo < lonR; lo += step) { const x = Math.round(sx(lo)) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.fillText(lo.toFixed(3) + '°E', x + 2, H - 4); }
  for (let la = Math.ceil(latB / step) * step; la < latT; la += step) { const y = Math.round(sy(la)) + .5; ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.fillText(la.toFixed(3) + '°', 2, y - 2); }
  ctx.stroke();
}

function drawRoutes(){
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  tracks.forEach(t => {
    const pts = t.points;
    // selubung putih
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 7; ctx.setLineDash([]);
    ctx.beginPath(); pts.forEach((p, i) => { const x = sx(p[1]), y = sy(p[0]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    // garis berwarna, celah putus-putus
    for (let i = 0; i < pts.length - 1; i++) {
      const gap = t.gaps.has(i);
      ctx.strokeStyle = gap ? '#333' : t.color; ctx.lineWidth = gap ? 3 : 4.5; ctx.setLineDash(gap ? [7, 6] : []);
      ctx.beginPath(); ctx.moveTo(sx(pts[i][1]), sy(pts[i][0])); ctx.lineTo(sx(pts[i+1][1]), sy(pts[i+1][0])); ctx.stroke();
    }
  });
  ctx.setLineDash([]);
}

const KEY = /KERINCI TOP|Pintu Rimbo|Camp1 Bangunrejo|R10|Camp Kapas$|Tugu Yudha/;
function drawWaypoints(){
  const boxes = [];
  const showAll = view.z >= 14.3;
  ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle';
  const order = waypoints.map((w, i) => i).sort((a, b) => (KEY.test(waypoints[b].name) ? 1 : 0) - (KEY.test(waypoints[a].name) ? 1 : 0));
  order.forEach(i => {
    const w = waypoints[i], x = sx(w.lon), y = sy(w.lat);
    if (x < -30 || y < -30 || x > W + 30 || y > H + 30) return;
    const col = w.track.color, top = /KERINCI TOP/.test(w.name);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath();
    if (top) { ctx.moveTo(x, y - 11); ctx.lineTo(x + 10, y + 7); ctx.lineTo(x - 10, y + 7); ctx.closePath(); }
    else ctx.arc(x, y, w === sel ? 8 : 5, 0, 7);
    ctx.fill(); ctx.stroke();
    if (!(showAll || KEY.test(w.name) || w === sel)) return;
    const tw = ctx.measureText(w.name).width, bx = x + 9, by = y - 8, box = [bx - 2, by - 2, tw + 4, 18];
    if (w !== sel && boxes.some(b => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) return;
    boxes.push(box);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(w.name, bx, y);
    ctx.fillStyle = '#1b2a1f'; ctx.fillText(w.name, bx, y);
  });
}

function drawMe(){
  if (!me) return;
  const x = sx(me.lon), y = sy(me.lat), r = me.acc / (40075016.686 * Math.cos(me.lat * Math.PI / 180) / scale());
  if (r > 6) { ctx.fillStyle = 'rgba(37,99,235,.15)'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 7); ctx.fill();
}

let raf = 0;
function schedule(){ if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
function draw(){
  if (!W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = DARK ? '#1b231d' : '#e9eee4'; ctx.fillRect(0, 0, W, H);
  if (tilesOn) drawTiles();
  if (contourOn) drawContour();
  drawGrid(); drawRoutes(); drawWaypoints(); drawMe();
  if (tilesOn) { ctx.font = '10px system-ui'; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.textAlign = 'right'; ctx.fillText('© OpenStreetMap contributors', W - 6, H - 6); ctx.textAlign = 'left'; }
  updateScale();
}

function updateScale(){
  const lat = uny(view.cy), mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / scale();
  const nice = [10,20,50,100,200,500,1000,2000,5000].find(v => v / mpp >= 60) || 5000;
  const el = $('#scaleBar');
  el.innerHTML = `${nice >= 1000 ? nice / 1000 + ' km' : nice + ' m'}<i style="width:${Math.round(nice / mpp)}px"></i>`;
}

/* ---------- gestur ---------- */
const ptrs = new Map();
let tap = null, lastDist = 0;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  tap = ptrs.size === 1 ? { x: e.offsetX, y: e.offsetY, t: Date.now() } : null;
  lastDist = 0;
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (tap && Math.hypot(e.offsetX - tap.x, e.offsetY - tap.y) > 6) tap = null;
  if (ptrs.size === 1) {
    view.cx -= (e.offsetX - prev[0]) / scale(); view.cy -= (e.offsetY - prev[1]) / scale(); schedule();
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (lastDist) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.log2(d / lastDist));
    lastDist = d;
  }
});
const up = e => {
  if (tap && Date.now() - tap.t < 500) onTap(tap.x, tap.y);
  ptrs.delete(e.pointerId); tap = null; lastDist = 0;
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); tap = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, -e.deltaY * 0.002); }, { passive: false });
cv.addEventListener('dblclick', e => zoomAt(e.offsetX, e.offsetY, 1));
function zoomAt(px, py, dz){
  const nz = Math.max(8, Math.min(18, view.z + dz)), k = Math.pow(2, nz) * 256;
  const fx = view.cx + (px - W / 2) / scale(), fy = view.cy + (py - H / 2) / scale();
  view.z = nz; view.cx = fx - (px - W / 2) / k; view.cy = fy - (py - H / 2) / k; schedule();
}
function onTap(x, y){
  let best = null, bd = 22;
  waypoints.forEach(w => { const d = Math.hypot(sx(w.lon) - x, sy(w.lat) - y); if (d < bd) { bd = d; best = w; } });
  sel = best; renderCard(); schedule();
}

/* ---------- kartu info di peta ---------- */
function nearestWpt(lat, lon){
  const p = toM([lat, lon]); let best = null, bd = Infinity;
  waypoints.forEach(w => { const d = Math.hypot(w.mx - p[0], w.my - p[1]); if (d < bd) { bd = d; best = w; } });
  return { w: best, d: bd };
}
function gpsInfo(){
  const p = [me.lat, me.lon];
  let best = null;
  tracks.forEach(t => { const r = locate(t, p); if (!best || r.off < best.off) best = Object.assign({ t }, r); });
  const nw = nearestWpt(me.lat, me.lon);
  return { best, nw };
}
function renderCard(){
  const el = $('#gpsCard'); let h = '';
  if (sel) h += `<div><b>${sel.name}</b> <span class="hint">· ${sel.track.short}</span><br>Sekitar km ${(sel.along / 1000).toFixed(1).replace('.', ',')} dari ${fmtKm(sel.track.len)} · ${sel.lat.toFixed(5)}, ${sel.lon.toFixed(5)}</div>`;
  if (me) {
    const { best, nw } = gpsInfo(), off = best.off;
    const gapHere = best.t.gaps.has(best.seg);
    h += `${sel ? '<hr style="border:0;border-top:1px solid var(--line)">' : ''}<div><b>Posisi Anda</b> <span class="hint">±${Math.round(me.acc)} m</span><br>`;
    if (off < 250) h += `${best.t.short}: km ${(best.along / 1000).toFixed(1).replace('.', ',')} dari ${fmtKm(best.t.len)}, sisa ${fmtKm(best.t.len - best.along)}<br>` +
      `<span class="${off > 150 ? 'off' : ''}">${Math.round(off)} m dari garis jalur</span> <span class="hint">(data digitasi ±50–100 m)</span>` +
      (gapHere ? '<br><span class="off">Bagian celah data: garis jalur hanya perkiraan.</span>' : '');
    else h += `<span class="off">${fmtM(off)} dari garis jalur terdekat (${best.t.short}).</span> Periksa marka dan petunjuk panitia.`;
    h += `<br>Pos terdekat: ${nw.w.name} (${fmtM(nw.d)})</div>`;
  }
  el.innerHTML = h; el.hidden = !h;
}

/* ---------- GPS ---------- */
let watchId = null, centered = false;
function startGps(){
  if (!navigator.geolocation) { alert('Perangkat ini tidak mendukung GPS di browser.'); return; }
  if (watchId !== null) { if (me) { view.cx = wx(me.lon); view.cy = wy(me.lat); view.z = Math.max(view.z, 15.5); schedule(); } return; }
  $('#btnLocate').classList.add('on');
  watchId = navigator.geolocation.watchPosition(pos => {
    me = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy || 0 };
    if (!centered) { centered = true; view.cx = wx(me.lon); view.cy = wy(me.lat); view.z = Math.max(view.z, 15.5); }
    renderCard(); renderSos(); schedule();
  }, err => {
    watchId = null; $('#btnLocate').classList.remove('on');
    alert(err.code === 1 ? 'Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser.' : 'Lokasi belum didapat. Coba di tempat terbuka.');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

/* ---------- tab Pos, Info, Darurat ---------- */
function renderPos(){
  const el = $('#posList'); el.innerHTML = '';
  const order = [1, 2, 0];
  order.forEach(ti => {
    const t = tracks[ti]; if (!t) return;
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = `<i style="background:${t.color}"></i>${t.short} <span class="hint">${fmtKm(t.len)}</span>`; el.appendChild(g);
    waypoints.filter(w => w.track === t).sort((a, b) => a.along - b.along).forEach(w => {
      const b = document.createElement('button'); b.className = 'row';
      b.innerHTML = `<span>${w.name}<small>${w.lat.toFixed(5)}, ${w.lon.toFixed(5)}</small></span><span class="km">km ${(w.along / 1000).toFixed(1).replace('.', ',')}</span>`;
      b.onclick = () => { sel = w; view.cx = wx(w.lon); view.cy = wy(w.lat); view.z = 15.5; showTab('peta'); renderCard(); };
      el.appendChild(b);
    });
  });
}
function renderStats(){
  $('#routeStats').innerHTML = tracks.map(t => `<div class="card"><div class="stat"><b><span style="color:${t.color}">●</span> ${t.name}</b></div>` +
    `<div class="stat"><span>Panjang (dari garis digitasi)</span><b>${fmtKm(t.len)}</b></div>` +
    (t.gap_m.length ? `<div class="hint">Celah data ±${t.gap_m.map(fmtM).join(', ')} disambung garis lurus.</div>` : '') + '</div>').join('');
}
function telRow(c){ return `<div class="card num sos"><div class="num"><span><b>${c.label}</b><br>${c.number}</span><a class="call" href="tel:${c.number.replace(/\s/g, '')}">Telepon</a></div></div>`; }
function renderSos(){
  $('#sosCoords').innerHTML = me
    ? `<b>Koordinat Anda</b><br><span id="cc">${me.lat.toFixed(6)}, ${me.lon.toFixed(6)}</span> <span class="hint">±${Math.round(me.acc)} m</span><br><button class="btn" id="btnCopy" style="margin-top:8px">Salin koordinat</button>`
    : `<b>Koordinat Anda</b><br><span class="hint">Belum ada. Aktifkan lokasi untuk menampilkan koordinat yang bisa dikirim ke panitia.</span><br><button class="btn" id="btnGps2" style="margin-top:8px">Aktifkan lokasi</button>`;
  const c = $('#btnCopy'); if (c) c.onclick = async () => {
    const txt = `${me.lat.toFixed(6)}, ${me.lon.toFixed(6)} (±${Math.round(me.acc)} m)`;
    try { await navigator.clipboard.writeText(txt); c.textContent = 'Tersalin ✓'; } catch (e) { prompt('Salin koordinat:', txt); }
  };
  const g = $('#btnGps2'); if (g) g.onclick = startGps;
}
function renderContacts(){
  const org = (CFG.organizers || []).filter(c => c.number);
  $('#contacts').innerHTML = (org.length ? '<h3>Panitia FRESS</h3>' + org.map(telRow).join('') : '') +
    '<h3>Layanan darurat</h3>' + (CFG.emergency || []).map(telRow).join('');
}

/* ---------- tab & status ---------- */
function showTab(n){
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + n));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === n));
  if (n === 'peta') { resize(); }
  if (n === 'darurat') renderSos();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

let swReady = false;
function badge(){
  const el = $('#netBadge');
  if (!navigator.onLine) { el.textContent = swReady ? 'Offline · siap' : 'Offline'; el.className = 'badge off'; }
  else if (swReady) { el.textContent = 'Siap offline'; el.className = 'badge ok'; }
  else { el.textContent = 'Menyiapkan offline…'; el.className = 'badge'; }
}
async function checkOffline(){
  try { const c = await caches.keys(); const k = c.find(x => x.startsWith('fress-shell-')); if (k) swReady = !!(await (await caches.open(k)).match('data/routes.json')); } catch (e) {}
  badge();
}
addEventListener('online', badge); addEventListener('offline', badge);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    checkOffline(); setTimeout(checkOffline, 1500); setTimeout(checkOffline, 5000);
  }).catch(() => badge());
} else badge();

/* ---------- init ---------- */
$('#btnLocate').onclick = startGps;
$('#btnFit').onclick = () => { sel = null; renderCard(); fit(); };
const bt = $('#btnTiles');
bt.classList.toggle('on', tilesOn);
bt.onclick = () => {
  tilesOn = !tilesOn; store.set('tiles', tilesOn ? '1' : '0'); bt.classList.toggle('on', tilesOn); schedule();
  if (tilesOn && !navigator.onLine) alert('Peta dasar hanya muncul di area yang sudah pernah dibuka saat online. Jalur tetap tampil.');
};
const bc = $('#btnContour');
bc.classList.toggle('on', contourOn);
bc.onclick = () => {
  contourOn = !contourOn; store.set('contour', contourOn ? '1' : '0'); bc.classList.toggle('on', contourOn); schedule();
};
new ResizeObserver(resize).observe(cv.parentElement);

fetch('data/routes.json').then(r => r.json()).then(d => {
  tracks = d.tracks; tracks.forEach(prepTrack);
  waypoints = d.waypoints.map(w => { const m = toM([w.lat, w.lon]); return Object.assign(w, { mx: m[0], my: m[1] }); });
  waypoints.forEach(w => { w.track = trackFor(w); w.along = locate(w.track, [w.lat, w.lon]).along; });
  $('#legend').innerHTML = tracks.map(t => `<div><i style="background:${t.color}"></i>${t.short}</div>`).join('') +
    '<div><i class="dash" style="background:#333"></i>Celah data (perkiraan)</div>';
  renderPos(); renderStats(); renderContacts(); renderSos(); resize(); fit();
}).catch(() => { $('#legend').textContent = 'Data jalur gagal dimuat.'; });
badge();
window.__fress = { view, get tracks(){ return tracks; }, get waypoints(){ return waypoints; }, setMe(m){ me = m; renderCard(); renderSos(); schedule(); } };
})();
  
